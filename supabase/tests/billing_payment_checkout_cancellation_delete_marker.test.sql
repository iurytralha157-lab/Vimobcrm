begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(34);

select has_column(
  'private',
  'billing_payment_checkout_cancellations',
  'provider_delete_started_at',
  'one-off DELETE has a durable provider-request boundary'
);
select has_column(
  'private',
  'billing_payment_checkout_cancellations',
  'provider_delete_claim_token',
  'the provider DELETE marker is bound to the exact fencing token'
);
select is(
  has_function_privilege(
    'anon',
    'public.mark_billing_payment_checkout_cancellation_delete_started(uuid,uuid,uuid,text)',
    'execute'
  ),
  false,
  'anonymous callers cannot authorize provider payment deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.mark_billing_payment_checkout_cancellation_delete_started(uuid,uuid,uuid,text)',
    'execute'
  ),
  true,
  'only the trusted backend can cross the exact provider DELETE boundary'
);

insert into public.admin_subscription_plans (
  id, name, slug, price, payment_grace_days, modules
) values (
  'fa100000-0000-4000-8000-000000000001',
  'Delete marker fixture plan',
  'delete-marker-fixture-plan',
  197,
  3,
  '{}'::text[]
);

insert into public.organizations (
  id,
  name,
  slug,
  subscription_type,
  subscription_status,
  plan_id,
  pending_plan_id,
  asaas_customer_id
) values
(
  'fa200000-0000-4000-8000-000000000001',
  'Delete marker crash fixture',
  'delete-marker-crash-fixture',
  'paid',
  'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_crash'
),
(
  'fa200000-0000-4000-8000-000000000002',
  'Delete marker paid race fixture',
  'delete-marker-paid-race-fixture',
  'paid',
  'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_paid'
),
(
  'fa200000-0000-4000-8000-000000000003',
  'Delete marker frozen drift fixture',
  'delete-marker-frozen-drift-fixture',
  'paid',
  'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_drift'
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
) values
(
  'fa300000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'fa300000-0000-4000-8000-000000000001',
  'cus_delete_marker_crash',
  'pay_delete_marker_crash',
  '{}'::jsonb,
  now()
),
(
  'fa300000-0000-4000-8000-000000000002',
  'fa200000-0000-4000-8000-000000000002',
  'fa100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'BOLETO',
  'pending',
  'fa300000-0000-4000-8000-000000000002',
  'cus_delete_marker_paid',
  'pay_delete_marker_paid',
  '{}'::jsonb,
  now()
),
(
  'fa300000-0000-4000-8000-000000000003',
  'fa200000-0000-4000-8000-000000000003',
  'fa100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'fa300000-0000-4000-8000-000000000003',
  'cus_delete_marker_drift',
  'pay_delete_marker_drift',
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
  last_provider_observed_at
) values
(
  'fa400000-0000-4000-8000-000000000001',
  'fa200000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'pay_delete_marker_crash',
  'cus_delete_marker_crash',
  'PENDING',
  'PIX',
  197,
  current_date + 2,
  now()
),
(
  'fa400000-0000-4000-8000-000000000002',
  'fa200000-0000-4000-8000-000000000002',
  'fa300000-0000-4000-8000-000000000002',
  'pay_delete_marker_paid',
  'cus_delete_marker_paid',
  'PENDING',
  'BOLETO',
  197,
  current_date + 3,
  now()
),
(
  'fa400000-0000-4000-8000-000000000003',
  'fa200000-0000-4000-8000-000000000003',
  'fa300000-0000-4000-8000-000000000003',
  'pay_delete_marker_drift',
  'cus_delete_marker_drift',
  'PENDING',
  'PIX',
  197,
  current_date + 4,
  now()
);

insert into public.organizations (
  id, name, slug, subscription_type, subscription_status,
  plan_id, pending_plan_id, asaas_customer_id
) values
(
  'fa200000-0000-4000-8000-000000000004',
  'Delete marker processing fixture',
  'delete-marker-processing-fixture',
  'paid', 'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_processing'
),
(
  'fa200000-0000-4000-8000-000000000005',
  'Delete marker cancelled fixture',
  'delete-marker-cancelled-fixture',
  'paid', 'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_cancelled'
),
(
  'fa200000-0000-4000-8000-000000000006',
  'Delete marker finalizer drift fixture',
  'delete-marker-finalizer-drift-fixture',
  'paid', 'pending_payment',
  'fa100000-0000-4000-8000-000000000001',
  'fa100000-0000-4000-8000-000000000001',
  'cus_delete_marker_final_drift'
);

insert into private.billing_checkout_intents (
  id, organization_id, pending_plan_id, amount, billing_cycle,
  billing_period_months, billing_method, status, external_reference,
  provider_customer_id, provider_payment_id, provider_response,
  provider_registered_at
) values
(
  'fa300000-0000-4000-8000-000000000004',
  'fa200000-0000-4000-8000-000000000004',
  'fa100000-0000-4000-8000-000000000001',
  197, 'monthly', 1, 'PIX', 'pending',
  'fa300000-0000-4000-8000-000000000004',
  'cus_delete_marker_processing', 'pay_delete_marker_processing',
  '{}'::jsonb, now()
),
(
  'fa300000-0000-4000-8000-000000000005',
  'fa200000-0000-4000-8000-000000000005',
  'fa100000-0000-4000-8000-000000000001',
  197, 'monthly', 1, 'PIX', 'pending',
  'fa300000-0000-4000-8000-000000000005',
  'cus_delete_marker_cancelled', 'pay_delete_marker_cancelled',
  '{}'::jsonb, now()
),
(
  'fa300000-0000-4000-8000-000000000006',
  'fa200000-0000-4000-8000-000000000006',
  'fa100000-0000-4000-8000-000000000001',
  197, 'monthly', 1, 'PIX', 'pending',
  'fa300000-0000-4000-8000-000000000006',
  'cus_delete_marker_final_drift', 'pay_delete_marker_final_drift',
  '{}'::jsonb, now()
);

insert into public.asaas_payments (
  id, organization_id, billing_intent_id, asaas_payment_id,
  asaas_customer_id, status, billing_type, value, due_date,
  last_provider_observed_at
) values
(
  'fa400000-0000-4000-8000-000000000004',
  'fa200000-0000-4000-8000-000000000004',
  'fa300000-0000-4000-8000-000000000004',
  'pay_delete_marker_processing', 'cus_delete_marker_processing',
  'PENDING', 'PIX', 197, current_date + 5, now()
),
(
  'fa400000-0000-4000-8000-000000000005',
  'fa200000-0000-4000-8000-000000000005',
  'fa300000-0000-4000-8000-000000000005',
  'pay_delete_marker_cancelled', 'cus_delete_marker_cancelled',
  'PENDING', 'PIX', 197, current_date + 6, now()
),
(
  'fa400000-0000-4000-8000-000000000006',
  'fa200000-0000-4000-8000-000000000006',
  'fa300000-0000-4000-8000-000000000006',
  'pay_delete_marker_final_drift', 'cus_delete_marker_final_drift',
  'PENDING', 'PIX', 197, current_date + 7, now()
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table pgtap_delete_first_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  'pay_delete_marker_crash',
  'delete-first-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_delete_first_claim),
  'claimed',
  'the initial cancellation obtains one deletion fencing token'
);
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'fa500000-0000-4000-8000-000000000099',
    'pay_delete_marker_crash'
  ) ->> 'outcome',
  'lost_claim',
  'a guessed token cannot authorize provider DELETE'
);

update private.billing_payment_checkout_cancellations
set
  claimed_at = clock_timestamp() - interval '20 minutes',
  lease_expires_at = clock_timestamp() - interval '10 minutes'
where intent_id = 'fa300000-0000-4000-8000-000000000001';

create temporary table pgtap_delete_reclaim as
select *
from public.claim_billing_payment_checkout_cancellation_jobs(
  'delete-current-worker',
  10,
  600
);
select ok(
  (
    select count(*) = 1
      and bool_and(
        intent_id = 'fa300000-0000-4000-8000-000000000001'
        and claim_outcome = 'claimed'
        and claim_token <>
          (select (result ->> 'claim_token')::uuid
           from pgtap_delete_first_claim)
      )
    from pgtap_delete_reclaim
  ),
  'pre-DELETE lease recovery rotates to a new current fencing token'
);
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select (result ->> 'claim_token')::uuid from pgtap_delete_first_claim),
    'pay_delete_marker_crash'
  ) ->> 'outcome',
  'lost_claim',
  'the crashed worker token cannot cross the provider boundary after reclaim'
);

create temporary table pgtap_delete_marker as
select public.mark_billing_payment_checkout_cancellation_delete_started(
  'fa200000-0000-4000-8000-000000000001',
  'fa300000-0000-4000-8000-000000000001',
  (select claim_token from pgtap_delete_reclaim),
  'pay_delete_marker_crash'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_delete_marker),
  'proceed',
  'only the current live token may authorize the first provider DELETE byte'
);
select ok(
  (
    select cancellation.provider_delete_started_at is not null
      and cancellation.provider_delete_claim_token
        = (select claim_token from pgtap_delete_reclaim)
      and capability.revoked_at is not null
      and capability.attempt_lease_id is null
    from private.billing_payment_checkout_cancellations as cancellation
    join public.billing_payment_checkout_capabilities as capability
      on capability.payment_id = cancellation.payment_id
    where cancellation.intent_id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'the boundary marker and checkout-bearer revocation commit atomically'
);
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_delete_reclaim),
    'pay_delete_marker_crash'
  ) ->> 'outcome',
  'already_started',
  'a repeated marker is recovery-only evidence and never authorizes DELETE'
);
select is(
  public.claim_billing_payment_checkout_cancellation(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    'pay_delete_marker_crash',
    'delete-current-worker'
  ) ->> 'outcome',
  'recover_only',
  'the original worker can only GET and reconcile after the marker exists'
);
select is(
  public.fail_billing_payment_checkout_cancellation(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_delete_reclaim),
    'retryable',
    'provider_delete_ack_ambiguous'
  ) ->> 'outcome',
  'retry',
  'an ambiguous DELETE acknowledgement schedules bounded reconciliation'
);

create temporary table pgtap_delete_recovery as
select *
from public.claim_billing_payment_checkout_cancellation_jobs(
  'delete-recovery-worker',
  10,
  600
);
select ok(
  (
    select count(*) = 1
      and bool_and(
        intent_id = 'fa300000-0000-4000-8000-000000000001'
        and claim_outcome = 'recover_only'
        and claim_token = (select claim_token from pgtap_delete_reclaim)
      )
    from pgtap_delete_recovery
  ),
  'crash recovery preserves the marker token and returns recover_only'
);
select ok(
  (
    select provider_delete_started_at =
        (select (result ->> 'provider_delete_started_at')::timestamptz
         from pgtap_delete_marker)
      and provider_delete_claim_token =
        (select claim_token from pgtap_delete_reclaim)
    from private.billing_payment_checkout_cancellations
    where intent_id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'recovery cannot rewrite the original irreversible-provider evidence'
);
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_delete_recovery),
    'pay_delete_marker_crash'
  ) ->> 'outcome',
  'already_started',
  'a recovery lease observes the marker and still cannot authorize a second DELETE'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_delete_recovery),
    'pay_delete_marker_crash',
    'deleted',
    (select (result ->> 'provider_delete_started_at')::timestamptz
       - interval '1 second'
     from pgtap_delete_marker)
  ) ->> 'outcome',
  'invalid_request',
  'deletion proof cannot predate the durable provider boundary'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'fa200000-0000-4000-8000-000000000001',
    'fa300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_delete_recovery),
    'pay_delete_marker_crash',
    'deleted',
    clock_timestamp()
  ) ->> 'outcome',
  'cancelled',
  'GET-confirmed provider deletion closes the original marked claim'
);
select ok(
  (
    select final_outcome = 'cancelled'
      and provider_delete_result = 'deleted'
      and provider_delete_started_at is not null
      and provider_deleted_at >= provider_delete_started_at
    from private.billing_payment_checkout_cancellations
    where intent_id = 'fa300000-0000-4000-8000-000000000001'
  ),
  'final state preserves both request-start and deletion evidence'
);

create temporary table pgtap_delete_drift_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000003',
  'fa300000-0000-4000-8000-000000000003',
  'pay_delete_marker_drift',
  'delete-drift-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_delete_drift_claim),
  'claimed',
  'the drift fixture first freezes an exact provider deletion tuple'
);

update public.organizations
set asaas_customer_id = 'cus_delete_marker_replaced', updated_at = now()
where id = 'fa200000-0000-4000-8000-000000000003';
update private.billing_checkout_intents
set
  provider_payment_id = 'pay_delete_marker_replaced',
  provider_customer_id = 'cus_delete_marker_replaced',
  billing_method = 'BOLETO',
  external_reference = 'delete-marker-drifted-reference',
  updated_at = now()
where id = 'fa300000-0000-4000-8000-000000000003';
update public.asaas_payments
set
  asaas_customer_id = 'cus_delete_marker_replaced',
  due_date = current_date + 9,
  updated_at = now()
where id = 'fa400000-0000-4000-8000-000000000003';

select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000003',
    'fa300000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_delete_drift_claim),
    'pay_delete_marker_drift'
  ) ->> 'outcome',
  'manual_review',
  'post-claim tuple drift cannot cross the irreversible DELETE marker'
);
select ok(
  (
    select cancellation.final_outcome = 'manual_review'
      and cancellation.finalized_at is not null
      and cancellation.provider_delete_started_at is null
      and cancellation.provider_delete_claim_token is null
      and capability.revoked_at is not null
      and capability.attempt_lease_id is null
      and exists (
        select 1
        from public.error_events as event
        where event.organization_id = cancellation.organization_id
          and event.fingerprint
            = 'billing_payment_cancellation_manual:'
              || cancellation.intent_id::text
      )
    from private.billing_payment_checkout_cancellations as cancellation
    join public.billing_payment_checkout_capabilities as capability
      on capability.payment_id = cancellation.payment_id
    where cancellation.intent_id
      = 'fa300000-0000-4000-8000-000000000003'
  ),
  'drift terminalizes visibly without recording fake DELETE evidence'
);
select is(
  (
    select count(*)::integer
    from public.claim_billing_payment_checkout_cancellation_jobs(
      'delete-drift-recovery-worker',
      10,
      600
    ) as job
    where job.intent_id = 'fa300000-0000-4000-8000-000000000003'
  ),
  0,
  'a terminal mismatch leaves no invisible cancellation batch loop'
);

create temporary table pgtap_delete_processing_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000004',
  'fa300000-0000-4000-8000-000000000004',
  'pay_delete_marker_processing',
  'delete-processing-worker'
) as result;
update public.asaas_payments
set status = 'PROCESSING', updated_at = now()
where id = 'fa400000-0000-4000-8000-000000000004';
select ok(
  (
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'payment_processing'
    from (
      select public.mark_billing_payment_checkout_cancellation_delete_started(
        'fa200000-0000-4000-8000-000000000004',
        'fa300000-0000-4000-8000-000000000004',
        (select (result ->> 'claim_token')::uuid
         from pgtap_delete_processing_claim),
        'pay_delete_marker_processing'
      ) as result
    ) as processing
  ),
  'processing is deferred without crossing DELETE or inventing manual review'
);
update private.billing_payment_checkout_cancellations
set
  claimed_at = clock_timestamp() - interval '2 minutes',
  lease_expires_at = clock_timestamp() - interval '1 minute'
where intent_id = 'fa300000-0000-4000-8000-000000000004';
create temporary table pgtap_delete_processing_recovery as
select *
from public.claim_billing_payment_checkout_cancellation_jobs(
  'delete-processing-recovery-worker',
  10,
  600
);
select ok(
  (
    select not exists (
        select 1
        from pgtap_delete_processing_recovery as recovered
        where recovered.intent_id
          = 'fa300000-0000-4000-8000-000000000004'
      )
      and cancellation.claim_attempts = 1
      and cancellation.finalized_at is null
      and cancellation.manual_review_at is null
      and cancellation.provider_delete_started_at is null
      and cancellation.lease_expires_at
        >= clock_timestamp() + interval '9 minutes'
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.intent_id
      = 'fa300000-0000-4000-8000-000000000004'
  ),
  'expired processing is not redelivered and renews without consuming attempts'
);

update public.asaas_payments
set status = 'PROCESSING', updated_at = now()
where id = 'fa400000-0000-4000-8000-000000000005';
select ok(
  (
    with response as (
      select public.claim_billing_payment_checkout_cancellation(
        'fa200000-0000-4000-8000-000000000005',
        'fa300000-0000-4000-8000-000000000005',
        'pay_delete_marker_cancelled',
        'delete-first-processing-worker'
      ) as result
    )
    select response.result ->> 'outcome' = 'busy'
      and response.result ->> 'busy_reason' = 'payment_processing'
      and (response.result ->> 'retry_after_seconds')::integer = 600
      and not exists (
        select 1
        from private.billing_payment_checkout_cancellations as cancellation
        where cancellation.intent_id
          = 'fa300000-0000-4000-8000-000000000005'
      )
    from response
  ),
  'a first claim sees processing as retryable busy without creating a fence'
);
update public.asaas_payments
set status = 'PENDING', updated_at = now()
where id = 'fa400000-0000-4000-8000-000000000005';

create temporary table pgtap_delete_cancelled_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000005',
  'fa300000-0000-4000-8000-000000000005',
  'pay_delete_marker_cancelled',
  'delete-cancelled-worker'
) as result;
update public.asaas_payments
set status = 'CANCELED', updated_at = now()
where id = 'fa400000-0000-4000-8000-000000000005';
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000005',
    'fa300000-0000-4000-8000-000000000005',
    (select (result ->> 'claim_token')::uuid
     from pgtap_delete_cancelled_claim),
    'pay_delete_marker_cancelled'
  ) ->> 'outcome',
  'already_cancelled',
  'the provider cancelled trio is an idempotent terminal without another DELETE'
);
select ok(
  (
    select cancellation.final_outcome = 'cancelled'
      and cancellation.provider_delete_result = 'not_found'
      and cancellation.provider_delete_started_at is null
      and intent.status = 'cancelled'
      and capability.revoked_at is not null
    from private.billing_payment_checkout_cancellations as cancellation
    join private.billing_checkout_intents as intent
      on intent.id = cancellation.intent_id
    join public.billing_payment_checkout_capabilities as capability
      on capability.payment_id = cancellation.payment_id
    where cancellation.intent_id
      = 'fa300000-0000-4000-8000-000000000005'
  ),
  'cancelled provider evidence closes local state without a fake request marker'
);

create temporary table pgtap_delete_final_drift_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000006',
  'fa300000-0000-4000-8000-000000000006',
  'pay_delete_marker_final_drift',
  'delete-final-drift-worker'
) as result;
create temporary table pgtap_delete_final_drift_marker as
select public.mark_billing_payment_checkout_cancellation_delete_started(
  'fa200000-0000-4000-8000-000000000006',
  'fa300000-0000-4000-8000-000000000006',
  (select (result ->> 'claim_token')::uuid
   from pgtap_delete_final_drift_claim),
  'pay_delete_marker_final_drift'
) as result;
update private.billing_checkout_intents
set
  provider_payment_id = 'pay_delete_marker_new_intent',
  external_reference = 'delete-marker-new-intent-reference',
  updated_at = now()
where id = 'fa300000-0000-4000-8000-000000000006';
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'fa200000-0000-4000-8000-000000000006',
    'fa300000-0000-4000-8000-000000000006',
    (select (result ->> 'claim_token')::uuid
     from pgtap_delete_final_drift_claim),
    'pay_delete_marker_final_drift',
    'deleted',
    clock_timestamp()
  ) ->> 'outcome',
  'manual_review',
  'post-marker intent drift cannot let a stale DELETE ack cancel a new intent'
);
select ok(
  (
    select cancellation.final_outcome = 'manual_review'
      and cancellation.provider_delete_result = 'deleted'
      and cancellation.provider_deleted_at
        >= cancellation.provider_delete_started_at
      and cancellation.manual_review_at is not null
      and intent.status = 'pending'
      and intent.provider_payment_id = 'pay_delete_marker_new_intent'
      and exists (
        select 1
        from public.error_events as event
        where event.organization_id = cancellation.organization_id
          and event.fingerprint
            = 'billing_payment_cancellation_manual:'
              || cancellation.intent_id::text
      )
    from private.billing_payment_checkout_cancellations as cancellation
    join private.billing_checkout_intents as intent
      on intent.id = cancellation.intent_id
    where cancellation.intent_id
      = 'fa300000-0000-4000-8000-000000000006'
  ),
  'manual post-boundary state preserves DELETE evidence and the replacement intent'
);

create temporary table pgtap_delete_paid_claim as
select public.claim_billing_payment_checkout_cancellation(
  'fa200000-0000-4000-8000-000000000002',
  'fa300000-0000-4000-8000-000000000002',
  'pay_delete_marker_paid',
  'delete-paid-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_delete_paid_claim),
  'claimed',
  'the paid-race fixture first obtains a live deletion claim'
);

update public.asaas_payments
set status = 'CONFIRMED', updated_at = clock_timestamp()
where id = 'fa400000-0000-4000-8000-000000000002';
select ok(
  (
    select final_outcome = 'paid_before_delete'
      and paid_won_at is not null
      and provider_delete_started_at is null
    from private.billing_payment_checkout_cancellations
    where intent_id = 'fa300000-0000-4000-8000-000000000002'
  ),
  'paid evidence wins atomically before the provider DELETE marker'
);
select is(
  public.mark_billing_payment_checkout_cancellation_delete_started(
    'fa200000-0000-4000-8000-000000000002',
    'fa300000-0000-4000-8000-000000000002',
    (select (result ->> 'claim_token')::uuid from pgtap_delete_paid_claim),
    'pay_delete_marker_paid'
  ) ->> 'outcome',
  'paid_before_delete',
  'the stale preflight cannot authorize DELETE after the paid webhook wins'
);
select ok(
  (
    select cancellation.provider_delete_started_at is null
      and cancellation.provider_delete_claim_token is null
      and public.claim_billing_payment_checkout_attempt(
        cancellation.payment_id,
        cancellation.provider_payment_id
      ) ->> 'outcome' = 'payment_not_actionable'
    from private.billing_payment_checkout_cancellations as cancellation
    where cancellation.intent_id = 'fa300000-0000-4000-8000-000000000002'
  ),
  'the paid race leaves no DELETE permission and no actionable payment mutation'
);

select set_config('request.jwt.claim.role', '', true);
select * from finish();
rollback;
