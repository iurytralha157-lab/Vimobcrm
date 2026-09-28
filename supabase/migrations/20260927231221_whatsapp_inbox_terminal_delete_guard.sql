-- Guard against an older API process still running the broad inbox DELETE
-- while the bounded nonlead-control cleanup is rolled out. The new API does
-- not DELETE inbox rows at all; the cron calls the private gated function.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('private.whatsapp_legacy_is_nonlead_control(text,jsonb)') is null
     or pg_catalog.to_regprocedure('private.whatsapp_nonlead_retention_payload_safe(text,jsonb)') is null
     or pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null then
    raise exception 'whatsapp_inbox_terminal_delete_guard_prerequisites_missing';
  end if;
end;
$preflight$;

create or replace function private.guard_whatsapp_inbox_terminal_retention_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  -- An explicit organization/session deletion already removes its related
  -- lead data by FK cascade. Its nested inbox cascade is outside retention.
  -- A different nested trigger cannot bypass while both parents still exist.
  if pg_catalog.pg_trigger_depth() > 1
     and (
       not exists (
         select 1 from public.organizations as org
         where org.id = old.organization_id
       )
       or not exists (
         select 1 from public.whatsapp_sessions as session
         where session.id = old.session_id
       )
     ) then
    return old;
  end if;

  -- Live delivery work and unknown states cannot be deleted through the
  -- retention path. Only an old pending QR is ephemeral before terminality.
  if old.status not in ('pending', 'retry', 'processed', 'dead')
     or old.created_at is null
     or (old.status in ('pending', 'retry') and (
       old.event_type is distinct from 'qrcode'
       or old.created_at >= pg_catalog.now() - interval '2 minutes'
     ))
     or (old.status in ('processed', 'dead') and (
       old.created_at >= pg_catalog.now() - interval '7 days'
       or (old.status = 'processed' and (
         old.processed_at is null
         or old.processed_at >= pg_catalog.now() - interval '7 days'
       ))
       or (old.status = 'dead' and (
         old.dead_lettered_at is null
         or old.dead_lettered_at >= pg_catalog.now() - interval '7 days'
       ))
     ))
     or private.whatsapp_legacy_is_nonlead_control(old.event_type, old.payload) is distinct from true
     or private.whatsapp_nonlead_retention_payload_safe(old.event_type, old.payload) is distinct from true
     or exists (
       select 1
       from private.whatsapp_webhook_legacy_routing_freeze as frozen
       where frozen.inbox_id = old.id
     ) then
    raise exception using
      errcode = '55000',
      message = 'whatsapp_inbox_terminal_delete_requires_nonlead_control_proof',
      hint = 'Old broad-retention workers must be stopped; only seven-day nonlead controls can expire.';
  end if;
  return old;
end;
$function$;

alter function private.guard_whatsapp_inbox_terminal_retention_delete()
  owner to postgres;
revoke all on function private.guard_whatsapp_inbox_terminal_retention_delete()
  from public, anon, authenticated, service_role;

drop trigger if exists guard_whatsapp_inbox_terminal_retention_delete
  on public.whatsapp_webhook_inbox;
create trigger guard_whatsapp_inbox_terminal_retention_delete
before delete on public.whatsapp_webhook_inbox
for each row execute function private.guard_whatsapp_inbox_terminal_retention_delete();

-- The baseline grants ALL on inbox to service_role. TRUNCATE does not fire a
-- row-level DELETE trigger, so remove that privilege from API-facing roles.
-- The postgres table owner remains an administrative exception.
revoke truncate on table public.whatsapp_webhook_inbox
  from public, anon, authenticated, service_role;

do $readback$
begin
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'public.whatsapp_webhook_inbox'::regclass
      and tgname = 'guard_whatsapp_inbox_terminal_retention_delete'
      and not tgisinternal
      and tgenabled in ('O', 'A')
  ) or pg_catalog.has_table_privilege(
    'service_role', 'public.whatsapp_webhook_inbox', 'TRUNCATE'
  ) then
    raise exception 'whatsapp_inbox_terminal_delete_guard_not_enabled';
  end if;
end;
$readback$;

commit;
