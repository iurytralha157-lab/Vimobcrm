begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(48);

select has_table(
  'private',
  'billing_organization_asaas_cleanup_claims',
  'organization Asaas cleanup has a durable private claim table'
);
select has_function(
  'public',
  'claim_billing_organization_asaas_cleanup',
  array['uuid', 'text', 'integer'],
  'organization cleanup is claimed before external DELETE calls'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_organization_asaas_cleanup(uuid,text,integer)',
    'execute'
  ),
  false,
  'anonymous callers cannot authorize organization provider cleanup'
);
select is(
  has_function_privilege(
    'service_role',
    'public.claim_billing_organization_asaas_cleanup(uuid,text,integer)',
    'execute'
  ),
  true,
  'only the trusted backend can authorize organization provider cleanup'
);
select is(
  has_function_privilege(
    'anon',
    'public.finalize_billing_organization_asaas_cleanup(uuid,uuid)',
    'execute'
  ),
  false,
  'anonymous callers cannot finalize organization provider cleanup'
);
select is(
  has_function_privilege(
    'service_role',
    'public.finalize_billing_organization_asaas_cleanup(uuid,uuid)',
    'execute'
  ),
  true,
  'the trusted backend can finalize an exact organization cleanup claim'
);
select has_table(
  'private',
  'billing_subscription_card_update_jobs',
  'subscription card updates have a durable private job table'
);
select has_table(
  'private',
  'billing_organization_asaas_cleanup_resources',
  'organization cleanup freezes each provider resource separately'
);
select has_function(
  'public',
  'claim_billing_organization_asaas_cleanup_resource',
  array['uuid', 'uuid', 'text', 'integer'],
  'one exact provider resource is marked before DELETE'
);
select has_function(
  'public',
  'ack_billing_organization_asaas_cleanup_resource',
  array['uuid', 'uuid', 'text', 'text', 'uuid', 'integer', 'jsonb'],
  'provider deletion requires an exact per-resource acknowledgement'
);
select is(
  has_function_privilege(
    'anon',
    'public.claim_billing_organization_asaas_cleanup_resource(uuid,uuid,text,integer)',
    'execute'
  ),
  false,
  'anonymous callers cannot mark an organization provider DELETE boundary'
);
select is(
  has_function_privilege(
    'anon',
    'public.ack_billing_organization_asaas_cleanup_resource(uuid,uuid,text,text,uuid,integer,jsonb)',
    'execute'
  ),
  false,
  'anonymous callers cannot forge a provider deletion acknowledgement'
);

insert into public.admin_subscription_plans (
  id, name, slug, price, payment_grace_days, modules
) values (
  'ca100000-0000-4000-8000-000000000001',
  'Card update fence fixture',
  'card-update-fence-fixture',
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
  asaas_customer_id,
  asaas_subscription_id,
  is_active
) values
(
  'ca200000-0000-4000-8000-000000000001',
  'Legacy cancellation first',
  'legacy-cancellation-first',
  'ca100000-0000-4000-8000-000000000001',
  null,
  'paid',
  'active',
  1,
  'cus_card_fence_legacy_first',
  'sub_card_fence_legacy_first',
  true
),
(
  'ca200000-0000-4000-8000-000000000002',
  'Card marker first',
  'card-marker-first',
  'ca100000-0000-4000-8000-000000000001',
  null,
  'paid',
  'active',
  1,
  'cus_card_fence_marker_first',
  'sub_card_fence_marker_first',
  true
),
(
  'ca200000-0000-4000-8000-000000000003',
  'Organization cleanup safe',
  'organization-cleanup-safe',
  'ca100000-0000-4000-8000-000000000001',
  null,
  'paid',
  'active',
  1,
  'cus_org_cleanup_safe',
  'sub_org_cleanup_safe',
  true
),
(
  'ca200000-0000-4000-8000-000000000004',
  'Organization cleanup boundary',
  'organization-cleanup-boundary',
  'ca100000-0000-4000-8000-000000000001',
  null,
  'paid',
  'active',
  1,
  'cus_org_cleanup_boundary',
  'sub_org_cleanup_boundary',
  true
);

insert into public.subscriptions (
  id,
  organization_id,
  plan_id,
  status,
  provider,
  provider_customer_id,
  provider_subscription_id,
  billing_period_months,
  current_period_end,
  metadata
) values
(
  'ca300000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  'active',
  'asaas',
  'cus_card_fence_legacy_first',
  'sub_card_fence_legacy_first',
  1,
  now() + interval '1 month',
  '{}'::jsonb
),
(
  'ca300000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000002',
  'ca100000-0000-4000-8000-000000000001',
  'active',
  'asaas',
  'cus_card_fence_marker_first',
  'sub_card_fence_marker_first',
  1,
  now() + interval '1 month',
  '{}'::jsonb
),
(
  'ca300000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000003',
  'ca100000-0000-4000-8000-000000000001',
  'active',
  'asaas',
  'cus_org_cleanup_safe',
  'sub_org_cleanup_safe',
  1,
  now() + interval '1 month',
  '{}'::jsonb
),
(
  'ca300000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000004',
  'ca100000-0000-4000-8000-000000000001',
  'active',
  'asaas',
  'cus_org_cleanup_boundary',
  'sub_org_cleanup_boundary',
  1,
  now() + interval '1 month',
  '{}'::jsonb
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
  'ca400000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  297,
  'monthly',
  1,
  'CREDIT_CARD',
  'pending',
  'ca400000-0000-4000-8000-000000000001',
  'cus_card_fence_legacy_first',
  'pay_card_fence_legacy_first',
  '{}'::jsonb,
  now()
),
(
  'ca400000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000002',
  'ca100000-0000-4000-8000-000000000001',
  297,
  'monthly',
  1,
  'CREDIT_CARD',
  'pending',
  'ca400000-0000-4000-8000-000000000002',
  'cus_card_fence_marker_first',
  'pay_card_fence_marker_first',
  '{}'::jsonb,
  now()
),
(
  'ca400000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000003',
  'ca100000-0000-4000-8000-000000000001',
  297,
  'monthly',
  1,
  'PIX',
  'pending',
  'ca400000-0000-4000-8000-000000000003',
  'cus_org_cleanup_safe',
  'pay_org_cleanup_safe',
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
) values
(
  'ca500000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'pay_card_fence_legacy_first',
  'cus_card_fence_legacy_first',
  'CONFIRMED',
  'CREDIT_CARD',
  297,
  current_date,
  '{}'::jsonb,
  'evt_card_fence_legacy_first',
  now()
),
(
  'cb500000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000002',
  'ca400000-0000-4000-8000-000000000002',
  'pay_card_fence_marker_first',
  'cus_card_fence_marker_first',
  'CONFIRMED',
  'CREDIT_CARD',
  297,
  current_date,
  '{}'::jsonb,
  'evt_card_fence_marker_first',
  now()
),
(
  'cc500000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000003',
  'ca400000-0000-4000-8000-000000000003',
  'pay_org_cleanup_safe',
  'cus_org_cleanup_safe',
  'PENDING',
  'PIX',
  297,
  current_date + 2,
  '{}'::jsonb,
  'evt_org_cleanup_safe',
  now()
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
  job_action,
  job_status
) values
(
  'ca500000-0000-4000-8000-000000000001',
  'pay_card_fence_legacy_first',
  'ca200000-0000-4000-8000-000000000001',
  'ca400000-0000-4000-8000-000000000001',
  'ca100000-0000-4000-8000-000000000001',
  1,
  297,
  'cus_card_fence_legacy_first',
  current_date + 30,
  'vimob:billing-card-recurrence:ca500000-0000-4000-8000-000000000001',
  'completed',
  'sub_card_fence_legacy_first',
  now(),
  'create',
  'succeeded'
),
(
  'cb500000-0000-4000-8000-000000000002',
  'pay_card_fence_marker_first',
  'ca200000-0000-4000-8000-000000000002',
  'ca400000-0000-4000-8000-000000000002',
  'ca100000-0000-4000-8000-000000000001',
  1,
  297,
  'cus_card_fence_marker_first',
  current_date + 30,
  'vimob:billing-card-recurrence:cb500000-0000-4000-8000-000000000002',
  'completed',
  'sub_card_fence_marker_first',
  now(),
  'create',
  'succeeded'
);

select set_config('request.jwt.claim.role', 'service_role', true);

create temporary table pgtap_legacy_prepare as
select public.prepare_billing_subscription_card_update(
  'ca600000-0000-4000-8000-000000000001',
  'ca200000-0000-4000-8000-000000000001',
  'saved_only',
  null,
  null
) as result;
select ok(
  (
    select result ->> 'outcome' = 'prepared'
      and result ->> 'state' = 'queued'
      and result ->> 'job_id' = 'ca600000-0000-4000-8000-000000000001'
    from pgtap_legacy_prepare
  ),
  'card update prepare exposes a canonical queued projection'
);
select is(
  public.store_billing_subscription_card_update_credential(
    'ca600000-0000-4000-8000-000000000001',
    'ca200000-0000-4000-8000-000000000001',
    (select (result ->> 'generation')::bigint from pgtap_legacy_prepare),
    null,
    'v1.' || repeat('A', 64),
    '1111'
  ) ->> 'outcome',
  'stored',
  'saved-card mode seals one short-lived provider credential'
);

update public.asaas_payments
set status = 'REFUNDED', updated_at = now()
where id = 'ca500000-0000-4000-8000-000000000001';
select ok(
  (
    select job.status = 'cancelled'
      and job.provider_card_credential is null
      and job.card_last4 is null
      and provision.job_action = 'cancel'
      and provision.job_status = 'pending'
    from private.billing_subscription_card_update_jobs as job
    cross join private.billing_card_recurrence_provisions as provision
    where job.id = 'ca600000-0000-4000-8000-000000000001'
      and provision.payment_id = 'ca500000-0000-4000-8000-000000000001'
  ),
  'a queued legacy cancellation wins before card PUT and shreds the credential'
);
create temporary table pgtap_legacy_claim as
select *
from public.claim_billing_card_recurrence_jobs('legacy-first-worker', 10, 300);
select ok(
  (
    select count(*) = 1
      and bool_and(
        result ->> 'action' = 'cancel'
        and result ->> 'provider_subscription_id'
          = 'sub_card_fence_legacy_first'
      )
    from pgtap_legacy_claim as claimed(result)
  ),
  'the legacy worker claims DELETE after atomically cancelling safe card PUT'
);
update public.organizations
set subscription_status = 'active', is_active = true, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000001';
select ok(
  (
    with response as (
      select public.prepare_billing_subscription_card_update(
        'ca600000-0000-4000-8000-000000000011',
        'ca200000-0000-4000-8000-000000000001',
        'saved_only',
        null,
        null
      ) as result
    )
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'legacy_recurrence_cancellation'
      and result ->> 'cancellation_state' = 'processing'
    from response
  ),
  'a persistent legacy DELETE claim blocks every later card update prepare'
);

create temporary table pgtap_marker_prepare as
select public.prepare_billing_subscription_card_update(
  'ca600000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000002',
  'saved_only',
  null,
  null
) as result;
create temporary table pgtap_marker_store as
select public.store_billing_subscription_card_update_credential(
  'ca600000-0000-4000-8000-000000000002',
  'ca200000-0000-4000-8000-000000000002',
  (select (result ->> 'generation')::bigint from pgtap_marker_prepare),
  null,
  'v1.' || repeat('B', 64),
  '2222'
) as result;
select ok(
  (
    select prepare.result ->> 'outcome' = 'prepared'
      and stored.result ->> 'outcome' = 'stored'
    from pgtap_marker_prepare as prepare
    cross join pgtap_marker_store as stored
  ),
  'the marker-first fixture prepares and seals its card update'
);
create temporary table pgtap_marker_claim as
select *
from public.claim_billing_subscription_card_update_jobs(
  'card-marker-worker', 10, 300
)
where job_id = 'ca600000-0000-4000-8000-000000000002';
select ok(
  (
    select count(*) = 1 and bool_and(claim_outcome = 'claimed')
    from pgtap_marker_claim
  ),
  'the card worker obtains an exact leased subscription PUT job'
);
select is(
  public.mark_billing_subscription_card_update_provider_request_started(
    'ca600000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000002',
    (select (result ->> 'generation')::bigint from pgtap_marker_prepare),
    (select job_lease_id from pgtap_marker_claim)
  ) ->> 'outcome',
  'proceed',
  'the exact card lease crosses the durable provider PUT boundary'
);

update public.asaas_payments
set status = 'REFUNDED', updated_at = now()
where id = 'cb500000-0000-4000-8000-000000000002';
select ok(
  (
    select job.status = 'processing'
      and job.provider_request_lease_id = job.lease_id
      and provision.job_action = 'cancel'
      and provision.job_status = 'pending'
    from private.billing_subscription_card_update_jobs as job
    cross join private.billing_card_recurrence_provisions as provision
    where job.id = 'ca600000-0000-4000-8000-000000000002'
      and provision.payment_id = 'cb500000-0000-4000-8000-000000000002'
  ),
  'a reversal queues DELETE but preserves a card PUT already crossing provider boundary'
);
create temporary table pgtap_marker_blocked_legacy as
select *
from public.claim_billing_card_recurrence_jobs('marker-block-worker', 10, 300);
select ok(
  (
    select not exists (
        select 1
        from pgtap_marker_blocked_legacy as claimed(result)
        where result ->> 'provider_subscription_id'
          = 'sub_card_fence_marker_first'
      )
      and exists (
        select 1
        from private.billing_card_recurrence_provisions as provision
        where provision.payment_id = 'cb500000-0000-4000-8000-000000000002'
          and provision.job_status = 'pending'
      )
  ),
  'legacy DELETE cannot claim while the same subscription PUT is in flight'
);
select is(
  public.fail_billing_subscription_card_update_job(
    'ca600000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000002',
    (select (result ->> 'generation')::bigint from pgtap_marker_prepare),
    (select job_lease_id from pgtap_marker_claim),
    'permanent',
    'provider_card_rejected',
    30
  ) ->> 'outcome',
  'failed',
  'a definitive provider rejection closes the card PUT without ambiguity'
);
create temporary table pgtap_marker_unblocked_legacy as
select *
from public.claim_billing_card_recurrence_jobs('marker-unblocked-worker', 10, 300);
select ok(
  (
    select count(*) = 1
      and bool_and(
        result ->> 'provider_subscription_id'
          = 'sub_card_fence_marker_first'
      )
    from pgtap_marker_unblocked_legacy as claimed(result)
  ),
  'legacy DELETE becomes claimable after a definite card PUT failure'
);
select is(
  public.get_billing_subscription_card_update_status(
    'ca600000-0000-4000-8000-000000000002',
    'ca200000-0000-4000-8000-000000000002',
    null
  ) ->> 'state',
  'failed',
  'dead without manual evidence projects as failed, not manual review'
);

create temporary table pgtap_cleanup_prepare as
select public.prepare_billing_subscription_card_update(
  'ca600000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000003',
  'saved_only',
  null,
  null
) as result;
create temporary table pgtap_cleanup_store as
select public.store_billing_subscription_card_update_credential(
  'ca600000-0000-4000-8000-000000000003',
  'ca200000-0000-4000-8000-000000000003',
  (select (result ->> 'generation')::bigint from pgtap_cleanup_prepare),
  null,
  'v1.' || repeat('C', 64),
  '3333'
) as result;
select ok(
  (
    select prepare.result ->> 'outcome' = 'prepared'
      and stored.result ->> 'outcome' = 'stored'
    from pgtap_cleanup_prepare as prepare
    cross join pgtap_cleanup_store as stored
  ),
  'the cleanup fixture starts with a safe pre-boundary card job'
);
update public.organizations
set is_active = false, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000003';
create temporary table pgtap_cleanup_claim as
select public.claim_billing_organization_asaas_cleanup(
  'ca200000-0000-4000-8000-000000000003',
  'organization-cleanup-worker',
  600
) as result;
select ok(
  (
    select result ->> 'outcome' = 'proceed'
      and (result ->> 'resource_count')::integer = 3
      and (result ->> 'remaining_count')::integer = 3
      and not result ? 'customer_id'
      and not result ? 'subscription_id'
      and not result ? 'payment_ids'
      and (result ->> 'claim_token')::uuid is not null
    from pgtap_cleanup_claim
  ),
  'organization cleanup freezes the exact customer, subscription and payment tuple'
);
select ok(
  (
    select job.status = 'cancelled'
      and job.provider_card_credential is null
      and job.card_last4 is null
      and capability.revoked_at is not null
      and capability.attempt_lease_id is null
    from private.billing_subscription_card_update_jobs as job
    join public.billing_payment_checkout_capabilities as capability
      on capability.organization_id = job.organization_id
    where job.id = 'ca600000-0000-4000-8000-000000000003'
      and capability.payment_id = 'cc500000-0000-4000-8000-000000000003'
  ),
  'cleanup cancels and shreds a safe card job and revokes public checkout'
);
select ok(
  (
    with response as (
      select public.prepare_billing_subscription_card_update(
        'ca600000-0000-4000-8000-000000000013',
        'ca200000-0000-4000-8000-000000000003',
        'saved_only',
        null,
        null
      ) as result
    )
    select result ->> 'outcome' = 'organization_inactive'
    from response
  ),
  'the durable organization cleanup claim fences future card updates'
);
select ok(
  (
    with response as (
      select public.claim_billing_organization_asaas_cleanup(
        'ca200000-0000-4000-8000-000000000003',
        'organization-cleanup-worker',
        600
      ) as result
    )
    select response.result ->> 'outcome' = 'recover_only'
      and response.result ->> 'claim_token'
        = (select result ->> 'claim_token' from pgtap_cleanup_claim)
      and (response.result ->> 'resource_count')::integer = 3
      and (response.result ->> 'remaining_count')::integer = 3
      and not response.result ? 'payment_ids'
    from response
  ),
  'the same cleanup worker recovers only the original frozen tuple'
);
select ok(
  (
    with response as (
      select public.claim_billing_organization_asaas_cleanup(
        'ca200000-0000-4000-8000-000000000003',
        'competing-cleanup-worker',
        600
      ) as result
    )
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'organization_cleanup'
    from response
  ),
  'a concurrent cleanup worker cannot mint another provider tuple'
);
select is(
  public.finalize_billing_organization_asaas_cleanup(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim)
  ) ->> 'outcome',
  'resources_pending',
  'the root cleanup claim cannot finalize without exact resource acknowledgements'
);

create temporary table pgtap_cleanup_payment_resource as
select public.claim_billing_organization_asaas_cleanup_resource(
  'ca200000-0000-4000-8000-000000000003',
  (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
  'organization-cleanup-worker',
  300
) as result;
select ok(
  (
    select result ->> 'outcome' = 'proceed'
      and result ->> 'resource_kind' = 'payment'
      and result ->> 'resource_id' = 'pay_org_cleanup_safe'
      and (result ->> 'attempt_token')::uuid is not null
    from pgtap_cleanup_payment_resource
  ),
  'cleanup claims the actionable payment before parent resources'
);
select is(
  public.ack_billing_organization_asaas_cleanup_resource(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
    'payment',
    'pay_org_cleanup_safe',
    (select (result ->> 'attempt_token')::uuid
     from pgtap_cleanup_payment_resource),
    200,
    '{"deleted":true,"id":"pay_org_cleanup_safe"}'::jsonb
  ) ->> 'outcome',
  'succeeded',
  'an exact HTTP 200 payment acknowledgement is persisted'
);

create temporary table pgtap_cleanup_subscription_resource as
select public.claim_billing_organization_asaas_cleanup_resource(
  'ca200000-0000-4000-8000-000000000003',
  (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
  'organization-cleanup-worker',
  300
) as result;
select ok(
  (
    select result ->> 'outcome' = 'proceed'
      and result ->> 'resource_kind' = 'subscription'
      and result ->> 'resource_id' = 'sub_org_cleanup_safe'
    from pgtap_cleanup_subscription_resource
  ),
  'cleanup claims the subscription only after every payment ack'
);
select is(
  public.ack_billing_organization_asaas_cleanup_resource(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
    'subscription',
    'sub_org_cleanup_safe',
    (select (result ->> 'attempt_token')::uuid
     from pgtap_cleanup_subscription_resource),
    200,
    '{"deleted":true,"id":"sub_org_cleanup_safe"}'::jsonb
  ) ->> 'outcome',
  'succeeded',
  'an exact HTTP 200 subscription acknowledgement is persisted'
);

create temporary table pgtap_cleanup_customer_resource as
select public.claim_billing_organization_asaas_cleanup_resource(
  'ca200000-0000-4000-8000-000000000003',
  (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
  'organization-cleanup-worker',
  300
) as result;
select ok(
  (
    select result ->> 'outcome' = 'proceed'
      and result ->> 'resource_kind' = 'customer'
      and result ->> 'resource_id' = 'cus_org_cleanup_safe'
    from pgtap_cleanup_customer_resource
  ),
  'cleanup claims the customer last'
);
select is(
  public.ack_billing_organization_asaas_cleanup_resource(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
    'customer',
    'cus_org_cleanup_safe',
    (select (result ->> 'attempt_token')::uuid
     from pgtap_cleanup_customer_resource),
    200,
    '{"deleted":true,"id":"cus_org_cleanup_safe"}'::jsonb
  ) ->> 'outcome',
  'succeeded',
  'an exact HTTP 200 customer acknowledgement is persisted'
);
select is(
  public.claim_billing_organization_asaas_cleanup_resource(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim),
    'organization-cleanup-worker',
    300
  ) ->> 'outcome',
  'complete',
  'the resource queue completes only after every exact acknowledgement'
);
select is(
  public.finalize_billing_organization_asaas_cleanup(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim)
  ) ->> 'outcome',
  'completed',
  'the exact cleanup token finalizes after all remote deletes are proven'
);
select is(
  public.finalize_billing_organization_asaas_cleanup(
    'ca200000-0000-4000-8000-000000000003',
    (select (result ->> 'claim_token')::uuid from pgtap_cleanup_claim)
  ) ->> 'outcome',
  'already_completed',
  'a lost organization cleanup finalization response is idempotent'
);

create temporary table pgtap_boundary_prepare as
select public.prepare_billing_subscription_card_update(
  'ca600000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000004',
  'saved_only',
  null,
  null
) as result;
create temporary table pgtap_boundary_store as
select public.store_billing_subscription_card_update_credential(
  'ca600000-0000-4000-8000-000000000004',
  'ca200000-0000-4000-8000-000000000004',
  (select (result ->> 'generation')::bigint from pgtap_boundary_prepare),
  null,
  'v1.' || repeat('D', 64),
  '4444'
) as result;
create temporary table pgtap_boundary_claim as
select *
from public.claim_billing_subscription_card_update_jobs(
  'cleanup-boundary-worker', 10, 300
)
where job_id = 'ca600000-0000-4000-8000-000000000004';
select is(
  public.mark_billing_subscription_card_update_provider_request_started(
    'ca600000-0000-4000-8000-000000000004',
    'ca200000-0000-4000-8000-000000000004',
    (select (result ->> 'generation')::bigint from pgtap_boundary_prepare),
    (select job_lease_id from pgtap_boundary_claim)
  ) ->> 'outcome',
  'proceed',
  'the cleanup boundary fixture crosses the provider PUT marker'
);
update public.organizations
set is_active = false, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000004';
select ok(
  (
    with response as (
      select public.claim_billing_organization_asaas_cleanup(
        'ca200000-0000-4000-8000-000000000004',
        'blocked-organization-cleanup',
        600
      ) as result
    )
    select result ->> 'outcome' = 'busy'
      and result ->> 'busy_reason' = 'card_update_provider_request'
      and not exists (
        select 1
        from private.billing_organization_asaas_cleanup_claims as cleanup
        where cleanup.organization_id
          = 'ca200000-0000-4000-8000-000000000004'
      )
      and exists (
        select 1
        from private.billing_subscription_card_update_jobs as job
        where job.id = 'ca600000-0000-4000-8000-000000000004'
          and job.status = 'processing'
      )
    from response
  ),
  'organization DELETE is blocked while the same subscription PUT is in flight'
);
update public.organizations
set is_active = true, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000004';
select is(
  public.fail_billing_subscription_card_update_job(
    'ca600000-0000-4000-8000-000000000004',
    'ca200000-0000-4000-8000-000000000004',
    (select (result ->> 'generation')::bigint from pgtap_boundary_prepare),
    (select job_lease_id from pgtap_boundary_claim),
    'ambiguous',
    'provider_update_timeout',
    30
  ) ->> 'outcome',
  'retry',
  'an ambiguous PUT keeps the same sealed credential for reconciliation'
);
update public.organizations
set is_active = false, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000004';
select ok(
  (
    with response as (
      select public.claim_billing_organization_asaas_cleanup(
        'ca200000-0000-4000-8000-000000000004',
        'manual-organization-cleanup',
        600
      ) as result
    )
    select result ->> 'outcome' = 'manual_review'
      and result ->> 'reason' = 'card_update_provider_outcome_ambiguous'
      and not exists (
        select 1
        from private.billing_organization_asaas_cleanup_claims as cleanup
        where cleanup.organization_id
          = 'ca200000-0000-4000-8000-000000000004'
      )
    from response
  ),
  'ambiguous card outcome forces assisted review and never authorizes DELETE'
);

update public.organizations
set is_active = true, updated_at = now()
where id = 'ca200000-0000-4000-8000-000000000004';

update private.billing_subscription_card_update_jobs as job
set next_attempt_at = clock_timestamp() - interval '1 second'
where job.id = 'ca600000-0000-4000-8000-000000000004';

create temporary table pgtap_exhaustion_claim as
select *
from public.claim_billing_subscription_card_update_jobs(
  'card-exhaustion-worker', 10, 300
)
where job_id = 'ca600000-0000-4000-8000-000000000004';
select ok(
  (
    select count(*) = 1
      and bool_and(claim_outcome = 'replay')
    from pgtap_exhaustion_claim
  ),
  'an ambiguous retry is reclaimed with the same sealed credential'
);

update private.billing_subscription_card_update_jobs as job
set
  lease_started_at = clock_timestamp() - interval '2 seconds',
  lease_expires_at = clock_timestamp() - interval '1 second',
  max_attempts = job.attempts
where job.id = 'ca600000-0000-4000-8000-000000000004';

create temporary table pgtap_exhaustion_result as
select *
from public.claim_billing_subscription_card_update_jobs(
  'card-exhaustion-finalizer', 10, 300
);
select is(
  (
    select count(*)
    from pgtap_exhaustion_result
    where job_id = 'ca600000-0000-4000-8000-000000000004'
  ),
  0::bigint,
  'an expired card job at its attempt limit is never delivered again'
);
select ok(
  (
    select job.status = 'dead'
      and job.provider_card_credential is null
      and job.credential_attempt_lease_id is null
      and job.lease_id is null
      and job.lease_expires_at is null
      and job.manual_review_at is not null
      and job.dead_lettered_at is not null
      and job.last_error_code = 'card_update_attempts_exhausted'
    from private.billing_subscription_card_update_jobs as job
    where job.id = 'ca600000-0000-4000-8000-000000000004'
  ),
  'attempt exhaustion shreds the credential and preserves ambiguity for review'
);

select set_config('request.jwt.claim.role', '', true);
select * from finish();
rollback;
