begin;

create extension if not exists pgtap with schema extensions;
select plan(83);

select is(
  (
    select count(*)
    from unnest(array[
      'property_offers',
      'property_ownerships',
      'property_assets',
      'property_keys',
      'property_key_movements'
    ]) as expected(table_name)
    where to_regclass(format('public.%I', expected.table_name)) is not null
  ),
  5::bigint,
  'all normalized real-estate tables exist'
);

select is(
  (
    select count(*)
    from pg_class as relation
    join pg_namespace as namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = any(array[
        'property_offers',
        'property_ownerships',
        'property_assets',
        'property_keys',
        'property_key_movements'
      ])
      and relation.relrowsecurity
  ),
  5::bigint,
  'RLS is enabled on every normalized real-estate table'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'property_offers',
        'property_ownerships',
        'property_assets',
        'property_keys',
        'property_key_movements'
      ])
  ),
  18::bigint,
  'defense-in-depth RLS policies cover reads and permitted mutations'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'property_offers',
        'property_ownerships',
        'property_assets',
        'property_keys',
        'property_key_movements'
      ])
      and cmd = 'SELECT'
      and qual like '%can_view_real_estate_record%'
      and 'authenticated' = any(roles)
  ),
  5::bigint,
  'all read policies delegate to property own/team/all visibility'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'property_offers',
        'property_ownerships',
        'property_assets',
        'property_keys',
        'property_key_movements'
      ])
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
      and coalesce(with_check, qual, '') like '%property_manage%'
      and 'authenticated' = any(roles)
  ),
  13::bigint,
  'every normalized mutation policy requires property_manage'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'anon',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'property_offers',
      'property_ownerships',
      'property_assets',
      'property_keys',
      'property_key_movements'
    ]) as target(table_name)
    cross join unnest(array[
      'select', 'insert', 'update', 'delete',
      'truncate', 'references', 'trigger'
    ]) as privilege(name)
  ),
  'anonymous clients have no normalized real-estate table privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'authenticated',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'property_offers',
      'property_ownerships',
      'property_assets',
      'property_keys',
      'property_key_movements'
    ]) as target(table_name)
    cross join unnest(array[
      'select', 'insert', 'update', 'delete',
      'truncate', 'references', 'trigger'
    ]) as privilege(name)
  ),
  'authenticated clients cannot bypass the property BFF'
);

select ok(
  (
    select bool_and(
      has_table_privilege(
        'service_role',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'property_offers',
      'property_ownerships',
      'property_assets',
      'property_keys'
    ]) as target(table_name)
    cross join unnest(array['select', 'insert', 'update', 'delete'])
      as privilege(name)
  ),
  'the backend can manage normalized property records'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.property_key_movements',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.property_key_movements',
    'insert'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_key_movements',
    'update'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_key_movements',
    'delete'
  ),
  'key movements are append-only even for the backend role'
);

select is(
  (
    select count(*)
    from pg_trigger
    where tgrelid = any(array[
      'public.property_offers'::regclass,
      'public.property_ownerships'::regclass,
      'public.property_assets'::regclass,
      'public.property_keys'::regclass
    ])
      and tgname like '%set_updated_at'
      and not tgisinternal
  ),
  4::bigint,
  'mutable normalized tables maintain updated_at'
);

select is(
  (
    select count(*)
    from pg_trigger
    where tgrelid = any(array[
      'public.property_offers'::regclass,
      'public.property_ownerships'::regclass,
      'public.property_assets'::regclass,
      'public.property_keys'::regclass,
      'public.property_key_movements'::regclass
    ])
      and tgname like '%tenant_scope'
      and not tgisinternal
  ),
  5::bigint,
  'every normalized table validates tenant-scoped references'
);

select ok(
  (
    select bool_and(
      not has_function_privilege('anon', function_name, 'execute')
      and not has_function_privilege(
        'authenticated', function_name, 'execute'
      )
      and not has_function_privilege(
        'service_role', function_name, 'execute'
      )
    )
    from unnest(array[
      'private.enforce_real_estate_tenant_scope()',
      'private.validate_property_ownership_allocation()',
      'private.apply_property_key_movement()',
      'private.backfill_real_estate_foundation()'
    ]) as helper(function_name)
  ),
  'internal real-estate helpers are not directly callable by API roles'
);

select ok(
  exists (
    select 1
    from pg_proc as procedure
    join pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_view_real_estate_record'
      and procedure.prosecdef
      and procedure.prosrc like '%private.can_view_property_record%'
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
        where setting = 'search_path=""'
      )
  ),
  'normalized visibility safely delegates to canonical property scope'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.can_view_real_estate_record(uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'authenticated',
    'private.can_view_real_estate_record(uuid,uuid,uuid)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'private.can_view_real_estate_record(uuid,uuid,uuid)',
    'execute'
  ),
  'only authenticated backend identities can evaluate normalized visibility'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.property_offers'::regclass
      and conname = 'property_offers_property_type_unique'
      and contype = 'u'
  ),
  'one independent offer exists per property and modality'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.property_ownerships'::regclass
      and tgname = 'property_ownerships_validate_allocation'
      and tgconstraint <> 0
      and not tgisinternal
  ),
  'ownership totals and principal periods have a constraint trigger'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.property_key_movements'::regclass
      and tgname = 'property_key_movements_apply_state'
      and not tgisinternal
  ),
  'key movement events maintain current custody state'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'property_assets'
      and indexname = any(array[
        'property_assets_external_locator_uidx',
        'property_assets_storage_locator_uidx',
        'property_assets_primary_photo_uidx'
      ])
  ),
  3::bigint,
  'asset locators and primary photos are deduplicated'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'property_key_movements'
      and cmd in ('UPDATE', 'DELETE')
  ),
  0::bigint,
  'RLS exposes no mutation path for historical key movements'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = any(array[
      'public.property_offers'::regclass,
      'public.property_ownerships'::regclass,
      'public.property_assets'::regclass,
      'public.property_keys'::regclass,
      'public.property_key_movements'::regclass
    ])
      and conname = any(array[
        'property_offers_org_property_fkey',
        'property_ownerships_org_property_fkey',
        'property_ownerships_org_owner_fkey',
        'property_assets_org_property_fkey',
        'property_keys_org_property_fkey',
        'property_key_movements_org_key_fkey'
      ])
      and contype = 'f'
      and convalidated
  ),
  6::bigint,
  'normalized references have validated tenant-scoped foreign keys'
);

select is(
  (
    select count(*)
    from pg_indexes
    where schemaname = 'public'
      and indexname = any(array[
        'property_ownerships_workspace_idx',
        'property_assets_workspace_idx',
        'property_keys_workspace_idx',
        'property_key_movements_workspace_timeline_idx',
        'property_keys_checked_out_due_idx'
      ])
  ),
  5::bigint,
  'workspace collections and overdue key state have operational indexes'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.property_offers'::regclass
      and conname = 'property_offers_active_commercial_check'
      and contype = 'c'
      and convalidated
  ),
  'active offers require a usable commercial value and period'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_primary_photo_check'
      and contype = 'c'
      and convalidated
  ),
  'only photos can be the primary property asset'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = any(array[
        'property_ownerships_owner_period_excl',
        'property_ownerships_primary_period_excl'
      ])
      and contype = 'x'
      and not condeferrable
  ),
  2::bigint,
  'ownership overlap is protected by immediate exclusion constraints'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_ownerships'::regclass
      and conname = 'property_ownerships_half_open_validity_check'
      and contype = 'c'
      and convalidated
  ),
  'ownership validity uses a validated half-open interval contract'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.property_owners'::regclass
      and tgname = 'property_owners_set_updated_at'
      and not tgisinternal
  ),
  'owner CRUD maintains updated_at'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_owners'::regclass
      and conname = 'property_owners_name_check'
      and contype = 'c'
      and not convalidated
      and pg_catalog.pg_get_constraintdef(oid) like '%160%'
  ),
  'owner names enforce 1-to-160 on new writes without rewriting legacy rows'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger
    where tgrelid = 'public.property_assets'::regclass
      and tgname = 'property_assets_enforce_storage_path'
      and not tgisinternal
  )
  and not has_function_privilege(
    'authenticated',
    'private.enforce_property_asset_storage_path()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.enforce_property_asset_storage_path()',
    'execute'
  ),
  'asset path validation is trigger-only'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        coalesce(qual, '') ilike '%property-private%'
        or coalesce(with_check, '') ilike '%property-private%'
      )
  ),
  0::bigint,
  'private property Storage has no direct browser policy'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'can_view_property_owner_record'
      and procedure.prosrc like '%property_ownerships%'
      and procedure.prosrc like '%current_date < ownership.valid_to%'
  ),
  'owner visibility includes currently active normalized co-ownership'
);

select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'property_assets'
      and policyname = 'property viewers read assets'
      and cmd = 'SELECT'
      and qual like '%visibility%'
      and qual like '%confidential%'
      and qual like '%property_manage%'
  ),
  'confidential assets require property_manage in defense-in-depth RLS'
);

select is(
  (
    select count(*)
    from pg_trigger
    where tgname = any(array[
      'properties_sync_legacy_offers',
      'property_offers_project_legacy_prices'
    ])
      and tgrelid = any(array[
        'public.properties'::regclass,
        'public.property_offers'::regclass
      ])
      and not tgisinternal
  ),
  2::bigint,
  'offer compatibility is maintained in both write directions'
);

select ok(
  (
    select bool_and(
      not has_function_privilege('anon', helper.function_name, 'execute')
      and not has_function_privilege(
        'authenticated', helper.function_name, 'execute'
      )
      and not has_function_privilege(
        'service_role', helper.function_name, 'execute'
      )
    )
    from unnest(array[
      'private.sync_property_legacy_offers(public.properties)',
      'private.sync_property_legacy_offers_trigger()',
      'private.project_property_offer_prices(uuid,uuid)',
      'private.project_property_offer_prices_trigger()',
      'private.normalize_legacy_property_offer_before_write()'
    ]) as helper(function_name)
  ),
  'offer compatibility helpers are trigger-only and not API-callable'
);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, confirmation_token, email_change,
  email_change_token_new, recovery_token
)
values
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-4000-8000-000000000001',
    'authenticated', 'authenticated', 'real-estate@example.test',
    crypt('test-password', gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-4000-8000-000000000002',
    'authenticated', 'authenticated', 'audit-org-b@example.test',
    crypt('test-password', gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), '', '', '', ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'f1000000-0000-4000-8000-000000000003',
    'authenticated', 'authenticated', 'viewer-org-a@example.test',
    crypt('test-password', gen_salt('bf', 4)), now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{}'::jsonb, now(), now(), '', '', '', ''
  );

insert into public.organizations (id, name, slug, is_active)
values
  (
    'f2000000-0000-4000-8000-000000000001',
    'Real Estate Test A',
    'real-estate-test-a',
    true
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'Real Estate Test B',
    'real-estate-test-b',
    true
  );

insert into public.users (
  id, organization_id, name, email, role, is_active
)
values
  (
    'f1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001',
    'Real Estate Admin',
    'real-estate@example.test',
    'admin',
    true
  ),
  (
    'f1000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000002',
    'Audit User Org B',
    'audit-org-b@example.test',
    'user',
    true
  ),
  (
    'f1000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000001',
    'Property Viewer Org A',
    'viewer-org-a@example.test',
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
  organization_id, user_id, role, is_active
)
values
  (
    'f2000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    'f2000000-0000-4000-8000-000000000002',
    'f1000000-0000-4000-8000-000000000002',
    'user',
    true
  ),
  (
    'f2000000-0000-4000-8000-000000000001',
    'f1000000-0000-4000-8000-000000000003',
    'user',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

insert into public.organization_roles (
  id, organization_id, name, description, is_active
)
values (
  'f6000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'Property viewer test',
  'Own/team scoped property viewer',
  true
)
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    description = excluded.description,
    is_active = excluded.is_active;

insert into public.organization_role_permissions (
  id,
  organization_role_id,
  permission_key,
  organization_id,
  role_id,
  permission_id
)
select
  'f7000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  permission.key,
  'f2000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  permission.id
from public.available_permissions as permission
where permission.key = 'property_view'
on conflict (id) do update
set organization_role_id = excluded.organization_role_id,
    permission_key = excluded.permission_key,
    organization_id = excluded.organization_id,
    role_id = excluded.role_id,
    permission_id = excluded.permission_id;

insert into public.user_organization_roles (
  id,
  user_id,
  organization_role_id,
  organization_id,
  role_id,
  is_active
)
values (
  'f8000000-0000-4000-8000-000000000001',
  'f1000000-0000-4000-8000-000000000003',
  'f6000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f6000000-0000-4000-8000-000000000001',
  true
)
on conflict (user_id) do update
set organization_role_id = excluded.organization_role_id,
    organization_id = excluded.organization_id,
    role_id = excluded.role_id,
    is_active = excluded.is_active;

insert into public.property_owners (id, organization_id, name)
values
  (
    'f3000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001',
    'Owner A1'
  ),
  (
    'f3000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000001',
    'Owner A2'
  ),
  (
    'f3000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000001',
    'Owner A3'
  ),
  (
    'f3000000-0000-4000-8000-000000000004',
    'f2000000-0000-4000-8000-000000000002',
    'Owner B'
  );

select throws_ok(
  $$
    insert into public.property_owners (organization_id, name)
    values (
      'f2000000-0000-4000-8000-000000000001',
      '   '
    )
  $$,
  '23514',
  null,
  'owner names cannot be blank'
);

select throws_ok(
  $$
    insert into public.property_owners (organization_id, name)
    values (
      'f2000000-0000-4000-8000-000000000001',
      repeat('x', 161)
    )
  $$,
  '23514',
  null,
  'new owner names cannot exceed the 160-character API contract'
);

insert into public.properties (id, organization_id, code, status)
values
  (
    'f4000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000001',
    'RE-OFFERS',
    'ativo'
  ),
  (
    'f4000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000001',
    'RE-OWNERSHIP',
    'ativo'
  ),
  (
    'f4000000-0000-4000-8000-000000000003',
    'f2000000-0000-4000-8000-000000000001',
    'RE-KEY',
    'ativo'
  ),
  (
    'f4000000-0000-4000-8000-000000000004',
    'f2000000-0000-4000-8000-000000000002',
    'RE-ORG-B',
    'ativo'
  );

insert into public.properties (
  id, organization_id, code, status, created_by
)
values
  (
    'f4000000-0000-4000-8000-000000000006',
    'f2000000-0000-4000-8000-000000000001',
    'RE-VIEWER-OWN',
    'ativo',
    'f1000000-0000-4000-8000-000000000003'
  ),
  (
    'f4000000-0000-4000-8000-000000000007',
    'f2000000-0000-4000-8000-000000000001',
    'RE-VIEWER-OTHER',
    'ativo',
    'f1000000-0000-4000-8000-000000000001'
  );

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000003',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select results_eq(
  $$
    select private.can_view_real_estate_record(
      'f2000000-0000-4000-8000-000000000001',
      property_id,
      null
    )
    from unnest(array[
      'f4000000-0000-4000-8000-000000000006'::uuid,
      'f4000000-0000-4000-8000-000000000007'::uuid
    ]) as scoped(property_id)
    order by property_id
  $$,
  array[true, false],
  'property_view sees an own record but not an unrelated organization record'
);

select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);

select ok(
  private.can_view_real_estate_record(
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000007',
    null
  ),
  'property_manage retains organization-wide record visibility'
);

reset role;

insert into public.property_offers (
  organization_id, property_id, offer_type, status, price, price_period
)
values
  (
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001',
    'sale', 'active', 900000, 'total'
  ),
  (
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001',
    'rent', 'active', 4500, 'monthly'
  ),
  (
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000001',
    'seasonal', 'active', 650, 'daily'
  );

select is(
  (
    select count(*)
    from public.property_offers
    where property_id = 'f4000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'sale, rent and seasonal offers coexist independently'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000001',
      'sale'
    )
  $$,
  '23505',
  null,
  'a property cannot have duplicate offers of one modality'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type, price
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'sale', -1
    )
  $$,
  '23514',
  null,
  'offer prices cannot be negative'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type, status, price, price_period
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'sale', 'active', null, 'total'
    )
  $$,
  '23514',
  null,
  'active offers reject a missing commercial price'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type, status, price, price_period
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'sale', 'active', 500000, null
    )
  $$,
  '23514',
  null,
  'active offers reject a missing price period'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type
    ) values (
      'f2000000-0000-4000-8000-000000000002',
      'f4000000-0000-4000-8000-000000000003',
      'rent'
    )
  $$,
  '23514',
  null,
  'offers reject cross-tenant properties'
);

alter table public.property_offers
  disable trigger property_offers_tenant_scope;

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000004',
      'seasonal'
    )
  $$,
  '23503',
  null,
  'tenant-scoped foreign keys remain authoritative without the guard trigger'
);

alter table public.property_offers
  enable trigger property_offers_tenant_scope;

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type, created_by
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'sale',
      'f1000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'real_estate_user_cross_tenant_reference:created_by',
  'created_by rejects an audit user from another tenant'
);

select throws_ok(
  $$
    insert into public.property_offers (
      organization_id, property_id, offer_type, updated_by
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'rent',
      'f1000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'real_estate_user_cross_tenant_reference:updated_by',
  'updated_by rejects an audit user from another tenant'
);

select throws_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000004'
    )
  $$,
  '23514',
  null,
  'ownerships reject cross-tenant owners'
);

select throws_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000001',
      101
    )
  $$,
  '23514',
  null,
  'an individual ownership share cannot exceed 100 percent'
);

insert into public.property_ownerships (
  organization_id, property_id, owner_id, ownership_percentage,
  is_primary, valid_from, valid_to
)
values
  (
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000001',
    60, true, '2026-01-01', null
  ),
  (
    'f2000000-0000-4000-8000-000000000001',
    'f4000000-0000-4000-8000-000000000002',
    'f3000000-0000-4000-8000-000000000002',
    40, false, '2026-01-01', '2030-12-31'
  );

select throws_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      valid_from, valid_to
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000002',
      'f3000000-0000-4000-8000-000000000003',
      1, '2026-01-01', '2030-12-31'
    )
  $$,
  '23514',
  'property_ownership_allocation_exceeds_100',
  'overlapping ownership allocations cannot exceed 100 percent'
);

select throws_ok(
  $$
    update public.property_ownerships
    set is_primary = true
    where property_id = 'f4000000-0000-4000-8000-000000000002'
      and owner_id = 'f3000000-0000-4000-8000-000000000002'
  $$,
  '23P01',
  null,
  'principal ownership periods cannot overlap atomically'
);

select throws_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      valid_from, valid_to
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000002',
      'f3000000-0000-4000-8000-000000000001',
      1, '2031-01-01', '2031-12-31'
    )
  $$,
  '23P01',
  null,
  'one owner cannot have duplicate overlapping allocations atomically'
);

select throws_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      valid_from, valid_to
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000001',
      100, '2026-06-01', '2026-06-01'
    )
  $$,
  '23514',
  null,
  'half-open ownership periods reject an empty interval'
);

select lives_ok(
  $$
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      is_primary, valid_from, valid_to
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000001',
      100, true, '2026-06-01', '2026-08-01'
    );
    insert into public.property_ownerships (
      organization_id, property_id, owner_id, ownership_percentage,
      is_primary, valid_from
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'f3000000-0000-4000-8000-000000000002',
      100, true, '2026-08-01'
    )
  $$,
  'a principal owner can be replaced on the same half-open boundary date'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'document'
    )
  $$,
  '23514',
  null,
  'an asset requires exactly one storage path or external URL'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, external_url
    ) values (
      'f2000000-0000-4000-8000-000000000002',
      'f4000000-0000-4000-8000-000000000003',
      'photo', 'https://cdn.test/cross-tenant.jpg'
    )
  $$,
  '23514',
  null,
  'assets reject cross-tenant properties'
);

insert into public.property_assets (
  organization_id, property_id, asset_type, external_url
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000003',
  'photo', 'https://cdn.test/unique.jpg'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, external_url, is_primary
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'video', 'https://cdn.test/primary-video.mp4', true
    )
  $$,
  '23514',
  null,
  'non-photo assets cannot become the primary cover'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, external_url
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'photo', 'https://cdn.test/unique.jpg'
    )
  $$,
  '23505',
  null,
  'duplicate property asset locators are rejected'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, storage_path
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'document',
      'orgs/f2000000-0000-4000-8000-000000000001/other/file.pdf'
    )
  $$,
  '23514',
  'property_asset_storage_path_invalid',
  'private asset paths cannot escape the organization/property/asset prefix'
);

select lives_ok(
  $$
    insert into public.property_assets (
      id, organization_id, property_id, asset_type, storage_path, is_primary
    ) values (
      'f9000000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'photo',
      'orgs/f2000000-0000-4000-8000-000000000001/properties/f4000000-0000-4000-8000-000000000003/f9000000-0000-4000-8000-000000000001/cover.jpg',
      true
    )
  $$,
  'a private asset accepts its canonical organization/property/asset path'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, external_url, is_primary
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'photo', 'https://cdn.test/second-cover.jpg', true
    )
  $$,
  '23505',
  null,
  'only one primary photo can exist per property'
);

select throws_ok(
  $$
    insert into public.property_keys (
      organization_id, property_id, label
    ) values (
      'f2000000-0000-4000-8000-000000000002',
      'f4000000-0000-4000-8000-000000000003',
      'Cross tenant key'
    )
  $$,
  '23514',
  null,
  'keys reject cross-tenant properties'
);

insert into public.property_keys (
  id, organization_id, property_id, label, current_location
)
values (
  'f5000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000003',
  'Main key',
  'Office'
);

select throws_ok(
  $$
    insert into public.property_key_movements (
      organization_id, property_key_id, movement_type, holder_name
    ) values (
      'f2000000-0000-4000-8000-000000000002',
      'f5000000-0000-4000-8000-000000000001',
      'checkout', 'Cross Tenant'
    )
  $$,
  '23514',
  null,
  'key movements reject cross-tenant keys'
);

select throws_ok(
  $$
    insert into public.property_key_movements (
      organization_id, property_key_id, movement_type, holder_user_id
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'checkout',
      'f1000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'real_estate_user_cross_tenant_reference:holder_user_id',
  'key custody rejects a holder user from another tenant'
);

insert into public.property_key_movements (
  organization_id, property_key_id, movement_type, holder_user_id,
  occurred_at, expected_return_at, idempotency_key
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'checkout',
  'f1000000-0000-4000-8000-000000000001',
  '2026-07-31 10:00:00+00',
  '2026-07-31 18:00:00+00',
  'checkout-1'
);

select is(
  (
    select status || ':' || holder_user_id::text
    from public.property_keys
    where id = 'f5000000-0000-4000-8000-000000000001'
  ),
  'checked_out:f1000000-0000-4000-8000-000000000001',
  'checkout events atomically update current custody'
);

select throws_ok(
  $$
    insert into public.property_key_movements (
      organization_id, property_key_id, movement_type, holder_name
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'checkout', 'Second holder'
    )
  $$,
  '23514',
  'property_key_not_available',
  'an already checked-out key cannot be checked out again'
);

insert into public.property_key_movements (
  organization_id, property_key_id, movement_type, to_location
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001',
  'return',
  'Reception'
);

select is(
  (
    select status || ':' || current_location || ':'
      || coalesce(holder_user_id::text, 'none')
    from public.property_keys
    where id = 'f5000000-0000-4000-8000-000000000001'
  ),
  'available:Reception:none',
  'return events clear custody and restore availability'
);

select throws_ok(
  $$
    insert into public.property_key_movements (
      organization_id, property_key_id, movement_type, to_location
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f5000000-0000-4000-8000-000000000001',
      'registration',
      'Fake reset location'
    )
  $$,
  '23514',
  'property_key_registration_not_initial',
  'registration cannot reset a key after custody movements exist'
);

insert into public.properties (
  id, organization_id, code, status, finalidade, preco, valor_locacao
)
values (
  'f4000000-0000-4000-8000-000000000008',
  'f2000000-0000-4000-8000-000000000001',
  'RE-COMPATIBILITY',
  'ativo',
  'venda e locacao',
  500000,
  3000
);

select results_eq(
  $$
    select offer_type, price, status
    from public.property_offers
    where property_id = 'f4000000-0000-4000-8000-000000000008'
    order by offer_type
  $$,
  $$
    values
      ('rent'::text, 3000::numeric, 'active'::text),
      ('sale'::text, 500000::numeric, 'active'::text)
  $$,
  'new legacy properties immediately create normalized commercial offers'
);

update public.properties
set preco = 550000
where id = 'f4000000-0000-4000-8000-000000000008';

select is(
  (
    select price
    from public.property_offers
    where property_id = 'f4000000-0000-4000-8000-000000000008'
      and offer_type = 'sale'
  ),
  550000::numeric,
  'legacy price edits update the normalized offer in the same transaction'
);

update public.property_offers
set status = 'paused'
where property_id = 'f4000000-0000-4000-8000-000000000008'
  and offer_type = 'sale';

select ok(
  (
    select offer.status = 'paused'
      and offer.price = 550000
      and property.preco is null
    from public.property_offers as offer
    join public.properties as property on property.id = offer.property_id
    where offer.property_id = 'f4000000-0000-4000-8000-000000000008'
      and offer.offer_type = 'sale'
  ),
  'pausing a normalized offer preserves its price and clears the legacy projection'
);

update public.property_offers
set status = 'active'
where property_id = 'f4000000-0000-4000-8000-000000000008'
  and offer_type = 'sale';

select is(
  (
    select preco
    from public.properties
    where id = 'f4000000-0000-4000-8000-000000000008'
  ),
  550000::numeric,
  'reactivating a normalized sale restores the legacy sale projection'
);

insert into public.property_offers (
  organization_id, property_id, offer_type, status, price, price_period
)
values (
  'f2000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000008',
  'seasonal', 'active', 400, 'daily'
);

select is(
  (
    select valor_locacao
    from public.properties
    where id = 'f4000000-0000-4000-8000-000000000008'
  ),
  3000::numeric,
  'active long-term rent takes precedence over seasonal legacy projection'
);

update public.property_offers
set status = 'paused'
where property_id = 'f4000000-0000-4000-8000-000000000008'
  and offer_type = 'rent';

select is(
  (
    select valor_locacao
    from public.properties
    where id = 'f4000000-0000-4000-8000-000000000008'
  ),
  400::numeric,
  'seasonal price becomes the legacy projection when rent is not active'
);

update public.properties
set preco = null
where id = 'f4000000-0000-4000-8000-000000000008';

select ok(
  (
    select offer.status = 'paused'
      and offer.price is null
      and property.preco is null
    from public.property_offers as offer
    join public.properties as property on property.id = offer.property_id
    where offer.property_id = 'f4000000-0000-4000-8000-000000000008'
      and offer.offer_type = 'sale'
  ),
  'clearing a legacy sale price pauses and clears its normalized offer'
);

insert into public.properties (
  id, organization_id, code, status, finalidade, tipo_de_negocio,
  preco, valor_locacao, owner_id, imagem_principal, image_urls,
  fotos, video_imovel, tour_virtual, documents, arquivos,
  local_chaves
)
values (
  'f4000000-0000-4000-8000-000000000005',
  'f2000000-0000-4000-8000-000000000001',
  'RE-LEGACY',
  'ativo',
  'venda_locacao',
  'Venda e Locação',
  800000,
  4000,
  'f3000000-0000-4000-8000-000000000001',
  'https://cdn.test/main.jpg',
  array[
    'https://cdn.test/main.jpg',
    'https://cdn.test/gallery.jpg'
  ],
  '["https://cdn.test/gallery.jpg","https://cdn.test/legacy.jpg"]'::jsonb,
  'https://video.test/property',
  'https://tour.test/property',
  '["https://cdn.test/matricula.pdf"]'::jsonb,
  '["https://cdn.test/matricula.pdf"]'::jsonb,
  'Portaria'
);

-- Reproduce a historical row that predates the tenant trigger. The normalized
-- backfill must preserve the property while discarding the invalid audit UUID.
alter table public.properties
  disable trigger zz_tenant_ref_properties_created_by;
update public.properties
set created_by = 'f1000000-0000-4000-8000-000000000002'
where id = 'f4000000-0000-4000-8000-000000000005';
alter table public.properties
  enable trigger zz_tenant_ref_properties_created_by;

select lives_ok(
  $$
    select private.backfill_real_estate_foundation();
    select private.backfill_real_estate_foundation()
  $$,
  'the legacy backfill is safely re-runnable'
);

select is(
  (
    select count(*)
    from public.property_offers
    where property_id = 'f4000000-0000-4000-8000-000000000005'
  ),
  2::bigint,
  'legacy combined modality backfills independent sale and rent offers once'
);

select results_eq(
  $$
    select offer_type, price
    from public.property_offers
    where property_id = 'f4000000-0000-4000-8000-000000000005'
    order by offer_type
  $$,
  $$values ('rent'::text, 4000::numeric), ('sale'::text, 800000::numeric)$$,
  'legacy offer prices retain their correct modality'
);

select results_eq(
  $$
    select ownership_percentage, is_primary
    from public.property_ownerships
    where property_id = 'f4000000-0000-4000-8000-000000000005'
  $$,
  $$values (100::numeric, true)$$,
  'legacy owner_id backfills one principal 100-percent ownership'
);

select is(
  (
    select count(*)
    from public.property_assets
    where property_id = 'f4000000-0000-4000-8000-000000000005'
  ),
  6::bigint,
  'legacy media and documents backfill once without duplicate locators'
);

select is(
  (
    select count(*)
    from public.property_keys
    where property_id = 'f4000000-0000-4000-8000-000000000005'
      and current_location = 'Portaria'
  ),
  1::bigint,
  'legacy key location backfills one available key set'
);

select ok(
  not exists (
    select offer.created_by
    from public.property_offers as offer
    where offer.property_id = 'f4000000-0000-4000-8000-000000000005'
      and offer.created_by is not null
    union all
    select ownership.created_by
    from public.property_ownerships as ownership
    where ownership.property_id = 'f4000000-0000-4000-8000-000000000005'
      and ownership.created_by is not null
    union all
    select asset.created_by
    from public.property_assets as asset
    where asset.property_id = 'f4000000-0000-4000-8000-000000000005'
      and asset.created_by is not null
    union all
    select property_key.created_by
    from public.property_keys as property_key
    where property_key.property_id = 'f4000000-0000-4000-8000-000000000005'
      and property_key.created_by is not null
  ),
  'legacy backfill sanitizes cross-tenant created_by values to null'
);

set local role authenticated;
select set_config(
  'request.jwt.claim.sub',
  'f1000000-0000-4000-8000-000000000001',
  true
);
select set_config('request.jwt.claim.role', 'authenticated', true);

select throws_ok(
  $$select count(*) from public.property_offers$$,
  '42501',
  null,
  'authenticated admins cannot read backend-owned offer rows directly'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, external_url
    ) values (
      'f2000000-0000-4000-8000-000000000001',
      'f4000000-0000-4000-8000-000000000003',
      'photo', 'https://cdn.test/direct-write.jpg'
    )
  $$,
  '42501',
  null,
  'authenticated admins cannot write backend-owned asset rows directly'
);

reset role;

select * from finish();
rollback;
