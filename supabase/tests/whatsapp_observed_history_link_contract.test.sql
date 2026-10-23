begin;
create extension if not exists pgtap with schema extensions;
select plan(37);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'ca100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'observed-owner@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('ca200000-0000-4000-8000-000000000001',
        'WA Observation Org', 'wa-observation-org', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('ca100000-0000-4000-8000-000000000001',
        'ca200000-0000-4000-8000-000000000001',
        'Observation Owner', 'observed-owner@example.test', 'admin', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('ca200000-0000-4000-8000-000000000001',
        'ca100000-0000-4000-8000-000000000001', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values ('ca400000-0000-4000-8000-000000000001',
          'ca200000-0000-4000-8000-000000000001',
          'ca100000-0000-4000-8000-000000000001',
          'wa-observation-test', 'evolution_go', 'connected', true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'ca100000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'other-org@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('ca200000-0000-4000-8000-000000000002',
        'WA Other Org', 'wa-other-org', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('ca100000-0000-4000-8000-000000000002',
        'ca200000-0000-4000-8000-000000000002',
        'Other Org Owner', 'other-org@example.test', 'admin', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('ca200000-0000-4000-8000-000000000002',
        'ca100000-0000-4000-8000-000000000002', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, is_group
) values
  ('ca500000-0000-4000-8000-000000000001',
   'ca200000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001',
   '5511999990001@s.whatsapp.net', '5511999990001', false),
  ('ca500000-0000-4000-8000-000000000002',
   'ca200000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001',
   '5511999990002@s.whatsapp.net', '5511999990002', false),
  ('ca500000-0000-4000-8000-000000000003',
   'ca200000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001',
   '5511999990003@s.whatsapp.net', '5511999990003', false),
  ('ca500000-0000-4000-8000-000000000004',
   'ca200000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001',
   '5511999990004@s.whatsapp.net', '5511999990004', false),
  ('ca500000-0000-4000-8000-000000000005',
   'ca200000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001',
   '5511999990005@s.whatsapp.net', '5511999990005', false);
insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values
  ('ca300000-0000-4000-8000-000000000001',
   'ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000001',
   'First Observation Lead', '5511999990001', 'whatsapp'),
  ('ca300000-0000-4000-8000-000000000002',
   'ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000001',
   'Retired Observation Lead', '5511999990002', 'whatsapp'),
  ('ca300000-0000-4000-8000-000000000003',
   'ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000001',
   'Legacy Observation Lead', '5511999990003', 'whatsapp');
insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values ('ca300000-0000-4000-8000-000000000004',
        'ca200000-0000-4000-8000-000000000002',
        'ca100000-0000-4000-8000-000000000002',
        'Same Phone Other Org', '5511999990002', 'whatsapp');

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction, message_type,
  content, remote_jid, status, capture_state
) values
  ('ca600000-0000-4000-8000-000000000001',
   'ca200000-0000-4000-8000-000000000001',
   'ca500000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001', null,
   'wa-observed-external', 'wa-observed-external', true, 'outbound', 'text',
   'Synthetic external outbound', '5511999990001@s.whatsapp.net',
   'sent', 'unlinked_ephemeral'),
  ('ca600000-0000-4000-8000-000000000002',
   'ca200000-0000-4000-8000-000000000001',
   'ca500000-0000-4000-8000-000000000001',
   'ca400000-0000-4000-8000-000000000001', null,
   'wa-observed-inbound', 'wa-observed-inbound', false, 'inbound', 'text',
   'Synthetic inbound', '5511999990001@s.whatsapp.net',
   'received', 'unlinked_ephemeral'),
  ('ca600000-0000-4000-8000-000000000003',
   'ca200000-0000-4000-8000-000000000001',
   'ca500000-0000-4000-8000-000000000002',
   'ca400000-0000-4000-8000-000000000001', null,
   'wa-retired-outbound', 'wa-retired-outbound', true, 'outbound', 'text',
   'Synthetic retired history', '5511999990002@s.whatsapp.net',
   'sent', 'unlinked_ephemeral'),
  ('ca600000-0000-4000-8000-000000000004',
   'ca200000-0000-4000-8000-000000000001',
   'ca500000-0000-4000-8000-000000000005',
   'ca400000-0000-4000-8000-000000000001', null,
   'wa-expired-provider', 'wa-expired-provider', false, 'inbound', 'text',
   'Raw must disappear', '5511999990005@s.whatsapp.net',
   'received', 'unlinked_ephemeral');

select ok((select unlinked_retention_v1 from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000001'),
  'external outbound marks a prospective unlinked epoch');
select is((select count(*)::bigint from public.whatsapp_messages
           where conversation_id = 'ca500000-0000-4000-8000-000000000001'
             and capture_state = 'unlinked_ephemeral'),
  2::bigint, 'inbound and external outbound share the temporary history');
select ok(not private.whatsapp_conversation_has_protected_history(
  'ca500000-0000-4000-8000-000000000001'),
  'temporary external outbound does not block seven-day retention');
select throws_ok($$select public.activate_whatsapp_conversation_lead_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001', null)$$,
  '23514', 'unlinked_promotion_requires_human_confirmation',
  'generic binding cannot silently expose temporary history');
select is((select lead_id from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000001'),
  null::uuid, 'rejected generic binding leaves epoch unbound');

select is((public.confirm_whatsapp_unlinked_history_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001', null,
  'ca100000-0000-4000-8000-000000000001', 'manual_link'
)->>'attached_message_count')::integer, 2,
  'human-confirmed link atomically attaches both directions');
select is((select count(*)::bigint from public.whatsapp_messages
           where conversation_id = 'ca500000-0000-4000-8000-000000000001'
             and lead_id = 'ca300000-0000-4000-8000-000000000001'
             and capture_state = 'promoted_unlinked'),
  2::bigint, 'message-level history belongs to the selected lead');
select is((select count(*)::bigint from public.whatsapp_attendance_entries
           where conversation_id = 'ca500000-0000-4000-8000-000000000001'),
  0::bigint, 'linking history does not join attendance');
select is((select count(*)::bigint from public.whatsapp_outbox
           where conversation_id = 'ca500000-0000-4000-8000-000000000001'),
  0::bigint, 'observed external outbound creates no CRM send');

insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction, message_type,
  content, remote_jid, status, capture_state
) values (
  'ca600000-0000-4000-8000-000000000005',
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'wa-lead-unattended-outbound', 'wa-lead-unattended-outbound', true,
  'outbound', 'text', 'Synthetic later external send',
  '5511999990001@s.whatsapp.net', 'sent', 'observed_unattended'
);
select is((select capture_state from public.whatsapp_messages
           where id = 'ca600000-0000-4000-8000-000000000005'),
  'observed_unattended'::text,
  'linked lead can retain an external message without attendance');
select is((select count(*)::bigint from public.automation_event_outbox
           where organization_id = 'ca200000-0000-4000-8000-000000000001'),
  0::bigint, 'observed history does not dispatch lead automation');

update public.whatsapp_conversations set retired_at = clock_timestamp()
where id = 'ca500000-0000-4000-8000-000000000002';
select ok((select unlinked_retention_v1 and lead_id is null
           from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000002'),
  'retired intake segment remains temporary until explicitly linked');
grant select on public.whatsapp_conversations, public.whatsapp_sessions,
  public.users, public.organization_members to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub',
  'ca100000-0000-4000-8000-000000000001', true);
select is((select count(*)::bigint from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000002'),
  1::bigint, 'retired unlinked history is owner-visible before the cutoff');
select set_config('request.jwt.claim.sub',
  'ca100000-0000-4000-8000-000000000002', true);
select is((select count(*)::bigint from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000002'),
  0::bigint, 'another organization cannot read the retired history');
reset role;
select set_config('request.jwt.claim.sub', '', true);
select throws_ok($$select public.confirm_whatsapp_unlinked_history_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000002',
  'ca300000-0000-4000-8000-000000000004', null,
  'ca100000-0000-4000-8000-000000000001', 'manual_link')$$,
  '23503', 'whatsapp_history_link_target_not_found',
  'same phone in another organization cannot be attached');
select is((public.confirm_whatsapp_unlinked_history_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000002',
  'ca300000-0000-4000-8000-000000000002', null,
  'ca100000-0000-4000-8000-000000000001', 'manual_link'
)->>'binding_mode'), 'history_only'::text,
  'retired prior segment attaches without activating its route');
select ok((select retired_at is not null and lead_id is null
             and not unlinked_retention_v1
           from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000002'),
  'history-only link does not change current conversation binding');
select is((select lead_id from public.whatsapp_messages
           where id = 'ca600000-0000-4000-8000-000000000003'),
  'ca300000-0000-4000-8000-000000000002'::uuid,
  'retired message appears in the chosen lead history');
select throws_ok($$select public.confirm_whatsapp_unlinked_history_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000003',
  'ca300000-0000-4000-8000-000000000003', null,
  'ca100000-0000-4000-8000-000000000001', 'manual_link')$$,
  '23514', 'whatsapp_history_link_epoch_ineligible',
  'legacy NULL lead without positive temporary marker is not promotable');

-- B1 requires a v1 admission envelope; the exact route evidence for this
-- synthetic event remains independently seeded in the ledger below.
insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload,
  status, created_at
) values (
  'ca700000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-first-event', 'messages.upsert',
  '{"body":"synthetic","__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[{"provider_message_id":"wa-first-provider"}]}}}',
  'pending', clock_timestamp() - interval '1 minute'
);
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
) values (
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-first-provider', 'wa-first-event', 'live', 'phone:5511999990004',
  false, 'snapshot', 0,
  '{"unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic","conversation_id":null}'::jsonb,
  clock_timestamp() - interval '30 seconds'
);
select is((public.resolve_whatsapp_unlinked_history_capture(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000004',
  'wa-first-provider', 'wa-first-event'
)->>'capture_state'), 'unlinked_ephemeral'::text,
  'first prospective event can mark a newly created conversation');

-- A new proven lead does not consume a recent temporary physical epoch.
update public.whatsapp_conversations
set created_at = clock_timestamp() - interval '3 days'
where id = 'ca500000-0000-4000-8000-000000000004';
insert into public.whatsapp_messages (
  id, organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction, message_type,
  content, remote_jid, status, capture_state
) values (
  'ca600000-0000-4000-8000-000000000006',
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000004',
  'ca400000-0000-4000-8000-000000000001', null,
  'wa-recent-history', 'wa-recent-history', false, 'inbound', 'text',
  'Recent old history', '5511999990004@s.whatsapp.net',
  'received', 'unlinked_ephemeral'
);
insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values ('ca300000-0000-4000-8000-000000000006',
        'ca200000-0000-4000-8000-000000000001',
        'ca100000-0000-4000-8000-000000000001',
        'New Intake Lead', '5511999990004', 'whatsapp');
insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload, status
) values (
  'ca700000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-lead-match-event', 'messages.upsert',
  '{"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[{"provider_message_id":"wa-lead-match-provider"}]}}}'::jsonb, 'pending'
);
select is((private.capture_whatsapp_webhook_routing_snapshot_v2(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-lead-match-provider', 'wa-lead-match-event', 'live',
  'phone:5511999990004', true,
  array['5511999990004@s.whatsapp.net'], '5511999990004',
  'organic', null, false, false, false, null, null, null, 0
)->>'intake_unlinked_conversation_id'),
  'ca500000-0000-4000-8000-000000000004'::text,
  'new lead snapshot pins the recent temporary epoch for split');
select is((select snapshot->>'conversation_id'
           from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'wa-lead-match-provider'),
  null::text, 'new lead event does not target old temporary history');
select is((public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000004',
  '5511999990004@s.whatsapp.net', 'wa-lead-match-provider',
  'wa-lead-match-event', 'ca300000-0000-4000-8000-000000000006'
)->>'reason'), 'intake_split'::text,
  'proven lead intake retires old physical route before seven days');
select ok((select retired_at is not null and lead_id is null
                and unlinked_retention_v1
           from public.whatsapp_conversations
           where id = 'ca500000-0000-4000-8000-000000000004'),
  'old owner history remains temporary and unbound');
select is((select content from public.whatsapp_messages
           where id = 'ca600000-0000-4000-8000-000000000006'),
  'Recent old history'::text, 'early split preserves old history until cutoff');
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, is_group
) values (
  'ca500000-0000-4000-8000-000000000007',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  '5511999990004@s.whatsapp.net', '5511999990004', false
);
select is((public.activate_whatsapp_conversation_lead_binding(
  'ca200000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000007',
  'ca300000-0000-4000-8000-000000000006', null
)->>'lead_id'), 'ca300000-0000-4000-8000-000000000006'::text,
  'new physical epoch can bind the lead without promoting old history');

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, is_group,
  created_at, unlinked_retention_v1
) values (
  'ca500000-0000-4000-8000-000000000008',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  '5511999990008@s.whatsapp.net', '5511999990008', false,
  clock_timestamp() - interval '2 days', true
);
insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload, status
) values (
  'ca700000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-contextual-event', 'messages.upsert',
  '{"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[{"provider_message_id":"wa-contextual-provider"}]}}}'::jsonb, 'pending'
);
select is((private.capture_whatsapp_webhook_routing_snapshot_v2(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-contextual-provider', 'wa-contextual-event', 'live',
  'phone:5511999990008', true,
  array['5511999990008@s.whatsapp.net'], '5511999990008',
  'contextual_intake', 'canonical_intake_v1:fixture',
  false, false, false, null, null, null, 0
)->>'intake_unlinked_conversation_id'),
  'ca500000-0000-4000-8000-000000000008'::text,
  'proved contextual intake freezes old epoch even before card creation');
select is((public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000008',
  '5511999990008@s.whatsapp.net', 'wa-contextual-provider',
  'wa-contextual-event', null
)->>'reason'), 'intake_split'::text,
  'contextual intake may split before its lead card exists');
select is((public.retire_whatsapp_unlinked_conversation_for_lead_intake(
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca500000-0000-4000-8000-000000000008',
  '5511999990008@s.whatsapp.net', 'wa-contextual-provider',
  'wa-contextual-event', null
)->>'reason'), 'already_retired'::text,
  'replayed split is idempotent and does not create another old epoch');

update public.whatsapp_conversations
set created_at = clock_timestamp() - interval '8 days'
where id = 'ca500000-0000-4000-8000-000000000005';
insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload,
  status, created_at
) values (
  'ca700000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-expired-event', 'messages.upsert',
  '{"data":{"body":"must vanish"},"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[{"provider_message_id":"wa-expired-provider"}]}}}'::jsonb,
  'retry', clock_timestamp() - interval '8 days'
);
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
) values (
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'wa-expired-provider', 'wa-expired-event', 'live', 'phone:5511999990005',
  false, 'snapshot', 0,
  '{"unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic","conversation_id":"ca500000-0000-4000-8000-000000000005"}'::jsonb,
  clock_timestamp() - interval '8 days'
);
select is((private.scrub_expired_whatsapp_unlinked_inbox(500)->>'inbox_scrubbed')::integer,
  1, 'expired proved raw inbox event is sanitized');
select ok((select status = 'dead' and payload->>'body' is null
             and payload->>'__vimob_retention' = 'expired_unlinked_v1'
           from public.whatsapp_webhook_inbox
           where id = 'ca700000-0000-4000-8000-000000000002'),
  'retry payload becomes terminal without original message text');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'ca100000-0000-4000-8000-000000000003',
  'authenticated', 'authenticated', 'observed-manager@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('ca100000-0000-4000-8000-000000000003',
        'ca200000-0000-4000-8000-000000000001',
        'Observation Manager', 'observed-manager@example.test', 'manager', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('ca200000-0000-4000-8000-000000000001',
        'ca100000-0000-4000-8000-000000000003', 'manager', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.user_permission_overrides (
  organization_id, user_id, permission_key, allowed
) values
  ('ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000003', 'lead_view_all', false),
  ('ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000003', 'lead_view_team', true),
  ('ca200000-0000-4000-8000-000000000001',
   'ca100000-0000-4000-8000-000000000003', 'whatsapp_view', true)
on conflict (organization_id, user_id, permission_key) do update
set allowed = excluded.allowed;
select ok(not private.whatsapp_actor_can_read_lead(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000003'),
  'manager role alone cannot see another broker lead');
select set_config('request.jwt.claim.sub',
  'ca100000-0000-4000-8000-000000000003', true);
select ok(not private.can_receive_whatsapp_broadcast(
  'whatsapp:ca200000-0000-4000-8000-000000000001:lead:ca300000-0000-4000-8000-000000000001'),
  'manager without all-lead permission cannot subscribe to lead metadata');
select set_config('request.jwt.claim.sub', '', true);
insert into public.teams (id, organization_id, name, is_active)
values ('ca800000-0000-4000-8000-000000000001',
        'ca200000-0000-4000-8000-000000000001',
        'Observation Team', true);
insert into public.team_members (
  id, organization_id, team_id, user_id, is_active, is_leader
) values ('ca900000-0000-4000-8000-000000000001',
          'ca200000-0000-4000-8000-000000000001',
          'ca800000-0000-4000-8000-000000000001',
          'ca100000-0000-4000-8000-000000000003', true, true);
select ok(not private.whatsapp_actor_can_read_lead(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000003'),
  'leader of another team still cannot see the lead');
insert into public.team_members (
  id, organization_id, team_id, user_id, is_active, is_leader
) values ('ca900000-0000-4000-8000-000000000002',
          'ca200000-0000-4000-8000-000000000001',
          'ca800000-0000-4000-8000-000000000001',
          'ca100000-0000-4000-8000-000000000001', true, false);
select ok(private.whatsapp_actor_can_read_lead(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000003'),
  'leader with team permission can see an active team assignee');
update public.team_members set is_active = false
where id = 'ca900000-0000-4000-8000-000000000002';
select ok(not private.whatsapp_actor_can_read_lead(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000003'),
  'inactive assignee team membership revokes leader visibility');
select ok(private.whatsapp_actor_can_read_lead(
  'ca200000-0000-4000-8000-000000000001',
  'ca300000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001'),
  'organization admin retains lead access');

select * from finish();
rollback;
