begin;

create extension if not exists pgtap with schema extensions;
select plan(52);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'stage_operational_configs'
      and column_name in (
        'cadence_enabled',
        'revision',
        'attention_mode',
        'first_outreach_minutes',
        'first_effective_contact_minutes',
        'stage_inactivity_minutes',
        'stage_max_age_minutes',
        'warning_minutes',
        'escalation_minutes',
        'business_hours_only'
      )
  $$,
  array[10::bigint],
  'stage operational rules have all typed cadence and attention columns'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'stage_operational_configs'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  array[0::bigint],
  'authenticated clients cannot bypass the backend stage-rules contract'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'cadence_tasks_template'
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  $$,
  array[0::bigint],
  'authenticated clients cannot edit operational cadence templates directly'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'lead_tasks'
      and policyname in (
        'vimob_operational_cadence_tasks_insert_guard',
        'vimob_operational_cadence_tasks_update_guard',
        'vimob_operational_cadence_tasks_delete_guard'
      )
      and permissive = 'RESTRICTIVE'
      and 'authenticated' = any(roles)
      and coalesce(qual, with_check, '') like '%cadence_enrollment_id%'
  $$,
  array[3::bigint],
  'direct task writes are restricted to non-cadence tasks'
);

select results_eq(
  $$
    select count(*)::bigint
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'cadence_tasks_template'
      and column_name in (
        'due_minutes',
        'warning_minutes',
        'is_required',
        'outcome_required'
      )
  $$,
  array[4::bigint],
  'cadence template tasks have canonical timing and obligation columns'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.cadence_enrollments'::regclass
      and tgname = 'trg_ensure_completed_cadence_has_obligation'
      and not tgisinternal
      and tgenabled <> 'D'
  ),
  'empty cadences no longer have an artificial default-obligation trigger'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_proc procedure
    where procedure.oid in (
      'private.materialize_cadence_for_stage_cycle(uuid)'::regprocedure,
      'private.sync_cadence_lifecycle()'::regprocedure,
      'private.sync_lead_cadence_assignee()'::regprocedure,
      'private.capture_activity_attention_fact()'::regprocedure,
      'private.capture_lead_cycles()'::regprocedure,
      'private.switch_lead_cadence(uuid,uuid,uuid,uuid)'::regprocedure
    )
      and procedure.prosecdef
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
        where setting = 'search_path=""'
      )
  $$,
  array[6::bigint],
  'all canonical private functions are SECURITY DEFINER with an empty search path'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.switch_lead_cadence(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.switch_lead_cadence(uuid,uuid,uuid,uuid)',
    'execute'
  )
  and not has_function_privilege(
    'anon',
    'private.switch_lead_cadence(uuid,uuid,uuid,uuid)',
    'execute'
  ),
  'manual cadence switching remains backend-only'
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
values
  (
    '00000000-0000-0000-0000-000000000000',
    'e1000000-0000-0000-0000-000000000001',
    'authenticated',
    'authenticated',
    'stage-rules-one@example.test',
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
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'e1000000-0000-0000-0000-000000000002',
    'authenticated',
    'authenticated',
    'stage-rules-two@example.test',
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
  'e2000000-0000-0000-0000-000000000001',
  'Stage Operational Rules Test',
  'stage-operational-rules-test',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'e1000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'Stage Rules One',
    'stage-rules-one@example.test',
    'admin',
    true
  ),
  (
    'e1000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'Stage Rules Two',
    'stage-rules-two@example.test',
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
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'admin',
    true
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000002',
    'admin',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.pipelines (id, organization_id, name, position, is_active)
values (
  'e3000000-0000-0000-0000-000000000001',
  'e2000000-0000-0000-0000-000000000001',
  'Operational Rules Pipeline',
  1,
  true
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
values
  (
    'e4000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'Cadence Disabled',
    'rules_disabled',
    1,
    true
  ),
  (
    'e4000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'Cadence Enabled',
    'rules_enabled',
    2,
    true
  ),
  (
    'e4000000-0000-0000-0000-000000000003',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'Destination Without Cadence',
    'rules_destination',
    3,
    true
  ),
  (
    'e4000000-0000-0000-0000-000000000004',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'Empty Cadence',
    'rules_empty',
    4,
    true
  ),
  (
    'e4000000-0000-0000-0000-000000000005',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'Alternate Cadence',
    'rules_alternate',
    5,
    true
  );

insert into public.stage_operational_configs (
  organization_id,
  stage_id,
  operation_context,
  cadence_enabled
)
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'test',
    false
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000004',
    'test',
    true
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000005',
    'test',
    true
  );

insert into public.stage_operational_configs (
  organization_id,
  stage_id,
  operation_context,
  cadence_enabled,
  attention_mode,
  first_outreach_minutes,
  first_effective_contact_minutes,
  stage_inactivity_minutes,
  stage_max_age_minutes,
  warning_minutes,
  escalation_minutes,
  business_hours_only
)
values (
  'e2000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'test',
  true,
  'shadow',
  60,
  120,
  180,
  1440,
  15,
  60,
  true
);

insert into public.stage_operational_configs (
  organization_id,
  stage_id,
  operation_context
)
values (
  'e2000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000003',
  'test'
);

select is(
  (
    select cadence_enabled::text || ':' || attention_mode
    from public.stage_operational_configs
    where stage_id = 'e4000000-0000-0000-0000-000000000003'
  ),
  'false:disabled',
  'a stage rule defaults to no cadence and disabled attention'
);

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
  'e5000000-0000-0000-0000-000000000011',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000001',
  'e1000000-0000-0000-0000-000000000001',
  'No legacy operational timeline pollution',
  '5511999999111',
  'manual'
);

update public.leads
set stage_id = 'e4000000-0000-0000-0000-000000000003'
where id = 'e5000000-0000-0000-0000-000000000011';

select is(
  (
    select count(*)
    from public.operational_timelines
    where lead_id = 'e5000000-0000-0000-0000-000000000011'
      and event_type = 'stage_operational_entry'
  ),
  0::bigint,
  'cadence and attention-only configs do not pollute the legacy operational timeline'
);

select lives_ok(
  $$
    insert into public.lead_attention_policies (
      id,
      organization_id,
      name,
      policy_type,
      threshold_minutes
    ) values (
      'e8000000-0000-0000-0000-000000000001',
      'e2000000-0000-0000-0000-000000000001',
      'First effective contact',
      'first_effective_contact',
      120
    )
  $$,
  'first effective contact is a supported attention policy type'
);

insert into public.cadence_templates (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  stage_key,
  name,
  is_active
)
values
  (
    'e6000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'rules_disabled',
    'Disabled stage cadence',
    true
  ),
  (
    'e6000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000002',
    'rules_enabled',
    'Enabled stage cadence',
    true
  ),
  (
    'e6000000-0000-0000-0000-000000000003',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000004',
    'rules_empty',
    'Empty stage cadence',
    true
  ),
  (
    'e6000000-0000-0000-0000-000000000004',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000005',
    'rules_alternate',
    'Alternate stage cadence',
    true
  );

insert into public.cadence_tasks_template (
  id,
  organization_id,
  cadence_template_id,
  position,
  day_offset,
  delay_days,
  due_minutes,
  warning_minutes,
  type,
  title,
  is_required,
  outcome_required
)
values
  (
    'e7000000-0000-0000-0000-000000000011',
    'e2000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000001',
    1,
    0,
    0,
    30,
    5,
    'call',
    'Disabled task',
    true,
    false
  ),
  (
    'e7000000-0000-0000-0000-000000000021',
    'e2000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000002',
    1,
    0,
    0,
    30,
    5,
    'call',
    'Required task completed before move',
    true,
    true
  ),
  (
    'e7000000-0000-0000-0000-000000000022',
    'e2000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000002',
    2,
    0,
    0,
    60,
    10,
    'message',
    'Required task pending on move',
    true,
    false
  ),
  (
    'e7000000-0000-0000-0000-000000000023',
    'e2000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000002',
    3,
    0,
    0,
    90,
    15,
    'note',
    'Optional task pending on move',
    false,
    false
  ),
  (
    'e7000000-0000-0000-0000-000000000041',
    'e2000000-0000-0000-0000-000000000001',
    'e6000000-0000-0000-0000-000000000004',
    1,
    0,
    0,
    45,
    5,
    'call',
    'Alternate task',
    true,
    false
  );

select throws_ok(
  $$
    update public.stage_operational_configs
    set warning_minutes = 61
    where stage_id = 'e4000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  null,
  'stage warning cannot exceed an active operational threshold'
);

select throws_ok(
  $$
    update public.cadence_tasks_template
    set warning_minutes = 61
    where id = 'e7000000-0000-0000-0000-000000000022'
  $$,
  '23514',
  null,
  'task warning cannot exceed its due offset'
);

select throws_ok(
  $$
    update public.stage_operational_configs
    set warning_minutes = 60
    where stage_id = 'e4000000-0000-0000-0000-000000000002'
  $$,
  '23514',
  null,
  'stage warning must happen before, rather than at, the first active threshold'
);

select throws_ok(
  $$
    update public.cadence_tasks_template
    set warning_minutes = 60
    where id = 'e7000000-0000-0000-0000-000000000022'
  $$,
  '23514',
  null,
  'task warning must happen before, rather than at, its due offset'
);

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
values
  (
    'e5000000-0000-0000-0000-000000000001',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000001',
    'e1000000-0000-0000-0000-000000000001',
    'No cadence lead',
    '5511999999101',
    'manual',
    '2025-01-01 10:00:00+00',
    '2025-01-01 10:00:00+00'
  ),
  (
    'e5000000-0000-0000-0000-000000000002',
    'e2000000-0000-0000-0000-000000000001',
    'e3000000-0000-0000-0000-000000000001',
    'e4000000-0000-0000-0000-000000000004',
    'e1000000-0000-0000-0000-000000000001',
    'Empty cadence lead',
    '5511999999102',
    'manual',
    '2025-01-01 10:00:00+00',
    '2025-01-01 10:00:00+00'
  );

select is(
  (
    select count(*)
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'a stage with cadence disabled creates no enrollment even when a template has tasks'
);

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000001'
      and cadence_enrollment_id is not null
  ),
  0::bigint,
  'a no-cadence stage creates zero cadence obligations'
);

select is(
  (
    select count(*)
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000002'
  ),
  0::bigint,
  'an enabled but empty template creates no enrollment'
);

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000002'
      and metadata->>'source' = 'cadence_default'
  ),
  0::bigint,
  'an empty template never manufactures a default task'
);

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
  'e5000000-0000-0000-0000-000000000003',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Move lifecycle lead',
  '5511999999103',
  'manual',
  '2025-01-02 10:00:00+00',
  '2025-01-02 10:00:00+00'
);

select is(
  (
    select count(*)
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and status = 'active'
  ),
  1::bigint,
  'an enabled stage with explicit tasks creates one active enrollment'
);

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and status = 'pending'
  ),
  3::bigint,
  'all explicit cadence template tasks are materialized'
);

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
  'e5000000-0000-0000-0000-000000000010',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Completed cadence stays completed',
  '5511999999110',
  'manual'
);

update public.lead_tasks
set is_done = true,
    done_by = 'e1000000-0000-0000-0000-000000000001',
    outcome = 'completed'
where lead_id = 'e5000000-0000-0000-0000-000000000010';

select private.materialize_cadence_for_stage_cycle(
  (
    select id
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000010'
      and exited_at is null
  )
);

select is(
  (
    select
      count(distinct enrollment.id)::text
      || ':'
      || max(enrollment.status)
      || ':'
      || count(task.id)::text
      || ':'
      || count(task.id) filter (where task.is_done = true)::text
    from public.cadence_enrollments enrollment
    join public.lead_tasks task
      on task.cadence_enrollment_id = enrollment.id
    where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000010'
  ),
  '1:completed:3:3',
  'saving stage rules never reopens a cadence already completed in the current cycle'
);

select is(
  (
    select extract(epoch from (task.due_at - cycle.entered_at))::integer / 60
    from public.lead_tasks task
    join public.cadence_enrollments enrollment
      on enrollment.id = task.cadence_enrollment_id
    join public.lead_stage_cycles cycle
      on cycle.id = enrollment.stage_cycle_id
    where task.lead_id = 'e5000000-0000-0000-0000-000000000003'
      and task.cadence_template_task_id = 'e7000000-0000-0000-0000-000000000022'
  ),
  60,
  'materialization computes due_at from the canonical minute offset'
);

select is(
  (
    select jsonb_array_length(template_snapshot->'tasks')::text
      || ':'
      || (template_snapshot->'operational_rule'->>'cadence_enabled')
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and status = 'active'
  ),
  '3:true',
  'enrollment stores a complete task and operational-rule snapshot'
);

select is(
  (
    select (metadata->>'is_required') || ':' || (metadata->>'outcome_required')
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000021'
  ),
  'true:true',
  'materialized task metadata preserves obligation semantics'
);

update public.leads
set assigned_user_id = 'e1000000-0000-0000-0000-000000000002'
where id = 'e5000000-0000-0000-0000-000000000003';

select is(
  (
    select
      enrollment.assigned_user_id::text
      || ':'
      || count(task.id) filter (
        where task.status = 'pending'
          and task.assigned_user_id = 'e1000000-0000-0000-0000-000000000002'
      )::text
      || ':'
      || jsonb_array_length(
        coalesce(enrollment.metadata->'assignment_transfers', '[]'::jsonb)
      )::text
    from public.cadence_enrollments enrollment
    join public.lead_tasks task
      on task.cadence_enrollment_id = enrollment.id
    where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000003'
      and enrollment.status = 'active'
    group by enrollment.id
  ),
  'e1000000-0000-0000-0000-000000000002:3:1',
  'reassignment transfers only current pending cadence obligations with an audit trail'
);

update public.lead_tasks
set is_done = true,
    done_by = 'e1000000-0000-0000-0000-000000000001',
    outcome = 'completed'
where lead_id = 'e5000000-0000-0000-0000-000000000003'
  and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000021';

select private.materialize_cadence_for_stage_cycle(
  (
    select id
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and exited_at is null
  )
);

select is(
  (
    select
      count(distinct enrollment.id)::text
      || ':'
      || count(task.id)::text
      || ':'
      || count(task.id) filter (where task.is_done = true)::text
    from public.cadence_enrollments enrollment
    left join public.lead_tasks task
      on task.cadence_enrollment_id = enrollment.id
    where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000003'
  ),
  '1:3:1',
  're-materializing the same active stage cycle is idempotent and preserves progress'
);

update public.lead_tasks
set metadata = jsonb_set(metadata, '{is_required}', '"legacy-invalid"'::jsonb)
where lead_id = 'e5000000-0000-0000-0000-000000000003'
  and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000022';

update public.leads
set stage_id = 'e4000000-0000-0000-0000-000000000003'
where id = 'e5000000-0000-0000-0000-000000000003';

select is(
  (
    select status
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000021'
  ),
  'completed',
  'moving stages preserves already completed task history'
);

select is(
  (
    select status
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000022'
  ),
  'skipped',
  'moving stages records an outstanding required task as skipped'
);

select is(
  (
    select status
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000023'
  ),
  'cancelled',
  'moving stages cancels an outstanding optional task'
);

select is(
  (
    select (metadata->>'cancel_reason') || ':' || (metadata->>'lifecycle_outcome')
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
      and cadence_template_task_id = 'e7000000-0000-0000-0000-000000000022'
  ),
  'stage_changed:required_task_skipped',
  'a skipped required task keeps an auditable stage-exit reason'
);

select is(
  (
    select cancel_reason || ':' || (metadata->>'has_skipped_required_tasks')
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000003'
  ),
  'stage_changed:true',
  'the cancelled enrollment records that required work was skipped'
);

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
  'e5000000-0000-0000-0000-000000000004',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Lost and reopened lead',
  '5511999999104',
  'manual'
);

update public.leads
set deal_status = 'lost'
where id = 'e5000000-0000-0000-0000-000000000004';

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000004'
      and status = 'cancelled'
  ),
  3::bigint,
  'lost cancels every pending cadence obligation'
);

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000004'
      and status = 'skipped'
  ),
  0::bigint,
  'lost does not classify required work as skipped'
);

select is(
  (
    select cancel_reason
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000004'
  ),
  'lost',
  'lost is retained as the enrollment cancellation reason'
);

update public.leads
set deal_status = 'open'
where id = 'e5000000-0000-0000-0000-000000000004';

select is(
  (
    select count(*)::text || ':' || count(*) filter (where exited_at is null)::text
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000004'
  ),
  '2:1',
  'reopening in the same stage creates exactly one fresh active stage cycle'
);

select is(
  (
    select count(*)::text || ':' || count(*) filter (where ended_at is null)::text
    from public.lead_assignment_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000004'
  ),
  '2:1',
  'reopening with the same assignee creates exactly one fresh assignment cycle'
);

select is(
  (
    select count(*)::text || ':'
      || (
        select count(*)::text
        from public.lead_tasks task
        join public.cadence_enrollments active_enrollment
          on active_enrollment.id = task.cadence_enrollment_id
        where active_enrollment.lead_id = 'e5000000-0000-0000-0000-000000000004'
          and active_enrollment.status = 'active'
          and task.status = 'pending'
      )
    from public.cadence_enrollments enrollment
    where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000004'
      and enrollment.status = 'active'
  ),
  '1:3',
  'reopening materializes a fresh active cadence without reviving old tasks'
);

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
  'e5000000-0000-0000-0000-000000000005',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Won and reassigned reopen lead',
  '5511999999105',
  'manual'
);

update public.leads
set deal_status = 'won'
where id = 'e5000000-0000-0000-0000-000000000005';

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000005'
      and status = 'cancelled'
  ),
  3::bigint,
  'won cancels every pending cadence obligation'
);

select is(
  (
    select count(*)
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000005'
      and status = 'skipped'
  ),
  0::bigint,
  'won does not classify required work as skipped'
);

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
  'e5000000-0000-0000-0000-000000000008',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Simultaneous stage and terminal lead',
  '5511999999108',
  'manual'
);

update public.leads
set stage_id = 'e4000000-0000-0000-0000-000000000005',
    deal_status = 'lost'
where id = 'e5000000-0000-0000-0000-000000000008';

select is(
  (
    select
      count(*) filter (where status = 'cancelled')::text
      || ':'
      || count(*) filter (where status = 'skipped')::text
      || ':'
      || (
        select enrollment.cancel_reason
        from public.cadence_enrollments enrollment
        where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000008'
        order by enrollment.created_at
        limit 1
      )
    from public.lead_tasks
    where lead_id = 'e5000000-0000-0000-0000-000000000008'
  ),
  '3:0:lost',
  'a simultaneous stage and terminal transition cancels, rather than skips, old obligations'
);

select is(
  (
    select count(*)::text
      || ':'
      || count(*) filter (where exited_at is null)::text
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000008'
  ),
  '1:0',
  'a terminal transition does not manufacture a zero-duration cycle for the destination stage'
);

update public.leads
set deal_status = 'open',
    stage_id = 'e4000000-0000-0000-0000-000000000005',
    assigned_user_id = 'e1000000-0000-0000-0000-000000000002'
where id = 'e5000000-0000-0000-0000-000000000005';

select is(
  (
    select count(*)::text
      || ':'
      || count(*) filter (
        where exited_at is null
          and stage_id = 'e4000000-0000-0000-0000-000000000005'
      )::text
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000005'
  ),
  '2:1',
  'reopening while changing stage still creates only one new stage cycle'
);

select is(
  (
    select count(*)::text
      || ':'
      || count(*) filter (
        where ended_at is null
          and assigned_user_id = 'e1000000-0000-0000-0000-000000000002'
      )::text
    from public.lead_assignment_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000005'
  ),
  '2:1',
  'reopening while reassigning still creates only one new assignment cycle'
);

select is(
  (
    select count(*)
    from public.cadence_enrollments enrollment
    join public.lead_stage_cycles cycle
      on cycle.id = enrollment.stage_cycle_id
    where enrollment.lead_id = 'e5000000-0000-0000-0000-000000000005'
      and enrollment.status = 'active'
      and cycle.stage_id = 'e4000000-0000-0000-0000-000000000005'
  ),
  1::bigint,
  'the simultaneous reopen uses the new stage operational rule'
);

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
  'e5000000-0000-0000-0000-000000000006',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Incompatible switch lead',
  '5511999999106',
  'manual'
);

select throws_ok(
  $$
    select private.switch_lead_cadence(
      'e2000000-0000-0000-0000-000000000001',
      'e5000000-0000-0000-0000-000000000006',
      'e6000000-0000-0000-0000-000000000004',
      'e1000000-0000-0000-0000-000000000001'
    )
  $$,
  'P0001',
  'cadence_template_incompatible',
  'manual switching rejects a template from another stage'
);

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
  'e5000000-0000-0000-0000-000000000007',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000001',
  'Task-completed outreach lead',
  '5511999999107',
  'manual'
);

insert into public.activities (
  organization_id,
  lead_id,
  user_id,
  type,
  content,
  metadata
)
values (
  'e2000000-0000-0000-0000-000000000001',
  'e5000000-0000-0000-0000-000000000007',
  'e1000000-0000-0000-0000-000000000001',
  'task_completed',
  'Cadencia concluida: primeira ligacao',
  '{"task_type":"call","outcome":"efetivo"}'::jsonb
);

select is(
  (
    select qualifies_first_outreach::text || ':' || is_effective_contact::text
    from public.lead_action_facts
    where lead_id = 'e5000000-0000-0000-0000-000000000007'
      and source_type = 'activity'
    order by occurred_at desc, id desc
    limit 1
  ),
  'true:true',
  'a human completed contact task counts as both outreach and effective contact'
);

select is(
  (
    select
      (first_human_outreach_at is not null)::text
      || ':'
      || (first_effective_contact_at is not null)::text
    from public.lead_assignment_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000007'
      and ended_at is null
  ),
  'true:true',
  'completed contact task resolves first outreach while preserving effective-contact tracking'
);

insert into public.activities (
  organization_id,
  lead_id,
  user_id,
  type,
  content,
  metadata
)
values
  (
    'e2000000-0000-0000-0000-000000000001',
    'e5000000-0000-0000-0000-000000000007',
    'e1000000-0000-0000-0000-000000000001',
    'task_completed',
    'Mensagem respondida',
    '{"task_type":"message","outcome":"replied"}'::jsonb
  ),
  (
    'e2000000-0000-0000-0000-000000000001',
    'e5000000-0000-0000-0000-000000000007',
    'e1000000-0000-0000-0000-000000000001',
    'task_completed',
    'Retorno agendado',
    '{"task_type":"call","outcome":"scheduled"}'::jsonb
  );

select is(
  (
    select count(*)
    from public.lead_action_facts
    where lead_id = 'e5000000-0000-0000-0000-000000000007'
      and source_type = 'activity'
      and metadata->>'outcome' in ('replied', 'scheduled')
      and is_effective_contact = true
  ),
  2::bigint,
  'the broker positive outcomes replied and scheduled count as effective contact'
);

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
  'e5000000-0000-0000-0000-000000000009',
  'e2000000-0000-0000-0000-000000000001',
  'e3000000-0000-0000-0000-000000000001',
  'e4000000-0000-0000-0000-000000000003',
  'e1000000-0000-0000-0000-000000000001',
  'Legacy attention-ineligible lead',
  '5511999999109',
  'manual'
);

alter table public.leads disable trigger trg_guard_lead_clocks;
update public.leads
set attention_eligible = false,
    attention_enrolled_at = null
where id = 'e5000000-0000-0000-0000-000000000009';
alter table public.leads enable trigger trg_guard_lead_clocks;

update public.leads
set stage_id = 'e4000000-0000-0000-0000-000000000002'
where id = 'e5000000-0000-0000-0000-000000000009';

select is(
  (
    select
      count(*) filter (
        where cycle.exited_at is null
          and cycle.stage_id = 'e4000000-0000-0000-0000-000000000002'
      )::text
      || ':'
      || count(enrollment.id) filter (where enrollment.status = 'active')::text
    from public.lead_stage_cycles cycle
    left join public.cadence_enrollments enrollment
      on enrollment.stage_cycle_id = cycle.id
    where cycle.lead_id = 'e5000000-0000-0000-0000-000000000009'
  ),
  '1:1',
  'legacy attention-ineligible leads still receive the cadence for their current stage'
);

update public.lead_stage_cycles
set metadata = coalesce(metadata, '{}'::jsonb)
  || jsonb_build_object('historical_backfill', true)
where lead_id = 'e5000000-0000-0000-0000-000000000001'
  and exited_at is null;

update public.stage_operational_configs
set cadence_enabled = true,
    updated_at = now()
where stage_id = 'e4000000-0000-0000-0000-000000000001';

select private.materialize_cadence_for_stage_cycle(
  (
    select id
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000001'
      and exited_at is null
  )
);

select is(
  (
    select count(*)
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000001'
  ),
  0::bigint,
  'historical stage-cycle backfill does not create retroactive cadence obligations'
);

delete from public.cadence_tasks_template
where cadence_template_id = 'e6000000-0000-0000-0000-000000000002';

insert into public.cadence_tasks_template (
  id,
  organization_id,
  cadence_template_id,
  position,
  day_offset,
  delay_days,
  due_minutes,
  warning_minutes,
  type,
  title,
  is_required,
  outcome_required
)
values (
  'e7000000-0000-0000-0000-000000000024',
  'e2000000-0000-0000-0000-000000000001',
  'e6000000-0000-0000-0000-000000000002',
  1,
  0,
  0,
  120,
  15,
  'call',
  'Replacement task after completed enrollment',
  true,
  false
);

select private.materialize_cadence_for_stage_cycle(
  (
    select id
    from public.lead_stage_cycles
    where lead_id = 'e5000000-0000-0000-0000-000000000010'
      and exited_at is null
  )
);

select is(
  (
    select
      count(*)::text
      || ':'
      || count(*) filter (where status = 'completed')::text
      || ':'
      || count(*) filter (where status = 'active')::text
    from public.cadence_enrollments
    where lead_id = 'e5000000-0000-0000-0000-000000000010'
  ),
  '1:1:0',
  'replacing template tasks cannot reopen a completed enrollment in the same stage cycle'
);

select * from finish();
rollback;
