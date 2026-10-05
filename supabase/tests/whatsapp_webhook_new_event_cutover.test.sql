begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'e6100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
  'wa-cutover-test@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values ('e6200000-0000-4000-8000-000000000001', 'WA Cutover Test', 'wa-cutover-test', true);
-- The auth.users trigger already creates public.users.
update public.users
set organization_id = 'e6200000-0000-4000-8000-000000000001',
    name = 'WA Cutover Test', role = 'admin', is_active = true
where id = 'e6100000-0000-4000-8000-000000000001';
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'e6500000-0000-4000-8000-000000000001',
  'e6200000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cutover-test', 'evolution_go', 'connected', true
);

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, provider, event_key, event_type, payload,
  processing_lane, status, attempts, next_attempt_at, created_at
) values (
  'e6200000-0000-4000-8000-000000000001',
  'e6500000-0000-4000-8000-000000000001',
  'evolution_go', 'cutover-old-event', 'message',
  '{"__vimob_ingress":{"routing_key":"phone:old","routing_snapshot":{"version":1,"messages":[]}}}',
  'live', 'pending', 0, now() - interval '1 minute', now() - interval '1 day'
);

update public.whatsapp_webhook_inbox
set status = 'processing', locked_by = 'vimob-api-evolution-webhook-legacy', locked_at = now()
where event_key = 'cutover-old-event';

select throws_ok(
  $$select private.activate_whatsapp_webhook_session_cutover(
    'e6500000-0000-4000-8000-000000000001'
  )$$,
  '55000', 'whatsapp_cutover_has_inflight_webhooks',
  'activation refuses a processing event'
);
select is(
  (select status from public.whatsapp_webhook_inbox where event_key = 'cutover-old-event'),
  'processing', 'failed activation leaves the old event untouched'
);
update public.whatsapp_webhook_inbox
set status = 'pending', locked_by = null, locked_at = null
where event_key = 'cutover-old-event';

select lives_ok(
  $$select private.activate_whatsapp_webhook_session_cutover(
    'e6500000-0000-4000-8000-000000000001'
  )$$,
  'an idle session can activate without changing its queued events'
);
select is(
  (select status from public.whatsapp_webhook_inbox where event_key = 'cutover-old-event'),
  'pending', 'activation does not mark old messages or change their status'
);
select is(
  (select attempts from public.whatsapp_webhook_inbox where event_key = 'cutover-old-event'),
  0, 'activation does not increment old attempts'
);

select throws_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', attempts = attempts + 1,
        locked_by = 'vimob-api-evolution-webhook-cutover1-test'
    where event_key = 'cutover-old-event'$$,
  '55000', 'whatsapp_webhook_before_cutover',
  'even the new worker cannot claim an old event'
);
select throws_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, provider, event_key, event_type, payload,
      processing_lane, status, next_attempt_at, created_at
    ) values (
      'e6200000-0000-4000-8000-000000000001',
      'e6500000-0000-4000-8000-000000000001',
      'evolution_go', 'cutover-legacy-new-event', 'message',
      '{"__vimob_ingress":{"routing_key":"phone:new","routing_snapshot":{"version":1,"messages":[]}}}',
      'live', 'pending', now(), clock_timestamp()
    )$$,
  '55000', 'whatsapp_webhook_legacy_ingress_after_cutover',
  'an old ingress cannot acknowledge a new event into the retained backlog'
);
select lives_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, provider, event_key, event_type, payload,
      processing_lane, status, next_attempt_at, created_at
    ) values (
      'e6200000-0000-4000-8000-000000000001',
      'e6500000-0000-4000-8000-000000000001',
      'evolution_go', 'cutover-new-event', 'message',
      jsonb_build_object('__vimob_ingress', jsonb_build_object(
        'routing_key', 'epoch:new',
        'cutover_epoch', (select routing_epoch::text from private.whatsapp_webhook_session_cutovers
          where session_id = 'e6500000-0000-4000-8000-000000000001'),
        'routing_snapshot', jsonb_build_object('version', 1, 'messages', '[]'::jsonb)
      )),
      'live', 'pending', now(), clock_timestamp()
    )$$,
  'the new ingress records a marked event'
);
select throws_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', attempts = attempts + 1,
        locked_by = 'vimob-api-evolution-webhook-legacy'
    where event_key = 'cutover-new-event'$$,
  '55000', 'whatsapp_webhook_legacy_worker_after_cutover',
  'the embedded claim SQL of an old worker cannot select a new event'
);
select is(
  (select attempts from public.whatsapp_webhook_inbox where event_key = 'cutover-new-event'),
  0, 'the rejected legacy claim does not spend an attempt'
);
select lives_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', attempts = attempts + 1,
        locked_by = 'vimob-api-evolution-webhook-cutover1-test', locked_at = now()
    where event_key = 'cutover-new-event'$$,
  'the new worker can claim the new event'
);
select is(
  (select attempts from public.whatsapp_webhook_inbox where event_key = 'cutover-new-event'),
  1, 'new claim spends exactly one attempt'
);
select is(
  (select attempts from public.whatsapp_webhook_inbox where event_key = 'cutover-old-event'),
  0, 'old event remains pending without attempts'
);
select lives_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, provider, event_key, event_type, payload,
      processing_lane, status, next_attempt_at, created_at
    ) values (
      'e6200000-0000-4000-8000-000000000001',
      'e6500000-0000-4000-8000-000000000001',
      'evolution_go', 'cutover-old-event', 'message', '{}'::jsonb,
      'live', 'pending', now(), clock_timestamp()
    ) on conflict (event_key) do nothing$$,
  'an old provider delivery may still find its existing event key'
);
select is(
  (select count(*)::integer from public.whatsapp_webhook_inbox
   where event_key = 'cutover-old-event'),
  1, 'an old duplicate does not create a second event'
);

select * from finish();
rollback;
