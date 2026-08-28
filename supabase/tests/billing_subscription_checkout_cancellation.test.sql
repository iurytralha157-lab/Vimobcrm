begin;

create extension if not exists pgtap with schema extensions;
select plan(62);

select ok(
  to_regclass('private.billing_subscription_checkout_cancellations') is not null,
  'provider subscription deletion claims are durable'
);
select is(
  has_table_privilege(
    'anon',
    'private.billing_subscription_checkout_cancellations',
    'select'
  ),
  false,
  'anonymous clients cannot inspect cancellation claims'
);
select is(
  has_table_privilege(
    'service_role',
    'private.billing_subscription_checkout_cancellations',
    'select'
  ),
  false,
  'service role must use the exact cancellation RPCs'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_subscription_checkout_cancellation(uuid,uuid,text,text,text,integer)',
    'execute'
  ),
  false,
  'anonymous clients cannot claim provider deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_subscription_checkout_cancellation(uuid,uuid,text,text,text,integer)',
    'execute'
  ),
  true,
  'the trusted backend can claim an exact provider deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.finalize_billing_subscription_checkout_cancellation(uuid,uuid,uuid,text,timestamptz)',
    'execute'
  ),
  true,
  'the trusted backend can finalize the exact claimed deletion'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_subscription_checkout_cancellation_jobs(text,integer,integer)',
    'execute'
  ),
  true,
  'the trusted worker can redrive expired provider deletions through an RPC'
);

insert into public.admin_subscription_plans (
  id, name, slug, price, payment_grace_days, modules
) values (
  'c5100000-0000-4000-8000-000000000001',
  'Cancellation race plan',
  'cancellation-race-plan',
  297,
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
  asaas_customer_id,
  asaas_subscription_id
) values
  (
    'c5200000-0000-4000-8000-000000000001',
    'Paid cancellation race',
    'paid-cancellation-race',
    'paid',
    'pending_payment',
    'c5100000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    'cus_cancel_paid',
    'sub_cancel_paid'
  ),
  (
    'c5200000-0000-4000-8000-000000000002',
    'Late cancellation race',
    'late-cancellation-race',
    'paid',
    'pending_payment',
    'c5100000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    'cus_cancel_late',
    'sub_cancel_late'
  ),
  (
    'c5200000-0000-4000-8000-000000000003',
    'Legacy cancelled recurrence',
    'legacy-cancelled-recurrence',
    'paid',
    'pending_payment',
    'c5100000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    'cus_cancel_legacy',
    null
  ),
  (
    'c5200000-0000-4000-8000-000000000004',
    'Subscription before first invoice',
    'subscription-before-first-invoice',
    'paid',
    'pending_payment',
    'c5100000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    null,
    'sub_cancel_no_payment'
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
  provider_subscription_id,
  provider_response,
  provider_registered_at
) values
  (
    'c5300000-0000-4000-8000-000000000001',
    'c5200000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'PIX',
    'pending',
    'c5300000-0000-4000-8000-000000000001',
    'cus_cancel_paid',
    'pay_cancel_paid',
    'sub_cancel_paid',
    '{}'::jsonb,
    now()
  ),
  (
    'c5300000-0000-4000-8000-000000000002',
    'c5200000-0000-4000-8000-000000000002',
    'c5100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'PIX',
    'pending',
    'c5300000-0000-4000-8000-000000000002',
    'cus_cancel_late',
    'pay_cancel_late',
    'sub_cancel_late',
    '{}'::jsonb,
    now()
  ),
  (
    'c5300000-0000-4000-8000-000000000003',
    'c5200000-0000-4000-8000-000000000003',
    'c5100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'cancelled',
    'c5300000-0000-4000-8000-000000000003',
    'cus_cancel_legacy',
    'pay_cancel_legacy',
    'sub_cancel_legacy',
    '{}'::jsonb,
    now()
  ),
  (
    'c5300000-0000-4000-8000-000000000004',
    'c5200000-0000-4000-8000-000000000004',
    'c5100000-0000-4000-8000-000000000001',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'pending',
    'c5300000-0000-4000-8000-000000000004',
    'cus_cancel_no_payment',
    null,
    'sub_cancel_no_payment',
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
  last_provider_observed_at
) values
  (
    'c5400000-0000-4000-8000-000000000001',
    'c5200000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000001',
    'pay_cancel_paid',
    'cus_cancel_paid',
    'sub_cancel_paid',
    'PENDING',
    'PIX',
    297,
    current_date,
    now()
  ),
  (
    'd5400000-0000-4000-8000-000000000002',
    'c5200000-0000-4000-8000-000000000002',
    'c5300000-0000-4000-8000-000000000002',
    'pay_cancel_late',
    'cus_cancel_late',
    'sub_cancel_late',
    'PENDING',
    'PIX',
    297,
    current_date,
    now()
  ),
  (
    'd5410000-0000-4000-8000-000000000003',
    'c5200000-0000-4000-8000-000000000003',
    'c5300000-0000-4000-8000-000000000003',
    'pay_cancel_legacy',
    'cus_cancel_legacy',
    'sub_cancel_legacy',
    'CANCELED',
    'CREDIT_CARD',
    297,
    current_date,
    now()
  );

insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id,
  current_period_end,
  metadata
) values
  (
    'c5500000-0000-4000-8000-000000000001',
    'c5200000-0000-4000-8000-000000000001',
    'c5100000-0000-4000-8000-000000000001',
    'pending_payment',
    'asaas',
    'cus_cancel_paid',
    'sub_cancel_paid',
    (current_date + 30)::timestamptz,
    '{}'::jsonb
  ),
  (
    'c5500000-0000-4000-8000-000000000002',
    'c5200000-0000-4000-8000-000000000002',
    'c5100000-0000-4000-8000-000000000001',
    'pending_payment',
    'asaas',
    'cus_cancel_late',
    'sub_cancel_late',
    (current_date + 30)::timestamptz,
    '{}'::jsonb
  ),
  (
    'c5500000-0000-4000-8000-000000000004',
    'c5200000-0000-4000-8000-000000000004',
    'c5100000-0000-4000-8000-000000000001',
    'pending_payment',
    'asaas',
    'cus_cancel_no_payment',
    'sub_cancel_no_payment',
    (current_date + 30)::timestamptz,
    '{}'::jsonb
  );

insert into private.billing_card_recurrence_provisions (
  payment_id,
  provider_payment_id,
  organization_id,
  billing_intent_id,
  plan_id,
  billing_period_months,
  amount,
  provider_customer_id,
  next_due_date,
  external_reference,
  status,
  provider_subscription_id,
  completed_at,
  job_status
) values (
  'd5400000-0000-4000-8000-000000000002',
  'pay_cancel_late',
  'c5200000-0000-4000-8000-000000000002',
  'c5300000-0000-4000-8000-000000000002',
  'c5100000-0000-4000-8000-000000000001',
  1,
  297,
  'cus_cancel_late',
  current_date + 45,
  'vimob:billing-card-recurrence:d5400000-0000-4000-8000-000000000002',
  'completed',
  'sub_cancel_late',
  now(),
  'succeeded'
);

select set_config('request.jwt.claim.role', 'service_role', true);
create temporary table pgtap_paid_claim as
select public.claim_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000001',
  'c5300000-0000-4000-8000-000000000001',
  'pay_cancel_paid',
  'sub_cancel_paid',
  'worker-paid',
  120
) as result;

select is(
  (select result ->> 'outcome' from pgtap_paid_claim),
  'claimed',
  'an unpaid exact tuple is claimed before provider deletion'
);
select ok(
  (select nullif(result ->> 'claim_token', '') is not null from pgtap_paid_claim),
  'the deletion claim returns a durable fencing token'
);
select is(
  public.claim_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000001',
    'pay_cancel_paid',
    'sub_cancel_paid',
    'worker-paid',
    120
  ) ->> 'outcome',
  'already_claimed',
  'the same worker reuses its live claim idempotently'
);
select is(
  public.claim_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000001',
    'pay_cancel_paid',
    'sub_cancel_paid',
    'other-worker',
    120
  ) ->> 'outcome',
  'busy',
  'another worker cannot race the provider DELETE'
);

update public.asaas_payments
set status = 'CONFIRMED', updated_at = now()
where id = 'c5400000-0000-4000-8000-000000000001';
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'c5200000-0000-4000-8000-000000000001'
  ),
  'active',
  'a paid event can win while the deletion claim is live'
);

create temporary table pgtap_paid_finalize as
select public.finalize_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000001',
  'c5300000-0000-4000-8000-000000000001',
  (select (result ->> 'claim_token')::uuid from pgtap_paid_claim),
  'sub_cancel_paid',
  now()
) as result;
select is(
  (select result ->> 'outcome' from pgtap_paid_finalize),
  'paid_without_recurrence',
  'post-DELETE finalization preserves the paid period and reports missing recurrence'
);
select ok(
  (
    select final_outcome = 'paid_without_recurrence'
      and needs_payment_method_update
      and paid_won_at is not null
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000001'
  ),
  'the paid race is durably marked for payment-method repair'
);
select ok(
  (
    select provider_subscription_id is null
      and (metadata #>> '{recurrence,needs_payment_method_update}')::boolean
    from public.subscriptions
    where id = 'c5500000-0000-4000-8000-000000000001'
  ),
  'the deleted provider link is never presented as an active recurrence'
);
select ok(
  (
    select payment.status = 'CONFIRMED' and intent.status = 'confirmed'
    from public.asaas_payments as payment
    join private.billing_checkout_intents as intent
      on intent.id = payment.billing_intent_id
    where payment.id = 'c5400000-0000-4000-8000-000000000001'
  ),
  'paid payment and purchased-plan confirmation remain intact'
);
select is(
  public.finalize_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000001',
    'c5300000-0000-4000-8000-000000000001',
    (select (result ->> 'claim_token')::uuid from pgtap_paid_claim),
    'sub_cancel_paid',
    now()
  ) ->> 'outcome',
  'already_finalized',
  'a lost finalization response is idempotent'
);

create temporary table pgtap_active_payment_attempt as
select public.claim_billing_payment_checkout_attempt(
  'd5400000-0000-4000-8000-000000000002',
  'pay_cancel_late'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_active_payment_attempt),
  'claimed',
  'the payment checkout acquires its exact provider-mutation lease'
);
select ok(
  (
    select (result ->> 'lease_expires_at')::timestamptz
      >= clock_timestamp() + interval '240 seconds'
    from pgtap_active_payment_attempt
  ),
  'the payment lease covers two 75-second provider calls plus a safety margin'
);
select ok(
  (
    select cancellation ->> 'outcome' = 'busy'
      and cancellation ->> 'busy_reason' = 'payment_attempt'
    from (
      select public.claim_billing_subscription_checkout_cancellation(
        'c5200000-0000-4000-8000-000000000002',
        'c5300000-0000-4000-8000-000000000002',
        'pay_cancel_late',
        'sub_cancel_late',
        'worker-blocked-by-payment',
        300
      ) as cancellation
    ) as blocked
  ),
  'an active card mutation fences the irreversible subscription DELETE'
);
select is(
  (
    select count(*)::integer
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000002'
  ),
  0,
  'a blocked cancellation does not persist a misleading provider-delete claim'
);
select is(
  public.release_billing_payment_checkout_attempt(
    'd5400000-0000-4000-8000-000000000002',
    'pay_cancel_late',
    (
      select (result ->> 'lease_id')::uuid
      from pgtap_active_payment_attempt
    )
  ) ->> 'outcome',
  'released',
  'the exact payment lease can be released before cancellation is claimed'
);

create temporary table pgtap_late_claim as
select public.claim_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000002',
  'c5300000-0000-4000-8000-000000000002',
  'pay_cancel_late',
  'sub_cancel_late',
  'worker-late',
  120
) as result;
select is(
  (select result ->> 'outcome' from pgtap_late_claim),
  'claimed',
  'the second unpaid tuple is independently claimed'
);
select ok(
  (
    select external_reference
        = 'vimob:billing-card-recurrence:d5400000-0000-4000-8000-000000000002'
      and provider_customer_id = 'cus_cancel_late'
      and amount = 297
      and billing_period_months = 1
      and next_due_date = current_date + 45
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000002'
  ),
  'a card recurrence freezes its real provider validation snapshot'
);
select ok(
  (
    select attempt ->> 'outcome' = 'busy'
      and attempt ->> 'busy_reason' = 'subscription_cancellation'
    from (
      select public.claim_billing_payment_checkout_attempt(
        'd5400000-0000-4000-8000-000000000002',
        'pay_cancel_late'
      ) as attempt
    ) as blocked
  ),
  'a durable cancellation claim fences every later card provider mutation'
);
select is(
  public.finalize_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000002',
    'c5300000-0000-4000-8000-000000000002',
    (select (result ->> 'claim_token')::uuid from pgtap_late_claim),
    'sub_cancel_late',
    now()
  ) ->> 'outcome',
  'cancelled',
  'an unpaid exact tuple closes only after provider deletion succeeds'
);
select is(
  public.claim_billing_payment_checkout_attempt(
    'd5400000-0000-4000-8000-000000000002',
    'pay_cancel_late'
  ) ->> 'outcome',
  'payment_not_actionable',
  'a finalized cancellation cannot revive the payment checkout'
);
select ok(
  (
    select revoked_at is not null
      and attempt_lease_id is null
      and attempt_lease_expires_at is null
    from public.billing_payment_checkout_capabilities
    where payment_id = 'd5400000-0000-4000-8000-000000000002'
  ),
  'finalization durably revokes the bearer and scrubs every payment lease'
);
select ok(
  (
    select payment.status = 'CANCELED' and intent.status = 'cancelled'
    from public.asaas_payments as payment
    join private.billing_checkout_intents as intent
      on intent.id = payment.billing_intent_id
    where payment.id = 'd5400000-0000-4000-8000-000000000002'
  ),
  'unpaid local payment and intent are closed atomically'
);

update public.asaas_payments
set status = 'CONFIRMED', updated_at = now()
where id = 'd5400000-0000-4000-8000-000000000002';
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'c5200000-0000-4000-8000-000000000002'
  ),
  'active',
  'a settlement arriving after finalization still activates the purchased period'
);
select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'c5300000-0000-4000-8000-000000000002'
  ),
  'confirmed',
  'the exact cancelled intent is reopened only for its late paid payment'
);
select ok(
  (
    select final_outcome = 'paid_without_recurrence'
      and needs_payment_method_update
      and paid_won_at is not null
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000002'
  ),
  'the late settlement changes the durable result without restoring recurrence'
);
select is(
  (
    select asaas_subscription_id
    from public.organizations
    where id = 'c5200000-0000-4000-8000-000000000002'
  ),
  null::text,
  'the deleted provider subscription is cleared after late plan confirmation'
);
select ok(
  (
    select provider_subscription_id is null
      and (metadata #>> '{recurrence,needs_payment_method_update}')::boolean
    from public.subscriptions
    where id = 'c5500000-0000-4000-8000-000000000002'
  ),
  'late settlement remains explicitly marked as requiring a new payment method'
);

create temporary table pgtap_legacy_claim as
select public.claim_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000003',
  'c5300000-0000-4000-8000-000000000003',
  'pay_cancel_legacy',
  'sub_cancel_legacy',
  'worker-legacy',
  120
) as result;
select is(
  (select result ->> 'outcome' from pgtap_legacy_claim),
  'claimed',
  'an exact legacy cancelled CARD intent can still claim remote deletion'
);
select is(
  public.finalize_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000003',
    'c5300000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_legacy_claim),
    'sub_cancel_legacy',
    now()
  ) ->> 'outcome',
  'cancelled',
  'a provider 204 or 404 safely finalizes the legacy remote cleanup'
);
select is(
  (
    select final_outcome
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000003'
  ),
  'cancelled',
  'legacy provider cleanup has durable final evidence'
);
select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'c5300000-0000-4000-8000-000000000003'
  ),
  'cancelled',
  'remote cleanup does not reopen the unpaid legacy intent'
);

create temporary table pgtap_no_payment_claim as
select public.claim_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000004',
  'c5300000-0000-4000-8000-000000000004',
  null,
  'sub_cancel_no_payment',
  'worker-no-payment'
) as result;
select is(
  (select result ->> 'outcome' from pgtap_no_payment_claim),
  'claimed',
  'a recovered subscription can be claimed before its first invoice exists'
);
select ok(
  (
    select (result ->> 'lease_expires_at')::timestamptz
      >= clock_timestamp() + interval '540 seconds'
    from pgtap_no_payment_claim
  ),
  'the default cancellation lease covers four provider calls plus finalization margin'
);
select ok(
  (
    select provider_payment_id is null
      and provider_subscription_id = 'sub_cancel_no_payment'
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000004'
  ),
  'the provider-less claim freezes the exact intent and subscription tuple'
);
select is(
  (
    select provider_customer_id
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000004'
  ),
  'cus_cancel_no_payment',
  'a missing intent customer is frozen from the locked exact organization'
);
update private.billing_subscription_checkout_cancellations
set
  claimed_at = clock_timestamp() - interval '10 minutes',
  lease_expires_at = clock_timestamp() - interval '5 minutes',
  updated_at = clock_timestamp()
where intent_id = 'c5300000-0000-4000-8000-000000000004';

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
  last_provider_observed_at
) values (
  'd5400000-0000-4000-8000-000000000004',
  'c5200000-0000-4000-8000-000000000004',
  'c5300000-0000-4000-8000-000000000004',
  'pay_cancel_no_payment_late',
  'cus_cancel_no_payment',
  'sub_cancel_no_payment',
  'PENDING',
  'CREDIT_CARD',
  297,
  current_date,
  now()
);

create temporary table pgtap_recovered_cancel_job as
select *
from public.claim_billing_subscription_checkout_cancellation_jobs(
  'recovery-worker',
  10,
  600
);
select ok(
  (
    select count(*) = 1
      and bool_and(
        organization_id = 'c5200000-0000-4000-8000-000000000004'
        and intent_id = 'c5300000-0000-4000-8000-000000000004'
        and provider_payment_id is null
        and reconciliation_payment_id = 'pay_cancel_no_payment_late'
        and provider_subscription_id = 'sub_cancel_no_payment'
        and provider_customer_id = 'cus_cancel_no_payment'
        and external_reference = 'c5300000-0000-4000-8000-000000000004'
        and amount = 297
        and billing_period_months = 1
        and next_due_date = current_date + 30
        and claim_token <> (
          select (result ->> 'claim_token')::uuid
          from pgtap_no_payment_claim
        )
        and lease_expires_at >= clock_timestamp() + interval '540 seconds'
      )
    from pgtap_recovered_cancel_job
  ),
  'the recovery worker renews the fence and receives the frozen provider tuple'
);
select is(
  (
    select provider_payment_id
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000004'
  ),
  null::text,
  'recovery exposes the late invoice separately without rewriting the immutable claim'
);
select is(
  public.finalize_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000004',
    'c5300000-0000-4000-8000-000000000004',
    (select (result ->> 'claim_token')::uuid from pgtap_no_payment_claim),
    'sub_cancel_no_payment',
    now()
  ) ->> 'outcome',
  'lost_claim',
  'renewing an expired job fences the crashed worker token'
);
select is(
  public.finalize_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000004',
    'c5300000-0000-4000-8000-000000000004',
    (select claim_token from pgtap_recovered_cancel_job),
    'sub_cancel_no_payment',
    now()
  ) ->> 'outcome',
  'cancelled',
  'a provider 204 or 404 finalizes the provider-less claim after late-invoice reconciliation'
);
select is(
  (
    select status
    from public.asaas_payments
    where id = 'd5400000-0000-4000-8000-000000000004'
  ),
  'CANCELED',
  'finalization closes the exact late invoice discovered by the recovery claim'
);
select ok(
  (
    select intent.status = 'cancelled'
      and organization.asaas_subscription_id is null
    from private.billing_checkout_intents as intent
    join public.organizations as organization
      on organization.id = intent.organization_id
    where intent.id = 'c5300000-0000-4000-8000-000000000004'
  ),
  'provider-less cleanup closes the intent and clears only the deleted subscription'
);

select is(
  has_function_privilege(
    'anon',
    'public.fail_billing_subscription_checkout_cancellation(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  false,
  'anonymous clients cannot classify subscription cancellation failures'
);
select is(
  has_function_privilege(
    'service_role',
    'public.fail_billing_subscription_checkout_cancellation(uuid,uuid,uuid,text,text)',
    'execute'
  ),
  true,
  'the trusted worker can classify subscription cancellation failures'
);

insert into public.organizations (
  id,
  name,
  slug,
  subscription_type,
  subscription_status,
  plan_id,
  pending_plan_id,
  asaas_customer_id,
  asaas_subscription_id
) values (
  'c5200000-0000-4000-8000-000000000005',
  'Manual cancellation verification',
  'manual-cancellation-verification',
  'paid',
  'pending_payment',
  'c5100000-0000-4000-8000-000000000001',
  'c5100000-0000-4000-8000-000000000001',
  'cus_cancel_manual',
  'sub_cancel_manual'
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
  provider_subscription_id,
  provider_response,
  provider_registered_at
) values (
  'c5300000-0000-4000-8000-000000000005',
  'c5200000-0000-4000-8000-000000000005',
  'c5100000-0000-4000-8000-000000000001',
  297,
  'monthly',
  1,
  'CREDIT_CARD',
  'pending',
  'c5300000-0000-4000-8000-000000000005',
  'cus_cancel_manual',
  'pay_cancel_manual',
  'sub_cancel_manual',
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
  last_provider_observed_at
) values (
  'd5400000-0000-4000-8000-000000000005',
  'c5200000-0000-4000-8000-000000000005',
  'c5300000-0000-4000-8000-000000000005',
  'pay_cancel_manual',
  'cus_cancel_manual',
  'sub_cancel_manual',
  'PENDING',
  'CREDIT_CARD',
  297,
  current_date,
  now()
);

insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id,
  current_period_end,
  metadata
) values (
  'c5500000-0000-4000-8000-000000000005',
  'c5200000-0000-4000-8000-000000000005',
  'c5100000-0000-4000-8000-000000000001',
  'pending_payment',
  'asaas',
  'cus_cancel_manual',
  'sub_cancel_manual',
  (current_date + 30)::timestamptz,
  '{}'::jsonb
);

create temporary table pgtap_manual_claim as
select public.claim_billing_subscription_checkout_cancellation(
  'c5200000-0000-4000-8000-000000000005',
  'c5300000-0000-4000-8000-000000000005',
  'pay_cancel_manual',
  'sub_cancel_manual',
  'worker-manual',
  120
) as result;
select is(
  (select result ->> 'outcome' from pgtap_manual_claim),
  'claimed',
  'manual-review fixture starts with an exact durable claim'
);
select is(
  public.fail_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000005',
    'c5300000-0000-4000-8000-000000000005',
    gen_random_uuid(),
    'permanent',
    'provider_subscription_not_verified'
  ) ->> 'outcome',
  'lost_claim',
  'a divergent worker token cannot classify the claim'
);
select is(
  public.fail_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000005',
    'c5300000-0000-4000-8000-000000000005',
    (select (result ->> 'claim_token')::uuid from pgtap_manual_claim),
    'retryable',
    'provider_timeout'
  ) ->> 'outcome',
  'retry',
  'a transient failure remains inside the bounded retry budget'
);
select ok(
  (
    select cancellation.finalized_at is null
      and cancellation.manual_review_at is null
      and cancellation.last_error_code = 'provider_timeout'
      and capability.revoked_at is null
    from private.billing_subscription_checkout_cancellations as cancellation
    join public.billing_payment_checkout_capabilities as capability
      on capability.organization_id = cancellation.organization_id
      and capability.billing_intent_id = cancellation.intent_id
    where cancellation.intent_id = 'c5300000-0000-4000-8000-000000000005'
  ),
  'retry preserves the checkout fence without falsely terminalizing it'
);
select is(
  public.fail_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000005',
    'c5300000-0000-4000-8000-000000000005',
    (select (result ->> 'claim_token')::uuid from pgtap_manual_claim),
    'permanent',
    'provider_subscription_not_verified'
  ) ->> 'outcome',
  'manual_review',
  'an unverified provider subscription fails closed into manual review'
);
select ok(
  (
    select finalized_at is not null
      and final_outcome = 'manual_review'
      and manual_review_at is not null
      and provider_deleted_at is null
      and last_error_code = 'provider_subscription_not_verified'
    from private.billing_subscription_checkout_cancellations
    where intent_id = 'c5300000-0000-4000-8000-000000000005'
  ),
  'manual review persists a terminal state without claiming provider deletion'
);
select ok(
  (
    select revoked_at is not null
      and attempt_lease_id is null
      and attempt_lease_expires_at is null
    from public.billing_payment_checkout_capabilities
    where organization_id = 'c5200000-0000-4000-8000-000000000005'
      and billing_intent_id = 'c5300000-0000-4000-8000-000000000005'
  ),
  'manual review revokes the public payment capability and its leases'
);
select ok(
  (
    select count(*) = 1
      and bool_and(severity = 'critical')
      and bool_and(
        metadata ->> 'error_code' = 'provider_subscription_not_verified'
      )
    from public.error_events
    where fingerprint =
      'billing_subscription_cancellation_manual:c5300000-0000-4000-8000-000000000005'
  ),
  'manual review creates one critical support event with the exact reason'
);
select is(
  public.fail_billing_subscription_checkout_cancellation(
    'c5200000-0000-4000-8000-000000000005',
    'c5300000-0000-4000-8000-000000000005',
    (select (result ->> 'claim_token')::uuid from pgtap_manual_claim),
    'permanent',
    'provider_subscription_not_verified'
  ) ->> 'outcome',
  'manual_review',
  'manual-review failure replay is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.error_events
    where fingerprint =
      'billing_subscription_cancellation_manual:c5300000-0000-4000-8000-000000000005'
  ),
  1,
  'manual-review replay never duplicates the critical support event'
);
select ok(
  (
    select result ->> 'outcome' = 'already_finalized'
      and result ->> 'final_outcome' = 'manual_review'
    from (
      select public.claim_billing_subscription_checkout_cancellation(
        'c5200000-0000-4000-8000-000000000005',
        'c5300000-0000-4000-8000-000000000005',
        'pay_cancel_manual',
        'sub_cancel_manual',
        'worker-replay',
        120
      ) as result
    ) as replay
  ),
  'a terminal manual-review claim cannot be reopened'
);
select is(
  (
    select count(*)::integer
    from public.claim_billing_subscription_checkout_cancellation_jobs(
      'worker-manual-scan',
      100,
      600
    )
    where intent_id = 'c5300000-0000-4000-8000-000000000005'
  ),
  0,
  'manual-review cancellations are excluded from worker redrive'
);

select set_config('request.jwt.claim.role', '', true);
select * from finish();
rollback;
