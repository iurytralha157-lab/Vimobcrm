begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

select results_eq(
  $$
    select count(*)::bigint
    from pg_class
    where oid = any(array[
      'public.portal_integrations'::regclass,
      'public.portal_listing_publications'::regclass,
      'public.portal_import_reports'::regclass,
      'public.portal_webhook_events'::regclass
    ])
      and relrowsecurity
      and relforcerowsecurity
  $$,
  array[4::bigint],
  'all portal tables enable and force RLS'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'portal_integrations',
        'portal_listing_publications',
        'portal_import_reports',
        'portal_webhook_events'
      ])
      and roles && array['public', 'anon', 'authenticated']::name[]
  $$,
  array[0::bigint],
  'portal tables expose no browser RLS policies'
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
      'portal_integrations',
      'portal_listing_publications',
      'portal_import_reports',
      'portal_webhook_events'
    ]) as target(table_name)
    cross join unnest(array['anon', 'authenticated'])
      as browser_role(name)
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(name)
  ),
  'browser roles have no portal table privileges'
);

select ok(
  not exists (
    select 1
    from pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as privilege
    where relation.oid = any(array[
      'public.portal_integrations'::regclass,
      'public.portal_listing_publications'::regclass,
      'public.portal_import_reports'::regclass,
      'public.portal_webhook_events'::regclass
    ])
      and privilege.grantee = 0
  ),
  'PUBLIC has no portal table privileges'
);

select ok(
  (
    select count(*) = 16
      and count(distinct table_name) = 4
      and bool_and(
        privilege_type = any(array['DELETE', 'INSERT', 'SELECT', 'UPDATE'])
      )
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any(array[
        'portal_integrations',
        'portal_listing_publications',
        'portal_import_reports',
        'portal_webhook_events'
      ])
      and grantee = 'service_role'
  ),
  'service role has only the portal privileges used by Go operations and tenant purge'
);

select ok(
  to_regprocedure('private.enforce_portal_tenant_scope()') is not null,
  'portal tenant-scope trigger function remains installed'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_trigger
    where tgrelid = any(array[
      'public.portal_integrations'::regclass,
      'public.portal_listing_publications'::regclass,
      'public.portal_import_reports'::regclass,
      'public.portal_webhook_events'::regclass
    ])
      and tgname = any(array[
        'enforce_portal_integrations_tenant_scope',
        'enforce_portal_publications_tenant_scope',
        'enforce_portal_reports_tenant_scope',
        'enforce_portal_events_tenant_scope'
      ])
      and not tgisinternal
      and tgenabled <> 'D'
  $$,
  array[4::bigint],
  'all portal tenant-scope triggers remain enabled'
);

select ok(
  to_regclass(
    'public.property_channel_publications_grupo_olx_feed_idx'
  ) is not null,
  'canonical Grupo OLX feed index exists'
);

select ok(
  (
    select indisvalid and indisready and indpred is not null
    from pg_index
    where indexrelid =
      'public.property_channel_publications_grupo_olx_feed_idx'::regclass
  ),
  'canonical Grupo OLX feed index is valid, ready and partial'
);

select ok(
  (
    select pg_get_indexdef(indexrelid) like
      '%(organization_id, channel, channel_account_key, desired_state, observed_state, published_version, provider_listing_id)%'
    from pg_index
    where indexrelid =
      'public.property_channel_publications_grupo_olx_feed_idx'::regclass
  ),
  'canonical Grupo OLX feed index has the expected composite key'
);

select ok(
  (
    select
      pg_get_expr(indpred, indrelid) like '%channel = ''grupo_olx''%'
      and pg_get_expr(indpred, indrelid) like '%desired_state = ''published''%'
    from pg_index
    where indexrelid =
      'public.property_channel_publications_grupo_olx_feed_idx'::regclass
  ),
  'canonical Grupo OLX feed index has the expected partial predicate'
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
  'canonical publication tables remain forced-RLS boundaries'
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
  'canonical publication tables retain no direct policies'
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
    cross join unnest(array[
      'select',
      'insert',
      'update',
      'delete',
      'truncate',
      'references',
      'trigger'
    ]) as privilege(name)
  ),
  'browser roles retain no canonical publication table privileges'
);

select ok(
  not exists (
    select 1
    from pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as privilege
    where relation.oid = any(array[
      'public.property_channel_publications'::regclass,
      'public.property_channel_publication_versions'::regclass,
      'public.property_channel_publication_jobs'::regclass
    ])
      and privilege.grantee = 0
  ),
  'PUBLIC retains no canonical publication table privileges'
);

select ok(
  (
    select count(*) = 8
      and count(distinct table_name) = 3
      and bool_and(
        case table_name
          when 'property_channel_publications' then
            privilege_type = any(array['INSERT', 'SELECT', 'UPDATE'])
          when 'property_channel_publication_versions' then
            privilege_type = any(array['INSERT', 'SELECT'])
          when 'property_channel_publication_jobs' then
            privilege_type = any(array['INSERT', 'SELECT', 'UPDATE'])
          else false
        end
      )
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = any(array[
        'property_channel_publications',
        'property_channel_publication_versions',
        'property_channel_publication_jobs'
      ])
      and grantee = 'service_role'
  ),
  'canonical service-role grants remain least privilege'
);

select ok(
  (
    select bool_and(
      not has_table_privilege(
        'service_role',
        format('public.%I', target.table_name),
        privilege.name
      )
    )
    from unnest(array[
      'portal_integrations',
      'portal_listing_publications',
      'portal_import_reports',
      'portal_webhook_events',
      'property_channel_publications',
      'property_channel_publication_versions',
      'property_channel_publication_jobs'
    ]) as target(table_name)
    cross join unnest(array['truncate', 'references', 'trigger'])
      as privilege(name)
  )
  and (
    select bool_and(
      not has_table_privilege(
        'service_role',
        format('public.%I', target.table_name),
        'delete'
      )
    )
    from unnest(array[
      'property_channel_publications',
      'property_channel_publication_versions',
      'property_channel_publication_jobs'
    ]) as target(table_name)
  ),
  'service role has no schema-level grants and cannot delete canonical publication history'
);

select * from finish();
rollback;
