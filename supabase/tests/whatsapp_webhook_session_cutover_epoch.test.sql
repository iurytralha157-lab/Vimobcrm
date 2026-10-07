begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000',
   'e1100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated',
   'wa-cutover-a@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000',
   'e1100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated',
   'wa-cutover-b@example.test', '', now(), '{}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, is_active) values
  ('e1200000-0000-4000-8000-000000000001', 'WA Cutover Org A', 'wa-cutover-org-a', true),
  ('e1200000-0000-4000-8000-000000000002', 'WA Cutover Org B', 'wa-cutover-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active) values
  ('e1100000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001', 'Cutover A', 'wa-cutover-a@example.test', 'admin', true),
  ('e1100000-0000-4000-8000-000000000002',
   'e1200000-0000-4000-8000-000000000002', 'Cutover B', 'wa-cutover-b@example.test', 'admin', true)
on conflict (id) do update set
  organization_id = excluded.organization_id,
  name = excluded.name,
  email = excluded.email,
  role = excluded.role,
  is_active = excluded.is_active;

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values
  ('e1500000-0000-4000-8000-000000000001',
   'e1200000-0000-4000-8000-000000000001',
   'e1100000-0000-4000-8000-000000000001', 'cutover-a', 'evolution_go', 'connected', true),
  ('e1500000-0000-4000-8000-000000000002',
   'e1200000-0000-4000-8000-000000000002',
   'e1100000-0000-4000-8000-000000000002', 'cutover-b', 'evolution_go', 'connected', true);

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values (
  'e1400000-0000-4000-8000-000000000001',
  'e1200000-0000-4000-8000-000000000001',
  'e1100000-0000-4000-8000-000000000001',
  'Cutover Lead', '5511999990101', 'whatsapp'
);

select throws_ok(
  $$select private.capture_whatsapp_webhook_routing_snapshot_v2(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'cutover-too-early', 'cutover-too-early', 'live', 'phone:5511999990101',
    true, array['5511999990101@s.whatsapp.net'], '5511999990101',
    'organic', null, false, false, false, null, null, null, 1
  )$$,
  '23514', 'whatsapp_ingress_epoch_not_active',
  'epoch one cannot be captured before activation'
);

with old_snapshot as (
  select private.capture_whatsapp_webhook_routing_snapshot_v2(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'cutover-provider-old', 'cutover-event-old', 'live', 'phone:5511999990101',
    true, array['5511999990101@s.whatsapp.net'], '5511999990101',
    'organic', null, false, false, false, null, null, null, 0
  ) as snapshot
)
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, status, attempts, next_attempt_at
)
select
  'e1200000-0000-4000-8000-000000000001',
  'e1500000-0000-4000-8000-000000000001',
  'cutover-event-old', 'message',
  jsonb_build_object('__vimob_ingress', jsonb_build_object(
    'routing_key', 'phone:5511999990101',
    'routing_snapshot', jsonb_build_object('version', 1, 'messages', jsonb_build_array(snapshot))
  )),
  'live', 'pending', 0, now() - interval '1 minute'
from old_snapshot;

select is(
  (select processing_epoch from public.whatsapp_webhook_inbox
   where event_key = 'cutover-event-old'),
  0, 'legacy inbox rows default to epoch zero'
);

select is(
  (select processing_epoch from public.whatsapp_webhook_routing_snapshots
   where session_id = 'e1500000-0000-4000-8000-000000000001'
     and provider_message_id = 'cutover-provider-old'),
  0, 'the old immutable route is epoch zero'
);

select throws_ok(
  $$select private.activate_whatsapp_webhook_session_cutover(
    'e1200000-0000-4000-8000-000000000002',
    'e1500000-0000-4000-8000-000000000001'
  )$$,
  '23503', 'whatsapp_cutover_session_not_found',
  'one organization cannot activate another organization session'
);

update public.whatsapp_webhook_inbox
set status = 'processing', locked_at = now(), locked_by = 'cutover-test'
where event_key = 'cutover-event-old';

select throws_ok(
  $$select private.activate_whatsapp_webhook_session_cutover(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001'
  )$$,
  '55000', 'whatsapp_cutover_legacy_inflight',
  'activation refuses an epoch-zero execution already in flight'
);

select is(
  (select status from public.whatsapp_webhook_inbox where event_key = 'cutover-event-old'),
  'processing', 'failed activation leaves the in-flight event unchanged'
);

update public.whatsapp_webhook_inbox
set status = 'pending', locked_at = null, locked_by = null
where event_key = 'cutover-event-old';

select lives_ok(
  $$select private.activate_whatsapp_webhook_session_cutover(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001'
  )$$,
  'activation succeeds after the old execution is no longer active'
);

select is(
  (select active_epoch from private.whatsapp_webhook_session_cutovers
   where session_id = 'e1500000-0000-4000-8000-000000000001'),
  1, 'the cutover is stored for this session only'
);

select throws_ok(
  $$select private.capture_whatsapp_webhook_routing_snapshot(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'cutover-provider-new', 'cutover-event-new', 'live', 'phone:5511999990101',
    true, array['5511999990101@s.whatsapp.net'], '5511999990101',
    'organic', null, false, false, false, null, null, null
  )$$,
  '55000', 'whatsapp_snapshot_epoch_inactive',
  'legacy capture cannot persist an epoch-zero snapshot after activation'
);

with new_snapshot as (
  select private.capture_whatsapp_webhook_routing_snapshot_v2(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'cutover-provider-new', 'cutover-event-new', 'live', 'phone:5511999990101',
    true, array['5511999990101@s.whatsapp.net'], '5511999990101',
    'organic', null, false, false, false, null, null, null, 1
  ) as snapshot
)
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  processing_lane, processing_epoch, status, attempts, next_attempt_at
)
select
  'e1200000-0000-4000-8000-000000000001',
  'e1500000-0000-4000-8000-000000000001',
  'cutover-event-new', 'message',
  jsonb_build_object('__vimob_ingress', jsonb_build_object(
    'routing_key', 'phone:5511999990101',
    'routing_snapshot', jsonb_build_object('version', 1, 'messages', jsonb_build_array(snapshot))
  )),
  'live', 1, 'pending', 0, now() - interval '1 minute'
from new_snapshot;

select is(
  (select processing_epoch from public.whatsapp_webhook_routing_snapshots
   where session_id = 'e1500000-0000-4000-8000-000000000001'
     and provider_message_id = 'cutover-provider-new'),
  1, 'the new immutable route is epoch one'
);

select ok(
  (select predecessor_provider_message_id from public.whatsapp_webhook_routing_snapshots
   where session_id = 'e1500000-0000-4000-8000-000000000001'
     and provider_message_id = 'cutover-provider-new') is null,
  'the old same-route message is not the new predecessor'
);

select throws_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', locked_at = now(), locked_by = 'cutover-test'
    where event_key = 'cutover-event-old'$$,
  '55000', 'whatsapp_inbox_epoch_retained',
  'an old worker cannot claim the retained event after activation'
);

select is(
  (select attempts from public.whatsapp_webhook_inbox where event_key = 'cutover-event-old'),
  0, 'failed legacy claim leaves the old attempt counter unchanged'
);

select throws_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', locked_at = now(), locked_by = 'vimob-api-evolution-webhook-old'
    where event_key = 'cutover-event-new'$$,
  '55000', 'whatsapp_inbox_epoch_legacy_worker',
  'a worker from the previous release cannot claim a new epoch event'
);

select lives_ok(
  $$update public.whatsapp_webhook_inbox
    set status = 'processing', locked_at = now(), locked_by = 'vimob-api-evolution-webhook-epoch1-test'
    where event_key = 'cutover-event-new'$$,
  'a new same-route event is claimable while the old is pending'
);

select is(
  (select status from public.whatsapp_webhook_inbox where event_key = 'cutover-event-new'),
  'processing', 'only the new event was claimed'
);

select throws_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, event_key, event_type, payload,
      processing_lane, processing_epoch, status
    ) values (
      'e1200000-0000-4000-8000-000000000001',
      'e1500000-0000-4000-8000-000000000001',
      'cutover-legacy-fresh', 'message', '{}'::jsonb,
      'live', 0, 'pending'
    )$$,
  '55000', 'whatsapp_inbox_epoch_legacy_ingress',
  'a legacy replica cannot acknowledge a brand-new event into the held epoch'
);

select lives_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, event_key, event_type, payload,
      processing_lane, processing_epoch, status
    ) values (
      'e1200000-0000-4000-8000-000000000001',
      'e1500000-0000-4000-8000-000000000001',
      'cutover-capable-held', 'message',
      '{"__vimob_ingress":{"epoch_capable":true}}'::jsonb,
      'live', 0, 'pending'
    )$$,
  'an epoch-aware replica may retain a replayed old event'
);

select lives_ok(
  $$insert into public.whatsapp_webhook_inbox (
      organization_id, session_id, event_key, event_type, payload,
      processing_lane, processing_epoch, status
    ) values (
      'e1200000-0000-4000-8000-000000000001',
      'e1500000-0000-4000-8000-000000000001',
      'cutover-event-old', 'message', '{}'::jsonb,
      'live', 0, 'pending'
    ) on conflict (event_key) do nothing$$,
  'an old duplicate reaches ON CONFLICT without a trigger error'
);

select is(
  (select count(*)::integer from public.whatsapp_webhook_inbox
   where event_key = 'cutover-event-old'),
  1, 'the old duplicate did not create another inbox row'
);

select is(
  (select (private.capture_whatsapp_webhook_routing_snapshot_v2(
    'e1200000-0000-4000-8000-000000000001',
    'e1500000-0000-4000-8000-000000000001',
    'cutover-provider-old', 'cutover-event-old', 'live', 'phone:5511999990101',
    true, array['5511999990101@s.whatsapp.net'], '5511999990101',
    'organic', null, false, false, false, null, null, null, 1
  )->>'processing_epoch')::integer),
  0, 'provider replay returns the original epoch-zero snapshot'
);

select throws_ok(
  $$insert into private.whatsapp_webhook_ignored_events (
      organization_id, session_id, event_key, reason
    ) values (
      'e1200000-0000-4000-8000-000000000002',
      'e1500000-0000-4000-8000-000000000001',
      'ignored-cross-tenant', 'technical_receipt'
    )$$,
  '23503', 'whatsapp_ignored_event_session_mismatch',
  'ignored-event audit cannot cross organizations'
);

select lives_ok(
  $$insert into private.whatsapp_webhook_ignored_events (
      organization_id, session_id, event_key, reason
    ) values (
      'e1200000-0000-4000-8000-000000000001',
      'e1500000-0000-4000-8000-000000000001',
      'ignored-technical', 'technical_receipt'
    )$$,
  'technical discard keeps a payload-free audit record'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.activate_whatsapp_webhook_session_cutover(uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot activate a session cutover'
);

select ok(
  not has_table_privilege(
    'authenticated', 'private.whatsapp_webhook_ignored_events', 'SELECT'
  ),
  'authenticated callers cannot read technical-event audit rows'
);

select * from finish();
rollback;
