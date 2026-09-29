begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure('private.guard_whatsapp_webhook_legacy_routing_freeze()') is null
     or pg_catalog.strpos(
       pg_catalog.pg_get_functiondef(
         'private.guard_whatsapp_webhook_legacy_routing_freeze()'::regprocedure
       ),
       'private.is_authorized_frozen_legacy_message_quarantine'
     ) = 0
     or not exists (
       select 1 from pg_catalog.pg_trigger as trigger_state
       where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
         and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
         and trigger_state.tgenabled in ('O','A')
         and not trigger_state.tgisinternal
     ) then
    raise exception 'unroutable_buttonclick_quarantine_prerequisites_missing';
  end if;
end;
$preflight$;

-- ButtonClick contains user-authored text, so it is never classified as a
-- nonlead event. These exact old payloads have no sender, chat or message ID;
-- preserve the complete JSONB plus its hash indefinitely before removing
-- an event from the active queue. No lead, attendance, message or route is made.
create table private.whatsapp_unroutable_buttonclick_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  processing_lane text not null,
  original_status text not null,
  original_attempts integer not null,
  original_last_error text,
  original_created_at timestamptz not null,
  original_updated_at timestamptz not null,
  original_expires_at timestamptz not null,
  snapshot_version text,
  was_frozen boolean not null,
  payload jsonb not null,
  payload_sha256 text not null,
  quarantined_at timestamptz not null,
  retained_until timestamptz not null default 'infinity'::timestamptz,
  reason text not null default 'unroutable_buttonclick_sender_missing:v1',
  constraint whatsapp_unroutable_buttonclick_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_unroutable_buttonclick_lane_check
    check (processing_lane = 'backlog'),
  constraint whatsapp_unroutable_buttonclick_status_check
    check (original_status in ('pending','retry') and original_attempts >= 0),
  constraint whatsapp_unroutable_buttonclick_version_check
    check (was_frozen = (snapshot_version is null)
       and (snapshot_version is null or snapshot_version = '1')),
  constraint whatsapp_unroutable_buttonclick_sha_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_unroutable_buttonclick_retention_check
    check (retained_until = 'infinity'::timestamptz),
  constraint whatsapp_unroutable_buttonclick_reason_check
    check (reason = 'unroutable_buttonclick_sender_missing:v1')
);
alter table private.whatsapp_unroutable_buttonclick_quarantine
  enable row level security;
revoke all on table private.whatsapp_unroutable_buttonclick_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_unroutable_buttonclick_quarantine is
  'Private indefinite raw audit of old ButtonClick events with no sender, chat or provider message ID. They may contain lead text and remain available for later exact recovery; no lead is inferred.';

create or replace function private.is_unroutable_buttonclick_payload(p_payload jsonb)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(p_payload) = 'object'
     and p_payload ?& array[
       '__vimob_ingress','event','data','instanceId','instanceName'
     ]
     and (select count(*) from pg_catalog.jsonb_object_keys(
       case when pg_catalog.jsonb_typeof(p_payload) = 'object'
         then p_payload else '{}'::jsonb end
     )) = 5
     and p_payload ->> 'event' = 'ButtonClick'
     and pg_catalog.jsonb_typeof(p_payload -> 'instanceId') = 'string'
     and pg_catalog.jsonb_typeof(p_payload -> 'instanceName') = 'string'
     and pg_catalog.jsonb_typeof(p_payload -> 'data') = 'object'
     and (p_payload -> 'data') ?& array[
       'buttonId','buttonText','chat','extraData','fromMe','jid',
       'messageId','phone','pushName','timestamp','type'
     ]
     and (select count(*) from pg_catalog.jsonb_object_keys(
       case when pg_catalog.jsonb_typeof(p_payload -> 'data') = 'object'
         then p_payload -> 'data' else '{}'::jsonb end
     )) = 11
     and pg_catalog.jsonb_typeof(p_payload #> '{data,buttonId}') = 'string'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,buttonText}') = 'string'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,extraData}') = 'object'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,type}') = 'string'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,timestamp}') = 'number'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,phone}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,jid}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,chat}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,messageId}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,pushName}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload #> '{data,fromMe}') = 'null'
     and pg_catalog.jsonb_typeof(p_payload -> '__vimob_ingress') = 'object'
     and p_payload #>> '{__vimob_ingress,routing_key}' = '__session__'
     and (
       ((select count(*) from pg_catalog.jsonb_object_keys(
         case when pg_catalog.jsonb_typeof(
           p_payload -> '__vimob_ingress'
         ) = 'object' then p_payload -> '__vimob_ingress'
         else '{}'::jsonb end
       )) = 1
        and p_payload -> '__vimob_ingress' ? 'routing_key'
        and not ((p_payload -> '__vimob_ingress') ? 'routing_snapshot'))
       or
       ((select count(*) from pg_catalog.jsonb_object_keys(
         case when pg_catalog.jsonb_typeof(
           p_payload -> '__vimob_ingress'
         ) = 'object' then p_payload -> '__vimob_ingress'
         else '{}'::jsonb end
       )) = 2
        and p_payload -> '__vimob_ingress' ?&
          array['routing_key','routing_snapshot']
        and p_payload #> '{__vimob_ingress,routing_snapshot}' =
          '{"version":1,"messages":[]}'::jsonb)
     );
$function$;
revoke all on function private.is_unroutable_buttonclick_payload(jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.is_unroutable_buttonclick_inbox(
  p_inbox public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (p_inbox).provider = 'evolution_go'
     and (p_inbox).event_type = 'buttonclick'
     and (p_inbox).processing_lane = 'backlog'
     and (p_inbox).status in ('pending','retry')
     and (p_inbox).locked_at is null and (p_inbox).locked_by is null
     and (p_inbox).dead_lettered_at is null
     and private.is_unroutable_buttonclick_payload((p_inbox).payload)
     and (
       ((p_inbox).created_at < pg_catalog.now() - interval '7 days'
        and (p_inbox).payload #> '{__vimob_ingress,routing_snapshot}' is null
        and private.is_frozen_legacy_whatsapp_ingress(
          (p_inbox).id, (p_inbox).organization_id, (p_inbox).session_id,
          (p_inbox).event_key, (p_inbox).processing_lane
        ))
       or
       ((p_inbox).created_at < pg_catalog.now() - interval '1 hour'
        and (p_inbox).payload #> '{__vimob_ingress,routing_snapshot}' =
          '{"version":1,"messages":[]}'::jsonb
        and not private.is_frozen_legacy_whatsapp_ingress(
          (p_inbox).id, (p_inbox).organization_id, (p_inbox).session_id,
          (p_inbox).event_key, (p_inbox).processing_lane
        ))
     )
     and not exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       where route.organization_id = (p_inbox).organization_id
         and route.session_id = (p_inbox).session_id
         and route.inbox_event_key = (p_inbox).event_key
     );
$function$;
revoke all on function private.is_unroutable_buttonclick_inbox(
  public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

-- The legacy guard accepts only the exact audited status transition. It still
-- blocks every delete, payload rewrite and other status change of frozen rows.
create or replace function private.is_authorized_frozen_buttonclick_quarantine(
  p_old public.whatsapp_webhook_inbox,
  p_new public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $function$
  select private.is_unroutable_buttonclick_inbox(p_old)
     and p_new.status = 'dead'
     and p_new.dead_lettered_at is not null
     and p_new.updated_at = p_new.dead_lettered_at
     and (pg_catalog.to_jsonb(p_new) - array[
       'status','dead_lettered_at','updated_at'
     ]) = (pg_catalog.to_jsonb(p_old) - array[
       'status','dead_lettered_at','updated_at'
     ])
     and exists (
       select 1
       from private.whatsapp_unroutable_buttonclick_quarantine as audit
       join private.whatsapp_webhook_legacy_routing_freeze as frozen
         on frozen.inbox_id = audit.inbox_id
        and frozen.organization_id = audit.organization_id
        and frozen.session_id = audit.session_id
        and frozen.event_key = audit.event_key
        and frozen.processing_lane = audit.processing_lane
        and frozen.original_status = audit.original_status
       where audit.inbox_id = (p_old).id
         and audit.organization_id = (p_old).organization_id
         and audit.session_id = (p_old).session_id
         and audit.event_key = (p_old).event_key
         and audit.processing_lane = (p_old).processing_lane
         and audit.original_status = (p_old).status
         and audit.original_attempts = (p_old).attempts
         and audit.original_last_error is not distinct from (p_old).last_error
         and audit.original_created_at = (p_old).created_at
         and audit.original_updated_at = (p_old).updated_at
         and audit.original_expires_at = (p_old).expires_at
         and audit.snapshot_version is null
         and audit.was_frozen
         and audit.payload = (p_old).payload
         and audit.payload_sha256 =
           private.canonical_jsonb_sha256((p_old).payload)
         and audit.quarantined_at = p_new.dead_lettered_at
         and audit.retained_until = 'infinity'::timestamptz
     );
$function$;
revoke all on function private.is_authorized_frozen_buttonclick_quarantine(
  public.whatsapp_webhook_inbox, public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

-- Keep both previously reviewed freeze exceptions byte-for-byte in behavior.
create or replace function private.guard_whatsapp_webhook_legacy_routing_freeze()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_old_frozen boolean := false;
  v_new_snapshot_version text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_old_frozen := private.is_frozen_legacy_whatsapp_ingress(
      old.id, old.organization_id, old.session_id, old.event_key, old.processing_lane
    );
  end if;
  if tg_op = 'DELETE' then
    if v_old_frozen then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_delete_forbidden',
        hint = 'The preserved raw ingress cannot be deleted by queue quarantine.';
    end if;
    return old;
  end if;

  if v_old_frozen then
    if private.is_authorized_frozen_legacy_message_quarantine(old, new)
       or private.is_authorized_frozen_buttonclick_quarantine(old, new) then
      return new;
    end if;
    if tg_op = 'UPDATE'
       and old.event_type = 'receipt'
       and old.provider = 'evolution_go'
       and old.status in ('pending', 'retry')
       and old.created_at < pg_catalog.now() - interval '7 days'
       and old.locked_at is null and old.locked_by is null
       and new.status = 'dead'
       and new.dead_lettered_at is not null
       and new.updated_at = new.dead_lettered_at
       and new.expires_at = 'infinity'::timestamptz
       and (pg_catalog.to_jsonb(new) - array['status','dead_lettered_at','updated_at','expires_at'])
         = (pg_catalog.to_jsonb(old) - array['status','dead_lettered_at','updated_at','expires_at'])
       and private.is_frozen_legacy_status_only_receipt(old.payload)
       and exists (
         select 1
         from private.whatsapp_legacy_receipt_terminalizations as audit
         join private.whatsapp_webhook_legacy_routing_freeze as frozen
           on frozen.inbox_id = audit.inbox_id
          and frozen.organization_id = audit.organization_id
          and frozen.session_id = audit.session_id
          and frozen.event_key = audit.event_key
          and frozen.processing_lane = audit.processing_lane
          and frozen.original_status = audit.original_status
         where audit.inbox_id = old.id
           and audit.organization_id = old.organization_id
           and audit.session_id = old.session_id
           and audit.event_key = old.event_key
           and audit.processing_lane = old.processing_lane
           and audit.original_status = old.status
           and audit.payload_sha256 = private.canonical_jsonb_sha256(old.payload)
           and audit.provider_message_ids = old.payload #> '{data,MessageIDs}'
           and audit.receipt_type = old.payload #>> '{data,Type}'
           and audit.terminalized_at = new.dead_lettered_at
           and audit.reason = 'frozen_legacy_status_only_receipt_after_7_days:v1'
       ) then
      return new;
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.session_id is distinct from old.session_id
       or new.event_key is distinct from old.event_key
       or new.event_type is distinct from old.event_type
       or new.provider_instance_id is distinct from old.provider_instance_id
       or new.processing_lane is distinct from old.processing_lane
       or new.payload is distinct from old.payload
       or new.status is distinct from old.status then
      raise exception using
        errcode = '55000',
        message = 'frozen_legacy_whatsapp_ingress_mutation_forbidden',
        hint = 'Use only an audited procedure for preserved pre-v1 ingress.';
    end if;
    return new;
  end if;

  v_new_snapshot_version := coalesce(
    new.payload #>> '{__vimob_ingress,routing_snapshot,version}', ''
  );
  if new.status in ('pending', 'retry', 'processing')
     and v_new_snapshot_version <> '1' then
    raise exception using
      errcode = '23514',
      message = 'active_whatsapp_ingress_requires_routing_snapshot_v1';
  end if;
  return new;
end;
$function$;
revoke all on function private.guard_whatsapp_webhook_legacy_routing_freeze()
  from public, anon, authenticated, service_role;
comment on function private.guard_whatsapp_webhook_legacy_routing_freeze() is
  'Preserves frozen pre-v1 ingress; only exact audit-backed receipt, message and unroutable ButtonClick status transitions may leave the active queue.';

-- Operator-invoked, bounded batches. Installing this function has no queue
-- effect. The row lock serializes claims; the session-route advisory lock
-- fences routing capture while the exact absence of a snapshot is checked.
create or replace function private.quarantine_unroutable_buttonclick_ingress(
  p_limit integer default 1
)
returns table (legacy_quarantined integer, v1_quarantined integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_at timestamptz;
  v_updated integer;
  v_frozen boolean;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100 then
    raise exception using errcode = '22023',
      message = 'invalid_unroutable_buttonclick_limit';
  end if;
  legacy_quarantined := 0;
  v1_quarantined := 0;
  if p_limit = 0 then
    return next;
    return;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger as trigger_state
    where trigger_state.tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and trigger_state.tgname = 'guard_whatsapp_webhook_legacy_routing_freeze'
      and trigger_state.tgenabled in ('O','A')
      and not trigger_state.tgisinternal
  ) then
    raise exception using errcode = '55000',
      message = 'whatsapp_legacy_routing_guard_not_active';
  end if;

  for v_candidate in
    select inbox.id, inbox.organization_id, inbox.session_id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.provider = 'evolution_go'
      and inbox.event_type = 'buttonclick'
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending','retry')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload ->> 'event' = 'ButtonClick'
      and inbox.payload #>> '{__vimob_ingress,routing_key}' = '__session__'
    order by inbox.created_at, inbox.id
    limit least(500, p_limit + 100)
  loop
    if not pg_catalog.pg_try_advisory_xact_lock(
      pg_catalog.hashtextextended(
        v_candidate.organization_id::text || ':' ||
        v_candidate.session_id::text || ':__session__', 0
      )
    ) then
      continue;
    end if;
    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.organization_id = v_candidate.organization_id
      and inbox.session_id = v_candidate.session_id
    for update of inbox skip locked;
    if not found
       or private.is_unroutable_buttonclick_inbox(v_inbox) is distinct from true
       or exists (
         select 1 from private.whatsapp_unroutable_buttonclick_quarantine as audit
         where audit.inbox_id = v_inbox.id
       ) then
      continue;
    end if;
    v_frozen := private.is_frozen_legacy_whatsapp_ingress(
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.processing_lane
    );
    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_unroutable_buttonclick_quarantine (
      inbox_id, organization_id, session_id, event_key, processing_lane,
      original_status, original_attempts, original_last_error,
      original_created_at, original_updated_at, original_expires_at,
      snapshot_version, was_frozen, payload, payload_sha256, quarantined_at
    ) values (
      v_inbox.id, v_inbox.organization_id, v_inbox.session_id,
      v_inbox.event_key, v_inbox.processing_lane, v_inbox.status,
      v_inbox.attempts, v_inbox.last_error, v_inbox.created_at,
      v_inbox.updated_at, v_inbox.expires_at,
      v_inbox.payload #>> '{__vimob_ingress,routing_snapshot,version}',
      v_frozen, v_inbox.payload,
      private.canonical_jsonb_sha256(v_inbox.payload), v_at
    );

    update public.whatsapp_webhook_inbox as inbox
    set status = 'dead', dead_lettered_at = v_at, updated_at = v_at
    where inbox.id = v_inbox.id
      and inbox.organization_id = v_inbox.organization_id
      and inbox.session_id = v_inbox.session_id
      and inbox.event_key = v_inbox.event_key
      and inbox.status = v_inbox.status
      and inbox.attempts = v_inbox.attempts
      and inbox.updated_at = v_inbox.updated_at
      and inbox.payload = v_inbox.payload
      and inbox.locked_at is null and inbox.locked_by is null
      and private.is_unroutable_buttonclick_inbox(inbox) is true;
    get diagnostics v_updated = row_count;
    if v_updated <> 1 then
      raise exception using errcode = '40001',
        message = 'unroutable_buttonclick_compare_and_swap_failed';
    end if;
    if v_frozen then
      legacy_quarantined := legacy_quarantined + 1;
    else
      v1_quarantined := v1_quarantined + 1;
    end if;
    exit when legacy_quarantined + v1_quarantined >= p_limit;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_unroutable_buttonclick_ingress(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_unroutable_buttonclick_ingress(integer)
  to service_role;
comment on function private.quarantine_unroutable_buttonclick_ingress(integer) is
  'Operator-invoked quarantine of exact old ButtonClick payloads without sender/chat/message ID. Start with limit 1, then batches up to 100; full raw JSONB survives indefinitely in private audit.';

do $selfcheck$
declare
  v_legacy integer;
  v_v1 integer;
begin
  if private.is_unroutable_buttonclick_payload('{}'::jsonb) is distinct from false
     or private.is_unroutable_buttonclick_payload('null'::jsonb) is distinct from false then
    raise exception 'unroutable_buttonclick_classifier_fail_open';
  end if;
  select legacy_quarantined, v1_quarantined into v_legacy, v_v1
  from private.quarantine_unroutable_buttonclick_ingress(0);
  if v_legacy <> 0 or v_v1 <> 0 then
    raise exception 'unroutable_buttonclick_zero_limit_changed_queue';
  end if;
end;
$selfcheck$;

commit;
