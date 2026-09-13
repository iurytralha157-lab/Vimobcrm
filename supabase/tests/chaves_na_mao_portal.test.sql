begin;

create extension if not exists pgtap with schema extensions;
select plan(8);

select ok(
  (
    select convalidated
    from pg_constraint
    where conrelid = 'public.portal_integrations'::regclass
      and conname = 'portal_integrations_portal_check'
  ),
  'portal integration identifier constraint is validated'
);

select ok(
  (
    select pg_get_constraintdef(oid) like '%grupo_olx%'
      and pg_get_constraintdef(oid) like '%chaves_na_mao%'
    from pg_constraint
    where conrelid = 'public.portal_integrations'::regclass
      and conname = 'portal_integrations_portal_check'
  ),
  'portal integrations accept Grupo OLX and the independent Chaves na Mao identifier'
);

select ok(
  (
    select convalidated
    from pg_constraint
    where conrelid = 'public.portal_listing_publications'::regclass
      and conname = 'portal_listing_publications_portal_check'
  ),
  'portal listing identifier constraint is validated'
);

select ok(
  (
    select pg_get_constraintdef(oid) like '%grupo_olx%'
      and pg_get_constraintdef(oid) like '%chaves_na_mao%'
    from pg_constraint
    where conrelid = 'public.portal_listing_publications'::regclass
      and conname = 'portal_listing_publications_portal_check'
  ),
  'portal listings accept Grupo OLX and the independent Chaves na Mao identifier'
);

select ok(
  (
    select pg_get_constraintdef(oid) like '%grupo_olx%'
      and pg_get_constraintdef(oid) not like '%chaves_na_mao%'
    from pg_constraint
    where conrelid = 'public.portal_import_reports'::regclass
      and conname = 'portal_import_reports_portal_check'
  ),
  'Chaves na Mao is not enabled for an uncontracted import-report domain'
);

select ok(
  (
    select pg_get_constraintdef(oid) like '%grupo_olx%'
      and pg_get_constraintdef(oid) not like '%chaves_na_mao%'
    from pg_constraint
    where conrelid = 'public.portal_webhook_events'::regclass
      and conname = 'portal_webhook_events_portal_check'
  ),
  'Chaves na Mao is not enabled for an uncontracted lead-webhook domain'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_class
    where oid = any(array[
      'public.portal_integrations'::regclass,
      'public.portal_listing_publications'::regclass
    ])
      and relrowsecurity
      and relforcerowsecurity
  $$,
  array[2::bigint],
  'Chaves na Mao state remains behind the forced-RLS backend boundary'
);

select results_eq(
  $$
    select count(*)::bigint
    from pg_trigger
    where tgrelid = any(array[
      'public.portal_integrations'::regclass,
      'public.portal_listing_publications'::regclass
    ])
      and tgname = any(array[
        'enforce_portal_integrations_tenant_scope',
        'enforce_portal_publications_tenant_scope'
      ])
      and not tgisinternal
      and tgenabled <> 'D'
  $$,
  array[2::bigint],
  'tenant-scope triggers remain enabled for both Chaves na Mao tables'
);

select * from finish();
rollback;
