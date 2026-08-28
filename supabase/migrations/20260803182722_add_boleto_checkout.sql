-- Boleto uses the same server-authoritative checkout intent as Pix. The
-- selected 1/6/12-month term is paid upfront; only credit card creates an
-- automatic provider subscription.
alter table private.billing_checkout_intents
  drop constraint if exists billing_checkout_intents_billing_method_check;

alter table private.billing_checkout_intents
  add constraint billing_checkout_intents_billing_method_check
    check (billing_method in ('PIX', 'BOLETO', 'CREDIT_CARD'));

create or replace function public.reserve_billing_checkout_intent(
  p_organization_id uuid,
  p_billing_method text,
  p_billing_period_months integer,
  p_expected_plan_id uuid,
  p_expected_monthly_price numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method text := upper(btrim(coalesce(p_billing_method, '')));
  v_period integer := coalesce(p_billing_period_months, 1);
  v_org public.organizations%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_target_plan_id uuid;
  v_cycle text;
  v_amount numeric(10, 2);
  v_intent private.billing_checkout_intents%rowtype;
  v_intent_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_organization_id is null
     or v_method not in ('PIX', 'BOLETO', 'CREDIT_CARD')
     or v_period not in (1, 6, 12) then
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

  if not found
     or coalesce(v_plan.price, 0) <= 0
     or not (v_period = any(coalesce(v_plan.billing_periods, array[1]))) then
    return jsonb_build_object('outcome', 'invalid_plan');
  end if;

  if (p_expected_plan_id is not null and p_expected_plan_id <> v_plan.id)
     or (
       p_expected_monthly_price is not null
       and abs(p_expected_monthly_price - v_plan.price) > 0.01
     ) then
    return jsonb_build_object(
      'outcome', 'quote_changed',
      'plan_id', v_plan.id,
      'monthly_price', v_plan.price
    );
  end if;

  v_cycle := case v_period
    when 6 then 'semiannual'
    when 12 then 'yearly'
    else 'monthly'
  end;
  v_amount := round(v_plan.price * v_period, 2);

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
       or v_intent.amount is distinct from v_amount
       or v_intent.billing_cycle is distinct from v_cycle
       or v_intent.billing_period_months is distinct from v_period
       or v_intent.billing_method is distinct from v_method then
      return jsonb_build_object(
        'outcome', 'active_intent_conflict',
        'intent_id', v_intent.id,
        'plan_id', v_intent.pending_plan_id,
        'amount', v_intent.amount,
        'billing_cycle', v_intent.billing_cycle,
        'billing_period_months', v_intent.billing_period_months,
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
      'billing_period_months', v_intent.billing_period_months,
      'billing_method', v_intent.billing_method,
      'status', v_intent.status,
      'provider_customer_id', v_intent.provider_customer_id,
      'provider_checkout_id', v_intent.provider_checkout_id,
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
    billing_period_months,
    billing_method,
    status,
    external_reference,
    provider_request_started_at
  )
  values (
    v_intent_id,
    p_organization_id,
    v_target_plan_id,
    v_amount,
    v_cycle,
    v_period,
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
    'amount', v_amount,
    'billing_cycle', v_cycle,
    'billing_period_months', v_period,
    'billing_method', v_method,
    'status', 'creating'
  );
end;
$$;

revoke all on function public.reserve_billing_checkout_intent(
  uuid,
  text,
  integer,
  uuid,
  numeric
) from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout_intent(
  uuid,
  text,
  integer,
  uuid,
  numeric
) to service_role;

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

  if (v_intent.billing_method in ('PIX', 'BOLETO') and v_payment_id is null)
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

  if v_intent.billing_method in ('PIX', 'BOLETO')
     and v_intent.provider_payment_id is not null
     and v_intent.provider_payment_id <> v_payment_id then
    raise exception 'payment does not match one-off billing intent'
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
    and billing_method in ('PIX', 'BOLETO')
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
    where billing_method in ('PIX', 'BOLETO')
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
    where billing_method in ('PIX', 'BOLETO')
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
