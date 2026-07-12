begin;

create extension if not exists pgtap with schema extensions;
select plan(10);

select is(
  (
    select count(*) from pg_policies
    where schemaname = 'public'
      and policyname in (
        'Authenticated users can view system settings',
        'Public can view system settings',
        'Super admins can view system settings',
        'Admins can manage cadence templates',
        'Super admin access cadence_templates',
        'Users can view cadence templates',
        'Admins can manage financial categories',
        'Super admin access financial_categories',
        'Users can view financial categories',
        'Users can manage tags',
        'Super admin access tags',
        'Users can view org tags',
        'Super admin can manage modules',
        'Super admin access organization_modules'
      )
  ),
  0::bigint,
  'legacy low-risk policy set is absent'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'system settings consolidated %') in (0, 1),
  'system settings consolidation is complete or not required'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'cadence templates consolidated %') in (0, 4),
  'cadence templates consolidation is complete or not required'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'financial categories consolidated %') in (0, 4),
  'financial categories consolidation is complete or not required'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'tags consolidated %') in (0, 4),
  'tags consolidation is complete or not required'
);

select ok(
  (select count(*) from pg_policies where schemaname = 'public' and policyname like 'organization modules consolidated %') in (0, 3),
  'organization modules consolidation is complete or not required'
);

select ok(has_table_privilege('anon', 'public.system_settings', 'SELECT'), 'public settings read privilege remains');
select ok(has_table_privilege('authenticated', 'public.cadence_templates', 'SELECT'), 'cadence read privilege remains');
select ok(has_table_privilege('authenticated', 'public.financial_categories', 'SELECT'), 'financial category read privilege remains');
select ok(has_table_privilege('authenticated', 'public.tags', 'SELECT'), 'tag read privilege remains');

select * from finish();
rollback;
