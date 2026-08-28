begin;

create extension if not exists pgtap with schema extensions;
select plan(52);

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
    'b1000000-0000-4000-8000-000000000001',
    'Asaas Webhook Org A',
    'asaas-webhook-org-a',
    true,
    'paid',
    'pending_payment',
    'cus_webhook_a',
    'sub_webhook_a'
  ),
  (
    'b1000000-0000-4000-8000-000000000002',
    'Asaas Webhook Org B',
    'asaas-webhook-org-b',
    true,
    'paid',
    'pending_payment',
    'cus_webhook_b',
    'sub_webhook_b'
  ),
  (
    'b1000000-0000-4000-8000-000000000003',
    'Asaas Ambiguous Customer A',
    'asaas-ambiguous-customer-a',
    true,
    'paid',
    'pending_payment',
    'cus_ambiguous',
    null
  ),
  (
    'b1000000-0000-4000-8000-000000000004',
    'Asaas Ambiguous Customer B',
    'asaas-ambiguous-customer-b',
    true,
    'paid',
    'pending_payment',
    'cus_ambiguous',
    null
  ),
  (
    'b1000000-0000-4000-8000-000000000005',
    'Asaas Subscription Webhook Org',
    'asaas-subscription-webhook-org',
    true,
    'paid',
    'pending_payment',
    null,
    null
  );

insert into public.subscriptions (
  id,
  organization_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id
)
values
  (
    'b2000000-0000-4000-8000-000000000001',
    'b1000000-0000-4000-8000-000000000001',
    'pending_payment',
    'asaas',
    'cus_webhook_a',
    'sub_webhook_a'
  ),
  (
    'b2000000-0000-4000-8000-000000000005',
    'b1000000-0000-4000-8000-000000000005',
    'pending_payment',
    null,
    null,
    null
  );

select has_table('private', 'asaas_webhook_events', 'Asaas webhook inbox is private');
select is(
  (select relrowsecurity from pg_class where oid = 'private.asaas_webhook_events'::regclass),
  true,
  'private webhook audit keeps RLS as defense in depth'
);
select has_column(
  'public',
  'asaas_payments',
  'last_webhook_event_id',
  'payments retain the last provider event id'
);
select has_column(
  'public',
  'organizations',
  'asaas_last_event_at',
  'organizations retain provider event ordering'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_payment_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot invoke billing reconciliation'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_payment_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  true,
  'service role can invoke billing reconciliation'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_subscription_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot invoke subscription reconciliation'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_subscription_webhook(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  true,
  'service role can invoke subscription reconciliation'
);
select is(
  has_table_privilege('authenticated', 'private.asaas_webhook_events', 'select'),
  false,
  'raw Asaas webhook payloads are not readable by authenticated clients'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.register_pending_asaas_subscription(uuid,text,text)',
    'execute'
  )
  and has_function_privilege(
    'service_role',
    'public.register_pending_asaas_subscription(uuid,text,text)',
    'execute'
  ),
  'only service role can register a pending provider subscription'
);
select is(
  public.register_pending_asaas_subscription(
    'b1000000-0000-4000-8000-000000000002',
    'cus_webhook_b_registered',
    'sub_webhook_b_registered'
  ) ->> 'outcome',
  'registered',
  'new card subscription is registered atomically as pending'
);
select ok(
  (
    select subscription_status = 'pending_payment'
      and asaas_customer_id = 'cus_webhook_b_registered'
      and asaas_subscription_id = 'sub_webhook_b_registered'
    from public.organizations
    where id = 'b1000000-0000-4000-8000-000000000002'
  ),
  'pending registration stores provider linkage without activating access'
);
insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  last_webhook_event_id,
  last_webhook_event_at
)
values (
  'b1000000-0000-4000-8000-000000000002',
  'pay_obsolete_subscription_b',
  'cus_webhook_b',
  'sub_webhook_b',
  'PENDING',
  'evt_obsolete_created_b',
  '2026-07-28T09:00:00Z'
);
select is(
  public.reconcile_asaas_payment_webhook(
    'evt_obsolete_confirmed_b',
    'PAYMENT_CONFIRMED',
    '2026-07-28T09:05:00Z',
    '{
      "id":"pay_obsolete_subscription_b",
      "customer":"cus_webhook_b",
      "subscription":"sub_webhook_b",
      "status":"CONFIRMED"
    }'::jsonb,
    '{"id":"evt_obsolete_confirmed_b","event":"PAYMENT_CONFIRMED"}'::jsonb
  ) ->> 'outcome',
  'stale',
  'event from a replaced provider subscription cannot change organization state'
);
select ok(
  (
    select subscription_status = 'pending_payment'
      and asaas_customer_id = 'cus_webhook_b_registered'
      and asaas_subscription_id = 'sub_webhook_b_registered'
    from public.organizations
    where id = 'b1000000-0000-4000-8000-000000000002'
  ),
  'obsolete subscription confirmation cannot restore superseded provider linkage'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_created_a',
    'PAYMENT_CREATED',
    '2026-07-28T10:00:00Z',
    '{
      "id":"pay_webhook_a",
      "customer":"cus_webhook_a",
      "subscription":"sub_webhook_a",
      "externalReference":"b1000000-0000-4000-8000-000000000001",
      "status":"PENDING",
      "billingType":"CREDIT_CARD",
      "value":299.90,
      "dueDate":"2026-07-28"
    }'::jsonb,
    '{"id":"evt_created_a","event":"PAYMENT_CREATED"}'::jsonb
  ) ->> 'outcome',
  'processed',
  'first delivery is processed'
);
select is(
  (select status from public.asaas_payments where asaas_payment_id = 'pay_webhook_a'),
  'PENDING',
  'created charge is stored as pending'
);
select is(
  (select subscription_status from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  'pending_payment',
  'charge creation does not activate the organization'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_created_a',
    'PAYMENT_RECEIVED',
    '2026-07-28T10:01:00Z',
    '{
      "id":"pay_webhook_a",
      "customer":"cus_webhook_a",
      "subscription":"sub_webhook_a",
      "status":"RECEIVED"
    }'::jsonb,
    '{"id":"evt_created_a","event":"PAYMENT_RECEIVED"}'::jsonb
  ) ->> 'outcome',
  'duplicate',
  'a retried event id is acknowledged without reprocessing'
);
select ok(
  (select status = 'PENDING' from public.asaas_payments where asaas_payment_id = 'pay_webhook_a')
    and
  (select count(*) = 1 from private.asaas_webhook_events where event_id = 'evt_created_a'),
  'duplicate delivery cannot mutate payment state'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_confirmed_a',
    'PAYMENT_CONFIRMED',
    '2026-07-28T10:05:00Z',
    '{
      "id":"pay_webhook_a",
      "customer":"cus_webhook_a",
      "subscription":"sub_webhook_a",
      "status":"CONFIRMED",
      "billingType":"CREDIT_CARD",
      "value":299.90,
      "netValue":291.20,
      "dueDate":"2026-07-28",
      "paymentDate":"2026-07-28"
    }'::jsonb,
    '{"id":"evt_confirmed_a","event":"PAYMENT_CONFIRMED"}'::jsonb
  ) ->> 'outcome',
  'processed',
  'confirmation event is processed'
);
select is(
  (select subscription_status from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  'active',
  'only payment confirmation activates the organization'
);
select is(
  (select next_billing_date from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  '2026-08-28'::date,
  'monthly renewal keeps the provider due day'
);
select lives_ok(
  $$
    select public.register_pending_asaas_subscription(
      'b1000000-0000-4000-8000-000000000001',
      'cus_webhook_a',
      'sub_webhook_a'
    )
  $$,
  'provider registration can safely retry after a fast confirmation webhook'
);
select is(
  (select subscription_status from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  'active',
  'late registration response cannot downgrade a confirmed subscription'
);
select ok(
  (
    select status = 'CONFIRMED'
      and asaas_customer_id = 'cus_webhook_a'
      and asaas_subscription_id = 'sub_webhook_a'
      and last_webhook_event_id = 'evt_confirmed_a'
    from public.asaas_payments
    where asaas_payment_id = 'pay_webhook_a'
  ),
  'confirmed payment stores provider linkage and ordering metadata'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_stale_overdue_a',
    'PAYMENT_OVERDUE',
    '2026-07-28T10:03:00Z',
    '{
      "id":"pay_webhook_a",
      "customer":"cus_webhook_a",
      "subscription":"sub_webhook_a",
      "status":"OVERDUE"
    }'::jsonb,
    '{"id":"evt_stale_overdue_a","event":"PAYMENT_OVERDUE"}'::jsonb
  ) ->> 'outcome',
  'stale',
  'out-of-order payment event is marked stale'
);
select ok(
  (select status = 'CONFIRMED' from public.asaas_payments where asaas_payment_id = 'pay_webhook_a')
    and
  (select subscription_status = 'active' from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  'stale overdue delivery cannot roll back confirmed access'
);

select is(
  (
    public.reconcile_asaas_payment_webhook(
      'evt_overdue_a',
      'PAYMENT_OVERDUE',
      '2026-08-29T12:00:00Z',
      '{
        "id":"pay_webhook_a",
        "customer":"cus_webhook_a",
        "subscription":"sub_webhook_a",
        "status":"OVERDUE",
        "dueDate":"2026-08-28"
      }'::jsonb,
      '{"id":"evt_overdue_a","event":"PAYMENT_OVERDUE"}'::jsonb
    ) ->> 'subscription_status'
  ),
  'overdue',
  'a newer overdue event reconciles the organization'
);
select is(
  (
    public.reconcile_asaas_payment_webhook(
      'evt_received_a',
      'PAYMENT_RECEIVED',
      '2026-08-29T12:05:00Z',
      '{
        "id":"pay_webhook_a",
        "customer":"cus_webhook_a",
        "subscription":"sub_webhook_a",
        "status":"RECEIVED",
        "dueDate":"2026-08-28",
        "paymentDate":"2026-08-29"
      }'::jsonb,
      '{"id":"evt_received_a","event":"PAYMENT_RECEIVED"}'::jsonb
    ) ->> 'subscription_status'
  ),
  'active',
  'receipt after overdue restores active access'
);
select is(
  (select status from public.subscriptions where id = 'b2000000-0000-4000-8000-000000000001'),
  'active',
  'canonical subscription row follows reconciled billing state'
);

select lives_ok(
  $$
    select public.reconcile_asaas_payment_webhook(
      'evt_future_created_a',
      'PAYMENT_CREATED',
      '2026-08-29T12:06:00Z',
      '{
        "id":"pay_webhook_future_a",
        "customer":"cus_webhook_a",
        "subscription":"sub_webhook_a",
        "status":"PENDING",
        "dueDate":"2026-09-28"
      }'::jsonb,
      '{"id":"evt_future_created_a","event":"PAYMENT_CREATED"}'::jsonb
    )
  $$,
  'future recurring charge is accepted'
);
select is(
  (select subscription_status from public.organizations where id = 'b1000000-0000-4000-8000-000000000001'),
  'active',
  'future pending charge does not downgrade an active subscription'
);

select is(
  (
    public.reconcile_asaas_payment_webhook(
      'evt_capture_refused_a',
      'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      '2026-08-29T12:06:30Z',
      '{
        "id":"pay_webhook_future_a",
        "customer":"cus_webhook_a",
        "subscription":"sub_webhook_a",
        "status":"PENDING",
        "billingType":"CREDIT_CARD",
        "dueDate":"2026-09-28"
      }'::jsonb,
      '{"id":"evt_capture_refused_a","event":"PAYMENT_CREDIT_CARD_CAPTURE_REFUSED"}'::jsonb
    ) ->> 'subscription_status'
  ),
  'overdue',
  'failed card capture closes active access until a confirmed payment arrives'
);
select ok(
  (select status = 'CREDIT_CARD_CAPTURE_REFUSED'
    from public.asaas_payments
    where asaas_payment_id = 'pay_webhook_future_a')
  and
  (select status = 'overdue'
    from public.subscriptions
    where id = 'b2000000-0000-4000-8000-000000000001'),
  'capture refusal is reconciled in payment and canonical subscription state'
);

select is(
  (
    public.reconcile_asaas_payment_webhook(
      'evt_refunded_a',
      'PAYMENT_REFUNDED',
      '2026-08-29T12:07:00Z',
      '{
        "id":"pay_webhook_a",
        "customer":"cus_webhook_a",
        "subscription":"sub_webhook_a",
        "status":"REFUNDED"
      }'::jsonb,
      '{"id":"evt_refunded_a","event":"PAYMENT_REFUNDED"}'::jsonb
    ) ->> 'subscription_status'
  ),
  'suspended',
  'refund suspends access pending billing review'
);

select throws_ok(
  $$
    select public.reconcile_asaas_payment_webhook(
      'evt_customer_mismatch_a',
      'PAYMENT_UPDATED',
      '2026-08-29T12:08:00Z',
      '{"id":"pay_webhook_a","customer":"cus_wrong"}'::jsonb,
      '{"id":"evt_customer_mismatch_a","event":"PAYMENT_UPDATED"}'::jsonb
    )
  $$,
  '22023',
  'Asaas customer does not match the existing payment',
  'existing payment cannot be rebound to another customer'
);

select is(
  public.reconcile_asaas_payment_webhook(
    'evt_ambiguous_customer',
    'PAYMENT_CREATED',
    '2026-08-29T12:09:00Z',
    '{"id":"pay_ambiguous","customer":"cus_ambiguous","status":"PENDING"}'::jsonb,
    '{"id":"evt_ambiguous_customer","event":"PAYMENT_CREATED"}'::jsonb
  ) ->> 'outcome',
  'unmatched',
  'ambiguous customer linkage is rejected instead of crossing tenants'
);
select is(
  (select count(*) from private.asaas_webhook_events where event_id = 'evt_ambiguous_customer'),
  1::bigint,
  'unmatched event is audited and cannot poison a sequential webhook queue'
);

select throws_ok(
  $$
    select public.reconcile_asaas_payment_webhook(
      'evt_customer_created',
      'CUSTOMER_CREATED',
      '2026-08-29T12:10:00Z',
      '{"id":"pay_invalid"}'::jsonb,
      '{"id":"evt_customer_created","event":"CUSTOMER_CREATED"}'::jsonb
    )
  $$,
  '22023',
  'Unsupported Asaas webhook event type',
  'non-payment events cannot enter the billing reconciler'
);

select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_subscription_created_c',
    'SUBSCRIPTION_CREATED',
    '2026-07-28T13:00:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "externalReference":"b1000000-0000-4000-8000-000000000005",
      "status":"ACTIVE",
      "nextDueDate":"2026-08-28"
    }'::jsonb,
    '{"id":"evt_subscription_created_c","event":"SUBSCRIPTION_CREATED"}'::jsonb
  ) ->> 'outcome',
  'processed',
  'subscription creation is linked through its tenant reference'
);
select ok(
  (
    select subscription_status = 'pending_payment'
      and asaas_customer_id = 'cus_webhook_c'
      and asaas_subscription_id = 'sub_webhook_c'
      and next_billing_date = '2026-08-28'::date
    from public.organizations
    where id = 'b1000000-0000-4000-8000-000000000005'
  ),
  'provider ACTIVE status alone never grants application access'
);
select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_subscription_updated_c',
    'SUBSCRIPTION_UPDATED',
    '2026-07-28T13:01:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "status":"ACTIVE",
      "nextDueDate":"2026-09-28"
    }'::jsonb,
    '{"id":"evt_subscription_updated_c","event":"SUBSCRIPTION_UPDATED"}'::jsonb
  ) ->> 'subscription_status',
  'pending_payment',
  'subscription updates do not substitute for a confirmed payment'
);
select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_subscription_block_c',
    'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK',
    '2026-07-28T13:02:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "status":"ACTIVE"
    }'::jsonb,
    '{"id":"evt_subscription_block_c","event":"SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK"}'::jsonb
  ) ->> 'subscription_status',
  'suspended',
  'split divergence block suspends access'
);
select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_subscription_block_finished_c',
    'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED',
    '2026-07-28T13:03:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "status":"ACTIVE"
    }'::jsonb,
    '{"id":"evt_subscription_block_finished_c","event":"SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED"}'::jsonb
  ) ->> 'subscription_status',
  'pending_payment',
  'finished split block remains closed until payment confirmation'
);
select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_subscription_inactivated_c',
    'SUBSCRIPTION_INACTIVATED',
    '2026-07-28T13:04:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "status":"INACTIVE"
    }'::jsonb,
    '{"id":"evt_subscription_inactivated_c","event":"SUBSCRIPTION_INACTIVATED"}'::jsonb
  ) ->> 'subscription_status',
  'cancelled',
  'current subscription inactivation cancels application access'
);
select ok(
  (
    select status = 'cancelled'
      and canceled_at is not null
      and metadata ->> 'asaas_last_event_id' = 'evt_subscription_inactivated_c'
    from public.subscriptions
    where id = 'b2000000-0000-4000-8000-000000000005'
  ),
  'canonical subscription records cancellation and provider event'
);
select lives_ok(
  $$
    select public.register_pending_asaas_subscription(
      'b1000000-0000-4000-8000-000000000005',
      'cus_webhook_c',
      'sub_webhook_c_replacement'
    )
  $$,
  'a replacement subscription can be registered after cancellation'
);
select is(
  public.reconcile_asaas_subscription_webhook(
    'evt_obsolete_subscription_deleted_c',
    'SUBSCRIPTION_DELETED',
    '2026-07-28T13:05:00Z',
    '{
      "id":"sub_webhook_c",
      "customer":"cus_webhook_c",
      "externalReference":"b1000000-0000-4000-8000-000000000005",
      "status":"INACTIVE"
    }'::jsonb,
    '{"id":"evt_obsolete_subscription_deleted_c","event":"SUBSCRIPTION_DELETED"}'::jsonb
  ) ->> 'outcome',
  'unmatched',
  'deleted event for a replaced subscription cannot bind to the tenant'
);
select ok(
  (
    select subscription_status = 'pending_payment'
      and asaas_subscription_id = 'sub_webhook_c_replacement'
    from public.organizations
    where id = 'b1000000-0000-4000-8000-000000000005'
  ),
  'obsolete deletion cannot cancel the replacement subscription'
);
select is(
  (
    select resource_type
    from private.asaas_webhook_events
    where event_id = 'evt_obsolete_subscription_deleted_c'
  ),
  'subscription',
  'unmatched subscription lifecycle event is retained in the private inbox'
);

insert into public.admin_subscription_plans (
  id,
  name,
  slug,
  price,
  billing_cycle,
  modules
)
values (
  'b0000000-0000-4000-8000-000000000006',
  'Asaas Annual Plan',
  'asaas-annual-plan',
  2990.00,
  'yearly',
  array['crm']
);
insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  subscription_type,
  subscription_status,
  asaas_customer_id,
  asaas_subscription_id
)
values (
  'b1000000-0000-4000-8000-000000000006',
  'Asaas Annual Webhook Org',
  'asaas-annual-webhook-org',
  'b0000000-0000-4000-8000-000000000006',
  'paid',
  'pending_payment',
  'cus_webhook_annual',
  'sub_webhook_annual'
);
insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id
)
values (
  'b2000000-0000-4000-8000-000000000006',
  'b1000000-0000-4000-8000-000000000006',
  'b0000000-0000-4000-8000-000000000006',
  'pending_payment',
  'asaas',
  'cus_webhook_annual',
  'sub_webhook_annual'
);
select is(
  public.reconcile_asaas_payment_webhook(
    'evt_confirmed_annual',
    'PAYMENT_CONFIRMED',
    '2026-07-28T14:00:00Z',
    '{
      "id":"pay_webhook_annual",
      "customer":"cus_webhook_annual",
      "subscription":"sub_webhook_annual",
      "externalReference":"b1000000-0000-4000-8000-000000000006",
      "status":"CONFIRMED",
      "billingType":"CREDIT_CARD",
      "value":2990.00,
      "dueDate":"2026-07-28",
      "paymentDate":"2026-07-28"
    }'::jsonb,
    '{"id":"evt_confirmed_annual","event":"PAYMENT_CONFIRMED"}'::jsonb
  ) ->> 'outcome',
  'processed',
  'annual payment confirmation is reconciled'
);
select ok(
  (
    select
      next_billing_date = '2027-07-28'::date
      and (
        select current_period_end::date
        from public.subscriptions
        where id = 'b2000000-0000-4000-8000-000000000006'
      ) = '2027-07-28'::date
    from public.organizations
    where id = 'b1000000-0000-4000-8000-000000000006'
  ),
  'annual plans advance organization and subscription dates by one year'
);

select * from finish();
rollback;
