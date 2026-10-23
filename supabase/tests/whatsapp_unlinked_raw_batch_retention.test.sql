begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'cb100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'batch-owner@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('cb200000-0000-4000-8000-000000000001',
        'WA Batch Retention', 'wa-batch-retention', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('cb100000-0000-4000-8000-000000000001',
        'cb200000-0000-4000-8000-000000000001',
        'Batch Owner', 'batch-owner@example.test', 'admin', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('cb200000-0000-4000-8000-000000000001',
        'cb100000-0000-4000-8000-000000000001', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'cb400000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'cb100000-0000-4000-8000-000000000001',
  'wa-batch-retention', 'evolution_go', 'connected', true
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values (
  'cb500000-0000-4000-8000-000000000001',
  'cb200000-0000-4000-8000-000000000001',
  'cb400000-0000-4000-8000-000000000001',
  '5511888880011@s.whatsapp.net', '5511888880011', false,
  clock_timestamp() - interval '8 days', true
);

-- 129 is above the ingress split cap of 128, so it persists as one row.
insert into public.whatsapp_webhook_inbox (
  id, organization_id, session_id, event_key, event_type, payload,
  status, created_at
)
select 'cb700000-0000-4000-8000-000000000001',
       'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-batch129-event', 'messages.upsert',
       pg_catalog.jsonb_build_object(
         'data', pg_catalog.jsonb_build_object('messages',
           (select pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object('key',
               pg_catalog.jsonb_build_object('id', 'cb-p129-' || n),
               'message', pg_catalog.jsonb_build_object('conversation', 'private'))
             order by n)
            from pg_catalog.generate_series(1, 129) as n)),
         '__vimob_ingress', pg_catalog.jsonb_build_object('routing_snapshot',
           pg_catalog.jsonb_build_object('version', 1, 'messages',
             (select pg_catalog.jsonb_agg(
               pg_catalog.jsonb_build_object('provider_message_id',
                 'cb-p129-' || n) order by n)
              from pg_catalog.generate_series(1, 129) as n)))
       ),
       'pending', clock_timestamp() - interval '8 days 1 minute';
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-p129-' || n, 'cb-batch129-event', 'live',
       'phone:5511888880011', false, 'snapshot', 0,
       '{"unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic","conversation_id":"cb500000-0000-4000-8000-000000000001"}'::jsonb,
       clock_timestamp() - interval '8 days 30 seconds'
from pg_catalog.generate_series(1, 129) as n;
select ok(private.whatsapp_unlinked_inbox_batch_exclusive(
  'cb700000-0000-4000-8000-000000000001',
  'cb500000-0000-4000-8000-000000000001'),
  'all 129 unsplit members prove the same expired unlinked epoch');
select is((private.scrub_expired_whatsapp_unlinked_inbox(500)
           ->>'inbox_newly_terminalized')::integer, 1,
  'one pending 129-member row becomes terminal');
select is((select payload from public.whatsapp_webhook_inbox
           where event_key = 'cb-batch129-event'),
  '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb,
  'redaction removes raw text and routing metadata from the whole safe batch');
select ok((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'conversations_completed')::integer = 1,
  'first fully redacted conversation can finish canonical retention');

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values (
  'cb500000-0000-4000-8000-000000000002',
  'cb200000-0000-4000-8000-000000000001',
  'cb400000-0000-4000-8000-000000000001',
  '5511888880012@s.whatsapp.net', '5511888880012', false,
  clock_timestamp() - interval '8 days', true
);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-bulk501-' || n, 'messages.upsert',
       pg_catalog.jsonb_build_object(
         'data', pg_catalog.jsonb_build_object('body', 'private'),
         '__vimob_ingress', pg_catalog.jsonb_build_object('routing_snapshot',
           pg_catalog.jsonb_build_object('version', 1, 'messages',
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object('provider_message_id',
                 'cb-p501-' || n))))
       ),
       case when n % 3 = 0 then 'dead'
            when n % 3 = 1 then 'pending' else 'retry' end,
       clock_timestamp() - interval '8 days 1 minute'
from pg_catalog.generate_series(1, 501) as n;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-p501-' || n, 'cb-bulk501-' || n,
       'live', 'phone:5511888880012', false, 'snapshot', 0,
       '{"unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic","conversation_id":null}'::jsonb,
       clock_timestamp() - interval '8 days 30 seconds'
from pg_catalog.generate_series(1, 501) as n;
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 500,
  'first worker cycle redacts at most 500 raw rows');
select ok((select unlinked_retention_scrubbed_at is null
                and contact_phone = '5511888880012'
           from public.whatsapp_conversations
           where id = 'cb500000-0000-4000-8000-000000000002'),
  'row 501 keeps immutable phone proof until its next redaction cycle');
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 1,
  'next cycle reaches the remaining raw row');
select ok((select unlinked_retention_scrubbed_at is not null
                and contact_phone is null
           from public.whatsapp_conversations
           where id = 'cb500000-0000-4000-8000-000000000002'),
  'conversation finalizes only after all 501 raw rows are sanitized');

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values
  ('cb500000-0000-4000-8000-000000000003',
   'cb200000-0000-4000-8000-000000000001',
   'cb400000-0000-4000-8000-000000000001',
   '5511888880013@s.whatsapp.net', '5511888880013', false,
   clock_timestamp() - interval '8 days', true),
  ('cb500000-0000-4000-8000-000000000004',
   'cb200000-0000-4000-8000-000000000001',
   'cb400000-0000-4000-8000-000000000001',
   '5511888880014@s.whatsapp.net', '5511888880014', false,
   clock_timestamp() - interval '8 days', true);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-mixed-' || n, 'messages.upsert',
       pg_catalog.jsonb_build_object(
         'data', pg_catalog.jsonb_build_object('messages',
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('key',
               pg_catalog.jsonb_build_object('id', 'cb-mixed-old-' || n)),
             pg_catalog.jsonb_build_object('key',
               pg_catalog.jsonb_build_object('id', 'cb-mixed-other-' || n),
               'message', pg_catalog.jsonb_build_object('conversation',
                 'lead content must survive')))),
         '__vimob_ingress', pg_catalog.jsonb_build_object('routing_snapshot',
           pg_catalog.jsonb_build_object('version', 1, 'messages',
             pg_catalog.jsonb_build_array(
               pg_catalog.jsonb_build_object('provider_message_id',
                 'cb-mixed-old-' || n),
               pg_catalog.jsonb_build_object('provider_message_id',
                 'cb-mixed-other-' || n))))
       ),
       'pending', clock_timestamp() - interval '8 days 1 minute'
from pg_catalog.generate_series(3, 4) as n;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-mixed-old-' || n, 'cb-mixed-' || n,
       'live', 'phone:551188888001' || n, false, 'snapshot', 0,
       pg_catalog.jsonb_build_object(
         'unlinked_capture_policy', 'v1', 'state', 'unlinked',
         'context_kind', 'organic', 'conversation_id',
         'cb500000-0000-4000-8000-00000000000' || n),
       clock_timestamp() - interval '8 days 30 seconds'
from pg_catalog.generate_series(3, 4) as n;
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
)
select 'cb200000-0000-4000-8000-000000000001',
       'cb400000-0000-4000-8000-000000000001',
       'cb-mixed-other-' || n, 'cb-mixed-' || n,
       'live', 'phone:5511888880099', false, 'snapshot', 0,
       case when n = 3 then
         '{"unlinked_capture_policy":"v1","state":"lead_match","context_kind":"organic","event_lead_id":"cb300000-0000-4000-8000-000000000001"}'::jsonb
       else '{"unlinked_capture_policy":"v1"}'::jsonb end,
       clock_timestamp() - interval '8 days 30 seconds'
from pg_catalog.generate_series(3, 4) as n;
select ok(not private.whatsapp_unlinked_inbox_batch_exclusive(
  (select id from public.whatsapp_webhook_inbox
   where event_key = 'cb-mixed-3'),
  'cb500000-0000-4000-8000-000000000003'),
  'lead member prevents whole-row redaction');
select ok(not private.whatsapp_unlinked_inbox_batch_exclusive(
  (select id from public.whatsapp_webhook_inbox
   where event_key = 'cb-mixed-4'),
  'cb500000-0000-4000-8000-000000000004'),
  'missing state/context is false, not an unknown truthy proof');
select ok((private.scrub_expired_whatsapp_unlinked_inbox(500)
           ->>'inbox_scrubbed')::integer = 0
          and (select status = 'pending'
                        and payload::text like '%lead content must survive%'
               from public.whatsapp_webhook_inbox
               where event_key = 'cb-mixed-3'),
  'mixed lead payload stays intact and processable');

select * from finish();
rollback;
