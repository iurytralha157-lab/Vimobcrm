-- Diagnostic only. Select/verify the target explicitly before running.
-- Does not recover, requeue, discard, complete, or rewrite a routing snapshot.
-- Outputs queue metadata only; no payload content, phone or provider identifiers.
begin transaction read only;
set local statement_timeout = '8s';
set local lock_timeout = '1s';

with recursive live_heads as materialized (
  select inbox.id, inbox.organization_id, inbox.session_id, inbox.processing_epoch,
    inbox.event_key, inbox.processing_lane, inbox.status, inbox.attempts, inbox.max_attempts,
    inbox.next_attempt_at, inbox.created_at,
    coalesce(nullif(inbox.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') as routing_key,
    route.snapshot, inbox.last_error is not null as has_error
  from public.whatsapp_webhook_inbox inbox
  join public.whatsapp_sessions session on session.id = inbox.session_id
    and session.organization_id = inbox.organization_id
  left join private.whatsapp_webhook_session_cutovers cutover on cutover.session_id = session.id
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}' else '[]'::jsonb end
  ) route(snapshot)
  where coalesce(session.is_active, true) and coalesce(session.status, '') <> 'deleted'
    and inbox.processing_epoch = coalesce(cutover.active_epoch, 0)
    and inbox.processing_lane = 'live' and inbox.event_type = 'message' and inbox.provider = 'evolution_go'
    and inbox.status in ('pending', 'retry') and inbox.attempts < inbox.max_attempts
    and inbox.edge_execution_id is null and inbox.next_attempt_at <= now()
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and case when pg_catalog.jsonb_typeof(inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then pg_catalog.jsonb_array_length(inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}') else 0 end = 1
    and route.snapshot->>'binding_eligible' = 'true'
    and nullif(route.snapshot->>'predecessor_inbox_event_key', '') is not null
    and not exists (
      select 1 from public.whatsapp_webhook_inbox predecessor
      where predecessor.organization_id = inbox.organization_id and predecessor.session_id = inbox.session_id
        and predecessor.processing_epoch = inbox.processing_epoch
        and predecessor.event_key = route.snapshot->>'predecessor_inbox_event_key'
        and predecessor.status = 'processed'
    )
    and not exists (
      select 1 from public.whatsapp_webhook_routing_outcomes outcome
      where outcome.organization_id = inbox.organization_id and outcome.session_id = inbox.session_id
        and outcome.provider_message_id = route.snapshot->>'predecessor_provider_message_id'
    )
    and not exists (
      select 1 from public.whatsapp_webhook_inbox older
      where older.organization_id = inbox.organization_id and older.session_id = inbox.session_id
        and older.processing_epoch = inbox.processing_epoch and older.processing_lane = 'live'
        and older.status in ('pending', 'retry') and older.attempts < older.max_attempts
        and older.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
        and (older.created_at, older.id) < (inbox.created_at, inbox.id)
        and (coalesce(nullif(older.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
          or coalesce(nullif(inbox.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__') = '__session__'
          or older.payload #>> '{__vimob_ingress,routing_key}' = inbox.payload #>> '{__vimob_ingress,routing_key}')
    )
  order by inbox.created_at, inbox.id
  limit 200
), chain as (
  select head.id as live_head_id, head.*, 0 as depth, array[head.id] as visited
  from live_heads head
  union all
  select descendant.live_head_id, predecessor.id, predecessor.organization_id,
    predecessor.session_id, predecessor.processing_epoch, predecessor.event_key,
    predecessor.processing_lane, predecessor.status, predecessor.attempts, predecessor.max_attempts,
    predecessor.next_attempt_at, predecessor.created_at,
    coalesce(nullif(predecessor.payload #>> '{__vimob_ingress,routing_key}', ''), '__session__'),
    route.snapshot, predecessor.last_error is not null,
    descendant.depth + 1, descendant.visited || predecessor.id
  from chain descendant
  join public.whatsapp_webhook_inbox predecessor
    on predecessor.organization_id = descendant.organization_id
    and predecessor.session_id = descendant.session_id
    and predecessor.processing_epoch = descendant.processing_epoch
    and predecessor.event_key = descendant.snapshot->>'predecessor_inbox_event_key'
  cross join lateral pg_catalog.jsonb_array_elements(
    case when pg_catalog.jsonb_typeof(predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}' else '[]'::jsonb end
  ) route(snapshot)
  where descendant.depth < 32 and descendant.status in ('pending', 'retry')
    and not (predecessor.id = any(descendant.visited))
    and predecessor.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and case when pg_catalog.jsonb_typeof(predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then pg_catalog.jsonb_array_length(predecessor.payload #> '{__vimob_ingress,routing_snapshot,messages}') else 0 end = 1
    and route.snapshot->>'provider_message_id' = descendant.snapshot->>'predecessor_provider_message_id'
), tails as (
  select distinct on (live_head_id) * from chain order by live_head_id, depth desc
)
select tail.live_head_id, tail.id as tail_id, tail.organization_id, tail.session_id,
  tail.processing_epoch, tail.processing_lane, tail.status, tail.depth,
  tail.attempts, tail.max_attempts, tail.next_attempt_at <= now() as due,
  extract(epoch from now() - tail.created_at)::bigint as age_seconds, tail.has_error,
  case
    when tail.status = 'dead' then 'dead_requires_review'
    when tail.attempts >= tail.max_attempts then 'attempts_exhausted'
    when tail.depth = 32 and nullif(tail.snapshot->>'predecessor_inbox_event_key', '') is not null then 'depth_limit'
    when nullif(tail.snapshot->>'predecessor_inbox_event_key', '') is null then 'root_without_predecessor'
    when exists (
      select 1 from public.whatsapp_webhook_inbox predecessor
      where predecessor.organization_id = tail.organization_id and predecessor.session_id = tail.session_id
        and predecessor.processing_epoch = tail.processing_epoch
        and predecessor.event_key = tail.snapshot->>'predecessor_inbox_event_key'
    ) then 'predecessor_not_walkable_or_resolved'
    else 'predecessor_missing'
  end as tail_classification,
  tail.depth = 32 and nullif(tail.snapshot->>'predecessor_inbox_event_key', '') is not null as depth_limit,
  exists (
    select 1 from public.whatsapp_webhook_inbox cycle
    where cycle.organization_id = tail.organization_id and cycle.session_id = tail.session_id
      and cycle.processing_epoch = tail.processing_epoch
      and cycle.event_key = tail.snapshot->>'predecessor_inbox_event_key'
      and cycle.id = any(tail.visited)
  ) as cycle_detected,
  exists (
    select 1 from public.whatsapp_webhook_routing_snapshots ledger
    where ledger.organization_id = tail.organization_id and ledger.session_id = tail.session_id
      and ledger.processing_epoch = tail.processing_epoch
      and ledger.provider_message_id = tail.snapshot->>'provider_message_id'
      and ledger.inbox_event_key = tail.event_key
      and ledger.processing_lane = tail.processing_lane
      and ledger.routing_key = tail.routing_key
      and ledger.snapshot = tail.snapshot
  ) as immutable_snapshot_matches
from tails tail
order by tail.status, tail.created_at, tail.id;

rollback;
