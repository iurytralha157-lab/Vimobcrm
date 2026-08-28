begin;

create extension if not exists pgtap with schema extensions;
select plan(14);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'gamification_events',
        'gamification_manual_entries',
        'gamification_mission_progress',
        'gamification_missions',
        'gamification_outbox',
        'gamification_participants',
        'gamification_rules',
        'gamification_seasons',
        'user_gamification_stats'
      ]::name[])
      and relation.relrowsecurity
  ),
  9::bigint,
  'every canonical gamification table in public has RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'public.gamification_outbox', 'select')
  and not has_table_privilege('anon', 'public.gamification_outbox', 'insert')
  and not has_table_privilege('authenticated', 'public.gamification_outbox', 'select')
  and not has_table_privilege('authenticated', 'public.gamification_outbox', 'insert'),
  'browser roles cannot read or enqueue canonical outbox jobs'
);

select is(
  (
    select count(*)
    from information_schema.role_table_grants as grant_entry
    where grant_entry.table_schema = 'public'
      and grant_entry.table_name = any(array[
        'gamification_events',
        'gamification_manual_entries',
        'gamification_mission_progress',
        'gamification_missions',
        'gamification_participants',
        'gamification_rules',
        'gamification_seasons',
        'user_gamification_stats'
      ])
      and grant_entry.grantee in ('anon', 'authenticated')
      and (
        grant_entry.grantee = 'anon'
        or grant_entry.privilege_type <> 'SELECT'
      )
  ),
  0::bigint,
  'canonical browser-readable tables grant authenticated SELECT only'
);

select is(
  (
    select count(*)
    from pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename = any(array[
        'gamification_events',
        'gamification_manual_entries',
        'gamification_mission_progress',
        'gamification_missions',
        'gamification_outbox',
        'gamification_participants',
        'gamification_rules',
        'gamification_seasons',
        'user_gamification_stats'
      ])
      and (
        policy.cmd <> 'SELECT'
        or policy.roles <> array['authenticated']::name[]
      )
  ),
  0::bigint,
  'canonical client policies are read-only and target authenticated users'
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
    '91000000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'gamification-user-a@example.test',
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
    '91000000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'gamification-admin-a@example.test',
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
    '91000000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'gamification-user-b@example.test',
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
values
  ('92000000-0000-4000-8000-000000000001', 'Gamification Test Org A', 'gamification-test-org-a', true),
  ('92000000-0000-4000-8000-000000000002', 'Gamification Test Org B', 'gamification-test-org-b', true);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  ('91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Gamification User A', 'gamification-user-a@example.test', 'user', true),
  ('91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', 'Gamification Admin A', 'gamification-admin-a@example.test', 'user', true),
  ('91000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000002', 'Gamification User B', 'gamification-user-b@example.test', 'user', true)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_members (organization_id, user_id, role, is_active)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'user', true),
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000002', 'admin', true),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000003', 'user', true)
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_modules (organization_id, module_name, is_enabled)
values
  ('92000000-0000-4000-8000-000000000001', 'gamification', true),
  ('92000000-0000-4000-8000-000000000002', 'gamification', true)
on conflict (organization_id, module_name) do update
set is_enabled = excluded.is_enabled,
    updated_at = now();

select is(
  (
    select count(*)
    from public.gamification_seasons
    where organization_id in (
      '92000000-0000-4000-8000-000000000001',
      '92000000-0000-4000-8000-000000000002'
    )
      and is_active
  ),
  2::bigint,
  'enabling the module bootstraps one active season per organization'
);

insert into public.gamification_events (
  id,
  organization_id,
  season_id,
  user_id,
  event_type,
  points_earned,
  xp_earned,
  idempotency_key
)
values
  (
    '93000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000001' and is_active),
    '91000000-0000-4000-8000-000000000001',
    'call_made',
    5,
    5,
    'test|org-a|user'
  ),
  (
    '93000000-0000-4000-8000-000000000002',
    '92000000-0000-4000-8000-000000000001',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000001' and is_active),
    '91000000-0000-4000-8000-000000000002',
    'call_made',
    5,
    5,
    'test|org-a|admin'
  ),
  (
    '93000000-0000-4000-8000-000000000003',
    '92000000-0000-4000-8000-000000000002',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000002' and is_active),
    '91000000-0000-4000-8000-000000000003',
    'call_made',
    5,
    5,
    'test|org-b|user'
  );

insert into public.user_gamification_stats (
  organization_id,
  season_id,
  user_id,
  total_points,
  points,
  xp,
  xp_total
)
values
  (
    '92000000-0000-4000-8000-000000000001',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000001' and is_active),
    '91000000-0000-4000-8000-000000000001',
    5,
    5,
    5,
    5
  ),
  (
    '92000000-0000-4000-8000-000000000001',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000001' and is_active),
    '91000000-0000-4000-8000-000000000002',
    5,
    5,
    5,
    5
  ),
  (
    '92000000-0000-4000-8000-000000000002',
    (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000002' and is_active),
    '91000000-0000-4000-8000-000000000003',
    5,
    5,
    5,
    5
  );

insert into public.gamification_missions (
  id,
  organization_id,
  title,
  action_type,
  target_count,
  bonus_points,
  period,
  is_active,
  target_scope,
  target_user_id
)
values
  ('94000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'Mission Org A', 'call_made', 10, 50, 'daily', true, 'organization', null),
  ('94000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', 'Mission Org B', 'call_made', 10, 50, 'daily', true, 'organization', null),
  ('94000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', 'Mission User A', 'call_made', 10, 50, 'daily', true, 'user', '91000000-0000-4000-8000-000000000001'),
  ('94000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000001', 'Mission Admin A', 'call_made', 10, 50, 'daily', true, 'user', '91000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.gamification_events$$,
  array[1::bigint],
  'ordinary user reads only their own event ledger rows'
);

select results_eq(
  $$select count(*)::bigint from public.user_gamification_stats$$,
  array[2::bigint],
  'ordinary user can build the ranking only from their own organization'
);

select results_eq(
  $$select count(*)::bigint from public.gamification_missions$$,
  array[2::bigint],
  'ordinary user reads organization missions and their own targeted missions only'
);

select throws_ok(
  $$select count(*) from public.gamification_outbox$$,
  '42501',
  null,
  'ordinary user cannot enumerate internal outbox jobs'
);

select throws_ok(
  $$insert into public.gamification_events (
      organization_id, season_id, user_id, event_type, points_earned, xp_earned, idempotency_key
    ) values (
      '92000000-0000-4000-8000-000000000001',
      (select id from public.gamification_seasons where organization_id = '92000000-0000-4000-8000-000000000001' and is_active),
      '91000000-0000-4000-8000-000000000001',
      'sale_closed',
      500,
      500,
      'forged-browser-award'
    )$$,
  '42501',
  null,
  'ordinary user cannot forge a ledger award'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000002', true);
select results_eq(
  $$select count(*)::bigint from public.gamification_events$$,
  array[2::bigint],
  'organization admin reads the full ledger for their organization only'
);

select results_eq(
  $$select count(*)::bigint from public.gamification_missions$$,
  array[3::bigint],
  'organization admin reads all missions in their organization'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select count(*)::bigint from public.gamification_events$$,
  array[1::bigint],
  'user in a second organization cannot read the first organization ledger'
);

reset role;
update public.organization_modules
set is_enabled = false
where organization_id = '92000000-0000-4000-8000-000000000002'
  and module_name = 'gamification';

set local role authenticated;
select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000003', true);
select results_eq(
  $$select count(*)::bigint from public.gamification_events$$,
  array[0::bigint],
  'module disablement immediately closes direct ledger reads'
);

reset role;
select * from finish();
rollback;
