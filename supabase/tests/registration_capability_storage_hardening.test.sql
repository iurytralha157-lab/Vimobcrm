begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(23);

select has_column(
  'public',
  'invitations',
  'token_hash',
  'invitations persist only the digest used by the new API'
);

select ok(
  not exists (
    select 1
    from public.invitations
    where token_hash is null
       or token_hash !~ '^[0-9a-f]{64}$'
  ),
  'all invitation rows have a canonical SHA-256 digest'
);

select ok(
  not has_table_privilege('anon', 'public.invitations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.invitations', 'SELECT'),
  'browser roles cannot read invitation rows'
);

select ok(
  not has_table_privilege('anon', 'public.invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invitations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.invitations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.invitations', 'DELETE'),
  'browser roles cannot mutate invitations'
);

select has_table(
  'public',
  'organization_checkout_capabilities',
  'checkout capabilities have a dedicated service-only table'
);

select ok(
  not has_table_privilege('anon', 'public.organization_checkout_capabilities', 'SELECT')
  and not has_table_privilege('authenticated', 'public.organization_checkout_capabilities', 'SELECT'),
  'browser roles cannot read checkout capabilities'
);

select ok(
  has_table_privilege('service_role', 'public.organization_checkout_capabilities', 'SELECT')
  and has_table_privilege('service_role', 'public.organization_checkout_capabilities', 'INSERT')
  and has_table_privilege('service_role', 'public.organization_checkout_capabilities', 'UPDATE')
  and has_table_privilege('service_role', 'public.organization_checkout_capabilities', 'DELETE'),
  'service workers retain checkout capability access'
);

select ok(
  not has_column_privilege('authenticated', 'public.organizations', 'checkout_token', 'SELECT'),
  'authenticated members cannot read the legacy checkout token'
);

select ok(
  not has_column_privilege('authenticated', 'public.organizations', 'signup_attempt_id', 'SELECT')
  and not has_column_privilege('authenticated', 'public.organizations', 'signup_attempt_email', 'SELECT'),
  'authenticated members cannot read public-signup recovery capabilities'
);

select ok(
  has_column_privilege('authenticated', 'public.organizations', 'id', 'SELECT')
  and has_column_privilege('authenticated', 'public.organizations', 'name', 'SELECT'),
  'authenticated members retain safe organization reads'
);

select ok(
  not has_table_privilege('anon', 'public.organizations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organizations', 'INSERT')
  and not has_table_privilege('authenticated', 'public.organizations', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.organizations', 'DELETE'),
  'organization mutation is API-only'
);

select ok(
  not has_table_privilege('anon', 'public.webhooks_integrations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.webhooks_integrations', 'SELECT'),
  'generic webhook API tokens are not browser-readable'
);

select ok(
  not has_table_privilege('anon', 'public.webhooks', 'SELECT')
  and not has_table_privilege('authenticated', 'public.webhooks', 'SELECT'),
  'legacy webhook secrets are not browser-readable'
);

select ok(
  not has_table_privilege('anon', 'public.whatsapp_sessions', 'SELECT')
  and not has_table_privilege('authenticated', 'public.whatsapp_sessions', 'SELECT'),
  'WhatsApp provider credentials are not browser-readable'
);

select ok(
  not has_table_privilege('anon', 'public.portal_integrations', 'SELECT')
  and not has_table_privilege('authenticated', 'public.portal_integrations', 'SELECT'),
  'portal feed and webhook capabilities are not browser-readable'
);

select ok(
  not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'invitations',
        'webhooks_integrations',
        'webhooks',
        'whatsapp_sessions',
        'portal_integrations'
      )
  ),
  'service-only capability tables have no browser RLS policies'
);

select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.organizations'::regclass
      and tgname = 'sync_organization_checkout_capability'
      and not tgisinternal
  ),
  'legacy organization writes are bridged during the deployment transition'
);

select has_column(
  'private',
  'public_signup_attempt_claims',
  'recovery_email',
  'signup recovery stores the normalized replacement email only inside private fencing state'
);

select has_column(
  'private',
  'public_signup_attempt_claims',
  'recovery_token_hash',
  'signup recovery persists only a token digest'
);

select has_column(
  'private',
  'public_signup_attempt_claims',
  'recovery_expires_at',
  'signup recovery records an absolute capability expiry'
);

select has_column(
  'private',
  'public_signup_attempt_claims',
  'recovery_started_at',
  'signup recovery records when the cross-system operation became irreversible'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid = 'private.public_signup_attempt_claims'::regclass
      and constraint_row.conname = 'public_signup_attempt_claims_state_check'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%status = ''recovering''%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%recovery_token_hash IS NOT NULL%'
      and pg_catalog.pg_get_constraintdef(constraint_row.oid) like '%recovery_expires_at > recovery_started_at%'
  ),
  'recovering claims require a complete exact-attempt capability and bounded lifetime'
);

select ok(
  not has_table_privilege('anon', 'private.public_signup_attempt_claims', 'SELECT')
  and not has_table_privilege('authenticated', 'private.public_signup_attempt_claims', 'SELECT')
  and not has_table_privilege('service_role', 'private.public_signup_attempt_claims', 'SELECT'),
  'signup recovery fencing is callable only through backend-controlled SQL, never a browser or service bearer'
);

select * from finish();
rollback;
