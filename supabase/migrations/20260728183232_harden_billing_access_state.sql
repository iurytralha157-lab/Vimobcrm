alter table public.admin_subscription_plans
  add column if not exists payment_grace_days integer not null default 3;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_subscription_plans_payment_grace_days_check'
      and conrelid = 'public.admin_subscription_plans'::regclass
  ) then
    alter table public.admin_subscription_plans
      add constraint admin_subscription_plans_payment_grace_days_check
      check (payment_grace_days between 0 and 30);
  end if;
end
$$;

alter table public.organizations
  add column if not exists pending_plan_id uuid
    references public.admin_subscription_plans(id) on delete set null,
  add column if not exists billing_status_changed_at timestamptz,
  add column if not exists billing_delinquent_at timestamptz,
  add column if not exists billing_grace_until timestamptz,
  add column if not exists billing_blocked_at timestamptz,
  add column if not exists billing_last_reconciled_at timestamptz;

create table if not exists private.billing_checkout_intents (
  id uuid primary key,
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  pending_plan_id uuid not null
    references public.admin_subscription_plans(id) on delete restrict,
  amount numeric(10, 2) not null check (amount > 0),
  billing_cycle text not null check (billing_cycle in ('monthly', 'yearly')),
  billing_method text not null check (billing_method in ('PIX', 'CREDIT_CARD')),
  status text not null
    check (status in ('creating', 'pending', 'confirmed', 'cancelled', 'failed')),
  external_reference text not null unique,
  provider_customer_id text,
  provider_payment_id text,
  provider_subscription_id text,
  provider_response jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_response) = 'object'),
  provider_request_started_at timestamptz,
  provider_registered_at timestamptz,
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  failed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists billing_checkout_intents_one_active_org_idx
  on private.billing_checkout_intents (organization_id)
  where status in ('creating', 'pending');

create unique index if not exists billing_checkout_intents_provider_payment_idx
  on private.billing_checkout_intents (provider_payment_id)
  where provider_payment_id is not null;

create unique index if not exists billing_checkout_intents_provider_subscription_idx
  on private.billing_checkout_intents (provider_subscription_id)
  where provider_subscription_id is not null;

create index if not exists billing_checkout_intents_tuple_idx
  on private.billing_checkout_intents (
    organization_id,
    pending_plan_id,
    amount,
    billing_cycle,
    billing_method,
    created_at desc
  );

alter table public.asaas_payments
  add column if not exists billing_intent_id uuid
    references private.billing_checkout_intents(id) on delete set null;

create index if not exists asaas_payments_billing_intent_idx
  on public.asaas_payments (billing_intent_id)
  where billing_intent_id is not null;

alter table private.billing_checkout_intents enable row level security;
revoke all on table private.billing_checkout_intents
  from public, anon, authenticated, service_role;

create or replace function private.lock_asaas_billing_resources(
  p_payment_id text,
  p_subscription_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resource text;
begin
  for v_resource in
    select distinct resource
    from unnest(
      array[
        case
          when nullif(btrim(coalesce(p_payment_id, '')), '') is not null
            then 'payment:' || btrim(p_payment_id)
        end,
        case
          when nullif(btrim(coalesce(p_subscription_id, '')), '') is not null
            then 'subscription:' || btrim(p_subscription_id)
        end
      ]
    ) as resources(resource)
    where resource is not null
    order by resource
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(v_resource, 734621)
    );
  end loop;
end;
$$;

revoke all on function private.lock_asaas_billing_resources(text, text)
  from public, anon, authenticated, service_role;

create or replace function public.reserve_billing_checkout_intent(
  p_organization_id uuid,
  p_billing_method text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text := upper(btrim(coalesce(p_billing_method, '')));
  v_org public.organizations%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_target_plan_id uuid;
  v_cycle text;
  v_intent private.billing_checkout_intents%rowtype;
  v_intent_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_organization_id is null
     or v_method not in ('PIX', 'CREDIT_CARD') then
    raise exception 'invalid billing checkout request'
      using errcode = '22023';
  end if;

  select *
  into v_org
  from public.organizations
  where id = p_organization_id
    and is_active = true
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  v_target_plan_id := coalesce(
    v_org.pending_plan_id,
    case
      when v_org.subscription_status = 'pending_payment' then v_org.plan_id
      else null
    end
  );

  if v_target_plan_id is null then
    return jsonb_build_object(
      'outcome',
      case
        when v_org.subscription_type = 'paid'
          and v_org.subscription_status = 'active'
          then 'already_active'
        else 'plan_not_staged'
      end
    );
  end if;

  select *
  into v_plan
  from public.admin_subscription_plans
  where id = v_target_plan_id
    and coalesce(is_active, true) = true;

  if not found or coalesce(v_plan.price, 0) <= 0 then
    return jsonb_build_object('outcome', 'invalid_plan');
  end if;

  v_cycle := case
    when lower(btrim(coalesce(v_plan.billing_cycle, 'monthly'))) = 'yearly'
      then 'yearly'
    else 'monthly'
  end;

  select *
  into v_intent
  from private.billing_checkout_intents
  where organization_id = p_organization_id
    and status in ('creating', 'pending')
  order by created_at desc, id desc
  limit 1
  for update;

  if found then
    if v_intent.pending_plan_id is distinct from v_target_plan_id
       or v_intent.amount is distinct from v_plan.price
       or v_intent.billing_cycle is distinct from v_cycle
       or v_intent.billing_method is distinct from v_method then
      return jsonb_build_object(
        'outcome', 'active_intent_conflict',
        'intent_id', v_intent.id,
        'plan_id', v_intent.pending_plan_id,
        'amount', v_intent.amount,
        'billing_cycle', v_intent.billing_cycle,
        'billing_method', v_intent.billing_method,
        'status', v_intent.status,
        'provider_payment_id', v_intent.provider_payment_id,
        'provider_subscription_id', v_intent.provider_subscription_id,
        'last_error', v_intent.last_error
      );
    end if;

    return jsonb_build_object(
      'outcome',
      case
        when v_intent.status = 'pending' then 'reuse'
        when v_intent.provider_request_started_at is null
          or v_intent.provider_request_started_at <= now() - interval '45 seconds'
          then 'recover'
        else 'in_progress'
      end,
      'intent_id', v_intent.id,
      'external_reference', v_intent.external_reference,
      'plan_id', v_intent.pending_plan_id,
      'plan_name', v_plan.name,
      'amount', v_intent.amount,
      'billing_cycle', v_intent.billing_cycle,
      'billing_method', v_intent.billing_method,
      'status', v_intent.status,
      'provider_customer_id', v_intent.provider_customer_id,
      'provider_payment_id', v_intent.provider_payment_id,
      'provider_subscription_id', v_intent.provider_subscription_id,
      'provider_response', v_intent.provider_response,
      'last_error', v_intent.last_error
    );
  end if;

  v_intent_id := gen_random_uuid();
  insert into private.billing_checkout_intents (
    id,
    organization_id,
    pending_plan_id,
    amount,
    billing_cycle,
    billing_method,
    status,
    external_reference,
    provider_request_started_at
  )
  values (
    v_intent_id,
    p_organization_id,
    v_target_plan_id,
    v_plan.price,
    v_cycle,
    v_method,
    'creating',
    v_intent_id::text,
    now()
  );

  return jsonb_build_object(
    'outcome', 'create',
    'intent_id', v_intent_id,
    'external_reference', v_intent_id::text,
    'plan_id', v_target_plan_id,
    'plan_name', v_plan.name,
    'amount', v_plan.price,
    'billing_cycle', v_cycle,
    'billing_method', v_method,
    'status', 'creating'
  );
end;
$$;

revoke all on function public.reserve_billing_checkout_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout_intent(uuid, text)
  to service_role;

create or replace function public.register_billing_checkout_provider(
  p_intent_id uuid,
  p_customer_id text,
  p_payment_id text default null,
  p_subscription_id text default null,
  p_provider_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_customer_id text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_existing_customer_id text;
  v_existing_subscription_id text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_intent_id is null or v_customer_id is null
     or jsonb_typeof(coalesce(p_provider_response, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid billing provider registration'
      using errcode = '22023';
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment_id,
    v_subscription_id
  );

  select *
  into v_intent
  from private.billing_checkout_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if (v_intent.billing_method = 'PIX' and v_payment_id is null)
     or (v_intent.billing_method = 'CREDIT_CARD' and v_subscription_id is null) then
    raise exception 'provider resource does not match billing method'
      using errcode = '22023';
  end if;

  if v_intent.provider_payment_id is not null
     and v_payment_id is distinct from v_intent.provider_payment_id then
    raise exception 'billing intent already has a different payment'
      using errcode = '22023';
  end if;

  if v_intent.provider_subscription_id is not null
     and v_subscription_id is distinct from v_intent.provider_subscription_id then
    raise exception 'billing intent already has a different subscription'
      using errcode = '22023';
  end if;

  if v_intent.status not in ('creating', 'pending', 'confirmed') then
    return jsonb_build_object('outcome', 'intent_not_registerable');
  end if;

  select asaas_customer_id, asaas_subscription_id
  into v_existing_customer_id, v_existing_subscription_id
  from public.organizations
  where id = v_intent.organization_id
  for update;

  if v_existing_customer_id is not null
     and btrim(v_existing_customer_id) <> v_customer_id then
    raise exception 'organization already has a different Asaas customer'
      using errcode = '22023';
  end if;

  if v_subscription_id is not null
     and v_existing_subscription_id is not null
     and btrim(v_existing_subscription_id) <> v_subscription_id then
    raise exception 'organization already has a different Asaas subscription'
      using errcode = '22023';
  end if;

  update private.billing_checkout_intents
  set
    status = case when status = 'confirmed' then status else 'pending' end,
    provider_customer_id = v_customer_id,
    provider_payment_id = coalesce(v_payment_id, provider_payment_id),
    provider_subscription_id = coalesce(v_subscription_id, provider_subscription_id),
    provider_response = coalesce(p_provider_response, '{}'::jsonb),
    provider_registered_at = coalesce(provider_registered_at, now()),
    last_error = null,
    updated_at = now()
  where id = p_intent_id;

  update public.organizations
  set
    asaas_customer_id = coalesce(asaas_customer_id, v_customer_id),
    asaas_subscription_id = coalesce(asaas_subscription_id, v_subscription_id),
    updated_at = now()
  where id = v_intent.organization_id;

  update public.subscriptions
  set
    provider = 'asaas',
    provider_customer_id = coalesce(provider_customer_id, v_customer_id),
    provider_subscription_id = coalesce(provider_subscription_id, v_subscription_id),
    updated_at = now()
  where organization_id = v_intent.organization_id;

  -- A fast webhook can persist the paid invoice before the Edge Function has
  -- stored the provider id on this intent. Binding the already-seen invoice
  -- re-fires the confirmation trigger and closes that race atomically.
  update public.asaas_payments
  set
    billing_intent_id = p_intent_id,
    updated_at = now()
  where organization_id = v_intent.organization_id
    and (
      (v_payment_id is not null and asaas_payment_id = v_payment_id)
      or (
        v_subscription_id is not null
        and asaas_subscription_id = v_subscription_id
      )
    )
    and billing_intent_id is distinct from p_intent_id;

  return jsonb_build_object(
    'outcome',
    case when v_intent.status = 'pending' then 'reused' else 'registered' end,
    'intent_id', p_intent_id,
    'organization_id', v_intent.organization_id,
    'provider_payment_id', v_payment_id,
    'provider_subscription_id', v_subscription_id
  );
end;
$$;

revoke all on function public.register_billing_checkout_provider(
  uuid,
  text,
  text,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.register_billing_checkout_provider(
  uuid,
  text,
  text,
  text,
  jsonb
) to service_role;

create or replace function public.store_billing_checkout_payment(
  p_intent_id uuid,
  p_organization_id uuid,
  p_payment_id text,
  p_customer_id text default null,
  p_subscription_id text default null,
  p_billing_type text default null,
  p_status text default null,
  p_value numeric default null,
  p_net_value numeric default null,
  p_due_date date default null,
  p_payment_date date default null,
  p_invoice_url text default null,
  p_raw_event jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_existing public.asaas_payments%rowtype;
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_customer_id text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_billing_type text := upper(nullif(btrim(coalesce(p_billing_type, '')), ''));
  v_status text := upper(nullif(btrim(coalesce(p_status, '')), ''));
  v_stored_status text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_intent_id is null
     or p_organization_id is null
     or v_payment_id is null
     or jsonb_typeof(coalesce(p_raw_event, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid billing payment persistence'
      using errcode = '22023';
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment_id,
    v_subscription_id
  );

  select *
  into v_intent
  from private.billing_checkout_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_intent.organization_id is distinct from p_organization_id then
    raise exception 'billing intent belongs to a different organization'
      using errcode = '22023';
  end if;

  if v_intent.status not in ('creating', 'pending', 'confirmed') then
    return jsonb_build_object('outcome', 'intent_not_storeable');
  end if;

  if v_intent.provider_customer_id is not null
     and v_customer_id is not null
     and v_intent.provider_customer_id <> v_customer_id then
    raise exception 'payment customer does not match billing intent'
      using errcode = '22023';
  end if;

  if v_intent.provider_subscription_id is not null
     and v_subscription_id is not null
     and v_intent.provider_subscription_id <> v_subscription_id then
    raise exception 'payment subscription does not match billing intent'
      using errcode = '22023';
  end if;

  if v_intent.billing_method = 'PIX'
     and v_intent.provider_payment_id is not null
     and v_intent.provider_payment_id <> v_payment_id then
    raise exception 'payment does not match Pix billing intent'
      using errcode = '22023';
  end if;

  if v_billing_type is not null
     and v_billing_type <> v_intent.billing_method then
    raise exception 'payment method does not match billing intent'
      using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.asaas_payments
  where asaas_payment_id = v_payment_id
  for update;

  if found then
    if v_existing.organization_id is distinct from p_organization_id then
      raise exception 'provider payment belongs to a different organization'
        using errcode = '22023';
    end if;

    if v_existing.billing_intent_id is not null
       and v_existing.billing_intent_id is distinct from p_intent_id then
      raise exception 'provider payment belongs to a different billing intent'
        using errcode = '22023';
    end if;
  end if;

  insert into public.asaas_payments (
    organization_id,
    billing_intent_id,
    asaas_payment_id,
    asaas_customer_id,
    asaas_subscription_id,
    status,
    billing_type,
    value,
    net_value,
    due_date,
    payment_date,
    invoice_url,
    raw_event
  )
  values (
    p_organization_id,
    p_intent_id,
    v_payment_id,
    coalesce(v_customer_id, v_intent.provider_customer_id),
    coalesce(v_subscription_id, v_intent.provider_subscription_id),
    v_status,
    coalesce(v_billing_type, v_intent.billing_method),
    p_value,
    p_net_value,
    p_due_date,
    p_payment_date,
    nullif(btrim(coalesce(p_invoice_url, '')), ''),
    coalesce(p_raw_event, '{}'::jsonb)
  )
  on conflict (asaas_payment_id) do update
  set
    billing_intent_id = excluded.billing_intent_id,
    asaas_customer_id = coalesce(
      public.asaas_payments.asaas_customer_id,
      excluded.asaas_customer_id
    ),
    asaas_subscription_id = coalesce(
      public.asaas_payments.asaas_subscription_id,
      excluded.asaas_subscription_id
    ),
    status = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.status
      else coalesce(excluded.status, public.asaas_payments.status)
    end,
    billing_type = coalesce(
      public.asaas_payments.billing_type,
      excluded.billing_type
    ),
    value = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.value
      else coalesce(excluded.value, public.asaas_payments.value)
    end,
    net_value = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.net_value
      else coalesce(excluded.net_value, public.asaas_payments.net_value)
    end,
    due_date = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.due_date
      else coalesce(excluded.due_date, public.asaas_payments.due_date)
    end,
    payment_date = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.payment_date
      else coalesce(excluded.payment_date, public.asaas_payments.payment_date)
    end,
    invoice_url = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.invoice_url
      else coalesce(excluded.invoice_url, public.asaas_payments.invoice_url)
    end,
    raw_event = case
      when public.asaas_payments.last_webhook_event_at is not null
        then public.asaas_payments.raw_event
      else excluded.raw_event
    end,
    updated_at = now()
  returning status into v_stored_status;

  return jsonb_build_object(
    'outcome', 'stored',
    'intent_id', p_intent_id,
    'payment_id', v_payment_id,
    'status', v_stored_status
  );
end;
$$;

revoke all on function public.store_billing_checkout_payment(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  date,
  date,
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function public.store_billing_checkout_payment(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  numeric,
  date,
  date,
  text,
  jsonb
) to service_role;

create or replace function private.billing_checkout_organization_from_reference(
  p_external_reference text,
  p_customer_id text,
  p_subscription_id text
)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select intent.organization_id
  from private.billing_checkout_intents intent
  where intent.external_reference = nullif(
      btrim(coalesce(p_external_reference, '')),
      ''
    )
    and (
      intent.provider_customer_id is null
      or nullif(btrim(coalesce(p_customer_id, '')), '') is null
      or intent.provider_customer_id = nullif(
        btrim(coalesce(p_customer_id, '')),
        ''
      )
    )
    and (
      intent.provider_subscription_id is null
      or nullif(btrim(coalesce(p_subscription_id, '')), '') is null
      or intent.provider_subscription_id = nullif(
        btrim(coalesce(p_subscription_id, '')),
        ''
      )
    )
  limit 1
$$;

revoke all on function private.billing_checkout_organization_from_reference(
  text,
  text,
  text
) from public, anon, authenticated, service_role;

create or replace function public.reconcile_asaas_payment_webhook_with_intent(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_payment jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment jsonb := p_payment;
  v_organization_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  perform private.lock_asaas_billing_resources(
    p_payment ->> 'id',
    p_payment ->> 'subscription'
  );

  v_organization_id :=
    private.billing_checkout_organization_from_reference(
      p_payment ->> 'externalReference',
      p_payment ->> 'customer',
      p_payment ->> 'subscription'
    );

  if v_organization_id is not null then
    v_payment := jsonb_set(
      p_payment,
      '{externalReference}',
      to_jsonb(v_organization_id::text),
      true
    );
  end if;

  return public.reconcile_asaas_payment_webhook(
    p_event_id,
    p_event_type,
    p_event_at,
    v_payment,
    p_payload
  );
end;
$$;

revoke all on function public.reconcile_asaas_payment_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_asaas_payment_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

create or replace function public.reconcile_asaas_subscription_webhook_with_intent(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_subscription jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subscription jsonb := p_subscription;
  v_organization_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  perform private.lock_asaas_billing_resources(
    null,
    p_subscription ->> 'id'
  );

  v_organization_id :=
    private.billing_checkout_organization_from_reference(
      p_subscription ->> 'externalReference',
      p_subscription ->> 'customer',
      p_subscription ->> 'id'
    );

  if v_organization_id is not null then
    v_subscription := jsonb_set(
      p_subscription,
      '{externalReference}',
      to_jsonb(v_organization_id::text),
      true
    );
  end if;

  return public.reconcile_asaas_subscription_webhook(
    p_event_id,
    p_event_type,
    p_event_at,
    v_subscription,
    p_payload
  );
end;
$$;

revoke all on function public.reconcile_asaas_subscription_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_asaas_subscription_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

create or replace function public.fail_billing_checkout_intent(
  p_intent_id uuid,
  p_error text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  update private.billing_checkout_intents
  set
    status = 'failed',
    failed_at = now(),
    last_error = left(coalesce(nullif(btrim(p_error), ''), 'provider_rejected'), 1000),
    updated_at = now()
  where id = p_intent_id
    and status = 'creating'
    and provider_payment_id is null
    and provider_subscription_id is null;

  get diagnostics v_updated = row_count;
  return jsonb_build_object(
    'outcome',
    case when v_updated = 1 then 'failed' else 'unchanged' end
  );
end;
$$;

revoke all on function public.fail_billing_checkout_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.fail_billing_checkout_intent(uuid, text)
  to service_role;

create or replace function public.cancel_billing_checkout_intent(
  p_organization_id uuid,
  p_payment_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_payment_status text;
  v_updated integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_organization_id is null or v_payment_id is null then
    raise exception 'invalid billing cancellation request'
      using errcode = '22023';
  end if;

  select upper(btrim(coalesce(status, '')))
  into v_payment_status
  from public.asaas_payments
  where organization_id = p_organization_id
    and asaas_payment_id = v_payment_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'payment_not_found');
  end if;

  if v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
    return jsonb_build_object('outcome', 'already_paid');
  end if;

  update private.billing_checkout_intents
  set
    status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, now()),
    last_error = 'payment_cancelled',
    updated_at = now()
  where organization_id = p_organization_id
    and provider_payment_id = v_payment_id
    and billing_method = 'PIX'
    and status in ('creating', 'pending');

  get diagnostics v_updated = row_count;

  update public.asaas_payments
  set
    status = 'CANCELED',
    raw_event = coalesce(raw_event, '{}'::jsonb) || jsonb_build_object(
      'local_cancellation',
      jsonb_build_object(
        'source', 'checkout',
        'recorded_at', now()
      )
    ),
    updated_at = now()
  where organization_id = p_organization_id
    and asaas_payment_id = v_payment_id
    and upper(btrim(coalesce(status, '')))
      not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH');

  return jsonb_build_object(
    'outcome',
    case
      when v_updated = 1 then 'cancelled'
      when v_payment_status in ('CANCELED', 'CANCELLED', 'DELETED')
        then 'already_cancelled'
      else 'unchanged'
    end
  );
end;
$$;

revoke all on function public.cancel_billing_checkout_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.cancel_billing_checkout_intent(uuid, text)
  to service_role;

create or replace function private.confirm_billing_checkout_intent(
  p_payment_id text,
  p_subscription_id text,
  p_payment_status text,
  p_paid_amount numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_payment_status text := upper(btrim(coalesce(p_payment_status, '')));
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
begin
  if v_payment_status not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
    return jsonb_build_object('outcome', 'not_paid');
  end if;

  if v_payment_id is null and v_subscription_id is null then
    return jsonb_build_object('outcome', 'provider_resource_missing');
  end if;

  select *
  into v_intent
  from private.billing_checkout_intents
  where status in ('creating', 'pending', 'confirmed')
    and (
      (v_payment_id is not null and provider_payment_id = v_payment_id)
      or (
        v_subscription_id is not null
        and provider_subscription_id = v_subscription_id
      )
    )
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_intent.status = 'confirmed' then
    return jsonb_build_object(
      'outcome', 'already_confirmed',
      'intent_id', v_intent.id
    );
  end if;

  if p_paid_amount is not null
     and abs(v_intent.amount - p_paid_amount) > 0.01 then
    update private.billing_checkout_intents
    set
      last_error = format(
        'amount_mismatch expected=%s received=%s',
        v_intent.amount,
        p_paid_amount
      ),
      updated_at = now()
    where id = v_intent.id;

    return jsonb_build_object(
      'outcome', 'amount_mismatch',
      'intent_id', v_intent.id
    );
  end if;

  select *
  into v_org
  from public.organizations
  where id = v_intent.organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  if not (
    v_org.pending_plan_id = v_intent.pending_plan_id
    or (
      v_org.pending_plan_id is null
      and v_org.subscription_status = 'pending_payment'
      and v_org.plan_id = v_intent.pending_plan_id
    )
  ) then
    update private.billing_checkout_intents
    set
      last_error = 'pending_plan_mismatch',
      updated_at = now()
    where id = v_intent.id;

    return jsonb_build_object(
      'outcome', 'pending_plan_mismatch',
      'intent_id', v_intent.id
    );
  end if;

  select *
  into v_plan
  from public.admin_subscription_plans
  where id = v_intent.pending_plan_id;

  if not found then
    return jsonb_build_object('outcome', 'plan_not_found');
  end if;

  update private.billing_checkout_intents
  set
    status = 'confirmed',
    provider_payment_id = coalesce(provider_payment_id, v_payment_id),
    provider_subscription_id = coalesce(provider_subscription_id, v_subscription_id),
    confirmed_at = coalesce(confirmed_at, now()),
    last_error = null,
    updated_at = now()
  where id = v_intent.id;

  update public.organizations
  set
    plan_id = v_intent.pending_plan_id,
    pending_plan_id = null,
    subscription_value = v_intent.amount,
    subscription_type = 'paid',
    subscription_status = 'active',
    trial_ends_at = null,
    max_users = coalesce(v_plan.max_users, max_users),
    asaas_customer_id = coalesce(asaas_customer_id, v_intent.provider_customer_id),
    asaas_subscription_id = coalesce(
      asaas_subscription_id,
      v_intent.provider_subscription_id,
      v_subscription_id
    ),
    updated_at = now()
  where id = v_intent.organization_id;

  update public.subscriptions
  set
    plan_id = v_intent.pending_plan_id,
    status = 'active',
    provider = 'asaas',
    provider_customer_id = coalesce(
      provider_customer_id,
      v_intent.provider_customer_id
    ),
    provider_subscription_id = coalesce(
      provider_subscription_id,
      v_intent.provider_subscription_id,
      v_subscription_id
    ),
    updated_at = now()
  where organization_id = v_intent.organization_id;

  insert into public.subscription_logs (
    organization_id,
    event_type,
    status,
    metadata
  )
  values (
    v_intent.organization_id,
    'billing_intent_confirmed',
    'active',
    jsonb_build_object(
      'intent_id', v_intent.id,
      'plan_id', v_intent.pending_plan_id,
      'amount', v_intent.amount,
      'billing_cycle', v_intent.billing_cycle,
      'billing_method', v_intent.billing_method,
      'provider_payment_id', coalesce(v_intent.provider_payment_id, v_payment_id),
      'provider_subscription_id', coalesce(
        v_intent.provider_subscription_id,
        v_subscription_id
      )
    )
  );

  return jsonb_build_object(
    'outcome', 'confirmed',
    'intent_id', v_intent.id,
    'organization_id', v_intent.organization_id,
    'plan_id', v_intent.pending_plan_id
  );
end;
$$;

revoke all on function private.confirm_billing_checkout_intent(
  text,
  text,
  text,
  numeric
) from public, anon, authenticated, service_role;

create or replace function private.confirm_billing_checkout_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(btrim(coalesce(new.status, ''))) in (
    'CANCELED',
    'CANCELLED',
    'DELETED'
  ) then
    update private.billing_checkout_intents
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, now()),
      last_error = lower(btrim(new.status)),
      updated_at = now()
    where billing_method = 'PIX'
      and status in ('creating', 'pending')
      and (
        id = new.billing_intent_id
        or provider_payment_id = new.asaas_payment_id
      );
  elsif upper(btrim(coalesce(new.status, ''))) = 'OVERDUE' then
    update private.billing_checkout_intents
    set
      last_error = 'overdue',
      updated_at = now()
    where billing_method = 'PIX'
      and status in ('creating', 'pending')
      and (
        id = new.billing_intent_id
        or provider_payment_id = new.asaas_payment_id
      );
  end if;

  if upper(btrim(coalesce(new.status, ''))) in (
    'CREDIT_CARD_CAPTURE_REFUSED',
    'OVERDUE',
    'CANCELED',
    'CANCELLED',
    'DELETED'
  ) then
    update private.billing_checkout_intents
    set
      last_error = lower(btrim(new.status)),
      updated_at = now()
    where billing_method = 'CREDIT_CARD'
      and status in ('creating', 'pending')
      and (
        id = new.billing_intent_id
        or (
          new.asaas_subscription_id is not null
          and provider_subscription_id = new.asaas_subscription_id
        )
      );
  end if;

  perform private.confirm_billing_checkout_intent(
    new.asaas_payment_id,
    new.asaas_subscription_id,
    new.status,
    new.value
  );
  return null;
end;
$$;

revoke all on function private.confirm_billing_checkout_from_payment()
  from public, anon, authenticated, service_role;

drop trigger if exists asaas_payments_confirm_billing_checkout
  on public.asaas_payments;

create trigger asaas_payments_confirm_billing_checkout
after insert or update of
  status,
  value,
  asaas_customer_id,
  asaas_subscription_id,
  billing_intent_id
on public.asaas_payments
for each row
execute function private.confirm_billing_checkout_from_payment();

update public.organizations
set subscription_status = 'cancelled'
where subscription_status = 'canceled';

update public.subscriptions
set status = 'cancelled'
where status = 'canceled';

-- Signup historically stored trial organizations as type=paid/status=trial.
-- Normalize that contradictory state before the fail-closed API gate starts
-- evaluating access.
update public.organizations
set subscription_type = 'trial'
where subscription_status = 'trial'
  and subscription_type <> 'trial';

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;

alter table public.subscriptions
  add constraint subscriptions_status_check
  check (
    status = any (
      array[
        'trial'::text,
        'pending_payment'::text,
        'active'::text,
        'blocked'::text,
        'overdue'::text,
        'past_due'::text,
        'suspended'::text,
        'cancelled'::text
      ]
    )
  );

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_subscription_status_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_subscription_status_check
      check (
        subscription_status = any (
          array[
            'trial'::text,
            'pending_payment'::text,
            'active'::text,
            'blocked'::text,
            'overdue'::text,
            'past_due'::text,
            'suspended'::text,
            'cancelled'::text
          ]
        )
      );
  end if;
end
$$;

create table if not exists private.asaas_reconciliation_jobs (
  organization_id uuid primary key
    references public.organizations(id) on delete cascade,
  provider_subscription_id text not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'retry', 'dead')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 8 check (max_attempts between 1 and 30),
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  last_attempt_at timestamptz,
  last_succeeded_at timestamptz,
  last_error text,
  last_provider_status text,
  last_payment_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists asaas_reconciliation_jobs_claim_idx
  on private.asaas_reconciliation_jobs (next_attempt_at, organization_id)
  where status in ('pending', 'retry', 'processing');

alter table private.asaas_reconciliation_jobs enable row level security;
revoke all on table private.asaas_reconciliation_jobs
  from public, anon, authenticated, service_role;

create or replace function private.apply_organization_billing_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_grace_days integer := 3;
begin
  new.subscription_status := case
    when new.subscription_status = 'canceled' then 'cancelled'
    else new.subscription_status
  end;

  -- A staged plan is promoted only by the exact confirmed checkout intent.
  -- Provider webhooks that carry an unrelated/legacy charge may still update
  -- reconciliation metadata, but cannot unlock a different pending plan.
  if tg_op = 'UPDATE'
     and old.pending_plan_id is not null
     and new.subscription_status = 'active'
     and not exists (
       select 1
       from private.billing_checkout_intents intent
       where intent.organization_id = old.id
         and intent.pending_plan_id = old.pending_plan_id
         and intent.status = 'confirmed'
     ) then
    new.subscription_status := old.subscription_status;
    new.subscription_type := old.subscription_type;
    new.plan_id := old.plan_id;
    new.pending_plan_id := old.pending_plan_id;
    new.subscription_value := old.subscription_value;
    new.max_users := old.max_users;
    new.trial_ends_at := old.trial_ends_at;
  end if;

  -- A provider-backed transition leaves the trial/free contract and becomes
  -- paid. In particular, checkout can charge the currently selected trial
  -- plan without calling the plan-selection endpoint first.
  if new.pending_plan_id is null
     and new.subscription_status <> 'trial'
     and (
       nullif(btrim(new.asaas_customer_id), '') is not null
       or nullif(btrim(new.asaas_subscription_id), '') is not null
     ) then
    new.subscription_type := 'paid';
  end if;

  if tg_op = 'INSERT'
     or new.subscription_status is distinct from old.subscription_status then
    new.billing_status_changed_at := now();

    select coalesce(p.payment_grace_days, 3)
    into v_grace_days
    from public.admin_subscription_plans p
    where p.id = new.plan_id;

    v_grace_days := coalesce(v_grace_days, 3);

    case new.subscription_status
      when 'active' then
        new.billing_delinquent_at := null;
        new.billing_grace_until := null;
        new.billing_blocked_at := null;
      when 'trial' then
        new.billing_delinquent_at := null;
        new.billing_grace_until := null;
        new.billing_blocked_at := case
          when new.trial_ends_at is null or new.trial_ends_at <= now()
            then coalesce(new.billing_blocked_at, now())
          else null
        end;
      when 'overdue' then
        new.billing_delinquent_at := case
          when tg_op = 'UPDATE'
               and old.subscription_status in ('overdue', 'past_due')
            then coalesce(old.billing_delinquent_at, now())
          else now()
        end;
        new.billing_grace_until := case
          when tg_op = 'UPDATE'
               and old.subscription_status in ('overdue', 'past_due')
            then coalesce(
              old.billing_grace_until,
              coalesce(old.billing_delinquent_at, now())
                + make_interval(days => v_grace_days)
            )
          else now() + make_interval(days => v_grace_days)
        end;
        new.billing_blocked_at := case
          when new.billing_grace_until <= now()
            then coalesce(new.billing_blocked_at, now())
          else null
        end;
      when 'past_due' then
        new.billing_delinquent_at := case
          when tg_op = 'UPDATE'
               and old.subscription_status in ('overdue', 'past_due')
            then coalesce(old.billing_delinquent_at, now())
          else now()
        end;
        new.billing_grace_until := case
          when tg_op = 'UPDATE'
               and old.subscription_status in ('overdue', 'past_due')
            then coalesce(
              old.billing_grace_until,
              coalesce(old.billing_delinquent_at, now())
                + make_interval(days => v_grace_days)
            )
          else now() + make_interval(days => v_grace_days)
        end;
        new.billing_blocked_at := case
          when new.billing_grace_until <= now()
            then coalesce(new.billing_blocked_at, now())
          else null
        end;
      when 'pending_payment' then
        new.billing_delinquent_at := coalesce(new.billing_delinquent_at, now());
        new.billing_grace_until := null;
        new.billing_blocked_at := coalesce(new.billing_blocked_at, now());
      when 'blocked' then
        new.billing_delinquent_at := coalesce(new.billing_delinquent_at, now());
        new.billing_grace_until := null;
        new.billing_blocked_at := coalesce(new.billing_blocked_at, now());
      when 'suspended' then
        new.billing_grace_until := null;
        new.billing_blocked_at := coalesce(new.billing_blocked_at, now());
      when 'cancelled' then
        new.billing_grace_until := null;
        new.billing_blocked_at := coalesce(new.billing_blocked_at, now());
      else
        raise exception 'unsupported billing status: %', new.subscription_status
          using errcode = '22023';
    end case;
  elsif new.subscription_status in ('overdue', 'past_due')
        and new.billing_grace_until is not null
        and new.billing_grace_until <= now() then
    new.billing_blocked_at := coalesce(new.billing_blocked_at, now());
  end if;

  return new;
end;
$$;

revoke all on function private.apply_organization_billing_transition()
  from public, anon, authenticated, service_role;

drop trigger if exists organizations_apply_billing_transition
  on public.organizations;

create trigger organizations_apply_billing_transition
before insert or update of
  subscription_status,
  plan_id,
  pending_plan_id,
  trial_ends_at,
  billing_grace_until
on public.organizations
for each row
execute function private.apply_organization_billing_transition();

create or replace function private.sync_organization_plan_modules(
  p_organization_id uuid,
  p_plan_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_modules text[];
begin
  if p_organization_id is null or p_plan_id is null then
    return;
  end if;

  select array_agg(distinct lower(btrim(module_name)))
  into v_modules
  from public.admin_subscription_plans plan
  cross join lateral unnest(plan.modules) as module_name
  where plan.id = p_plan_id
    and nullif(btrim(module_name), '') is not null;

  if coalesce(cardinality(v_modules), 0) = 0 then
    v_modules := array['crm', 'agenda', 'whatsapp', 'campaigns']::text[];
  end if;

  insert into public.organization_modules (
    organization_id,
    module_name,
    is_enabled,
    updated_at
  )
  select
    p_organization_id,
    candidate.module_name,
    candidate.module_name = any(v_modules),
    now()
  from (
    select unnest(
      array[
        'crm',
        'properties',
        'financial',
        'whatsapp',
        'agenda',
        'cadences',
        'tags',
        'round_robin',
        'reports',
        'automations',
        'webhooks',
        'site',
        'campaigns',
        'api',
        'portals',
        'performance'
      ]::text[]
    ) as module_name
    union
    select unnest(v_modules)
  ) as candidate
  on conflict (organization_id, module_name) do update
  set
    is_enabled = excluded.is_enabled,
    updated_at = excluded.updated_at;
end;
$$;

revoke all on function private.sync_organization_plan_modules(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function private.sync_organization_billing_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.subscription_status = 'active' and new.plan_id is not null then
    if tg_op = 'INSERT' then
      perform private.sync_organization_plan_modules(new.id, new.plan_id);
    elsif old.subscription_status is distinct from new.subscription_status
          or old.plan_id is distinct from new.plan_id then
      perform private.sync_organization_plan_modules(new.id, new.plan_id);
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.subscription_status is distinct from old.subscription_status then
    update public.subscriptions
    set
      status = new.subscription_status,
      plan_id = coalesce(new.plan_id, plan_id),
      provider_customer_id = coalesce(new.asaas_customer_id, provider_customer_id),
      provider_subscription_id = coalesce(
        new.asaas_subscription_id,
        provider_subscription_id
      ),
      trial_ends_at = coalesce(new.trial_ends_at, trial_ends_at),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'billing_status_changed_at',
          new.billing_status_changed_at,
          'billing_grace_until',
          new.billing_grace_until,
          'billing_blocked_at',
          new.billing_blocked_at
        )
    where organization_id = new.id;

    insert into public.subscription_logs (
      organization_id,
      event_type,
      status,
      metadata
    )
    values (
      new.id,
      'billing_status_changed',
      new.subscription_status,
      jsonb_build_object(
        'previous_status',
        case when tg_op = 'UPDATE' then old.subscription_status else null end,
        'billing_status_changed_at',
        new.billing_status_changed_at,
        'billing_grace_until',
        new.billing_grace_until,
        'billing_blocked_at',
        new.billing_blocked_at
      )
    );
  end if;

  if nullif(btrim(new.asaas_subscription_id), '') is not null
     and new.subscription_status <> 'cancelled' then
    insert into private.asaas_reconciliation_jobs (
      organization_id,
      provider_subscription_id,
      status,
      next_attempt_at
    )
    values (
      new.id,
      btrim(new.asaas_subscription_id),
      'pending',
      now()
    )
    on conflict (organization_id) do update
    set
      provider_subscription_id = excluded.provider_subscription_id,
      status = case
        when private.asaas_reconciliation_jobs.provider_subscription_id
             is distinct from excluded.provider_subscription_id
          then 'pending'
        else private.asaas_reconciliation_jobs.status
      end,
      attempts = case
        when private.asaas_reconciliation_jobs.provider_subscription_id
             is distinct from excluded.provider_subscription_id
          then 0
        else private.asaas_reconciliation_jobs.attempts
      end,
      next_attempt_at = least(
        private.asaas_reconciliation_jobs.next_attempt_at,
        excluded.next_attempt_at
      ),
      locked_at = case
        when private.asaas_reconciliation_jobs.provider_subscription_id
             is distinct from excluded.provider_subscription_id
          then null
        else private.asaas_reconciliation_jobs.locked_at
      end,
      locked_by = case
        when private.asaas_reconciliation_jobs.provider_subscription_id
             is distinct from excluded.provider_subscription_id
          then null
        else private.asaas_reconciliation_jobs.locked_by
      end,
      last_error = case
        when private.asaas_reconciliation_jobs.provider_subscription_id
             is distinct from excluded.provider_subscription_id
          then null
        else private.asaas_reconciliation_jobs.last_error
      end,
      updated_at = now();
  elsif new.subscription_status = 'cancelled' then
    delete from private.asaas_reconciliation_jobs
    where organization_id = new.id;
  end if;

  return null;
end;
$$;

revoke all on function private.sync_organization_billing_state()
  from public, anon, authenticated, service_role;

drop trigger if exists organizations_sync_billing_state
  on public.organizations;

create trigger organizations_sync_billing_state
after insert or update of
  subscription_status,
  plan_id,
  trial_ends_at,
  asaas_customer_id,
  asaas_subscription_id,
  billing_grace_until,
  billing_blocked_at
on public.organizations
for each row
execute function private.sync_organization_billing_state();

create or replace function private.apply_asaas_billing_snapshot(
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_subscription_status text,
  p_latest_payment_status text,
  p_next_billing_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.organizations%rowtype;
  v_provider_status text := upper(btrim(coalesce(p_provider_subscription_status, '')));
  v_payment_status text := upper(btrim(coalesce(p_latest_payment_status, '')));
  v_new_status text;
  v_observed_at timestamptz := least(coalesce(p_observed_at, now()), now());
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'reconciliation'), 80);
begin
  select *
  into v_org
  from public.organizations
  where id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  if nullif(btrim(v_org.asaas_customer_id), '') is not null
     and nullif(btrim(p_provider_customer_id), '') is not null
     and btrim(v_org.asaas_customer_id) <> btrim(p_provider_customer_id) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;

  if nullif(btrim(v_org.asaas_subscription_id), '') is not null
     and nullif(btrim(p_provider_subscription_id), '') is not null
     and btrim(v_org.asaas_subscription_id) <> btrim(p_provider_subscription_id) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription'
    );
  end if;

  if v_org.billing_last_reconciled_at is not null
     and v_org.billing_last_reconciled_at > v_observed_at then
    return jsonb_build_object(
      'outcome', 'stale',
      'status', v_org.subscription_status
    );
  end if;

  v_new_status := v_org.subscription_status;

  if v_provider_status in (
    'INACTIVE',
    'CANCELLED',
    'CANCELED',
    'DELETED',
    'EXPIRED'
  ) then
    v_new_status := 'cancelled';
  elsif v_org.subscription_status in ('cancelled', 'suspended') then
    -- A stale paid invoice must never resurrect a terminal account. Starting a
    -- new subscription first moves the organization to pending_payment.
    v_new_status := v_org.subscription_status;
  elsif v_payment_status in (
    'OVERDUE',
    'DUNNING_REQUESTED',
    'DUNNING_RECEIVED',
    'CREDIT_CARD_CAPTURE_REFUSED'
  ) then
    v_new_status := 'overdue';
  elsif v_payment_status in (
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH'
  ) then
    v_new_status := 'active';
  elsif v_payment_status in (
    'REFUNDED',
    'REFUND_REQUESTED',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  ) then
    v_new_status := 'overdue';
  elsif v_provider_status = 'ACTIVE' then
    v_new_status := case
      when v_org.subscription_status = 'active' then 'active'
      else 'pending_payment'
    end;
  elsif v_payment_status in ('PENDING', 'AWAITING_RISK_ANALYSIS') then
    v_new_status := case
      when v_org.subscription_status = 'active' then 'active'
      else 'pending_payment'
    end;
  end if;

  update public.organizations
  set
    subscription_status = v_new_status,
    asaas_customer_id = coalesce(
      nullif(btrim(p_provider_customer_id), ''),
      asaas_customer_id
    ),
    asaas_subscription_id = coalesce(
      nullif(btrim(p_provider_subscription_id), ''),
      asaas_subscription_id
    ),
    next_billing_date = coalesce(p_next_billing_date, next_billing_date),
    billing_last_reconciled_at = v_observed_at,
    updated_at = now()
  where id = p_organization_id;

  update private.asaas_reconciliation_jobs
  set
    status = 'pending',
    attempts = 0,
    next_attempt_at = now() + interval '5 minutes',
    locked_at = null,
    locked_by = null,
    last_succeeded_at = now(),
    last_error = null,
    last_provider_status = nullif(v_provider_status, ''),
    last_payment_status = nullif(v_payment_status, ''),
    updated_at = now()
  where organization_id = p_organization_id;

  insert into public.subscription_logs (
    organization_id,
    event_type,
    status,
    metadata
  )
  values (
    p_organization_id,
    'asaas_reconciled',
    v_new_status,
    jsonb_build_object(
      'source', v_source,
      'provider_subscription_status', nullif(v_provider_status, ''),
      'latest_payment_status', nullif(v_payment_status, ''),
      'observed_at', v_observed_at
    )
  );

  return jsonb_build_object(
    'outcome', 'applied',
    'previous_status', v_org.subscription_status,
    'status', v_new_status,
    'observed_at', v_observed_at
  );
end;
$$;

revoke all on function private.apply_asaas_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  date,
  timestamptz,
  text
) from public, anon, authenticated, service_role;

create or replace function private.apply_asaas_billing_snapshot_with_payment(
  p_organization_id uuid,
  p_provider_customer_id text,
  p_provider_subscription_id text,
  p_provider_subscription_status text,
  p_latest_payment_id text,
  p_latest_payment_status text,
  p_latest_payment_amount numeric,
  p_next_billing_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if upper(btrim(coalesce(p_latest_payment_status, ''))) in (
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH'
  ) then
    perform private.confirm_billing_checkout_intent(
      p_latest_payment_id,
      p_provider_subscription_id,
      p_latest_payment_status,
      p_latest_payment_amount
    );
  end if;

  return private.apply_asaas_billing_snapshot(
    p_organization_id,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_provider_subscription_status,
    p_latest_payment_status,
    p_next_billing_date,
    p_observed_at,
    p_source
  );
end;
$$;

revoke all on function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  timestamptz,
  text
) from public, anon, authenticated, service_role;

create or replace function public.reconcile_asaas_billing_snapshot(
  p_organization_id uuid,
  p_provider_customer_id text default null,
  p_provider_subscription_id text default null,
  p_provider_subscription_status text default null,
  p_latest_payment_status text default null,
  p_next_billing_date date default null,
  p_observed_at timestamptz default now(),
  p_source text default 'edge_poll'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  return private.apply_asaas_billing_snapshot(
    p_organization_id,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_provider_subscription_status,
    p_latest_payment_status,
    p_next_billing_date,
    p_observed_at,
    p_source
  );
end;
$$;

revoke all on function public.reconcile_asaas_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  date,
  timestamptz,
  text
) from public, anon, authenticated;

grant execute on function public.reconcile_asaas_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  date,
  timestamptz,
  text
) to service_role;

update public.organizations
set
  billing_status_changed_at = coalesce(
    billing_status_changed_at,
    updated_at,
    created_at,
    now()
  ),
  billing_delinquent_at = case
    when subscription_status in ('overdue', 'past_due')
      then coalesce(billing_delinquent_at, updated_at, now())
    when subscription_status in ('pending_payment', 'blocked')
      then coalesce(billing_delinquent_at, updated_at, now())
    else billing_delinquent_at
  end,
  billing_grace_until = case
    when subscription_status in ('overdue', 'past_due')
      then coalesce(
        billing_grace_until,
        coalesce(billing_delinquent_at, updated_at, now())
          + make_interval(
            days => coalesce(
              (
                select p.payment_grace_days
                from public.admin_subscription_plans p
                where p.id = organizations.plan_id
              ),
              3
            )
          )
      )
    else billing_grace_until
  end,
  billing_blocked_at = case
    when subscription_status in (
      'pending_payment',
      'blocked',
      'suspended',
      'cancelled'
    ) then coalesce(billing_blocked_at, updated_at, now())
    when subscription_status = 'trial'
         and (trial_ends_at is null or trial_ends_at <= now())
      then coalesce(billing_blocked_at, trial_ends_at, updated_at, now())
    else billing_blocked_at
  end;

insert into private.asaas_reconciliation_jobs (
  organization_id,
  provider_subscription_id,
  status,
  next_attempt_at
)
select
  id,
  btrim(asaas_subscription_id),
  'pending',
  now()
from public.organizations
where nullif(btrim(asaas_subscription_id), '') is not null
  and subscription_status <> 'cancelled'
on conflict (organization_id) do update
set
  provider_subscription_id = excluded.provider_subscription_id,
  updated_at = now();

do $$
declare
  organization_record record;
begin
  for organization_record in
    select id, plan_id
    from public.organizations
    where subscription_status = 'active'
      and plan_id is not null
  loop
    perform private.sync_organization_plan_modules(
      organization_record.id,
      organization_record.plan_id
    );
  end loop;
end
$$;

comment on column public.admin_subscription_plans.payment_grace_days is
  'Dias de carencia apos inadimplencia antes do bloqueio operacional.';

comment on column public.organizations.billing_grace_until is
  'Instante imutavel da carencia atual; repeticoes de webhook nao prorrogam o prazo.';

comment on table private.asaas_reconciliation_jobs is
  'Fila backend-only para reconciliar periodicamente o estado canonico de cobranca com a Asaas.';
