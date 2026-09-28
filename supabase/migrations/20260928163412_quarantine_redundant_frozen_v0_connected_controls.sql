begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('public.whatsapp_webhook_inbox') is null
     or pg_catalog.to_regclass('public.whatsapp_sessions') is null
     or pg_catalog.to_regclass('public.whatsapp_webhook_routing_snapshots') is null
     or pg_catalog.to_regprocedure('private.canonical_jsonb_sha256(jsonb)') is null
     or pg_catalog.to_regprocedure(
       'private.is_deleted_session_v0_control(text,jsonb)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.is_authorized_frozen_deleted_session_v0_control_quarantine(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)'
     ) is null
     or pg_catalog.to_regprocedure(
       'private.is_authorized_frozen_buttonclick_quarantine(public.whatsapp_webhook_inbox,public.whatsapp_webhook_inbox)'
     ) is null then
    raise exception 'redundant_frozen_v0_connected_prerequisites_missing';
  end if;
end;
$preflight$;

create table private.whatsapp_redundant_frozen_v0_connected_quarantine (
  inbox_id uuid primary key,
  organization_id uuid not null,
  session_id uuid not null,
  event_key text not null,
  original_status text not null,
  original_attempts integer not null,
  payload_sha256 text not null,
  original_expires_at timestamptz not null,
  quarantined_at timestamptz not null,
  retained_until timestamptz not null,
  reason text not null default 'redundant_frozen_v0_connected_no_state_change:v1',
  constraint whatsapp_redundant_frozen_v0_connected_identity_key
    unique (organization_id, session_id, event_key),
  constraint whatsapp_redundant_frozen_v0_connected_status_check
    check (original_status in ('pending','retry')),
  constraint whatsapp_redundant_frozen_v0_connected_attempts_check
    check (original_attempts >= 0),
  constraint whatsapp_redundant_frozen_v0_connected_hash_check
    check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  constraint whatsapp_redundant_frozen_v0_connected_retention_check
    check (retained_until = 'infinity'::timestamptz),
  constraint whatsapp_redundant_frozen_v0_connected_reason_check
    check (reason = 'redundant_frozen_v0_connected_no_state_change:v1')
);
alter table private.whatsapp_redundant_frozen_v0_connected_quarantine
  enable row level security;
revoke all on table private.whatsapp_redundant_frozen_v0_connected_quarantine
  from public, anon, authenticated, service_role;
comment on table private.whatsapp_redundant_frozen_v0_connected_quarantine is
  'Exact frozen v0 Connected controls whose active session already has the same connected status, provider phone, profile and clear error. Signed raw ingress stays frozen indefinitely.';

create or replace function private.is_authorized_frozen_redundant_v0_connected_quarantine(
  p_old public.whatsapp_webhook_inbox,
  p_new public.whatsapp_webhook_inbox
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select (p_old).provider = 'evolution_go'
     and (p_old).event_type = 'connected'
     and (p_old).processing_lane = 'backlog'
     and (p_old).status in ('pending','retry')
     and (p_old).created_at < pg_catalog.now() - interval '1 hour'
     and (p_old).locked_at is null and (p_old).locked_by is null
     and (p_new).status = 'dead'
     and (p_new).dead_lettered_at is not null
     and (p_new).updated_at = (p_new).dead_lettered_at
     and (p_new).expires_at = 'infinity'::timestamptz
     and (pg_catalog.to_jsonb(p_new) - array['status','dead_lettered_at','updated_at','expires_at'])
       = (pg_catalog.to_jsonb(p_old) - array['status','dead_lettered_at','updated_at','expires_at'])
     and private.is_deleted_session_v0_control('connected', (p_old).payload)
     and split_part((p_old).payload #>> '{data,jid}', '@', 2) = 's.whatsapp.net'
     and exists (
       select 1 from public.whatsapp_sessions as session
       where session.organization_id = (p_old).organization_id
         and session.id = (p_old).session_id
         and session.provider = 'evolution_go'
         and session.is_active = true
         and session.status = 'connected'
         and session.last_error is null
         and session.profile_name = (p_old).payload #>> '{data,pushName}'
         and pg_catalog.regexp_replace(
           coalesce(session.phone_number,''), '[^0-9]', '', 'g'
         ) = pg_catalog.regexp_replace(
           split_part(split_part((p_old).payload #>> '{data,jid}','@',1),':',1),
           '[^0-9]', '', 'g'
         )
         and pg_catalog.length(pg_catalog.regexp_replace(
           coalesce(session.phone_number,''), '[^0-9]', '', 'g'
         )) >= 8
     )
     and not exists (
       select 1 from public.whatsapp_webhook_routing_snapshots as route
       where route.organization_id = (p_old).organization_id
         and route.session_id = (p_old).session_id
         and route.inbox_event_key = (p_old).event_key
     )
     and exists (
       select 1
       from private.whatsapp_redundant_frozen_v0_connected_quarantine as audit
       join private.whatsapp_webhook_legacy_routing_freeze as frozen
         on frozen.inbox_id = audit.inbox_id
        and frozen.organization_id = audit.organization_id
        and frozen.session_id = audit.session_id
        and frozen.event_key = audit.event_key
        and frozen.processing_lane = 'backlog'
        and frozen.original_status = audit.original_status
       where audit.inbox_id = (p_old).id
         and audit.organization_id = (p_old).organization_id
         and audit.session_id = (p_old).session_id
         and audit.event_key = (p_old).event_key
         and audit.original_status = (p_old).status
         and audit.original_attempts = (p_old).attempts
         and audit.original_expires_at = (p_old).expires_at
         and audit.payload_sha256 = private.canonical_jsonb_sha256((p_old).payload)
         and audit.quarantined_at = (p_new).dead_lettered_at
         and audit.retained_until = 'infinity'::timestamptz
         and audit.reason = 'redundant_frozen_v0_connected_no_state_change:v1'
     );
$function$;
revoke all on function private.is_authorized_frozen_redundant_v0_connected_quarantine(
  public.whatsapp_webhook_inbox, public.whatsapp_webhook_inbox
) from public, anon, authenticated, service_role;

create or replace function private.quarantine_redundant_frozen_v0_connected_controls(
  p_limit integer default 100
)
returns table (scanned integer, quarantined integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_candidate record;
  v_inbox public.whatsapp_webhook_inbox%rowtype;
  v_session public.whatsapp_sessions%rowtype;
  v_phone text;
  v_at timestamptz;
  v_updated integer;
begin
  if p_limit is null or p_limit < 0 or p_limit > 100 then
    raise exception using errcode='22023',
      message='redundant_frozen_v0_connected_limit_invalid';
  end if;
  scanned := 0;
  quarantined := 0;
  for v_candidate in
    select inbox.id, inbox.organization_id, inbox.session_id
    from public.whatsapp_webhook_inbox as inbox
    join public.whatsapp_sessions as session
      on session.id = inbox.session_id
     and session.organization_id = inbox.organization_id
    where inbox.status in ('pending','retry')
      and inbox.processing_lane = 'backlog'
      and inbox.provider = 'evolution_go'
      and inbox.event_type = 'connected'
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
      and inbox.payload #> '{__vimob_ingress,routing_snapshot}' is null
      and session.status = 'connected' and session.is_active = true
      and session.last_error is null
      and session.profile_name = inbox.payload #>> '{data,pushName}'
      and pg_catalog.regexp_replace(
        coalesce(session.phone_number,''), '[^0-9]', '', 'g'
      ) = pg_catalog.regexp_replace(
        split_part(split_part(inbox.payload #>> '{data,jid}','@',1),':',1),
        '[^0-9]', '', 'g'
      )
      and pg_catalog.length(pg_catalog.regexp_replace(
        coalesce(session.phone_number,''), '[^0-9]', '', 'g'
      )) >= 8
    order by inbox.next_attempt_at, inbox.created_at, inbox.id
    limit p_limit
  loop
    scanned := scanned + 1;
    select session.* into v_session
    from public.whatsapp_sessions as session
    where session.id = v_candidate.session_id
      and session.organization_id = v_candidate.organization_id
      and session.provider = 'evolution_go'
      and session.is_active = true
      and session.status = 'connected'
    for share of session skip locked;
    if not found then continue; end if;

    select inbox.* into v_inbox
    from public.whatsapp_webhook_inbox as inbox
    where inbox.id = v_candidate.id
      and inbox.organization_id = v_candidate.organization_id
      and inbox.session_id = v_candidate.session_id
      and inbox.provider = 'evolution_go'
      and inbox.event_type = 'connected'
      and inbox.processing_lane = 'backlog'
      and inbox.status in ('pending','retry')
      and inbox.created_at < pg_catalog.now() - interval '1 hour'
      and inbox.locked_at is null and inbox.locked_by is null
    for update of inbox skip locked;
    if not found or private.is_deleted_session_v0_control(
      'connected', v_inbox.payload
    ) is distinct from true or split_part(v_inbox.payload #>> '{data,jid}','@',2)
       is distinct from 's.whatsapp.net'
       or not private.is_frozen_legacy_whatsapp_ingress(
         v_inbox.id,v_inbox.organization_id,v_inbox.session_id,
         v_inbox.event_key,v_inbox.processing_lane
       ) or exists (
         select 1 from public.whatsapp_webhook_routing_snapshots as route
         where route.organization_id=v_inbox.organization_id
           and route.session_id=v_inbox.session_id
           and route.inbox_event_key=v_inbox.event_key
       ) or exists (
         select 1 from private.whatsapp_redundant_frozen_v0_connected_quarantine as audit
         where audit.inbox_id=v_inbox.id
       ) then
      continue;
    end if;
    v_phone := pg_catalog.regexp_replace(
      split_part(split_part(v_inbox.payload #>> '{data,jid}','@',1),':',1),
      '[^0-9]', '', 'g'
    );
    if v_session.status is distinct from 'connected'
       or v_session.last_error is not null
       or v_session.profile_name is distinct from v_inbox.payload #>> '{data,pushName}'
       or pg_catalog.length(v_phone) < 8
       or pg_catalog.regexp_replace(
         coalesce(v_session.phone_number,''), '[^0-9]', '', 'g'
       ) is distinct from v_phone then
      continue;
    end if;

    v_at := pg_catalog.clock_timestamp();
    insert into private.whatsapp_redundant_frozen_v0_connected_quarantine (
      inbox_id,organization_id,session_id,event_key,original_status,
      original_attempts,payload_sha256,original_expires_at,
      quarantined_at,retained_until
    ) values (
      v_inbox.id,v_inbox.organization_id,v_inbox.session_id,v_inbox.event_key,
      v_inbox.status,v_inbox.attempts,
      private.canonical_jsonb_sha256(v_inbox.payload),v_inbox.expires_at,
      v_at,'infinity'::timestamptz
    );
    update public.whatsapp_webhook_inbox as inbox
    set status='dead',dead_lettered_at=v_at,
        expires_at='infinity'::timestamptz,updated_at=v_at
    where inbox.id=v_inbox.id
      and inbox.status=v_inbox.status
      and inbox.attempts=v_inbox.attempts
      and inbox.updated_at=v_inbox.updated_at
      and inbox.payload=v_inbox.payload;
    get diagnostics v_updated=row_count;
    if v_updated<>1 then
      raise exception using errcode='40001',
        message='redundant_frozen_v0_connected_compare_and_swap_failed';
    end if;
    quarantined := quarantined+1;
  end loop;
  return next;
end;
$function$;
revoke all on function private.quarantine_redundant_frozen_v0_connected_controls(integer)
  from public, anon, authenticated, service_role;
grant usage on schema private to service_role;
grant execute on function private.quarantine_redundant_frozen_v0_connected_controls(integer)
  to service_role;

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
       or private.is_authorized_frozen_buttonclick_quarantine(old, new)
       or private.is_authorized_frozen_deleted_session_v0_control_quarantine(old, new)
       or private.is_authorized_frozen_redundant_v0_connected_quarantine(old, new) then
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
  'Preserves frozen pre-v1 ingress; only exact audit-backed receipt, message, unroutable ButtonClick and deleted-session and redundant connected v0 control status transitions may leave the active queue.';



do $readback$
begin
  if not exists (
    select 1 from private.quarantine_redundant_frozen_v0_connected_controls(0)
    where scanned=0 and quarantined=0
  ) or pg_catalog.has_table_privilege('service_role',
    'private.whatsapp_redundant_frozen_v0_connected_quarantine','SELECT')
  or pg_catalog.has_function_privilege('anon',
    'private.quarantine_redundant_frozen_v0_connected_controls(integer)','EXECUTE')
  or pg_catalog.has_function_privilege('authenticated',
    'private.quarantine_redundant_frozen_v0_connected_controls(integer)','EXECUTE')
  or not pg_catalog.has_function_privilege('service_role',
    'private.quarantine_redundant_frozen_v0_connected_controls(integer)','EXECUTE') then
    raise exception 'redundant_frozen_v0_connected_readback_failed';
  end if;
end;
$readback$;

commit;
