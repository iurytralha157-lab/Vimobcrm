-- Run only on an isolated, fully migrated PostgreSQL test database as postgres.
-- This fixture writes two synthetic tenants inside one transaction and always
-- rolls back. It must never be run against production.
begin;
set local statement_timeout = '30s';

do $privileges$
begin
  if pg_catalog.has_table_privilege(
    'service_role', 'public.whatsapp_webhook_inbox', 'TRUNCATE'
  ) then
    raise exception 'service_role_can_truncate_whatsapp_inbox';
  end if;
end;
$privileges$;

create temp table wa_retention_fixture_context (prefix text not null) on commit drop;
create temp table wa_retention_nested_probe (id integer not null) on commit drop;

create function pg_temp.wa_retention_nested_delete_probe()
returns trigger language plpgsql as $probe$
begin
  delete from public.whatsapp_webhook_inbox
  where event_key = (select prefix from pg_temp.wa_retention_fixture_context) || ':receipt';
  return new;
end;
$probe$;
create trigger wa_retention_nested_delete_probe
before insert on wa_retention_nested_probe
for each row execute function pg_temp.wa_retention_nested_delete_probe();

do $fixture$
declare
  v_prefix text := 'wa-retention-test-' || gen_random_uuid()::text;
  v_org_a uuid;
  v_org_b uuid;
  v_user_a uuid := gen_random_uuid();
  v_user_b uuid := gen_random_uuid();
  v_session_a uuid;
  v_session_b uuid;
  v_frozen_id uuid;
  v_deleted record;
  v_count integer;
begin
  insert into pg_temp.wa_retention_fixture_context values (v_prefix);
  insert into public.organizations (name, slug)
  values (v_prefix || '-a', v_prefix || '-a') returning id into v_org_a;
  insert into public.organizations (name, slug)
  values (v_prefix || '-b', v_prefix || '-b') returning id into v_org_b;
  insert into auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
    (v_user_a, 'authenticated', 'authenticated', v_prefix || '-a@example.invalid',
     '', now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    (v_user_b, 'authenticated', 'authenticated', v_prefix || '-b@example.invalid',
     '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
  insert into public.users (id, organization_id, name, email, role, is_active)
  values
    (v_user_a, v_org_a, 'Retention Test A', v_prefix || '-a@example.invalid', 'user', true),
    (v_user_b, v_org_b, 'Retention Test B', v_prefix || '-b@example.invalid', 'user', true);
  insert into public.whatsapp_sessions (
    organization_id, owner_user_id, instance_name, provider, status
  ) values (v_org_a, v_user_a, v_prefix || '-a', 'evolution_go', 'disconnected')
  returning id into v_session_a;
  insert into public.whatsapp_sessions (
    organization_id, owner_user_id, instance_name, provider, status
  ) values (v_org_b, v_user_b, v_prefix || '-b', 'evolution_go', 'disconnected')
  returning id into v_session_b;

  -- Tenant A: one stale QR and one processed connection are safe.
  insert into public.whatsapp_webhook_inbox (
    organization_id, session_id, event_key, event_type, payload,
    status, created_at, processed_at, processing_lane
  ) values
    (v_org_a, v_session_a, v_prefix || ':stale-qr', 'qrcode',
     '{"event":"qrcode","data":{"qrcode":"synthetic"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
     'pending', now() - interval '10 minutes', null, 'backlog'),
    (v_org_a, v_session_a, v_prefix || ':processed-connection', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected"}}'::jsonb,
     'processed', now() - interval '10 days', now() - interval '9 days', 'backlog');

  -- Tenant B: one processed QR and one dead connection are safe.
  insert into public.whatsapp_webhook_inbox (
    organization_id, session_id, event_key, event_type, payload,
    status, created_at, processed_at, dead_lettered_at, processing_lane
  ) values
    (v_org_b, v_session_b, v_prefix || ':processed-qr', 'qrcode.updated',
     '{"event":"qrcode.updated","data":{"qrcode":"synthetic"}}'::jsonb,
     'processed', now() - interval '10 days', now() - interval '9 days', null, 'backlog'),
    (v_org_b, v_session_b, v_prefix || ':dead-connection', 'connection.update',
     '{"event":"connection.update","data":{"state":"disconnected"}}'::jsonb,
     'dead', now() - interval '10 days', null, now() - interval '9 days', 'backlog');

  -- Keep lead-shaped controls, receipts, active work and a frozen row.
  insert into public.whatsapp_webhook_inbox (
    organization_id, session_id, event_key, event_type, payload,
    status, created_at, processed_at, dead_lettered_at, processing_lane,
    locked_at, locked_by
  ) values
    (v_org_a, v_session_a, v_prefix || ':lead-like', 'connection.update',
     '{"event":"connection.update","data":{"state":"connected","text":"synthetic lead message","phone":"000"}}'::jsonb,
     'processed', now() - interval '10 days', now() - interval '9 days', null, 'backlog', null, null),
    (v_org_b, v_session_b, v_prefix || ':receipt', 'messages.update',
     '{"event":"messages.update","data":{"status":"delivered"}}'::jsonb,
     'dead', now() - interval '10 days', null, now() - interval '9 days', 'backlog', null, null),
    (v_org_a, v_session_a, v_prefix || ':pending-receipt', 'messages.update',
     '{"event":"messages.update","data":{"status":"delivered"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
     'pending', now() - interval '10 minutes', null, null, 'backlog', null, null),
    (v_org_b, v_session_b, v_prefix || ':processing-qr', 'qrcode',
     '{"event":"qrcode","data":{"qrcode":"synthetic"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
     'processing', now() - interval '10 minutes', null, null, 'backlog', now() - interval '1 minute', 'fixture'),
    (v_org_b, v_session_b, v_prefix || ':fresh-qr', 'qrcode',
     '{"event":"qrcode","data":{"qrcode":"synthetic"},"__vimob_ingress":{"routing_key":"__session__","routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
     'pending', now(), null, null, 'backlog', null, null);

  insert into public.whatsapp_webhook_inbox (
    organization_id, session_id, event_key, event_type, payload,
    status, created_at, processed_at, processing_lane
  ) values (
    v_org_a, v_session_a, v_prefix || ':frozen', 'connection.update',
    '{"event":"connection.update","data":{"state":"connected"}}'::jsonb,
    'processed', now() - interval '10 days', now() - interval '9 days', 'backlog'
  ) returning id into v_frozen_id;
  insert into private.whatsapp_webhook_legacy_routing_freeze (
    inbox_id, organization_id, session_id, event_key, processing_lane,
    original_status, prepared_release_sha
  ) values (
    v_frozen_id, v_org_a, v_session_a, v_prefix || ':frozen', 'backlog',
    'pending', repeat('a', 40)
  );

  -- A direct DELETE or one nested in another trigger cannot bypass the guard
  -- while both parent tenant/session rows still exist.
  begin
    delete from public.whatsapp_webhook_inbox where event_key = v_prefix || ':lead-like';
    raise exception 'lead-like direct DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.whatsapp_webhook_inbox where event_key = v_prefix || ':pending-receipt';
    raise exception 'pending receipt direct DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.whatsapp_webhook_inbox where event_key = v_prefix || ':processing-qr';
    raise exception 'processing QR direct DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.whatsapp_webhook_inbox where event_key = v_prefix || ':fresh-qr';
    raise exception 'fresh QR direct DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    delete from public.whatsapp_webhook_inbox where event_key = v_prefix || ':frozen';
    raise exception 'frozen direct DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;
  begin
    insert into pg_temp.wa_retention_nested_probe values (1);
    raise exception 'nested receipt DELETE unexpectedly succeeded';
  exception when sqlstate '55000' then null;
  end;

  -- Simulate the legacy pg_cron command still invoking the public wrapper
  -- immediately after the migration. It must leave even eligible controls
  -- untouched until the private cleanup is explicitly called.
  perform public.cleanup_whatsapp_retention();
  select count(*) into v_count
  from public.whatsapp_webhook_inbox
  where event_key like v_prefix || ':%';
  if v_count <> 10 or (
    select count(*)
    from public.whatsapp_webhook_inbox
    where event_key in (
      v_prefix || ':stale-qr', v_prefix || ':processed-connection',
      v_prefix || ':processed-qr', v_prefix || ':dead-connection'
    )
  ) <> 4 then
    raise exception 'legacy public retention wrapper deleted fixture rows';
  end if;

  select * into v_deleted
  from private.cleanup_whatsapp_nonlead_control_retention(500);
  if (v_deleted.stale_qrcode, v_deleted.processed_control, v_deleted.dead_control)
     is distinct from (1, 2, 1) then
    raise exception 'first cleanup changed unexpected classes: %, %, %',
      v_deleted.stale_qrcode, v_deleted.processed_control, v_deleted.dead_control;
  end if;
  select count(*) into v_count
  from public.whatsapp_webhook_inbox
  where event_key like v_prefix || ':%';
  if v_count <> 6 then
    raise exception 'retention removed protected inbox rows: remaining %', v_count;
  end if;
  if exists (
    select 1 from public.whatsapp_webhook_inbox
    where event_key in (
      v_prefix || ':stale-qr', v_prefix || ':processed-connection',
      v_prefix || ':processed-qr', v_prefix || ':dead-connection'
    )
  ) or not exists (
    select 1 from public.whatsapp_webhook_inbox where id = v_frozen_id
  ) then
    raise exception 'retention eligibility or frozen preservation mismatch';
  end if;
  select * into v_deleted
  from private.cleanup_whatsapp_nonlead_control_retention(500);
  if (v_deleted.stale_qrcode, v_deleted.processed_control, v_deleted.dead_control)
     is distinct from (0, 0, 0) then
    raise exception 'second cleanup was not idempotent';
  end if;
end;
$fixture$;

rollback;
