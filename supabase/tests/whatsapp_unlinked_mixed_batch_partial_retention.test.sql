begin;
create extension if not exists pgtap with schema extensions;
select plan(31);
select ok(not pg_catalog.has_function_privilege(
  'service_role',
  'private.scrub_expired_whatsapp_unlinked_inbox_exclusive(integer)',
  'EXECUTE'
), 'service_role cannot bypass partial retention through the exclusive helper');
select ok(pg_catalog.has_function_privilege(
  'service_role',
  'private.scrub_expired_whatsapp_unlinked_inbox(integer)',
  'EXECUTE'
), 'service_role retains only the combined bounded inbox worker entry point');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'cf100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'mixed-owner@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('cf200000-0000-4000-8000-000000000001',
        'WA Mixed Retention', 'wa-mixed-retention', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('cf100000-0000-4000-8000-000000000001',
        'cf200000-0000-4000-8000-000000000001',
        'Mixed Owner', 'mixed-owner@example.test', 'admin', true)
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role,
  is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('cf200000-0000-4000-8000-000000000001',
        'cf100000-0000-4000-8000-000000000001', 'admin', true)
on conflict (user_id, organization_id) do update set
  role = excluded.role, is_active = excluded.is_active;
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values (
  'cf400000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'wa-mixed-retention', 'evolution_go', 'connected', true
);
insert into public.leads (
  id, organization_id, assigned_user_id, name, phone, source
) values (
  'cf300000-0000-4000-8000-000000000001',
  'cf200000-0000-4000-8000-000000000001',
  'cf100000-0000-4000-8000-000000000001',
  'Lead Preservado', '5511888880999', 'whatsapp'
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  lead_id, is_group, created_at, unlinked_retention_v1
) values
  ('cf500000-0000-4000-8000-000000000001',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880001@s.whatsapp.net', '5511888880001', null, false,
   clock_timestamp() - interval '8 days', true),
  ('cf500000-0000-4000-8000-000000000002',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880999@s.whatsapp.net', '5511888880999',
   'cf300000-0000-4000-8000-000000000001', false,
   clock_timestamp() - interval '8 days', false),
  ('cf500000-0000-4000-8000-000000000003',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880003@s.whatsapp.net', '5511888880003', null, false,
   clock_timestamp() - interval '8 days', true);

-- 129 members exceed the ingress split cap; the lead is last. The three
-- two-member fixtures exercise every other terminal/retry state in isolation.
with fixture as (
  select 'mix-pending'::text as event_key, 'pending'::text as status,
         n as ordinal,
         case when n = 129 then 'lead-pending'
              else 'old-pending-' || n end as provider_id,
         n = 129 as is_lead
  from pg_catalog.generate_series(1, 129) as n
  union all
  select 'mix-' || state, state, n,
         case when n = 2 then 'lead-' || state
              else 'old-' || state end,
         n = 2
  from pg_catalog.unnest(array['retry','dead','processed']) as state
  cross join pg_catalog.generate_series(1, 2) as n
)
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot, created_at
)
select 'cf200000-0000-4000-8000-000000000001',
       'cf400000-0000-4000-8000-000000000001', provider_id, event_key,
       'live', case when is_lead then 'phone:5511888880999'
                    else 'phone:5511888880001' end,
       false, 'snapshot', 0,
       pg_catalog.jsonb_build_object(
         'version', 1,
         'organization_id', 'cf200000-0000-4000-8000-000000000001',
         'session_id', 'cf400000-0000-4000-8000-000000000001',
         'provider_message_id', provider_id,
         'inbox_event_key', event_key,
         'processing_epoch', 0,
         'unlinked_capture_policy', 'v1',
         'state', case when is_lead then 'lead_match' else 'unlinked' end,
         'context_kind', 'organic',
         'conversation_id', case when is_lead
           then 'cf500000-0000-4000-8000-000000000002'
           else 'cf500000-0000-4000-8000-000000000001' end,
         'event_lead_id', case when is_lead
           then 'cf300000-0000-4000-8000-000000000001' else null end
       ),
       clock_timestamp() - interval '8 days 30 seconds'
from fixture;

with fixture as (
  select 'mix-pending'::text as event_key, 'pending'::text as status,
         n as ordinal,
         case when n = 129 then 'lead-pending'
              else 'old-pending-' || n end as provider_id,
         n = 129 as is_lead
  from pg_catalog.generate_series(1, 129) as n
  union all
  select 'mix-' || state, state, n,
         case when n = 2 then 'lead-' || state
              else 'old-' || state end,
         n = 2
  from pg_catalog.unnest(array['retry','dead','processed']) as state
  cross join pg_catalog.generate_series(1, 2) as n
), per_event as (
  select event_key, status,
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'Info', pg_catalog.jsonb_build_object('ID', provider_id),
        'Message', pg_catalog.jsonb_build_object(
          'conversation', case when is_lead then 'LEAD-CONTENT-KEEP'
                               else 'OLD-CONTENT-REMOVE' end
        )
      ) order by ordinal
    ) as raw_messages,
    pg_catalog.jsonb_agg(route.snapshot order by ordinal) as route_messages
  from fixture
  join public.whatsapp_webhook_routing_snapshots as route
    on route.organization_id = 'cf200000-0000-4000-8000-000000000001'
   and route.session_id = 'cf400000-0000-4000-8000-000000000001'
   and route.inbox_event_key = fixture.event_key
   and route.provider_message_id = fixture.provider_id
  group by event_key, status
)
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
)
select 'cf200000-0000-4000-8000-000000000001',
       'cf400000-0000-4000-8000-000000000001', event_key,
       'messages.upsert',
       pg_catalog.jsonb_build_object(
         'event', 'messages.upsert',
         'data', pg_catalog.jsonb_build_object('messages', raw_messages),
         '__vimob_ingress', pg_catalog.jsonb_build_object(
           'routing_key', '__session__', 'epoch_capable', true,
           'routing_snapshot', pg_catalog.jsonb_build_object(
             'version', 1, 'messages', route_messages
           )
         )
       ),
       status, 0, clock_timestamp() - interval '8 days 1 minute'
from per_event;

select is((private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox where event_key = 'mix-pending'),
  'cf500000-0000-4000-8000-000000000001'
)->>'redacted_count')::integer, 128,
  'all 128 expired members have exact snapshot and raw-ID proof');
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 4,
  'one worker cycle partially redacts four mixed rows');
select is((select pg_catalog.jsonb_array_length(payload #> '{data,messages}')
           from public.whatsapp_webhook_inbox where event_key = 'mix-pending'),
  1, '129-member raw batch retains exactly one lead member');
select ok((select payload::text like '%LEAD-CONTENT-KEEP%'
                   and payload::text not like '%OLD-CONTENT-REMOVE%'
                   and payload #>> '{__vimob_retention,kind}' =
                       'partial_expired_unlinked_v1'
           from public.whatsapp_webhook_inbox where event_key = 'mix-pending'),
  'lead content stays intact while expired raw text and snapshot leave the row');
select is((select pg_catalog.jsonb_array_length(
             payload #> '{__vimob_ingress,routing_snapshot,messages}')
           from public.whatsapp_webhook_inbox where event_key = 'mix-pending'),
  1, 'retained snapshot count and order match the retained member');
select results_eq(
  $$select event_key || ':' || status from public.whatsapp_webhook_inbox
    where event_key like 'mix-%' order by event_key$$,
  $$values ('mix-dead:dead'), ('mix-pending:pending'),
            ('mix-processed:processed'), ('mix-retry:retry')$$,
  'pending/retry/dead/processed statuses are preserved with retained work');
select is((select count(*)::integer from public.whatsapp_webhook_routing_outcomes
           where organization_id = 'cf200000-0000-4000-8000-000000000001'
             and provider_message_id like 'old-%'),
  131, 'expired routing predecessors are terminalized without touching lead route');
select is((select count(*)::integer from public.whatsapp_webhook_routing_outcomes
           where organization_id = 'cf200000-0000-4000-8000-000000000001'
             and provider_message_id like 'lead-%'),
  0, 'retained lead routing outcomes remain for normal processing');
select ok((select contact_phone is null
                and unlinked_retention_scrubbed_at is not null
           from public.whatsapp_conversations
           where id = 'cf500000-0000-4000-8000-000000000001'),
  'expired conversation finalizes after its raw members are removed');
select ok((select contact_phone = '5511888880999' and lead_id is not null
           from public.whatsapp_conversations
           where id = 'cf500000-0000-4000-8000-000000000002'),
  'lead conversation is unchanged');

-- B1 admission also checks replay attempts before ON CONFLICT and marker
-- sanitization. Keep the v1 envelope while testing those two protections.
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload, status
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-pending', 'messages.upsert',
  '{"data":{"messages":[{"Message":{"conversation":"RESURRECT"}}]},"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[]}}}',
  'pending'
) on conflict (event_key) do nothing;
select ok((select payload::text not like '%RESURRECT%'
           from public.whatsapp_webhook_inbox where event_key = 'mix-pending'),
  'same event key cannot reinsert original raw content after partial retention');

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload, status
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-forged-marker', 'messages.upsert',
  '{"__vimob_retention":{"kind":"partial_expired_unlinked_v1","redacted_count":999},"data":{"messages":[]},"__vimob_ingress":{"routing_snapshot":{"version":1,"messages":[]}}}',
  'pending'
);
select ok((select not (payload ? '__vimob_retention')
           from public.whatsapp_webhook_inbox where event_key = 'mix-forged-marker'),
  'provider-supplied retention marker is stripped at inbox insertion');

-- A retained successor depending on an expired member must not be released
-- by deleting that member. The raw row and status remain available for review.
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  predecessor_provider_message_id, processing_epoch, snapshot, created_at
) values
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'old-chain', 'mix-chain', 'live', 'phone:5511888880003', true,
   'snapshot', null, 0,
   '{"provider_message_id":"old-chain","conversation_id":"cf500000-0000-4000-8000-000000000003","unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic"}'::jsonb,
   clock_timestamp() - interval '8 days 30 seconds'),
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'lead-chain', 'mix-chain', 'live', 'phone:5511888880003', true,
   'inherit_predecessor', 'old-chain', 0,
   '{"provider_message_id":"lead-chain","conversation_id":"cf500000-0000-4000-8000-000000000002","state":"lead_match","context_kind":"organic"}'::jsonb,
   clock_timestamp() - interval '8 days 29 seconds');
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-chain', 'messages.upsert',
  pg_catalog.jsonb_build_object(
    'data', pg_catalog.jsonb_build_object('messages',
      pg_catalog.jsonb_build_array(
        '{"Info":{"ID":"old-chain"},"Message":{"conversation":"CHAIN-OLD"}}'::jsonb,
        '{"Info":{"ID":"lead-chain"},"Message":{"conversation":"CHAIN-LEAD"}}'::jsonb
      )),
    '__vimob_ingress', pg_catalog.jsonb_build_object(
      'routing_key', '__session__', 'epoch_capable', true,
      'routing_snapshot', pg_catalog.jsonb_build_object(
        'version', 1, 'messages', pg_catalog.jsonb_build_array(
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'old-chain'),
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'lead-chain')
        ))
    )
  ),
  'pending', 0, clock_timestamp() - interval '8 days 1 minute'
);
select is(private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox where event_key = 'mix-chain'),
  'cf500000-0000-4000-8000-000000000003'),
  null::jsonb, 'retained successor dependency refuses partial redaction');
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 0,
  'worker leaves unsplittable predecessor batch untouched');
select ok((select status = 'pending' and payload::text like '%CHAIN-OLD%'
                   and payload::text like '%CHAIN-LEAD%'
           from public.whatsapp_webhook_inbox where event_key = 'mix-chain'),
  'failed proof preserves both raw members and retry status');
select ok((select unlinked_retention_scrubbed_at is null
           from public.whatsapp_conversations
           where id = 'cf500000-0000-4000-8000-000000000003'),
  'parent epoch remains until unsafe mixed raw is resolved');
select is(private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox where event_key = 'mix-chain'),
  'cf500000-0000-4000-8000-000000000001'),
  null::jsonb, 'wrong physical epoch cannot claim a different inbox member');

-- The same two provider identities in an unsupported envelope shape must
-- never be rewritten by a SQL parser that handles only data.messages.
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot
) values
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'unsupported-old', 'mix-unsupported', 'live',
   'phone:5511888880003', false, 'snapshot', 0,
   '{"provider_message_id":"unsupported-old","conversation_id":"cf500000-0000-4000-8000-000000000003","unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic"}'::jsonb),
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'unsupported-lead', 'mix-unsupported', 'live',
   'phone:5511888880999', false, 'snapshot', 0,
   '{"provider_message_id":"unsupported-lead","conversation_id":"cf500000-0000-4000-8000-000000000002","state":"lead_match","context_kind":"organic"}'::jsonb);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-unsupported', 'messages.upsert',
  pg_catalog.jsonb_build_object(
    'data', pg_catalog.jsonb_build_object('Messages',
      '[{"Info":{"ID":"unsupported-old"},"Message":{"conversation":"UNSUPPORTED-OLD"}},{"Info":{"ID":"unsupported-lead"},"Message":{"conversation":"UNSUPPORTED-LEAD"}}]'::jsonb),
    '__vimob_ingress', pg_catalog.jsonb_build_object(
      'routing_key', '__session__', 'epoch_capable', true,
      'routing_snapshot', pg_catalog.jsonb_build_object(
        'version', 1, 'messages', pg_catalog.jsonb_build_array(
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'unsupported-old'),
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'unsupported-lead')
        ))
    )
  ),
  'pending', 0, clock_timestamp() - interval '8 days 1 minute'
);
select ok(private.whatsapp_unlinked_mixed_inbox_plan(
    (select id from public.whatsapp_webhook_inbox
     where event_key = 'mix-unsupported'),
    'cf500000-0000-4000-8000-000000000003'
  ) is null
  and (select status = 'pending'
                and payload::text like '%UNSUPPORTED-OLD%'
                and payload::text like '%UNSUPPORTED-LEAD%'
       from public.whatsapp_webhook_inbox
       where event_key = 'mix-unsupported'),
  'unsupported envelope remains intact and processable');
select throws_ok(
  $$update public.whatsapp_webhook_inbox
    set payload = pg_catalog.jsonb_set(
      payload, '{__vimob_ingress,routing_snapshot,messages}', '[]'::jsonb
    )
    where event_key = 'mix-unsupported'$$,
  '23514', 'whatsapp_webhook_routing_snapshot_immutable',
  'direct writer cannot forge a partial snapshot redaction'
);

-- Two no-lead epochs in one unsplit callback can expire on different days.
-- The first pass retains the younger member and the next pass can terminalize
-- the same event key without bringing back the older content.
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values
  ('cf500000-0000-4000-8000-000000000004',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880004@s.whatsapp.net', '5511888880004', false,
   clock_timestamp() - interval '8 days', true),
  ('cf500000-0000-4000-8000-000000000005',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880005@s.whatsapp.net', '5511888880005', false,
   clock_timestamp() - interval '6 days', true);
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot
) values
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'two-older', 'mix-two-epochs', 'live',
   'phone:5511888880004', false, 'snapshot', 0,
   '{"provider_message_id":"two-older","conversation_id":"cf500000-0000-4000-8000-000000000004","unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic"}'::jsonb),
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'two-younger', 'mix-two-epochs', 'live',
   'phone:5511888880005', false, 'snapshot', 0,
   '{"provider_message_id":"two-younger","conversation_id":"cf500000-0000-4000-8000-000000000005","unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic"}'::jsonb);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-two-epochs', 'messages.upsert',
  pg_catalog.jsonb_build_object(
    'data', pg_catalog.jsonb_build_object('messages',
      '[{"Info":{"ID":"two-older"},"Message":{"conversation":"TWO-OLDER-CONTENT"}},{"Info":{"ID":"two-younger"},"Message":{"conversation":"TWO-YOUNGER-CONTENT"}}]'::jsonb),
    '__vimob_ingress', pg_catalog.jsonb_build_object(
      'routing_key', '__session__', 'epoch_capable', true,
      'routing_snapshot', pg_catalog.jsonb_build_object(
        'version', 1, 'messages', pg_catalog.jsonb_build_array(
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'two-older'),
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'two-younger')
        ))
    )
  ),
  'pending', 0, clock_timestamp() - interval '6 days 1 minute'
);
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 1,
  'first seven-day cutoff removes only the older epoch');
select ok((select status = 'pending'
                   and payload #>> '{__vimob_retention,redacted_count}' = '1'
                   and payload::text not like '%TWO-OLDER-CONTENT%'
                   and payload::text like '%TWO-YOUNGER-CONTENT%'
           from public.whatsapp_webhook_inbox
           where event_key = 'mix-two-epochs'),
  'younger member remains pending with a count-only retention marker');
update public.whatsapp_conversations
set created_at = clock_timestamp() - interval '8 days'
where id = 'cf500000-0000-4000-8000-000000000005';
select is((private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox
   where event_key = 'mix-two-epochs'),
  'cf500000-0000-4000-8000-000000000005'
)->>'terminal'), 'true'::text,
  'second cutoff proves all remaining members belong to the younger epoch');
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_newly_terminalized')::integer, 1,
  'second cutoff terminalizes the last pending member');
select ok((select status = 'dead'
                   and payload = '{"__vimob_retention":"expired_unlinked_v1"}'::jsonb
           from public.whatsapp_webhook_inbox
           where event_key = 'mix-two-epochs'),
  'full tombstone replaces count marker after the final safe member expires');

-- The first callback may be captured before its physical conversation exists.
-- A unique per-message phone route plus a single eligible epoch is enough;
-- a later canonical unlinked message gives a stronger provider-ID proof.
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values
  ('cf500000-0000-4000-8000-000000000006',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880006@s.whatsapp.net', '5511888880006', false,
   clock_timestamp() - interval '8 days', true),
  ('cf500000-0000-4000-8000-000000000009',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880009@s.whatsapp.net', '5511888880009', false,
   clock_timestamp(), true);
insert into public.whatsapp_messages (
  organization_id, session_id, conversation_id, provider_message_id,
  message_id, from_me, direction, message_type, content, remote_jid,
  status, capture_state
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'cf500000-0000-4000-8000-000000000009',
  'canonical-old', 'canonical-old', false, 'inbound', 'text',
  'CANONICAL-OLD', '5511888880009@s.whatsapp.net',
  'received', 'unlinked_ephemeral'
);
update public.whatsapp_conversations
set created_at = clock_timestamp() - interval '8 days'
where id = 'cf500000-0000-4000-8000-000000000009';
with fixture(event_key, provider_id, is_lead) as (
  values
    ('mix-null-route', 'null-route-old', false),
    ('mix-null-route', 'null-route-lead', true),
    ('mix-canonical', 'canonical-old', false),
    ('mix-canonical', 'canonical-lead', true)
)
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot
)
select 'cf200000-0000-4000-8000-000000000001',
       'cf400000-0000-4000-8000-000000000001',
       provider_id, event_key, 'live',
       case when is_lead then 'phone:5511888880999'
            when event_key = 'mix-null-route' then 'phone:5511888880006'
            else 'phone:5511888887777' end,
       false, 'snapshot', 0,
       pg_catalog.jsonb_build_object(
         'provider_message_id', provider_id,
         'conversation_id', case when is_lead
           then 'cf500000-0000-4000-8000-000000000002' else null end,
         'unlinked_capture_policy', 'v1',
         'state', case when is_lead then 'lead_match' else 'unlinked' end,
         'context_kind', 'organic'
       )
from fixture;
with fixture(event_key, old_id, lead_id) as (
  values
    ('mix-null-route', 'null-route-old', 'null-route-lead'),
    ('mix-canonical', 'canonical-old', 'canonical-lead')
)
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
)
select 'cf200000-0000-4000-8000-000000000001',
       'cf400000-0000-4000-8000-000000000001', event_key,
       'messages.upsert',
       pg_catalog.jsonb_build_object(
         'data', pg_catalog.jsonb_build_object('messages',
           pg_catalog.jsonb_build_array(
             pg_catalog.jsonb_build_object('Info',
               pg_catalog.jsonb_build_object('ID', old_id),
               'Message', pg_catalog.jsonb_build_object('conversation',
                 'NULL-OLD-CONTENT')),
             pg_catalog.jsonb_build_object('Info',
               pg_catalog.jsonb_build_object('ID', lead_id),
               'Message', pg_catalog.jsonb_build_object('conversation',
                 'NULL-LEAD-CONTENT'))
           )),
         '__vimob_ingress', pg_catalog.jsonb_build_object(
           'routing_key', '__session__', 'epoch_capable', true,
           'routing_snapshot', pg_catalog.jsonb_build_object(
             'version', 1, 'messages', pg_catalog.jsonb_build_array(
               (select snapshot from public.whatsapp_webhook_routing_snapshots
                where provider_message_id = old_id),
               (select snapshot from public.whatsapp_webhook_routing_snapshots
                where provider_message_id = lead_id)
             ))
         )
       ),
       'pending', 0, clock_timestamp() - interval '8 days 1 minute'
from fixture;
select is((private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox
   where event_key = 'mix-null-route'),
  'cf500000-0000-4000-8000-000000000006'
)->>'redacted_count')::integer, 1,
  'unique phone route proves first snapshot with NULL conversation ID');
select is((private.whatsapp_unlinked_mixed_inbox_plan(
  (select id from public.whatsapp_webhook_inbox
   where event_key = 'mix-canonical'),
  'cf500000-0000-4000-8000-000000000009'
)->>'redacted_count')::integer, 1,
  'canonical provider ID proves NULL route when phone differs');
select is((private.scrub_expired_whatsapp_unlinked_conversations(500)
           ->>'inbox_scrubbed')::integer, 2,
  'worker reaches both NULL-conversation snapshot proofs');
select ok((select payload::text not like '%NULL-OLD-CONTENT%'
                   and payload::text like '%NULL-LEAD-CONTENT%'
           from public.whatsapp_webhook_inbox
           where event_key = 'mix-null-route'),
  'NULL-conversation proof removes old raw while preserving lead content');

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone,
  is_group, created_at, unlinked_retention_v1
) values
  ('cf500000-0000-4000-8000-000000000007',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '5511888880007@s.whatsapp.net', '5511888880007', false,
   clock_timestamp() - interval '8 days', true),
  ('cf500000-0000-4000-8000-000000000008',
   'cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   '999999999999@lid', '5511888880007', false,
   clock_timestamp() - interval '8 days 30 seconds', true);
insert into public.whatsapp_webhook_routing_snapshots (
  organization_id, session_id, provider_message_id, inbox_event_key,
  processing_lane, routing_key, binding_eligible, target_mode,
  processing_epoch, snapshot
) values
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'ambiguous-old', 'mix-ambiguous', 'live',
   'phone:5511888880007', false, 'snapshot', 0,
   '{"provider_message_id":"ambiguous-old","conversation_id":null,"unlinked_capture_policy":"v1","state":"unlinked","context_kind":"organic"}'::jsonb),
  ('cf200000-0000-4000-8000-000000000001',
   'cf400000-0000-4000-8000-000000000001',
   'ambiguous-lead', 'mix-ambiguous', 'live',
   'phone:5511888880999', false, 'snapshot', 0,
   '{"provider_message_id":"ambiguous-lead","conversation_id":"cf500000-0000-4000-8000-000000000002","state":"lead_match","context_kind":"organic"}'::jsonb);
insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload,
  status, processing_epoch, created_at
) values (
  'cf200000-0000-4000-8000-000000000001',
  'cf400000-0000-4000-8000-000000000001',
  'mix-ambiguous', 'messages.upsert',
  pg_catalog.jsonb_build_object(
    'data', pg_catalog.jsonb_build_object('messages',
      '[{"Info":{"ID":"ambiguous-old"},"Message":{"conversation":"AMBIGUOUS-OLD"}},{"Info":{"ID":"ambiguous-lead"},"Message":{"conversation":"AMBIGUOUS-LEAD"}}]'::jsonb),
    '__vimob_ingress', pg_catalog.jsonb_build_object(
      'routing_key', '__session__', 'epoch_capable', true,
      'routing_snapshot', pg_catalog.jsonb_build_object(
        'version', 1, 'messages', pg_catalog.jsonb_build_array(
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'ambiguous-old'),
          (select snapshot from public.whatsapp_webhook_routing_snapshots
           where provider_message_id = 'ambiguous-lead')
        ))
    )
  ),
  'pending', 0, clock_timestamp() - interval '8 days 1 minute'
);
select ok(private.whatsapp_unlinked_mixed_inbox_plan(
    (select id from public.whatsapp_webhook_inbox
     where event_key = 'mix-ambiguous'),
    'cf500000-0000-4000-8000-000000000007'
  ) is null
  and private.whatsapp_unlinked_mixed_inbox_plan(
    (select id from public.whatsapp_webhook_inbox
     where event_key = 'mix-ambiguous'),
    'cf500000-0000-4000-8000-000000000008'
  ) is null,
  'competing same-phone epochs make NULL attribution fail closed');

select * from finish();
rollback;
