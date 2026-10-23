begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

-- A disposable tenant keeps the proof independent from real conversations.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'f9100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'inherited-proof@example.test', '', now(),
  '{}', '{}', now(), now(), '', '', '', ''
);
insert into public.organizations (id, name, slug, is_active)
values ('f9200000-0000-4000-8000-000000000001',
        'Inherited proof fixture', 'inherited-proof-fixture', true);
insert into public.users (id, organization_id, name, email, role, is_active)
values ('f9100000-0000-4000-8000-000000000001',
        'f9200000-0000-4000-8000-000000000001',
        'Inherited proof user', 'inherited-proof@example.test', 'admin', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;
insert into public.organization_members (organization_id, user_id, role, is_active)
values ('f9200000-0000-4000-8000-000000000001',
        'f9100000-0000-4000-8000-000000000001', 'admin', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = null;
insert into public.leads (id, organization_id, assigned_user_id, name, source)
values ('f9400000-0000-4000-8000-000000000001',
        'f9200000-0000-4000-8000-000000000001',
        'f9100000-0000-4000-8000-000000000001',
        'Inherited proof lead', 'whatsapp');
insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, status, provider
) values (
  'f9500000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  'f9100000-0000-4000-8000-000000000001',
  'inherited-proof-instance', 'connected', 'evolution_go'
);
insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_name, assigned_user_id
) values (
  'f9600000-0000-4000-8000-000000000001',
  'f9200000-0000-4000-8000-000000000001',
  'f9500000-0000-4000-8000-000000000001',
  '5511999991234@s.whatsapp.net', 'Inherited proof contact',
  'f9100000-0000-4000-8000-000000000001'
);

create function pg_temp.inherited_route(
  p_provider text, p_event_key text, p_lane text, p_epoch integer,
  p_predecessor text default null, p_predecessor_key text default null,
  p_predecessor_lane text default null
) returns void language plpgsql as $$
declare
  v_sequence bigint := nextval('public.whatsapp_webhook_routing_ingress_sequence');
  v_snapshot jsonb;
begin
  v_snapshot := pg_catalog.jsonb_build_object(
    'version', 1,
    'organization_id', 'f9200000-0000-4000-8000-000000000001',
    'session_id', 'f9500000-0000-4000-8000-000000000001',
    'provider_message_id', p_provider,
    'inbox_event_key', p_event_key,
    'processing_lane', p_lane,
    'routing_key', 'phone:5511999991234',
    'ingress_sequence', v_sequence,
    'binding_eligible', true,
    'target_mode', case when p_predecessor is null then 'snapshot' else 'inherit_predecessor' end,
    'state', case when p_predecessor is null then 'bound' else 'predecessor_inherit' end,
    'context_kind', 'organic',
    'event_lead_id', case when p_predecessor is null
      then 'f9400000-0000-4000-8000-000000000001' else null end,
    'predecessor_provider_message_id', p_predecessor,
    'predecessor_inbox_event_key', p_predecessor_key,
    'predecessor_processing_lane', p_predecessor_lane,
    'captured_at', pg_catalog.clock_timestamp()
  );
  -- Epoch-zero rows created before the generation column had no JSON epoch.
  if p_epoch = 1 then
    v_snapshot := v_snapshot || '{"processing_epoch":1}'::jsonb;
  end if;
  insert into public.whatsapp_webhook_routing_snapshots (
    organization_id, session_id, provider_message_id, inbox_event_key,
    processing_lane, routing_key, ingress_sequence,
    predecessor_provider_message_id, binding_eligible, target_mode,
    processing_epoch, snapshot
  ) values (
    'f9200000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000001',
    p_provider, p_event_key, p_lane, 'phone:5511999991234',
    v_sequence, p_predecessor, true,
    case when p_predecessor is null then 'snapshot' else 'inherit_predecessor' end,
    p_epoch, v_snapshot
  );
end;
$$;

select ok(
  not has_function_privilege(
    'service_role',
    'private.whatsapp_inherited_predecessor_provenance_matches(public.whatsapp_webhook_routing_snapshots,public.whatsapp_webhook_routing_snapshots)',
    'execute'
  ),
  'private provenance comparator is not a Data API service entrypoint'
);

select pg_temp.inherited_route('proof-p0', 'proof-k0', 'live', 0);
do $$
begin
  perform public.activate_whatsapp_conversation_lead_binding(
    'f9200000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001', 'proof-p0'
  );
end;
$$;
insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'proof-k0', pg_catalog.clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where provider_message_id = 'proof-p0'
  and organization_id = 'f9200000-0000-4000-8000-000000000001';

-- This fixture tests inherited-route provenance, not cutover activation.
-- The disposable hybrid clone has an extra required cutoff_at column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'private'
      and table_name = 'whatsapp_webhook_session_cutovers'
      and column_name = 'cutoff_at'
  ) then
    insert into private.whatsapp_webhook_session_cutovers (
      session_id, active_epoch, cutover_at, activated_at, cutoff_at
    ) values (
      'f9500000-0000-4000-8000-000000000001',
      1, clock_timestamp(), clock_timestamp(), clock_timestamp()
    );
  else
    insert into private.whatsapp_webhook_session_cutovers (
      session_id, active_epoch, cutover_at, activated_at
    ) values (
      'f9500000-0000-4000-8000-000000000001',
      1, clock_timestamp(), clock_timestamp()
    );
  end if;
end;
$$;
select pg_temp.inherited_route('proof-cross', 'proof-cross-key', 'live', 1,
                               'proof-p0', 'proof-k0', 'live');

select throws_ok(
  $$select public.resolve_whatsapp_webhook_inherited_routing_target(
      'f9200000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000001', 'proof-cross')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'resolver rejects a predecessor from the retained epoch'
);
select throws_ok(
  $$select public.activate_whatsapp_conversation_lead_binding_if_current(
      'f9200000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000001',
      'f9400000-0000-4000-8000-000000000001', 'proof-cross',
      (select id from public.whatsapp_conversation_lead_bindings
       where conversation_id = 'f9600000-0000-4000-8000-000000000001'
         and active_to is null),
      'f9400000-0000-4000-8000-000000000001')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'binding CAS rejects the same cross-epoch predecessor'
);

select pg_temp.inherited_route('proof-p1', 'proof-k1', 'backlog', 1);
do $$
begin
  perform public.activate_whatsapp_conversation_lead_binding_if_current(
    'f9200000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001', 'proof-p1',
    (select id from public.whatsapp_conversation_lead_bindings
     where conversation_id = 'f9600000-0000-4000-8000-000000000001'
       and active_to is null),
    'f9400000-0000-4000-8000-000000000001'
  );
end;
$$;
insert into public.whatsapp_webhook_routing_outcomes
select organization_id, session_id, provider_message_id, ingress_sequence,
       'proof-k1', pg_catalog.clock_timestamp()
from public.whatsapp_webhook_routing_snapshots
where provider_message_id = 'proof-p1'
  and organization_id = 'f9200000-0000-4000-8000-000000000001';

select pg_temp.inherited_route('proof-bad-key', 'proof-bad-key-event', 'live', 1,
                               'proof-p1', 'wrong-predecessor-key', 'backlog');
select pg_temp.inherited_route('proof-bad-lane', 'proof-bad-lane-event', 'live', 1,
                               'proof-p1', 'proof-k1', 'live');
select pg_temp.inherited_route('proof-good', 'proof-good-event', 'live', 1,
                               'proof-p1', 'proof-k1', 'backlog');

select throws_ok(
  $$select public.resolve_whatsapp_webhook_inherited_routing_target(
      'f9200000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000001', 'proof-bad-key')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'resolver rejects a frozen predecessor inbox key that differs from the ledger'
);
select throws_ok(
  $$select public.activate_whatsapp_conversation_lead_binding_if_current(
      'f9200000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000001',
      'f9400000-0000-4000-8000-000000000001', 'proof-bad-key',
      (select id from public.whatsapp_conversation_lead_bindings
       where conversation_id = 'f9600000-0000-4000-8000-000000000001'
         and active_to is null),
      'f9400000-0000-4000-8000-000000000001')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'binding CAS rejects the wrong predecessor inbox key'
);
select throws_ok(
  $$select public.resolve_whatsapp_webhook_inherited_routing_target(
      'f9200000-0000-4000-8000-000000000001',
      'f9500000-0000-4000-8000-000000000001', 'proof-bad-lane')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'resolver rejects a frozen predecessor lane that differs from the ledger'
);
select throws_ok(
  $$select public.activate_whatsapp_conversation_lead_binding_if_current(
      'f9200000-0000-4000-8000-000000000001',
      'f9600000-0000-4000-8000-000000000001',
      'f9400000-0000-4000-8000-000000000001', 'proof-bad-lane',
      (select id from public.whatsapp_conversation_lead_bindings
       where conversation_id = 'f9600000-0000-4000-8000-000000000001'
         and active_to is null),
      'f9400000-0000-4000-8000-000000000001')$$,
  '23514', 'whatsapp_ingress_predecessor_chain_invalid',
  'binding CAS rejects the wrong predecessor lane'
);

select is(
  public.resolve_whatsapp_webhook_inherited_routing_target(
    'f9200000-0000-4000-8000-000000000001',
    'f9500000-0000-4000-8000-000000000001', 'proof-good'
  )->>'lead_id',
  'f9400000-0000-4000-8000-000000000001',
  'same-epoch route with exact predecessor provenance still resolves'
);
select ok(
  (public.activate_whatsapp_conversation_lead_binding_if_current(
    'f9200000-0000-4000-8000-000000000001',
    'f9600000-0000-4000-8000-000000000001',
    'f9400000-0000-4000-8000-000000000001', 'proof-good',
    (select id from public.whatsapp_conversation_lead_bindings
     where conversation_id = 'f9600000-0000-4000-8000-000000000001'
       and active_to is null),
    'f9400000-0000-4000-8000-000000000001'
  )->>'is_current')::boolean,
  'binding CAS still advances the exact same-epoch chain'
);
select ok(
  pg_catalog.pg_get_functiondef(
    'public.resolve_whatsapp_webhook_inherited_routing_target(uuid,uuid,text)'::regprocedure
  ) like '%private.whatsapp_inherited_predecessor_provenance_matches(v_route, v_predecessor)%'
  and pg_catalog.pg_get_functiondef(
    'public.activate_whatsapp_conversation_lead_binding_if_current(uuid,uuid,uuid,text,uuid,uuid)'::regprocedure
  ) like '%private.whatsapp_inherited_predecessor_provenance_matches(v_route, v_predecessor_route)%',
  'both SQL authorities independently enforce the provenance comparator'
);

select * from finish();
rollback;
