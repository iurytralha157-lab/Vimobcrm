begin;

create extension if not exists pgtap with schema extensions;
select plan(25);

select ok(
  obj_description(
    'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure,
    'pg_proc'
  ) like 'automation_whatsapp_binding_fence_v2:%',
  'resolver exposes the reviewed binding-fence version marker'
);
select ok(
  obj_description(
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure,
    'pg_proc'
  ) like 'automation_whatsapp_binding_fence_v2:%',
  'enqueue exposes the reviewed binding-fence version marker'
);
select ok(
  obj_description('public.claim_automation_events(text,integer)'::regprocedure, 'pg_proc')
    like 'automation_event_binding_epoch_v2:%',
  'event claim exposes the reviewed binding-epoch version marker'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)',
    'execute'
  ),
  'authenticated cannot invoke the binding-fenced resolver'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)',
    'execute'
  ),
  'authenticated cannot invoke the binding-fenced enqueue'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.claim_automation_events(text,integer)',
    'execute'
  ),
  'authenticated cannot invoke the binding-epoch event claim'
);

-- Local development retains a historical NOT NULL session name. Keep the
-- fixture portable without changing the production contract.
do $compat_local_whatsapp_session_name$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute
    where attrelid = 'public.whatsapp_sessions'::regclass
      and attname = 'name'
      and not attisdropped
  ) then
    execute $sql$
      alter table public.whatsapp_sessions
      alter column name set default 'automation binding fence test'
    $sql$;
  end if;
end;
$compat_local_whatsapp_session_name$;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values (
  '00000000-0000-0000-0000-000000000000',
  'af000000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'automation-fence@example.test',
  crypt('test-password', gen_salt('bf', 4)), now(),
  '{"provider":"email","providers":["email"]}', '{}', now(), now(),
  '', '', '', ''
);

insert into public.organizations (id, name, slug, is_active)
values (
  'af100000-0000-4000-8000-000000000001',
  'Automation binding fences',
  'automation-binding-fences',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'af000000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  'Automation Fence Owner',
  'automation-fence@example.test',
  'admin',
  true
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values (
  'af100000-0000-4000-8000-000000000001',
  'af000000-0000-4000-8000-000000000001',
  'admin',
  true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

-- Leads are inserted before the automations module is enabled so their normal
-- lead_created triggers do not pollute the event-claim fixture.
insert into public.leads (id, organization_id, assigned_user_id, name, phone, source)
values
  (
    'af200000-0000-4000-8000-000000000001',
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'Automation Fence Lead A', '5511988880001', 'manual'
  ),
  (
    'af200000-0000-4000-8000-000000000002',
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'Automation Fence Lead B', '5511988880002', 'manual'
  );

insert into public.whatsapp_sessions (
  id, organization_id, owner_user_id, instance_name, provider, status, is_active
) values
  (
    'af300000-0000-4000-8000-000000000001',
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'automation-fence-session-a', 'evolution_go', 'connected', true
  ),
  (
    'af300000-0000-4000-8000-000000000002',
    'af100000-0000-4000-8000-000000000001',
    'af000000-0000-4000-8000-000000000001',
    'automation-fence-session-b', 'evolution_go', 'connected', true
  );

insert into public.automations (
  id, organization_id, name, is_active, trigger_type, trigger_config, flow_definition
) values (
  'af400000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  'Automation binding fence flow', false, 'manual', '{}', '{}'
);

insert into public.automation_flow_versions (
  id, automation_id, organization_id, version, trigger_type, trigger_config,
  graph, graph_checksum, first_node_key, requires_review, created_by
) values (
  'af500000-0000-4000-8000-000000000001',
  'af400000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  1, 'manual', '{}',
  '{"nodes":[{"id":"send","type":"action","action_type":"send_whatsapp","config":{"session_id":"af300000-0000-4000-8000-000000000001"}}],"connections":[],"settings":{}}',
  'automation-binding-fence-v1', 'send', false,
  'af000000-0000-4000-8000-000000000001'
);

update public.automations
set active_flow_version_id = 'af500000-0000-4000-8000-000000000001',
    is_active = true
where id = 'af400000-0000-4000-8000-000000000001';

insert into public.organization_modules (organization_id, module_name, is_enabled)
values ('af100000-0000-4000-8000-000000000001', 'automations', true);

insert into public.automation_executions (
  id, automation_id, flow_version_id, organization_id, lead_id,
  status, current_node_key, locked_by, locked_at, attempt_count
) values (
  'af600000-0000-4000-8000-000000000001',
  'af400000-0000-4000-8000-000000000001',
  'af500000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000001',
  'running', 'send', 'lease-a', now(), 1
);

create temporary table automation_fence_resolution as
select public.resolve_automation_whatsapp_conversation(
  'af100000-0000-4000-8000-000000000001',
  'af600000-0000-4000-8000-000000000001',
  'send', 'lease-a',
  'af300000-0000-4000-8000-000000000001'
) as value;

select ok(
  coalesce((select (value->>'ok')::boolean from automation_fence_resolution), false),
  'resolver creates and binds an initially unlinked conversation'
);
select is(
  (
    select lead_id
    from public.whatsapp_conversations
    where id = (select (value->>'id')::uuid from automation_fence_resolution)
  ),
  'af200000-0000-4000-8000-000000000001'::uuid,
  'resolved conversation belongs to the target lead'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = (select (value->>'id')::uuid from automation_fence_resolution)
      and active_to is null
  ),
  1,
  'resolver leaves exactly one active canonical binding'
);

select ok(
  coalesce((public.resolve_automation_whatsapp_conversation(
    'af100000-0000-4000-8000-000000000001',
    'af600000-0000-4000-8000-000000000001',
    'send', 'lease-a',
    'af300000-0000-4000-8000-000000000001'
  )->>'ok')::boolean, false),
  'resolver replay is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_conversation_lead_bindings
    where conversation_id = (select (value->>'id')::uuid from automation_fence_resolution)
      and active_to is null
  ),
  1,
  'resolver replay does not rotate or duplicate the active binding'
);

insert into public.automation_effect_dispatches (
  organization_id, execution_id, node_key, effect_key, effect_type, status, request
) values (
  'af100000-0000-4000-8000-000000000001',
  'af600000-0000-4000-8000-000000000001',
  'send',
  'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp',
  'send_whatsapp',
  'sending',
  '{"delivery_contract":"canonical_whatsapp_outbox_v1","session_id":"af300000-0000-4000-8000-000000000001"}'
);

create temporary table automation_fence_enqueue as
select public.enqueue_automation_whatsapp_outbox(
  'af100000-0000-4000-8000-000000000001',
  'af600000-0000-4000-8000-000000000001',
  'send', 'lease-a',
  'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'af300000-0000-4000-8000-000000000001',
  'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp',
  'text', 'binding-fenced delivery', null, null, null, null
) as value;

select ok(
  coalesce((select (value->>'ok')::boolean from automation_fence_enqueue), false),
  'binding-fenced enqueue accepts the current execution epoch'
);
select ok(
  (select count(*) = 1 from public.whatsapp_messages
    where client_message_id = 'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp')
  and
  (select count(*) = 1 from public.whatsapp_outbox
    where client_message_id = 'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp'),
  'enqueue persists exactly one message and one outbox row'
);
select is(
  public.enqueue_automation_whatsapp_outbox(
    'af100000-0000-4000-8000-000000000001',
    'af600000-0000-4000-8000-000000000001',
    'send', 'lease-a',
    'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp',
    (select (value->>'id')::uuid from automation_fence_resolution),
    'af300000-0000-4000-8000-000000000001',
    'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp',
    'text', 'binding-fenced delivery', null, null, null, null
  )->>'outbox_id',
  (select value->>'outbox_id' from automation_fence_enqueue),
  'exact enqueue replay preserves the canonical outbox response id'
);

update public.automation_executions
set status = 'completed',
    completed_at = now(),
    locked_by = null,
    locked_at = null
where id = 'af600000-0000-4000-8000-000000000001';

select public.activate_whatsapp_conversation_lead_binding(
  'af100000-0000-4000-8000-000000000001',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'af200000-0000-4000-8000-000000000002',
  null
);

select is(
  (
    select status
    from public.whatsapp_outbox
    where client_message_id = 'automation:af600000-0000-4000-8000-000000000001:send:send_whatsapp'
  ),
  'dead',
  'enqueue-first work is terminally cancelled by a later rebind'
);

insert into public.whatsapp_conversations (
  id, organization_id, session_id, remote_jid, contact_phone, is_group
) values (
  'af700000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  'af300000-0000-4000-8000-000000000002',
  '5511988880001@s.whatsapp.net', '5511988880001', false
);

select public.activate_whatsapp_conversation_lead_binding(
  'af100000-0000-4000-8000-000000000001',
  'af700000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000001',
  null
);
select public.activate_whatsapp_conversation_lead_binding(
  'af100000-0000-4000-8000-000000000001',
  'af700000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000002',
  null
);

insert into public.automation_executions (
  id, automation_id, flow_version_id, organization_id, lead_id, conversation_id,
  status, current_node_key, locked_by, locked_at, attempt_count
) values (
  'af600000-0000-4000-8000-000000000002',
  'af400000-0000-4000-8000-000000000001',
  'af500000-0000-4000-8000-000000000001',
  'af100000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000001',
  'af700000-0000-4000-8000-000000000001',
  'running', 'send', 'lease-rebind-first', now(), 1
);
insert into public.automation_effect_dispatches (
  organization_id, execution_id, node_key, effect_key, effect_type, status, request
) values (
  'af100000-0000-4000-8000-000000000001',
  'af600000-0000-4000-8000-000000000002',
  'send',
  'automation:af600000-0000-4000-8000-000000000002:send:send_whatsapp',
  'send_whatsapp', 'sending',
  '{"delivery_contract":"canonical_whatsapp_outbox_v1","session_id":"af300000-0000-4000-8000-000000000002"}'
);

select throws_ok(
  $$select public.enqueue_automation_whatsapp_outbox(
    'af100000-0000-4000-8000-000000000001',
    'af600000-0000-4000-8000-000000000002',
    'send', 'lease-rebind-first',
    'automation:af600000-0000-4000-8000-000000000002:send:send_whatsapp',
    'af700000-0000-4000-8000-000000000001',
    'af300000-0000-4000-8000-000000000002',
    'automation:af600000-0000-4000-8000-000000000002:send:send_whatsapp',
    'text', 'must not escape after rebind', null, null, null, null
  )$$,
  '23514',
  'automation_whatsapp_queue_context_mismatch',
  'rebind-first makes the stale execution fail closed'
);
select is(
  (
    select count(*)::integer
    from public.whatsapp_messages
    where client_message_id = 'automation:af600000-0000-4000-8000-000000000002:send:send_whatsapp'
  ),
  0,
  'rebind-first failure creates no stale-lead message row'
);

-- The first conversation is currently bound to lead B. A current inbound
-- message must be claimable under exactly that binding epoch.
insert into public.whatsapp_messages (
  organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, received_at, metadata
) values (
  'af100000-0000-4000-8000-000000000001',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'af300000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000002',
  'automation-fence-inbound-current',
  'automation-fence-inbound-current',
  false, 'inbound', 'text', 'current epoch', 'received', now(),
  '{"whatsapp_event_binding_is_current":true}'
);

create temporary table automation_fence_claim_current as
select * from public.claim_automation_events('automation-fence-worker', 10);

select is(
  (
    select count(*)::integer
    from automation_fence_claim_current
    where event_type = 'message_received'
      and aggregate_type = 'whatsapp_message'
  ),
  1,
  'current message_received epoch is claimed once'
);

update public.automation_event_outbox
set status = 'completed',
    completed_at = now(),
    locked_at = null,
    locked_by = null
where aggregate_id = (
  select id
  from public.whatsapp_messages
  where provider_message_id = 'automation-fence-inbound-current'
);

insert into public.whatsapp_messages (
  organization_id, conversation_id, session_id, lead_id,
  provider_message_id, message_id, from_me, direction,
  message_type, content, status, received_at, metadata
) values (
  'af100000-0000-4000-8000-000000000001',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'af300000-0000-4000-8000-000000000001',
  'af200000-0000-4000-8000-000000000002',
  'automation-fence-inbound-stale',
  'automation-fence-inbound-stale',
  false, 'inbound', 'text', 'old epoch', 'received', now(),
  '{"whatsapp_event_binding_is_current":true}'
);

select public.activate_whatsapp_conversation_lead_binding(
  'af100000-0000-4000-8000-000000000001',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'af200000-0000-4000-8000-000000000001',
  null
);

update public.automation_event_outbox
set status = 'pending',
    dead_lettered_at = null,
    last_error = null,
    locked_at = null,
    locked_by = null,
    available_at = now()
where aggregate_id = (
  select id
  from public.whatsapp_messages
  where provider_message_id = 'automation-fence-inbound-stale'
);

insert into public.automation_event_outbox (
  id, organization_id, event_type, aggregate_type, aggregate_id,
  lead_id, conversation_id, dedupe_key, payload, status, available_at
) values
  (
    'af800000-0000-4000-8000-000000000001',
    'af100000-0000-4000-8000-000000000001',
    'scheduled', 'lead', 'af200000-0000-4000-8000-000000000001',
    'af200000-0000-4000-8000-000000000001', null,
    'automation-fence-hard-delete-trace',
    '{"lead_id":"af200000-0000-4000-8000-000000000001","conversation_id":"af700000-0000-4000-8000-000000000001","whatsapp_binding_id":"af900000-0000-4000-8000-000000000001"}',
    'pending', now()
  ),
  (
    'af800000-0000-4000-8000-000000000002',
    'af100000-0000-4000-8000-000000000001',
    'scheduled', 'lead', 'af200000-0000-4000-8000-000000000001',
    'af200000-0000-4000-8000-000000000001', null,
    'automation-fence-lead-only',
    '{"lead_id":"af200000-0000-4000-8000-000000000001","causal_depth":0}',
    'pending', now()
  );

insert into public.automation_event_outbox (
  id, organization_id, event_type, aggregate_type, aggregate_id,
  lead_id, conversation_id, dedupe_key, payload, status, attempts,
  max_attempts, locked_at, locked_by, available_at
) values (
  'af800000-0000-4000-8000-000000000003',
  'af100000-0000-4000-8000-000000000001',
  'message_received', 'whatsapp_message',
  'af810000-0000-4000-8000-000000000003',
  'af200000-0000-4000-8000-000000000001',
  (select (value->>'id')::uuid from automation_fence_resolution),
  'automation-fence-exhausted-conversation-event',
  jsonb_build_object(
    'lead_id', 'af200000-0000-4000-8000-000000000001',
    'conversation_id', (select value->>'id' from automation_fence_resolution),
    'session_id', 'af300000-0000-4000-8000-000000000001',
    'whatsapp_binding_id', 'af900000-0000-4000-8000-000000000003',
    'message_id', 'af810000-0000-4000-8000-000000000003'
  ),
  'processing', 3, 3, now() - interval '10 minutes',
  'automation-fence-expired-worker', now()
);

create temporary table automation_fence_claim_after_rebind as
select * from public.claim_automation_events('automation-fence-worker-2', 10);

select is(
  (
    select last_error
    from public.automation_event_outbox
    where aggregate_id = (
      select id
      from public.whatsapp_messages
      where provider_message_id = 'automation-fence-inbound-stale'
    )
  ),
  'automation_event_binding_epoch_stale',
  'stale message binding epoch becomes terminal with an auditable reason'
);
select is(
  (
    select status
    from public.automation_event_outbox
    where id = 'af800000-0000-4000-8000-000000000001'
  ),
  'dead_letter',
  'an orphaned conversation trace is never reclassified as lead-only work'
);
select is(
  (
    select status
    from public.automation_event_outbox
    where id = 'af800000-0000-4000-8000-000000000002'
  ),
  'processing',
  'a genuine lead-only event remains claimable'
);
select is(
  (
    select status || ':' || last_error
    from public.automation_event_outbox
    where id = 'af800000-0000-4000-8000-000000000003'
  ),
  'dead_letter:retry_exhausted',
  'an exhausted conversation event is terminalized without an event-first sweep'
);

select ok(
  (
    with definitions as (
      select
        lower(pg_get_functiondef(
          'public.resolve_automation_whatsapp_conversation(uuid,uuid,text,text,uuid)'::regprocedure
        )) as resolver,
        lower(pg_get_functiondef(
          'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
        )) as enqueue,
        lower(pg_get_functiondef(
          'public.claim_automation_events(text,integer)'::regprocedure
        )) as claim
    )
    select
      position('canonical lock order begins here' in resolver)
        < position('into v_locked_execution' in resolver)
      and position('into locked_conversation' in enqueue) > 0
      and position('into locked_conversation' in enqueue)
        < position('into locked_binding' in enqueue)
      and position('into locked_binding' in enqueue)
        < position('into locked_execution' in enqueue)
      and position('into locked_execution' in enqueue)
        < position('into locked_dispatch' in enqueue)
      and position('into v_conversation' in claim) > 0
      and position('into v_conversation' in claim)
        < position('this is the first event-row lock in the exhaustion sweep' in claim)
      and position('with exhausted_candidates as' in claim) = 0
      and position('into v_binding' in claim)
        < position('this is the first event-row lock for the candidate' in claim)
    from definitions
  ),
  'all three RPCs retain the reviewed conversation-first lock order'
);
select ok(
  position(
    'update public.leads'
    in lower(pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    ))
  ) = 0,
  'enqueue no longer performs the cosmetic lead updated_at write'
);
select ok(
  position(
    'for update of'
    in lower(pg_get_functiondef(
      'public.enqueue_automation_whatsapp_outbox(uuid,uuid,text,text,text,uuid,uuid,text,text,text,text,text,bigint,text)'::regprocedure
    ))
  ) = 0,
  'enqueue never takes a multi-relation FOR UPDATE lock'
);

select * from finish();
rollback;
