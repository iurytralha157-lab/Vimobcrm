-- READ ONLY preflight for the failed-route ACTIVATE draft.
-- Run immediately before ACTIVATE with psql -XqAt -v ON_ERROR_STOP=1 -f this_file.
-- Compare counts with v_expected in the ACTIVATE script; the candidate count
-- may rise as old inbox rows reach DEAD. Ambiguous/orphan/unrepresented must
-- remain zero, and route_index must report t | t.
-- ACTIVATE rechecks these values under its NOWAIT inbox lock and aborts on drift.
begin transaction isolation level repeatable read read only;
set local statement_timeout = '5s';
set local lock_timeout = '500ms';

with candidates as materialized (
  select inbox.id as root_inbox_id,inbox.organization_id,inbox.session_id,
    route.routing_key,route.provider_message_id,route.ingress_sequence,
    pg_catalog.to_jsonb(inbox) as original_inbox,
    private.canonical_jsonb_sha256(inbox.payload) as payload_sha256
  from public.whatsapp_webhook_inbox as inbox
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = inbox.organization_id
   and route.session_id = inbox.session_id
   and route.provider_message_id = inbox.payload #>>
     '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
  where inbox.status = 'dead' and inbox.provider = 'evolution_go'
    and inbox.event_type = 'message'
    and inbox.last_error in (
      'native WhatsApp processor does not support this event',
      'native WhatsApp processor rejected an unsupported message-like event')
    and inbox.attempts >= inbox.max_attempts
    and inbox.dead_lettered_at is not null
    and inbox.locked_at is null and inbox.locked_by is null
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and (case when pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then pg_catalog.jsonb_array_length(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
    and route.binding_eligible = true
    and route.snapshot = inbox.payload #>
      '{__vimob_ingress,routing_snapshot,messages,0}'
    and route.routing_key = inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,routing_key}'
    and route.inbox_event_key = inbox.event_key
    and route.processing_lane = inbox.processing_lane
    and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
      where outcome.organization_id = route.organization_id
        and outcome.session_id = route.session_id
        and outcome.provider_message_id = route.provider_message_id
        and outcome.ingress_sequence = route.ingress_sequence)
)
select 'counts' as kind,
  (select count(*) from candidates) as candidates,
  (select count(*)
   from public.whatsapp_webhook_inbox as inbox
   join public.whatsapp_webhook_routing_snapshots as route
     on route.organization_id = inbox.organization_id
    and route.session_id = inbox.session_id
    and route.provider_message_id = inbox.payload #>>
      '{__vimob_ingress,routing_snapshot,messages,0,provider_message_id}'
   where inbox.status = 'dead' and inbox.provider = 'evolution_go'
     and inbox.event_type = 'message'
     and inbox.last_error in (
       'native WhatsApp processor does not support this event',
       'native WhatsApp processor rejected an unsupported message-like event')
     and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
     and (case when pg_catalog.jsonb_typeof(inbox.payload #>
         '{__vimob_ingress,routing_snapshot,messages}') = 'array'
       then pg_catalog.jsonb_array_length(inbox.payload #>
         '{__vimob_ingress,routing_snapshot,messages}') else -1 end) = 1
     and route.binding_eligible = true
     and (route.snapshot is distinct from inbox.payload #>
         '{__vimob_ingress,routing_snapshot,messages,0}'
       or route.routing_key is distinct from inbox.payload #>>
         '{__vimob_ingress,routing_snapshot,messages,0,routing_key}'
       or route.inbox_event_key is distinct from inbox.event_key
       or route.processing_lane is distinct from inbox.processing_lane)) as ambiguous,
  (select count(*)
   from public.whatsapp_webhook_routing_snapshots as route
   where route.binding_eligible = true
     and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = route.organization_id
         and outcome.session_id = route.session_id
         and outcome.provider_message_id = route.provider_message_id
         and outcome.ingress_sequence = route.ingress_sequence)
     and not exists (select 1 from public.whatsapp_webhook_inbox as inbox
       where inbox.organization_id = route.organization_id
         and inbox.session_id = route.session_id
         and inbox.event_key = route.inbox_event_key)) as orphan,
  (select count(*)
   from public.whatsapp_webhook_inbox as inbox
   join public.whatsapp_webhook_routing_snapshots as route
     on route.organization_id = inbox.organization_id
    and route.session_id = inbox.session_id
    and route.inbox_event_key = inbox.event_key
   where inbox.status = 'dead' and inbox.provider = 'evolution_go'
     and inbox.event_type = 'message'
     and inbox.last_error in (
       'native WhatsApp processor does not support this event',
       'native WhatsApp processor rejected an unsupported message-like event')
     and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
     and route.binding_eligible = true
     and not exists (select 1 from public.whatsapp_webhook_routing_outcomes as outcome
       where outcome.organization_id = route.organization_id
         and outcome.session_id = route.session_id
         and outcome.provider_message_id = route.provider_message_id
         and outcome.ingress_sequence = route.ingress_sequence)
     and not exists (select 1 from candidates as candidate
       where candidate.root_inbox_id = inbox.id
         and candidate.organization_id = route.organization_id
         and candidate.session_id = route.session_id
         and candidate.provider_message_id = route.provider_message_id
         and candidate.ingress_sequence = route.ingress_sequence)) as unrepresented;

select 'route_index' as kind,
  coalesce(index_state.indisvalid,false) as valid,
  coalesce(index_state.indisready,false) as ready,
  coalesce(pg_catalog.pg_get_indexdef(index_state.indexrelid),'MISSING') as definition
from (select pg_catalog.to_regclass(
  'public.whatsapp_webhook_inbox_failed_route_active_idx') as index_oid) as target
left join pg_catalog.pg_index as index_state
  on index_state.indexrelid = target.index_oid;

commit;
