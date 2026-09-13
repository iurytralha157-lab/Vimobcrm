begin;

create extension if not exists pgtap with schema extensions;
select plan(32);

select results_eq(
  $$
    select count(*)::bigint
    from public.available_permissions
    where key = 'users_presence_view'
      and category = 'access'
      and domain = 'access'
  $$,
  array[1::bigint],
  'user presence is registered in the canonical permission catalog'
);

select ok(
  to_regclass('public.idx_user_activity_sessions_org_user_last_seen') is not null
  and pg_get_indexdef(
    'public.idx_user_activity_sessions_org_user_last_seen'::regclass
  ) ilike '%(organization_id, user_id, last_seen_at desc, id desc)%',
  'latest presence aggregation has a tenant/user/recency index'
);

select has_column(
  'public',
  'user_activity_sessions',
  'idle_since_at',
  'activity sessions record when the current idle period began'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.user_activity_sessions'::regclass
      and tgname = 'maintain_user_activity_idle_since'
      and not tgisinternal
  ),
  'idle transition timestamp is maintained by a database trigger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.maintain_user_activity_idle_since()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.maintain_user_activity_idle_since()',
    'execute'
  ),
  'idle timestamp trigger function cannot be called directly'
);

create temporary table legacy_idle_repair_probe (
  status text not null,
  idle_since_at timestamptz
) on commit drop;

insert into legacy_idle_repair_probe (status, idle_since_at)
values ('idle', null);

create trigger maintain_legacy_idle_repair_probe
before insert or update of status, idle_since_at
on legacy_idle_repair_probe
for each row
execute function private.maintain_user_activity_idle_since();

update legacy_idle_repair_probe
set status = status;

select results_eq(
  $$
    select count(*)::bigint
    from legacy_idle_repair_probe
    where status = 'idle'
      and idle_since_at is not null
  $$,
  array[1::bigint],
  'the first heartbeat repairs a legacy idle state from the database clock'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.user_activity_sessions'::regclass
      and tgname = 'maintain_authenticated_user_activity_timestamps'
      and not tgisinternal
  ),
  'authenticated activity timestamps are maintained by a database trigger'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.maintain_authenticated_user_activity_timestamps()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.maintain_authenticated_user_activity_timestamps()',
    'execute'
  ),
  'activity timestamp trigger function cannot be called directly'
);

select ok(
  (
    select count(*) = 2
      and bool_and(convalidated)
    from pg_catalog.pg_constraint
    where conrelid = 'public.user_activity_sessions'::regclass
      and conname in (
        'user_activity_sessions_idle_since_status_check',
        'user_activity_sessions_disconnected_status_check'
      )
  ),
  'activity lifecycle consistency constraints are installed and validated'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_activity_sessions'
      and cmd = 'SELECT'
  $$,
  array[1::bigint],
  'activity sessions have one canonical SELECT policy'
);

select ok(
  (
    select qual ilike '%user_id%auth.uid%'
      and qual ilike '%is_org_member%'
      and qual not ilike '%has_permission%'
      and qual not ilike '%has_org_role%'
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_activity_sessions'
      and policyname = 'users read own activity sessions'
  ),
  'raw activity SELECT is own-session plus active membership only'
);

select ok(
  to_regprocedure(
    'private.prune_user_activity_sessions(uuid,interval,integer,timestamp with time zone)'
  ) is not null,
  'bounded activity retention function exists'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.prune_user_activity_sessions(uuid,interval,integer,timestamp with time zone)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'private.prune_user_activity_sessions(uuid,interval,integer,timestamp with time zone)',
    'execute'
  ),
  'only the backend service role may invoke activity retention'
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
  '00000000-0000-0000-0000-000000000000'::uuid,
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
    ('e9200000-0000-4000-8000-000000000001'::uuid, 'presence-permitted@example.test'),
    ('e9200000-0000-4000-8000-000000000002'::uuid, 'presence-admin@example.test'),
    ('e9200000-0000-4000-8000-000000000003'::uuid, 'presence-other-org@example.test'),
    ('e9200000-0000-4000-8000-000000000004'::uuid, 'presence-retention@example.test')
) as fixture(id, email);

insert into public.organizations (id, name, slug, is_active)
values
  (
    'e9100000-0000-4000-8000-000000000001',
    'Presence Security Org A',
    'presence-security-org-a',
    true
  ),
  (
    'e9100000-0000-4000-8000-000000000002',
    'Presence Security Org B',
    'presence-security-org-b',
    true
  );

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'e9200000-0000-4000-8000-000000000001',
    'e9100000-0000-4000-8000-000000000001',
    'Presence Permitted',
    'presence-permitted@example.test',
    'user',
    true
  ),
  (
    'e9200000-0000-4000-8000-000000000002',
    'e9100000-0000-4000-8000-000000000001',
    'Presence Admin',
    'presence-admin@example.test',
    'admin',
    true
  ),
  (
    'e9200000-0000-4000-8000-000000000003',
    'e9100000-0000-4000-8000-000000000002',
    'Presence Other Org',
    'presence-other-org@example.test',
    'user',
    true
  ),
  (
    'e9200000-0000-4000-8000-000000000004',
    'e9100000-0000-4000-8000-000000000001',
    'Presence Retention',
    'presence-retention@example.test',
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
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000001',
    'user',
    true,
    null
  ),
  (
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000002',
    'admin',
    true,
    null
  ),
  (
    'e9100000-0000-4000-8000-000000000002',
    'e9200000-0000-4000-8000-000000000003',
    'user',
    true,
    null
  ),
  (
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000004',
    'user',
    true,
    null
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active,
    deleted_at = excluded.deleted_at;

insert into public.organization_roles (id, organization_id, name, is_active)
values (
  'e9300000-0000-4000-8000-000000000001',
  'e9100000-0000-4000-8000-000000000001',
  'Presence Viewer',
  true
);

insert into public.organization_role_permissions (
  id,
  organization_role_id,
  permission_key,
  organization_id,
  role_id,
  permission_id
)
select
  'e9400000-0000-4000-8000-000000000001',
  'e9300000-0000-4000-8000-000000000001',
  permission.key,
  'e9100000-0000-4000-8000-000000000001',
  'e9300000-0000-4000-8000-000000000001',
  permission.id
from public.available_permissions as permission
where permission.key = 'users_presence_view';

insert into public.user_organization_roles (
  id,
  user_id,
  organization_role_id,
  organization_id,
  role_id,
  is_active
)
values (
  'e9500000-0000-4000-8000-000000000001',
  'e9200000-0000-4000-8000-000000000001',
  'e9300000-0000-4000-8000-000000000001',
  'e9100000-0000-4000-8000-000000000001',
  'e9300000-0000-4000-8000-000000000001',
  true
);

insert into public.user_activity_sessions (
  id,
  organization_id,
  user_id,
  session_id,
  status,
  current_path,
  current_page_title,
  connected_at,
  last_seen_at,
  disconnected_at,
  user_agent,
  metadata
)
values
  (
    'e9600000-0000-4000-8000-000000000001',
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000001',
    'presence-own-0001',
    'online',
    '/own',
    'Own',
    '2026-01-01 11:55:00+00',
    '2026-01-01 11:59:00+00',
    null,
    'test-agent',
    '{"scope":"own"}'::jsonb
  ),
  (
    'e9600000-0000-4000-8000-000000000002',
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000002',
    'presence-admin-0001',
    'online',
    '/admin',
    'Admin',
    '2026-01-01 11:55:00+00',
    '2026-01-01 11:58:00+00',
    null,
    'test-agent',
    '{"scope":"peer"}'::jsonb
  ),
  (
    'e9600000-0000-4000-8000-000000000003',
    'e9100000-0000-4000-8000-000000000002',
    'e9200000-0000-4000-8000-000000000003',
    'presence-other-0001',
    'online',
    '/other',
    'Other',
    '2026-01-01 11:55:00+00',
    '2026-01-01 11:57:00+00',
    null,
    'test-agent',
    '{"scope":"other"}'::jsonb
  ),
  (
    'e9600000-0000-4000-8000-000000000004',
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000004',
    'presence-old-0001',
    'offline',
    '/oldest',
    'Oldest',
    '2025-09-01 00:00:00+00',
    '2025-10-01 00:00:00+00',
    '2025-10-01 00:00:00+00',
    'old-agent',
    '{"age":"oldest"}'::jsonb
  ),
  (
    'e9600000-0000-4000-8000-000000000005',
    'e9100000-0000-4000-8000-000000000001',
    'e9200000-0000-4000-8000-000000000004',
    'presence-old-0002',
    'online',
    '/latest-stale',
    'Latest stale',
    '2025-10-02 00:00:00+00',
    '2025-11-01 00:00:00+00',
    null,
    'latest-old-agent',
    '{"age":"latest"}'::jsonb
  );

set local role service_role;

select is(
  private.prune_user_activity_sessions(
    'e9100000-0000-4000-8000-000000000001',
    interval '30 days',
    100,
    '2026-01-01 12:00:00+00'
  ),
  1,
  'retention deletes only the stale superseded fixture row'
);

reset role;

select results_eq(
  $$
    select count(*)::bigint
    from public.user_activity_sessions
    where user_id = 'e9200000-0000-4000-8000-000000000004'
      and id = 'e9600000-0000-4000-8000-000000000005'
      and status = 'offline'
      and disconnected_at = last_seen_at
      and current_path is null
      and current_page_title is null
      and user_agent is null
      and metadata = '{}'::jsonb
  $$,
  array[1::bigint],
  'retention preserves last access while sanitizing the newest stale row'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'e9200000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select ok(
  private.has_permission(
    'e9100000-0000-4000-8000-000000000001',
    'users_presence_view'
  ),
  'custom organization role receives the BFF presence permission'
);

select results_eq(
  $$select count(*)::bigint from public.user_activity_sessions$$,
  array[1::bigint],
  'permission holder reads only their own raw activity row'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.user_activity_sessions
    where user_id = 'e9200000-0000-4000-8000-000000000002'
  $$,
  array[0::bigint],
  'BFF presence permission does not expose a peer raw telemetry row'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.user_activity_sessions
    where organization_id = 'e9100000-0000-4000-8000-000000000002'
  $$,
  array[0::bigint],
  'activity SELECT remains isolated across tenants'
);

select lives_ok(
  $$
    insert into public.user_activity_sessions (
      organization_id,
      user_id,
      session_id
    ) values (
      'e9100000-0000-4000-8000-000000000001',
      'e9200000-0000-4000-8000-000000000001',
      'presence-own-0002'
    )
  $$,
  'active member can insert their own activity session'
);

select results_eq(
  $$
    with inserted as (
      insert into public.user_activity_sessions (
        id,
        organization_id,
        user_id,
        session_id,
        status,
        connected_at,
        last_seen_at,
        disconnected_at
      ) values (
        'e9600000-0000-4000-8000-000000000006',
        'e9100000-0000-4000-8000-000000000001',
        'e9200000-0000-4000-8000-000000000001',
        'presence-own-forged-times',
        'online',
        '2100-01-01 00:00:00+00',
        '2100-01-01 00:00:00+00',
        '2100-01-01 00:00:00+00'
      )
      returning connected_at, last_seen_at, disconnected_at
    )
    select count(*)::bigint
    from inserted
    where connected_at >= pg_catalog.clock_timestamp() - interval '1 minute'
      and connected_at <= pg_catalog.clock_timestamp() + interval '1 minute'
      and last_seen_at >= pg_catalog.clock_timestamp() - interval '1 minute'
      and last_seen_at <= pg_catalog.clock_timestamp() + interval '1 minute'
      and last_seen_at = connected_at
      and disconnected_at is null
  $$,
  array[1::bigint],
  'authenticated insert replaces every forged lifecycle timestamp with the database clock'
);

select results_eq(
  $$
    with previous as (
      select connected_at
      from public.user_activity_sessions
      where id = 'e9600000-0000-4000-8000-000000000006'
    ),
    changed as (
      update public.user_activity_sessions
      set status = 'offline',
          connected_at = '2100-01-01 00:00:00+00',
          last_seen_at = '2100-01-01 00:00:00+00',
          disconnected_at = '2100-01-01 00:00:00+00'
      where id = 'e9600000-0000-4000-8000-000000000006'
      returning connected_at, last_seen_at, disconnected_at
    )
    select count(*)::bigint
    from changed cross join previous
    where changed.connected_at = previous.connected_at
      and changed.last_seen_at >= pg_catalog.clock_timestamp() - interval '1 minute'
      and changed.last_seen_at <= pg_catalog.clock_timestamp() + interval '1 minute'
      and changed.disconnected_at = changed.last_seen_at
  $$,
  array[1::bigint],
  'authenticated update preserves connection start and replaces forged activity timestamps'
);

select throws_ok(
  $$
    insert into public.user_activity_sessions (
      organization_id,
      user_id,
      session_id
    ) values (
      'e9100000-0000-4000-8000-000000000001',
      'e9200000-0000-4000-8000-000000000002',
      'presence-forged-0001'
    )
  $$,
  '42501',
  null,
  'authenticated member cannot forge another user activity session'
);

select results_eq(
  $$
    update public.user_activity_sessions
    set status = 'idle'
    where id = 'e9600000-0000-4000-8000-000000000001'
    returning status
  $$,
  array['idle'::text],
  'active member can update their own activity session'
);

select results_eq(
  $$
    select count(*)::bigint
    from public.user_activity_sessions
    where id = 'e9600000-0000-4000-8000-000000000001'
      and status = 'idle'
      and idle_since_at is not null
  $$,
  array[1::bigint],
  'entering idle records the start of the absence'
);

select results_eq(
  $$
    with previous as (
      select idle_since_at
      from public.user_activity_sessions
      where id = 'e9600000-0000-4000-8000-000000000001'
    ),
    changed as (
      update public.user_activity_sessions
      set status = 'idle',
          idle_since_at = '2000-01-01 00:00:00+00'
      where id = 'e9600000-0000-4000-8000-000000000001'
      returning idle_since_at
    )
    select changed.idle_since_at = previous.idle_since_at
    from changed cross join previous
  $$,
  array[true],
  'idle heartbeat preserves the original timestamp and rejects client forgery'
);

select results_eq(
  $$
    with changed as (
      update public.user_activity_sessions
      set status = 'online',
          idle_since_at = '2000-01-01 00:00:00+00'
      where id = 'e9600000-0000-4000-8000-000000000001'
      returning idle_since_at
    )
    select count(*)::bigint
    from changed
    where idle_since_at is null
  $$,
  array[1::bigint],
  'returning online clears the idle timestamp'
);

select results_eq(
  $$
    with changed as (
      update public.user_activity_sessions
      set status = 'offline'
      where id = 'e9600000-0000-4000-8000-000000000002'
      returning 1
    )
    select count(*)::bigint from changed
  $$,
  array[0::bigint],
  'permission holder cannot update a peer activity session'
);

select set_config(
  'request.jwt.claim.sub',
  'e9200000-0000-4000-8000-000000000002',
  true
);

select results_eq(
  $$select count(*)::bigint from public.user_activity_sessions$$,
  array[1::bigint],
  'organization admin also reads only their own raw activity row'
);

reset role;

update public.organization_members
set is_active = false,
    deleted_at = null,
    updated_at = now()
where organization_id = 'e9100000-0000-4000-8000-000000000001'
  and user_id = 'e9200000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'e9200000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$select count(*)::bigint from public.user_activity_sessions$$,
  array[0::bigint],
  'inactive member cannot read even their own activity session'
);

select throws_ok(
  $$
    insert into public.user_activity_sessions (
      organization_id,
      user_id,
      session_id
    ) values (
      'e9100000-0000-4000-8000-000000000001',
      'e9200000-0000-4000-8000-000000000001',
      'presence-inactive-0001'
    )
  $$,
  '42501',
  null,
  'inactive member cannot insert an activity session'
);

select results_eq(
  $$
    with changed as (
      update public.user_activity_sessions
      set status = 'online'
      where id = 'e9600000-0000-4000-8000-000000000001'
      returning 1
    )
    select count(*)::bigint from changed
  $$,
  array[0::bigint],
  'inactive member cannot update an activity session'
);

reset role;

select * from finish();
rollback;
