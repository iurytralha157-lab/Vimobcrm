begin;

create extension if not exists pgtap with schema extensions;
select plan(30);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000',
   'e3100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'wa-edge-fence-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   'e3100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'wa-edge-fence-b@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active) values
  ('e3200000-0000-4000-8000-000000000001', 'WA Edge Fence A', 'wa-edge-fence-a', true),
  ('e3200000-0000-4000-8000-000000000002', 'WA Edge Fence B', 'wa-edge-fence-b', true);

insert into public.users (id, organization_id, name, email, role, is_active) values
  ('e3100000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001', 'Fence A', 'wa-edge-fence-a@example.test', 'admin', true),
  ('e3100000-0000-4000-8000-000000000002',
   'e3200000-0000-4000-8000-000000000002', 'Fence B', 'wa-edge-fence-b@example.test', 'admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values
  ('e3500000-0000-4000-8000-000000000001',
   'e3200000-0000-4000-8000-000000000001',
   'e3100000-0000-4000-8000-000000000001', 'edge-fence-a', 'evolution_go', 'connected', true),
  ('e3500000-0000-4000-8000-000000000002',
   'e3200000-0000-4000-8000-000000000002',
   'e3100000-0000-4000-8000-000000000002', 'edge-fence-b', 'evolution_go', 'connected', true);

insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, attempts, locked_at, locked_by
) values (
  'e3600000-0000-4000-8000-000000000001',
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'wa-edge-fence-event-a', 'message',
  '{"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[]}}}'::jsonb,
  'live', 'processing', 1, now(), 'vimob-api-evolution-webhook-epoch1-test'
);

create temporary table edge_fence_test_token (id uuid not null) on commit drop;

select col_type_is('public', 'whatsapp_webhook_inbox', 'edge_execution_id', 'uuid',
  'the execution token lives on the durable inbox');
select col_type_is('public', 'whatsapp_webhook_inbox', 'edge_execution_state', 'text',
  'the execution state lives on the durable inbox');
select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.whatsapp_webhook_inbox'::regclass
    and conname = 'whatsapp_webhook_inbox_edge_execution_shape_check'
    and contype = 'c'
), 'the token state is constrained');
select ok(not has_function_privilege('anon',
  'public.reserve_whatsapp_webhook_edge_execution(uuid,uuid,uuid,text)', 'EXECUTE'),
  'anonymous callers cannot reserve the Edge execution');
select ok(not has_function_privilege('authenticated',
  'public.start_whatsapp_webhook_edge_execution(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'CRM users cannot begin the Edge execution');
select ok(has_function_privilege('service_role',
  'public.finish_whatsapp_webhook_edge_execution(uuid,uuid,uuid,uuid)', 'EXECUTE'),
  'the authenticated server worker can finish the execution');

select ok(public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001', 'wrong-worker') is null,
  'a non-worker cannot reserve a claimed inbox row');
select ok(public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000002',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'vimob-api-evolution-webhook-epoch1-test') is null,
  'another organization cannot reserve this session');

insert into edge_fence_test_token (id)
select public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'vimob-api-evolution-webhook-epoch1-test');
select ok((select id from edge_fence_test_token) is not null,
  'Go reserves a unique token before HTTP');
select is((select edge_execution_state from public.whatsapp_webhook_inbox
  where id = 'e3600000-0000-4000-8000-000000000001'), 'reserved',
  'reservation is durable');
select ok(public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'vimob-api-evolution-webhook-epoch1-test') is null,
  'one inbox cannot receive a second concurrent reservation');
select ok(not public.start_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000002',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'cross-organization Edge start fails closed');
select ok(not public.cancel_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'e3700000-0000-4000-8000-000000000001'),
  'a wrong token cannot cancel a reservation');

update public.whatsapp_webhook_inbox
set status = 'retry', locked_at = null, locked_by = null
where id = 'e3600000-0000-4000-8000-000000000001';
select throws_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_cutover_edge_execution_inflight',
  'a reserved token blocks cutover even after Go sets retry');
select ok(public.cancel_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'Go cancels only the still-reserved execution after timeout');
select ok(not public.start_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'a late Edge request cannot start after cancellation');
select throws_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_cutover_legacy_pending',
  'an old retry must drain before cutover');

update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = now(),
    locked_by = 'vimob-api-evolution-webhook-epoch1-test'
where id = 'e3600000-0000-4000-8000-000000000001';
truncate edge_fence_test_token;
insert into edge_fence_test_token (id)
select public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'vimob-api-evolution-webhook-epoch1-test');
select ok(public.start_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'Edge begins only the current reservation');
select is((select edge_execution_state from public.whatsapp_webhook_inbox
  where id = 'e3600000-0000-4000-8000-000000000001'), 'active',
  'the active invocation is durably distinguished from reserved');
select ok(not public.cancel_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'Go timeout cannot cancel Edge after it began');

update public.whatsapp_webhook_inbox
set status = 'dead', locked_at = null, locked_by = null
where id = 'e3600000-0000-4000-8000-000000000001';
select throws_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_cutover_edge_execution_inflight',
  'active Edge execution blocks cutover even after the inbox is dead');
select ok(public.finish_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'Edge releases its token after all effects finish');
select ok((select edge_execution_id is null and edge_execution_state is null
  and edge_execution_reserved_at is null and edge_execution_started_at is null
  from public.whatsapp_webhook_inbox
  where id = 'e3600000-0000-4000-8000-000000000001'),
  'finish clears every execution field');
select ok(not public.finish_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'a stale finish cannot affect another attempt');

update public.whatsapp_webhook_inbox set status = 'pending'
where id = 'e3600000-0000-4000-8000-000000000001';
select throws_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_cutover_legacy_pending',
  'an old pending row also blocks cutover');
update public.whatsapp_webhook_inbox set status = 'processed'
where id = 'e3600000-0000-4000-8000-000000000001';
select lives_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  'activation succeeds only when legacy work is terminal and unfenced');
select ok(public.reserve_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  'vimob-api-evolution-webhook-epoch1-test') is null,
  'a cutover session cannot reserve any new Edge execution');
select ok(not public.start_whatsapp_webhook_edge_execution(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001',
  'e3600000-0000-4000-8000-000000000001',
  (select id from edge_fence_test_token)),
  'a delayed Edge start cannot run after cutover');

-- Simulate a corrupted/manual state to ensure idempotent reentry cannot hide
-- an orphan execution on a terminal epoch-zero row.
update public.whatsapp_webhook_inbox
set edge_execution_id = 'e3700000-0000-4000-8000-000000000002',
    edge_execution_state = 'active',
    edge_execution_reserved_at = now(),
    edge_execution_started_at = now()
where id = 'e3600000-0000-4000-8000-000000000001';
select throws_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  '55000', 'whatsapp_cutover_edge_execution_inflight',
  'idempotent cutover refuses an orphan token on a terminal row');
update public.whatsapp_webhook_inbox
set edge_execution_id = null, edge_execution_state = null,
    edge_execution_reserved_at = null, edge_execution_started_at = null
where id = 'e3600000-0000-4000-8000-000000000001';
select lives_ok($$select private.activate_whatsapp_webhook_session_cutover(
  'e3200000-0000-4000-8000-000000000001',
  'e3500000-0000-4000-8000-000000000001')$$,
  'idempotent cutover succeeds only after the inconsistent token is resolved');

select * from finish();
rollback;
