begin;

create extension if not exists pgtap with schema extensions;
select plan(38);

select has_table(
  'private',
  'team_distribution_events',
  'private team distribution event ledger exists'
);

select is(
  (
    select count(*)::integer
    from pg_constraint
    where conrelid = 'private.team_distribution_events'::regclass
      and contype = 'f'
  ),
  0,
  'event snapshots have no destructive foreign keys'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.team_distribution_events'::regclass
  ),
  'event snapshot ledger keeps RLS enabled'
);

select ok(
  not has_table_privilege('anon', 'private.team_distribution_events', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('authenticated', 'private.team_distribution_events', 'select,insert,update,delete,truncate,references,trigger')
  and not has_table_privilege('service_role', 'private.team_distribution_events', 'select,insert,update,delete,truncate,references,trigger'),
  'private event snapshots are not directly exposed to API roles'
);

select ok(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.team_distribution_event_coverage'::regclass
  )
  and not has_table_privilege('anon', 'private.team_distribution_event_coverage', 'select,insert,update,delete')
  and not has_table_privilege('authenticated', 'private.team_distribution_event_coverage', 'select,insert,update,delete')
  and not has_table_privilege('service_role', 'private.team_distribution_event_coverage', 'select,insert,update,delete'),
  'coverage metadata is private and protected by RLS'
);

select ok(
  has_table_privilege('authenticated', 'public.round_robin_logs', 'select'),
  'authenticated keeps legacy read access to round-robin logs'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.round_robin_logs',
    'insert,update,delete,truncate,references,trigger'
  )
  and not has_table_privilege(
    'anon',
    'public.round_robin_logs',
    'insert,update,delete,truncate,references,trigger'
  ),
  'browser roles cannot forge or mutate KPI source logs'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.round_robin_logs',
    'select,insert,update,delete,truncate,references,trigger'
  ),
  'service_role retains its round-robin log privileges'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.round_robin_logs'::regclass
      and tgname = 'trg_capture_team_distribution_event'
      and not tgisinternal
  ),
  'new round-robin logs invoke the event snapshot trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'private.team_distribution_events'::regclass
      and tgname = 'trg_prevent_team_distribution_event_mutation'
      and not tgisinternal
  ),
  'event snapshots reject update and delete operations'
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
    '98500000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'team-event-user-a@example.test',
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
    '98500000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'team-event-user-b@example.test',
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
    '98500000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'team-event-user-inactive@example.test',
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
    '98500000-0000-4000-8000-000000000004',
    'authenticated',
    'authenticated',
    'team-event-user-deleted@example.test',
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
    '98510000-0000-4000-8000-000000000001',
    'Team Event Org A',
    'team-event-snapshot-org-a',
    true
  ),
  (
    '98510000-0000-4000-8000-000000000002',
    'Team Event Org B',
    'team-event-snapshot-org-b',
    true
  );

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    '98500000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    'Team Event User A',
    'team-event-user-a@example.test',
    'admin',
    true
  ),
  (
    '98500000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000002',
    'Team Event User B',
    'team-event-user-b@example.test',
    'admin',
    true
  ),
  (
    '98500000-0000-4000-8000-000000000003',
    '98510000-0000-4000-8000-000000000001',
    'Team Event User Inactive Membership',
    'team-event-user-inactive@example.test',
    'user',
    true
  ),
  (
    '98500000-0000-4000-8000-000000000004',
    '98510000-0000-4000-8000-000000000001',
    'Team Event User Deleted Membership',
    'team-event-user-deleted@example.test',
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
  is_active,
  deleted_at
)
values
  (
    '98510000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    'admin',
    true,
    null
  ),
  (
    '98510000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000002',
    'admin',
    true,
    null
  ),
  (
    '98510000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000002',
    'user',
    true,
    null
  ),
  (
    '98510000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000003',
    'user',
    true,
    null
  ),
  (
    '98510000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000004',
    'user',
    true,
    null
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = excluded.deleted_at;

insert into public.teams (id, organization_id, name, created_by, is_active)
values
  (
    '98520000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    'Team Event A',
    '98500000-0000-4000-8000-000000000001',
    true
  ),
  (
    '98520000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000001',
    'Team Event A2',
    '98500000-0000-4000-8000-000000000001',
    true
  ),
  (
    '98520000-0000-4000-8000-000000000003',
    '98510000-0000-4000-8000-000000000002',
    'Team Event B',
    '98500000-0000-4000-8000-000000000002',
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
    '98530000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    false,
    true
  ),
  (
    '98530000-0000-4000-8000-000000000002',
    '98520000-0000-4000-8000-000000000003',
    '98500000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000002',
    false,
    true
  ),
  (
    '98530000-0000-4000-8000-000000000003',
    '98520000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000001',
    false,
    true
  );

insert into public.round_robins (
  id,
  organization_id,
  name,
  is_active,
  created_by,
  settings
)
values
  (
    '98540000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    'Team Event Queue A',
    true,
    '98500000-0000-4000-8000-000000000001',
    '{}'::jsonb
  ),
  (
    '98540000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000002',
    'Team Event Queue B',
    true,
    '98500000-0000-4000-8000-000000000002',
    '{}'::jsonb
  );

insert into public.round_robin_members (
  id,
  round_robin_id,
  user_id,
  team_id,
  organization_id,
  position,
  weight,
  is_active
)
values
  (
    '98550000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    0,
    1,
    true
  ),
  (
    '98550000-0000-4000-8000-000000000002',
    '98540000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000002',
    '98520000-0000-4000-8000-000000000003',
    '98510000-0000-4000-8000-000000000002',
    0,
    1,
    true
  ),
  (
    '98550000-0000-4000-8000-000000000003',
    '98540000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000002',
    '98520000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000001',
    1,
    1,
    true
  );

insert into public.leads (
  id,
  organization_id,
  team_id,
  assigned_user_id,
  name,
  source
)
values
  (
    '98560000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    'Team Event Lead A1',
    'test'
  ),
  (
    '98560000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    'Team Event Lead A2',
    'test'
  ),
  (
    '98560000-0000-4000-8000-000000000003',
    '98510000-0000-4000-8000-000000000002',
    '98520000-0000-4000-8000-000000000003',
    '98500000-0000-4000-8000-000000000002',
    'Team Event Lead B1',
    'test'
  ),
  (
    '98560000-0000-4000-8000-000000000004',
    '98510000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000002',
    'Team Event Lead Multi Org',
    'test'
  ),
  (
    '98560000-0000-4000-8000-000000000005',
    '98510000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000003',
    'Team Event Lead Inactive Membership',
    'test'
  ),
  (
    '98560000-0000-4000-8000-000000000006',
    '98510000-0000-4000-8000-000000000001',
    '98520000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000004',
    'Team Event Lead Deleted Membership',
    'test'
  );

update public.organization_members
set is_active = false
where organization_id = '98510000-0000-4000-8000-000000000001'
  and user_id = '98500000-0000-4000-8000-000000000003';

update public.organization_members
set deleted_at = clock_timestamp()
where organization_id = '98510000-0000-4000-8000-000000000001'
  and user_id = '98500000-0000-4000-8000-000000000004';

insert into public.round_robin_logs (
  id,
  organization_id,
  round_robin_id,
  lead_id,
  assigned_user_id,
  member_id,
  reason,
  metadata
)
values
  (
    '98570000-0000-4000-8000-000000000001',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    '98550000-0000-4000-8000-000000000001',
    'canonical_round_robin',
    '{"team_id":"98520000-0000-4000-8000-000000000001","member_id":"98550000-0000-4000-8000-000000000001"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000002',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    null,
    'auto_redistribution',
    '{"member_id":"98550000-0000-4000-8000-000000000001","previous_user_id":"98500000-0000-4000-8000-000000000099"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000003',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000001',
    '98500000-0000-4000-8000-000000000001',
    null,
    'round_robin',
    '{"member_id":"98550000-0000-4000-8000-000000000001"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000004',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000001',
    null,
    'meta_lead_ads',
    '{}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000005',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000002',
    null,
    null,
    'no_available_members',
    '{"team_id":"98520000-0000-4000-8000-000000000001"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000006',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000001',
    null,
    'grupo_olx',
    '{"team_id":"98520000-0000-4000-8000-000000000003"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000007',
    '98510000-0000-4000-8000-000000000002',
    '98540000-0000-4000-8000-000000000002',
    '98560000-0000-4000-8000-000000000003',
    '98500000-0000-4000-8000-000000000002',
    '98550000-0000-4000-8000-000000000002',
    'canonical_round_robin',
    '{"team_id":"98520000-0000-4000-8000-000000000003"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000008',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000002',
    null,
    'meta_lead_ads',
    '{}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000009',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000002',
    '98500000-0000-4000-8000-000000000001',
    '98550000-0000-4000-8000-000000000001',
    'canonical_round_robin',
    '{"team_id":"98520000-0000-4000-8000-000000000002"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000011',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000004',
    '98500000-0000-4000-8000-000000000002',
    '98550000-0000-4000-8000-000000000003',
    'canonical_round_robin',
    '{"team_id":"98520000-0000-4000-8000-000000000002","member_id":"98550000-0000-4000-8000-000000000003"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000012',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000005',
    '98500000-0000-4000-8000-000000000003',
    null,
    'meta_lead_ads',
    '{"team_id":"98520000-0000-4000-8000-000000000001"}'::jsonb
  ),
  (
    '98570000-0000-4000-8000-000000000013',
    '98510000-0000-4000-8000-000000000001',
    '98540000-0000-4000-8000-000000000001',
    '98560000-0000-4000-8000-000000000006',
    '98500000-0000-4000-8000-000000000004',
    null,
    'meta_lead_ads',
    '{"team_id":"98520000-0000-4000-8000-000000000001"}'::jsonb
  );

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000001'
  $$,
  array[5::bigint],
  'team A receives every successful event with a proven same-tenant team'
);

select results_eq(
  $$
    select count(distinct lead_id)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000001'
  $$,
  array[2::bigint],
  'team A preserves unique lead semantics across redistributions'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000001'
      and event_kind = 'redistribution'
  $$,
  array[2::bigint],
  'automatic and manual redistribution events are classified separately'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000002'
      and team_id = '98520000-0000-4000-8000-000000000003'
  $$,
  array[1::bigint],
  'organization B captures only its own event'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000003'
  $$,
  array[0::bigint],
  'cross-organization team snapshots cannot enter tenant A metrics'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000005'
  $$,
  array[0::bigint],
  'reason alone cannot turn a failed unassigned log into a successful event'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000008'
  $$,
  array[0::bigint],
  'a log written before the lead assignee update fails closed'
);

select results_eq(
  $$
    select organization_id, team_id
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000011'
  $$,
  $$ values (
    '98510000-0000-4000-8000-000000000001'::uuid,
    '98520000-0000-4000-8000-000000000002'::uuid
  ) $$,
  'an active organization membership captures a multi-organization user without trusting users.organization_id'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000012'
  $$,
  array[0::bigint],
  'an inactive organization membership cannot produce a team event'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000013'
  $$,
  array[0::bigint],
  'a deleted organization membership cannot produce a team event'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000009'
  $$,
  array[0::bigint],
  'conflicting same-tenant team evidence fails closed'
);

select results_eq(
  $$
    select team_id
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000006'
  $$,
  array['98520000-0000-4000-8000-000000000001'::uuid],
  'foreign metadata is ignored and the proven lead team is retained'
);

select results_eq(
  $$
    select event_kind
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000001'
  $$,
  array['distribution'::text],
  'canonical success is classified as a distribution'
);

select results_eq(
  $$
    select event_kind
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000002'
  $$,
  array['redistribution'::text],
  'auto redistribution is captured as a redistribution'
);

select results_eq(
  $$
    select event_kind
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000003'
  $$,
  array['redistribution'::text],
  'manual round-robin redistribution is captured as a redistribution'
);

select results_eq(
  $$
    select coverage || ':' || backfill_strategy
    from private.team_distribution_event_coverage
    where scope = 'global'
  $$,
  array['partial:metadata_team_id_same_organization_only'::text],
  'coverage reports the conservative historical backfill strategy'
);

select ok(
  (
    select complete_since <= clock_timestamp()
    from private.team_distribution_event_coverage
    where scope = 'global'
  ),
  'coverage exposes a complete-since boundary for future events'
);

select throws_ok(
  $$
    update private.team_distribution_events
    set event_kind = 'distribution'
    where round_robin_log_id = '98570000-0000-4000-8000-000000000002'
  $$,
  '55000',
  null,
  'event snapshots cannot be updated'
);

select throws_ok(
  $$
    delete from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000001'
  $$,
  '55000',
  null,
  'event snapshots cannot be deleted'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '98500000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$
    insert into public.round_robin_logs (
      organization_id,
      round_robin_id,
      lead_id,
      assigned_user_id,
      reason
    ) values (
      '98510000-0000-4000-8000-000000000001',
      '98540000-0000-4000-8000-000000000001',
      '98560000-0000-4000-8000-000000000001',
      '98500000-0000-4000-8000-000000000001',
      'forged_browser_event'
    )
  $$,
  '42501',
  null,
  'authenticated clients cannot insert metric source logs'
);

select throws_ok(
  $$
    update public.round_robin_logs
    set reason = 'forged_browser_update'
    where id = '98570000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated clients cannot update metric source logs'
);

select throws_ok(
  $$
    delete from public.round_robin_logs
    where id = '98570000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'authenticated clients cannot delete metric source logs'
);

select throws_ok(
  $$select count(*) from private.team_distribution_events$$,
  '42501',
  null,
  'authenticated clients cannot read the private snapshot ledger'
);

reset role;
set local role service_role;

select lives_ok(
  $$
    insert into public.round_robin_logs (
      id,
      organization_id,
      round_robin_id,
      lead_id,
      assigned_user_id,
      reason,
      metadata
    ) values (
      '98570000-0000-4000-8000-000000000010',
      '98510000-0000-4000-8000-000000000001',
      '98540000-0000-4000-8000-000000000001',
      '98560000-0000-4000-8000-000000000002',
      '98500000-0000-4000-8000-000000000001',
      'meta_lead_ads',
      '{}'::jsonb
    )
  $$,
  'service_role can write a legitimate backend distribution log'
);

reset role;

select results_eq(
  $$
    select event_kind
    from private.team_distribution_events
    where round_robin_log_id = '98570000-0000-4000-8000-000000000010'
  $$,
  array['distribution'::text],
  'service_role writes are captured by the private trigger'
);

select lives_ok(
  $$
    delete from public.round_robin_logs
    where organization_id = '98510000-0000-4000-8000-000000000001'
  $$,
  'operational round-robin logs retain their existing deletion policy'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000001'
  $$,
  array[6::bigint],
  'deleting operational logs does not erase append-only team event history'
);

select results_eq(
  $$
    select count(distinct lead_id)::bigint
    from private.team_distribution_events
    where organization_id = '98510000-0000-4000-8000-000000000001'
      and team_id = '98520000-0000-4000-8000-000000000001'
  $$,
  array[2::bigint],
  'unique lead history also survives operational log deletion'
);

select * from finish();
rollback;
