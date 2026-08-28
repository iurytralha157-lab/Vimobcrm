begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(95);

select has_column(
  'public',
  'admin_subscription_plans',
  'payment_grace_days',
  'plans define an explicit payment grace period'
);
select has_column(
  'public',
  'organizations',
  'billing_grace_until',
  'organizations retain the current immutable grace deadline'
);
select has_column(
  'public',
  'organizations',
  'billing_blocked_at',
  'organizations retain the effective billing block timestamp'
);
select has_column(
  'public',
  'organizations',
  'billing_last_reconciled_at',
  'organizations retain provider reconciliation ordering'
);
select has_column(
  'public',
  'organizations',
  'billing_tax_id',
  'billing keeps a CPF or CNPJ separate from the organization profile'
);
select has_column(
  'public',
  'organizations',
  'billing_email',
  'billing keeps a dedicated financial contact'
);
select has_column(
  'public',
  'organizations',
  'billing_address',
  'billing keeps a dedicated fiscal address'
);
select has_table(
  'private',
  'asaas_reconciliation_jobs',
  'periodic Asaas reconciliation uses a private work queue'
);
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.asaas_reconciliation_jobs'::regclass
  ),
  true,
  'the reconciliation queue keeps RLS as defense in depth'
);
select is(
  has_table_privilege(
    'authenticated',
    'private.asaas_reconciliation_jobs',
    'select'
  ),
  false,
  'authenticated clients cannot inspect reconciliation jobs'
);
select is(
  has_table_privilege(
    'service_role',
    'private.asaas_reconciliation_jobs',
    'select'
  ),
  false,
  'the Data API service role cannot bypass the billing worker'
);
select has_function(
  'public',
  'reconcile_asaas_billing_snapshot',
  array[
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'date',
    'timestamp with time zone',
    'text'
  ],
  'billing polling has one canonical snapshot reconciler'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_billing_snapshot(uuid,text,text,text,text,date,timestamp with time zone,text)',
    'execute'
  ),
  false,
  'authenticated clients cannot reconcile billing state'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_billing_snapshot(uuid,text,text,text,text,date,timestamp with time zone,text)',
    'execute'
  ),
  true,
  'only the service integration can call the public reconciler'
);
select has_function(
  'private',
  'sync_organization_plan_modules',
  array['uuid', 'uuid'],
  'billing activation has one canonical plan-module synchronizer'
);
select is(
  has_function_privilege(
    'service_role',
    'private.sync_organization_plan_modules(uuid,uuid)',
    'execute'
  ),
  false,
  'the Data API cannot mutate plan modules directly'
);
select has_table(
  'private',
  'billing_checkout_intents',
  'billing checkout uses a backend-only intent ledger'
);
select has_column(
  'private',
  'billing_checkout_intents',
  'provider_checkout_id',
  'hosted checkout identifiers stay in the private intent ledger'
);
select is(
  (
    select relrowsecurity
    from pg_class
    where oid = 'private.billing_checkout_intents'::regclass
  ),
  true,
  'the checkout intent ledger keeps RLS as defense in depth'
);
select is(
  has_table_privilege(
    'service_role',
    'private.billing_checkout_intents',
    'select'
  ),
  false,
  'the Data API cannot read the private checkout ledger directly'
);
select has_function(
  'public',
  'reserve_billing_checkout_intent',
  array['uuid', 'text'],
  'checkout creation starts with an atomic service-only reservation'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reserve_billing_checkout_intent(uuid,text)',
    'execute'
  ),
  true,
  'the billing integration can reserve checkout intents'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reserve_billing_checkout_intent(uuid,text)',
    'execute'
  ),
  false,
  'authenticated clients cannot forge checkout reservations'
);
select has_function(
  'public',
  'register_billing_checkout_provider',
  array['uuid', 'text', 'text', 'text', 'jsonb'],
  'provider resources are bound to the reserved intent'
);
select has_function(
  'public',
  'register_billing_hosted_checkout',
  array['uuid', 'text', 'jsonb'],
  'hosted checkout sessions are bound to the reserved intent'
);
select is(
  has_function_privilege(
    'service_role',
    'public.register_billing_hosted_checkout(uuid,text,jsonb)',
    'execute'
  ),
  true,
  'the billing integration can register a hosted checkout'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.register_billing_hosted_checkout(uuid,text,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot forge a hosted checkout'
);
select has_function(
  'public',
  'store_billing_checkout_payment',
  array[
    'uuid',
    'uuid',
    'text',
    'text',
    'text',
    'text',
    'text',
    'numeric',
    'numeric',
    'date',
    'date',
    'text',
    'jsonb'
  ],
  'checkout payment persistence is atomic and intent-bound'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.store_billing_checkout_payment(uuid,uuid,text,text,text,text,text,numeric,numeric,date,date,text,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot forge checkout payment state'
);
select is(
  has_function_privilege(
    'service_role',
    'public.store_billing_checkout_payment(uuid,uuid,text,text,text,text,text,numeric,numeric,date,date,text,jsonb)',
    'execute'
  ),
  true,
  'the billing integration can atomically persist provider payments'
);
select has_function(
  'public',
  'reconcile_asaas_payment_webhook_with_intent',
  array['text', 'text', 'timestamp with time zone', 'jsonb', 'jsonb'],
  'payment webhooks can resolve an immutable checkout reference'
);
select has_function(
  'public',
  'reconcile_asaas_subscription_webhook_with_intent',
  array['text', 'text', 'timestamp with time zone', 'jsonb', 'jsonb'],
  'subscription webhooks can resolve an immutable checkout reference'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_payment_webhook_with_intent(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot reconcile intent-backed payment webhooks'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.reconcile_asaas_subscription_webhook_with_intent(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  false,
  'authenticated clients cannot reconcile intent-backed subscription webhooks'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_payment_webhook_with_intent(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  true,
  'the authenticated Asaas endpoint can reconcile intent-backed payments'
);
select is(
  has_function_privilege(
    'service_role',
    'public.reconcile_asaas_subscription_webhook_with_intent(text,text,timestamp with time zone,jsonb,jsonb)',
    'execute'
  ),
  true,
  'the authenticated Asaas endpoint can reconcile intent-backed subscriptions'
);
select has_column(
  'public',
  'asaas_payments',
  'billing_intent_id',
  'provider payments retain their immutable checkout intent'
);
select is(
  has_table_privilege('authenticated', 'public.asaas_payments', 'select'),
  false,
  'authenticated clients cannot read provider payloads directly'
);
select is(
  has_table_privilege('anon', 'public.asaas_payments', 'select'),
  false,
  'anonymous clients cannot read provider payloads directly'
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
    'd1000000-0000-4000-8000-000000000001',
    'Billing five-day grace',
    'billing-five-day-grace',
    299.90,
    5,
    array['crm', 'properties']
  ),
  (
    'd1000000-0000-4000-8000-000000000002',
    'Billing no grace',
    'billing-no-grace',
    99.90,
    0,
    array[]::text[]
  );

update public.admin_subscription_plans
set billing_cycle = 'yearly'
where id = 'd1000000-0000-4000-8000-000000000001';

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  subscription_type,
  subscription_status,
  trial_ends_at,
  asaas_customer_id,
  asaas_subscription_id
)
values
  (
    'd2000000-0000-4000-8000-000000000001',
    'Billing Pending',
    'billing-pending',
    'd1000000-0000-4000-8000-000000000001',
    'paid',
    'pending_payment',
    null,
    'cus_billing_a',
    'sub_billing_a'
  ),
  (
    'd2000000-0000-4000-8000-000000000002',
    'Billing Terminal',
    'billing-terminal',
    'd1000000-0000-4000-8000-000000000001',
    'paid',
    'active',
    null,
    'cus_billing_b',
    'sub_billing_b'
  ),
  (
    'd2000000-0000-4000-8000-000000000003',
    'Billing Expired Trial',
    'billing-expired-trial',
    'd1000000-0000-4000-8000-000000000001',
    'trial',
    'trial',
    now() - interval '1 hour',
    null,
    null
  ),
  (
    'd2000000-0000-4000-8000-000000000004',
    'Billing Zero Grace',
    'billing-zero-grace',
    'd1000000-0000-4000-8000-000000000002',
    'paid',
    'active',
    null,
    'cus_billing_d',
    'sub_billing_d'
  );

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  trial_ends_at,
  max_users
)
values
  (
    'd2000000-0000-4000-8000-000000000005',
    'Billing Intent Upgrade',
    'billing-intent-upgrade',
    'd1000000-0000-4000-8000-000000000002',
    'd1000000-0000-4000-8000-000000000001',
    'free',
    'active',
    null,
    1
  ),
  (
    'd2000000-0000-4000-8000-000000000006',
    'Billing Null Trial',
    'billing-null-trial',
    'd1000000-0000-4000-8000-000000000002',
    null,
    'trial',
    'trial',
    null,
    1
  );

insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider
)
values (
  'd3000000-0000-4000-8000-000000000005',
  'd2000000-0000-4000-8000-000000000005',
  'd1000000-0000-4000-8000-000000000002',
  'active',
  'manual'
);

select ok(
  (
    select billing_blocked_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000006'
  ),
  'a trial without a deadline fails closed'
);

create temporary table billing_intent_results (
  label text primary key,
  result jsonb not null
);
grant insert, select on billing_intent_results to service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
insert into billing_intent_results (label, result)
values (
  'created',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000005',
    'PIX'
  )
);
insert into billing_intent_results (label, result)
values (
  'retry',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000005',
    'PIX'
  )
);
insert into billing_intent_results (label, result)
values (
  'method_conflict',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000005',
    'CREDIT_CARD'
  )
);
insert into billing_intent_results (label, result)
values (
  'registered',
  public.register_billing_checkout_provider(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'created'
    ),
    'cus_intent_upgrade',
    'pay_intent_upgrade',
    null,
    '{"status":"PENDING"}'::jsonb
  )
);
set local role postgres;

select is(
  (select result ->> 'outcome' from billing_intent_results where label = 'created'),
  'create',
  'the first checkout request owns provider creation'
);
select ok(
  (
    select
      pending_plan_id = 'd1000000-0000-4000-8000-000000000001'
      and amount = 299.90
      and billing_cycle = 'monthly'
      and billing_period_months = 1
      and billing_method = 'PIX'
    from private.billing_checkout_intents
    where id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'created'
    )
  ),
  'the ledger freezes plan, amount, cycle and payment method'
);
select is(
  (select result ->> 'outcome' from billing_intent_results where label = 'retry'),
  'in_progress',
  'a concurrent retry cannot create a second provider resource'
);
select is(
  (
    select result ->> 'outcome'
    from billing_intent_results
    where label = 'method_conflict'
  ),
  'active_intent_conflict',
  'an active Pix checkout blocks a parallel card subscription'
);
select ok(
  (
    select
      plan_id = 'd1000000-0000-4000-8000-000000000002'
      and pending_plan_id = 'd1000000-0000-4000-8000-000000000001'
      and subscription_type = 'free'
      and subscription_status = 'active'
      and max_users = 1
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000005'
  ),
  'provider registration does not promote plan, limits or access'
);

insert into public.asaas_payments (
  organization_id,
  billing_intent_id,
  asaas_payment_id,
  asaas_customer_id,
  status,
  billing_type,
  value,
  last_webhook_event_at
)
values (
  'd2000000-0000-4000-8000-000000000005',
  (
    select (result ->> 'intent_id')::uuid
    from billing_intent_results
    where label = 'created'
  ),
  'pay_intent_upgrade',
  'cus_intent_upgrade',
  'CONFIRMED',
  'PIX',
  1,
  '2026-08-04 12:00:00+00'
);

select ok(
  (
    select
      plan_id = 'd1000000-0000-4000-8000-000000000002'
      and pending_plan_id = 'd1000000-0000-4000-8000-000000000001'
      and subscription_type = 'free'
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000005'
  ),
  'a paid provider event with the wrong amount cannot unlock the staged plan'
);

update public.asaas_payments
set value = 299.90
where asaas_payment_id = 'pay_intent_upgrade';

select ok(
  (
    select
      plan_id = 'd1000000-0000-4000-8000-000000000001'
      and pending_plan_id is null
      and subscription_type = 'paid'
      and subscription_status = 'active'
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000005'
  ),
  'only the exact confirmed intent atomically promotes the paid plan'
);
select is(
  (
    select status
    from private.billing_checkout_intents
    where id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'created'
    )
  ),
  'confirmed',
  'the successful promotion closes the checkout intent'
);
select is(
  (
    select max_users
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000005'
  ),
  10,
  'paid plan limits are applied only during confirmation'
);
select ok(
  (
    select is_enabled
    from public.organization_modules
    where organization_id = 'd2000000-0000-4000-8000-000000000005'
      and module_name = 'properties'
  ),
  'paid plan modules are applied only during confirmation'
);

set local role service_role;
insert into billing_intent_results (label, result)
values (
  'after_confirmation',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000005',
    'PIX'
  )
);
set local role postgres;
select is(
  (
    select result ->> 'outcome'
    from billing_intent_results
    where label = 'after_confirmation'
  ),
  'already_active',
  'an active paid subscription cannot open a second checkout'
);

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  max_users
)
values (
  'd2000000-0000-4000-8000-000000000007',
  'Billing Fast Webhook Race',
  'billing-fast-webhook-race',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'free',
  'active',
  1
);
insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider
)
values (
  'd3000000-0000-4000-8000-000000000007',
  'd2000000-0000-4000-8000-000000000007',
  'd1000000-0000-4000-8000-000000000002',
  'active',
  'manual'
);
set local role service_role;
insert into billing_intent_results (label, result)
values (
  'race_created',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000007',
    'PIX'
  )
);
set local role postgres;
set local role service_role;
select public.reconcile_asaas_payment_webhook_with_intent(
  'evt_fast_webhook',
  'PAYMENT_CONFIRMED',
  now(),
  jsonb_build_object(
    'id', 'pay_fast_webhook',
    'customer', 'cus_fast_webhook',
    'billingType', 'PIX',
    'status', 'CONFIRMED',
    'value', 299.90,
    'externalReference', (
      select result ->> 'external_reference'
      from billing_intent_results
      where label = 'race_created'
    )
  ),
  jsonb_build_object(
    'id', 'evt_fast_webhook',
    'event', 'PAYMENT_CONFIRMED'
  )
);
set local role postgres;
select ok(
  (
    select
      subscription_type = 'paid'
      and subscription_status = 'active'
      and plan_id = 'd1000000-0000-4000-8000-000000000001'
      and pending_plan_id is null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000007'
  ),
  'a fast paid webhook binds the immutable reference and confirms atomically'
);
set local role service_role;
insert into billing_intent_results (label, result)
values (
  'race_registered',
  public.register_billing_checkout_provider(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'race_created'
    ),
    'cus_fast_webhook',
    'pay_fast_webhook',
    null,
    '{"status":"CONFIRMED"}'::jsonb
  )
);
set local role postgres;
select ok(
  (
    select
      subscription_type = 'paid'
      and subscription_status = 'active'
      and plan_id = 'd1000000-0000-4000-8000-000000000001'
      and pending_plan_id is null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000007'
  ),
  'late provider registration remains idempotent after fast-webhook confirmation'
);
set local role service_role;
insert into billing_intent_results (label, result)
values (
  'race_edge_store',
  public.store_billing_checkout_payment(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'race_created'
    ),
    'd2000000-0000-4000-8000-000000000007',
    'pay_fast_webhook',
    'cus_fast_webhook',
    null,
    'PIX',
    'PENDING',
    299.90,
    null,
    current_date,
    null,
    null,
    '{"id":"pay_fast_webhook","status":"PENDING"}'::jsonb
  )
);
set local role postgres;
select is(
  (
    select result ->> 'outcome'
    from billing_intent_results
    where label = 'race_edge_store'
  ),
  'stored',
  'the Edge response is bound after a fast webhook without a second write path'
);
select ok(
  (
    select
      status = 'CONFIRMED'
      and value = 299.90
      and last_webhook_event_id = 'evt_fast_webhook'
    from public.asaas_payments
    where asaas_payment_id = 'pay_fast_webhook'
  ),
  'a late pending Edge response cannot downgrade an authoritative paid webhook'
);

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  max_users
)
values (
  'd2000000-0000-4000-8000-000000000008',
  'Billing Terminal Pix',
  'billing-terminal-pix',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'free',
  'active',
  1
);

set local role service_role;
insert into billing_intent_results (label, result)
values (
  'terminal_pix_created',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000008',
    'PIX'
  )
);
insert into billing_intent_results (label, result)
values (
  'terminal_pix_registered',
  public.register_billing_checkout_provider(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'terminal_pix_created'
    ),
    'cus_terminal_pix',
    'pay_terminal_pix',
    null,
    '{"status":"PENDING"}'::jsonb
  )
);
insert into billing_intent_results (label, result)
values (
  'terminal_pix_stored',
  public.store_billing_checkout_payment(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'terminal_pix_created'
    ),
    'd2000000-0000-4000-8000-000000000008',
    'pay_terminal_pix',
    'cus_terminal_pix',
    null,
    'PIX',
    'PENDING',
    299.90,
    null,
    current_date,
    null,
    null,
    '{"id":"pay_terminal_pix","status":"PENDING"}'::jsonb
  )
);
set local role postgres;

update public.asaas_payments
set
  status = 'DELETED',
  last_webhook_event_at = clock_timestamp()
where asaas_payment_id = 'pay_terminal_pix';

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'terminal_pix_created'
    )
  ),
  'cancelled',
  'a terminal Pix provider event releases the active checkout intent'
);

set local role service_role;
insert into billing_intent_results (label, result)
values (
  'terminal_pix_cancel_replay',
  public.cancel_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000008',
    'pay_terminal_pix'
  )
);
set local role postgres;

select is(
  (
    select result ->> 'outcome'
    from billing_intent_results
    where label = 'terminal_pix_cancel_replay'
  ),
  'already_cancelled',
  'local Pix cancellation is idempotent after a provider terminal event'
);
select is(
  (
    select status
    from public.asaas_payments
    where asaas_payment_id = 'pay_terminal_pix'
  ),
  'CANCELED',
  'the cancellation RPC records payment and intent state atomically'
);

update public.asaas_payments
set status = 'DELETED'
where asaas_payment_id = 'pay_terminal_pix';

select is(
  (
    select status
    from private.billing_checkout_intents
    where id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'terminal_pix_created'
    )
  ),
  'cancelled',
  'replaying a terminal Pix event keeps the intent closed'
);

set local role service_role;
insert into billing_intent_results (label, result)
values (
  'terminal_pix_replacement',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000008',
    'PIX'
  )
);
set local role postgres;

select is(
  (
    select result ->> 'outcome'
    from billing_intent_results
    where label = 'terminal_pix_replacement'
  ),
  'create',
  'a terminal Pix intent allows one fresh checkout'
);
select ok(
  (
    select
      (replacement.result ->> 'intent_id')::uuid
        <> (original.result ->> 'intent_id')::uuid
      and (
        select count(*)
        from private.billing_checkout_intents
        where organization_id = 'd2000000-0000-4000-8000-000000000008'
          and status in ('creating', 'pending')
      ) = 1
    from billing_intent_results original
    cross join billing_intent_results replacement
    where original.label = 'terminal_pix_created'
      and replacement.label = 'terminal_pix_replacement'
  ),
  'the replacement uses a new id while preserving one active intent per tenant'
);

update public.asaas_payments
set status = 'RECEIVED'
where asaas_payment_id = 'pay_terminal_pix';

select ok(
  (
    select
      subscription_type = 'free'
      and subscription_status = 'active'
      and plan_id = 'd1000000-0000-4000-8000-000000000002'
      and pending_plan_id = 'd1000000-0000-4000-8000-000000000001'
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000008'
  ),
  'a late payment on a terminal intent cannot promote the staged plan'
);

select is(
  private.apply_asaas_billing_snapshot(
    'd2000000-0000-4000-8000-000000000008',
    'cus_terminal_pix',
    'sub_terminal_snapshot',
    'ACTIVE',
    'CREDIT_CARD_CAPTURE_REFUSED',
    null,
    now(),
    'pgtap_capture_refused'
  ) ->> 'status',
  'overdue',
  'a refused card capture has dunning precedence in the canonical snapshot'
);
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000008'
  ),
  'overdue',
  'a refused card capture cannot leave application access active'
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
  'd3000000-0000-4000-8000-000000000001',
  'd2000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'pending_payment',
  'asaas',
  'cus_billing_a',
  'sub_billing_a'
);

select ok(
  (
    select billing_blocked_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'pending payment is immediately restricted to recovery routes'
);
select ok(
  (
    select status = 'pending' and attempts = 0
    from private.asaas_reconciliation_jobs
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'provider-linked organizations are enrolled for reconciliation'
);

update public.organizations
set subscription_status = 'active'
where id = 'd2000000-0000-4000-8000-000000000001';

select ok(
  (
    select billing_blocked_at is null
      and billing_delinquent_at is null
      and billing_grace_until is null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'an active state clears every previous billing restriction'
);
select is(
  (
    select status
    from public.subscriptions
    where id = 'd3000000-0000-4000-8000-000000000001'
  ),
  'active',
  'canonical subscriptions follow the organization access state'
);
select ok(
  (
    select is_enabled
    from public.organization_modules
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and module_name = 'properties'
  ),
  'payment activation enables modules present in the paid plan'
);
select is(
  (
    select is_enabled
    from public.organization_modules
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and module_name = 'site'
  ),
  false,
  'payment activation disables plan-controlled modules absent from the plan'
);

update public.organizations
set subscription_status = 'overdue'
where id = 'd2000000-0000-4000-8000-000000000001';

select ok(
  (
    select billing_grace_until between
      now() + interval '4 days 23 hours'
      and now() + interval '5 days 1 hour'
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'overdue access receives the plan-specific grace deadline'
);

create temporary table billing_test_grace (value timestamptz);
insert into billing_test_grace
select billing_grace_until
from public.organizations
where id = 'd2000000-0000-4000-8000-000000000001';

update public.organizations
set subscription_status = 'overdue'
where id = 'd2000000-0000-4000-8000-000000000001';

select is(
  (
    select billing_grace_until
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  (select value from billing_test_grace),
  'repeated overdue updates cannot extend the current grace period'
);
select ok(
  (
    select billing_blocked_at is null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'an overdue account remains usable inside its grace period'
);

update public.organizations
set subscription_status = 'active'
where id = 'd2000000-0000-4000-8000-000000000001';

select ok(
  (
    select billing_grace_until is null and billing_blocked_at is null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'payment recovery removes the old grace state'
);

update public.organizations
set subscription_status = 'pending_payment'
where id = 'd2000000-0000-4000-8000-000000000001';

select ok(
  (
    select billing_blocked_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'a new pending checkout is fail-closed'
);
select ok(
  (
    select billing_blocked_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000003'
  ),
  'an expired trial is marked blocked at persistence time'
);

update public.organizations
set
  asaas_customer_id = 'cus_trial_conversion',
  asaas_subscription_id = 'sub_trial_conversion',
  subscription_status = 'pending_payment'
where id = 'd2000000-0000-4000-8000-000000000003';

select is(
  (
    select subscription_type
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000003'
  ),
  'paid',
  'a provider-backed checkout converts the trial contract to paid'
);

update public.organizations
set subscription_status = 'overdue'
where id = 'd2000000-0000-4000-8000-000000000004';

select ok(
  (
    select billing_grace_until <= now() and billing_blocked_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000004'
  ),
  'a zero-day plan blocks immediately when it becomes overdue'
);

select is(
  private.apply_asaas_billing_snapshot(
    'd2000000-0000-4000-8000-000000000001',
    'cus_billing_a',
    'sub_billing_a',
    'ACTIVE',
    'CONFIRMED',
    '2026-08-28',
    now(),
    'pgtap'
  ) ->> 'outcome',
  'applied',
  'a current paid snapshot is applied atomically'
);
select is(
  (
    select subscription_status
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'pending_payment',
  'a generic subscription snapshot cannot activate access without exact payment identity'
);
select is(
  (
    select next_billing_date
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  '2026-08-28'::date,
  'the reconciled provider due date becomes canonical'
);
select ok(
  (
    select billing_last_reconciled_at is not null
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'successful reconciliation stores its ordering cursor'
);
select is(
  private.apply_asaas_billing_snapshot(
    'd2000000-0000-4000-8000-000000000001',
    'cus_billing_a',
    'sub_wrong',
    'ACTIVE',
    'CONFIRMED',
    null,
    now(),
    'pgtap'
  ) ->> 'outcome',
  'identifier_mismatch',
  'polling cannot bind a different subscription to the tenant'
);
select is(
  private.apply_asaas_billing_snapshot(
    'd2000000-0000-4000-8000-000000000001',
    'cus_billing_a',
    'sub_billing_a',
    'ACTIVE',
    'OVERDUE',
    null,
    now() - interval '1 hour',
    'pgtap'
  ) ->> 'outcome',
  'stale',
  'an older polling result cannot roll billing state backwards'
);

update public.organizations
set subscription_status = 'canceled'
where id = 'd2000000-0000-4000-8000-000000000002';

select is(
  (
    select subscription_status
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000002'
  ),
  'cancelled',
  'legacy canceled spelling is normalized before validation'
);
select is(
  (
    select count(*)
    from private.asaas_reconciliation_jobs
    where organization_id = 'd2000000-0000-4000-8000-000000000002'
  ),
  0::bigint,
  'cancelled subscriptions leave the active reconciliation queue'
);
select is(
  private.apply_asaas_billing_snapshot(
    'd2000000-0000-4000-8000-000000000002',
    'cus_billing_b',
    'sub_billing_b',
    'ACTIVE',
    'CONFIRMED',
    null,
    now(),
    'pgtap'
  ) ->> 'status',
  'cancelled',
  'an old paid invoice cannot resurrect a cancelled account'
);
select ok(
  (
    select count(*) >= 1
    from public.subscription_logs
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
      and event_type = 'asaas_reconciled'
  ),
  'provider reconciliation leaves an auditable billing event'
);

insert into public.organizations (
  id,
  name,
  slug,
  plan_id,
  pending_plan_id,
  subscription_type,
  subscription_status,
  max_users
)
values (
  'd2000000-0000-4000-8000-000000000010',
  'Billing Hosted Checkout',
  'billing-hosted-checkout',
  'd1000000-0000-4000-8000-000000000002',
  'd1000000-0000-4000-8000-000000000001',
  'free',
  'active',
  1
);

insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider
)
values (
  'd3000000-0000-4000-8000-000000000010',
  'd2000000-0000-4000-8000-000000000010',
  'd1000000-0000-4000-8000-000000000002',
  'active',
  'manual'
);

set local role service_role;
insert into billing_intent_results (label, result)
values (
  'hosted_created',
  public.reserve_billing_checkout_intent(
    'd2000000-0000-4000-8000-000000000010',
    'CREDIT_CARD'
  )
);
insert into billing_intent_results (label, result)
values (
  'hosted_registered',
  public.register_billing_hosted_checkout(
    (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'hosted_created'
    ),
    'checkout_hosted_001',
    '{"id":"checkout_hosted_001","link":"https://sandbox.asaas.com/checkoutSession/show/checkout_hosted_001","status":"ACTIVE"}'::jsonb
  )
);
set local role postgres;

select is(
  (select result ->> 'outcome' from billing_intent_results where label = 'hosted_registered'),
  'registered',
  'a hosted checkout is registered without card data or a premature subscription'
);
select ok(
  (
    select status = 'pending' and provider_checkout_id = 'checkout_hosted_001'
    from private.billing_checkout_intents
    where id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'hosted_created'
    )
  ),
  'the private ledger retains the hosted checkout identifier'
);

set local role service_role;
select public.reconcile_asaas_payment_webhook_with_intent(
  'evt_hosted_payment',
  'PAYMENT_CONFIRMED',
  now(),
  jsonb_build_object(
    'id', 'pay_hosted_001',
    'customer', 'cus_hosted_001',
    'subscription', 'sub_hosted_001',
    'checkoutSession', 'checkout_hosted_001',
    'billingType', 'CREDIT_CARD',
    'status', 'CONFIRMED',
    'value', 299.90
  ),
  jsonb_build_object(
    'id', 'evt_hosted_payment',
    'event', 'PAYMENT_CONFIRMED'
  )
);
set local role postgres;

select ok(
  (
    select
      subscription_type = 'paid'
      and subscription_status = 'active'
      and plan_id = 'd1000000-0000-4000-8000-000000000001'
      and pending_plan_id is null
      and asaas_subscription_id = 'sub_hosted_001'
    from public.organizations
    where id = 'd2000000-0000-4000-8000-000000000010'
  ),
  'a paid hosted-checkout webhook promotes only its reserved plan'
);
select ok(
  (
    select billing_intent_id = (
      select (result ->> 'intent_id')::uuid
      from billing_intent_results
      where label = 'hosted_created'
    )
    from public.asaas_payments
    where asaas_payment_id = 'pay_hosted_001'
  ),
  'checkoutSession binds a provider payment to the immutable intent'
);

create temporary table billing_wrapper_result (result jsonb);
grant insert, select on billing_wrapper_result to service_role;
select set_config('request.jwt.claim.role', 'service_role', true);
set local role service_role;
insert into billing_wrapper_result (result)
select public.reconcile_asaas_billing_snapshot(
  'd2000000-0000-4000-8000-000000000001',
  'cus_billing_a',
  'sub_billing_a',
  'ACTIVE',
  'RECEIVED',
  '2026-09-28',
  now(),
  'pgtap_service_wrapper'
);
set local role postgres;

select is(
  (select result ->> 'outcome' from billing_wrapper_result),
  'applied',
  'the service-only wrapper reaches the canonical reconciler'
);
select is(
  (
    select status
    from private.asaas_reconciliation_jobs
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
  ),
  'pending',
  'a successful snapshot reschedules periodic reconciliation'
);
select is(
  (
    select attempts
    from private.asaas_reconciliation_jobs
    where organization_id = 'd2000000-0000-4000-8000-000000000001'
  ),
  0,
  'successful reconciliation clears retry attempts'
);

select * from finish();
rollback;
