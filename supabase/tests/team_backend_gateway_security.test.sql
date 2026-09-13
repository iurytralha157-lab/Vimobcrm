begin;

create extension if not exists pgtap with schema extensions;
select plan(22);

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
    '98400000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'team-gateway-user@example.test',
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
    '98400000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'team-gateway-leader@example.test',
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
    '98400000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'team-gateway-admin@example.test',
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
    '98400000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'team-gateway-cross-org@example.test',
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
  (
    '98410000-0000-4000-8000-000000000001',
    'Team Gateway Org A',
    'team-gateway-security-org-a',
    true
  ),
  (
    '98410000-0000-4000-8000-000000000002',
    'Team Gateway Org B',
    'team-gateway-security-org-b',
    true
  );

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    '98400000-0000-4000-8000-000000000001',
    '98410000-0000-4000-8000-000000000001',
    'Team Gateway User',
    'team-gateway-user@example.test',
    'user',
    true
  ),
  (
    '98400000-0000-4000-8000-000000000002',
    '98410000-0000-4000-8000-000000000001',
    'Team Gateway Leader',
    'team-gateway-leader@example.test',
    'user',
    true
  ),
  (
    '98400000-0000-4000-8000-000000000003',
    '98410000-0000-4000-8000-000000000001',
    'Team Gateway Admin',
    'team-gateway-admin@example.test',
    'admin',
    true
  ),
  (
    '98400000-0000-4000-8000-000000000004',
    '98410000-0000-4000-8000-000000000002',
    'Team Gateway Cross Org',
    'team-gateway-cross-org@example.test',
    'user',
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
    '98410000-0000-4000-8000-000000000001',
    '98400000-0000-4000-8000-000000000001',
    'user',
    true
  ),
  (
    '98410000-0000-4000-8000-000000000001',
    '98400000-0000-4000-8000-000000000002',
    'user',
    true
  ),
  (
    '98410000-0000-4000-8000-000000000001',
    '98400000-0000-4000-8000-000000000003',
    'admin',
    true
  ),
  (
    '98410000-0000-4000-8000-000000000002',
    '98400000-0000-4000-8000-000000000004',
    'user',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = null;

insert into public.teams (id, organization_id, name, created_by, is_active)
values
  (
    '98420000-0000-4000-8000-000000000001',
    '98410000-0000-4000-8000-000000000001',
    'Team Gateway Org A Team',
    '98400000-0000-4000-8000-000000000003',
    true
  ),
  (
    '98420000-0000-4000-8000-000000000002',
    '98410000-0000-4000-8000-000000000002',
    'Team Gateway Org B Team',
    '98400000-0000-4000-8000-000000000004',
    true
  );

insert into public.team_members (
  id,
  team_id,
  user_id,
  organization_id,
  is_leader,
  is_active
)
values
  (
    '98430000-0000-4000-8000-000000000001',
    '98420000-0000-4000-8000-000000000001',
    '98400000-0000-4000-8000-000000000001',
    '98410000-0000-4000-8000-000000000001',
    false,
    true
  ),
  (
    '98430000-0000-4000-8000-000000000002',
    '98420000-0000-4000-8000-000000000001',
    '98400000-0000-4000-8000-000000000002',
    '98410000-0000-4000-8000-000000000001',
    true,
    true
  ),
  (
    '98430000-0000-4000-8000-000000000003',
    '98420000-0000-4000-8000-000000000002',
    '98400000-0000-4000-8000-000000000004',
    '98410000-0000-4000-8000-000000000002',
    false,
    true
  );

insert into public.member_availability (
  id,
  team_member_id,
  organization_id,
  day_of_week,
  start_time,
  end_time,
  is_all_day,
  is_active
)
values
  (
    '98440000-0000-4000-8000-000000000001',
    '98430000-0000-4000-8000-000000000001',
    '98410000-0000-4000-8000-000000000001',
    1,
    '09:00',
    '18:00',
    false,
    true
  ),
  (
    '98440000-0000-4000-8000-000000000002',
    '98430000-0000-4000-8000-000000000003',
    '98410000-0000-4000-8000-000000000002',
    1,
    null,
    null,
    true,
    true
  );

select ok(
  not has_table_privilege(
    'anon',
    'public.teams',
    'select,insert,update,delete,truncate,references,trigger'
  )
  and not has_table_privilege(
    'anon',
    'public.team_members',
    'select,insert,update,delete,truncate,references,trigger'
  )
  and not has_table_privilege(
    'anon',
    'public.member_availability',
    'select,insert,update,delete,truncate,references,trigger'
  ),
  'anonymous clients have no direct privileges on the team domain'
);

select ok(
  has_table_privilege('authenticated', 'public.teams', 'select')
  and not has_table_privilege(
    'authenticated',
    'public.teams',
    'insert,update,delete,truncate,references,trigger'
  ),
  'authenticated keeps only the teams read required by cross-domain RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.team_members', 'select')
  and not has_table_privilege(
    'authenticated',
    'public.team_members',
    'insert,update,delete,truncate,references,trigger'
  ),
  'authenticated keeps only the team_members read required by cross-domain RLS'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.member_availability',
    'select,insert,update,delete,truncate,references,trigger'
  ),
  'authenticated clients have no direct privileges on member_availability'
);

select ok(
  (
    select bool_and(has_table_privilege('service_role', relation_name, privilege_name))
    from (
      values
        ('public.teams'),
        ('public.team_members'),
        ('public.member_availability')
    ) as relation(relation_name)
    cross join (
      values
        ('select'),
        ('insert'),
        ('update'),
        ('delete')
    ) as privilege(privilege_name)
  ),
  'service_role retains backend DML privileges on the team domain'
);

select ok(
  (
    select bool_and(has_table_privilege('postgres', relation_name, privilege_name))
    from (
      values
        ('public.teams'),
        ('public.team_members'),
        ('public.member_availability')
    ) as relation(relation_name)
    cross join (
      values
        ('select'),
        ('insert'),
        ('update'),
        ('delete')
    ) as privilege(privilege_name)
  ),
  'postgres retains backend DML privileges on the team domain'
);

select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'public.teams'::regclass,
      'public.team_members'::regclass,
      'public.member_availability'::regclass
    )
  ),
  'RLS remains enabled as a second line of defense on the team domain'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.teams$$,
  array[1::bigint],
  'ordinary user can read only their organization team through legacy RLS'
);

select results_eq(
  $$select count(*)::bigint from public.team_members$$,
  array[2::bigint],
  'ordinary user cannot enumerate team memberships from another organization'
);

select throws_ok(
  $$
    insert into public.team_members (team_id, user_id, organization_id, is_leader)
    values (
      '98420000-0000-4000-8000-000000000001',
      '98400000-0000-4000-8000-000000000003',
      '98410000-0000-4000-8000-000000000001',
      false
    )
  $$,
  '42501',
  null,
  'ordinary user cannot mutate team membership through the Data API'
);

select throws_ok(
  $$select count(*) from public.member_availability$$,
  '42501',
  null,
  'ordinary user must read availability through the Go API'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.teams$$,
  array[1::bigint],
  'team leader keeps tenant-filtered reads needed by cross-domain RLS'
);

select throws_ok(
  $$
    update public.teams
    set name = 'Leader bypass attempt'
    where id = '98420000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'team leader cannot bypass backend update validation'
);

select throws_ok(
  $$
    delete from public.member_availability
    where id = '98440000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'team leader cannot bypass backend availability validation'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000003', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.teams$$,
  array[1::bigint],
  'organization admin keeps tenant-filtered reads needed by cross-domain RLS'
);

select throws_ok(
  $$
    insert into public.teams (organization_id, name, created_by)
    values (
      '98410000-0000-4000-8000-000000000001',
      'Admin bypass attempt',
      '98400000-0000-4000-8000-000000000003'
    )
  $$,
  '42501',
  null,
  'organization admin must create teams through the Go API'
);

reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', '98400000-0000-4000-8000-000000000004', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$
    select count(*)::bigint
    from public.teams
  $$,
  array[1::bigint],
  'cross-organization user sees only the team in their own tenant'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.team_members
    where organization_id = '98410000-0000-4000-8000-000000000001'
  $$,
  array[0::bigint],
  'cross-organization user cannot enumerate another tenant team membership'
);

select throws_ok(
  $$
    update public.member_availability
    set is_all_day = true, start_time = null, end_time = null
    where id = '98440000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'cross-organization user cannot mutate another tenant availability'
);

reset role;
set local role service_role;

select results_eq(
  $$select count(*)::bigint from public.teams where id::text like '98420000-%'$$,
  array[2::bigint],
  'service_role still reads backend team rows across organizations'
);

select lives_ok(
  $$
    update public.member_availability
    set is_active = is_active
    where id = '98440000-0000-4000-8000-000000000001'
  $$,
  'service_role still performs backend team-domain mutations'
);

reset role;

select lives_ok(
  $$select count(*) from public.team_members$$,
  'postgres still reads team-domain rows'
);

select * from finish();
rollback;
