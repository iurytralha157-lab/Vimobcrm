begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(12);

select has_trigger(
  'public',
  'asaas_payments',
  'asaas_payments_confirm_billing_checkout',
  'payment rows keep the checkout intent trigger'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.confirm_billing_checkout_from_payment()',
    'execute'
  ),
  false,
  'authenticated clients cannot invoke the payment intent trigger function'
);

select is(
  has_function_privilege(
    'service_role',
    'private.confirm_billing_checkout_from_payment()',
    'execute'
  ),
  false,
  'the private trigger primitive remains unavailable through the Data API'
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
    'f6100000-0000-4000-8000-000000000001',
    'Trigger current plan',
    'trigger-current-plan',
    99,
    3,
    array[]::text[]
  ),
  (
    'f6100000-0000-4000-8000-000000000002',
    'Trigger target plan',
    'trigger-target-plan',
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
  subscription_type,
  subscription_status,
  asaas_customer_id,
  billing_last_reconciled_at
)
values
  (
    'f6200000-0000-4000-8000-000000000001',
    'Stale Pix trigger',
    'stale-pix-trigger',
    'f6100000-0000-4000-8000-000000000001',
    'f6100000-0000-4000-8000-000000000002',
    'free',
    'pending_payment',
    'cus_trigger_pix',
    '2026-08-04 12:00:00+00'
  ),
  (
    'f6200000-0000-4000-8000-000000000002',
    'Stale Boleto trigger',
    'stale-boleto-trigger',
    'f6100000-0000-4000-8000-000000000001',
    'f6100000-0000-4000-8000-000000000002',
    'free',
    'pending_payment',
    'cus_trigger_boleto',
    '2026-08-04 12:00:00+00'
  ),
  (
    'f6200000-0000-4000-8000-000000000003',
    'Missing cursor trigger',
    'missing-cursor-trigger',
    'f6100000-0000-4000-8000-000000000001',
    'f6100000-0000-4000-8000-000000000002',
    'free',
    'pending_payment',
    'cus_trigger_missing',
    null
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
    'f6300000-0000-4000-8000-000000000001',
    'f6200000-0000-4000-8000-000000000001',
    'f6100000-0000-4000-8000-000000000002',
    297,
    'monthly',
    1,
    'PIX',
    'pending',
    'f6300000-0000-4000-8000-000000000001',
    'cus_trigger_pix',
    'pay_trigger_pix',
    '{}'::jsonb,
    now()
  ),
  (
    'f6300000-0000-4000-8000-000000000002',
    'f6200000-0000-4000-8000-000000000002',
    'f6100000-0000-4000-8000-000000000002',
    297,
    'monthly',
    1,
    'BOLETO',
    'pending',
    'f6300000-0000-4000-8000-000000000002',
    'cus_trigger_boleto',
    'pay_trigger_boleto',
    '{}'::jsonb,
    now()
  ),
  (
    'f6300000-0000-4000-8000-000000000003',
    'f6200000-0000-4000-8000-000000000003',
    'f6100000-0000-4000-8000-000000000002',
    297,
    'monthly',
    1,
    'PIX',
    'pending',
    'f6300000-0000-4000-8000-000000000003',
    'cus_trigger_missing',
    'pay_trigger_missing',
    '{}'::jsonb,
    now()
  );

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  status,
  billing_type,
  value,
  last_webhook_event_at
)
values
  (
    'f6200000-0000-4000-8000-000000000001',
    'pay_trigger_pix',
    'cus_trigger_pix',
    'DELETED',
    'PIX',
    297,
    '2026-08-04 11:00:00+00'
  ),
  (
    'f6200000-0000-4000-8000-000000000002',
    'pay_trigger_boleto',
    'cus_trigger_boleto',
    'CANCELED',
    'BOLETO',
    297,
    '2026-08-04 11:00:00+00'
  ),
  (
    'f6200000-0000-4000-8000-000000000003',
    'pay_trigger_missing',
    'cus_trigger_missing',
    'DELETED',
    'PIX',
    297,
    null
  );

select is(
  (select status from private.billing_checkout_intents where id = 'f6300000-0000-4000-8000-000000000001'),
  'pending',
  'a stale deleted Pix payment cannot cancel its pending intent'
);

select is(
  (select count(*)::integer from private.billing_checkout_intents where organization_id = 'f6200000-0000-4000-8000-000000000001' and status in ('creating', 'pending')),
  1,
  'a stale Pix event does not release the organization for another checkout'
);

select is(
  (select status from private.billing_checkout_intents where id = 'f6300000-0000-4000-8000-000000000002'),
  'pending',
  'a stale canceled boleto cannot cancel its pending intent'
);

select is(
  (select count(*)::integer from private.billing_checkout_intents where organization_id = 'f6200000-0000-4000-8000-000000000002' and status in ('creating', 'pending')),
  1,
  'a stale boleto event does not release the organization for another checkout'
);

select is(
  (select status from private.billing_checkout_intents where id = 'f6300000-0000-4000-8000-000000000003'),
  'pending',
  'a payment without a provider observation cursor cannot mutate an intent'
);

update public.asaas_payments
set
  status = 'DELETED',
  last_webhook_event_at = '2026-08-04 12:00:00+00'
where asaas_payment_id = 'pay_trigger_pix';

update public.asaas_payments
set
  status = 'CANCELED',
  last_webhook_event_at = '2026-08-04 12:00:00+00'
where asaas_payment_id = 'pay_trigger_boleto';

select is(
  (select status from private.billing_checkout_intents where id = 'f6300000-0000-4000-8000-000000000001'),
  'cancelled',
  'a current Pix terminal event still cancels the matching intent'
);

select is(
  (select status from private.billing_checkout_intents where id = 'f6300000-0000-4000-8000-000000000002'),
  'cancelled',
  'a current boleto terminal event still cancels the matching intent'
);

select is(
  (select count(*)::integer from private.billing_checkout_intents where organization_id = 'f6200000-0000-4000-8000-000000000001' and status in ('creating', 'pending')),
  0,
  'only the current Pix terminal event releases its checkout slot'
);

select is(
  (select count(*)::integer from private.billing_checkout_intents where organization_id = 'f6200000-0000-4000-8000-000000000002' and status in ('creating', 'pending')),
  0,
  'only the current boleto terminal event releases its checkout slot'
);

select * from finish();
rollback;
