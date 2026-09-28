begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('public.whatsapp_sessions') is null
     or pg_catalog.to_regclass('public.whatsapp_attendance_entries') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null then
    raise exception 'deleted_session_v1_quarantine_prerequisites_missing';
  end if;
end;
$preflight$;

-- This ledger is deliberately separate from the queue retention lifecycle.
-- A historical current_lead_id is only context, not permission to show a
-- message. No row in this table is exposed to CRM users or bound to a lead.
create table private.whatsapp_deleted_session_v1_ingress_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  event_type text not null,
  processing_lane text not null,
  provider text not null,
  provider_instance_id text,
  original_status text not null,
  original_attempts integer not null,
  original_last_error text,
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  original_expires_at timestamptz not null,
  payload jsonb not null,
  payload_sha256 text not null,
  routing_rows jsonb not null,
  routing_rows_sha256 text not null,
  archived_at timestamptz not null,
  retained_until timestamptz not null,
  reason text not null default 'deleted_session_v1_raw_preserved_without_attendance:v1',
  constraint whatsapp_deleted_session_v1_ingress_quarantine_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_status_check
    check (original_status in ('pending','retry','processing','processed','dead')),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_lane_check
    check (processing_lane in ('live','backlog')),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_provider_check
    check (provider = 'evolution_go'),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'
       and routing_rows_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_retention_check
    check ((event_type = 'message' and retained_until = 'infinity'::timestamptz)
       or (event_type <> 'message' and retained_until >= archived_at + interval '7 days')),
  constraint whatsapp_deleted_session_v1_ingress_quarantine_reason_check
    check (reason = 'deleted_session_v1_raw_preserved_without_attendance:v1')
);
alter table private.whatsapp_deleted_session_v1_ingress_quarantine
  enable row level security;
revoke all on table private.whatsapp_deleted_session_v1_ingress_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_deleted_session_v1_ingress_quarantine is
  'Operator-only full raw v1 ingress and immutable route proof from deleted sessions. Message payloads are held for historical recovery; controls are eligible for cleanup after seven days. No attendance or lead binding is inferred.';

-- One call handles one deleted session and returns counts, never identifiers.
-- It archives all v1 message rows (including dead roots) so a predecessor
-- chain remains reconstructable. It also archives every pending/retry v1
-- control before moving that session's unreachable active rows to dead.
-- It intentionally does not create a routing outcome or visible message.
create or replace function private.quarantine_deleted_session_v1_ingress()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_session_id uuid;
  v_organization_id uuid;
  v_at timestamptz;
  v_archived_messages integer := 0;
  v_archived_controls integer := 0;
  v_terminalized integer := 0;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25001', message = 'deleted_session_v1_quarantine_requires_read_committed';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger as guard
    where guard.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and guard.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and guard.tgenabled in ('O','A') and not guard.tgisinternal
  ) then
    raise exception using
      errcode = '55000', message = 'whatsapp_legacy_routing_guard_not_active';
  end if;

  select session.id, session.organization_id
  into v_session_id, v_organization_id
  from public.whatsapp_sessions as session
  where session.provider = 'evolution_go'
    and session.status = 'deleted' and session.is_active = false
    and exists (
      select 1 from public.whatsapp_webhook_inbox as inbox
      where inbox.organization_id = session.organization_id
        and inbox.session_id = session.id
        and inbox.status in ('pending','retry')
        and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    )
  order by session.id
  limit 1
  for share of session skip locked;
  if not found then
    return pg_catalog.jsonb_build_object(
      'session_processed', false,
      'archived_messages', 0,
      'archived_controls', 0,
      'terminalized_events', 0
    );
  end if;

  -- A confirmed entry changes the visibility policy. Stop for a dedicated
  -- case review instead of silently removing recoverable chat history.
  if exists (
    select 1 from public.whatsapp_attendance_entries as entry
    where entry.organization_id = v_organization_id
      and entry.session_id = v_session_id
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_has_attendance_proof';
  end if;
  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.status = 'processing'
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_has_processing_lease';
  end if;

  -- Lock every ancestor payload to be archived and each active control before
  -- copying. The normal worker cannot claim a deleted session; the row locks
  -- also fence manual status/payload changes in this transaction.
  perform 1
  from public.whatsapp_webhook_inbox as inbox
  where inbox.organization_id = v_organization_id
    and inbox.session_id = v_session_id
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and (inbox.event_type = 'message'
      or inbox.status in ('pending','retry'))
  order by inbox.created_at, inbox.id
  for update of inbox;

  v_at := pg_catalog.clock_timestamp();
  insert into private.whatsapp_deleted_session_v1_ingress_quarantine (
    inbox_id, organization_id, session_id, event_key, event_type,
    processing_lane, provider, provider_instance_id, original_status,
    original_attempts, original_last_error, original_created_at,
    original_updated_at, original_expires_at, payload, payload_sha256,
    routing_rows, routing_rows_sha256, archived_at, retained_until
  )
  select inbox.id, inbox.organization_id, inbox.session_id, inbox.event_key,
         inbox.event_type, inbox.processing_lane, inbox.provider,
         inbox.provider_instance_id, inbox.status, inbox.attempts,
         inbox.last_error, inbox.created_at, inbox.updated_at,
         inbox.expires_at, inbox.payload,
         private.canonical_jsonb_sha256(inbox.payload),
         route_rows.rows,
         private.canonical_jsonb_sha256(route_rows.rows),
         v_at,
         case when inbox.event_type = 'message'
           then 'infinity'::timestamptz
           else v_at + interval '7 days' end
  from public.whatsapp_webhook_inbox as inbox
  cross join lateral (
    select coalesce(
      pg_catalog.jsonb_agg(pg_catalog.to_jsonb(route)
        order by route.ingress_sequence, route.provider_message_id),
      '[]'::jsonb
    ) as rows
    from public.whatsapp_webhook_routing_snapshots as route
    where route.organization_id = inbox.organization_id
      and route.session_id = inbox.session_id
      and route.inbox_event_key = inbox.event_key
  ) as route_rows
  where inbox.organization_id = v_organization_id
    and inbox.session_id = v_session_id
    and inbox.provider = 'evolution_go'
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and (inbox.event_type = 'message'
      or inbox.status in ('pending','retry'))
  on conflict (inbox_id) do nothing;

  select count(*) filter (where audit.event_type = 'message'),
         count(*) filter (where audit.event_type <> 'message')
  into v_archived_messages, v_archived_controls
  from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
  where audit.organization_id = v_organization_id
    and audit.session_id = v_session_id;

  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and (inbox.event_type = 'message'
        or inbox.status in ('pending','retry'))
      and not exists (
        select 1
        from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
        where audit.inbox_id = inbox.id
          and audit.organization_id = inbox.organization_id
          and audit.session_id = inbox.session_id
          and audit.event_key = inbox.event_key
          and audit.event_type = inbox.event_type
          and audit.payload_sha256 = private.canonical_jsonb_sha256(inbox.payload)
      )
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_v1_raw_audit_incomplete';
  end if;

  -- A successor with an unresolved predecessor needs the ancestor's raw
  -- event and route copy. Marking it dead without that copy would strand the
  -- future historical importer even though this session cannot run a worker.
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    cross join lateral pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(inbox.payload #>
        '{__vimob_ingress,routing_snapshot,messages}') = 'array'
      then inbox.payload #> '{__vimob_ingress,routing_snapshot,messages}'
      else '[]'::jsonb end
    ) as payload_route(snapshot)
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.event_type = 'message'
      and inbox.status in ('pending','retry')
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and payload_route.snapshot ->> 'binding_eligible' = 'true'
      and not exists (
        select 1 from public.whatsapp_webhook_routing_snapshots as route
        where route.organization_id = inbox.organization_id
          and route.session_id = inbox.session_id
          and route.inbox_event_key = inbox.event_key
          and route.provider_message_id =
            payload_route.snapshot ->> 'provider_message_id'
          and route.snapshot = payload_route.snapshot
      )
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_v1_active_route_not_verified';
  end if;
  if exists (
    select 1
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_webhook_routing_snapshots as route
      on route.organization_id = inbox.organization_id
     and route.session_id = inbox.session_id
     and route.inbox_event_key = inbox.event_key
    left join public.whatsapp_webhook_routing_snapshots as ancestor
      on ancestor.organization_id = route.organization_id
     and ancestor.session_id = route.session_id
     and ancestor.provider_message_id = route.predecessor_provider_message_id
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.event_type = 'message'
      and inbox.status in ('pending','retry')
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
      and route.predecessor_provider_message_id is not null
      and (ancestor.provider_message_id is null or (not exists (
        select 1
        from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
        where audit.organization_id = ancestor.organization_id
          and audit.session_id = ancestor.session_id
          and audit.event_key = ancestor.inbox_event_key
          and audit.event_type = 'message'
          and audit.routing_rows @> pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(ancestor))
      )
      and not exists (
        select 1 from public.whatsapp_webhook_routing_outcomes as outcome
        where outcome.organization_id = ancestor.organization_id
          and outcome.session_id = ancestor.session_id
          and outcome.provider_message_id = ancestor.provider_message_id
          and outcome.ingress_sequence = ancestor.ingress_sequence
      )))
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_v1_chain_ancestor_not_archived';
  end if;

  update public.whatsapp_webhook_inbox as inbox
  set status = 'dead', dead_lettered_at = v_at,
      expires_at = case when inbox.event_type = 'message'
        then greatest(inbox.expires_at, v_at + interval '30 days')
        else v_at + interval '7 days' end,
      updated_at = v_at
  where inbox.organization_id = v_organization_id
    and inbox.session_id = v_session_id
    and inbox.provider = 'evolution_go'
    and inbox.status in ('pending','retry')
    and inbox.locked_at is null and inbox.locked_by is null
    and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
    and exists (
      select 1
      from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
      where audit.inbox_id = inbox.id
        and audit.payload_sha256 = private.canonical_jsonb_sha256(inbox.payload)
    );
  get diagnostics v_terminalized = row_count;

  if exists (
    select 1 from public.whatsapp_webhook_inbox as inbox
    where inbox.organization_id = v_organization_id
      and inbox.session_id = v_session_id
      and inbox.status in ('pending','retry')
      and inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}' = '1'
  ) then
    raise exception using
      errcode = '55000', message = 'deleted_session_v1_active_rows_remain';
  end if;

  return pg_catalog.jsonb_build_object(
    'session_processed', true,
    'archived_messages', v_archived_messages,
    'archived_controls', v_archived_controls,
    'terminalized_events', v_terminalized
  );
end;
$function$;
revoke all on function private.quarantine_deleted_session_v1_ingress()
  from public, anon, authenticated, service_role;
comment on function private.quarantine_deleted_session_v1_ingress() is
  'Operator-only full-raw audit and terminal quarantine of one deleted, attendance-free Evolution Go session per call. No send, lead assignment, routing outcome or visible chat content.';

-- Control events have no chat message body and leave this private audit after
-- seven additional days. Message payloads remain for the dedicated historical
-- review because the deleted sessions have no attendance confirmation.
create or replace function private.prune_deleted_session_v1_control_quarantine(
  p_limit integer default 1000
)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_deleted integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception using
      errcode = '22023', message = 'deleted_session_v1_control_prune_limit_invalid';
  end if;
  with victims as (
    select audit.inbox_id
    from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
    where audit.event_type <> 'message'
      and audit.retained_until <= pg_catalog.now()
    order by audit.retained_until, audit.inbox_id
    limit p_limit
    for update of audit skip locked
  )
  delete from private.whatsapp_deleted_session_v1_ingress_quarantine as audit
  using victims
  where audit.inbox_id = victims.inbox_id;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$function$;
revoke all on function private.prune_deleted_session_v1_control_quarantine(integer)
  from public, anon, authenticated, service_role;

do $schedule_deleted_session_v1_control_prune$
declare
  v_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise notice
      'pg_cron unavailable; deleted-session v1 control audit pruning requires an external scheduled call';
  else
    for v_job_id in
      select job.jobid from cron.job as job
      where job.jobname = 'prune-deleted-session-v1-control-quarantine'
    loop
      perform cron.unschedule(v_job_id);
    end loop;
    perform cron.schedule(
      'prune-deleted-session-v1-control-quarantine',
      '37 * * * *',
      'select private.prune_deleted_session_v1_control_quarantine();'
    );
  end if;
end;
$schedule_deleted_session_v1_control_prune$;

commit;
