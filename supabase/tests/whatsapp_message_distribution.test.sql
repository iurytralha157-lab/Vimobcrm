begin;

create extension if not exists pgtap with schema extensions;
select plan(37);

select has_function(
  'public',
  'whatsapp_webhook_has_lead_creation_context',
  array['jsonb'],
  'the WhatsApp lead-creation context guard exists'
);

select ok(
  position('inbound_rule.session_id = managed_context.session_id' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) > 0
  and position('enable_redistribution' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) = 0
  and position('ignore_availability' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) = 0
  and position('require_checkin' in lower(pg_get_functiondef(
    'public.whatsapp_webhook_has_lead_creation_context(jsonb)'::regprocedure
  ))) > 0,
  'lead creation requires the exact active session and rejects unsupported check-in without overriding ordinary queue settings'
);

select has_function(
  'public',
  'handle_managed_whatsapp_message_lead',
  array['uuid'],
  'managed WhatsApp message assignment function exists'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.handle_managed_whatsapp_message_lead(uuid)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke managed assignment directly'
);

select is(
  has_function_privilege(
    'service_role',
    'public.handle_managed_whatsapp_message_lead(uuid)',
    'execute'
  ),
  true,
  'the trusted webhook processor can invoke managed assignment'
);

select ok(
  position('managed_whatsapp_message_distribution' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed intent is fail-closed in the database function'
);

select ok(
  position('whatsapp_message_contains' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the database validates the exact managed round-robin rule type'
);

select ok(
  position('private.distribute_lead' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed WhatsApp assignment delegates to the canonical distribution boundary'
);

select ok(
  position('v_resolved_queue_id' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('public.round_robin_members' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) = 0
  and position('queue.strategy' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) = 0,
  'the managed handler leaves team expansion and queue strategy to the canonical distributor'
);

select ok(
  position('enable_redistribution' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) = 0,
  'managed assignment no longer disables automatic redistribution'
);

select ok(
  position('managed-whatsapp:' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('distribution_event_id' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'managed assignment is idempotent and keeps its routing metadata on the canonical log'
);

select ok(
  position('lower(normalized.keyword)' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the full case-insensitive message keyword is validated without comma splitting'
);

select ok(
  position('nullif(v_lead.initial_message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0
  and position('v_lead.message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > position('nullif(v_lead.initial_message' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))),
  'initial assignment keeps matching against the immutable initial WhatsApp message first'
);

select has_function(
  'public',
  'handle_routed_lead_intake',
  array['uuid'],
  'the routed intake dispatcher exists'
);

select ok(
  position('if not v_marker then' in lower(pg_get_functiondef(
    'public.handle_managed_whatsapp_message_lead(uuid)'::regprocedure
  ))) > 0,
  'the managed handler refuses to distribute an unmarked lead'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.handle_routed_lead_intake(uuid)',
    'execute'
  ),
  false,
  'authenticated users cannot invoke the routed intake dispatcher directly'
);

select is(
  has_function_privilege(
    'service_role',
    'public.handle_routed_lead_intake(uuid)',
    'execute'
  ),
  true,
  'the trusted webhook processor can invoke the routed intake dispatcher'
);

select ok(
  position('handle_managed_whatsapp_message_lead' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('whatsapp_webhook_has_lead_creation_context' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('private.distribute_lead' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0
  and position('public.handle_lead_intake' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) = 0,
  'the dispatcher fails managed leads closed while both managed and generic intake use canonical distribution'
);

select ok(
  position('distribution_deferred' in lower(pg_get_functiondef(
    'public.handle_routed_lead_intake(uuid)'::regprocedure
  ))) > 0,
  'direct dispatcher calls preserve deferred non-managed leads'
);

select ok(
  position('handle_routed_lead_intake' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0
  and position('distribution_deferred' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0
  and position('managed_whatsapp_message_distribution' in lower(pg_get_functiondef(
    'public.trigger_handle_lead_intake()'::regprocedure
  ))) > 0,
  'the insert trigger routes through the dispatcher while preserving explicit deferred intake'
);

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at,
  confirmation_token,
  email_change,
  email_change_token_new,
  recovery_token
)
select
  '00000000-0000-0000-0000-000000000000',
  fixture.id,
  'authenticated',
  'authenticated',
  fixture.email,
  crypt('test-password', gen_salt('bf', 4)),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  now(),
  now(),
  '',
  '',
  '',
  ''
from (
  values
    (
      'e2000000-0000-4000-8000-000000000001'::uuid,
      'managed-whatsapp-inside-scale@example.test'
    ),
    (
      'e2000000-0000-4000-8000-000000000002'::uuid,
      'managed-whatsapp-outside-scale@example.test'
    )
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    'Managed WhatsApp Canonical Org',
    'managed-whatsapp-canonical-org',
    true
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'Managed WhatsApp Foreign Org',
    'managed-whatsapp-foreign-org',
    true
  );

insert into public.users (
  id,
  organization_id,
  name,
  email,
  role,
  is_active
)
values
  (
    'e2000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Inside Scale',
    'managed-whatsapp-inside-scale@example.test',
    'user',
    true
  ),
  (
    'e2000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'Outside Scale',
    'managed-whatsapp-outside-scale@example.test',
    'user',
    true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (
  organization_id,
  user_id,
  role,
  is_active
)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    'user',
    true
  ),
  (
    'e1000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002',
    'user',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (
  id,
  organization_id,
  name,
  is_default,
  is_active,
  position
)
values (
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Managed WhatsApp Pipeline',
  true,
  true,
  1
);

insert into public.stages (
  id,
  organization_id,
  pipeline_id,
  name,
  stage_key,
  position,
  is_active
)
values (
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'New',
  'managed_whatsapp_new',
  1,
  true
);

insert into public.teams (id, organization_id, name, is_active)
values (
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Managed WhatsApp Team',
  true
);

insert into public.team_members (
  id,
  organization_id,
  team_id,
  user_id,
  is_active
)
values
  (
    'e6000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000001',
    true
  ),
  (
    'e6000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001',
    'e2000000-0000-4000-8000-000000000002',
    true
  );

insert into public.member_availability (
  id,
  organization_id,
  team_member_id,
  day_of_week,
  start_time,
  end_time,
  is_all_day,
  is_active
)
values
  (
    'e6100000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e6000000-0000-4000-8000-000000000001',
    1,
    null,
    null,
    true,
    true
  ),
  (
    'e6100000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e6000000-0000-4000-8000-000000000002',
    1,
    '18:00',
    '19:00',
    false,
    true
  );

insert into public.whatsapp_sessions (
  id,
  organization_id,
  owner_user_id,
  instance_name,
  status,
  is_active,
  provider
)
values (
  'e7200000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001',
  'managed-whatsapp-canonical-test',
  'connected',
  true,
  'evolution_go'
);

insert into public.round_robins (
  id,
  organization_id,
  name,
  pipeline_id,
  target_pipeline_id,
  target_stage_id,
  strategy,
  settings,
  is_active
)
values (
  'e7000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'Managed WhatsApp Canonical Queue',
  'e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'weighted',
  '{
    "enable_redistribution": true,
    "redistribution_timeout_minutes": 20,
    "redistribution_warning_minutes": 5,
    "redistribution_max_attempts": 3,
    "ignore_availability": false,
    "require_checkin": false,
    "timezone": "America/Sao_Paulo"
  }'::jsonb,
  true
);

insert into public.round_robin_members (
  id,
  organization_id,
  round_robin_id,
  user_id,
  team_id,
  weight,
  position,
  leads_count,
  is_active
)
values (
  'e8000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e7000000-0000-4000-8000-000000000001',
  null,
  'e5000000-0000-4000-8000-000000000001',
  3,
  1,
  0,
  true
);

insert into public.round_robin_rules (
  id,
  organization_id,
  round_robin_id,
  match_type,
  match_value,
  match,
  conditions,
  priority,
  is_active
)
values
  (
    'e7100000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001',
    'whatsapp_message_contains',
    'Quero Casa',
    '{"whatsapp_session_id":"e7200000-0000-4000-8000-000000000001"}'::jsonb,
    '{"match_type":"whatsapp_message_contains","match_value":"Quero Casa","match":{"whatsapp_session_id":"e7200000-0000-4000-8000-000000000001"}}'::jsonb,
    100,
    true
  ),
  (
    'e7100000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'e7000000-0000-4000-8000-000000000001',
    'source',
    'site',
    '{}'::jsonb,
    '{}'::jsonb,
    10,
    true
  );

insert into public.whatsapp_inbound_rules (
  id,
  organization_id,
  session_id,
  name,
  priority,
  is_active,
  match_type,
  match_value,
  match_field,
  target_round_robin_id,
  target_pipeline_id,
  target_stage_id
)
values (
  'e7100000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e7200000-0000-4000-8000-000000000001',
  'Managed WhatsApp Canonical Rule',
  -1000000001,
  true,
  'contains',
  'Quero Casa',
  'message',
  'e7000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001'
);

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{
      "managed_whatsapp_message_distribution": true,
      "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
      "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
      "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
    }'::jsonb
  ),
  true,
  'weighted team queues with schedules and redistribution pass the managed creation guard'
);

update public.round_robins
   set settings = jsonb_set(settings, '{require_checkin}', 'true'::jsonb)
 where id = 'e7000000-0000-4000-8000-000000000001';

select is(
  public.whatsapp_webhook_has_lead_creation_context(
    '{
      "managed_whatsapp_message_distribution": true,
      "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
      "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
      "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
    }'::jsonb
  ),
  false,
  'managed WhatsApp creation rejects required check-in until eligibility is implemented'
);

update public.round_robins
   set settings = jsonb_set(settings, '{require_checkin}', 'false'::jsonb)
 where id = 'e7000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    insert into public.leads (
      id, organization_id, name, source, source_session_id,
      initial_message, message, metadata
    ) values (
      'e9000000-0000-4000-8000-000000000003',
      'e1000000-0000-4000-8000-000000000002',
      'Cross-tenant managed WhatsApp lead',
      'whatsapp',
      'e7200000-0000-4000-8000-000000000001',
      'Quero Casa',
      'Quero Casa',
      '{
        "managed_whatsapp_message_distribution": true,
        "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
        "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
        "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
      }'::jsonb
    )
  $$,
  '23514',
  'managed_whatsapp_context_invalid',
  'managed intake rejects a valid rule from another organization before insert'
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  name,
  source,
  source_session_id,
  initial_message,
  message,
  metadata,
  created_at
)
values (
  'e9000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'Managed WhatsApp Lead',
  'whatsapp',
  'e7200000-0000-4000-8000-000000000001',
  'Olá, QUERO CASA no centro',
  'Olá, QUERO CASA no centro',
  '{
    "managed_whatsapp_message_distribution": true,
    "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
    "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
    "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
  }'::jsonb,
  '2026-07-27 13:00:00+00'
);

select is(
  public.handle_routed_lead_intake(
    'e9000000-0000-4000-8000-000000000001'
  )->>'reason',
  'assigned',
  'a matching initial WhatsApp message is assigned through canonical distribution'
);

select is(
  (
    select assigned_user_id
      from public.leads
     where id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'e2000000-0000-4000-8000-000000000001'::uuid,
  'the canonical distributor selects the team member inside the configured schedule'
);

select is(
  (
    select count(*)
      from public.round_robin_logs
     where lead_id = 'e9000000-0000-4000-8000-000000000001'
       and assigned_user_id = 'e2000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'the team member outside the configured schedule is not selected'
);

select ok(
  exists (
    select 1
      from public.round_robin_logs
     where lead_id = 'e9000000-0000-4000-8000-000000000001'
       and reason = 'canonical_round_robin'
       and rule_matched = 'e7100000-0000-4000-8000-000000000001'
       and metadata->>'managed_whatsapp_message_distribution' = 'true'
       and metadata->>'availability_check' <> 'queue_ignores_availability'
  ),
  'the canonical log keeps the WhatsApp rule and records a real availability check'
);

select ok(
  exists (
    select 1
      from public.lead_redistribution_jobs
     where lead_id = 'e9000000-0000-4000-8000-000000000001'
       and round_robin_id = 'e7000000-0000-4000-8000-000000000001'
       and current_assigned_user_id = 'e2000000-0000-4000-8000-000000000001'
       and status = 'pending'
  ),
  'canonical managed assignment enrolls the lead for automatic redistribution'
);

select ok(
  public.handle_routed_lead_intake(
    'e9000000-0000-4000-8000-000000000001'
  )->>'distribution_event_id' = (
    select id::text
      from private.lead_distribution_events
     where organization_id = 'e1000000-0000-4000-8000-000000000001'
       and idempotency_key = 'managed-whatsapp:e9000000-0000-4000-8000-000000000001:e7100000-0000-4000-8000-000000000001'
  )
  and (
    select count(*) = 1
      from public.round_robin_logs
     where lead_id = 'e9000000-0000-4000-8000-000000000001'
       and reason = 'canonical_round_robin'
  )
  and (
    select count(*) = 1
      from public.lead_redistribution_jobs
     where lead_id = 'e9000000-0000-4000-8000-000000000001'
       and status in ('pending', 'warning_sent')
  ),
  'replaying managed intake does not duplicate assignment or redistribution state'
);

update public.leads
   set metadata = metadata || '{
         "managed_whatsapp_message_distribution": false,
         "matched_rule_id": "ffffffff-ffff-4fff-8fff-fffffffffff1",
         "whatsapp_session_id": "ffffffff-ffff-4fff-8fff-fffffffffff2",
         "target_round_robin_id": "ffffffff-ffff-4fff-8fff-fffffffffff3",
         "target_team_id": "ffffffff-ffff-4fff-8fff-fffffffffff4",
         "distribution_deferred": true,
         "concurrent_message_seen": true
       }'::jsonb,
       source = 'site',
       source_session_id = 'ffffffff-ffff-4fff-8fff-fffffffffff2',
       initial_message = 'Mensagem concorrente'
 where id = 'e9000000-0000-4000-8000-000000000001';

select ok(
  (
    select
      metadata->>'managed_whatsapp_message_distribution' = 'true'
      and metadata->>'matched_rule_id' = 'e7100000-0000-4000-8000-000000000001'
      and metadata->>'whatsapp_session_id' = 'e7200000-0000-4000-8000-000000000001'
      and metadata->>'target_round_robin_id' = 'e7000000-0000-4000-8000-000000000001'
      and not metadata ? 'target_team_id'
      and metadata->>'distribution_deferred' = 'true'
      and metadata->>'concurrent_message_seen' = 'true'
      and source = 'whatsapp'
      and source_session_id = 'e7200000-0000-4000-8000-000000000001'
      and initial_message = 'Olá, QUERO CASA no centro'
      from public.leads
     where id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'a concurrent update cannot rewrite managed intake provenance but may merge unrelated metadata'
);

select throws_ok(
  $$
    update public.leads
       set metadata = '[]'::jsonb
     where id = 'e9000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'managed_whatsapp_metadata_must_be_object',
  'managed intake metadata cannot be replaced with a non-object JSON value'
);

select ok(
  (
    select
      jsonb_typeof(metadata) = 'object'
      and metadata->>'managed_whatsapp_message_distribution' = 'true'
      and metadata->>'matched_rule_id' = 'e7100000-0000-4000-8000-000000000001'
      from public.leads
     where id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'a rejected metadata-shape update leaves managed provenance intact'
);

update public.leads
   set metadata = metadata - 'distribution_deferred'
 where id = 'e9000000-0000-4000-8000-000000000001';

select ok(
  (
    select not metadata ? 'distribution_deferred'
      from public.leads
     where id = 'e9000000-0000-4000-8000-000000000001'
  ),
  'canonical lifecycle metadata remains mutable after intake provenance is frozen'
);

update public.round_robins
   set settings = jsonb_set(settings, '{ignore_availability}', 'true'::jsonb)
 where id = 'e7000000-0000-4000-8000-000000000001';

create temporary table managed_whatsapp_upsert_result on commit drop as
select *
from public.upsert_whatsapp_webhook_lead(
  p_organization_id := 'e1000000-0000-4000-8000-000000000001',
  p_name := 'Managed WhatsApp RPC Lead',
  p_phone := '+5511999900001',
  p_source_detail := 'Managed WhatsApp RPC',
  p_source_session_id := 'e7200000-0000-4000-8000-000000000001',
  p_initial_message := 'Olá, quero casa pelo WhatsApp',
  p_message := 'Olá, quero casa pelo WhatsApp',
  p_metadata := '{
    "source": "whatsapp",
    "managed_whatsapp_message_distribution": true,
    "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
    "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
    "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
  }'::jsonb
);

select ok(
  (select count(*) = 1 and bool_and(is_new_lead) from managed_whatsapp_upsert_result)
  and exists (
    select 1
      from managed_whatsapp_upsert_result as result
      join public.leads as lead on lead.id = result.id
     where lead.assigned_user_id is not null
       and lead.initial_message = 'Olá, quero casa pelo WhatsApp'
  ),
  'the real WhatsApp upsert creates a new lead and the insert trigger distributes it'
);

create temporary table managed_whatsapp_upsert_replay on commit drop as
select *
from public.upsert_whatsapp_webhook_lead(
  p_organization_id := 'e1000000-0000-4000-8000-000000000001',
  p_name := 'Concurrent Managed WhatsApp RPC Lead',
  p_phone := '+5511999900001',
  p_source_session_id := 'ffffffff-ffff-4fff-8fff-fffffffffff2',
  p_initial_message := 'Mensagem concorrente',
  p_message := 'Mensagem concorrente',
  p_metadata := '{
    "source": "whatsapp",
    "managed_whatsapp_message_distribution": true,
    "matched_rule_id": "ffffffff-ffff-4fff-8fff-fffffffffff1",
    "whatsapp_session_id": "ffffffff-ffff-4fff-8fff-fffffffffff2",
    "target_round_robin_id": "ffffffff-ffff-4fff-8fff-fffffffffff3",
    "concurrent_message_seen": true
  }'::jsonb
);

select ok(
  (
    select count(*) = 1 and not bool_or(is_new_lead)
      from managed_whatsapp_upsert_replay
  )
  and exists (
    select 1
      from managed_whatsapp_upsert_replay as replay
      join public.leads as lead on lead.id = replay.id
     where lead.metadata->>'matched_rule_id' = 'e7100000-0000-4000-8000-000000000001'
       and lead.metadata->>'whatsapp_session_id' = 'e7200000-0000-4000-8000-000000000001'
       and lead.metadata->>'target_round_robin_id' = 'e7000000-0000-4000-8000-000000000001'
       and lead.metadata->>'concurrent_message_seen' = 'true'
       and (
         select count(*) = 1
           from public.round_robin_logs as log
          where log.lead_id = lead.id
            and log.reason = 'canonical_round_robin'
       )
       and (
         select count(*) = 1
           from public.lead_redistribution_jobs as job
          where job.lead_id = lead.id
            and job.status in ('pending', 'warning_sent')
       )
  ),
  'a serialized upsert replay cannot rewrite the first managed route or duplicate distribution state'
);

update public.round_robins
   set settings = jsonb_set(settings, '{ignore_availability}', 'false'::jsonb)
 where id = 'e7000000-0000-4000-8000-000000000001';

select throws_ok(
  $$
    insert into public.leads (
      id, organization_id, name, source, source_session_id,
      initial_message, message, metadata, created_at
    ) values (
      'e9000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001',
      'Managed WhatsApp Message Mismatch',
      'whatsapp',
      'e7200000-0000-4000-8000-000000000001',
      'Quero apenas alugar um apartamento',
      'Quero apenas alugar um apartamento',
      '{
        "managed_whatsapp_message_distribution": true,
        "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
        "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
        "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
      }'::jsonb,
      '2026-07-27 13:01:00+00'
    )
  $$,
  '23514',
  'managed_whatsapp_context_invalid',
  'a mismatched initial message is rejected before a managed lead is inserted'
);

insert into public.leads (
  id, organization_id, name, source, source_session_id,
  initial_message, message, metadata
)
values (
  'e9000000-0000-4000-8000-000000000004',
  'e1000000-0000-4000-8000-000000000001',
  'Existing unassigned WhatsApp lead',
  'whatsapp',
  'e7200000-0000-4000-8000-000000000001',
  'Mensagem anterior',
  'Mensagem anterior',
  '{"distribution_deferred":true}'::jsonb
);

update public.leads
   set metadata = metadata || '{
     "managed_whatsapp_message_distribution": true,
     "matched_rule_id": "e7100000-0000-4000-8000-000000000001",
     "whatsapp_session_id": "e7200000-0000-4000-8000-000000000001",
     "target_round_robin_id": "e7000000-0000-4000-8000-000000000001"
   }'::jsonb
 where id = 'e9000000-0000-4000-8000-000000000004';

select ok(
  (
    select
      assigned_user_id is null
      and not metadata ? 'managed_whatsapp_message_distribution'
      and not metadata ? 'matched_rule_id'
      and not metadata ? 'target_round_robin_id'
      from public.leads
     where id = 'e9000000-0000-4000-8000-000000000004'
  ),
  'an existing unassigned lead is not silently converted into managed intake by update'
);

select * from finish();
rollback;
