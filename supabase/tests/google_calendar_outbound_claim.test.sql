begin;

create extension if not exists pgtap with schema extensions;
select plan(4);

select ok(
  to_regprocedure('public.google_calendar_claim_outbound_sync_jobs(integer,text)') is not null,
  'outbound-only claim RPC exists without a user allowlist'
);

select ok(
  to_regprocedure('public.google_calendar_claim_outbound_sync_jobs(integer,text,uuid[])') is null,
  'the prior canary claim signature is absent'
);

select ok(
  not has_function_privilege('anon', 'public.google_calendar_claim_outbound_sync_jobs(integer,text)', 'execute')
  and not has_function_privilege('authenticated', 'public.google_calendar_claim_outbound_sync_jobs(integer,text)', 'execute')
  and has_function_privilege('service_role', 'public.google_calendar_claim_outbound_sync_jobs(integer,text)', 'execute'),
  'only the backend service role can claim outbound jobs'
);

select ok(
  to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)') is null
  or not has_function_privilege(
    'service_role',
    to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)'),
    'execute'
  ),
  'legacy generic claim RPC cannot drain inbound jobs'
);

select * from finish();
rollback;
