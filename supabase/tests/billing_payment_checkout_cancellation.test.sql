begin;

create extension if not exists pgtap with schema extensions;
select plan(44);

select ok(
  to_regclass('private.billing_payment_checkout_cancellations') is not null,
  'one-off provider payment deletion claims are durable'
);
select is(
  has_table_privilege(
    'service_role',
    'private.billing_payment_checkout_cancellations',
    'select'
  ),
  false,
  'service role cannot bypass the exact one-off cancellation RPCs'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_payment_checkout_cancellation(uuid,uuid,text,text,integer)',
    'execute'
  ),
  false,
  'anonymous clients cannot claim provider payment deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_payment_checkout_cancellation(uuid,uuid,text,text,integer)',
    'execute'
  ),
  true,
  'the trusted backend can claim exact provider payment deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.finalize_billing_payment_checkout_cancellation(uuid,uuid,uuid,text,text,timestamptz)',
    'execute'
  ),
  true,
  'the trusted backend can finalize exact provider payment deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_payment_checkout_cancellation_jobs(text,integer,integer)',
    'execute'
  ),
  true,
  'the trusted worker can redrive expired provider payment deletions'
);
select is(
  has_function_privilege(
    'service_role',
    'public.fail_billing_payment_checkout_cancellation(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  true,
  'the trusted worker can classify an exact fenced cancellation failure'
);

insert into public.admin_subscription_plans (
  id, name, slug, price, payment_grace_days, modules
) values (
  'e6100000-0000-4000-8000-000000000001',
  'One-off cancellation plan',
  'one-off-cancellation-plan',
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
  'e6200000-0000-4000-8000-000000000001',
  'One-off cancellation organization',
  'one-off-cancellation-organization',
  'paid',
  'pending_payment',
  'e6100000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cus_oneoff_cancel'
),
(
  'e6200000-0000-4000-8000-000000000002',
  'Paid before delete organization',
  'paid-before-delete-organization',
  'paid',
  'pending_payment',
  'e6100000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cus_paid_before_delete'
),
(
  'e6200000-0000-4000-8000-000000000003',
  'Manual cancellation organization',
  'manual-cancellation-organization',
  'paid',
  'pending_payment',
  'e6100000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cus_manual_cancel'
),
(
  'e6200000-0000-4000-8000-000000000004',
  'Frozen drift cancellation organization',
  'frozen-drift-cancellation-organization',
  'paid',
  'pending_payment',
  'e6100000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cus_frozen_drift_cancel'
),
(
  'e6200000-0000-4000-8000-000000000005',
  'Exhausted cancellation organization',
  'exhausted-cancellation-organization',
  'paid',
  'pending_payment',
  'e6100000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  'cus_exhausted_cancel'
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
  'e6300000-0000-4000-8000-000000000001',
  'e6200000-0000-4000-8000-000000000001',
  'e6100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'e6300000-0000-4000-8000-000000000001',
  null,
  'pay_oneoff_cancel',
  '{}'::jsonb,
  now()
),
(
  'e6300000-0000-4000-8000-000000000002',
  'e6200000-0000-4000-8000-000000000002',
  'e6100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'BOLETO',
  'pending',
  'e6300000-0000-4000-8000-000000000002',
  'cus_paid_before_delete',
  'pay_paid_before_delete',
  '{}'::jsonb,
  now()
),
(
  'e6300000-0000-4000-8000-000000000003',
  'e6200000-0000-4000-8000-000000000003',
  'e6100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'e6300000-0000-4000-8000-000000000003',
  'cus_manual_cancel',
  'pay_manual_cancel',
  '{}'::jsonb,
  now()
),
(
  'e6300000-0000-4000-8000-000000000004',
  'e6200000-0000-4000-8000-000000000004',
  'e6100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'e6300000-0000-4000-8000-000000000004',
  'cus_frozen_drift_cancel',
  'pay_frozen_drift_cancel',
  '{}'::jsonb,
  now()
),
(
  'e6300000-0000-4000-8000-000000000005',
  'e6200000-0000-4000-8000-000000000005',
  'e6100000-0000-4000-8000-000000000001',
  197,
  'monthly',
  1,
  'PIX',
  'pending',
  'e6300000-0000-4000-8000-000000000005',
  'cus_exhausted_cancel',
  'pay_exhausted_cancel',
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
  'e6400000-0000-4000-8000-000000000001',
  'e6200000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  'pay_oneoff_cancel',
  'cus_oneoff_cancel',
  'PENDING',
  'PIX',
  197,
  current_date + 2,
  now()
),
(
  'f6400000-0000-4000-8000-000000000002',
  'e6200000-0000-4000-8000-000000000002',
  'e6300000-0000-4000-8000-000000000002',
  'pay_paid_before_delete',
  'cus_paid_before_delete',
  'PENDING',
  'BOLETO',
  197,
  current_date + 3,
  now()
),
(
  'a7400000-0000-4000-8000-000000000003',
  'e6200000-0000-4000-8000-000000000003',
  'e6300000-0000-4000-8000-000000000003',
  'pay_manual_cancel',
  'cus_manual_cancel',
  'PENDING',
  'PIX',
  197,
  current_date + 4,
  now()
),
(
  'b7400000-0000-4000-8000-000000000004',
  'e6200000-0000-4000-8000-000000000004',
  'e6300000-0000-4000-8000-000000000004',
  'pay_frozen_drift_cancel',
  'cus_frozen_drift_cancel',
  'PENDING',
  'PIX',
  197,
  current_date + 5,
  now()
),
(
  'c7400000-0000-4000-8000-000000000005',
  'e6200000-0000-4000-8000-000000000005',
  'e6300000-0000-4000-8000-000000000005',
  'pay_exhausted_cancel',
  'cus_exhausted_cancel',
  'PENDING',
  'PIX',
  197,
  current_date + 6,
  now()
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table pgtap_oneoff_attempt as
select public.claim_billing_payment_checkout_attempt(
  'e6400000-0000-4000-8000-000000000001',
  'pay_oneoff_cancel'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_oneoff_attempt),
  'claimed',
  'a checkout provider mutation acquires its lease before cancellation'
);
select ok(
  (
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'payment_attempt'
    from (
      select public.claim_billing_payment_checkout_cancellation(
        'e6200000-0000-4000-8000-000000000001',
        'e6300000-0000-4000-8000-000000000001',
        'pay_oneoff_cancel',
        'blocked-worker'
      ) as result
    ) as blocked
  ),
  'an active checkout attempt fences one-off provider deletion'
);
select is(
  (
    select count(*)::integer
    from private.billing_payment_checkout_cancellations
  ),
  0,
  'a blocked deletion does not persist a misleading claim'
);
select is(
  public.release_billing_payment_checkout_attempt(
    'e6400000-0000-4000-8000-000000000001',
    'pay_oneoff_cancel',
    (select (result ->> 'lease_id')::uuid from pgtap_oneoff_attempt)
  ) ->> 'outcome',
  'released',
  'the exact checkout attempt can release its provider lease'
);

create temporary table pgtap_oneoff_claim as
select public.claim_billing_payment_checkout_cancellation(
  'e6200000-0000-4000-8000-000000000001',
  'e6300000-0000-4000-8000-000000000001',
  'pay_oneoff_cancel',
  'edge-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_oneoff_claim),
  'claimed',
  'an exact unpaid PIX payment is claimed before provider DELETE'
);
select ok(
  (
    select result ->> 'customer_id' = 'cus_oneoff_cancel'
      and result ->> 'external_reference'
        = 'e6300000-0000-4000-8000-000000000001'
      and (result ->> 'amount')::numeric = 197
      and result ->> 'billing_type' = 'PIX'
      and (result ->> 'due_date')::date = current_date + 2
      and (result ->> 'lease_expires_at')::timestamptz
        >= clock_timestamp() + interval '540 seconds'
    from pgtap_oneoff_claim
  ),
  'claim freezes the Edge validation tuple and a four-call lease margin'
);
select is(
  public.claim_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    'pay_oneoff_cancel',
    'edge-worker'
  ) ->> 'outcome',
  'already_claimed',
  'the same worker reuses its live fenced claim'
);
select is(
  public.claim_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    'pay_oneoff_cancel',
    'other-worker'
  ) ->> 'outcome',
  'busy',
  'another worker cannot race the provider DELETE'
);
select ok(
  (
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'payment_cancellation'
    from (
      select public.claim_billing_payment_checkout_attempt(
        'e6400000-0000-4000-8000-000000000001',
        'pay_oneoff_cancel'
      ) as result
    ) as blocked
  ),
  'a durable one-off cancellation claim fences later checkout mutation'
);

create temporary table pgtap_frozen_drift_claim as
select public.claim_billing_payment_checkout_cancellation(
  'e6200000-0000-4000-8000-000000000004',
  'e6300000-0000-4000-8000-000000000004',
  'pay_frozen_drift_cancel',
  'drift-original-worker'
) as result;
update private.billing_payment_checkout_cancellations
set
  claimed_at = clock_timestamp() - interval '20 minutes',
  lease_expires_at = clock_timestamp() - interval '10 minutes',
  updated_at = clock_timestamp()
where intent_id = 'e6300000-0000-4000-8000-000000000004';
update public.asaas_payments
set due_date = current_date + 9, updated_at = now()
where id = 'b7400000-0000-4000-8000-000000000004';
update private.billing_checkout_intents
set external_reference = 'drifted-oneoff-reference', updated_at = now()
where id = 'e6300000-0000-4000-8000-000000000004';
select ok(
  (
    select result ->> 'outcome' = 'already_finalized'
      and result ->> 'final_outcome' = 'manual_review'
      and result ->> 'last_error_code'
        = 'cancellation_frozen_snapshot_mismatch'
    from (
      select public.claim_billing_payment_checkout_cancellation(
        'e6200000-0000-4000-8000-000000000004',
        'e6300000-0000-4000-8000-000000000004',
        'pay_frozen_drift_cancel',
        'drifted-worker'
      ) as result
    ) as rejected
  ),
  'expired direct reclaim terminalizes frozen tuple drift for assisted review'
);
select ok(
  (
    select external_reference
        = 'e6300000-0000-4000-8000-000000000004'
      and due_date = current_date + 5
      and claim_token = (
        select (result ->> 'claim_token')::uuid
        from pgtap_frozen_drift_claim
      )
      and finalized_at is not null
      and final_outcome = 'manual_review'
      and manual_review_at is not null
      and exists (
        select 1
        from public.billing_payment_checkout_capabilities as capability
        where capability.payment_id
          = 'b7400000-0000-4000-8000-000000000004'
          and capability.revoked_at is not null
      )
      and exists (
        select 1
        from public.error_events as event
        where event.organization_id
          = 'e6200000-0000-4000-8000-000000000004'
          and event.fingerprint
            = 'billing_payment_cancellation_manual:'
              || 'e6300000-0000-4000-8000-000000000004'
      )
    from private.billing_payment_checkout_cancellations
    where intent_id = 'e6300000-0000-4000-8000-000000000004'
  ),
  'drift keeps the frozen snapshot/token and emits one terminal support signal'
);

create temporary table pgtap_exhausted_claim as
select public.claim_billing_payment_checkout_cancellation(
  'e6200000-0000-4000-8000-000000000005',
  'e6300000-0000-4000-8000-000000000005',
  'pay_exhausted_cancel',
  'exhausted-original-worker'
) as result;
update private.billing_payment_checkout_cancellations
set
  claim_attempts = max_attempts,
  claimed_at = clock_timestamp() - interval '20 minutes',
  lease_expires_at = clock_timestamp() - interval '10 minutes',
  updated_at = clock_timestamp()
where intent_id = 'e6300000-0000-4000-8000-000000000005';
select ok(
  (
    select result ->> 'outcome' = 'already_finalized'
      and result ->> 'final_outcome' = 'manual_review'
      and result ->> 'last_error_code' = 'cancellation_attempts_exhausted'
    from (
      select public.claim_billing_payment_checkout_cancellation(
        'e6200000-0000-4000-8000-000000000005',
        'e6300000-0000-4000-8000-000000000005',
        'pay_exhausted_cancel',
        'exhausted-recovery-worker'
      ) as result
    ) as exhausted
  ),
  'claim exhaustion terminalizes the crashed cancellation instead of looping'
);
select ok(
  (
    select cancellation.finalized_at is not null
      and cancellation.manual_review_at is not null
      and capability.revoked_at is not null
      and capability.attempt_lease_id is null
      and exists (
        select 1
        from public.error_events as event
        where event.organization_id = cancellation.organization_id
          and event.fingerprint
            = 'billing_payment_cancellation_manual:'
              || cancellation.intent_id::text
          and event.metadata ->> 'stage' = 'claim_attempts_exhausted'
      )
      and not exists (
        select 1
        from public.claim_billing_payment_checkout_cancellation_jobs(
          'exhausted-batch-worker',
          10,
          600
        ) as job
        where job.intent_id = cancellation.intent_id
      )
    from private.billing_payment_checkout_cancellations as cancellation
    join public.billing_payment_checkout_capabilities as capability
      on capability.payment_id = cancellation.payment_id
    where cancellation.intent_id
      = 'e6300000-0000-4000-8000-000000000005'
  ),
  'exhaustion revokes checkout, alerts support, and leaves no live batch row'
);

-- Expire the main fixture only after the isolated exhaustion batch assertion.
-- Otherwise that global batch can legitimately renew the main row and the
-- outer intent filter would discard it before the dedicated recovery test.
update private.billing_payment_checkout_cancellations
set
  claimed_at = clock_timestamp() - interval '20 minutes',
  lease_expires_at = clock_timestamp() - interval '10 minutes',
  updated_at = clock_timestamp()
where intent_id = 'e6300000-0000-4000-8000-000000000001';

select ok(
  (
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'payment_cancellation'
    from (
      select public.claim_billing_payment_checkout_attempt(
        'e6400000-0000-4000-8000-000000000001',
        'pay_oneoff_cancel'
      ) as result
    ) as blocked
  ),
  'an expired unfinalized deletion still fences checkout until redrive'
);

create temporary table pgtap_oneoff_recovery as
select *
from public.claim_billing_payment_checkout_cancellation_jobs(
  'recovery-worker',
  10,
  600
);
select ok(
  (
    select count(*) = 1
      and bool_and(
        organization_id = 'e6200000-0000-4000-8000-000000000001'
        and intent_id = 'e6300000-0000-4000-8000-000000000001'
        and payment_row_id = 'e6400000-0000-4000-8000-000000000001'
        and provider_payment_id = 'pay_oneoff_cancel'
        and provider_customer_id = 'cus_oneoff_cancel'
        and external_reference = 'e6300000-0000-4000-8000-000000000001'
        and amount = 197
        and billing_type = 'PIX'
        and due_date = current_date + 2
        and claim_token <>
          (select (result ->> 'claim_token')::uuid from pgtap_oneoff_claim)
        and lease_expires_at >= clock_timestamp() + interval '540 seconds'
      )
    from pgtap_oneoff_recovery
  ),
  'batch redrive renews the fence and returns the immutable provider tuple'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    (select (result ->> 'claim_token')::uuid from pgtap_oneoff_claim),
    'pay_oneoff_cancel',
    'deleted',
    now()
  ) ->> 'outcome',
  'lost_claim',
  'renewing an expired job fences the crashed worker token'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_oneoff_recovery),
    'pay_oneoff_cancel',
    'unknown',
    now()
  ) ->> 'outcome',
  'invalid_request',
  'finalization rejects an unrecognized provider deletion proof'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_oneoff_recovery),
    'pay_oneoff_cancel',
    'not_found',
    now()
  ) ->> 'outcome',
  'cancelled',
  'provider 404 evidence closes the exact unpaid payment atomically'
);
select ok(
  (
    select payment.status = 'CANCELED'
      and intent.status = 'cancelled'
      and cancellation.provider_delete_result = 'not_found'
      and cancellation.final_outcome = 'cancelled'
    from public.asaas_payments as payment
    join private.billing_checkout_intents as intent
      on intent.id = payment.billing_intent_id
    join private.billing_payment_checkout_cancellations as cancellation
      on cancellation.payment_id = payment.id
    where payment.id = 'e6400000-0000-4000-8000-000000000001'
  ),
  'unpaid payment, intent, and deletion evidence close in one transaction'
);
select ok(
  (
    select revoked_at is not null
      and attempt_lease_id is null
      and attempt_lease_expires_at is null
    from public.billing_payment_checkout_capabilities
    where payment_id = 'e6400000-0000-4000-8000-000000000001'
  ),
  'finalization revokes the exact checkout bearer and scrubs its lease'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000001',
    'e6300000-0000-4000-8000-000000000001',
    (select claim_token from pgtap_oneoff_recovery),
    'pay_oneoff_cancel',
    'not_found',
    now()
  ) ->> 'outcome',
  'already_finalized',
  'a lost finalization response is idempotent'
);
select is(
  public.claim_billing_payment_checkout_attempt(
    'e6400000-0000-4000-8000-000000000001',
    'pay_oneoff_cancel'
  ) ->> 'outcome',
  'payment_not_actionable',
  'a finalized deletion cannot revive the public checkout'
);

create temporary table pgtap_paid_before_delete_claim as
select public.claim_billing_payment_checkout_cancellation(
  'e6200000-0000-4000-8000-000000000002',
  'e6300000-0000-4000-8000-000000000002',
  'pay_paid_before_delete',
  'paid-race-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_paid_before_delete_claim),
  'claimed',
  'an unpaid boleto is fenced before the paid race'
);
update public.asaas_payments
set status = 'CONFIRMED', updated_at = now()
where id = 'f6400000-0000-4000-8000-000000000002';
select ok(
  (
    select finalized_at is not null
      and final_outcome = 'paid_before_delete'
      and paid_won_at is not null
      and provider_deleted_at is null
      and provider_delete_result is null
    from private.billing_payment_checkout_cancellations
    where intent_id = 'e6300000-0000-4000-8000-000000000002'
  ),
  'paid reconciliation terminates deletion authorization without fake DELETE evidence'
);
select is(
  public.finalize_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000002',
    'e6300000-0000-4000-8000-000000000002',
    (select (result ->> 'claim_token')::uuid from pgtap_paid_before_delete_claim),
    'pay_paid_before_delete',
    'paid',
    null
  ) ->> 'final_outcome',
  'paid_before_delete',
  'worker recovery observes the already-finalized paid-before-delete result'
);
select ok(
  (
    select payment.status = 'CONFIRMED'
      and intent.status = 'confirmed'
      and organization.subscription_status = 'active'
    from public.asaas_payments as payment
    join private.billing_checkout_intents as intent
      on intent.id = payment.billing_intent_id
    join public.organizations as organization
      on organization.id = payment.organization_id
    where payment.id = 'f6400000-0000-4000-8000-000000000002'
  ),
  'paid-before-delete preserves the payment, intent, and purchased access'
);

create temporary table pgtap_manual_claim as
select public.claim_billing_payment_checkout_cancellation(
  'e6200000-0000-4000-8000-000000000003',
  'e6300000-0000-4000-8000-000000000003',
  'pay_manual_cancel',
  'manual-worker'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_manual_claim),
  'claimed',
  'a provider-assisted path first acquires an exact deletion fence'
);
select is(
  public.fail_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000003',
    'e6300000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_manual_claim),
    'retryable',
    'provider_snapshot_temporarily_unavailable'
  ) ->> 'outcome',
  'retry',
  'a retryable provider failure expires the lease for bounded redrive'
);
create temporary table pgtap_manual_reclaim as
select *
from public.claim_billing_payment_checkout_cancellation_jobs(
  'manual-recovery-worker',
  10,
  600
);
select ok(
  (
    select count(*) = 1
      and bool_and(
        intent_id = 'e6300000-0000-4000-8000-000000000003'
        and claim_token <>
          (select (result ->> 'claim_token')::uuid from pgtap_manual_claim)
      )
    from pgtap_manual_reclaim
  ),
  'retry redrive renews the fencing token instead of releasing checkout'
);
select is(
  public.fail_billing_payment_checkout_cancellation(
    'e6200000-0000-4000-8000-000000000003',
    'e6300000-0000-4000-8000-000000000003',
    (select claim_token from pgtap_manual_reclaim),
    'permanent',
    'provider_tuple_requires_assistance'
  ) ->> 'outcome',
  'manual_review',
  'a permanent assisted mismatch terminalizes the exact claim immediately'
);
select ok(
  (
    select cancellation.final_outcome = 'manual_review'
      and cancellation.finalized_at is not null
      and cancellation.manual_review_at is not null
      and cancellation.provider_deleted_at is null
      and cancellation.provider_delete_result is null
      and capability.revoked_at is not null
      and capability.attempt_lease_id is null
    from private.billing_payment_checkout_cancellations as cancellation
    join public.billing_payment_checkout_capabilities as capability
      on capability.payment_id = cancellation.payment_id
    where cancellation.intent_id = 'e6300000-0000-4000-8000-000000000003'
  ),
  'manual review is terminal evidence and revokes the bearer without fake DELETE proof'
);
select is(
  (
    select count(*)::integer
    from private.billing_payment_checkout_cancellations
    where intent_id = 'e6300000-0000-4000-8000-000000000003'
      and finalized_at is null
  ),
  0,
  'manual review leaves no live cancellation for the batch to reclaim forever'
);
select is(
  public.claim_billing_payment_checkout_attempt(
    'a7400000-0000-4000-8000-000000000003',
    'pay_manual_cancel'
  ) ->> 'outcome',
  'payment_not_actionable',
  'terminal manual review keeps checkout blocked through revocation'
);
update public.asaas_payments
set status = 'CONFIRMED', updated_at = now()
where id = 'a7400000-0000-4000-8000-000000000003';
select ok(
  (
    select cancellation.final_outcome = 'paid_before_delete'
      and cancellation.manual_review_at is null
      and cancellation.paid_won_at is not null
      and intent.status = 'confirmed'
    from private.billing_payment_checkout_cancellations as cancellation
    join private.billing_checkout_intents as intent
      on intent.id = cancellation.intent_id
    where cancellation.intent_id = 'e6300000-0000-4000-8000-000000000003'
  ),
  'late paid evidence supersedes manual review and confirms the exact purchase'
);

update public.asaas_payments
set status = 'CONFIRMED', updated_at = now()
where id = 'e6400000-0000-4000-8000-000000000001';
select is(
  (
    select final_outcome
    from private.billing_payment_checkout_cancellations
    where intent_id = 'e6300000-0000-4000-8000-000000000001'
  ),
  'paid_after_delete',
  'a late paid webhook wins without erasing durable deletion evidence'
);
select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'e6300000-0000-4000-8000-000000000001'
  ),
  'confirmed',
  'the late paid payment reopens and confirms only its exact fenced intent'
);
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'e6200000-0000-4000-8000-000000000001'
  ),
  'active',
  'late paid confirmation preserves the purchased access period'
);

select set_config('request.jwt.claim.role', '', true);
select * from finish();
rollback;
