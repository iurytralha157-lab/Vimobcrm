begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(71);

insert into public.organizations (
  id,
  name,
  slug,
  is_active,
  subscription_type,
  subscription_status,
  asaas_customer_id,
  asaas_subscription_id
)
values
  (
    'f4100000-0000-4000-8000-000000000001',
    'Asaas Reversal Active',
    'asaas-reversal-active',
    true,
    'paid',
    'active',
    'cus_reversal_active',
    'sub_reversal_active'
  ),
  (
    'f4100000-0000-4000-8000-000000000002',
    'Asaas Reversal Cancelled',
    'asaas-reversal-cancelled',
    true,
    'paid',
    'cancelled',
    'cus_reversal_cancelled',
    'sub_reversal_cancelled'
  ),
  (
    'f4100000-0000-4000-8000-000000000003',
    'Asaas Reversal Other',
    'asaas-reversal-other',
    true,
    'paid',
    'active',
    'cus_reversal_other',
    'sub_reversal_other'
  ),
  (
    'f4100000-0000-4000-8000-000000000004',
    'Asaas equal-second ordering',
    'asaas-equal-second-ordering',
    true,
    'paid',
    'pending_payment',
    'cus_equal_second',
    'sub_equal_second'
  ),
  (
    'f4100000-0000-4000-8000-000000000005',
    'Asaas risk rejection',
    'asaas-risk-rejection',
    true,
    'paid',
    'active',
    'cus_risk_rejection',
    'sub_risk_rejection'
  ),
  (
    'f4100000-0000-4000-8000-000000000006',
    'Asaas refund denied',
    'asaas-refund-denied',
    true,
    'paid',
    'active',
    'cus_refund_denied',
    'sub_refund_denied'
  ),
  (
    'f4100000-0000-4000-8000-000000000007',
    'Asaas refund denied first webhook',
    'asaas-refund-denied-first-webhook',
    true,
    'paid',
    'pending_payment',
    'cus_refund_denied_first',
    'sub_refund_denied_first'
  ),
  (
    'f4100000-0000-4000-8000-000000000008',
    'Asaas refund denied polling',
    'asaas-refund-denied-polling',
    true,
    'paid',
    'pending_payment',
    'cus_refund_denied_poll',
    'sub_refund_denied_poll'
  ),
  (
    'f4100000-0000-4000-8000-000000000009',
    'Asaas refund denied multi payment',
    'asaas-refund-denied-multi-payment',
    true,
    'paid',
    'active',
    'cus_refund_denied_multi',
    'sub_refund_denied_multi'
  ),
  (
    'f4100000-0000-4000-8000-000000000010',
    'Asaas multiple open refund requests',
    'asaas-multiple-open-refund-requests',
    true,
    'paid',
    'active',
    'cus_multiple_refunds',
    'sub_multiple_refunds'
  ),
  (
    'f4100000-0000-4000-8000-000000000011',
    'Asaas unrelated overdue invoice',
    'asaas-unrelated-overdue-invoice',
    true,
    'paid',
    'active',
    'cus_unrelated_overdue',
    'sub_unrelated_overdue'
  );

select has_column(
  'public',
  'asaas_payments',
  'last_provider_observed_at',
  'payment rows retain the periodic provider observation cursor'
);

select has_table(
  'private',
  'billing_organization_access_causes',
  'multi-payment suspension causality is durable private state'
);

select ok(
  not has_table_privilege('anon', 'private.billing_organization_access_causes', 'SELECT')
  and not has_table_privilege('authenticated', 'private.billing_organization_access_causes', 'SELECT')
  and not has_table_privilege('service_role', 'private.billing_organization_access_causes', 'SELECT'),
  'browser and service bearer roles cannot read or mutate private suspension causality'
);

select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_payment_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot invoke payment reconciliation'
);

select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_payment_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  true,
  'the service role keeps access to payment reconciliation'
);

select ok(
  to_regprocedure(
    'public.reconcile_asaas_payment_webhook_with_period_intent(text,text,timestamptz,jsonb,jsonb)'
  ) is not null,
  'the latest public webhook wrapper signature remains available'
);

select is(
  private.correct_asaas_naive_event_timestamp(
    '{"dateCreated":"2026-08-04 12:34:56"}'::jsonb
  ),
  '2026-08-04 15:34:56+00'::timestamptz,
  'naive Asaas dateCreated is interpreted in America/Sao_Paulo'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_equal_second_paid',
    'PAYMENT_RECEIVED',
    '2026-08-04 12:34:56+00',
    '{"id":"pay_equal_second","customer":"cus_equal_second","subscription":"sub_equal_second","externalReference":"f4100000-0000-4000-8000-000000000004","status":"RECEIVED"}'::jsonb,
    '{"event":"PAYMENT_RECEIVED","dateCreated":"2026-08-04 12:34:56"}'::jsonb
  ) ->> 'subscription_status',
  'active',
  'the first paid event activates the exact organization'
);

select is(
  (
    select last_webhook_event_at
    from public.asaas_payments
    where asaas_payment_id = 'pay_equal_second'
  ),
  '2026-08-04 15:34:56+00'::timestamptz,
  'the durable payment cursor stores the corrected provider instant'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_equal_second_chargeback',
    'PAYMENT_CHARGEBACK',
    '2026-08-04 12:34:56+00',
    '{"id":"pay_equal_second","customer":"cus_equal_second","subscription":"sub_equal_second","externalReference":"f4100000-0000-4000-8000-000000000004","status":"CHARGEBACK"}'::jsonb,
    '{"event":"PAYMENT_CHARGEBACK","dateCreated":"2026-08-04 12:34:56"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'plain CHARGEBACK wins an equal-second paid event and suspends access'
);

select is(
  (
    select status
    from public.asaas_payments
    where asaas_payment_id = 'pay_equal_second'
  ),
  'CHARGEBACK',
  'plain CHARGEBACK is persisted on the payment row'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_equal_second_paid_replay',
    'PAYMENT_RECEIVED',
    '2026-08-04 12:34:56+00',
    '{"id":"pay_equal_second","customer":"cus_equal_second","subscription":"sub_equal_second","externalReference":"f4100000-0000-4000-8000-000000000004","status":"RECEIVED"}'::jsonb,
    '{"event":"PAYMENT_RECEIVED","dateCreated":"2026-08-04 12:34:56"}'::jsonb
  ) ->> 'outcome',
  'stale',
  'an equal-second paid replay cannot overwrite an adverse state'
);

select is(
  (
    select subscription_status
    from public.organizations
    where id = 'f4100000-0000-4000-8000-000000000004'
  ),
  'suspended',
  'the equal-second paid replay leaves organization access suspended'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_risk_reproved',
    'PAYMENT_REPROVED_BY_RISK_ANALYSIS',
    '2026-08-04 13:00:00-03',
    '{"id":"pay_risk_reproved","customer":"cus_risk_rejection","subscription":"sub_risk_rejection","externalReference":"f4100000-0000-4000-8000-000000000005","status":"REPROVED_BY_RISK_ANALYSIS"}'::jsonb,
    '{"event":"PAYMENT_REPROVED_BY_RISK_ANALYSIS","dateCreated":"2026-08-04 13:00:00"}'::jsonb
  ) ->> 'subscription_status',
  'overdue',
  'risk-analysis rejection removes paid access through the canonical overdue state'
);

select is(
  (
    select status
    from public.asaas_payments
    where asaas_payment_id = 'pay_risk_reproved'
  ),
  'REPROVED_BY_RISK_ANALYSIS',
  'risk-analysis rejection is persisted exactly'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_denied_requested',
    'PAYMENT_REFUND_REQUESTED',
    '2026-08-04 14:00:00-03',
    '{"id":"pay_refund_denied","customer":"cus_refund_denied","subscription":"sub_refund_denied","externalReference":"f4100000-0000-4000-8000-000000000006","status":"REFUND_REQUESTED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_REQUESTED","dateCreated":"2026-08-04 14:00:00"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a refund request first suspends the exact organization'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_denied_final',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 14:00:01-03',
    '{"id":"pay_refund_denied","customer":"cus_refund_denied","subscription":"sub_refund_denied","externalReference":"f4100000-0000-4000-8000-000000000006","status":"REFUND_DENIED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 14:00:01"}'::jsonb
  ) ->> 'subscription_status',
  'active',
  'REFUND_DENIED restores access because the funds remain settled'
);

select ok(
  (
    select private.billing_payment_checkout_is_paid(status)
    from public.asaas_payments
    where asaas_payment_id = 'pay_refund_denied'
  ),
  'REFUND_DENIED leaves a financially paid status eligible for receipt/access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_multi_requested_a',
    'PAYMENT_REFUND_REQUESTED',
    '2026-08-04 14:10:00-03',
    '{"id":"pay_refund_multi_a","customer":"cus_refund_denied_multi","subscription":"sub_refund_denied_multi","externalReference":"f4100000-0000-4000-8000-000000000009","status":"REFUND_REQUESTED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_REQUESTED","dateCreated":"2026-08-04 14:10:00"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'invoice A refund request suspends the multi-payment organization'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_multi_chargeback_b',
    'PAYMENT_CHARGEBACK',
    '2026-08-04 14:10:01-03',
    '{"id":"pay_refund_multi_b","customer":"cus_refund_denied_multi","subscription":"sub_refund_denied_multi","externalReference":"f4100000-0000-4000-8000-000000000009","status":"CHARGEBACK"}'::jsonb,
    '{"event":"PAYMENT_CHARGEBACK","dateCreated":"2026-08-04 14:10:01"}'::jsonb
  ) ->> 'outcome',
  'processed',
  'newer invoice B chargeback becomes the exact suspension cause even while already suspended'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_multi_denied_a',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 14:10:02-03',
    '{"id":"pay_refund_multi_a","customer":"cus_refund_denied_multi","subscription":"sub_refund_denied_multi","externalReference":"f4100000-0000-4000-8000-000000000009","status":"REFUND_DENIED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 14:10:02"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'invoice A refund denial cannot reactivate access suspended by invoice B chargeback'
);

select is(
  (
    select cause.provider_payment_id || ':' || cause.payment_status
    from private.billing_organization_access_causes as cause
    where cause.organization_id = 'f4100000-0000-4000-8000-000000000009'
  ),
  'pay_refund_multi_b:CHARGEBACK',
  'the unrelated invoice B chargeback remains the durable suspension cause'
);

select is(
  (
    select count(*)
    from public.error_events as error_event
    where error_event.organization_id = 'f4100000-0000-4000-8000-000000000009'
      and error_event.error_code = 'refund_denied_unrelated_suspension'
  ),
  1::bigint,
  'the conflicting refund denial is surfaced exactly once for assisted review'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_multi_refund_requested_a',
    'PAYMENT_REFUND_REQUESTED',
    '2026-08-04 14:20:00-03',
    '{"id":"pay_multi_refund_a","customer":"cus_multiple_refunds","subscription":"sub_multiple_refunds","externalReference":"f4100000-0000-4000-8000-000000000010","status":"REFUND_REQUESTED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_REQUESTED","dateCreated":"2026-08-04 14:20:00"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'the first open refund request creates its own restriction cause'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_multi_refund_requested_b',
    'PAYMENT_REFUND_REQUESTED',
    '2026-08-04 14:20:01-03',
    '{"id":"pay_multi_refund_b","customer":"cus_multiple_refunds","subscription":"sub_multiple_refunds","externalReference":"f4100000-0000-4000-8000-000000000010","status":"REFUND_REQUESTED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_REQUESTED","dateCreated":"2026-08-04 14:20:01"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'the second open refund request keeps access suspended'
);

select is(
  (
    select count(*)
    from private.billing_organization_access_causes as cause
    where cause.organization_id = 'f4100000-0000-4000-8000-000000000010'
  ),
  2::bigint,
  'both payment-specific refund restrictions are retained concurrently'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_multi_refund_denied_b',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 14:20:02-03',
    '{"id":"pay_multi_refund_b","customer":"cus_multiple_refunds","subscription":"sub_multiple_refunds","externalReference":"f4100000-0000-4000-8000-000000000010","status":"REFUND_DENIED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 14:20:02"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'denying refund B cannot clear the still-open refund A restriction'
);

select is(
  (
    select string_agg(cause.provider_payment_id, ',' order by cause.provider_payment_id)
    from private.billing_organization_access_causes as cause
    where cause.organization_id = 'f4100000-0000-4000-8000-000000000010'
  ),
  'pay_multi_refund_a',
  'only the exact resolved refund B cause is removed'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_multi_refund_denied_a',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 14:20:03-03',
    '{"id":"pay_multi_refund_a","customer":"cus_multiple_refunds","subscription":"sub_multiple_refunds","externalReference":"f4100000-0000-4000-8000-000000000010","status":"REFUND_DENIED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 14:20:03"}'::jsonb
  ) ->> 'subscription_status',
  'active',
  'access returns only after the final open refund cause is resolved'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_unrelated_overdue_b',
    'PAYMENT_OVERDUE',
    '2026-08-04 14:30:00-03',
    '{"id":"pay_unrelated_overdue_b","customer":"cus_unrelated_overdue","subscription":"sub_unrelated_overdue","externalReference":"f4100000-0000-4000-8000-000000000011","status":"OVERDUE"}'::jsonb,
    '{"event":"PAYMENT_OVERDUE","dateCreated":"2026-08-04 14:30:00"}'::jsonb
  ) ->> 'subscription_status',
  'overdue',
  'invoice B overdue becomes a payment-specific restriction cause'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_unrelated_denied_a',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 14:30:01-03',
    '{"id":"pay_unrelated_denied_a","customer":"cus_unrelated_overdue","subscription":"sub_unrelated_overdue","externalReference":"f4100000-0000-4000-8000-000000000011","status":"REFUND_DENIED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 14:30:01"}'::jsonb
  ) ->> 'subscription_status',
  'overdue',
  'invoice A refund denial cannot clear invoice B overdue access restriction'
);

select is(
  (
    select cause.provider_payment_id || ':' || cause.payment_status
    from private.billing_organization_access_causes as cause
    where cause.organization_id = 'f4100000-0000-4000-8000-000000000011'
  ),
  'pay_unrelated_overdue_b:OVERDUE',
  'invoice B remains the durable overdue cause after invoice A denial'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_unrelated_paid_a',
    'PAYMENT_RECEIVED',
    '2026-08-04 14:30:02-03',
    '{"id":"pay_unrelated_denied_a","customer":"cus_unrelated_overdue","subscription":"sub_unrelated_overdue","externalReference":"f4100000-0000-4000-8000-000000000011","status":"RECEIVED","paymentDate":"2026-08-04"}'::jsonb,
    '{"event":"PAYMENT_RECEIVED","dateCreated":"2026-08-04 14:30:02"}'::jsonb
  ) ->> 'subscription_status',
  'overdue',
  'a newer paid event for old invoice A still cannot clear invoice B overdue cause'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_refund_denied_first',
    'PAYMENT_REFUND_DENIED',
    '2026-08-04 15:00:00-03',
    '{"id":"pay_refund_denied_first","customer":"cus_refund_denied_first","subscription":"sub_refund_denied_first","externalReference":"f4100000-0000-4000-8000-000000000007","status":"REFUND_DENIED"}'::jsonb,
    '{"event":"PAYMENT_REFUND_DENIED","dateCreated":"2026-08-04 15:00:00"}'::jsonb
  ) ->> 'subscription_status',
  'active',
  'REFUND_DENIED as the first webhook is sufficient proof to activate access'
);
select is(
  (
    select count(*)
    from public.billing_payment_receipts as receipt
    join public.asaas_payments as payment on payment.id = receipt.payment_id
    where payment.asaas_payment_id = 'pay_refund_denied_first'
  ),
  1::bigint,
  'the first REFUND_DENIED proof creates one immutable receipt'
);

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  last_provider_observed_at
) values (
  'f4100000-0000-4000-8000-000000000008',
  'pay_refund_denied_poll',
  'cus_refund_denied_poll',
  'sub_refund_denied_poll',
  'PENDING',
  'PIX',
  297,
  '2026-08-10',
  '2026-08-04 18:30:00+00'
);

select is(
  public.reconcile_asaas_payment_snapshot(
    'f4100000-0000-4000-8000-000000000008',
    'pay_refund_denied_poll',
    'cus_refund_denied_poll',
    'sub_refund_denied_poll',
    'REFUND_DENIED',
    297,
    '2026-08-10',
    '2026-08-04 18:30:00+00',
    'pgtap_refund_denied'
  ) ->> 'outcome',
  'applied',
  'equal-second polling REFUND_DENIED outranks pending and applies'
);
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'f4100000-0000-4000-8000-000000000008'
  ),
  'active',
  'polling REFUND_DENIED activates access when the paid webhook was lost'
);
select is(
  (
    select count(*)
    from public.billing_payment_receipts as receipt
    join public.asaas_payments as payment on payment.id = receipt.payment_id
    where payment.asaas_payment_id = 'pay_refund_denied_poll'
  ),
  1::bigint,
  'polling-only REFUND_DENIED creates exactly one immutable receipt'
);

select ok(
  to_regprocedure(
    'private.apply_asaas_billing_snapshot_with_payment(uuid,text,text,text,text,text,numeric,date,timestamptz,text)'
  ) is not null,
  'the Go polling wrapper signature remains available'
);

select ok(
  to_regprocedure(
    'private.apply_asaas_billing_snapshot_with_payment(uuid,text,text,text,text,text,numeric,date,date,timestamptz,text)'
  ) is not null,
  'the polling overload accepts the exact payment due date'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_refunded',
    'PAYMENT_REFUNDED',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_REFUNDED"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a refunded webhook suspends access even when the embedded status is stale'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_refund_requested',
    'PAYMENT_REFUND_REQUESTED',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_REFUND_REQUESTED"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a requested refund webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_refund_progress',
    'PAYMENT_REFUND_IN_PROGRESS',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_REFUND_IN_PROGRESS"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a refund in progress webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_partial',
    'PAYMENT_PARTIALLY_REFUNDED',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_PARTIALLY_REFUNDED"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a partial refund webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_cash_undone',
    'PAYMENT_RECEIVED_IN_CASH_UNDONE',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_RECEIVED_IN_CASH_UNDONE"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'an undone cash receipt webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_chargeback_requested',
    'PAYMENT_CHARGEBACK_REQUESTED',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_CHARGEBACK_REQUESTED"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a requested chargeback webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_chargeback_dispute',
    'PAYMENT_CHARGEBACK_DISPUTE',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_CHARGEBACK_DISPUTE"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'a chargeback dispute webhook suspends access'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_chargeback_reversal',
    'PAYMENT_AWAITING_CHARGEBACK_REVERSAL',
    now(),
    '{"id":"pay_reversal_webhook","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"CONFIRMED"}'::jsonb,
    '{"event":"PAYMENT_AWAITING_CHARGEBACK_REVERSAL"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'an awaiting chargeback reversal webhook keeps access suspended'
);

select is(
  (
    select subscription_status
    from public.organizations
    where id = 'f4100000-0000-4000-8000-000000000001'
  ),
  'suspended',
  'the webhook state is persisted on the organization'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_cancelled_org',
    'PAYMENT_REFUNDED',
    now(),
    '{"id":"pay_reversal_cancelled","customer":"cus_reversal_cancelled","subscription":"sub_reversal_cancelled","externalReference":"f4100000-0000-4000-8000-000000000002","status":"REFUNDED"}'::jsonb,
    '{"event":"PAYMENT_REFUNDED"}'::jsonb
  ) ->> 'subscription_status',
  'cancelled',
  'a webhook cannot revive or rewrite an explicitly cancelled organization'
);

select ok(
  (
    select result ->> 'outcome' in ('processed', 'stale')
      and result ->> 'subscription_status' = 'suspended'
    from (
      select public.reconcile_asaas_payment_webhook(
        'evt_reversal_suspended_paid',
        'PAYMENT_RECEIVED',
        now(),
        '{"id":"pay_reversal_suspended_paid","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"RECEIVED"}'::jsonb,
        '{"event":"PAYMENT_RECEIVED"}'::jsonb
      ) as result
    ) payment_event
  ),
  'a paid webhook cannot revive a suspended organization without a new checkout'
);

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  last_provider_observed_at
)
values
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_refunded', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_requested', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_progress', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_partial', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_cash_undone', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_chargeback', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_dispute', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_poll_awaiting', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000002', 'pay_poll_cancelled', 'cus_reversal_cancelled', 'sub_reversal_cancelled', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '2 hours'),
  ('f4100000-0000-4000-8000-000000000001', 'pay_reversal_older_other', 'cus_reversal_active', 'sub_reversal_active', 'PENDING', 'PIX', 297, '2026-08-10', now() - interval '3 hours');

create or replace function pg_temp.prepare_reversal_poll()
returns void
language plpgsql
as $function$
begin
  update public.organizations
  set
    subscription_status = 'active',
    billing_last_reconciled_at = null,
    asaas_last_event_at = null,
    asaas_last_event_received_at = null
  where id = 'f4100000-0000-4000-8000-000000000001';

  update public.asaas_payments
  set
    last_webhook_event_at = null,
    last_webhook_received_at = null,
    last_provider_observed_at = now() - interval '1 hour'
  where organization_id = 'f4100000-0000-4000-8000-000000000001';
end
$function$;

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_refunded', 'REFUNDED', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a refunded payment suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_requested', 'REFUND_REQUESTED', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a requested refund suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_progress', 'REFUND_IN_PROGRESS', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a refund in progress suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_partial', 'PARTIALLY_REFUNDED', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a partial refund suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_cash_undone', 'RECEIVED_IN_CASH_UNDONE', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling an undone cash receipt suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_chargeback', 'CHARGEBACK_REQUESTED', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a requested chargeback suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_dispute', 'CHARGEBACK_DISPUTE', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling a chargeback dispute suspends access'
);

select pg_temp.prepare_reversal_poll();
select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_awaiting', 'AWAITING_CHARGEBACK_REVERSAL', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'suspended',
  'polling an awaiting chargeback reversal keeps access suspended'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000002', 'cus_reversal_cancelled',
    'sub_reversal_cancelled', 'ACTIVE', 'pay_poll_cancelled', 'REFUNDED', 297,
    '2026-08-10', null, now(), 'pgtap_reversal'
  ) ->> 'status',
  'cancelled',
  'periodic reconciliation cannot revive an explicitly cancelled organization'
);

select is(
  (
    select status
    from public.asaas_payments
    where asaas_payment_id = 'pay_poll_progress'
  ),
  'REFUND_IN_PROGRESS',
  'polling persists the exact reversal status used to suspend access'
);

select ok(
  (
    select last_provider_observed_at is not null
    from public.asaas_payments
    where asaas_payment_id = 'pay_poll_progress'
  ),
  'polling persists the provider observation time used for ordering'
);

insert into public.notifications (
  organization_id,
  user_id,
  title,
  content,
  body,
  type,
  channel,
  is_read,
  metadata
)
select
  payment.organization_id,
  null,
  'Pending receipt delivery',
  'Payment confirmed',
  'Payment confirmed',
  'billing',
  'external',
  true,
  jsonb_build_object(
    'event_key', 'billing_payment_receipt',
    'payment_id', payment.id::text,
    'receipt_id', gen_random_uuid()::text,
    'dedupe_key', 'billing_payment_receipt:' || payment.id::text,
    'dispatch', jsonb_build_object(
      'whatsapp', jsonb_build_object('required', true, 'status', 'processing'),
      'email', jsonb_build_object('required', true, 'status', 'pending')
    ),
    'whatsapp_dispatch_required', true,
    'whatsapp_dispatch', jsonb_build_object('status', 'processing')
  )
from public.asaas_payments payment
where payment.asaas_payment_id = 'pay_poll_progress';

update public.asaas_payments
set status = 'REFUND_IN_PROGRESS'
where asaas_payment_id = 'pay_poll_progress';

select ok(
  (
    select (notification.metadata ->> 'receipt_invalidated')::boolean
      and notification.metadata ->> 'receipt_invalidation_status' = 'REFUND_IN_PROGRESS'
      and notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status' = 'skipped'
      and notification.metadata -> 'dispatch' -> 'email' ->> 'status' = 'skipped'
      and not (notification.metadata -> 'dispatch' -> 'email' ->> 'required')::boolean
    from public.notifications notification
    where notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and notification.metadata ->> 'payment_id' = (
        select payment.id::text
        from public.asaas_payments payment
        where payment.asaas_payment_id = 'pay_poll_progress'
      )
  ),
  'a reversal atomically cancels every unsent receipt delivery channel'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000003', 'cus_reversal_other',
    'sub_reversal_other', 'ACTIVE', 'pay_poll_progress', 'REFUNDED', 297,
    '2026-08-10', null, now(), 'pgtap_identity_conflict'
  ) ->> 'outcome',
  'identifier_mismatch',
  'polling cannot rebind an existing payment to another organization'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_poll_progress', 'RECEIVED', 297,
    '2026-08-10', null, now() - interval '1 hour', 'pgtap_stale_snapshot'
  ) ->> 'outcome',
  'stale',
  'an older polling response cannot overwrite a newer payment observation'
);

update public.organizations
set subscription_status = 'active', billing_last_reconciled_at = null
where id = 'f4100000-0000-4000-8000-000000000001';

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_reversal_newer_payment',
    'PAYMENT_RECEIVED',
    now(),
    '{"id":"pay_reversal_newer","customer":"cus_reversal_active","subscription":"sub_reversal_active","externalReference":"f4100000-0000-4000-8000-000000000001","status":"RECEIVED"}'::jsonb,
    '{"event":"PAYMENT_RECEIVED"}'::jsonb
  ) ->> 'subscription_status',
  'active',
  'a newer paid webhook restores the organization before the old poll returns'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4100000-0000-4000-8000-000000000001', 'cus_reversal_active',
    'sub_reversal_active', 'ACTIVE', 'pay_reversal_older_other', 'REFUNDED', 297,
    '2026-08-10', null, now() - interval '1 hour', 'pgtap_cross_payment_stale'
  ) ->> 'outcome',
  'stale',
  'an older reversal poll for another payment loses to the organization webhook cursor'
);

select is(
  (
    select subscription_status
    from public.organizations
    where id = 'f4100000-0000-4000-8000-000000000001'
  ),
  'active',
  'the older cross-payment poll cannot suspend a state restored by a newer webhook'
);

insert into public.admin_subscription_plans (
  id,
  name,
  slug,
  price,
  payment_grace_days,
  modules
)
values
  (
    'f4400000-0000-4000-8000-000000000001',
    'Polling cursor current plan',
    'polling-cursor-current-plan',
    99,
    3,
    array[]::text[]
  ),
  (
    'f4400000-0000-4000-8000-000000000002',
    'Polling cursor target plan',
    'polling-cursor-target-plan',
    297,
    3,
    array[]::text[]
  );

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  is_active,
  subscription_type,
  subscription_status,
  asaas_customer_id,
  asaas_subscription_id
)
values (
  'f4500000-0000-4000-8000-000000000001',
  'Polling cursor pending intent',
  'polling-cursor-pending-intent',
  'f4400000-0000-4000-8000-000000000001',
  'f4400000-0000-4000-8000-000000000002',
  true,
  'paid',
  'pending_payment',
  'cus_poll_cursor',
  'sub_poll_cursor'
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
)
values (
  'f4600000-0000-4000-8000-000000000001',
  'f4500000-0000-4000-8000-000000000001',
  'f4400000-0000-4000-8000-000000000002',
  297,
  'monthly',
  1,
  'CREDIT_CARD',
  'pending',
  'f4600000-0000-4000-8000-000000000001',
  'cus_poll_cursor',
  'pay_poll_cursor',
  'sub_poll_cursor',
  '{}'::jsonb,
  now()
);

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  value,
  due_date,
  last_provider_observed_at
)
values (
  'f4500000-0000-4000-8000-000000000001',
  'pay_poll_cursor',
  'cus_poll_cursor',
  'sub_poll_cursor',
  'PENDING',
  297,
  current_date,
  now() - interval '2 minutes'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'f4500000-0000-4000-8000-000000000001',
    'cus_poll_cursor',
    'sub_poll_cursor',
    'ACTIVE',
    'pay_poll_cursor',
    'CONFIRMED',
    297,
    current_date,
    current_date + 30,
    now() - interval '1 minute',
    'pgtap_existing_payment_cursor'
  ) ->> 'outcome',
  'applied',
  'polling can apply T1 for an existing payment observed at T0'
);

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'f4600000-0000-4000-8000-000000000001'
  ),
  'confirmed',
  'the T1 paid polling snapshot confirms the pending checkout intent'
);

select is(
  (
    select last_provider_observed_at
    from public.asaas_payments
    where asaas_payment_id = 'pay_poll_cursor'
  ),
  now() - interval '1 minute',
  'the paid polling snapshot persists the exact T1 payment cursor'
);

select * from finish();
rollback;
