alter table public.asaas_payments
  add column if not exists last_webhook_event_id text,
  add column if not exists last_webhook_event_at timestamptz;

alter table public.organizations
  add column if not exists asaas_last_event_id text,
  add column if not exists asaas_last_event_at timestamptz;

create table if not exists private.asaas_webhook_events (
  event_id text primary key,
  event_type text not null,
  resource_type text not null,
  resource_id text not null,
  organization_id uuid references public.organizations(id) on delete cascade,
  provider_event_at timestamptz not null,
  outcome text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz not null default now(),
  constraint asaas_webhook_events_event_id_check
    check (char_length(btrim(event_id)) between 1 and 512),
  constraint asaas_webhook_events_event_type_check
    check (left(event_type, 8) = 'PAYMENT_' or left(event_type, 13) = 'SUBSCRIPTION_'),
  constraint asaas_webhook_events_resource_type_check
    check (resource_type in ('payment', 'subscription')),
  constraint asaas_webhook_events_resource_id_check
    check (char_length(btrim(resource_id)) between 1 and 255),
  constraint asaas_webhook_events_outcome_check
    check (outcome in ('processed', 'stale', 'unmatched')),
  constraint asaas_webhook_events_payload_check
    check (jsonb_typeof(payload) = 'object')
);

create index if not exists asaas_webhook_events_organization_received_idx
  on private.asaas_webhook_events (organization_id, received_at desc);

create index if not exists asaas_webhook_events_resource_received_idx
  on private.asaas_webhook_events (resource_type, resource_id, received_at desc);

alter table private.asaas_webhook_events enable row level security;

revoke all on table private.asaas_webhook_events from public, anon, authenticated, service_role;

create or replace function public.register_pending_asaas_subscription(
  p_organization_id uuid,
  p_customer_id text,
  p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_customer_id text := nullif(btrim(coalesce(p_customer_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_updated integer := 0;
begin
  if p_organization_id is null or v_customer_id is null or v_subscription_id is null then
    raise exception using
      errcode = '22023',
      message = 'Organization, Asaas customer and subscription are required';
  end if;

  update public.organizations
  set
    subscription_status = case
      when asaas_customer_id = v_customer_id
        and asaas_subscription_id = v_subscription_id
        and asaas_last_event_id is not null
        then subscription_status
      else 'pending_payment'
    end,
    asaas_customer_id = v_customer_id,
    asaas_subscription_id = v_subscription_id,
    updated_at = now()
  where id = p_organization_id;

  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception using
      errcode = 'P0002',
      message = 'Organization not found for Asaas subscription';
  end if;

  update public.subscriptions
  set
    status = case
      when provider_customer_id = v_customer_id
        and provider_subscription_id = v_subscription_id
        and coalesce(metadata, '{}'::jsonb) ? 'asaas_last_event_id'
        then status
      else 'pending_payment'
    end,
    provider = 'asaas',
    provider_customer_id = v_customer_id,
    provider_subscription_id = v_subscription_id,
    updated_at = now()
  where organization_id = p_organization_id;

  return jsonb_build_object(
    'outcome', 'registered',
    'organization_id', p_organization_id,
    'customer_id', v_customer_id,
    'subscription_id', v_subscription_id
  );
end;
$function$;

revoke all on function public.register_pending_asaas_subscription(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.register_pending_asaas_subscription(uuid, text, text)
  to service_role;

create or replace function public.reconcile_asaas_payment_webhook(
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
as $function$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_event_type text := upper(btrim(coalesce(p_event_type, '')));
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_payment_id text := btrim(coalesce(p_payment ->> 'id', ''));
  v_customer_id text := nullif(btrim(coalesce(p_payment ->> 'customer', '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '');
  v_external_reference text := nullif(btrim(coalesce(p_payment ->> 'externalReference', '')), '');
  v_payment_status text := upper(nullif(btrim(coalesce(p_payment ->> 'status', '')), ''));
  v_billing_type text := upper(nullif(btrim(coalesce(p_payment ->> 'billingType', '')), ''));
  v_due_date date;
  v_payment_date date;
  v_value numeric;
  v_net_value numeric;
  v_invoice_url text := nullif(btrim(coalesce(p_payment ->> 'invoiceUrl', '')), '');
  v_organization_id uuid;
  v_existing_organization_id uuid;
  v_existing_customer_id text;
  v_existing_subscription_id text;
  v_existing_event_at timestamptz;
  v_current_organization_status text;
  v_current_org_customer_id text;
  v_current_org_subscription_id text;
  v_new_organization_status text;
  v_org_event_is_stale boolean := false;
  v_payment_event_is_stale boolean := false;
  v_should_advance_org_event boolean := false;
  v_inserted integer := 0;
begin
  if char_length(v_event_id) not between 1 and 512 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook event id';
  end if;

  if left(v_event_type, 8) <> 'PAYMENT_' then
    raise exception using
      errcode = '22023',
      message = 'Unsupported Asaas webhook event type';
  end if;

  if jsonb_typeof(p_payment) is distinct from 'object' or char_length(v_payment_id) not between 1 and 255 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook payment payload';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook payload';
  end if;

  if coalesce(p_payment ->> 'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_due_date := (p_payment ->> 'dueDate')::date;
  end if;

  if coalesce(p_payment ->> 'paymentDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_payment_date := (p_payment ->> 'paymentDate')::date;
  end if;

  if jsonb_typeof(p_payment -> 'value') = 'number' then
    v_value := (p_payment ->> 'value')::numeric;
  end if;

  if jsonb_typeof(p_payment -> 'netValue') = 'number' then
    v_net_value := (p_payment ->> 'netValue')::numeric;
  end if;

  select
    organization_id,
    asaas_customer_id,
    asaas_subscription_id,
    last_webhook_event_at
  into
    v_existing_organization_id,
    v_existing_customer_id,
    v_existing_subscription_id,
    v_existing_event_at
  from public.asaas_payments
  where asaas_payment_id = v_payment_id
  for update;

  if found then
    if v_customer_id is not null
      and v_existing_customer_id is not null
      and v_customer_id <> v_existing_customer_id
    then
      raise exception using
        errcode = '22023',
        message = 'Asaas customer does not match the existing payment';
    end if;

    if v_subscription_id is not null
      and v_existing_subscription_id is not null
      and v_subscription_id <> v_existing_subscription_id
    then
      raise exception using
        errcode = '22023',
        message = 'Asaas subscription does not match the existing payment';
    end if;

    v_organization_id := v_existing_organization_id;
  end if;

  if v_organization_id is null
    and v_external_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then
    select id
    into v_organization_id
    from public.organizations
    where id = v_external_reference::uuid
      and (asaas_customer_id is null or v_customer_id is null or asaas_customer_id = v_customer_id)
      and (asaas_subscription_id is null or v_subscription_id is null or asaas_subscription_id = v_subscription_id);
  end if;

  if v_organization_id is null and v_subscription_id is not null then
    select case when count(*) = 1 then min(id::text)::uuid end
    into v_organization_id
    from public.organizations
    where asaas_subscription_id = v_subscription_id;
  end if;

  if v_organization_id is null and v_subscription_id is null and v_customer_id is not null then
    select case when count(*) = 1 then min(id::text)::uuid end
    into v_organization_id
    from public.organizations
    where asaas_customer_id = v_customer_id;
  end if;

  if v_organization_id is null then
    insert into private.asaas_webhook_events (
      event_id,
      event_type,
      resource_type,
      resource_id,
      organization_id,
      provider_event_at,
      outcome,
      payload
    )
    values (
      v_event_id,
      v_event_type,
      'payment',
      v_payment_id,
      null,
      v_event_at,
      'unmatched',
      p_payload
    )
    on conflict (event_id) do nothing;

    get diagnostics v_inserted = row_count;

    return jsonb_build_object(
      'outcome', case when v_inserted = 0 then 'duplicate' else 'unmatched' end,
      'event_id', v_event_id,
      'payment_id', v_payment_id
    );
  end if;

  insert into private.asaas_webhook_events (
    event_id,
    event_type,
    resource_type,
    resource_id,
    organization_id,
    provider_event_at,
    outcome,
    payload
  )
  values (
    v_event_id,
    v_event_type,
    'payment',
    v_payment_id,
    v_organization_id,
    v_event_at,
    'processed',
    p_payload
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'event_id', v_event_id,
      'payment_id', v_payment_id,
      'organization_id', v_organization_id
    );
  end if;

  v_payment_event_is_stale :=
    v_existing_event_at is not null
    and v_event_at < v_existing_event_at;

  if v_event_type = 'PAYMENT_CONFIRMED' then
    v_payment_status := 'CONFIRMED';
  elsif v_event_type = 'PAYMENT_RECEIVED' then
    v_payment_status := 'RECEIVED';
  elsif v_event_type = 'PAYMENT_OVERDUE' then
    v_payment_status := 'OVERDUE';
  elsif v_event_type = 'PAYMENT_DELETED' then
    v_payment_status := 'DELETED';
  elsif v_event_type = 'PAYMENT_REFUNDED' then
    v_payment_status := 'REFUNDED';
  elsif v_event_type = 'PAYMENT_CHARGEBACK_REQUESTED' then
    v_payment_status := 'CHARGEBACK_REQUESTED';
  elsif v_event_type = 'PAYMENT_CHARGEBACK_DISPUTE' then
    v_payment_status := 'CHARGEBACK_DISPUTE';
  elsif v_event_type = 'PAYMENT_AWAITING_CHARGEBACK_REVERSAL' then
    v_payment_status := 'AWAITING_CHARGEBACK_REVERSAL';
  elsif v_event_type = 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED' then
    v_payment_status := 'CREDIT_CARD_CAPTURE_REFUSED';
  elsif v_payment_status is null then
    v_payment_status := replace(v_event_type, 'PAYMENT_', '');
  end if;

  if not v_payment_event_is_stale then
    insert into public.asaas_payments (
      organization_id,
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
      raw_event,
      last_webhook_event_id,
      last_webhook_event_at
    )
    values (
      v_organization_id,
      v_payment_id,
      v_customer_id,
      v_subscription_id,
      v_payment_status,
      v_billing_type,
      v_value,
      v_net_value,
      v_due_date,
      v_payment_date,
      v_invoice_url,
      p_payload,
      v_event_id,
      v_event_at
    )
    on conflict (asaas_payment_id) do update
    set
      asaas_customer_id = coalesce(excluded.asaas_customer_id, public.asaas_payments.asaas_customer_id),
      asaas_subscription_id = coalesce(excluded.asaas_subscription_id, public.asaas_payments.asaas_subscription_id),
      status = excluded.status,
      billing_type = coalesce(excluded.billing_type, public.asaas_payments.billing_type),
      value = coalesce(excluded.value, public.asaas_payments.value),
      net_value = coalesce(excluded.net_value, public.asaas_payments.net_value),
      due_date = coalesce(excluded.due_date, public.asaas_payments.due_date),
      payment_date = coalesce(excluded.payment_date, public.asaas_payments.payment_date),
      invoice_url = coalesce(excluded.invoice_url, public.asaas_payments.invoice_url),
      raw_event = excluded.raw_event,
      last_webhook_event_id = excluded.last_webhook_event_id,
      last_webhook_event_at = excluded.last_webhook_event_at,
      updated_at = now()
    where excluded.last_webhook_event_at >= coalesce(
      public.asaas_payments.last_webhook_event_at,
      '-infinity'::timestamptz
    );

    get diagnostics v_inserted = row_count;
    if v_inserted = 0 then
      v_payment_event_is_stale := true;
      update private.asaas_webhook_events
      set outcome = 'stale'
      where event_id = v_event_id;
    end if;
  else
    update private.asaas_webhook_events
    set outcome = 'stale'
    where event_id = v_event_id;
  end if;

  select
    subscription_status,
    asaas_customer_id,
    asaas_subscription_id,
    asaas_last_event_at > v_event_at
  into
    v_current_organization_status,
    v_current_org_customer_id,
    v_current_org_subscription_id,
    v_org_event_is_stale
  from public.organizations
  where id = v_organization_id
  for update;

  v_org_event_is_stale := coalesce(v_org_event_is_stale, false);
  if (
    v_subscription_id is not null
    and v_current_org_subscription_id is not null
    and v_subscription_id <> v_current_org_subscription_id
  ) or (
    v_customer_id is not null
    and v_current_org_customer_id is not null
    and v_customer_id <> v_current_org_customer_id
  ) then
    v_org_event_is_stale := true;
  end if;

  v_new_organization_status := v_current_organization_status;

  if v_org_event_is_stale then
    update private.asaas_webhook_events
    set outcome = 'stale'
    where event_id = v_event_id;
  end if;

  if not v_org_event_is_stale and not v_payment_event_is_stale then
    if v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
      v_new_organization_status := 'active';
    elsif v_payment_status in ('OVERDUE', 'CREDIT_CARD_CAPTURE_REFUSED') then
      v_new_organization_status := 'overdue';
    elsif v_payment_status in (
      'REFUNDED',
      'CHARGEBACK_REQUESTED',
      'CHARGEBACK_DISPUTE',
      'AWAITING_CHARGEBACK_REVERSAL'
    ) then
      v_new_organization_status := 'suspended';
    elsif v_payment_status in ('DELETED', 'CANCELED', 'CANCELLED') then
      if v_current_organization_status not in ('active', 'trial') then
        v_new_organization_status := 'pending_payment';
      end if;
    elsif v_current_organization_status not in ('active', 'trial') then
      v_new_organization_status := 'pending_payment';
    end if;
  end if;

  v_should_advance_org_event :=
    not v_org_event_is_stale
    and not v_payment_event_is_stale
    and (
      v_new_organization_status is distinct from v_current_organization_status
      or v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
    );

  update public.organizations
  set
    asaas_customer_id = case
      when not v_org_event_is_stale then coalesce(asaas_customer_id, v_customer_id)
      else asaas_customer_id
    end,
    asaas_subscription_id = case
      when not v_org_event_is_stale then coalesce(asaas_subscription_id, v_subscription_id)
      else asaas_subscription_id
    end,
    subscription_status = v_new_organization_status,
    next_billing_date = case
      when v_org_event_is_stale or v_payment_event_is_stale then next_billing_date
      else case
        when v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
          then (
            coalesce(v_due_date, current_date)
            + case
                when exists (
                  select 1
                  from public.organizations billing_org
                  join public.admin_subscription_plans billing_plan
                    on billing_plan.id = billing_org.plan_id
                  where billing_org.id = v_organization_id
                    and billing_plan.billing_cycle = 'yearly'
                ) then interval '1 year'
                else interval '1 month'
              end
          )::date
        when v_payment_status = 'OVERDUE'
          then coalesce(v_due_date, next_billing_date)
        when v_payment_status in ('CREATED', 'PENDING')
          and v_due_date is not null
          then v_due_date
        else next_billing_date
      end
    end,
    asaas_last_event_id = case
      when v_should_advance_org_event then v_event_id
      else asaas_last_event_id
    end,
    asaas_last_event_at = case
      when v_should_advance_org_event then v_event_at
      else asaas_last_event_at
    end,
    updated_at = now()
  where id = v_organization_id;

  update public.subscriptions
  set
    status = case
      when not v_org_event_is_stale and not v_payment_event_is_stale
        then v_new_organization_status
      else status
    end,
    provider = 'asaas',
    provider_customer_id = case
      when not v_org_event_is_stale
        then coalesce(provider_customer_id, v_customer_id)
      else provider_customer_id
    end,
    provider_subscription_id = case
      when not v_org_event_is_stale
        then coalesce(provider_subscription_id, v_subscription_id)
      else provider_subscription_id
    end,
    current_period_start = case
      when not v_org_event_is_stale
        and not v_payment_event_is_stale
        and v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
        then coalesce(v_payment_date::timestamptz, current_period_start, now())
      else current_period_start
    end,
    current_period_end = case
      when not v_org_event_is_stale
        and not v_payment_event_is_stale
        and v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
        then coalesce(v_due_date::timestamptz, now())
          + case
              when exists (
                select 1
                from public.organizations billing_org
                join public.admin_subscription_plans billing_plan
                  on billing_plan.id = billing_org.plan_id
                where billing_org.id = v_organization_id
                  and billing_plan.billing_cycle = 'yearly'
              ) then interval '1 year'
              else interval '1 month'
            end
      else current_period_end
    end,
    canceled_at = case
      when not v_org_event_is_stale
        and not v_payment_event_is_stale
        and v_new_organization_status in ('cancelled', 'canceled')
        then now()
      else canceled_at
    end,
    metadata = case
      when not v_org_event_is_stale and not v_payment_event_is_stale
        then coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'asaas_last_event_id', v_event_id,
          'asaas_last_event_type', v_event_type,
          'asaas_last_event_at', v_event_at
        )
      else metadata
    end,
    updated_at = now()
  where organization_id = v_organization_id
    and (
      v_subscription_id is null
      or provider_subscription_id is null
      or provider_subscription_id = v_subscription_id
    );

  return jsonb_build_object(
    'outcome', case
      when v_payment_event_is_stale or v_org_event_is_stale then 'stale'
      else 'processed'
    end,
    'event_id', v_event_id,
    'payment_id', v_payment_id,
    'payment_status', v_payment_status,
    'organization_id', v_organization_id,
    'subscription_status', v_new_organization_status
  );
end;
$function$;

revoke all on function public.reconcile_asaas_payment_webhook(text, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_asaas_payment_webhook(text, text, timestamptz, jsonb, jsonb)
  to service_role;

create or replace function public.reconcile_asaas_subscription_webhook(
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
as $function$
declare
  v_event_id text := btrim(coalesce(p_event_id, ''));
  v_event_type text := upper(btrim(coalesce(p_event_type, '')));
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_subscription_id text := btrim(coalesce(p_subscription ->> 'id', ''));
  v_customer_id text := nullif(btrim(coalesce(p_subscription ->> 'customer', '')), '');
  v_external_reference text := nullif(
    btrim(coalesce(p_subscription ->> 'externalReference', '')),
    ''
  );
  v_provider_status text := upper(
    nullif(btrim(coalesce(p_subscription ->> 'status', '')), '')
  );
  v_next_due_date date;
  v_external_organization_id uuid;
  v_exact_organization_id uuid;
  v_organization_id uuid;
  v_current_organization_status text;
  v_current_customer_id text;
  v_current_subscription_id text;
  v_current_event_at timestamptz;
  v_new_organization_status text;
  v_event_is_stale boolean := false;
  v_should_advance_org_event boolean := false;
  v_inserted integer := 0;
begin
  if char_length(v_event_id) not between 1 and 512 then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook event id';
  end if;

  if left(v_event_type, 13) <> 'SUBSCRIPTION_' then
    raise exception using
      errcode = '22023',
      message = 'Unsupported Asaas subscription webhook event type';
  end if;

  if jsonb_typeof(p_subscription) is distinct from 'object'
    or char_length(v_subscription_id) not between 1 and 255
    or char_length(coalesce(v_customer_id, '')) not between 1 and 255
  then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook subscription payload';
  end if;

  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception using
      errcode = '22023',
      message = 'Invalid Asaas webhook payload';
  end if;

  if coalesce(p_subscription ->> 'nextDueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_next_due_date := (p_subscription ->> 'nextDueDate')::date;
  end if;

  select case when count(*) = 1 then min(id::text)::uuid end
  into v_exact_organization_id
  from public.organizations
  where asaas_subscription_id = v_subscription_id
    and (asaas_customer_id is null or asaas_customer_id = v_customer_id);

  if v_external_reference ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    select id
    into v_external_organization_id
    from public.organizations
    where id = v_external_reference::uuid
      and (asaas_customer_id is null or asaas_customer_id = v_customer_id)
      and (asaas_subscription_id is null or asaas_subscription_id = v_subscription_id);
  end if;

  if v_exact_organization_id is not null
    and v_external_organization_id is not null
    and v_exact_organization_id <> v_external_organization_id
  then
    raise exception using
      errcode = '22023',
      message = 'Asaas subscription reference does not match the existing organization';
  end if;

  v_organization_id := coalesce(
    v_exact_organization_id,
    v_external_organization_id
  );

  if v_organization_id is null then
    select case when count(*) = 1 then min(id::text)::uuid end
    into v_organization_id
    from public.organizations
    where asaas_customer_id = v_customer_id
      and (asaas_subscription_id is null or asaas_subscription_id = v_subscription_id);
  end if;

  if v_organization_id is null then
    insert into private.asaas_webhook_events (
      event_id,
      event_type,
      resource_type,
      resource_id,
      organization_id,
      provider_event_at,
      outcome,
      payload
    )
    values (
      v_event_id,
      v_event_type,
      'subscription',
      v_subscription_id,
      null,
      v_event_at,
      'unmatched',
      p_payload
    )
    on conflict (event_id) do nothing;

    get diagnostics v_inserted = row_count;

    return jsonb_build_object(
      'outcome', case when v_inserted = 0 then 'duplicate' else 'unmatched' end,
      'event_id', v_event_id,
      'subscription_id', v_subscription_id
    );
  end if;

  insert into private.asaas_webhook_events (
    event_id,
    event_type,
    resource_type,
    resource_id,
    organization_id,
    provider_event_at,
    outcome,
    payload
  )
  values (
    v_event_id,
    v_event_type,
    'subscription',
    v_subscription_id,
    v_organization_id,
    v_event_at,
    'processed',
    p_payload
  )
  on conflict (event_id) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'event_id', v_event_id,
      'subscription_id', v_subscription_id,
      'organization_id', v_organization_id
    );
  end if;

  select
    subscription_status,
    asaas_customer_id,
    asaas_subscription_id,
    asaas_last_event_at
  into
    v_current_organization_status,
    v_current_customer_id,
    v_current_subscription_id,
    v_current_event_at
  from public.organizations
  where id = v_organization_id
  for update;

  if not found then
    update private.asaas_webhook_events
    set outcome = 'unmatched', organization_id = null
    where event_id = v_event_id;

    return jsonb_build_object(
      'outcome', 'unmatched',
      'event_id', v_event_id,
      'subscription_id', v_subscription_id
    );
  end if;

  v_event_is_stale :=
    (v_current_event_at is not null and v_event_at < v_current_event_at)
    or (
      v_current_customer_id is not null
      and v_current_customer_id <> v_customer_id
    )
    or (
      v_current_subscription_id is not null
      and v_current_subscription_id <> v_subscription_id
    );

  v_new_organization_status := v_current_organization_status;

  if not v_event_is_stale then
    if v_event_type in ('SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED') then
      v_new_organization_status := 'cancelled';
    elsif v_event_type = 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK' then
      v_new_organization_status := 'suspended';
    elsif v_event_type = 'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED'
      and v_current_organization_status = 'suspended'
    then
      v_new_organization_status := 'pending_payment';
    end if;
  end if;

  v_should_advance_org_event :=
    not v_event_is_stale
    and v_event_type in (
      'SUBSCRIPTION_INACTIVATED',
      'SUBSCRIPTION_DELETED',
      'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK',
      'SUBSCRIPTION_SPLIT_DIVERGENCE_BLOCK_FINISHED'
    );

  if v_event_is_stale then
    update private.asaas_webhook_events
    set outcome = 'stale'
    where event_id = v_event_id;
  end if;

  update public.organizations
  set
    asaas_customer_id = case
      when not v_event_is_stale then coalesce(asaas_customer_id, v_customer_id)
      else asaas_customer_id
    end,
    asaas_subscription_id = case
      when not v_event_is_stale then coalesce(asaas_subscription_id, v_subscription_id)
      else asaas_subscription_id
    end,
    subscription_status = v_new_organization_status,
    next_billing_date = case
      when not v_event_is_stale
        and v_next_due_date is not null
        and v_event_type in ('SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED')
        then v_next_due_date
      else next_billing_date
    end,
    asaas_last_event_id = case
      when v_should_advance_org_event then v_event_id
      else asaas_last_event_id
    end,
    asaas_last_event_at = case
      when v_should_advance_org_event then v_event_at
      else asaas_last_event_at
    end,
    updated_at = now()
  where id = v_organization_id;

  update public.subscriptions
  set
    status = case
      when not v_event_is_stale then v_new_organization_status
      else status
    end,
    provider = 'asaas',
    provider_customer_id = case
      when not v_event_is_stale
        then coalesce(provider_customer_id, v_customer_id)
      else provider_customer_id
    end,
    provider_subscription_id = case
      when not v_event_is_stale
        then coalesce(provider_subscription_id, v_subscription_id)
      else provider_subscription_id
    end,
    canceled_at = case
      when not v_event_is_stale and v_new_organization_status = 'cancelled'
        then coalesce(canceled_at, now())
      else canceled_at
    end,
    metadata = case
      when not v_event_is_stale
        then coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'asaas_last_event_id', v_event_id,
          'asaas_last_event_type', v_event_type,
          'asaas_last_event_at', v_event_at,
          'asaas_subscription_status', v_provider_status
        )
      else metadata
    end,
    updated_at = now()
  where organization_id = v_organization_id
    and (
      provider_subscription_id is null
      or provider_subscription_id = v_subscription_id
    );

  return jsonb_build_object(
    'outcome', case when v_event_is_stale then 'stale' else 'processed' end,
    'event_id', v_event_id,
    'subscription_id', v_subscription_id,
    'provider_status', v_provider_status,
    'organization_id', v_organization_id,
    'subscription_status', v_new_organization_status
  );
end;
$function$;

revoke all on function public.reconcile_asaas_subscription_webhook(text, text, timestamptz, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.reconcile_asaas_subscription_webhook(text, text, timestamptz, jsonb, jsonb)
  to service_role;

grant select, insert, update on table public.asaas_payments to service_role;
