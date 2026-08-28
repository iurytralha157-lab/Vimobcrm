begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(20);

select has_table(
  'private',
  'billing_plan_changes',
  'managed billing plan changes are persisted outside the public API schema'
);

select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.billing_plan_changes'::regclass
  ),
  true,
  'billing plan changes keep RLS enabled as defense in depth'
);

select is(
  has_table_privilege('authenticated', 'private.billing_plan_changes', 'select'),
  false,
  'authenticated clients cannot inspect provider plan changes'
);

select is(
  has_table_privilege('service_role', 'private.billing_plan_changes', 'select'),
  false,
  'the Data API service role cannot mutate the private state machine'
);

select has_function(
  'private',
  'apply_scheduled_billing_plan_change',
  array[]::text[],
  'a confirmed provider payment applies the scheduled plan change'
);

select is(
  has_function_privilege(
    'authenticated',
    'private.apply_scheduled_billing_plan_change()',
    'execute'
  ),
  false,
  'authenticated clients cannot execute the plan promotion trigger function'
);

select is(
  (
    select count(*)::integer
    from pg_indexes
    where schemaname = 'private'
      and tablename = 'billing_plan_changes'
      and indexname = 'billing_plan_changes_one_active_per_org_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%provider_updating%scheduled%applying%'
  ),
  1,
  'only one managed plan change can be active per organization'
);

select is(
  (
    select count(*)::integer
    from pg_trigger
    where tgrelid = 'public.asaas_payments'::regclass
      and tgname = 'asaas_payments_apply_scheduled_plan_change'
      and not tgisinternal
  ),
  1,
  'payment reconciliation owns managed plan promotion'
);

insert into public.admin_subscription_plans (
  id,
  name,
  slug,
  price,
  billing_cycle,
  max_users,
  modules,
  is_active,
  is_public
)
values
  (
    'e8100000-0000-4000-8000-000000000001',
    'Managed current plan',
    'managed-current-plan',
    199.00,
    'monthly',
    5,
    array['crm'],
    true,
    true
  ),
  (
    'e8100000-0000-4000-8000-000000000002',
    'Managed target plan',
    'managed-target-plan',
    399.00,
    'monthly',
    10,
    array['crm', 'properties'],
    true,
    true
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
  asaas_customer_id,
  asaas_subscription_id
)
values
  (
    'e8200000-0000-4000-8000-000000000001',
    'Managed hidden target org',
    'managed-hidden-target-org',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'paid',
    'active',
    1,
    'cus_managed_hidden',
    'sub_managed_hidden'
  ),
  (
    'e8200000-0000-4000-8000-000000000002',
    'Managed ambiguous provider org',
    'managed-ambiguous-provider-org',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'paid',
    'active',
    1,
    'cus_managed_ambiguous',
    'sub_managed_ambiguous'
  ),
  (
    'e8200000-0000-4000-8000-000000000003',
    'Managed reversal guard org',
    'managed-reversal-guard-org',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'paid',
    'active',
    1,
    'cus_managed_reversal',
    'sub_managed_reversal'
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
    'e8200000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_managed_hidden',
    'sub_managed_hidden',
    1
  ),
  (
    'e8200000-0000-4000-8000-000000000002',
    'e8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_managed_ambiguous',
    'sub_managed_ambiguous',
    1
  ),
  (
    'e8200000-0000-4000-8000-000000000003',
    'e8100000-0000-4000-8000-000000000001',
    'active',
    'asaas',
    'cus_managed_reversal',
    'sub_managed_reversal',
    1
  );

insert into private.billing_plan_changes (
  organization_id,
  from_plan_id,
  target_plan_id,
  provider_subscription_id,
  billing_period_months,
  amount,
  provider_cycle,
  description,
  status,
  provider_request_started_at,
  effective_on
)
values
  (
    'e8200000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'sub_managed_hidden',
    1,
    399.00,
    'MONTHLY',
    'Hidden target commitment',
    'scheduled',
    '2026-09-01T10:00:00Z',
    '2026-09-10'
  ),
  (
    'e8200000-0000-4000-8000-000000000002',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'sub_managed_ambiguous',
    1,
    399.00,
    'MONTHLY',
    'Ambiguous provider commitment',
    'provider_updating',
    '2026-09-01T10:00:00Z',
    null
  ),
  (
    'e8200000-0000-4000-8000-000000000003',
    'e8100000-0000-4000-8000-000000000001',
    'e8100000-0000-4000-8000-000000000002',
    'sub_managed_reversal',
    1,
    399.00,
    'MONTHLY',
    'Reversal must block scheduled promotion',
    'scheduled',
    '2026-09-01T10:00:00Z',
    '2026-09-10'
  );

update public.admin_subscription_plans
set is_active = false,
    is_public = false
where id = 'e8100000-0000-4000-8000-000000000002';

insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  payment_date,
  last_webhook_event_at
)
values
  (
    'e8200000-0000-4000-8000-000000000001',
    'pay_managed_hidden',
    'cus_managed_hidden',
    'sub_managed_hidden',
    'CONFIRMED',
    'CREDIT_CARD',
    399.00,
    '2026-09-10',
    '2026-09-10',
    now()
  );

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'e8200000-0000-4000-8000-000000000002',
    'cus_managed_ambiguous',
    'sub_managed_ambiguous',
    'ACTIVE',
    'pay_managed_ambiguous',
    'CONFIRMED',
    399.00,
    '2026-09-10',
    '2026-10-10',
    now(),
    'pgtap_managed_plan_polling'
  ) ->> 'outcome',
  'applied',
  'polling persists payment due date and applies a managed plan change when its webhook is lost'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'e8200000-0000-4000-8000-000000000003',
    'cus_managed_reversal',
    'sub_managed_reversal',
    'ACTIVE',
    'pay_managed_reversal_refund',
    'REFUNDED',
    199.00,
    '2026-09-01',
    '2026-09-10',
    now(),
    'pgtap_managed_plan_refund'
  ) ->> 'status',
  'suspended',
  'a refund suspends an organization before its scheduled plan payment'
);

select is(
  private.apply_asaas_billing_snapshot_with_payment(
    'e8200000-0000-4000-8000-000000000003',
    'cus_managed_reversal',
    'sub_managed_reversal',
    'ACTIVE',
    'pay_managed_reversal_paid',
    'CONFIRMED',
    399.00,
    '2026-09-10',
    '2026-10-10',
    now(),
    'pgtap_managed_plan_terminal_guard'
  ) ->> 'status',
  'suspended',
  'a later paid poll cannot revive the refund suspension while applying the plan change'
);

select ok(
  (
    select plan_id = 'e8100000-0000-4000-8000-000000000001'
      and pending_plan_id = 'e8100000-0000-4000-8000-000000000002'
      and subscription_status = 'suspended'
    from public.organizations
    where id = 'e8200000-0000-4000-8000-000000000003'
  ),
  'the terminal organization keeps its old plan and pending target'
);

select is(
  (
    select status
    from private.billing_plan_changes
    where organization_id = 'e8200000-0000-4000-8000-000000000003'
  ),
  'scheduled',
  'the guarded plan change remains scheduled for explicit regularization'
);

select ok(
  (
    select plan_id = 'e8100000-0000-4000-8000-000000000002'
      and pending_plan_id is null
      and subscription_status = 'active'
      and subscription_value = 399.00
    from public.organizations
    where id = 'e8200000-0000-4000-8000-000000000001'
  ),
  'an accepted plan commitment applies even after the catalog plan is hidden'
);

select is(
  (
    select status
    from private.billing_plan_changes
    where organization_id = 'e8200000-0000-4000-8000-000000000001'
  ),
  'applied',
  'the hidden target commitment reaches a terminal applied state'
);

select ok(
  (
    select plan_id = 'e8100000-0000-4000-8000-000000000002'
      and pending_plan_id is null
      and subscription_status = 'active'
    from public.organizations
    where id = 'e8200000-0000-4000-8000-000000000002'
  ),
  'an exact future payment recovers an ambiguous provider update without another HTTP request'
);

select is(
  (
    select status
    from private.billing_plan_changes
    where organization_id = 'e8200000-0000-4000-8000-000000000002'
  ),
  'applied',
  'payment evidence closes the ambiguous provider state'
);

update public.asaas_payments
set status = 'CONFIRMED'
where asaas_payment_id = 'pay_managed_ambiguous';

select is(
  (
    select count(*)::integer
    from public.subscription_logs
    where organization_id = 'e8200000-0000-4000-8000-000000000002'
      and event_type = 'managed_plan_change_applied'
  ),
  1,
  'replaying the same payment cannot apply the managed change twice'
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
  asaas_customer_id,
  asaas_subscription_id,
  billing_last_reconciled_at
)
values (
  'e8200000-0000-4000-8000-000000000004',
  'Managed stale payment cursor org',
  'managed-stale-payment-cursor-org',
  'e8100000-0000-4000-8000-000000000001',
  'e8100000-0000-4000-8000-000000000002',
  'paid',
  'overdue',
  1,
  'cus_managed_stale_cursor',
  'sub_managed_stale_cursor',
  now() - interval '1 minute'
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
values (
  'e8200000-0000-4000-8000-000000000004',
  'e8100000-0000-4000-8000-000000000001',
  'active',
  'asaas',
  'cus_managed_stale_cursor',
  'sub_managed_stale_cursor',
  1
);

insert into private.billing_plan_changes (
  organization_id,
  from_plan_id,
  target_plan_id,
  provider_subscription_id,
  billing_period_months,
  amount,
  provider_cycle,
  description,
  status,
  provider_request_started_at,
  effective_on
)
values (
  'e8200000-0000-4000-8000-000000000004',
  'e8100000-0000-4000-8000-000000000001',
  'e8100000-0000-4000-8000-000000000002',
  'sub_managed_stale_cursor',
  1,
  399.00,
  'MONTHLY',
  'A delayed payment must not apply this commitment',
  'scheduled',
  '2026-09-01T10:00:00Z',
  '2026-09-10'
);

-- This models a new payment row inserted by a webhook observed at T0 after
-- periodic reconciliation already advanced the organization to T1. The row
-- trigger runs before the outer webhook stale check, so it must defend itself.
insert into public.asaas_payments (
  organization_id,
  asaas_payment_id,
  asaas_customer_id,
  asaas_subscription_id,
  status,
  billing_type,
  value,
  due_date,
  payment_date,
  last_webhook_event_at
)
values (
  'e8200000-0000-4000-8000-000000000004',
  'pay_managed_stale_cursor',
  'cus_managed_stale_cursor',
  'sub_managed_stale_cursor',
  'CONFIRMED',
  'CREDIT_CARD',
  399.00,
  '2026-09-10',
  '2026-09-10',
  now() - interval '2 minutes'
);

select ok(
  (
    select plan_id = 'e8100000-0000-4000-8000-000000000001'
      and pending_plan_id = 'e8100000-0000-4000-8000-000000000002'
      and subscription_status = 'overdue'
    from public.organizations
    where id = 'e8200000-0000-4000-8000-000000000004'
  ),
  'a stale paid payment trigger cannot apply the target plan or reactivate access'
);

select is(
  (
    select status
    from private.billing_plan_changes
    where organization_id = 'e8200000-0000-4000-8000-000000000004'
  ),
  'scheduled',
  'the plan change remains scheduled after a payment older than the organization cursor'
);

select * from finish();
rollback;
