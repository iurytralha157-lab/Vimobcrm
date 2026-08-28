begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;

select plan(12);

select has_table(
  'private',
  'public_ingress_rate_limits',
  'private ingress limiter table exists'
);

select has_function(
  'private',
  'check_public_ingress_rate_limit',
  array['text', 'text', 'integer', 'integer', 'timestamp with time zone'],
  'private ingress limiter function exists'
);

select is(
  private.check_public_ingress_rate_limit(
    'site_contact',
    repeat('a', 64),
    2,
    60,
    '2026-07-29 01:00:10+00'::timestamptz
  ),
  true,
  'first request in a window is allowed'
);

select is(
  private.check_public_ingress_rate_limit(
    'site_contact',
    repeat('a', 64),
    2,
    60,
    '2026-07-29 01:00:20+00'::timestamptz
  ),
  true,
  'request at the configured limit is allowed'
);

select is(
  private.check_public_ingress_rate_limit(
    'site_contact',
    repeat('a', 64),
    2,
    60,
    '2026-07-29 01:00:30+00'::timestamptz
  ),
  false,
  'request above the configured limit is rejected'
);

select is(
  private.check_public_ingress_rate_limit(
    'site_contact',
    repeat('b', 64),
    2,
    60,
    '2026-07-29 01:00:30+00'::timestamptz
  ),
  true,
  'a distinct server-derived subject has an independent budget'
);

select is(
  private.check_public_ingress_rate_limit(
    'site_contact',
    repeat('a', 64),
    2,
    60,
    '2026-07-29 01:01:01+00'::timestamptz
  ),
  true,
  'a new fixed window recovers automatically'
);

select throws_ok(
  $$
    select private.check_public_ingress_rate_limit(
      'site_contact',
      'client-controlled-ip',
      2,
      60
    )
  $$,
  '22023',
  'invalid_public_ingress_rate_limit',
  'unhashed subjects fail closed'
);

select is(
  has_table_privilege(
    'anon',
    'private.public_ingress_rate_limits',
    'SELECT'
  ),
  false,
  'anon cannot read limiter identities'
);

select is(
  has_table_privilege(
    'service_role',
    'private.public_ingress_rate_limits',
    'SELECT'
  ),
  false,
  'service role cannot bypass the backend boundary'
);

select is(
  has_function_privilege(
    'service_role',
    'private.check_public_ingress_rate_limit(text,text,integer,integer,timestamp with time zone)',
    'EXECUTE'
  ),
  false,
  'service role cannot consume arbitrary limiter budgets'
);

select results_eq(
  $$
    select count(*)::bigint
    from cron.job
    where jobname = 'cleanup-public-ingress-rate-limits'
      and schedule = '17 * * * *'
      and active
  $$,
  array[1::bigint],
  'exactly one active cleanup job exists'
);

select * from finish();

rollback;
