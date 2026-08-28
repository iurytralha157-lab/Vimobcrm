begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(19);

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
    'f5100000-0000-4000-8000-000000000001',
    'Renewal current plan',
    'renewal-current-plan',
    99,
    3,
    array[]::text[]
  ),
  (
    'f5100000-0000-4000-8000-000000000002',
    'Renewal target plan',
    'renewal-target-plan',
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
  asaas_subscription_id
)
values
  (
    'f5200000-0000-4000-8000-000000000001',
    'Renewal intent pending',
    'renewal-intent-pending',
    'f5100000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000002',
    'paid',
    'pending_payment',
    'cus_renewal_pending',
    'sub_renewal_pending'
  ),
  (
    'f5200000-0000-4000-8000-000000000002',
    'Renewal intent terminal',
    'renewal-intent-terminal',
    'f5100000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000002',
    'paid',
    'suspended',
    'cus_renewal_terminal',
    'sub_renewal_terminal'
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
values
  (
    'f5300000-0000-4000-8000-000000000001',
    'f5200000-0000-4000-8000-000000000001',
    'f5100000-0000-4000-8000-000000000002',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'pending',
    'f5300000-0000-4000-8000-000000000001',
    'cus_renewal_pending',
    'pay_renewal_original',
    'sub_renewal_pending',
    '{}'::jsonb,
    now()
  ),
  (
    'f5300000-0000-4000-8000-000000000002',
    'f5200000-0000-4000-8000-000000000002',
    'f5100000-0000-4000-8000-000000000002',
    297,
    'monthly',
    1,
    'CREDIT_CARD',
    'pending',
    'f5300000-0000-4000-8000-000000000002',
    'cus_renewal_terminal',
    'pay_renewal_terminal',
    'sub_renewal_terminal',
    '{}'::jsonb,
    now()
  );

select is(
  has_function_privilege(
    'authenticated',
    'private.confirm_billing_checkout_intent(text,text,text,numeric)',
    'execute'
  ),
  false,
  'authenticated clients cannot confirm billing intents'
);

select is(
  has_function_privilege(
    'service_role',
    'private.confirm_billing_checkout_intent(text,text,text,numeric)',
    'execute'
  ),
  false,
  'the private confirmation primitive is not exposed through the Data API'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'CONFIRMED',
    null
  ) ->> 'outcome',
  'amount_missing',
  'a first confirmation without a paid amount fails closed'
);

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'f5300000-0000-4000-8000-000000000001'
  ),
  'pending',
  'a missing amount does not close the intent'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'CONFIRMED',
    1
  ) ->> 'outcome',
  'amount_mismatch',
  'the original payment remains bound to the frozen checkout amount'
);

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'f5300000-0000-4000-8000-000000000001'
  ),
  'pending',
  'an amount mismatch cannot promote the checkout'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'CONFIRMED',
    297
  ) ->> 'outcome',
  'confirmed',
  'the exact original payment confirms the intent'
);

select ok(
  (
    select
      plan_id = 'f5100000-0000-4000-8000-000000000002'
      and pending_plan_id is null
      and subscription_status = 'active'
    from public.organizations
    where id = 'f5200000-0000-4000-8000-000000000001'
  ),
  'the exact first payment atomically promotes the staged plan'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'RECEIVED',
    null
  ) ->> 'outcome',
  'amount_missing',
  'an original-payment replay without an amount also fails closed'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'RECEIVED',
    1000
  ) ->> 'outcome',
  'amount_mismatch',
  'a replay of the original payment still validates its amount'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_renewal_pending',
    'RECEIVED',
    297
  ) ->> 'renewal',
  'false',
  'an exact original-payment replay is idempotent rather than a renewal'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_new_price',
    'sub_renewal_pending',
    'RECEIVED',
    497
  ) ->> 'outcome',
  'already_confirmed',
  'a new payment on the same subscription is accepted as a renewal'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_new_price_2',
    'sub_renewal_pending',
    'RECEIVED',
    497
  ) ->> 'renewal',
  'true',
  'renewal classification is explicit'
);

select is(
  (
    select provider_payment_id
    from private.billing_checkout_intents
    where id = 'f5300000-0000-4000-8000-000000000001'
  ),
  'pay_renewal_original',
  'renewals cannot overwrite the immutable original payment id'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_original',
    'sub_foreign',
    'RECEIVED',
    297
  ) ->> 'outcome',
  'identifier_mismatch',
  'a known payment cannot be paired with a foreign subscription'
);

select is(
  private.confirm_billing_checkout_intent(
    null,
    'sub_renewal_pending',
    'RECEIVED',
    497
  ) ->> 'outcome',
  'payment_id_missing',
  'subscription-only calls cannot masquerade as renewals'
);

select is(
  private.confirm_billing_checkout_intent(
    'pay_renewal_terminal',
    'sub_renewal_terminal',
    'CONFIRMED',
    297
  ) ->> 'outcome',
  'terminal_state',
  'a pending historical intent cannot reactivate suspended access'
);

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = 'f5300000-0000-4000-8000-000000000002'
  ),
  'pending',
  'terminal-state rejection leaves the intent unconfirmed'
);

select is(
  (
    select subscription_status
    from public.organizations
    where id = 'f5200000-0000-4000-8000-000000000002'
  ),
  'suspended',
  'terminal-state rejection preserves suspended organization access'
);

select * from finish();
rollback;
