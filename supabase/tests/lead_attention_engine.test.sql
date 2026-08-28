begin;

create extension if not exists pgtap with schema extensions;
select plan(33);

select is(
  (
    select procedure.prosecdef
    from pg_proc as procedure
    where procedure.oid = 'private.guard_lead_clocks()'::regprocedure
  ),
  true,
  'all-lead enrollment guard remains a privileged internal trigger'
);

select ok(
  (
    select
      procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) as setting
        where setting like 'search_path=%'
      )
    from pg_proc as procedure
    where procedure.oid = 'private.capture_lead_cycles()'::regprocedure
  ),
  'cycle materialization is SECURITY DEFINER with an immutable search_path'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.capture_lead_cycles()',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.capture_lead_cycles()',
    'execute'
  ),
  'browser roles cannot invoke the privileged cycle trigger directly'
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
values (
  '00000000-0000-0000-0000-000000000000',
  'a1000000-0000-0000-0000-000000000001',
  'authenticated',
  'authenticated',
  'attention-engine@example.test',
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
);

insert into public.organizations (id, name, slug, is_active)
values (
  'a2000000-0000-0000-0000-000000000001',
  'Attention Engine Test Org',
  'attention-engine-test-org',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values (
  'a1000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'Attention Engine User',
  'attention-engine@example.test',
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
  'a2000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'admin',
  true
)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (id, organization_id, name, position, is_active)
values (
  'a3000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'Attention Test Pipeline',
  1,
  true
);

insert into public.stages (id, organization_id, pipeline_id, name, stage_key, position, is_active)
values
  (
    'a4000000-0000-0000-0000-000000000001',
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'New',
    'attention_test_new',
    1,
    true
  ),
  (
    'a4000000-0000-0000-0000-000000000002',
    'a2000000-0000-0000-0000-000000000001',
    'a3000000-0000-0000-0000-000000000001',
    'Contacted',
    'attention_test_contacted',
    2,
    true
  );

insert into public.round_robins (id, organization_id, name, pipeline_id, is_active)
values (
  'a8000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'Attention Test Queue',
  'a3000000-0000-0000-0000-000000000001',
  true
);

-- New organizations are explicit fixtures here because the migration seeds
-- existing organizations only. Defaults must still be safe when inserted.
insert into public.organization_attention_settings (organization_id)
values ('a2000000-0000-0000-0000-000000000001');

insert into public.lead_attention_policies (
  id,
  organization_id,
  name,
  policy_type,
  threshold_minutes
)
values (
  'a6000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'First contact test policy',
  'first_contact',
  60
);

-- All CRM leads participate in operational attention. The marketing source is
-- descriptive only and does not change the enrollment decision.
insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  assigned_user_id,
  name,
  phone,
  source,
  stage_entered_at,
  board_order_at
)
values (
  'a5000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Manual lead with WhatsApp source',
  '5511999999001',
  'whatsapp',
  '2026-01-01 12:00:00+00',
  '2026-01-01 12:00:00+00'
);

select is(
  (select attention_eligible from public.leads where id = 'a5000000-0000-0000-0000-000000000001'),
  true,
  'manual leads participate in operational attention'
);

select isnt(
  (select attention_enrolled_at from public.leads where id = 'a5000000-0000-0000-0000-000000000001'),
  null::timestamptz,
  'manual lead receives an enrollment timestamp'
);

select is(
  (select count(*) from public.lead_assignment_cycles where lead_id = 'a5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'manual lead creates an assignment cycle'
);

select is(
  (select count(*) from public.lead_stage_cycles where lead_id = 'a5000000-0000-0000-0000-000000000001'),
  1::bigint,
  'manual lead creates a stage cycle'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select lives_ok(
  $$
    insert into public.leads (
      id,
      organization_id,
      pipeline_id,
      stage_id,
      assigned_user_id,
      name,
      phone,
      source
    )
    values (
      'a5000000-0000-0000-0000-000000000003',
      'a2000000-0000-0000-0000-000000000001',
      'a3000000-0000-0000-0000-000000000001',
      'a4000000-0000-0000-0000-000000000001',
      'a1000000-0000-0000-0000-000000000001',
      'Authenticated browser lead',
      '5511999999003',
      'manual'
    )
  $$,
  'authenticated lead creation can materialize backend-owned attention cycles'
);

reset role;

select is(
  (select attention_eligible from public.leads where id = 'a5000000-0000-0000-0000-000000000003'),
  true,
  'authenticated lead creation participates in operational attention'
);

select is(
  (
    select
      (select count(*) from public.lead_assignment_cycles where lead_id = l.id)
      + (select count(*) from public.lead_stage_cycles where lead_id = l.id)
    from public.leads l
    where l.id = 'a5000000-0000-0000-0000-000000000003'
  ),
  2::bigint,
  'authenticated lead creation opens assignment and stage cycles'
);

-- Integration-created leads follow the same all-leads enrollment contract.
insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  assigned_user_id,
  name,
  phone,
  source,
  meta_lead_id,
  stage_entered_at,
  board_order_at
)
values (
  'a5000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a3000000-0000-0000-0000-000000000001',
  'a4000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'Meta integration lead',
  '5511999999002',
  'meta',
  'meta-lead-attention-test-1',
  '2026-01-02 12:00:00+00',
  '2026-01-02 12:00:00+00'
);

select is(
  (select attention_eligible from public.leads where id = 'a5000000-0000-0000-0000-000000000002'),
  true,
  'integration lead participates in operational attention'
);

select isnt(
  (select attention_enrolled_at from public.leads where id = 'a5000000-0000-0000-0000-000000000002'),
  null::timestamptz,
  'integration lead receives an enrollment timestamp'
);

select is(
  (select count(*) from public.lead_assignment_cycles where lead_id = 'a5000000-0000-0000-0000-000000000002' and ended_at is null),
  1::bigint,
  'eligible integration lead opens one active assignment cycle'
);

select is(
  (select count(*) from public.lead_stage_cycles where lead_id = 'a5000000-0000-0000-0000-000000000002' and exited_at is null),
  1::bigint,
  'eligible integration lead opens one active stage cycle'
);

insert into public.lead_redistribution_jobs (
  organization_id,
  lead_id,
  round_robin_id,
  original_assigned_user_id,
  current_assigned_user_id,
  max_attempts,
  timeout_minutes,
  warning_minutes,
  enrolled_at,
  due_at,
  warning_due_at
)
values (
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000002',
  'a8000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  'a1000000-0000-0000-0000-000000000001',
  3,
  10,
  5,
  now(),
  now() + interval '10 minutes',
  now() + interval '5 minutes'
);

-- Enrollment is immutable after creation. Editing commercial attribution must
-- not reset the existing engine clock or open duplicate cycles.
update public.leads
set source = 'meta',
    meta_lead_id = 'late-meta-id-does-not-reenroll',
    attention_eligible = true,
    attention_enrolled_at = '2099-01-01 00:00:00+00',
    updated_at = now()
where id = 'a5000000-0000-0000-0000-000000000001';

select is(
  (select attention_eligible from public.leads where id = 'a5000000-0000-0000-0000-000000000001'),
  true,
  'updating attribution preserves lead enrollment'
);

select isnt(
  (select attention_enrolled_at from public.leads where id = 'a5000000-0000-0000-0000-000000000001'),
  '2099-01-01 00:00:00+00'::timestamptz,
  'updating attribution cannot rewrite the enrollment clock'
);

select is(
  (
    select
      (select count(*) from public.lead_assignment_cycles where lead_id = l.id)
      + (select count(*) from public.lead_stage_cycles where lead_id = l.id)
    from public.leads l
    where l.id = 'a5000000-0000-0000-0000-000000000001'
  ),
  2::bigint,
  'updating attribution creates no duplicate attention cycles'
);

update public.leads
set board_order_at = '2026-01-03 12:00:00+00',
    stage_entered_at = '2099-01-01 00:00:00+00'
where id = 'a5000000-0000-0000-0000-000000000002';

select is(
  (select stage_entered_at from public.leads where id = 'a5000000-0000-0000-0000-000000000002'),
  '2026-01-02 12:00:00+00'::timestamptz,
  'reordering inside the same stage preserves the true stage entry timestamp'
);

select is(
  (select board_order_at from public.leads where id = 'a5000000-0000-0000-0000-000000000002'),
  '2026-01-03 12:00:00+00'::timestamptz,
  'reordering changes only the independent board clock'
);

select is(
  (select count(*) from public.lead_stage_cycles where lead_id = 'a5000000-0000-0000-0000-000000000002'),
  1::bigint,
  'reordering inside the same stage does not open a new stage cycle'
);

select is(
  (select status from public.lead_redistribution_jobs where lead_id = 'a5000000-0000-0000-0000-000000000002'),
  'pending',
  'reordering inside the same stage preserves active redistribution'
);

update public.leads
set stage_id = 'a4000000-0000-0000-0000-000000000002',
    stage_entered_at = '1999-01-01 00:00:00+00'
where id = 'a5000000-0000-0000-0000-000000000002';

select is(
  (select count(*) from public.lead_stage_cycles where lead_id = 'a5000000-0000-0000-0000-000000000002'),
  2::bigint,
  'a real stage change opens a new stage cycle'
);

select ok(
  exists (
    select 1
    from public.lead_stage_cycles
    where lead_id = 'a5000000-0000-0000-0000-000000000002'
      and stage_id = 'a4000000-0000-0000-0000-000000000001'
      and exited_at is not null
  )
  and exists (
    select 1
    from public.lead_stage_cycles
    where lead_id = 'a5000000-0000-0000-0000-000000000002'
      and stage_id = 'a4000000-0000-0000-0000-000000000002'
      and exited_at is null
      and baseline_confidence = 'observed'
  ),
  'stage change closes the old cycle and leaves the new observed cycle active'
);

select ok(
  exists (
    select 1
    from public.lead_redistribution_jobs
    where lead_id = 'a5000000-0000-0000-0000-000000000002'
      and status = 'stopped'
      and stopped_reason = 'stage_changed'
      and stopped_at is not null
      and metadata->>'stopped_by' = 'lead_stage_change'
  ),
  'a real stage move stops active redistribution immediately'
);

insert into public.activities (
  id,
  organization_id,
  lead_id,
  user_id,
  type,
  content,
  metadata,
  created_at
)
values (
  'a7000000-0000-0000-0000-000000000001',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'message',
  'AI generated outreach',
  '{"sender_type":"ai","origin":"ai_assistant"}'::jsonb,
  now()
);

select ok(
  exists (
    select 1
    from public.lead_action_facts
    where source_type = 'activity'
      and source_id = 'a7000000-0000-0000-0000-000000000001'
      and is_automated = true
      and qualifies_first_outreach = false
      and qualifies_stage_inactivity = false
  ),
  'AI message is recorded but does not qualify as human outreach or activity'
);

select is(
  (select first_response_at from public.leads where id = 'a5000000-0000-0000-0000-000000000002'),
  null::timestamptz,
  'AI message does not set first human response'
);

insert into public.activities (
  id,
  organization_id,
  lead_id,
  user_id,
  type,
  content,
  metadata,
  created_at
)
values (
  'a7000000-0000-0000-0000-000000000002',
  'a2000000-0000-0000-0000-000000000001',
  'a5000000-0000-0000-0000-000000000002',
  'a1000000-0000-0000-0000-000000000001',
  'message',
  'Human email follow-up',
  '{"sender_type":"user","origin":"email","channel":"email"}'::jsonb,
  now()
);

select ok(
  exists (
    select 1
    from public.lead_action_facts
    where source_type = 'activity'
      and source_id = 'a7000000-0000-0000-0000-000000000002'
      and is_automated = false
      and qualifies_first_outreach = true
      and qualifies_stage_inactivity = true
  ),
  'human message qualifies even when its origin token contains the letters ai'
);

select ok(
  (select first_response_at is not null from public.leads where id = 'a5000000-0000-0000-0000-000000000002')
  and (
    select first_human_outreach_at is not null
    from public.lead_assignment_cycles
    where lead_id = 'a5000000-0000-0000-0000-000000000002'
      and ended_at is null
  ),
  'human message sets both lead summary and assignment-cycle first outreach'
);

select is(
  (
    select count(*)
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'organization_attention_settings',
        'lead_attention_policies',
        'lead_assignment_cycles',
        'lead_stage_cycles',
        'lead_action_facts',
        'lead_attention_instances',
        'lead_attention_events'
      ]::name[])
      and relation.relrowsecurity = true
  ),
  7::bigint,
  'all attention engine tables have row-level security enabled'
);

select ok(
  not has_table_privilege('authenticated', 'public.organization_attention_settings', 'select')
  and not has_table_privilege('authenticated', 'public.lead_attention_policies', 'select')
  and not has_table_privilege('authenticated', 'public.lead_attention_instances', 'select')
  and not has_table_privilege('anon', 'public.lead_action_facts', 'select'),
  'browser roles have no direct access to backend-owned attention tables'
);

select ok(
  has_table_privilege('service_role', 'public.organization_attention_settings', 'select')
  and has_table_privilege('service_role', 'public.lead_attention_policies', 'update')
  and has_table_privilege('service_role', 'public.lead_attention_instances', 'insert')
  and not has_function_privilege(
    'authenticated',
    'private.record_lead_action_fact(uuid,uuid,uuid,text,text,timestamptz,boolean,boolean,boolean,boolean,boolean,text,text,jsonb)',
    'execute'
  ),
  'service role has engine access while authenticated clients cannot call the fact writer'
);

select ok(
  (
    select engine_mode = 'shadow'
      and notifications_enabled = true
      and redistribution_enabled = false
    from public.organization_attention_settings
    where organization_id = 'a2000000-0000-0000-0000-000000000001'
  ),
  'organization defaults are shadow mode with redistribution kill switch off'
);

select is(
  (select status from public.lead_attention_policies where id = 'a6000000-0000-0000-0000-000000000001'),
  'shadow',
  'new policy defaults to shadow mode'
);

select * from finish();
rollback;
