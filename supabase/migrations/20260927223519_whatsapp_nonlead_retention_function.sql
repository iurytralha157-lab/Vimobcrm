-- Retain lead/message/receipt evidence. Only an exact QR/connection control
-- with a payload independently proven nonlead can expire after seven days.
-- Installation does not start a cron or perform any deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '2min';

do $preflight$
begin
  if pg_catalog.to_regclass('private.whatsapp_webhook_legacy_routing_freeze') is null
     or pg_catalog.to_regprocedure('private.whatsapp_legacy_is_nonlead_control(text,jsonb)') is null then
    raise exception 'whatsapp_nonlead_retention_prerequisites_missing';
  end if;
end;
$preflight$;

-- Independent strict envelope check for irreversible payload deletion. The
-- P0 classifier also requires a schema whitelist, but this gate deliberately
-- accepts an even smaller set of QR/connection payloads.
create or replace function private.whatsapp_nonlead_retention_payload_safe(
  p_event_type text,
  p_payload jsonb
)
returns boolean
language plpgsql
immutable
security invoker
set search_path = ''
as $function$
declare
  v_data jsonb;
  v_provider_payload jsonb;
  v_ingress jsonb;
  v_snapshot jsonb;
begin
  if pg_catalog.jsonb_typeof(p_payload) <> 'object' then
    return false;
  end if;
  v_provider_payload := p_payload;
  if p_payload ? '__vimob_ingress' then
    v_ingress := p_payload->'__vimob_ingress';
    v_snapshot := v_ingress->'routing_snapshot';
    if pg_catalog.jsonb_typeof(v_ingress) <> 'object'
       or pg_catalog.jsonb_typeof(v_snapshot) <> 'object'
       or v_ingress->>'routing_key' is distinct from '__session__'
       or v_snapshot->'version' is distinct from '1'::jsonb
       or v_snapshot->'messages' is distinct from '[]'::jsonb
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_ingress) as ingress_key(key)
         where ingress_key.key not in ('routing_key', 'routing_snapshot')
       )
       or exists (
         select 1 from pg_catalog.jsonb_object_keys(v_snapshot) as snapshot_key(key)
         where snapshot_key.key not in ('version', 'messages')
       ) then
      return false;
    end if;
    v_provider_payload := p_payload - '__vimob_ingress';
  end if;
  if v_provider_payload->>'event' is distinct from p_event_type
     or pg_catalog.jsonb_typeof(v_provider_payload->'data') <> 'object'
     or exists (
       select 1 from pg_catalog.jsonb_object_keys(v_provider_payload) as outer_key(key)
       where outer_key.key not in ('event', 'date_time', 'data')
     ) then
    return false;
  end if;
  v_data := v_provider_payload->'data';
  if p_event_type in ('qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE') then
    return not exists (
      select 1 from pg_catalog.jsonb_object_keys(v_data) as data_key(key)
      where data_key.key <> 'qrcode'
    ) and (
      not (v_data ? 'qrcode')
      or (pg_catalog.jsonb_typeof(v_data->'qrcode') = 'string'
          and pg_catalog.length(v_data->>'qrcode') <= 20000)
    );
  end if;
  return not exists (
      select 1 from pg_catalog.jsonb_object_keys(v_data) as data_key(key)
      where data_key.key <> 'state'
    )
    and pg_catalog.jsonb_typeof(v_data->'state') = 'string'
    and pg_catalog.lower(v_data->>'state') in (
      'open', 'connected', 'qr', 'qrcode', 'qr_ready', 'pairing',
      'connecting', 'close', 'closed', 'disconnected', 'offline',
      'logged_out', 'error', 'failed', 'failure'
    );
end;
$function$;

revoke all on function private.whatsapp_nonlead_retention_payload_safe(text,jsonb)
  from public, anon, authenticated, service_role;

create or replace function private.cleanup_whatsapp_nonlead_control_retention(
  p_limit integer default 500
)
returns table(stale_qrcode integer, processed_control integer, dead_control integer)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_stale_qrcode integer := 0;
  v_processed integer := 0;
  v_dead integer := 0;
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'whatsapp_nonlead_retention_invalid_limit';
  end if;

  -- A QR refresh is ephemeral transport state. Frozen pre-v1 rows are never
  -- touched, even if their payload happens to be an ordinary QR control.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.event_type = 'qrcode'
      and inbox.status in ('pending', 'retry')
      and inbox.created_at < pg_catalog.now() - interval '2 minutes'
      and private.whatsapp_legacy_is_nonlead_control(inbox.event_type, inbox.payload)
      and private.whatsapp_nonlead_retention_payload_safe(inbox.event_type, inbox.payload)
      and not exists (
        select 1
        from private.whatsapp_webhook_legacy_routing_freeze as frozen
        where frozen.inbox_id = inbox.id
      )
    order by inbox.created_at, inbox.id
    for update of inbox skip locked
    limit p_limit
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;
  get diagnostics v_stale_qrcode = row_count;

  -- The exact event spelling prefilter uses the narrow partial claim index.
  -- The recursive payload proof remains mandatory: a control-named event
  -- carrying a message, receipt, lead, contact, or unknown nested signal HOLDS.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'processed'
      and inbox.event_type in (
        'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
        'connection.update', 'CONNECTION_UPDATE',
        'connection.status', 'CONNECTION_STATUS',
        'instance.update', 'INSTANCE_UPDATE',
        'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
      )
      and inbox.created_at < pg_catalog.now() - interval '7 days'
      and inbox.processed_at < pg_catalog.now() - interval '7 days'
      and private.whatsapp_legacy_is_nonlead_control(inbox.event_type, inbox.payload)
      and private.whatsapp_nonlead_retention_payload_safe(inbox.event_type, inbox.payload)
      and not exists (
        select 1
        from private.whatsapp_webhook_legacy_routing_freeze as frozen
        where frozen.inbox_id = inbox.id
      )
    order by inbox.processed_at, inbox.id
    for update of inbox skip locked
    limit p_limit
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;
  get diagnostics v_processed = row_count;

  -- A failed control is discarded only seven days after both receipt and
  -- terminal failure. Message/receipt-shaped dead letters remain for audit.
  with candidates as (
    select inbox.id
    from public.whatsapp_webhook_inbox as inbox
    where inbox.status = 'dead'
      and inbox.event_type in (
        'qrcode.updated', 'QRCODE_UPDATED', 'qrcode', 'QRCODE',
        'connection.update', 'CONNECTION_UPDATE',
        'connection.status', 'CONNECTION_STATUS',
        'instance.update', 'INSTANCE_UPDATE',
        'connected', 'disconnected', 'logged.out', 'LOGGED_OUT'
      )
      and inbox.created_at < pg_catalog.now() - interval '7 days'
      and inbox.dead_lettered_at < pg_catalog.now() - interval '7 days'
      and private.whatsapp_legacy_is_nonlead_control(inbox.event_type, inbox.payload)
      and private.whatsapp_nonlead_retention_payload_safe(inbox.event_type, inbox.payload)
      and not exists (
        select 1
        from private.whatsapp_webhook_legacy_routing_freeze as frozen
        where frozen.inbox_id = inbox.id
      )
    order by inbox.dead_lettered_at, inbox.id
    for update of inbox skip locked
    limit p_limit
  )
  delete from public.whatsapp_webhook_inbox as inbox
  using candidates
  where inbox.id = candidates.id;
  get diagnostics v_dead = row_count;

  return query select v_stale_qrcode, v_processed, v_dead;
end;
$function$;

alter function private.cleanup_whatsapp_nonlead_control_retention(integer)
  owner to postgres;
revoke all on function private.cleanup_whatsapp_nonlead_control_retention(integer)
  from public, anon, authenticated, service_role;
comment on function private.cleanup_whatsapp_nonlead_control_retention(integer) is
  'Bounded, exact-payload cleanup of nonlead QR/connection inbox controls only. Frozen rows, messages, receipts and unknown events are preserved.';

-- A pre-existing whatsapp-retention-daily cron can still invoke this public
-- entry point as soon as the migration commits. Make it permanently inert:
-- only the separately reviewed private function and its explicit cron cutover
-- may delete proven nonlead controls. It must not clean other domains either.
create or replace function public.cleanup_whatsapp_retention()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  return;
end;
$function$;

alter function public.cleanup_whatsapp_retention() owner to postgres;
revoke all on function public.cleanup_whatsapp_retention()
  from public, anon, authenticated;
grant execute on function public.cleanup_whatsapp_retention()
  to service_role;
comment on function public.cleanup_whatsapp_retention() is
  'Inert compatibility wrapper for a legacy cron. Only the separately activated private nonlead-control retention function may delete rows.';

commit;
