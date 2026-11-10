-- Run on a disposable database with the v3 admission cutover installed.
begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, pg_catalog;
select plan(22);

select ok(has_function_privilege('service_role',
    'private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)',
    'EXECUTE')
  and not has_function_privilege('authenticated',
    'private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)',
    'EXECUTE')
  and not has_function_privilege('anon',
    'private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)',
    'EXECUTE'), 'only the backend role can execute the v3 RPC');

insert into public.organizations (id, name, slug, is_active)
values
  ('d2100000-0000-4000-8000-000000000001', 'Fresh admission fixture', 'wa-fresh-admission-a', true),
  ('d2100000-0000-4000-8000-000000000002', 'Foreign admission fixture', 'wa-fresh-admission-b', true);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
)
select '00000000-0000-0000-0000-000000000000',
  ('d2200000-0000-4000-8000-00000000000' || actor)::uuid,
  'authenticated', 'authenticated', 'wa-fresh-admission-' || actor || '@example.test',
  '', now(), '{}', '{}', now(), now(), '', '', '', ''
from generate_series(1, 2) as actor;

insert into public.users (id, organization_id, name, email, role, is_active)
select ('d2200000-0000-4000-8000-00000000000' || actor)::uuid,
  ('d2100000-0000-4000-8000-00000000000' || actor)::uuid,
  'Admission actor ' || actor, 'wa-fresh-admission-' || actor || '@example.test', 'admin', true
from generate_series(1, 2) as actor
on conflict (id) do update set organization_id = excluded.organization_id,
  name = excluded.name, email = excluded.email, role = excluded.role, is_active = excluded.is_active;

insert into public.whatsapp_sessions (id, organization_id, owner_user_id, instance_name, provider, status, is_active)
select ('d2300000-0000-4000-8000-00000000000' || connection)::uuid,
  ('d2100000-0000-4000-8000-00000000000' || actor)::uuid,
  ('d2200000-0000-4000-8000-00000000000' || actor)::uuid,
  'wa-fresh-admission-' || connection, 'evolution_go', 'connected', true
from (values (1, 1), (2, 2), (3, 1)) as fixtures(connection, actor);

do $$ begin
  perform private.activate_whatsapp_webhook_session_cutover(
    'd2100000-0000-4000-8000-000000000001', 'd2300000-0000-4000-8000-000000000003'
  );
end $$;

create temp table fresh_live_cases on commit drop as
select cases.*,
  'd2100000-0000-4000-8000-000000000001'::uuid as organization_id,
  case when slot >= 13 then 'd2300000-0000-4000-8000-000000000003'::uuid
    else 'd2300000-0000-4000-8000-000000000001'::uuid end as session_id,
  case when slot >= 13 then 1 else 0 end as processing_epoch,
  case when slot = 13 then 1 else 0 end as inbox_epoch,
  ('d2400000-0000-4000-8000-' || lpad(slot::text, 12, '0'))::uuid as lead_id,
  ('d2500000-0000-4000-8000-' || lpad(slot::text, 12, '0'))::uuid as conversation_id,
  '55119999001' || lpad(slot::text, 2, '0') as phone,
  'fresh-admission-' || scenario || '-old' as root_id
from (values
  (1, 'dead-backlog',  'dead',    'backlog', 'live',    'bound'),
  (2, 'pending',       'pending', 'backlog', 'live',    'predecessor_inherit'),
  (3, 'missing-inbox', null,      'backlog', 'live',    'predecessor_inherit'),
  (4, 'completed',     'dead',    'backlog', 'live',    'bound'),
  (5, 'foreign-inbox', 'dead',    'backlog', 'live',    'predecessor_inherit'),
  (6, 'binding-changed','dead',   'backlog', 'live',    'predecessor_inherit'),
  (7, 'dead-live',     'dead',    'live',    'live',    'predecessor_inherit'),
  (8, 'new-backlog',   'dead',    'backlog', 'backlog', 'predecessor_inherit'),
  (9, 'missing-dead-at','dead',   'backlog', 'live',    'predecessor_inherit'),
  (10,'locked',        'dead',    'backlog', 'live',    'predecessor_inherit'),
  (11,'non-message',   'dead',    'backlog', 'live',    'predecessor_inherit'),
  (12,'edge-lease',    'dead',    'backlog', 'live',    'predecessor_inherit'),
  (13,'epoch-one',     'dead',    'backlog', 'live',    'bound'),
  (14,'wrong-epoch',   'dead',    'backlog', 'live',    'predecessor_inherit')
) as cases(slot, scenario, root_status, root_lane, candidate_lane, expected_state);

insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
select lead_id, organization_id, 'd2200000-0000-4000-8000-000000000001',
  'Synthetic admission lead ' || slot, phone, 'whatsapp'
from fresh_live_cases;

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, is_group, assigned_user_id
)
select conversation_id, organization_id, session_id, phone || '@s.whatsapp.net',
  phone, false, 'd2200000-0000-4000-8000-000000000001'
from fresh_live_cases;

create temp table fresh_live_bindings on commit drop as
select scenario, public.activate_whatsapp_conversation_lead_binding(
  organization_id, conversation_id, lead_id, null
) as activated
from fresh_live_cases;

create temp table fresh_live_roots on commit drop as
select f.*, private.capture_whatsapp_webhook_routing_snapshot_v2(
  f.organization_id, f.session_id, f.root_id, f.root_id, f.root_lane, 'phone:' || f.phone,
  true, array[f.phone || '@s.whatsapp.net'], f.phone,
  'organic', null, false, false, false, null, null, null, f.processing_epoch
) as snapshot
from fresh_live_cases f;

select is((select count(*) from fresh_live_roots where snapshot->>'state' = 'bound'
  and snapshot->>'event_lead_id' = lead_id::text and snapshot->>'active_binding_id' is not null),
  14::bigint, 'v2 established fourteen exact bound predecessors');

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload, processing_lane, processing_epoch,
  status, attempts, created_at, dead_lettered_at, locked_at, locked_by,
  edge_execution_id, edge_execution_state, edge_execution_reserved_at
)
select
  case when scenario = 'foreign-inbox' then 'd2100000-0000-4000-8000-000000000002'::uuid else organization_id end,
  case when scenario = 'foreign-inbox' then 'd2300000-0000-4000-8000-000000000002'::uuid else session_id end,
  root_id, case when scenario = 'non-message' then 'receipt' else 'message' end,
  jsonb_build_object('synthetic', true, '__vimob_ingress', jsonb_build_object(
    'routing_key', snapshot->>'routing_key', 'epoch_capable', true, 'routing_snapshot',
    jsonb_build_object('version', 1, 'messages',
      jsonb_build_array(jsonb_set(snapshot, '{processing_epoch}', to_jsonb(inbox_epoch)))))),
  root_lane, inbox_epoch, root_status, case when root_status = 'dead' then 12 else 0 end,
  now() - interval '3 hours',
  case when root_status = 'dead' and scenario <> 'missing-dead-at' then now() - interval '2 hours' end,
  case when scenario = 'locked' then now() end,
  case when scenario = 'locked' then 'synthetic-worker' end,
  case when scenario = 'edge-lease' then 'd2600000-0000-4000-8000-000000000001'::uuid end,
  case when scenario = 'edge-lease' then 'reserved' end,
  case when scenario = 'edge-lease' then now() end
from fresh_live_roots where root_status is not null;

insert into public.whatsapp_webhook_routing_outcomes (
  organization_id, session_id, provider_message_id, ingress_sequence, completed_inbox_event_key
)
select organization_id, session_id, root_id, (snapshot->>'ingress_sequence')::bigint, root_id
from fresh_live_roots where scenario = 'completed';

-- A new binding on the same conversation and lead is still a different authorization generation.
update public.whatsapp_conversation_lead_bindings as binding
set active_to = clock_timestamp()
from fresh_live_cases as f
where f.scenario = 'binding-changed' and binding.conversation_id = f.conversation_id and binding.active_to is null;

insert into public.whatsapp_conversation_lead_bindings (organization_id, session_id, conversation_id, lead_id)
select organization_id, session_id, conversation_id, lead_id from fresh_live_cases where scenario = 'binding-changed';

create temp table fresh_live_saved_inbox on commit drop as
select i.id, to_jsonb(i) as original
from public.whatsapp_webhook_inbox i join fresh_live_roots r on r.root_id = i.event_key;

create function pg_temp.admit_fresh_live(f fresh_live_cases, provider_id text) returns jsonb
language sql volatile as $$
  select private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3(
    f.organization_id, f.session_id, provider_id, provider_id, f.candidate_lane, 'phone:' || f.phone,
    true, array[f.phone || '@s.whatsapp.net'], f.phone,
    'organic', null, false, false, false, null, null, null, f.processing_epoch
  );
$$;

create temp table fresh_live_admitted on commit drop as
select f.*, pg_temp.admit_fresh_live(f, 'fresh-admission-' || scenario || '-new') as admitted
from fresh_live_cases f;

select is(admitted->>'state', expected_state, 'v3 admission preserves the expected state for ' || scenario)
from fresh_live_admitted order by slot;

select ok((select admitted->>'target_mode' = 'snapshot'
    and admitted->>'predecessor_provider_message_id' is null
    and admitted->>'event_lead_id' = a.lead_id::text
    and admitted->>'conversation_id' = a.conversation_id::text
    and admitted->>'active_binding_id' = r.snapshot->>'active_binding_id'
  from fresh_live_admitted a join fresh_live_roots r using (scenario)
  where a.scenario = 'dead-backlog'),
  'fresh live admission keeps the exact conversation, lead and active binding');

select is((select count(*) from fresh_live_admitted
    where expected_state = 'predecessor_inherit' and admitted->>'predecessor_provider_message_id' = root_id),
  11::bigint, 'protected admissions keep their exact predecessor identity');

insert into public.whatsapp_webhook_inbox (
  organization_id, session_id, event_key, event_type, payload, processing_lane, processing_epoch
)
select organization_id, session_id, admitted->>'inbox_event_key', 'message',
  jsonb_build_object('__vimob_ingress', jsonb_build_object(
    'routing_key', admitted->>'routing_key', 'routing_snapshot',
    jsonb_build_object('version', 1, 'messages', jsonb_build_array(admitted)))),
  'live', processing_epoch
from fresh_live_admitted where scenario = 'dead-backlog';

create temp table fresh_live_successor on commit drop as
select pg_temp.admit_fresh_live(f, 'fresh-admission-dead-backlog-successor') as admitted
from fresh_live_cases f where f.scenario = 'dead-backlog';

select ok((select admitted->>'state' = 'predecessor_inherit'
    and admitted->>'predecessor_provider_message_id' = 'fresh-admission-dead-backlog-new'
    and admitted->>'predecessor_processing_lane' = 'live' from fresh_live_successor),
  'the next fresh callback depends on the newest unresolved live event');

select is((select count(*) from fresh_live_saved_inbox s
  join public.whatsapp_webhook_inbox i on i.id = s.id and to_jsonb(i) = s.original),
  13::bigint, 'v3 admission preserves historical payloads, statuses and leases');

select is((select count(*) from fresh_live_roots r
  join public.whatsapp_webhook_routing_snapshots s on s.organization_id = r.organization_id
    and s.session_id = r.session_id and s.provider_message_id = r.root_id and s.snapshot = r.snapshot),
  14::bigint, 'v3 admission preserves all fourteen immutable root snapshots');

select is((select array_agg(o.provider_message_id order by o.provider_message_id)
  from public.whatsapp_webhook_routing_outcomes o
  where o.organization_id = 'd2100000-0000-4000-8000-000000000001'),
  array['fresh-admission-completed-old']::text[], 'v3 admission creates no completion proof');

select * from finish();
rollback;
