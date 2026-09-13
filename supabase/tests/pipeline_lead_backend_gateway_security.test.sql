begin;

create extension if not exists pgtap with schema extensions;
select plan(57);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'anon',
        relation_name,
        'select,insert,update,delete,truncate,references,trigger'
      )
    )
    from (
      values
        ('public.pipelines'),
        ('public.stages'),
        ('public.leads'),
        ('public.stage_automations'),
        ('public.stage_operational_configs'),
        ('public.pipeline_sla_settings')
    ) as relation(relation_name)
  ),
  'anonymous clients have no direct pipeline or lead table privileges'
);

select ok(
  (
    select bool_and(has_table_privilege('authenticated', relation_name, 'select'))
    from (
      values
        ('public.pipelines'),
        ('public.stages'),
        ('public.leads'),
        ('public.stage_automations'),
        ('public.stage_operational_configs'),
        ('public.pipeline_sla_settings')
    ) as relation(relation_name)
  ),
  'authenticated clients retain tenant-filtered reads and Realtime SELECT access'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        relation_name,
        'insert,update,delete,truncate,references,trigger'
      )
    )
    from (
      values
        ('public.pipelines'),
        ('public.stages'),
        ('public.leads'),
        ('public.stage_automations'),
        ('public.stage_operational_configs'),
        ('public.pipeline_sla_settings')
    ) as relation(relation_name)
  ),
  'authenticated clients cannot mutate or truncate pipeline and lead tables'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', relation_name, privilege_name))
    from (
      values
        ('public.pipelines'),
        ('public.stages'),
        ('public.leads'),
        ('public.stage_automations'),
        ('public.stage_operational_configs'),
        ('public.pipeline_sla_settings')
    ) as relation(relation_name)
    cross join (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'service_role retains backend CRUD privileges'
);

select ok(
  (
    select bool_and(has_table_privilege('postgres', relation_name, privilege_name))
    from (
      values
        ('public.pipelines'),
        ('public.stages'),
        ('public.leads'),
        ('public.stage_automations'),
        ('public.stage_operational_configs'),
        ('public.pipeline_sla_settings')
    ) as relation(relation_name)
    cross join (
      values ('select'), ('insert'), ('update'), ('delete')
    ) as privilege(privilege_name)
  ),
  'postgres retains owner CRUD privileges'
);

select ok(
  (
    select bool_and(relation.relrowsecurity)
    from pg_class relation
    where relation.oid in (
      'public.pipelines'::regclass,
      'public.stages'::regclass,
      'public.leads'::regclass,
      'public.stage_automations'::regclass,
      'public.stage_operational_configs'::regclass,
      'public.pipeline_sla_settings'::regclass
    )
  ),
  'RLS remains enabled on pipeline and lead tables'
);

select is(
  (
    select count(*)::bigint
    from pg_policies policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'pipelines',
        'stages',
        'leads',
        'stage_automations',
        'stage_operational_configs',
        'pipeline_sla_settings'
      )
      and policy.cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
  ),
  0::bigint,
  'no legacy mutation policy can reopen direct Data API writes'
);

select is(
  (
    select count(*)::bigint
    from (
      select relation.relname
      from pg_policy policy
      join pg_class relation on relation.oid = policy.polrelid
      join pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname in (
          'pipelines',
          'stages',
          'leads',
          'stage_automations',
          'stage_operational_configs',
          'pipeline_sla_settings'
        )
        and policy.polpermissive = true
        and policy.polcmd in ('r', '*')
        and (
          0::oid = any(policy.polroles)
          or (select oid from pg_roles where rolname = 'authenticated') = any(policy.polroles)
        )
      group by relation.relname
    ) readable_table
  ),
  6::bigint,
  'every protected table retains a permissive SELECT policy for authenticated reads'
);

select is(
  (
    select count(*)::bigint
    from pg_policy policy
    join pg_class relation on relation.oid = policy.polrelid
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'pipelines',
        'stages',
        'leads',
        'stage_automations',
        'stage_operational_configs',
        'pipeline_sla_settings'
      )
      and policy.polname = 'vimob_active_membership_guard'
      and policy.polpermissive = false
      and policy.polcmd = 'r'
      and (
        select role.oid
        from pg_roles role
        where role.rolname = 'authenticated'
      ) = any(policy.polroles)
  ),
  6::bigint,
  'each authenticated read is constrained by the active membership guard'
);

select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'create_default_stages_for_pipeline',
        'distribute_lead_from_backend',
        'handle_lead_intake',
        'handle_managed_whatsapp_message_lead',
        'handle_routed_lead_intake',
        'move_lead_stage',
        'redistribute_lead_from_pool',
        'redistribute_lead_round_robin',
        'register_lead_reentry',
        'reorder_stages',
        'transfer_lead_assignee',
        'upsert_whatsapp_webhook_lead'
      )
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
  ),
  'legacy mutating RPCs cannot bypass the backend gateway'
);

select ok(
  not exists (
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    cross join lateral (
      select lower(pg_get_functiondef(procedure.oid)) as definition
    ) source
    where namespace.nspname = 'public'
      and procedure.prokind = 'f'
      and procedure.prosecdef = true
      and procedure.prorettype <> 'trigger'::regtype
      and (
        source.definition like '%leads%'
        or source.definition like '%pipelines%'
        or source.definition like '%stages%'
        or source.definition like '%stage_automations%'
        or source.definition like '%stage_operational_configs%'
        or source.definition like '%pipeline_sla_settings%'
      )
      and source.definition ~ '(insert[[:space:]]+into|update[[:space:]]|delete[[:space:]]+from|truncate[[:space:]])'
      and (
        has_function_privilege('anon', procedure.oid, 'execute')
        or has_function_privilege('authenticated', procedure.oid, 'execute')
      )
  ),
  'no non-trigger SECURITY DEFINER mutator remains exposed to Data API clients'
);

select is(
  (
    select count(distinct procedure.proname)::bigint
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'distribute_lead_from_backend',
        'handle_managed_whatsapp_message_lead',
        'handle_routed_lead_intake',
        'register_lead_reentry',
        'upsert_whatsapp_webhook_lead'
      )
      and has_function_privilege('service_role', procedure.oid, 'execute')
  ),
  5::bigint,
  'service_role retains EXECUTE on canonical backend and Edge mutation RPCs'
);

select is(
  (
    select count(*)::bigint
    from pg_publication_tables publication_table
    where publication_table.pubname = 'supabase_realtime'
      and publication_table.schemaname = 'public'
      and publication_table.tablename in ('stages', 'leads')
  ),
  2::bigint,
  'existing authenticated Realtime publication membership is preserved'
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
    '98600000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'pipeline-gateway-active@example.test',
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
    '98600000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'pipeline-gateway-inactive@example.test',
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
  '98610000-0000-4000-8000-000000000001',
  'Pipeline Gateway Test Organization',
  'pipeline-gateway-security-test',
  true
);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    '98600000-0000-4000-8000-000000000001',
    '98610000-0000-4000-8000-000000000001',
    'Pipeline Gateway Active Admin',
    'pipeline-gateway-active@example.test',
    'admin',
    true
  ),
  (
    '98600000-0000-4000-8000-000000000002',
    '98610000-0000-4000-8000-000000000001',
    'Pipeline Gateway Inactive Admin',
    'pipeline-gateway-inactive@example.test',
    'admin',
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
  is_active,
  deleted_at
)
values
  (
    '98610000-0000-4000-8000-000000000001',
    '98600000-0000-4000-8000-000000000001',
    'admin',
    true,
    null
  ),
  (
    '98610000-0000-4000-8000-000000000001',
    '98600000-0000-4000-8000-000000000002',
    'admin',
    false,
    null
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = excluded.deleted_at;

insert into public.pipelines (id, organization_id, name, is_default, is_active, position)
values (
  '98620000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  'Pipeline Gateway Fixture',
  false,
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
  '98630000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  '98620000-0000-4000-8000-000000000001',
  'Pipeline Gateway Stage',
  'pipeline_gateway_stage',
  1,
  true
);

insert into public.leads (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  assigned_user_id,
  name,
  source
)
values (
  '98640000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  '98620000-0000-4000-8000-000000000001',
  '98630000-0000-4000-8000-000000000001',
  '98600000-0000-4000-8000-000000000001',
  'Pipeline Gateway Lead',
  'manual'
);

insert into public.stage_automations (
  id,
  organization_id,
  stage_id,
  trigger_type,
  action_type
)
values (
  '98650000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  '98630000-0000-4000-8000-000000000001',
  'on_enter',
  'create_task'
);

insert into public.stage_operational_configs (
  id,
  organization_id,
  stage_id,
  operation_context
)
values (
  '98660000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  '98630000-0000-4000-8000-000000000001',
  'imobiliario'
);

insert into public.pipeline_sla_settings (
  id,
  organization_id,
  pipeline_id,
  stage_id,
  warning_hours,
  critical_hours
)
values (
  '98670000-0000-4000-8000-000000000001',
  '98610000-0000-4000-8000-000000000001',
  '98620000-0000-4000-8000-000000000001',
  '98630000-0000-4000-8000-000000000001',
  24,
  48
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98600000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  private.user_has_permission('pipeline_manage')
  and private.user_has_permission('lead_operate')
  and private.user_has_permission('lead_delete'),
  'fixture has pipeline_manage, lead_operate and lead_delete-equivalent admin permissions'
);

select results_eq(
  $$select count(*)::bigint from public.pipelines where id = '98620000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active member retains tenant-filtered pipeline reads'
);

select results_eq(
  $$select count(*)::bigint from public.stages where id = '98630000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active member retains tenant-filtered stage reads'
);

select results_eq(
  $$select count(*)::bigint from public.leads where id = '98640000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active admin retains tenant-filtered lead reads'
);

select results_eq(
  $$select count(*)::bigint from public.stage_automations where id = '98650000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active member retains tenant-filtered stage-automation reads'
);

select results_eq(
  $$select count(*)::bigint from public.stage_operational_configs where id = '98660000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active member retains tenant-filtered operational-config reads'
);

select results_eq(
  $$select count(*)::bigint from public.pipeline_sla_settings where id = '98670000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'active member retains tenant-filtered pipeline-SLA reads'
);

select throws_ok(
  $$truncate table public.pipelines$$,
  '42501',
  null,
  'pipeline_manage cannot bypass RLS with TRUNCATE on pipelines'
);

select throws_ok(
  $$truncate table public.stages$$,
  '42501',
  null,
  'pipeline_manage cannot bypass RLS with TRUNCATE on stages'
);

select throws_ok(
  $$truncate table public.leads$$,
  '42501',
  null,
  'lead_operate cannot bypass RLS with TRUNCATE on leads'
);

select throws_ok(
  $$truncate table public.stage_automations$$,
  '42501',
  null,
  'automation permissions cannot bypass RLS with TRUNCATE on stage automations'
);

select throws_ok(
  $$truncate table public.stage_operational_configs$$,
  '42501',
  null,
  'pipeline_manage cannot bypass RLS with TRUNCATE on operational configs'
);

select throws_ok(
  $$truncate table public.pipeline_sla_settings$$,
  '42501',
  null,
  'pipeline_manage cannot bypass RLS with TRUNCATE on pipeline SLA settings'
);

select throws_ok(
  $$insert into public.pipelines (organization_id, name) values ('98610000-0000-4000-8000-000000000001', 'Data API bypass')$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API pipeline creation validation'
);

select throws_ok(
  $$update public.pipelines set name = 'Data API bypass' where id = '98620000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API pipeline update validation'
);

select throws_ok(
  $$delete from public.pipelines where id = '98620000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API pipeline deletion validation'
);

select throws_ok(
  $$insert into public.stages (organization_id, pipeline_id, name, stage_key) values ('98610000-0000-4000-8000-000000000001', '98620000-0000-4000-8000-000000000001', 'Data API bypass', 'data_api_bypass')$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API stage creation validation'
);

select throws_ok(
  $$update public.stages set name = 'Data API bypass' where id = '98630000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API stage update validation'
);

select throws_ok(
  $$delete from public.stages where id = '98630000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API stage deletion validation'
);

select throws_ok(
  $$insert into public.leads (organization_id, name, source) values ('98610000-0000-4000-8000-000000000001', 'Data API bypass', 'manual')$$,
  '42501',
  null,
  'lead_operate cannot bypass API lead creation validation'
);

select throws_ok(
  $$update public.leads set name = 'Data API bypass' where id = '98640000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'lead_operate cannot bypass API lead update validation'
);

select throws_ok(
  $$delete from public.leads where id = '98640000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'lead_delete cannot bypass API lead deletion validation'
);

select throws_ok(
  $$insert into public.stage_automations (organization_id, stage_id, trigger_type, action_type) values ('98610000-0000-4000-8000-000000000001', '98630000-0000-4000-8000-000000000001', 'on_enter', 'create_task')$$,
  '42501',
  null,
  'automation permissions cannot bypass API stage-automation creation validation'
);

select throws_ok(
  $$update public.stage_automations set action_type = 'send_notification' where id = '98650000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'automation permissions cannot bypass API stage-automation update validation'
);

select throws_ok(
  $$delete from public.stage_automations where id = '98650000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'automation permissions cannot bypass API stage-automation deletion validation'
);

select throws_ok(
  $$insert into public.stage_operational_configs (organization_id, stage_id, operation_context) values ('98610000-0000-4000-8000-000000000001', '98630000-0000-4000-8000-000000000001', 'imobiliario')$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API operational-config creation validation'
);

select throws_ok(
  $$update public.stage_operational_configs set warning_minutes = 5 where id = '98660000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API operational-config update validation'
);

select throws_ok(
  $$delete from public.stage_operational_configs where id = '98660000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API operational-config deletion validation'
);

select throws_ok(
  $$insert into public.pipeline_sla_settings (organization_id, pipeline_id, warning_hours, critical_hours) values ('98610000-0000-4000-8000-000000000001', '98620000-0000-4000-8000-000000000001', 24, 48)$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API SLA creation validation'
);

select throws_ok(
  $$update public.pipeline_sla_settings set warning_hours = 12 where id = '98670000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API SLA update validation'
);

select throws_ok(
  $$delete from public.pipeline_sla_settings where id = '98670000-0000-4000-8000-000000000001'$$,
  '42501',
  null,
  'pipeline_manage cannot bypass API SLA deletion validation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98600000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.pipelines where id = '98620000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read pipelines'
);

select results_eq(
  $$select count(*)::bigint from public.stages where id = '98630000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read stages'
);

select results_eq(
  $$select count(*)::bigint from public.leads where id = '98640000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read leads'
);

select results_eq(
  $$select count(*)::bigint from public.stage_automations where id = '98650000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read stage automations'
);

select results_eq(
  $$select count(*)::bigint from public.stage_operational_configs where id = '98660000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read operational configs'
);

select results_eq(
  $$select count(*)::bigint from public.pipeline_sla_settings where id = '98670000-0000-4000-8000-000000000001'$$,
  array[0::bigint],
  'inactive membership cannot read pipeline SLA settings'
);

reset role;
set local role service_role;

select results_eq(
  $$select count(*)::bigint from public.leads where id = '98640000-0000-4000-8000-000000000001'$$,
  array[1::bigint],
  'service_role retains backend reads'
);

select lives_ok(
  $$update public.pipelines set name = name where id = '98620000-0000-4000-8000-000000000001'$$,
  'service_role retains backend pipeline mutations'
);

select lives_ok(
  $$update public.stages set name = name where id = '98630000-0000-4000-8000-000000000001'$$,
  'service_role retains backend stage mutations'
);

select lives_ok(
  $$update public.leads set name = name where id = '98640000-0000-4000-8000-000000000001'$$,
  'service_role retains backend lead mutations'
);

select lives_ok(
  $$update public.stage_automations set action_type = action_type where id = '98650000-0000-4000-8000-000000000001'$$,
  'service_role retains backend stage-automation mutations'
);

select lives_ok(
  $$update public.stage_operational_configs set warning_minutes = warning_minutes where id = '98660000-0000-4000-8000-000000000001'$$,
  'service_role retains backend operational-config mutations'
);

select lives_ok(
  $$update public.pipeline_sla_settings set warning_hours = warning_hours where id = '98670000-0000-4000-8000-000000000001'$$,
  'service_role retains backend pipeline-SLA mutations'
);

reset role;

select * from finish();
rollback;
