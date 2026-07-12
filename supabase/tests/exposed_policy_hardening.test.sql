begin;

create extension if not exists pgtap with schema extensions;
select plan(20);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'onboarding_requests' and 'anon' = any(roles)),
  0::bigint,
  'anonymous users have no onboarding request policies'
);

select ok(
  not has_table_privilege('anon', 'public.onboarding_requests', 'SELECT'),
  'anonymous users cannot select onboarding requests'
);

select ok(
  not has_table_privilege('anon', 'public.onboarding_requests', 'INSERT'),
  'anonymous users cannot insert onboarding requests directly'
);

select ok(
  has_table_privilege('authenticated', 'public.onboarding_requests', 'SELECT')
    and has_table_privilege('authenticated', 'public.onboarding_requests', 'INSERT')
    and has_table_privilege('authenticated', 'public.onboarding_requests', 'UPDATE'),
  'authenticated onboarding workflows retain required privileges'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_attachments'
      and (
        lower(regexp_replace(coalesce(qual, ''), '[[:space:]()]', '', 'g')) = 'true'
        or lower(regexp_replace(coalesce(with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
      )
  ),
  0::bigint,
  'lead attachments have no unconditional policies'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lead_attachments' and 'public' = any(roles)),
  0::bigint,
  'lead attachment policies are not assigned to public'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_attachments'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'private\.'
  ),
  0::bigint,
  'every lead attachment policy uses private access helpers'
);

select is(
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'lead_attachments' and 'anon' = any(roles)),
  0::bigint,
  'anonymous users have no lead attachment policies'
);

select ok(
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lead_attachments' and column_name = 'organization_id'
    ) then true
    else not has_table_privilege('authenticated', 'public.lead_attachments', 'INSERT')
  end,
  'legacy lead attachments are backend-owned for inserts'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_events'
      and cmd = 'SELECT'
      and lower(regexp_replace(coalesce(qual, ''), '[[:space:]()]', '', 'g')) = 'true'
  ),
  0::bigint,
  'lead events have no unconditional read policies'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_events'
      and cmd = 'SELECT'
      and (coalesce(qual, '') || ' ' || coalesce(with_check, '')) !~ 'private\.'
  ),
  0::bigint,
  'lead event reads are scoped by organization or lead access'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'lead_events'
      and lower(regexp_replace(coalesce(with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
  ),
  0::bigint,
  'lead events have no unconditional write policies'
);

select ok(
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lead_events' and column_name = 'page_path'
    ) then exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'lead_events' and cmd = 'INSERT'
        and with_check ~ 'private\.can_track_public_site'
    )
    else true
  end,
  'legacy public tracking requires an active site'
);

select ok(
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lead_events' and column_name = 'page_path'
    ) then exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'lead_events' and cmd = 'INSERT'
        and with_check ~ 'cta_click'
    )
    else true
  end,
  'legacy public tracking preserves supported event types'
);

select ok(
  case
    when exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'lead_events' and column_name = 'page_path'
    ) then has_table_privilege('anon', 'public.lead_events', 'INSERT')
    else not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'lead_events' and 'anon' = any(roles)
    )
  end,
  'lead event privileges match the installed schema shape'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
      and (
        lower(regexp_replace(coalesce(qual, ''), '[[:space:]()]', '', 'g')) = 'true'
        or lower(regexp_replace(coalesce(with_check, ''), '[[:space:]()]', '', 'g')) = 'true'
      )
  ),
  0::bigint,
  'site analytics have no unconditional policies'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
      and cmd = 'SELECT'
      and coalesce(qual, '') !~ '(private\.is_org_member|organization_members)'
  ),
  0::bigint,
  'site analytics reads require active organization membership'
);

select ok(
  has_table_privilege('anon', 'public.site_analytics_events', 'INSERT') = exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
      and cmd = 'INSERT'
      and 'anon' = any(roles)
  ),
  'anonymous site analytics grants match a scoped insert policy'
);

select is(
  (
    select count(*)
    from pg_default_acl defaults
    join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) privilege
    where pg_get_userbyid(defaults.defaclrole) = 'postgres'
      and namespace.nspname = 'public'
      and defaults.defaclobjtype in ('r', 'S')
      and privilege.grantee in ((select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'))
  ),
  0::bigint,
  'future postgres-owned tables and sequences are not automatically exposed'
);

select is(
  (
    select count(*)
    from pg_default_acl defaults
    join pg_namespace namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) privilege
    where pg_get_userbyid(defaults.defaclrole) = 'postgres'
      and namespace.nspname = 'public'
      and defaults.defaclobjtype = 'f'
      and privilege.grantee in (0, (select oid from pg_roles where rolname = 'anon'), (select oid from pg_roles where rolname = 'authenticated'))
  ),
  0::bigint,
  'future postgres-owned functions require explicit execute grants'
);

select * from finish();
rollback;
