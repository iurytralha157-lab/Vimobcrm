begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(173);

select has_column(
  'public',
  'billing_payment_checkout_capabilities',
  'plan_id',
  'checkout capabilities persist the historical plan'
);
select has_column(
  'public',
  'billing_payment_checkout_capabilities',
  'billing_period_months',
  'checkout capabilities persist the historical period'
);
select has_column(
  'public',
  'billing_payment_checkout_capabilities',
  'amount',
  'checkout capabilities persist the historical total'
);
select has_column(
  'public',
  'billing_payment_checkout_capabilities',
  'snapshot_source',
  'checkout capabilities identify their immutable source'
);
select has_column(
  'public',
  'asaas_payments',
  'bank_slip_registration_cancelled_at',
  'boleto registration cancellation has dedicated state'
);
select has_column(
  'public',
  'asaas_payments',
  'bank_slip_registration_cancelled_due_date',
  'boleto cancellation is scoped to the exact due date'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'provider_card_credential',
  'recurrence stores only an opaque sealed provider credential'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'card_last4',
  'recurrence stores only a non-sensitive card display suffix'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'job_status',
  'recurrence creation and cancellation use a durable worker job state'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'job_lease_id',
  'recurrence jobs use an exact compare-and-set lease identity'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'provider_request_started_at',
  'provider POST start has durable evidence separate from a worker claim'
);
select has_table(
  'private',
  'billing_organization_checkout_card_attempt_limits',
  'organization capability card attempts have a durable private limiter'
);
select has_table(
  'private',
  'billing_ip_card_attempt_limits',
  'HMAC-IP card attempts have an independent durable private limiter'
);
select has_table(
  'private',
  'billing_authenticated_org_card_attempt_limits',
  'authenticated settings card attempts have a durable private limiter'
);
select has_table(
  'private',
  'billing_payment_card_attempt_limits',
  'payment checkout card attempts have a durable private limiter'
);
select ok(
  (
    select bool_and(relrowsecurity)
    from pg_class
    where oid in (
      'private.billing_organization_checkout_card_attempt_limits'::regclass,
      'private.billing_ip_card_attempt_limits'::regclass,
      'private.billing_authenticated_org_card_attempt_limits'::regclass,
      'private.billing_payment_card_attempt_limits'::regclass
    )
  ),
  'both card-attempt limiter tables enforce RLS as defense in depth'
);
select is(
  has_table_privilege(
    'service_role',
    'private.billing_organization_checkout_card_attempt_limits',
    'select'
  ) or has_table_privilege(
    'service_role',
    'private.billing_ip_card_attempt_limits',
    'select'
  ) or has_table_privilege(
    'service_role',
    'private.billing_authenticated_org_card_attempt_limits',
    'select'
  ) or has_table_privilege(
    'service_role',
    'private.billing_payment_card_attempt_limits',
    'select'
  ),
  false,
  'service_role cannot bypass the atomic limiter RPC with direct table access'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_organization_checkout_card_attempt(uuid,text,text)',
    'execute'
  ),
  false,
  'anon cannot claim organization checkout card attempts directly'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_organization_checkout_card_attempt(uuid,text,text)',
    'execute'
  ),
  true,
  'only the trusted Edge service role can claim card attempts'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_authenticated_organization_card_attempt(uuid,uuid,text)',
    'execute'
  ),
  false,
  'anon cannot claim authenticated organization card attempts'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_authenticated_organization_card_attempt(uuid,uuid,text)',
    'execute'
  ),
  true,
  'the trusted backend can claim authenticated organization card attempts'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_payment_restore(uuid,text)',
    'execute'
  ),
  false,
  'anon cannot claim a non-idempotent PIX restore'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_payment_restore(uuid,text)',
    'execute'
  ),
  true,
  'only the trusted backend can claim a non-idempotent PIX restore'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_payment_card_attempt_guard(uuid,text,text)',
    'execute'
  ),
  false,
  'anon cannot invoke the payment card guard directly'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_payment_card_attempt_guard(uuid,text,text)',
    'execute'
  ),
  true,
  'the trusted Edge service role can invoke the payment card guard'
);
select is(
  has_function_privilege(
    'anon',
    'public.reconcile_asaas_payment_method_change(uuid,uuid,uuid,text,text,text,text,numeric,text,text,date,text,text,date,timestamptz)',
    'execute'
  ),
  false,
  'anon cannot compare-and-set provider payment method state'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_payment_method_change(uuid,uuid,uuid,text,text,text,text,numeric,text,text,date,text,text,date,timestamptz)',
    'execute'
  ),
  true,
  'only the trusted backend can compare-and-set provider payment method state'
);
select is(
  has_function_privilege(
    'anon',
    'public.fail_prepared_billing_card_recurrence(uuid,text)',
    'execute'
  ),
  false,
  'anon cannot terminalize prepared recurrence state'
);
select is(
  has_function_privilege(
    'service_role',
    'public.fail_prepared_billing_card_recurrence(uuid,text)',
    'execute'
  ),
  true,
  'the trusted Edge service role can terminalize exact prepared recurrence state'
);
select is(
  has_function_privilege(
    'anon',
    'public.store_billing_card_recurrence_credential(uuid,text,text,text)',
    'execute'
  ),
  false,
  'anon cannot persist a sealed recurrence credential'
);
select is(
  has_function_privilege(
    'service_role',
    'public.store_billing_card_recurrence_credential(uuid,text,text,text)',
    'execute'
  ),
  true,
  'only the trusted Edge service role can persist a sealed recurrence credential'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_card_recurrence_by_provider_payment(text)',
    'execute'
  ),
  false,
  'anon cannot claim recurrence by provider payment id'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_card_recurrence_by_provider_payment(text)',
    'execute'
  ),
  true,
  'only the trusted webhook path can claim recurrence by provider payment id'
);
select is(
  has_function_privilege(
    'anon',
    'public.get_billing_card_recurrence_reversal_target(text)',
    'execute'
  ),
  false,
  'anon cannot resolve a future recurrence cancellation target'
);
select is(
  has_function_privilege(
    'service_role',
    'public.get_billing_card_recurrence_reversal_target(text)',
    'execute'
  ),
  true,
  'only the trusted backend can resolve a future recurrence cancellation target'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_card_recurrence_jobs(text,integer,integer)',
    'execute'
  ),
  false,
  'anon cannot claim durable recurrence jobs'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_card_recurrence_jobs(text,integer,integer)',
    'execute'
  ),
  true,
  'only service_role can claim durable recurrence jobs'
);
select is(
  has_function_privilege(
    'anon',
    'public.mark_billing_card_recurrence_provider_request_started(uuid,text,uuid)',
    'execute'
  ),
  false,
  'anon cannot mark a provider mutation as started'
);
select is(
  has_function_privilege(
    'service_role',
    'public.mark_billing_card_recurrence_provider_request_started(uuid,text,uuid)',
    'execute'
  ),
  true,
  'only service_role can cross the provider request boundary'
);
select is(
  has_function_privilege(
    'anon',
    'public.succeed_billing_card_recurrence_job(uuid,text,text,uuid,jsonb)',
    'execute'
  ),
  false,
  'anon cannot complete a recurrence job'
);
select is(
  has_function_privilege(
    'service_role',
    'public.succeed_billing_card_recurrence_job(uuid,text,text,uuid,jsonb)',
    'execute'
  ),
  true,
  'only service_role can complete a recurrence job'
);
select is(
  has_function_privilege(
    'anon',
    'public.fail_billing_card_recurrence_job(uuid,text,uuid,text,text,integer)',
    'execute'
  ),
  false,
  'anon cannot reschedule or dead-letter a recurrence job'
);
select is(
  has_function_privilege(
    'service_role',
    'public.fail_billing_card_recurrence_job(uuid,text,uuid,text,text,integer)',
    'execute'
  ),
  true,
  'only service_role can reschedule or dead-letter a recurrence job'
);

select is(
  has_table_privilege('authenticated', 'public.legal_consents', 'insert'),
  false,
  'authenticated browsers cannot forge legal consent evidence'
);
select is(
  has_table_privilege('authenticated', 'public.legal_consents', 'update'),
  false,
  'authenticated browsers cannot rewrite legal consent evidence'
);
select is(
  has_table_privilege('authenticated', 'public.legal_consents', 'delete'),
  false,
  'authenticated browsers cannot delete legal consent evidence'
);
select is(
  has_table_privilege('authenticated', 'public.legal_consents', 'select'),
  true,
  'authenticated users retain read access governed by own-row RLS'
);
select is(
  has_table_privilege('service_role', 'public.legal_consents', 'insert'),
  true,
  'trusted signup and invitation backends can append legal consent evidence'
);
select is(
  has_table_privilege('service_role', 'public.legal_consents', 'update')
    or has_table_privilege('service_role', 'public.legal_consents', 'delete'),
  false,
  'even service_role cannot mutate append-only legal consent evidence'
);
select is(
  (
    select count(*)::integer
    from pg_policy
    where polrelid = 'public.legal_consents'::regclass
      and polcmd in ('a', 'w', 'd')
  ),
  0,
  'legal consent RLS exposes no browser write policy'
);
select is(
  (
    select count(*)::integer
    from pg_policy
    where polrelid = 'public.legal_consents'::regclass
      and polcmd = 'r'
      and polname = 'users can read own legal consents'
  ),
  1,
  'the own-row legal consent SELECT policy remains installed'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name in (
        'billing_organization_checkout_card_attempt_limits',
        'billing_ip_card_attempt_limits',
        'billing_authenticated_org_card_attempt_limits',
        'billing_payment_card_attempt_limits'
      )
      and column_name in ('ip', 'raw_ip', 'client_ip', 'checkout_token')
  ),
  0,
  'limiter persistence contains neither raw IP nor raw checkout capability columns'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'private'
      and table_name = 'billing_card_recurrence_provisions'
      and column_name in (
        'provider_card_token',
        'remote_ip',
        'ip_address',
        'card_number',
        'pan',
        'cvv',
        'ccv'
      )
  ),
  0,
  'recurrence persistence has no plaintext token, raw IP, PAN or CVV columns'
);

select is(
  (
    select provolatile::text
    from pg_proc
    where oid = 'private.billing_payment_checkout_is_resolvable(uuid)'::regprocedure
  ),
  's',
  'backend resolvability predicate is stable for JOIN and WHERE use'
);
select is(
  has_function_privilege(
    'service_role',
    'private.billing_payment_checkout_is_resolvable(uuid)',
    'execute'
  ),
  false,
  'private resolvability predicate is unavailable through the Data API'
);
select is(
  private.billing_payment_checkout_is_actionable('DUNNING_REQUESTED'),
  true,
  'requested dunning remains payable'
);
select is(
  private.billing_payment_checkout_is_actionable('DUNNING_RECEIVED'),
  true,
  'received credit-bureau registration is not mistaken for payment'
);
select is(
  private.billing_payment_checkout_is_actionable('BANK_SLIP_CANCELLED'),
  true,
  'a cancelled boleto registration can be reissued internally'
);
select is(
  private.billing_payment_checkout_is_terminal('BANK_SLIP_CANCELLED'),
  false,
  'a cancelled boleto registration is not a deleted payment'
);
select is(
  private.billing_payment_checkout_is_terminal('REFUND_DENIED'),
  false,
  'a denied refund preserves the financially paid state and is not terminal'
);
select is(
  private.billing_payment_checkout_is_paid('REFUND_DENIED'),
  true,
  'a denied refund remains financially paid for receipt and access checks'
);
select is(
  private.billing_payment_checkout_is_terminal('REPROVED_BY_RISK_ANALYSIS'),
  true,
  'a payment rejected by risk analysis is terminal and non-payable'
);

insert into public.admin_subscription_plans (
  id,
  name,
  slug,
  price,
  payment_grace_days,
  modules
)
values (
  'd8100000-0000-4000-8000-000000000001',
  'Capability fixture plan',
  'capability-fixture-plan',
  297,
  5,
  array[]::text[]
);

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  subscription_billing_period_months,
  asaas_customer_id
)
values
  (
    'd8200000-0000-4000-8000-000000000001',
    'Capability intent and legacy fixture',
    'capability-intent-legacy-fixture',
    'd8100000-0000-4000-8000-000000000001',
    null,
    'paid',
    'active',
    1,
    'cus_capability_primary'
  ),
  (
    'd8200000-0000-4000-8000-000000000002',
    'Capability subscription fixture',
    'capability-subscription-fixture',
    'd8100000-0000-4000-8000-000000000001',
    null,
    'paid',
    'active',
    1,
    'cus_capability_subscription'
  ),
  (
    'd8200000-0000-4000-8000-000000000003',
    'Capability ambiguous subscription fixture',
    'capability-ambiguous-subscription-fixture',
    'd8100000-0000-4000-8000-000000000001',
    null,
    'paid',
    'active',
    1,
    'cus_capability_ambiguous'
  ),
  (
    'd8200000-0000-4000-8000-000000000004',
    'Capability boleto fixture',
    'capability-boleto-fixture',
    'd8100000-0000-4000-8000-000000000001',
    null,
    'paid',
    'active',
    1,
    'cus_capability_boleto'
  ),
  (
    'd8200000-0000-4000-8000-000000000005',
    'Capability method change fixture',
    'capability-method-change-fixture',
    'd8100000-0000-4000-8000-000000000001',
    null,
    'paid',
    'overdue',
    1,
    'cus_capability_method_change'
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
values
  (
    '00000000-0000-0000-0000-000000000000',
    'd8500000-0000-4000-8000-000000000001',
    'authenticated',
    'authenticated',
    'billing-admin-capability@example.test',
    crypt('test-password', gen_salt('bf', 4)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd8500000-0000-4000-8000-000000000002',
    'authenticated',
    'authenticated',
    'billing-override-capability@example.test',
    crypt('test-password', gen_salt('bf', 4)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    'd8500000-0000-4000-8000-000000000003',
    'authenticated',
    'authenticated',
    'billing-denied-capability@example.test',
    crypt('test-password', gen_salt('bf', 4)),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

insert into public.users (
  id,
  organization_id,
  name,
  email,
  role,
  is_active
)
values
  (
    'd8500000-0000-4000-8000-000000000001',
    'd8200000-0000-4000-8000-000000000001',
    'Billing Admin Capability',
    'billing-admin-capability@example.test',
    'admin',
    true
  ),
  (
    'd8500000-0000-4000-8000-000000000002',
    'd8200000-0000-4000-8000-000000000001',
    'Billing Override Capability',
    'billing-override-capability@example.test',
    'user',
    true
  ),
  (
    'd8500000-0000-4000-8000-000000000003',
    'd8200000-0000-4000-8000-000000000001',
    'Billing Denied Capability',
    'billing-denied-capability@example.test',
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
  organization_id,
  user_id,
  role,
  is_active
)
values
  (
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000001',
    'admin',
    true
  ),
  (
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000002',
    'user',
    true
  ),
  (
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000003',
    'manager',
    true
  )
on conflict (user_id, organization_id) do update
set role = excluded.role,
    is_active = excluded.is_active;

select is(
  (
    select role
    from public.organization_members
    where organization_id = 'd8200000-0000-4000-8000-000000000001'
      and user_id = 'd8500000-0000-4000-8000-000000000003'
  ),
  'manager',
  'organization membership preserves a canonical manager invitation role'
);

insert into public.user_permission_overrides (
  organization_id,
  user_id,
  permission_key,
  allowed
)
values (
  'd8200000-0000-4000-8000-000000000001',
  'd8500000-0000-4000-8000-000000000002',
  'settings_billing',
  true
);

insert into public.organization_checkout_capabilities (
  organization_id,
  checkout_token
)
values
  (
    'd8200000-0000-4000-8000-000000000001',
    repeat('1', 32)
  ),
  (
    'd8200000-0000-4000-8000-000000000002',
    repeat('3', 32)
  )
on conflict (organization_id) do update
set checkout_token = excluded.checkout_token;

select is(
  public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000001',
    '203.0.113.20'
  ) ->> 'outcome',
  'invalid_input',
  'authenticated card limiter rejects raw IP input'
);
select is(
  public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000003',
    repeat('6', 64)
  ) ->> 'outcome',
  'unauthorized',
  'an active member without billing authorization cannot claim a card attempt'
);
select is(
  public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000002',
    repeat('7', 64)
  ) ->> 'outcome',
  'claimed',
  'an explicit settings_billing override authorizes the tokenless settings flow'
);
select is(
  public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000001',
    repeat('c', 64)
  ) ->> 'outcome',
  'claimed',
  'an active organization admin can claim a tokenless card attempt'
);

do $authenticated_attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_authenticated_organization_card_attempt(
      'd8200000-0000-4000-8000-000000000001',
      'd8500000-0000-4000-8000-000000000001',
      repeat('c', 64)
    );
  end loop;
end
$authenticated_attempts$;

select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'organization_actor',
  'the sixth authenticated attempt is denied before any provider mutation'
)
from (
  select public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000001',
    repeat('c', 64)
  ) as result
) as claim;
select ok(
  (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_authenticated_org_card_attempt_limits
    where organization_id = 'd8200000-0000-4000-8000-000000000001'
      and actor_user_id = 'd8500000-0000-4000-8000-000000000001'
  ) and (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_ip_card_attempt_limits
    where ip_fingerprint = repeat('c', 64)
  ),
  'authenticated allowed and refused attempts remain counted in both dimensions'
);
select is(
  public.claim_authenticated_organization_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    'd8500000-0000-4000-8000-000000000001',
    repeat('d', 64)
  ) ->> 'limit_scope',
  'organization_actor',
  'rotating HMAC-IP cannot bypass the organization/actor budget'
);

do $shared_ip_attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_organization_checkout_card_attempt(
      'd8200000-0000-4000-8000-000000000002',
      repeat('3', 32),
      repeat('c', 64)
    );
  end loop;
end
$shared_ip_attempts$;

select is(
  public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000002',
    repeat('3', 32),
    repeat('c', 64)
  ) ->> 'limit_scope',
  'ip',
  'the HMAC-IP budget is shared between authenticated and public card flows'
);

select is(
  public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('1', 32),
    '203.0.113.10'
  ) ->> 'outcome',
  'invalid_input',
  'raw IP input is rejected instead of being persisted'
);
select is(
  public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('f', 32),
    repeat('a', 64)
  ) ->> 'outcome',
  'capability_not_found',
  'an invalid organization capability cannot create a limiter bucket'
);
select is(
  public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('1', 32),
    repeat('a', 64)
  ) ->> 'outcome',
  'claimed',
  'the first exact capability and HMAC-IP card attempt is claimed'
);

do $attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_organization_checkout_card_attempt(
      'd8200000-0000-4000-8000-000000000001',
      repeat('1', 32),
      repeat('a', 64)
    );
  end loop;
end
$attempts$;

select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'capability'
    and (result ->> 'retry_after_seconds')::integer > 0,
  'sixth capability attempt is durably denied before a provider POST'
)
from (
  select public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('1', 32),
    repeat('a', 64)
  ) as result
) as claim;

select ok(
  (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_organization_checkout_card_attempt_limits
    where organization_id = 'd8200000-0000-4000-8000-000000000001'
      and capability_hash = encode(
        extensions.digest(repeat('1', 32), 'sha256'),
        'hex'
      )
  ) and (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_ip_card_attempt_limits
    where ip_fingerprint = repeat('a', 64)
  ),
  'allowed and refused attempts remain counted in both independent dimensions'
);

select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'capability',
  'rotating the caller IP cannot bypass the organization capability limit'
)
from (
  select public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('1', 32),
    repeat('b', 64)
  ) as result
) as claim;

update public.organization_checkout_capabilities
set
  checkout_token = repeat('2', 32),
  rotated_at = now()
where organization_id = 'd8200000-0000-4000-8000-000000000001';

do $attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_organization_checkout_card_attempt(
      'd8200000-0000-4000-8000-000000000001',
      repeat('2', 32),
      repeat('a', 64)
    );
  end loop;
end
$attempts$;

select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'ip',
  'rotating the public capability cannot bypass the independent HMAC-IP limit'
)
from (
  select public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000001',
    repeat('2', 32),
    repeat('a', 64)
  ) as result
) as claim;

select ok(
  (
    select short_window_count = 7
    from private.billing_organization_checkout_card_attempt_limits
    where organization_id = 'd8200000-0000-4000-8000-000000000001'
      and capability_hash = encode(
        extensions.digest(repeat('1', 32), 'sha256'),
        'hex'
      )
  ) and (
    select short_window_count = 5
    from private.billing_organization_checkout_card_attempt_limits
    where organization_id = 'd8200000-0000-4000-8000-000000000001'
      and capability_hash = encode(
        extensions.digest(repeat('2', 32), 'sha256'),
        'hex'
      )
  ) and (
    select short_window_count = 11
    from private.billing_ip_card_attempt_limits
    where ip_fingerprint = repeat('a', 64)
  ),
  'denied attempts and rotated capability buckets cannot erase prior counters'
);

insert into private.billing_organization_checkout_card_attempt_limits (
  organization_id,
  capability_hash,
  short_window_started_at,
  short_window_count,
  daily_window_started_at,
  daily_window_count,
  last_attempt_at,
  expires_at
)
values (
  'd8200000-0000-4000-8000-000000000001',
  repeat('f', 64),
  now() - interval '3 days',
  1,
  now() - interval '3 days',
  1,
  now() - interval '2 days',
  now() - interval '1 day'
);
insert into private.billing_ip_card_attempt_limits (
  ip_fingerprint,
  short_window_started_at,
  short_window_count,
  daily_window_started_at,
  daily_window_count,
  last_attempt_at,
  expires_at
)
values (
  repeat('e', 64),
  now() - interval '3 days',
  1,
  now() - interval '3 days',
  1,
  now() - interval '2 days',
  now() - interval '1 day'
);
insert into public.organization_checkout_capabilities (
  organization_id,
  checkout_token
)
values (
  'd8200000-0000-4000-8000-000000000002',
  repeat('3', 32)
)
on conflict (organization_id) do update
set checkout_token = excluded.checkout_token;

do $cleanup$
begin
  perform public.claim_organization_checkout_card_attempt(
    'd8200000-0000-4000-8000-000000000002',
    repeat('3', 32),
    repeat('d', 64)
  );
end
$cleanup$;

select is(
  (
    select count(*)::integer
    from (
      select 1
      from private.billing_organization_checkout_card_attempt_limits
      where capability_hash = repeat('f', 64)
      union all
      select 1
      from private.billing_ip_card_attempt_limits
      where ip_fingerprint = repeat('e', 64)
    ) as expired
  ),
  0,
  'bounded claim cleanup removes expired limiter buckets from both dimensions'
);

insert into public.subscriptions (
  organization_id,
  plan_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id,
  billing_period_months
)
values
  (
    'd8200000-0000-4000-8000-000000000002',
    'd8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_capability_subscription',
    'sub_capability_exact',
    1
  ),
  (
    'd8200000-0000-4000-8000-000000000003',
    'd8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_capability_ambiguous',
    'sub_capability_ambiguous',
    1
  ),
  (
    'd8200000-0000-4000-8000-000000000003',
    'd8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_capability_ambiguous',
    'sub_capability_ambiguous',
    1
  );

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  subscription_billing_period_months,
  asaas_customer_id
)
values (
  'd8200000-0000-4000-8000-000000000006',
  'Capability recurrence queue fixture',
  'capability-recurrence-queue-fixture',
  'd8100000-0000-4000-8000-000000000001',
  null,
  'paid',
  'active',
  1,
  'cus_capability_queue'
);

insert into private.billing_checkout_intents (
  id,
  organization_id,
  pending_plan_id,
  amount,
  billing_cycle,
  billing_period_months,
  billing_method,
  status,
  external_reference,
  provider_customer_id,
  provider_payment_id,
  provider_response,
  provider_registered_at
)
values
  (
    'd8300000-0000-4000-8000-000000000001',
    'd8200000-0000-4000-8000-000000000001',
    'd8100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'pending',
    'd8300000-0000-4000-8000-000000000001',
    'cus_capability_primary',
    'pay_capability_dunning',
    '{}'::jsonb,
    now()
  ),
  (
    'd8300000-0000-4000-8000-000000000002',
    'd8200000-0000-4000-8000-000000000004',
    'd8100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'BOLETO',
    'pending',
    'd8300000-0000-4000-8000-000000000002',
    'cus_capability_boleto',
    'pay_capability_bank_cancelled',
    '{}'::jsonb,
    now()
  ),
  (
    'd8300000-0000-4000-8000-000000000003',
    'd8200000-0000-4000-8000-000000000005',
    'd8100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'BOLETO',
    'pending',
    'd8300000-0000-4000-8000-000000000003',
    'cus_capability_method_change',
    'pay_capability_method_change',
    '{}'::jsonb,
    now()
  ),
  (
    'd8300000-0000-4000-8000-000000000004',
    'd8200000-0000-4000-8000-000000000006',
    'd8100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'confirmed',
    'd8300000-0000-4000-8000-000000000004',
    'cus_capability_queue',
    'pay_capability_queue',
    '{}'::jsonb,
    now()
  );

insert into public.asaas_payments (
  id,
  organization_id,
  billing_intent_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  raw_event,
  last_webhook_event_id,
  last_webhook_event_at
)
values
  (
    'd8400000-0000-4000-8000-000000000001',
    'd8200000-0000-4000-8000-000000000001',
    'd8300000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    'cus_capability_primary',
    null,
    'DUNNING_RECEIVED',
    'CREDIT_CARD',
    297,
    '2026-09-10',
    '{}'::jsonb,
    'evt_capability_dunning',
    '2026-08-04 12:00:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000002',
    'd8200000-0000-4000-8000-000000000004',
    'd8300000-0000-4000-8000-000000000002',
    'pay_capability_bank_cancelled',
    'cus_capability_boleto',
    null,
    'OVERDUE',
    'BOLETO',
    297,
    '2026-09-10',
    jsonb_build_object('event', 'PAYMENT_BANK_SLIP_CANCELLED'),
    'evt_capability_bank_cancelled',
    '2026-08-04 12:05:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000003',
    'd8200000-0000-4000-8000-000000000001',
    null,
    'pay_capability_legacy',
    'cus_capability_primary',
    null,
    'PENDING',
    'PIX',
    297,
    '2026-09-10',
    '{}'::jsonb,
    'evt_capability_legacy',
    '2026-08-04 12:10:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000004',
    'd8200000-0000-4000-8000-000000000001',
    null,
    'pay_capability_legacy_bad_amount',
    'cus_capability_primary',
    null,
    'PENDING',
    'PIX',
    298,
    '2026-09-10',
    '{}'::jsonb,
    'evt_capability_legacy_bad_amount',
    '2026-08-04 12:15:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000005',
    'd8200000-0000-4000-8000-000000000002',
    null,
    'pay_capability_subscription',
    'cus_capability_subscription',
    'sub_capability_exact',
    'PENDING',
    'PIX',
    297,
    '2026-09-10',
    '{}'::jsonb,
    'evt_capability_subscription',
    '2026-08-04 12:20:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000006',
    'd8200000-0000-4000-8000-000000000003',
    null,
    'pay_capability_subscription_ambiguous',
    'cus_capability_ambiguous',
    'sub_capability_ambiguous',
    'PENDING',
    'PIX',
    297,
    '2026-09-10',
    '{}'::jsonb,
    'evt_capability_subscription_ambiguous',
    '2026-08-04 12:25:00+00'
  ),
  (
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'PENDING',
    'BOLETO',
    297,
    '2026-09-15',
    '{}'::jsonb,
    'evt_capability_method_change',
    now() - interval '10 minutes'
  ),
  (
    'e8400000-0000-4000-8000-000000000008',
    'd8200000-0000-4000-8000-000000000006',
    'd8300000-0000-4000-8000-000000000004',
    'pay_capability_queue',
    'cus_capability_queue',
    null,
    'CONFIRMED',
    'CREDIT_CARD',
    297,
    '2026-09-20',
    '{}'::jsonb,
    'evt_capability_queue',
    now() - interval '5 minutes'
  );

select is(
  (
    select count(*)::integer
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  1,
  'DUNNING_RECEIVED gets one resolvable checkout capability'
);
select is(
  (
    select snapshot_source
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'intent',
  'intent-backed capability records immutable provenance'
);
select ok(
  (
    select expires_at >= now() + interval '89 days'
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'actionable checkout remains valid through early issue and overdue reminders'
);
select is(
  (
    select public.resolve_billing_payment_checkout_capability(checkout_token) ->> 'outcome'
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'resolved',
  'intent capability resolves from its frozen tuple'
);

select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_wrong',
    repeat('8', 64)
  ) ->> 'outcome',
  'payment_not_found',
  'payment guard requires the exact local and provider payment identity'
);
select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    '198.51.100.10'
  ) ->> 'outcome',
  'invalid_input',
  'payment guard rejects raw IP input'
);
select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    repeat('8', 64)
  ) ->> 'outcome',
  'claimed',
  'first exact payment and HMAC-IP attempt is claimed'
);

do $payment_attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_billing_payment_card_attempt_guard(
      'd8400000-0000-4000-8000-000000000001',
      'pay_capability_dunning',
      repeat('8', 64)
    );
  end loop;
end
$payment_attempts$;

select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'payment',
  'the sixth payment attempt is denied before the lease or provider POST'
)
from (
  select public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    repeat('8', 64)
  ) as result
) as claim;
select ok(
  (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_payment_card_attempt_limits
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ) and (
    select short_window_count = 6 and daily_window_count = 6
    from private.billing_ip_card_attempt_limits
    where ip_fingerprint = repeat('8', 64)
  ),
  'payment allowed and refused attempts remain counted in both dimensions'
);
select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    repeat('9', 64)
  ) ->> 'limit_scope',
  'payment',
  'rotating HMAC-IP cannot bypass the immutable payment budget'
);

do $payment_shared_ip_attempts$
begin
  for attempt_number in 1..4 loop
    perform public.claim_billing_payment_card_attempt_guard(
      'd8400000-0000-4000-8000-000000000002',
      'pay_capability_bank_cancelled',
      repeat('8', 64)
    );
  end loop;
end
$payment_shared_ip_attempts$;

select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000002',
    'pay_capability_bank_cancelled',
    repeat('8', 64)
  ) ->> 'limit_scope',
  'ip',
  'the global HMAC-IP budget is shared across payment capabilities'
);

update private.billing_payment_card_attempt_limits
set
  short_window_started_at = now() - interval '16 minutes',
  short_window_count = 5,
  daily_window_started_at = now() - interval '1 hour',
  daily_window_count = 9,
  last_attempt_at = now() - interval '16 minutes',
  expires_at = now() + interval '47 hours'
where payment_id = 'd8400000-0000-4000-8000-000000000001';

select is(
  public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    repeat('f', 64)
  ) ->> 'outcome',
  'claimed',
  'a reset short window cannot erase the tenth daily payment attempt'
);
select ok(
  result ->> 'outcome' = 'rate_limited'
    and result ->> 'limit_scope' = 'payment',
  'the eleventh daily payment attempt is denied after the short window reset'
)
from (
  select public.claim_billing_payment_card_attempt_guard(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    repeat('f', 64)
  ) as result
) as claim;

select ok(
  result ->> 'outcome' = 'amount_mismatch'
    and (
      select subscription_status = 'overdue'
      from public.organizations
      where id = 'd8200000-0000-4000-8000-000000000005'
    )
    and (
      select status = 'pending'
      from private.billing_checkout_intents
      where id = 'd8300000-0000-4000-8000-000000000003'
    )
    and (
      select status = 'PENDING'
      from public.asaas_payments
      where id = 'd8400000-0000-4000-8000-000000000007'
    ),
  'direct reconciliation rejects amount drift before subscription activation or intent confirmation'
)
from (
  select private.apply_asaas_billing_snapshot_with_payment(
    'd8200000-0000-4000-8000-000000000005',
    'cus_capability_method_change',
    null,
    'ACTIVE',
    'pay_capability_method_change',
    'CONFIRMED',
    298,
    '2026-09-15',
    '2026-10-15',
    now() - interval '9 minutes',
    'pgtap_exact_reconciliation'
  ) as result
) as exact_reconcile;

select is(
  public.prepare_billing_card_recurrence(
    'e8400000-0000-4000-8000-000000000008',
    'pay_capability_queue'
  ) ->> 'outcome',
  'prepared',
  'a paid card payment prepares one durable recurrence job tuple'
);
select is(
  public.store_billing_card_recurrence_credential(
    'e8400000-0000-4000-8000-000000000008',
    'pay_capability_queue',
    'v1.' || repeat('Q', 64),
    '8080'
  ) ->> 'outcome',
  'stored',
  'storing the sealed credential enqueues the paid recurrence job'
);
select ok(
  (
    select job_action = 'create'
      and job_status = 'pending'
      and provider_request_started_at is null
      and provider_card_credential = 'v1.' || repeat('Q', 64)
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ),
  'enqueueing does not synchronously start a provider mutation or clear its envelope'
);

create temporary table queue_claim_before_crash
on commit drop
as
select result
from public.claim_billing_card_recurrence_jobs(
  'queue-worker-before-crash',
  1,
  180
) as result
where result ->> 'payment_id' = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select result ->> 'outcome' = 'claimed'
      and result ->> 'action' = 'create'
      and result ->> 'mode' = 'create_or_recover'
      and result ->> 'customer_id' = 'cus_capability_queue'
      and not (result ? 'provider_customer_id')
      and result ->> 'provider_card_credential' = 'v1.' || repeat('Q', 64)
      and result ->> 'card_last4' = '8080'
    from queue_claim_before_crash
  ),
  'claim payload exposes the exact worker contract and no duplicate customer key'
);
select ok(
  (
    select job_status = 'processing'
      and provider_request_started_at is null
      and provider_card_credential = 'v1.' || repeat('Q', 64)
      and job_lease_id = (
        select (result ->> 'job_lease_id')::uuid
        from queue_claim_before_crash
      )
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ),
  'claim retains the sealed envelope and records no false provider-request evidence'
);

update private.billing_card_recurrence_provisions
set
  lease_expires_at = clock_timestamp() - interval '1 second',
  job_lock_expires_at = clock_timestamp() - interval '1 second'
where payment_id = 'e8400000-0000-4000-8000-000000000008';

create temporary table queue_claim_after_pre_post_crash
on commit drop
as
select result
from public.claim_billing_card_recurrence_jobs(
  'queue-worker-after-crash',
  1,
  180
) as result
where result ->> 'payment_id' = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select result ->> 'mode' = 'create_or_recover'
      and result ->> 'provider_card_credential' = 'v1.' || repeat('Q', 64)
      and result ->> 'customer_id' = 'cus_capability_queue'
    from queue_claim_after_pre_post_crash
  ),
  'an expired claim before POST remains safely creatable by the next lease'
);

update public.asaas_payments
set status = 'REFUND_REQUESTED'
where id = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select status = 'failed'
      and job_status = 'cancelled'
      and provider_card_credential is null
      and provider_request_started_at is null
      and job_lease_id is null
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ),
  'a reversal before the POST marker atomically closes the create lease'
);
select is(
  public.mark_billing_card_recurrence_provider_request_started(
    'e8400000-0000-4000-8000-000000000008',
    'queue-worker-after-crash',
    (
      select (result ->> 'job_lease_id')::uuid
      from queue_claim_after_pre_post_crash
    )
  ) ->> 'outcome',
  'lease_not_found',
  'the reversed pre-POST job cannot cross the provider mutation boundary'
);

update public.asaas_payments
set status = 'CONFIRMED'
where id = 'e8400000-0000-4000-8000-000000000008';

select is(
  public.store_billing_card_recurrence_credential(
    'e8400000-0000-4000-8000-000000000008',
    'pay_capability_queue',
    'v1.' || repeat('R', 64),
    '8181'
  ) ->> 'outcome',
  'stored',
  'a new paid attempt explicitly re-enqueues a credential after the closed race'
);

create temporary table queue_claim_before_post
on commit drop
as
select result
from public.claim_billing_card_recurrence_jobs(
  'queue-worker-before-post',
  1,
  180
) as result
where result ->> 'payment_id' = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select result ->> 'mode' = 'create_or_recover'
      and result ->> 'provider_card_credential' = 'v1.' || repeat('R', 64)
    from queue_claim_before_post
  ),
  'the fresh retry gets one create-capable lease and its sealed credential'
);
select is(
  public.mark_billing_card_recurrence_provider_request_started(
    'e8400000-0000-4000-8000-000000000008',
    'queue-worker-before-post',
    (
      select (result ->> 'job_lease_id')::uuid
      from queue_claim_before_post
    )
  ) ->> 'outcome',
  'started',
  'the exact lease persists provider POST evidence immediately before mutation'
);

update public.asaas_payments
set status = 'REFUND_REQUESTED'
where id = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select status = 'creating'
      and job_status = 'processing'
      and provider_request_started_at is not null
      and provider_card_credential = 'v1.' || repeat('R', 64)
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ),
  'a reversal after POST evidence preserves recovery state instead of replaying create'
);
select is(
  public.fail_billing_card_recurrence_job(
    'e8400000-0000-4000-8000-000000000008',
    'queue-worker-before-post',
    (
      select (result ->> 'job_lease_id')::uuid
      from queue_claim_before_post
    ),
    'ambiguous',
    'provider_create_ambiguous',
    30
  ) ->> 'outcome',
  'retry',
  'an ambiguous post-POST failure retains the exact tuple for recovery'
);

update private.billing_card_recurrence_provisions
set job_next_attempt_at = clock_timestamp() - interval '1 second'
where payment_id = 'e8400000-0000-4000-8000-000000000008';

create temporary table queue_recovery_claim
on commit drop
as
select result
from public.claim_billing_card_recurrence_jobs(
  'queue-worker-recovery',
  1,
  180
) as result
where result ->> 'payment_id' = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select result ->> 'mode' = 'recover_only'
      and result ->> 'provider_card_credential' is null
      and result ->> 'card_last4' is null
      and result ->> 'customer_id' = 'cus_capability_queue'
    from queue_recovery_claim
  ) and (
    select provider_card_credential = 'v1.' || repeat('R', 64)
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ),
  'post-POST retries are recovery-only while the encrypted envelope remains durable'
);

create temporary table queue_create_success
on commit drop
as
select public.succeed_billing_card_recurrence_job(
  'e8400000-0000-4000-8000-000000000008',
  'pay_capability_queue',
  'queue-worker-recovery',
  (
    select (result ->> 'job_lease_id')::uuid
    from queue_recovery_claim
  ),
  jsonb_build_object(
    'id', 'sub_capability_queue',
    'customer', 'cus_capability_queue',
    'externalReference',
      'vimob:billing-card-recurrence:e8400000-0000-4000-8000-000000000008',
    'value', 297,
    'cycle', 'MONTHLY',
    'nextDueDate', (
      select next_due_date
      from private.billing_card_recurrence_provisions
      where payment_id = 'e8400000-0000-4000-8000-000000000008'
    ),
    'billingType', 'CREDIT_CARD',
    'status', 'ACTIVE'
  )
) as result;

select ok(
  (
    select result ->> 'outcome' = 'completed'
      and (result ->> 'cancellation_queued')::boolean
    from queue_create_success
  ),
  'recovering the exact subscription links it and queues cancellation for the reversal'
);
select is(
  public.succeed_billing_card_recurrence_job(
    'e8400000-0000-4000-8000-000000000008',
    'pay_capability_queue',
    'queue-worker-recovery',
    (
      select (result ->> 'job_lease_id')::uuid
      from queue_recovery_claim
    ),
    jsonb_build_object(
      'id', 'sub_capability_queue',
      'customer', 'cus_capability_queue',
      'externalReference',
        'vimob:billing-card-recurrence:e8400000-0000-4000-8000-000000000008',
      'value', 297,
      'cycle', 'MONTHLY',
      'nextDueDate', (
        select next_due_date
        from private.billing_card_recurrence_provisions
        where payment_id = 'e8400000-0000-4000-8000-000000000008'
      ),
      'billingType', 'CREDIT_CARD',
      'status', 'ACTIVE'
    )
  ) ->> 'outcome',
  'already_completed',
  'a lost create-success response is idempotent after the lease is cleared'
);
select ok(
  (
    select status = 'completed'
      and job_action = 'cancel'
      and job_status = 'pending'
      and provider_subscription_id = 'sub_capability_queue'
      and provider_card_credential is null
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ) and (
    select asaas_subscription_id = 'sub_capability_queue'
    from public.organizations
    where id = 'd8200000-0000-4000-8000-000000000006'
  ),
  'completion clears the envelope and exposes exactly one cancellation job'
);

create temporary table queue_cancel_claim
on commit drop
as
select result
from public.claim_billing_card_recurrence_jobs(
  'queue-worker-cancel',
  1,
  180
) as result
where result ->> 'payment_id' = 'e8400000-0000-4000-8000-000000000008';

select ok(
  (
    select result ->> 'action' = 'cancel'
      and result ->> 'mode' = 'cancel'
      and result ->> 'provider_subscription_id' = 'sub_capability_queue'
      and result ->> 'provider_card_credential' is null
    from queue_cancel_claim
  ),
  'cancellation claim contains only the exact non-sensitive provider target'
);

create temporary table queue_cancel_success
on commit drop
as
select public.succeed_billing_card_recurrence_job(
  'e8400000-0000-4000-8000-000000000008',
  'pay_capability_queue',
  'queue-worker-cancel',
  (
    select (result ->> 'job_lease_id')::uuid
    from queue_cancel_claim
  ),
  jsonb_build_object(
    'subscription_id', 'sub_capability_queue',
    'outcome', 'deleted'
  )
) as result;

select ok(
  (
    select result ->> 'outcome' = 'cancelled'
    from queue_cancel_success
  ) and (
    select status = 'cancelled'
      and job_status = 'succeeded'
      and provider_cancelled_at is not null
    from private.billing_card_recurrence_provisions
    where payment_id = 'e8400000-0000-4000-8000-000000000008'
  ) and (
    select asaas_subscription_id is null
    from public.organizations
    where id = 'd8200000-0000-4000-8000-000000000006'
  ),
  'provider cancellation success closes the job and removes the active organization link'
);
select is(
  public.succeed_billing_card_recurrence_job(
    'e8400000-0000-4000-8000-000000000008',
    'pay_capability_queue',
    'queue-worker-cancel',
    (
      select (result ->> 'job_lease_id')::uuid
      from queue_cancel_claim
    ),
    jsonb_build_object(
      'subscription_id', 'sub_capability_queue',
      'outcome', 'deleted'
    )
  ) ->> 'outcome',
  'already_succeeded',
  'a lost cancellation-success response is idempotent after lease cleanup'
);

select ok(
  result ->> 'outcome' = 'identifier_mismatch'
    and result ->> 'field' = 'organization',
  'payment method change rejects a wrong tenant before applying provider state'
)
from (
  select public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000001',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    297,
    'BOLETO',
    'PENDING',
    '2026-09-15',
    'PIX',
    'PENDING',
    '2026-09-16',
    now() - interval '8 minutes'
  ) as result
) as wrong_tenant;
select is(
  public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    298,
    'BOLETO',
    'PENDING',
    '2026-09-15',
    'PIX',
    'PENDING',
    '2026-09-16',
    now() - interval '8 minutes'
  ) ->> 'outcome',
  'amount_mismatch',
  'payment method change rejects provider amount drift'
);
select is(
  public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    297,
    'BOLETO',
    'PENDING',
    '2026-09-15',
    'PIX',
    'PENDING',
    '2026-09-16',
    now() - interval '8 minutes'
  ) ->> 'outcome',
  'updated',
  'exact BOLETO to PIX provider transition is applied atomically'
);
select is(
  public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    297,
    'BOLETO',
    'PENDING',
    '2026-09-15',
    'PIX',
    'PENDING',
    '2026-09-16',
    now() - interval '8 minutes'
  ) ->> 'outcome',
  'already_updated',
  'replaying the complete PIX snapshot is idempotent'
);
select is(
  public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    297,
    'BOLETO',
    'PENDING',
    '2026-09-15',
    'PIX',
    'PENDING',
    '2026-09-16',
    now() - interval '9 minutes'
  ) ->> 'outcome',
  'already_updated',
  'a delayed replay of the complete applied snapshot remains idempotent'
);
select ok(
  (
    select billing_type = 'PIX'
      and status = 'PENDING'
      and due_date = '2026-09-16'
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000007'
  ),
  'BOLETO to PIX persists method, status and due date together'
);
select is(
  public.reconcile_asaas_payment_method_change(
    'd8400000-0000-4000-8000-000000000007',
    'd8200000-0000-4000-8000-000000000005',
    'd8300000-0000-4000-8000-000000000003',
    'pay_capability_method_change',
    'cus_capability_method_change',
    null,
    'd8300000-0000-4000-8000-000000000003',
    297,
    'PIX',
    'PENDING',
    '2026-09-16',
    'CREDIT_CARD',
    'CONFIRMED',
    '2026-09-16',
    now() - interval '7 minutes'
  ) ->> 'outcome',
  'updated',
  'exact PIX to CREDIT_CARD accepts an immediately paid provider response'
);
select ok(
  (
    select billing_type = 'CREDIT_CARD'
      and status = 'CONFIRMED'
      and due_date = '2026-09-16'
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000007'
  ) and (
    select status = 'confirmed'
    from private.billing_checkout_intents
    where id = 'd8300000-0000-4000-8000-000000000003'
  ),
  'PIX to CREDIT_CARD persists the paid payment and confirms only its exact intent'
);
select is(
  public.prepare_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change'
  ) ->> 'outcome',
  'prepared',
  'paid method-change payment prepares its future recurrence tuple'
);
select is(
  (
    public.prepare_billing_card_recurrence(
      'd8400000-0000-4000-8000-000000000007',
      'pay_capability_method_change'
    ) ->> 'credential_stored'
  )::boolean,
  false,
  'prepare reports that no sealed recurrence credential exists yet'
);
select is(
  public.store_billing_card_recurrence_credential(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change',
    'v1.' || repeat('B', 64),
    '1111'
  ) ->> 'outcome',
  'stored',
  'paid payment stores one sealed recurrence credential before creation'
);
select is(
  (
    public.prepare_billing_card_recurrence(
      'd8400000-0000-4000-8000-000000000007',
      'pay_capability_method_change'
    ) ->> 'credential_stored'
  )::boolean,
  true,
  'prepare preserves and reports an existing sealed credential after an ambiguous retry'
);

create temporary table method_recurrence_claim
on commit drop
as
select public.claim_billing_card_recurrence_by_provider_payment(
  'pay_capability_method_change'
) as result;

select ok(
  (
    select result ->> 'outcome' = 'claimed'
      and result ->> 'payment_id' = 'd8400000-0000-4000-8000-000000000007'
      and result ->> 'provider_card_credential' = 'v1.' || repeat('B', 64)
      and result ->> 'card_last4' = '1111'
      and result ->> 'action' = 'create_or_recover'
    from method_recurrence_claim
  ),
  'paid webhook claim releases only the sealed credential to service_role'
);
select ok(
  (
    select status = 'creating'
      and provider_card_credential is null
      and card_last4 is null
      and lease_id is not null
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000007'
  ),
  'claim atomically deletes the sealed credential from persistent storage'
);
select ok(
  result ->> 'outcome' = 'busy'
    and result ->> 'payment_id' = 'd8400000-0000-4000-8000-000000000007',
  'provider-payment claim keeps the local payment id on a busy replay'
)
from (
  select public.claim_billing_card_recurrence_by_provider_payment(
    'pay_capability_method_change'
  ) as result
) as busy_claim;
select is(
  public.fail_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change',
    (
      select (result ->> 'lease_id')::uuid
      from method_recurrence_claim
    ),
    'provider_subscription_create_rejected'
  ) ->> 'outcome',
  'failed',
  'a deterministic recurrence create failure closes the exact one-time claim'
);
select is(
  public.store_billing_card_recurrence_credential(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change',
    'v1.' || repeat('C', 64),
    '2222'
  ) ->> 'outcome',
  'stored',
  'an explicit paid retry can store a new sealed credential after failure'
);

update public.asaas_payments
set status = 'REPROVED_BY_RISK_ANALYSIS'
where id = 'd8400000-0000-4000-8000-000000000007';

select ok(
  (
    select status = 'failed'
      and provider_card_credential is null
      and card_last4 is null
      and last_error = 'payment_not_paid_terminal'
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000007'
  ),
  'terminal non-payment atomically destroys any unconsumed sealed credential'
);

-- A card token may already be sealed when the payer changes the same invoice
-- to Pix. The winning non-card provider snapshot must destroy that token and
-- close its future-subscription job in the same local transaction.
update public.asaas_payments
set
  status = 'PENDING',
  billing_type = 'CREDIT_CARD',
  due_date = '2026-09-18',
  last_provider_observed_at = now() - interval '1 minute'
where id = 'd8400000-0000-4000-8000-000000000007';

do $prepare_abandoned_card_recurrence$
begin
  perform public.prepare_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change'
  );
end
$prepare_abandoned_card_recurrence$;

create temporary table abandoned_card_attempt
on commit drop
as
select public.claim_billing_payment_checkout_attempt(
  'd8400000-0000-4000-8000-000000000007',
  'pay_capability_method_change'
) as result;

create temporary table abandoned_card_credential
on commit drop
as
select public.store_billing_card_recurrence_credential(
  'd8400000-0000-4000-8000-000000000007',
  'pay_capability_method_change',
  (select (result ->> 'lease_id')::uuid from abandoned_card_attempt),
  'v1.' || repeat('D', 64),
  '3333'
) as result;

create temporary table abandoned_card_method_change
on commit drop
as
select public.reconcile_asaas_payment_method_change(
  'd8400000-0000-4000-8000-000000000007',
  'd8200000-0000-4000-8000-000000000005',
  'd8300000-0000-4000-8000-000000000003',
  'pay_capability_method_change',
  'cus_capability_method_change',
  null,
  'd8300000-0000-4000-8000-000000000003',
  297,
  'CREDIT_CARD',
  'PENDING',
  '2026-09-18',
  'PIX',
  'CONFIRMED',
  '2026-09-18',
  clock_timestamp()
) as result;

select ok(
  (
    select result ->> 'outcome' = 'stored'
    from abandoned_card_credential
  ) and (
    select result ->> 'outcome' = 'updated'
    from abandoned_card_method_change
  ) and (
    select billing_type = 'PIX' and status = 'CONFIRMED'
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000007'
  ) and (
    select status = 'failed'
      and provider_card_credential is null
      and card_last4 is null
      and job_status = 'cancelled'
      and job_locked_at is null
      and job_lock_expires_at is null
      and job_locked_by is null
      and job_lease_id is null
      and last_error = 'payment_method_changed_non_card'
      and job_last_error_code = 'payment_method_changed_non_card'
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000007'
  ),
  'sealed card credential plus PIX confirmation leaves no recurrence credential or runnable job'
);

-- The inverse transition must not lose the recurrence job: Edge seals the
-- credential before Asaas accepts payWithCreditCard. This fixture stores the
-- recurrence token while the preceding payment snapshot is still paid; the
-- provider transition to PENDING is then reconciled as the new card attempt.

do $prepare_winning_card_recurrence$
begin
  perform public.prepare_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000007',
    'pay_capability_method_change'
  );
end
$prepare_winning_card_recurrence$;

create temporary table winning_card_credential
on commit drop
as
select public.store_billing_card_recurrence_credential(
  'd8400000-0000-4000-8000-000000000007',
  'pay_capability_method_change',
  'v1.' || repeat('E', 64),
  '4444'
) as result;

update public.asaas_payments
set
  status = 'PENDING',
  due_date = '2026-09-19',
  last_provider_observed_at = now() - interval '1 minute'
where id = 'd8400000-0000-4000-8000-000000000007';

create temporary table winning_card_method_change
on commit drop
as
select public.reconcile_asaas_payment_method_change(
  'd8400000-0000-4000-8000-000000000007',
  'd8200000-0000-4000-8000-000000000005',
  'd8300000-0000-4000-8000-000000000003',
  'pay_capability_method_change',
  'cus_capability_method_change',
  null,
  'd8300000-0000-4000-8000-000000000003',
  297,
  'PIX',
  'PENDING',
  '2026-09-19',
  'CREDIT_CARD',
  'CONFIRMED',
  '2026-09-19',
  clock_timestamp()
) as result;

select ok(
  (
    select result ->> 'outcome' = 'stored'
    from winning_card_credential
  ) and (
    select result ->> 'outcome' = 'updated'
    from winning_card_method_change
  ) and (
    select billing_type = 'CREDIT_CARD' and status = 'CONFIRMED'
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000007'
  ) and (
    select status = 'prepared'
      and provider_card_credential = 'v1.' || repeat('E', 64)
      and card_last4 = '4444'
      and job_action = 'create'
      and job_status = 'pending'
      and job_locked_at is null
      and job_lock_expires_at is null
      and job_locked_by is null
      and job_lease_id is null
      and last_error is null
      and job_last_error_code is null
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000007'
  ),
  'sealed PIX to CREDIT_CARD confirmation exposes exactly one runnable recurrence job'
);

select is(
  public.prepare_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning'
  ) ->> 'outcome',
  'prepared',
  'card recurrence is durably prepared for the exact payment'
);
select is(
  (
    select public.resolve_billing_payment_checkout_capability(checkout_token)
      ->> 'card_recurrence_status'
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'prepared',
  'resolver exposes only the sanitized recurrence status'
);

create temporary table dunning_capture_attempt
on commit drop
as
select public.claim_billing_payment_checkout_attempt(
  'd8400000-0000-4000-8000-000000000001',
  'pay_capability_dunning'
) as result;

select is(
  public.store_billing_card_recurrence_credential(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    (select (result ->> 'lease_id')::uuid from dunning_capture_attempt),
    'tok_live_plaintext_must_be_rejected',
    '4242'
  ) ->> 'outcome',
  'invalid_input',
  'SQL rejects a plaintext provider token instead of persisting it'
);
select is(
  public.store_billing_card_recurrence_credential(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    (select (result ->> 'lease_id')::uuid from dunning_capture_attempt),
    'v1.' || repeat('A', 64),
    '4242'
  ) ->> 'outcome',
  'stored',
  'an exact prepared recurrence accepts one opaque Edge-sealed credential'
);
select is(
  public.store_billing_card_recurrence_credential(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning',
    (select (result ->> 'lease_id')::uuid from dunning_capture_attempt),
    'v1.' || repeat('A', 64),
    '4242'
  ) ->> 'outcome',
  'already_stored',
  'storing the identical sealed credential is idempotent'
);
select is(
  public.claim_billing_card_recurrence_by_provider_payment(
    'pay_capability_dunning'
  ) ->> 'outcome',
  'payment_not_paid',
  'processing or actionable payment cannot release its recurrence credential'
);
select ok(
  (
    select provider_card_credential = 'v1.' || repeat('A', 64)
      and card_last4 = '4242'
      and status = 'prepared'
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'sealed credential remains private while the payment is not paid'
);

create temporary table capability_polling_baseline
on commit drop
as
select checkout_token, expires_at
from public.billing_payment_checkout_capabilities
where payment_id = 'd8400000-0000-4000-8000-000000000001';

update public.asaas_payments
set
  status = 'DUNNING_RECEIVED',
  last_provider_observed_at = '2026-08-04 12:01:00+00'
where id = 'd8400000-0000-4000-8000-000000000001';

update public.asaas_payments
set
  status = 'DUNNING_RECEIVED',
  last_provider_observed_at = '2026-08-04 12:02:00+00'
where id = 'd8400000-0000-4000-8000-000000000001';

select ok(
  (
    select capability.checkout_token = baseline.checkout_token
      and capability.expires_at = baseline.expires_at
      and capability.revoked_at is null
    from public.billing_payment_checkout_capabilities as capability
    cross join capability_polling_baseline as baseline
    where capability.payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'repeated polling with the same actionable status never slides the bearer lifetime'
);

update public.billing_payment_checkout_capabilities
set
  created_at = now() - interval '100 days',
  expires_at = now() - interval '1 day',
  revoked_at = now()
where payment_id = 'd8400000-0000-4000-8000-000000000001';

update public.asaas_payments
set
  status = 'DUNNING_RECEIVED',
  last_provider_observed_at = '2026-08-04 12:03:00+00'
where id = 'd8400000-0000-4000-8000-000000000001';

select ok(
  (
    select capability.checkout_token = baseline.checkout_token
      and capability.expires_at < now()
      and capability.revoked_at is not null
    from public.billing_payment_checkout_capabilities as capability
    cross join capability_polling_baseline as baseline
    where capability.payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'same-status polling never reactivates an expired or revoked bearer'
);

select is(
  public.fail_prepared_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning'
  ) ->> 'outcome',
  'failed',
  'an exact prepared recurrence without a lease is terminalized fail-closed'
);
select ok(
  (
    select status = 'failed'
      and lease_id is null
      and lease_expires_at is null
      and provider_card_credential is null
      and card_last4 is null
      and failed_at is not null
      and last_error = 'prepared_recurrence_not_created'
    from private.billing_card_recurrence_provisions
    where payment_id = 'd8400000-0000-4000-8000-000000000001'
  ),
  'prepared recurrence terminalization persists only a constant non-sensitive reason'
);
select is(
  public.fail_prepared_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning'
  ) ->> 'outcome',
  'already_failed',
  'prepared recurrence terminalization is idempotent after failure'
);

update private.billing_card_recurrence_provisions
set
  status = 'completed',
  provider_subscription_id = 'sub_capability_already_completed',
  completed_at = now(),
  failed_at = null,
  last_error = null
where payment_id = 'd8400000-0000-4000-8000-000000000001';

select is(
  public.get_billing_card_recurrence_reversal_target(
    'pay_capability_dunning'
  ) ->> 'outcome',
  'payment_not_reversed',
  'an active completed recurrence cannot be exposed as a cancellation target'
);

update public.asaas_payments
set status = 'REFUND_REQUESTED'
where id = 'd8400000-0000-4000-8000-000000000001';

select ok(
  result ->> 'outcome' = 'target'
    and result ->> 'payment_id' = 'd8400000-0000-4000-8000-000000000001'
    and result ->> 'provider_payment_id' = 'pay_capability_dunning'
    and result ->> 'provider_subscription_id' = 'sub_capability_already_completed'
    and result ->> 'provider_customer_id' = 'cus_capability_primary'
    and result ->> 'external_reference'
      = 'vimob:billing-card-recurrence:d8400000-0000-4000-8000-000000000001'
    and (result ->> 'amount')::numeric = 297
    and (result ->> 'billing_period_months')::integer = 1
    and (result ->> 'next_due_date')::date = (
      select next_due_date
      from private.billing_card_recurrence_provisions
      where payment_id = 'd8400000-0000-4000-8000-000000000001'
    )
    and result ->> 'payment_status' = 'REFUND_REQUESTED',
  'a reversed initial payment exposes only its exact completed recurrence target'
)
from (
  select public.get_billing_card_recurrence_reversal_target(
    'pay_capability_dunning'
  ) as result
) as reversal_target;

select is(
  public.get_billing_card_recurrence_reversal_target(
    'pay_capability_dunning'
  ) ->> 'provider_subscription_id',
  'sub_capability_already_completed',
  'reversal target resolution is idempotent for provider DELETE retries'
);

select is(
  public.get_billing_card_recurrence_reversal_target(
    'pay_capability_unknown'
  ) ->> 'outcome',
  'payment_not_found',
  'reversal target resolution requires the exact provider payment id'
);

select is(
  public.fail_prepared_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_dunning'
  ) ->> 'outcome',
  'already_completed',
  'completed recurrence is preserved idempotently'
);
select is(
  public.fail_prepared_billing_card_recurrence(
    'd8400000-0000-4000-8000-000000000001',
    'pay_capability_wrong'
  ) ->> 'outcome',
  'payment_not_found',
  'prepared recurrence terminalization requires the exact provider payment id'
);

select ok(
  (
    select bank_slip_registration_cancelled_at is not null
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000002'
  ),
  'bank-slip cancellation event persists dedicated state'
);
select is(
  (
    select bank_slip_registration_cancelled_due_date
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000002'
  ),
  '2026-09-10'::date,
  'bank-slip cancellation is tied to the invalid artifact due date'
);
select is(
  (
    select (
      public.resolve_billing_payment_checkout_capability(checkout_token)
        ->> 'bank_slip_registration_cancelled'
    )::boolean
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000002'
  ),
  true,
  'resolver exposes the sanitized boleto replacement flag'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select ok(
  (
    public.get_billing_checkout_state(
      'd8200000-0000-4000-8000-000000000004'
    ) -> 'payment' ->> 'bank_slip_registration_cancelled'
  )::boolean
    and (
      public.get_billing_checkout_state(
        'd8200000-0000-4000-8000-000000000004'
      ) -> 'payment' ->> 'bank_slip_registration_cancelled_due_date'
    ) = '2026-09-10',
  'organization checkout state exposes only safe boleto cancellation markers'
);
select set_config('request.jwt.claim.role', '', true);

update public.asaas_payments
set
  raw_event = raw_event || jsonb_build_object(
    'last_provider_snapshot',
    jsonb_build_object('status', 'OVERDUE', 'due_date', due_date)
  ),
  last_provider_observed_at = '2026-08-04 12:30:00+00'
where id = 'd8400000-0000-4000-8000-000000000002';

select ok(
  (
    select bank_slip_registration_cancelled_at is not null
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000002'
  ),
  'polling with the same due date cannot erase boleto cancellation'
);

update public.asaas_payments
set
  due_date = '2026-09-11',
  raw_event = raw_event || jsonb_build_object(
    'last_provider_snapshot',
    jsonb_build_object('status', 'PENDING', 'due_date', '2026-09-11')
  ),
  last_provider_observed_at = '2026-08-04 12:35:00+00'
where id = 'd8400000-0000-4000-8000-000000000002';

select ok(
  (
    select bank_slip_registration_cancelled_at is null
      and bank_slip_registration_cancelled_due_date is null
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000002'
  ),
  'an explicit new due date clears only the obsolete boleto artifact state'
);
select is(
  (
    select (
      public.resolve_billing_payment_checkout_capability(checkout_token)
        ->> 'bank_slip_registration_cancelled'
    )::boolean
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000002'
  ),
  false,
  'resolver stops requesting replacement after a new artifact is issued'
);

update public.asaas_payments
set
  due_date = null,
  raw_event = jsonb_build_object('event', 'PAYMENT_BANK_SLIP_CANCELLED'),
  last_webhook_event_id = 'evt_capability_bank_cancelled_without_due_date',
  last_webhook_event_at = '2026-08-04 12:40:00+00'
where id = 'd8400000-0000-4000-8000-000000000002';

select ok(
  (
    select status = 'OVERDUE'
      and bank_slip_registration_cancelled_at is null
      and bank_slip_registration_cancelled_due_date is null
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000002'
  ),
  'an incomplete cancellation webhook preserves provider status without violating CIP state'
);

select is(
  (
    select count(*)::integer
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000003'
  ),
  0,
  'runtime sync never infers a new legacy capability from mutable catalog data'
);
select is(
  (
    select snapshot_source
    from private.resolve_billing_payment_checkout_snapshot(
      'd8400000-0000-4000-8000-000000000003',
      true
    )
  ),
  'legacy_catalog',
  'one-time backfill accepts an exact unambiguous legacy catalog tuple'
);

insert into public.billing_payment_checkout_capabilities (
  payment_id,
  asaas_payment_id,
  organization_id,
  billing_intent_id,
  plan_id,
  billing_period_months,
  amount,
  snapshot_source,
  expires_at
)
select
  payment.id,
  payment.asaas_payment_id,
  payment.organization_id,
  payment.billing_intent_id,
  snapshot.snapshot_plan_id,
  snapshot.snapshot_billing_period_months,
  snapshot.snapshot_amount,
  snapshot.snapshot_source,
  now() + interval '90 days'
from public.asaas_payments as payment
cross join lateral private.resolve_billing_payment_checkout_snapshot(
  payment.id,
  true
) as snapshot
where payment.id = 'd8400000-0000-4000-8000-000000000003';

select is(
  private.billing_payment_checkout_is_resolvable(
    'd8400000-0000-4000-8000-000000000003'
  ),
  true,
  'backend predicate recognizes the frozen legacy capability'
);

update public.admin_subscription_plans
set price = 497
where id = 'd8100000-0000-4000-8000-000000000001';
update public.organizations
set subscription_billing_period_months = 6
where id = 'd8200000-0000-4000-8000-000000000001';

select is(
  (
    select amount
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000003'
  ),
  297::numeric,
  'catalog changes cannot mutate a capability historical total'
);
select is(
  (
    select (
      public.resolve_billing_payment_checkout_capability(checkout_token) ->> 'amount'
    )::numeric
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000003'
  ),
  297::numeric,
  'resolver returns the frozen legacy total after catalog changes'
);

select is(
  (
    select count(*)::integer
    from private.resolve_billing_payment_checkout_snapshot(
      'd8400000-0000-4000-8000-000000000004',
      true
    )
  ),
  0,
  'legacy amount mismatch fails closed'
);
select is(
  public.ensure_billing_payment_checkout_capability(
    'd8400000-0000-4000-8000-000000000004',
    'd8200000-0000-4000-8000-000000000001'
  ) ->> 'outcome',
  'payment_not_resolvable',
  'runtime ensure reports an explicit non-resolvable outcome without a token'
);
select is(
  (
    select snapshot_source
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000005'
  ),
  'subscription',
  'exactly one provider subscription produces a frozen capability'
);
select is(
  (
    select count(*)::integer
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd8400000-0000-4000-8000-000000000006'
  ),
  0,
  'duplicate provider subscriptions fail closed without issuing a token'
);

select is(
  has_table_privilege(
    'authenticated',
    'public.billing_payment_checkout_capabilities',
    'select'
  ),
  false,
  'browser roles cannot read capability secrets or immutable tuples'
);

update public.asaas_payments
set
  status = 'PENDING',
  billing_type = 'PIX',
  raw_event = coalesce(raw_event, '{}'::jsonb) - 'vimob_restore'
where id = 'd8400000-0000-4000-8000-000000000003';

select is(
  (
    public.claim_billing_payment_restore(
      'd8400000-0000-4000-8000-000000000003',
      (
        select checkout_token
        from public.billing_payment_checkout_capabilities
        where payment_id = 'd8400000-0000-4000-8000-000000000003'
      )
    ) ->> 'outcome'
  ),
  'claimed',
  'provider-deleted PIX can be claimed while the exact local payment remains actionable'
);
select ok(
  (
    select raw_event #>> '{vimob_restore,provider_request_started_at}' is not null
      and raw_event #>> '{vimob_restore,attempt_id}' is not null
      and raw_event #>> '{vimob_restore,status_before_restore}' = 'PENDING'
    from public.asaas_payments
    where id = 'd8400000-0000-4000-8000-000000000003'
  ),
  'the provider-request marker commits before the caller can issue POST restore'
);
select is(
  (
    public.claim_billing_payment_restore(
      'd8400000-0000-4000-8000-000000000003',
      (
        select checkout_token
        from public.billing_payment_checkout_capabilities
        where payment_id = 'd8400000-0000-4000-8000-000000000003'
      )
    ) ->> 'outcome'
  ),
  'recover_only',
  'every replay after an ambiguous restore is GET-only and can never POST again'
);

select * from finish();
rollback;
