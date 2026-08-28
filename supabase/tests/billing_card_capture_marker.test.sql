begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(22);

select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'credential_attempt_lease_id',
  'sealed card credentials are bound to the exact checkout attempt lease'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'capture_request_started_at',
  'the first provider capture byte has a durable start marker'
);
select has_column(
  'private',
  'billing_card_recurrence_provisions',
  'capture_manual_review_at',
  'ambiguous card capture has a bounded assisted-review state'
);
select is(
  has_function_privilege(
    'anon',
    'public.mark_billing_card_capture_request_started(uuid,text,uuid)',
    'execute'
  ),
  false,
  'anonymous callers cannot cross the provider card-capture boundary'
);
select is(
  has_function_privilege(
    'service_role',
    'public.mark_billing_card_capture_request_started(uuid,text,uuid)',
    'execute'
  ),
  true,
  'only the trusted checkout service can mark provider card capture started'
);
select is(
  has_function_privilege(
    'service_role',
    'public.store_billing_card_recurrence_credential(uuid,text,uuid,text,text)',
    'execute'
  ),
  true,
  'the trusted checkout service can seal a credential against an exact lease'
);

insert into public.admin_subscription_plans (
  id, name, slug, price, payment_grace_days, modules
) values (
  'f8100000-0000-4000-8000-000000000001',
  'Capture marker fixture plan',
  'capture-marker-fixture-plan',
  297,
  3,
  '{}'::text[]
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
) values (
  'f8200000-0000-4000-8000-000000000001',
  'Capture marker fixture organization',
  'capture-marker-fixture-organization',
  'f8100000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000001',
  'paid',
  'pending_payment',
  1,
  'cus_capture_marker'
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
) values (
  'f8300000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  'f8100000-0000-4000-8000-000000000001',
  297,
  'monthly',
  1,
  'CREDIT_CARD',
  'pending',
  'f8300000-0000-4000-8000-000000000001',
  'cus_capture_marker',
  'pay_capture_marker',
  '{}'::jsonb,
  now()
);

insert into public.asaas_payments (
  id,
  organization_id,
  billing_intent_id,
  asaas_payment_id,
  asaas_customer_id,
  status,
  billing_type,
  value,
  due_date,
  raw_event,
  last_webhook_event_id,
  last_webhook_event_at
) values (
  'f8400000-0000-4000-8000-000000000001',
  'f8200000-0000-4000-8000-000000000001',
  'f8300000-0000-4000-8000-000000000001',
  'pay_capture_marker',
  'cus_capture_marker',
  'PENDING',
  'CREDIT_CARD',
  297,
  current_date + 2,
  '{}'::jsonb,
  'evt_capture_marker',
  now()
);

select is(
  public.prepare_billing_card_recurrence(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker'
  ) ->> 'outcome',
  'prepared',
  'the exact actionable card payment prepares its recurrence envelope'
);

create temporary table pgtap_capture_first_attempt as
select public.claim_billing_payment_checkout_attempt(
  'f8400000-0000-4000-8000-000000000001',
  'pay_capture_marker'
) as result;

select is(
  (select result ->> 'outcome' from pgtap_capture_first_attempt),
  'claimed',
  'the first card capture obtains an exact short-lived provider lease'
);
select is(
  public.store_billing_card_recurrence_credential(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    'f8500000-0000-4000-8000-000000000099',
    'v1.' || repeat('W', 64),
    '1111'
  ) ->> 'outcome',
  'attempt_lease_not_found',
  'a credential cannot be sealed under a guessed or stale attempt lease'
);
select is(
  public.store_billing_card_recurrence_credential(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_first_attempt),
    'v1.' || repeat('A', 64),
    '1111'
  ) ->> 'outcome',
  'stored',
  'the exact live attempt lease stores one opaque sealed credential'
);

update public.billing_payment_checkout_capabilities
set attempt_lease_expires_at = clock_timestamp() - interval '1 second'
where payment_id = 'f8400000-0000-4000-8000-000000000001';

create temporary table pgtap_capture_second_attempt as
select public.claim_billing_payment_checkout_attempt(
  'f8400000-0000-4000-8000-000000000001',
  'pay_capture_marker'
) as result;

select ok(
  (
    select result ->> 'outcome' = 'claimed'
      and (result ->> 'lease_id')::uuid <>
        (select (result ->> 'lease_id')::uuid from pgtap_capture_first_attempt)
    from pgtap_capture_second_attempt
  ),
  'an expired unmarked attempt gets a new fencing lease'
);
select ok(
  (
    select provider_card_credential is null
      and card_last4 is null
      and credential_attempt_lease_id is null
      and capture_request_started_at is null
    from private.billing_card_recurrence_provisions
    where payment_id = 'f8400000-0000-4000-8000-000000000001'
  ),
  'reclaim shreds an unmarked credential instead of assuming capture started'
);
select is(
  public.mark_billing_card_capture_request_started(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_second_attempt)
  ) ->> 'outcome',
  'credential_not_stored',
  'provider capture cannot start before the same lease stores its credential'
);
select is(
  public.store_billing_card_recurrence_credential(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_first_attempt),
    'v1.' || repeat('B', 64),
    '2222'
  ) ->> 'outcome',
  'attempt_lease_not_found',
  'the expired first lease cannot reseal a credential after reclaim'
);
select is(
  public.store_billing_card_recurrence_credential(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_second_attempt),
    'v1.' || repeat('C', 64),
    '3333'
  ) ->> 'outcome',
  'stored',
  'the replacement lease stores a fresh sealed credential'
);
select is(
  public.mark_billing_card_capture_request_started(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    'f8500000-0000-4000-8000-000000000099'
  ) ->> 'outcome',
  'attempt_lease_not_found',
  'a wrong lease cannot write provider request-start evidence'
);
select is(
  public.mark_billing_card_capture_request_started(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_second_attempt)
  ) ->> 'outcome',
  'started',
  'the exact lease durably marks the boundary immediately before provider POST'
);
select is(
  public.mark_billing_card_capture_request_started(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker',
    (select (result ->> 'lease_id')::uuid from pgtap_capture_second_attempt)
  ) ->> 'outcome',
  'already_started',
  'repeating the marker with the same lease is idempotent'
);
select is(
  public.claim_billing_payment_checkout_attempt(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker'
  ) ->> 'outcome',
  'recover_only',
  'a marked ambiguous capture can only reconcile and never POST again'
);

update private.billing_card_recurrence_provisions
set
  created_at = clock_timestamp() - interval '20 minutes',
  capture_request_started_at = clock_timestamp() - interval '16 minutes'
where payment_id = 'f8400000-0000-4000-8000-000000000001';

select is(
  public.claim_billing_payment_checkout_attempt(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker'
  ) ->> 'outcome',
  'manual_review',
  'an unreconciled marked capture reaches assisted review after fifteen minutes'
);
select ok(
  (
    select status = 'failed'
      and provider_card_credential is null
      and card_last4 is null
      and credential_attempt_lease_id is null
      and capture_request_started_at is not null
      and capture_attempt_lease_id is not null
      and capture_manual_review_at is not null
      and job_status = 'dead'
      and job_last_error_code = 'card_capture_outcome_unknown'
    from private.billing_card_recurrence_provisions
    where payment_id = 'f8400000-0000-4000-8000-000000000001'
  ),
  'manual review preserves the anti-replay marker while shredding all card material'
);
select is(
  public.claim_billing_payment_checkout_attempt(
    'f8400000-0000-4000-8000-000000000001',
    'pay_capture_marker'
  ) ->> 'outcome',
  'manual_review',
  'later retries remain terminally assisted and cannot mint a second POST lease'
);

select * from finish();
rollback;
