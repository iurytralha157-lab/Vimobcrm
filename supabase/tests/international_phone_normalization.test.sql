begin;

create extension if not exists pgtap with schema extensions;
select plan(15);

select is(
  public.normalize_phone('+1 (415) 555-2671'),
  '14155552671',
  'an explicit North American E.164 number keeps its country code'
);

select is(
  public.normalize_phone('00 351 912 345 678'),
  '351912345678',
  'the international 00 prefix is equivalent to plus'
);

select is(
  public.normalize_phone('(11) 99999-9999'),
  '5511999999999',
  'a Brazilian local mobile remains backwards compatible'
);

select is(
  public.normalize_phone('+55 (11) 99999-9999'),
  '5511999999999',
  'an explicit Brazilian E.164 number matches the local form'
);

select isnt(
  public.normalize_phone('+1 (415) 555-2671'),
  public.normalize_phone('(14) 15555-2671'),
  'an explicit international number is not reinterpreted as Brazilian'
);

select is(
  public.normalize_phone(null),
  null,
  'null stays null'
);

select is(
  public.normalize_phone('  '),
  null,
  'blank input stays null'
);

select volatility_is(
  'public',
  'normalize_phone',
  array['text'],
  'immutable',
  'phone normalization remains safe for expression indexes'
);

select has_index(
  'public',
  'leads',
  'leads_org_phone_unique',
  'lead phone identity remains unique inside each organization'
);

select ok(
  (
    select
      phone_index.indisunique
      and phone_index.indisvalid
      and lower(pg_catalog.pg_get_indexdef(phone_index.indexrelid, 1, true)) = 'organization_id'
      and lower(pg_catalog.pg_get_indexdef(phone_index.indexrelid, 2, true)) like '%normalize_phone(phone)%'
      and lower(pg_catalog.pg_get_expr(phone_index.indpred, phone_index.indrelid)) like '%phone is not null%'
      and pg_catalog.strpos(lower(pg_catalog.pg_get_expr(phone_index.indpred, phone_index.indrelid)), 'btrim(phone) <>') > 0
      and lower(pg_catalog.pg_get_expr(phone_index.indpred, phone_index.indrelid)) like '%normalize_phone(phone) is not null%'
      and pg_catalog.strpos(lower(pg_catalog.pg_get_expr(phone_index.indpred, phone_index.indrelid)), 'normalize_phone(phone) <>') > 0
    from pg_catalog.pg_index as phone_index
    where phone_index.indexrelid = 'public.leads_org_phone_unique'::regclass
  ),
  'lead phone index keeps the tenant key, normalization expression, and nonblank partial predicate'
);

insert into public.organizations (id, name, slug, is_active)
values
  ('f0100000-0000-4000-8000-000000000001', 'International Phone Test A', 'international-phone-test-a', true),
  ('f0100000-0000-4000-8000-000000000002', 'International Phone Test B', 'international-phone-test-b', true);

select lives_ok(
  $$
    insert into public.leads (id, organization_id, name, phone, source)
    values
      (
        'f0200000-0000-4000-8000-000000000001',
        'f0100000-0000-4000-8000-000000000001',
        'North American lead',
        '+1 (415) 555-2671',
        'manual'
      ),
      (
        'f0200000-0000-4000-8000-000000000002',
        'f0100000-0000-4000-8000-000000000001',
        'Brazilian local lead',
        '(14) 15555-2671',
        'manual'
      )
  $$,
  'an explicit +1 identity remains distinct from the same 11 digits entered as a Brazilian local phone'
);

select lives_ok(
  $$
    insert into public.leads (id, organization_id, name, phone, source)
    values (
      'f0200000-0000-4000-8000-000000000003',
      'f0100000-0000-4000-8000-000000000002',
      'Same international identity in another tenant',
      '00 1 415 555 2671',
      'manual'
    )
  $$,
  'the same normalized phone remains available in another organization'
);

select throws_ok(
  $$
    insert into public.leads (id, organization_id, name, phone, source)
    values (
      'f0200000-0000-4000-8000-000000000004',
      'f0100000-0000-4000-8000-000000000001',
      'Duplicate international alias',
      '00 1 415 555 2671',
      'manual'
    )
  $$,
  '23505',
  null,
  'plus and 00 aliases of the same international identity conflict inside one organization'
);

select throws_ok(
  $$
    insert into public.leads (id, organization_id, name, phone, source)
    values (
      'f0200000-0000-4000-8000-000000000005',
      'f0100000-0000-4000-8000-000000000001',
      'Duplicate Brazilian alias',
      '+55 (14) 15555-2671',
      'manual'
    )
  $$,
  '23505',
  null,
  'Brazilian local and explicit +55 aliases conflict inside one organization'
);

select lives_ok(
  $$
    insert into public.leads (id, organization_id, name, phone, source)
    values
      ('f0200000-0000-4000-8000-000000000006', 'f0100000-0000-4000-8000-000000000001', 'Null phone one', null, 'manual'),
      ('f0200000-0000-4000-8000-000000000007', 'f0100000-0000-4000-8000-000000000001', 'Null phone two', null, 'manual'),
      ('f0200000-0000-4000-8000-000000000008', 'f0100000-0000-4000-8000-000000000001', 'Blank phone one', '', 'manual'),
      ('f0200000-0000-4000-8000-000000000009', 'f0100000-0000-4000-8000-000000000001', 'Blank phone two', '   ', 'manual')
  $$,
  'null and blank phones remain outside the partial unique index'
);

select * from finish();
rollback;
