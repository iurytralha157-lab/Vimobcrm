begin;

create extension if not exists pgtap with schema extensions;

select plan(52);

select has_table(
  'public',
  'property_channel_publications',
  'canonical property channel publications exist'
);
select has_table(
  'public',
  'property_channel_publication_versions',
  'immutable publication versions exist'
);
select has_table(
  'public',
  'property_channel_publication_jobs',
  'durable publication jobs exist'
);

select results_eq(
  $$
    with expected(table_name, column_name) as (
      values
        ('property_channel_publications', 'id'),
        ('property_channel_publications', 'organization_id'),
        ('property_channel_publications', 'property_id'),
        ('property_channel_publications', 'channel'),
        ('property_channel_publications', 'channel_account_key'),
        ('property_channel_publications', 'desired_state'),
        ('property_channel_publications', 'observed_state'),
        ('property_channel_publications', 'readiness_state'),
        ('property_channel_publications', 'current_version'),
        ('property_channel_publications', 'published_version'),
        ('property_channel_publications', 'validation_errors'),
        ('property_channel_publications', 'provider_listing_id'),
        ('property_channel_publications', 'provider_revision'),
        ('property_channel_publications', 'public_url'),
        ('property_channel_publications', 'last_error_code'),
        ('property_channel_publications', 'last_error_message'),
        ('property_channel_publications', 'last_requested_at'),
        ('property_channel_publications', 'last_attempt_at'),
        ('property_channel_publications', 'last_succeeded_at'),
        ('property_channel_publications', 'published_at'),
        ('property_channel_publications', 'unpublished_at'),
        ('property_channel_publications', 'created_by'),
        ('property_channel_publications', 'updated_by'),
        ('property_channel_publications', 'created_at'),
        ('property_channel_publications', 'updated_at'),
        ('property_channel_publication_versions', 'id'),
        ('property_channel_publication_versions', 'publication_id'),
        ('property_channel_publication_versions', 'organization_id'),
        ('property_channel_publication_versions', 'property_id'),
        ('property_channel_publication_versions', 'channel'),
        ('property_channel_publication_versions', 'channel_account_key'),
        ('property_channel_publication_versions', 'version'),
        ('property_channel_publication_versions', 'source_property_updated_at'),
        ('property_channel_publication_versions', 'payload_schema_version'),
        ('property_channel_publication_versions', 'payload'),
        ('property_channel_publication_versions', 'payload_hash'),
        ('property_channel_publication_versions', 'readiness_errors'),
        ('property_channel_publication_versions', 'created_by'),
        ('property_channel_publication_versions', 'created_at'),
        ('property_channel_publication_jobs', 'id'),
        ('property_channel_publication_jobs', 'publication_id'),
        ('property_channel_publication_jobs', 'version_id'),
        ('property_channel_publication_jobs', 'organization_id'),
        ('property_channel_publication_jobs', 'property_id'),
        ('property_channel_publication_jobs', 'channel'),
        ('property_channel_publication_jobs', 'channel_account_key'),
        ('property_channel_publication_jobs', 'action'),
        ('property_channel_publication_jobs', 'status'),
        ('property_channel_publication_jobs', 'idempotency_key'),
        ('property_channel_publication_jobs', 'request_hash'),
        ('property_channel_publication_jobs', 'attempts'),
        ('property_channel_publication_jobs', 'max_attempts'),
        ('property_channel_publication_jobs', 'next_attempt_at'),
        ('property_channel_publication_jobs', 'locked_at'),
        ('property_channel_publication_jobs', 'locked_by'),
        ('property_channel_publication_jobs', 'lease_token'),
        ('property_channel_publication_jobs', 'last_error_code'),
        ('property_channel_publication_jobs', 'last_error_message'),
        ('property_channel_publication_jobs', 'requested_by'),
        ('property_channel_publication_jobs', 'completed_at'),
        ('property_channel_publication_jobs', 'dead_lettered_at'),
        ('property_channel_publication_jobs', 'created_at'),
        ('property_channel_publication_jobs', 'updated_at')
    )
    select count(*)::bigint
    from expected
    join information_schema.columns as column_catalog
      on column_catalog.table_schema = 'public'
     and column_catalog.table_name = expected.table_name
     and column_catalog.column_name = expected.column_name
  $$,
  array[63::bigint],
  'all canonical publication contract columns exist'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_class
    where oid = any(array[
      'public.property_channel_publications'::regclass,
      'public.property_channel_publication_versions'::regclass,
      'public.property_channel_publication_jobs'::regclass
    ])
      and relrowsecurity
      and relforcerowsecurity
  $$,
  array[3::bigint],
  'all publication tables enable and force RLS'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'property_channel_publications',
        'property_channel_publication_versions',
        'property_channel_publication_jobs'
      ])
  $$,
  array[0::bigint],
  'publication tables expose no direct browser policies'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        browser_role.name,
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'property_channel_publications',
      'property_channel_publication_versions',
      'property_channel_publication_jobs'
    ]) as target(table_name)
    cross join unnest(array['anon', 'authenticated'])
      as browser_role(name)
    cross join unnest(array['select', 'insert', 'update', 'delete', 'truncate'])
      as privilege(name)
  ),
  'browser roles have no publication table privileges'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.property_channel_publications',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.property_channel_publications',
    'insert'
  )
  and has_table_privilege(
    'service_role',
    'public.property_channel_publications',
    'update'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publications',
    'delete'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publications',
    'truncate'
  ),
  'service role can manage publication state but cannot erase canonical history'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.property_channel_publication_versions',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.property_channel_publication_versions',
    'insert'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publication_versions',
    'update'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publication_versions',
    'delete'
  ),
  'publication versions are append-only for the service role'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.property_channel_publication_jobs',
    'select'
  )
  and has_table_privilege(
    'service_role',
    'public.property_channel_publication_jobs',
    'insert'
  )
  and has_table_privilege(
    'service_role',
    'public.property_channel_publication_jobs',
    'update'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publication_jobs',
    'delete'
  )
  and not has_table_privilege(
    'service_role',
    'public.property_channel_publication_jobs',
    'truncate'
  ),
  'service role can process but not erase publication jobs'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.claim_property_channel_publication_jobs(text,integer,interval)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'private.complete_property_channel_publication_job(uuid,text,uuid,timestamp with time zone)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'private.fail_property_channel_publication_job(uuid,text,uuid,text,text,timestamp with time zone,boolean)',
    'execute'
  )
  and not has_function_privilege(
    'authenticated',
    'private.claim_property_channel_publication_jobs(text,integer,interval)',
    'execute'
  ),
  'only the trusted worker can execute publication job functions'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_indexes
    where schemaname = 'public'
      and indexname = any(array[
        'property_channel_publications_scope_unique',
        'property_channel_publications_identity_unique',
        'property_channel_publications_provider_uidx',
        'property_channel_publications_state_idx',
        'property_channel_versions_number_unique',
        'property_channel_versions_identity_unique',
        'property_channel_jobs_idempotency_unique',
        'property_channel_jobs_due_idx',
        'property_channel_jobs_processing_idx',
        'property_channel_jobs_history_idx',
        'property_channel_jobs_version_idx',
        'property_channel_jobs_dead_idx'
      ])
  $$,
  array[12::bigint],
  'scope, identity, claim, lease and history indexes exist'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_trigger
    where not tgisinternal
      and tgname = any(array[
        'property_channel_publications_set_updated_at',
        'property_channel_publications_actor_scope',
        'property_channel_publications_current_version_exists',
        'property_channel_versions_actor_scope',
        'property_channel_versions_immutable',
        'property_channel_jobs_set_updated_at',
        'property_channel_jobs_actor_scope'
      ])
  $$,
  array[7::bigint],
  'timestamp, actor and immutability triggers exist'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_constraint
    where conname = any(array[
      'property_channel_publications_property_fkey',
      'property_channel_publications_desired_check',
      'property_channel_publications_observed_check',
      'property_channel_publications_readiness_check',
      'property_channel_publications_versions_check',
      'property_channel_publications_published_version_fkey',
      'property_channel_publications_validation_errors_check',
      'property_channel_versions_publication_fkey',
      'property_channel_versions_payload_check',
      'property_channel_versions_hash_check',
      'property_channel_versions_errors_check',
      'property_channel_jobs_publication_fkey',
      'property_channel_jobs_version_fkey',
      'property_channel_jobs_action_check',
      'property_channel_jobs_status_check',
      'property_channel_jobs_request_hash_check',
      'property_channel_jobs_attempts_check',
      'property_channel_jobs_lock_check',
      'property_channel_jobs_terminal_check',
      'property_channel_jobs_dead_letter_check'
    ])
  $$,
  array[20::bigint],
  'tenant, state, payload, hash and worker constraints exist'
);

insert into public.organizations (id, name, slug, is_active)
values
  (
    'e1000000-0000-4000-8000-000000000001',
    'Publication Center Org A',
    'publication-center-org-a',
    true
  ),
  (
    'e1000000-0000-4000-8000-000000000002',
    'Publication Center Org B',
    'publication-center-org-b',
    true
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
    (
      'e2000000-0000-4000-8000-000000000001'::uuid,
      'publication-manager-a@example.test'
    ),
    (
      'e2000000-0000-4000-8000-000000000002'::uuid,
      'publication-manager-b@example.test'
    )
) as fixture(id, email);

insert into public.users (id, organization_id, name, email, role, is_active)
values
  (
    'e2000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'Publication Manager A',
    'publication-manager-a@example.test',
    'user',
    true
  ),
  (
    'e2000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'Publication Manager B',
    'publication-manager-b@example.test',
    'user',
    true
  )
on conflict (id) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    email = excluded.email,
    role = excluded.role,
    is_active = excluded.is_active;

insert into public.properties (
  id,
  organization_id,
  code,
  title,
  status,
  created_by
)
values
  (
    'e3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'PUB-A-001',
    'Publication Property A',
    'active',
    'e2000000-0000-4000-8000-000000000001'
  ),
  (
    'e3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000001',
    'PUB-A-002',
    'Publication Property A2',
    'active',
    'e2000000-0000-4000-8000-000000000001'
  ),
  (
    'e3000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000002',
    'PUB-B-001',
    'Publication Property B',
    'active',
    'e2000000-0000-4000-8000-000000000002'
  );

insert into public.property_channel_publications (
  id,
  organization_id,
  property_id,
  channel,
  created_by,
  updated_by
)
values (
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'site',
  'e2000000-0000-4000-8000-000000000001',
  'e2000000-0000-4000-8000-000000000001'
);

select is(
  (
    select
      channel_account_key || ':' || desired_state || ':' ||
      observed_state || ':' || readiness_state || ':' ||
      current_version::text
    from public.property_channel_publications
    where id = 'e4000000-0000-4000-8000-000000000001'
  ),
  'default:unpublished:draft:unknown:0',
  'a site publication starts with safe authoritative defaults'
);

set local role service_role;

select throws_ok(
  $$
    delete from public.property_channel_publications
    where id = 'e4000000-0000-4000-8000-000000000001'
  $$,
  '42501',
  null,
  'service role cannot delete the canonical parent and cascade publication history'
);

reset role;

select throws_ok(
  $$
    insert into public.property_channel_publications (
      organization_id, property_id, channel
    ) values (
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      'Invalid Channel'
    )
  $$,
  '23514',
  null,
  'channel keys must use the extensible canonical format'
);

select throws_ok(
  $$
    insert into public.property_channel_publications (
      organization_id, property_id, channel, validation_errors
    ) values (
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      'site',
      '{}'::jsonb
    )
  $$,
  '23514',
  null,
  'publication validation errors must be an array'
);

select throws_ok(
  $$
    insert into public.property_channel_publications (
      organization_id, property_id, channel
    ) values (
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000003',
      'site'
    )
  $$,
  '23503',
  null,
  'publication cannot reference another tenant property'
);

select throws_ok(
  $$
    insert into public.property_channel_publications (
      organization_id, property_id, channel, created_by
    ) values (
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      'site',
      'e2000000-0000-4000-8000-000000000002'
    )
  $$,
  '23514',
  'property_publication_user_cross_tenant_reference:created_by',
  'publication actor must belong to its tenant'
);

insert into public.property_channel_publication_versions (
  id,
  publication_id,
  organization_id,
  property_id,
  channel,
  version,
  source_property_updated_at,
  payload,
  payload_hash,
  created_by
)
values (
  'e5000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'site',
  1,
  clock_timestamp(),
  '{"title":"Publication Property A"}'::jsonb,
  repeat('1', 64),
  'e2000000-0000-4000-8000-000000000001'
);

select is(
  (
    select version || ':' || payload_schema_version
    from public.property_channel_publication_versions
    where id = 'e5000000-0000-4000-8000-000000000001'
  ),
  '1:1',
  'a valid immutable version is persisted with schema version one'
);

select throws_ok(
  $$
    update public.property_channel_publications
    set current_version = 7
    where id = 'e4000000-0000-4000-8000-000000000001'
  $$,
  '23503',
  'property_publication_current_version_missing',
  'current_version must identify an immutable version of the same publication'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_versions (
      publication_id, organization_id, property_id, channel, version,
      source_property_updated_at, payload, payload_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 2, clock_timestamp(), '[]'::jsonb, repeat('2', 64)
    )
  $$,
  '23514',
  null,
  'version payload must be a JSON object'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_versions (
      publication_id, organization_id, property_id, channel, version,
      source_property_updated_at, payload, payload_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 2, clock_timestamp(), '{}'::jsonb, 'NOT-SHA-256'
    )
  $$,
  '23514',
  null,
  'version payload hash must be lowercase SHA-256'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_versions (
      publication_id, organization_id, property_id, channel, version,
      source_property_updated_at, payload, payload_hash, readiness_errors
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 2, clock_timestamp(), '{}'::jsonb, repeat('2', 64),
      '{}'::jsonb
    )
  $$,
  '23514',
  null,
  'version readiness errors must be an array'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_versions (
      publication_id, organization_id, property_id, channel, version,
      source_property_updated_at, payload, payload_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000003',
      'site', 2, clock_timestamp(), '{}'::jsonb, repeat('2', 64)
    )
  $$,
  '23503',
  null,
  'publication version cannot cross tenant or property scope'
);

select throws_ok(
  $$
    update public.property_channel_publication_versions
    set payload = '{"changed":true}'::jsonb
    where id = 'e5000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  'property_publication_version_immutable',
  'published payload versions cannot be mutated'
);

select lives_ok(
  $$
    update public.property_channel_publication_versions
    set created_by = null
    where id = 'e5000000-0000-4000-8000-000000000001'
  $$,
  'referential actor cleanup does not mutate immutable snapshot content'
);

update public.property_channel_publications
set desired_state = 'published',
    observed_state = 'published',
    readiness_state = 'ready',
    current_version = 1,
    published_version = 1,
    updated_by = 'e2000000-0000-4000-8000-000000000001'
where id = 'e4000000-0000-4000-8000-000000000001';

select is(
  (
    select observed_state || ':' || published_version::text
    from public.property_channel_publications
    where id = 'e4000000-0000-4000-8000-000000000001'
  ),
  'published:1',
  'publication tracks the successfully published immutable version'
);

insert into public.property_channel_publications (
  id,
  organization_id,
  property_id,
  channel,
  created_by
)
values (
  'e4000000-0000-4000-8000-000000000002',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  'site',
  'e2000000-0000-4000-8000-000000000001'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, organization_id, property_id, channel, action,
      idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 'publish', 'publish-without-version', repeat('a', 64)
    )
  $$,
  '23514',
  null,
  'publish and update jobs require an immutable version'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, organization_id, property_id, channel, action,
      idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 'revalidate', 'revalidate-without-version', repeat('a', 64)
    )
  $$,
  '23514',
  null,
  'revalidate jobs require an immutable version'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, version_id, organization_id, property_id, channel,
      action, idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000002',
      'e3000000-0000-4000-8000-000000000003',
      'site', 'publish', 'cross-tenant-job', repeat('a', 64)
    )
  $$,
  '23503',
  null,
  'publication job cannot cross tenant scope'
);

set constraints property_channel_jobs_version_fkey immediate;

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, version_id, organization_id, property_id, channel,
      action, idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000002',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      'site', 'publish', 'wrong-publication-version', repeat('a', 64)
    )
  $$,
  '23503',
  null,
  'job version must belong to the same publication identity'
);

insert into public.property_channel_publication_jobs (
  id,
  publication_id,
  version_id,
  organization_id,
  property_id,
  channel,
  action,
  idempotency_key,
  request_hash,
  requested_by
)
values (
  'e7000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'e5000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'site',
  'publish',
  'site:property-a:version-1:publish',
  repeat('a', 64),
  'e2000000-0000-4000-8000-000000000001'
);

select is(
  (
    select status
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000001'
  ),
  'pending',
  'valid publication work is durably queued'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, version_id, organization_id, property_id, channel,
      action, idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 'publish', 'site:property-a:version-1:publish', repeat('a', 64)
    )
  $$,
  '23505',
  null,
  'organization-scoped idempotency rejects duplicate work'
);

select throws_ok(
  $$
    insert into public.property_channel_publication_jobs (
      publication_id, version_id, organization_id, property_id, channel,
      action, idempotency_key, request_hash
    ) values (
      'e4000000-0000-4000-8000-000000000001',
      'e5000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000001',
      'site', 'publish', 'invalid-request-hash', 'not-a-sha-256'
    )
  $$,
  '23514',
  null,
  'job request hash must be lowercase SHA-256'
);

select throws_ok(
  $$
    update public.property_channel_publication_jobs
    set status = 'processing'
    where id = 'e7000000-0000-4000-8000-000000000001'
  $$,
  '23514',
  null,
  'processing state requires a complete lease shape'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.claim_property_channel_publication_jobs(
      'site-worker-a',
      10,
      interval '5 minutes'
    )
  $$,
  array[1::bigint],
  'worker atomically claims one due publication job'
);

select ok(
  (
    select
      status = 'processing'
      and attempts = 1
      and locked_by = 'site-worker-a'
      and locked_at is not null
      and lease_token is not null
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000001'
  ),
  'claim records an attempt and a complete fenced lease'
);

create temporary table property_publication_test_tokens (
  key text primary key,
  token uuid not null
) on commit drop;

insert into property_publication_test_tokens (key, token)
select 'first-lease', lease_token
from public.property_channel_publication_jobs
where id = 'e7000000-0000-4000-8000-000000000001';

update public.property_channel_publication_jobs
set locked_at = clock_timestamp() - interval '10 minutes'
where id = 'e7000000-0000-4000-8000-000000000001';

select results_eq(
  $$
    select count(*)::bigint
    from private.claim_property_channel_publication_jobs(
      'site-worker-b',
      10,
      interval '5 minutes'
    )
  $$,
  array[1::bigint],
  'expired publication lease can be reclaimed without blocking'
);

select ok(
  (
    select job.lease_token <> token.token
    from public.property_channel_publication_jobs as job
    cross join property_publication_test_tokens as token
    where job.id = 'e7000000-0000-4000-8000-000000000001'
      and token.key = 'first-lease'
  ),
  'reclaim rotates the fencing token'
);

select is(
  private.complete_property_channel_publication_job(
    'e7000000-0000-4000-8000-000000000001',
    'site-worker-a',
    (
      select token
      from property_publication_test_tokens
      where key = 'first-lease'
    ),
    clock_timestamp()
  ),
  false,
  'stale worker cannot acknowledge a reclaimed lease'
);

select is(
  private.complete_property_channel_publication_job(
    'e7000000-0000-4000-8000-000000000001',
    'site-worker-b',
    (
      select lease_token
      from public.property_channel_publication_jobs
      where id = 'e7000000-0000-4000-8000-000000000001'
    ),
    clock_timestamp()
  ),
  true,
  'current lease owner can acknowledge publication work'
);

select ok(
  (
    select
      status = 'succeeded'
      and attempts = 2
      and completed_at is not null
      and locked_at is null
      and locked_by is null
      and lease_token is null
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000001'
  ),
  'successful job closes and clears its lease'
);

insert into public.property_channel_publication_jobs (
  id,
  publication_id,
  organization_id,
  property_id,
  channel,
  action,
  idempotency_key,
  request_hash,
  requested_by
)
values (
  'e7000000-0000-4000-8000-000000000002',
  'e4000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'site',
  'unpublish',
  'site:property-a:unpublish',
  repeat('b', 64),
  'e2000000-0000-4000-8000-000000000001'
);

select is(
  (
    select version_id is null
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000002'
  ),
  true,
  'unpublish work does not require a payload version'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.claim_property_channel_publication_jobs(
      'retry-worker',
      10,
      interval '5 minutes'
    )
  $$,
  array[1::bigint],
  'retry worker claims the unpublish job'
);

insert into property_publication_test_tokens (key, token)
select 'retry-lease', lease_token
from public.property_channel_publication_jobs
where id = 'e7000000-0000-4000-8000-000000000002';

select is(
  private.fail_property_channel_publication_job(
    'e7000000-0000-4000-8000-000000000002',
    'retry-worker',
    (
      select token
      from property_publication_test_tokens
      where key = 'retry-lease'
    ),
    'temporary_failure',
    'Temporary publication failure.',
    clock_timestamp() - interval '1 second',
    false
  ),
  true,
  'lease owner can schedule a retry'
);

select ok(
  (
    select
      status = 'retry'
      and attempts = 1
      and next_attempt_at <= clock_timestamp()
      and locked_at is null
      and locked_by is null
      and lease_token is null
      and last_error_code = 'temporary_failure'
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000002'
  ),
  'retry keeps durable error context and clears its lease'
);

select is(
  private.fail_property_channel_publication_job(
    'e7000000-0000-4000-8000-000000000002',
    'retry-worker',
    (
      select token
      from property_publication_test_tokens
      where key = 'retry-lease'
    ),
    'stale_failure',
    'Must not overwrite retry state.',
    clock_timestamp(),
    false
  ),
  false,
  'released lease cannot overwrite retry state'
);

select results_eq(
  $$
    select count(*)::bigint
    from private.claim_property_channel_publication_jobs(
      'dead-worker',
      10,
      interval '5 minutes'
    )
  $$,
  array[1::bigint],
  'due retry can be claimed again'
);

select is(
  private.fail_property_channel_publication_job(
    'e7000000-0000-4000-8000-000000000002',
    'dead-worker',
    (
      select lease_token
      from public.property_channel_publication_jobs
      where id = 'e7000000-0000-4000-8000-000000000002'
    ),
    'permanent_failure',
    'Provider rejected the publication permanently.',
    null,
    true
  ),
  true,
  'lease owner can dead-letter permanent failure'
);

select ok(
  (
    select
      status = 'dead'
      and attempts = 2
      and completed_at is not null
      and dead_lettered_at is not null
      and last_error_code = 'permanent_failure'
      and lease_token is null
    from public.property_channel_publication_jobs
    where id = 'e7000000-0000-4000-8000-000000000002'
  ),
  'permanent failure enters terminal dead-letter state'
);

select * from finish();

rollback;
