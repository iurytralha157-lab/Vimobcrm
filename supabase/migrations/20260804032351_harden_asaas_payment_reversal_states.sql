-- Treat every irreversible or in-progress Asaas payment reversal as an
-- immediate access suspension. This is a forward-only repair: the public
-- wrappers keep their existing signatures and continue delegating to these
-- two reconciliation primitives.

alter table public.asaas_payments
  add column if not exists last_provider_observed_at timestamptz;

-- A confirmed checkout intent remains a useful subscription anchor, but its
-- amount belongs only to the original payment. Renewals reuse the provider
-- subscription with a new payment id and may legitimately have a new amount
-- after a managed plan change.
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
as $function$
declare
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_payment_status text := upper(btrim(coalesce(p_payment_status, '')));
  v_intent private.billing_checkout_intents%rowtype;
  v_org public.organizations%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_period_end timestamptz;
  v_payment_observed_at timestamptz;
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
    -- Validate the immutable original charge if it is replayed. A different
    -- payment on the same subscription is a renewal, not the old checkout.
    if p_paid_amount is not null
       and v_payment_id is not null
       and v_intent.provider_payment_id is not null
       and v_intent.provider_payment_id = v_payment_id
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

    return jsonb_build_object(
      'outcome', 'already_confirmed',
      'intent_id', v_intent.id,
      'billing_period_months', v_intent.billing_period_months
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

  -- A legitimate new checkout moves a terminal organization to
  -- pending_payment before confirmation. Any still-pending historical intent
  -- must be inert while access is suspended or cancelled; this also protects
  -- calls made indirectly by the asaas_payments confirmation trigger.
  if v_org.subscription_status in ('suspended', 'cancelled', 'canceled') then
    return jsonb_build_object(
      'outcome', 'terminal_state',
      'intent_id', v_intent.id,
      'status', v_org.subscription_status
    );
  end if;

  -- The row trigger runs before the outer webhook reconciler can classify an
  -- event as stale. Compare the provider observation already stored on the
  -- payment with both organization cursors before an old paid event is allowed
  -- to activate a checkout intent.
  select greatest(
    payment.last_webhook_event_at,
    payment.last_provider_observed_at
  )
  into v_payment_observed_at
  from public.asaas_payments payment
  where payment.asaas_payment_id = v_payment_id
    and payment.organization_id = v_intent.organization_id;

  if v_payment_observed_at is not null
     and greatest(
       v_org.asaas_last_event_at,
       v_org.billing_last_reconciled_at
     ) > v_payment_observed_at then
    return jsonb_build_object(
      'outcome', 'stale_observation',
      'intent_id', v_intent.id,
      'observed_at', v_payment_observed_at
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

  v_period_end := now() + make_interval(months => v_intent.billing_period_months);

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
    subscription_value = v_plan.price,
    subscription_billing_period_months = v_intent.billing_period_months,
    subscription_type = 'paid',
    subscription_status = 'active',
    trial_ends_at = null,
    next_billing_date = v_period_end::date,
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
    billing_period_months = v_intent.billing_period_months,
    current_period_start = now(),
    current_period_end = v_period_end,
    provider_customer_id = coalesce(
      provider_customer_id,
      v_intent.provider_customer_id
    ),
    provider_subscription_id = coalesce(
      provider_subscription_id,
      v_intent.provider_subscription_id,
      v_subscription_id
    ),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'billing_period_months', v_intent.billing_period_months,
      'billing_cycle', v_intent.billing_cycle,
      'charged_amount', v_intent.amount
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
      'monthly_value', v_plan.price,
      'amount', v_intent.amount,
      'billing_cycle', v_intent.billing_cycle,
      'billing_period_months', v_intent.billing_period_months,
      'period_end', v_period_end,
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
    'plan_id', v_intent.pending_plan_id,
    'billing_period_months', v_intent.billing_period_months,
    'period_end', v_period_end
  );
end;
$function$;

revoke all on function private.confirm_billing_checkout_intent(
  text,
  text,
  text,
  numeric
) from public, anon, authenticated, service_role;

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
    greatest(last_webhook_event_at, last_provider_observed_at)
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
  elsif v_event_type = 'PAYMENT_REFUND_REQUESTED' then
    v_payment_status := 'REFUND_REQUESTED';
  elsif v_event_type = 'PAYMENT_REFUND_IN_PROGRESS' then
    v_payment_status := 'REFUND_IN_PROGRESS';
  elsif v_event_type = 'PAYMENT_PARTIALLY_REFUNDED' then
    v_payment_status := 'PARTIALLY_REFUNDED';
  elsif v_event_type = 'PAYMENT_RECEIVED_IN_CASH_UNDONE' then
    v_payment_status := 'RECEIVED_IN_CASH_UNDONE';
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
      greatest(
        public.asaas_payments.last_webhook_event_at,
        public.asaas_payments.last_provider_observed_at
      ),
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
    greatest(
      asaas_last_event_at,
      billing_last_reconciled_at
    ) > v_event_at
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

  -- The outer period-intent wrapper only confirms checkout intents for a
  -- processed event. Treat a payment observed after explicit cancellation as
  -- non-applicable to the organization so an orphaned intent cannot revive it.
  if v_current_organization_status in (
    'suspended',
    'cancelled',
    'canceled'
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
    if v_current_organization_status in (
      'suspended',
      'cancelled',
      'canceled'
    ) then
      -- A new checkout first moves an eligible tenant to pending_payment.
      -- Provider payment events cannot revive a terminal tenant by themselves.
      v_new_organization_status := v_current_organization_status;
    elsif v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
      v_new_organization_status := 'active';
    elsif v_payment_status in ('OVERDUE', 'CREDIT_CARD_CAPTURE_REFUSED') then
      v_new_organization_status := 'overdue';
    elsif v_payment_status in (
      'REFUNDED',
      'REFUND_REQUESTED',
      'REFUND_IN_PROGRESS',
      'PARTIALLY_REFUNDED',
      'RECEIVED_IN_CASH_UNDONE',
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

revoke all on function public.reconcile_asaas_payment_webhook(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;

grant execute on function public.reconcile_asaas_payment_webhook(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

create or replace function private.apply_scheduled_billing_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_change private.billing_plan_changes%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
  v_organization_status text;
  v_organization_cursor timestamptz;
  v_payment_cursor timestamptz := greatest(
    new.last_webhook_event_at,
    new.last_provider_observed_at
  );
  v_period_end date;
begin
  if upper(btrim(coalesce(new.status, ''))) not in (
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH'
  )
     or new.value is null
     or new.due_date is null
     or nullif(btrim(coalesce(new.asaas_subscription_id, '')), '') is null then
    return new;
  end if;

  select plan_change.*
  into v_change
  from private.billing_plan_changes plan_change
  where plan_change.organization_id = new.organization_id
    and plan_change.provider_subscription_id = btrim(new.asaas_subscription_id)
    and plan_change.status in ('provider_updating', 'scheduled')
    and (
      (
        plan_change.status = 'scheduled'
        and plan_change.effective_on is not null
        and new.due_date >= plan_change.effective_on
      )
      or (
        plan_change.status = 'provider_updating'
        and new.due_date >= plan_change.provider_request_started_at::date
      )
    )
    and abs(new.value - plan_change.amount) <= 0.01
  order by plan_change.effective_on, plan_change.created_at, plan_change.id
  limit 1
  for update;

  if not found then
    return new;
  end if;

  -- Payment triggers run before the outer webhook can reject an old event.
  -- Lock and validate both terminal state and ordering here so a T0 payment
  -- cannot apply a scheduled plan after reconciliation already advanced the
  -- organization to T1. Equality is intentional for the current webhook/poll.
  select
    organization.subscription_status,
    greatest(
      organization.asaas_last_event_at,
      organization.billing_last_reconciled_at
    )
    into v_organization_status, v_organization_cursor
  from public.organizations organization
  where organization.id = v_change.organization_id
    and organization.asaas_subscription_id = v_change.provider_subscription_id
  for update;

  if not found then
    raise exception 'scheduled billing plan change lost its organization identity: %', v_change.id
      using errcode = '40001';
  end if;

  if v_organization_status in ('suspended', 'cancelled', 'canceled') then
    return new;
  end if;

  if v_payment_cursor is null
     or (
       v_organization_cursor is not null
       and v_organization_cursor > v_payment_cursor
     ) then
    return new;
  end if;

  select plan.*
  into v_plan
  from public.admin_subscription_plans plan
  where plan.id = v_change.target_plan_id;

  if not found then
    raise exception 'scheduled billing target plan no longer exists: %', v_change.target_plan_id
      using errcode = '23503';
  end if;

  update private.billing_plan_changes
  set status = 'applying',
      updated_at = now()
  where id = v_change.id
    and status in ('provider_updating', 'scheduled');

  if not found then
    return new;
  end if;

  v_period_end := (
    new.due_date + make_interval(months => v_change.billing_period_months)
  )::date;

  update public.organizations
  set
    plan_id = v_change.target_plan_id,
    pending_plan_id = null,
    subscription_value = round(
      v_change.amount / v_change.billing_period_months,
      2
    ),
    subscription_billing_period_months = v_change.billing_period_months,
    subscription_type = 'paid',
    subscription_status = 'active',
    trial_ends_at = null,
    next_billing_date = greatest(
      coalesce(next_billing_date, '-infinity'::date),
      v_period_end
    ),
    max_users = coalesce(v_plan.max_users, max_users),
    updated_at = now()
  where id = v_change.organization_id
    and plan_id = v_change.from_plan_id
    and pending_plan_id = v_change.target_plan_id
    and asaas_subscription_id = v_change.provider_subscription_id
    and subscription_status not in ('suspended', 'cancelled', 'canceled');

  if not found then
    raise exception 'scheduled billing plan change lost its organization guard: %', v_change.id
      using errcode = '40001';
  end if;

  update public.subscriptions
  set
    plan_id = v_change.target_plan_id,
    status = 'active',
    billing_period_months = v_change.billing_period_months,
    current_period_start = new.due_date::timestamptz,
    current_period_end = v_period_end::timestamptz,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'managed_plan_change_id', v_change.id,
      'billing_period_months', v_change.billing_period_months,
      'billing_cycle', v_change.provider_cycle,
      'charged_amount', new.value,
      'period_anchor', new.due_date
    ),
    updated_at = now()
  where organization_id = v_change.organization_id
    and provider_subscription_id = v_change.provider_subscription_id;

  update private.billing_plan_changes
  set
    status = 'applied',
    applied_at = now(),
    last_error = null,
    updated_at = now()
  where id = v_change.id
    and status = 'applying';

  insert into public.subscription_logs (
    organization_id,
    event_type,
    status,
    metadata
  )
  values (
    v_change.organization_id,
    'managed_plan_change_applied',
    'active',
    jsonb_build_object(
      'plan_change_id', v_change.id,
      'from_plan_id', v_change.from_plan_id,
      'target_plan_id', v_change.target_plan_id,
      'provider_subscription_id', v_change.provider_subscription_id,
      'provider_payment_id', new.asaas_payment_id,
      'amount', new.value,
      'due_date', new.due_date,
      'billing_period_months', v_change.billing_period_months
    )
  );

  return new;
end;
$function$;

revoke all on function private.apply_scheduled_billing_plan_change()
  from public, anon, authenticated, service_role;

create or replace function private.invalidate_billing_receipt_delivery_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text := upper(btrim(coalesce(new.status, '')));
  v_invalidated_at timestamptz := now();
begin
  if v_status not in (
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  ) then
    return new;
  end if;

  -- A receipt remains as an immutable audit record, but an unsent delivery
  -- must become terminal before a worker can send a now-false confirmation.
  update public.notifications notification
  set metadata = coalesce(notification.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'receipt_invalidated', true,
      'receipt_invalidated_at', v_invalidated_at,
      'receipt_invalidation_status', v_status,
      'whatsapp_dispatch_required', false,
      'dispatch', coalesce(notification.metadata -> 'dispatch', '{}'::jsonb)
        || jsonb_build_object(
          'whatsapp', coalesce(
            notification.metadata -> 'dispatch' -> 'whatsapp',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', false,
            'status', case
              when notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
                in ('sent', 'skipped', 'permanent_failed')
                then notification.metadata -> 'dispatch' -> 'whatsapp' ->> 'status'
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          ),
          'email', coalesce(
            notification.metadata -> 'dispatch' -> 'email',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', false,
            'status', case
              when notification.metadata -> 'dispatch' -> 'email' ->> 'status'
                in ('sent', 'skipped', 'permanent_failed')
                then notification.metadata -> 'dispatch' -> 'email' ->> 'status'
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          ),
          'push', coalesce(
            notification.metadata -> 'dispatch' -> 'push',
            '{}'::jsonb
          ) || jsonb_build_object(
            'required', false,
            'status', case
              when notification.metadata -> 'dispatch' -> 'push' ->> 'status'
                in ('sent', 'skipped', 'permanent_failed')
                then notification.metadata -> 'dispatch' -> 'push' ->> 'status'
              else 'skipped'
            end,
            'invalidated_at', v_invalidated_at,
            'invalidation_status', v_status
          )
        ),
      'whatsapp_dispatch', coalesce(
        notification.metadata -> 'whatsapp_dispatch',
        '{}'::jsonb
      ) || jsonb_build_object(
        'status', case
          when notification.metadata -> 'whatsapp_dispatch' ->> 'status'
            in ('sent', 'skipped', 'permanent_failed')
            then notification.metadata -> 'whatsapp_dispatch' ->> 'status'
          else 'skipped'
        end,
        'invalidated_at', v_invalidated_at,
        'invalidation_status', v_status
      )
    )
  where notification.organization_id = new.organization_id
    and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
    and notification.metadata ->> 'payment_id' = new.id::text;

  return new;
end;
$function$;

revoke all on function private.invalidate_billing_receipt_delivery_from_payment()
  from public, anon, authenticated, service_role;

drop trigger if exists asaas_payments_invalidate_billing_receipt_delivery
  on public.asaas_payments;
create trigger asaas_payments_invalidate_billing_receipt_delivery
after insert or update of status on public.asaas_payments
for each row
execute function private.invalidate_billing_receipt_delivery_from_payment();

-- Canonicalize any already-adverse payment whose receipt delivery was still
-- pending when this migration was installed.
update public.asaas_payments payment
set status = payment.status
where upper(btrim(coalesce(payment.status, ''))) in (
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  )
  and exists (
    select 1
    from public.notifications notification
    where notification.organization_id = payment.organization_id
      and notification.metadata ->> 'event_key' = 'billing_payment_receipt'
      and notification.metadata ->> 'payment_id' = payment.id::text
      and coalesce(
        notification.metadata ->> 'receipt_invalidated',
        'false'
      ) <> 'true'
  );

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
as $function$
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

  if greatest(
       v_org.billing_last_reconciled_at,
       v_org.asaas_last_event_at
     ) > v_observed_at then
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
  elsif v_org.subscription_status in ('cancelled', 'canceled', 'suspended') then
    -- A paid invoice must never resurrect a terminal account. A new checkout
    -- explicitly moves an eligible organization back to pending_payment.
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
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  ) then
    v_new_status := 'suspended';
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
$function$;

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
  p_latest_payment_due_date date,
  p_next_billing_date date,
  p_observed_at timestamptz,
  p_source text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_payment_id text := nullif(btrim(coalesce(p_latest_payment_id, '')), '');
  v_payment_status text := upper(nullif(btrim(coalesce(p_latest_payment_status, '')), ''));
  v_customer_id text := nullif(btrim(coalesce(p_provider_customer_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_provider_subscription_id, '')), '');
  v_observed_at timestamptz := least(coalesce(p_observed_at, now()), now());
  v_existing public.asaas_payments%rowtype;
  v_org public.organizations%rowtype;
  v_existing_cursor timestamptz;
  v_result jsonb;
  v_confirmation jsonb;
  v_persisted integer := 0;
begin
  if v_payment_id is not null and char_length(v_payment_id) > 255 then
    raise exception 'invalid provider payment id'
      using errcode = '22023';
  end if;

  if v_payment_status in (
    'CONFIRMED',
    'RECEIVED',
    'RECEIVED_IN_CASH',
    'REFUNDED',
    'REFUND_REQUESTED',
    'REFUND_IN_PROGRESS',
    'PARTIALLY_REFUNDED',
    'RECEIVED_IN_CASH_UNDONE',
    'CHARGEBACK_REQUESTED',
    'CHARGEBACK_DISPUTE',
    'AWAITING_CHARGEBACK_REVERSAL'
  ) and v_payment_id is null then
    raise exception 'provider payment id is required for a paid or reversal snapshot'
      using errcode = '22023';
  end if;

  if v_payment_id is not null then
    perform private.lock_asaas_billing_resources(
      v_payment_id,
      v_subscription_id
    );

    select payment.*
      into v_existing
    from public.asaas_payments payment
    where payment.asaas_payment_id = v_payment_id
    for update;

    if found then
      if v_existing.organization_id is distinct from p_organization_id then
        raise exception 'provider payment belongs to a different organization'
          using errcode = '22023';
      end if;

      if v_existing.asaas_customer_id is not null
         and v_customer_id is not null
         and v_existing.asaas_customer_id <> v_customer_id then
        raise exception 'provider payment belongs to a different customer'
          using errcode = '22023';
      end if;

      if v_existing.asaas_subscription_id is not null
         and v_subscription_id is not null
         and v_existing.asaas_subscription_id <> v_subscription_id then
        raise exception 'provider payment belongs to a different subscription'
          using errcode = '22023';
      end if;

      v_existing_cursor := greatest(
        v_existing.last_webhook_event_at,
        v_existing.last_provider_observed_at
      );

      if v_existing_cursor is not null and v_existing_cursor > v_observed_at then
        return jsonb_build_object(
          'outcome', 'stale',
          'status', v_existing.status,
          'field', 'payment',
          'observed_at', v_observed_at
        );
      end if;
    end if;
  end if;

  -- Lock and validate the organization cursor before any confirmation can
  -- mutate an intent or plan. Together with the payment lock above this makes
  -- the later apply/confirm/persist sequence atomic and immune to a newer
  -- webhook for another payment.
  select organization.*
    into v_org
  from public.organizations organization
  where organization.id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  if nullif(btrim(v_org.asaas_customer_id), '') is not null
     and v_customer_id is not null
     and btrim(v_org.asaas_customer_id) <> v_customer_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'customer'
    );
  end if;

  if nullif(btrim(v_org.asaas_subscription_id), '') is not null
     and v_subscription_id is not null
     and btrim(v_org.asaas_subscription_id) <> v_subscription_id then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription'
    );
  end if;

  if greatest(
       v_org.billing_last_reconciled_at,
       v_org.asaas_last_event_at
     ) > v_observed_at then
    return jsonb_build_object(
      'outcome', 'stale',
      'status', v_org.subscription_status,
      'field', 'organization',
      'observed_at', v_observed_at
    );
  end if;

  -- Keep the payment and organization cursors on the same observation before
  -- apply_asaas_billing_snapshot advances the organization cursor. The
  -- confirmation primitive compares both cursors and would otherwise reject
  -- an existing T0 payment while this atomic poll is applying T1. Updating
  -- only the provider cursor avoids firing status-driven payment triggers;
  -- every later failure still rolls this change back with the transaction.
  if v_existing.asaas_payment_id is not null then
    update public.asaas_payments
    set last_provider_observed_at = v_observed_at
    where asaas_payment_id = v_payment_id
      and organization_id = p_organization_id
      and (
        asaas_customer_id is null
        or v_customer_id is null
        or asaas_customer_id = v_customer_id
      )
      and (
        asaas_subscription_id is null
        or v_subscription_id is null
        or asaas_subscription_id = v_subscription_id
      )
      and v_observed_at >= coalesce(
        greatest(last_webhook_event_at, last_provider_observed_at),
        '-infinity'::timestamptz
      );

    get diagnostics v_persisted = row_count;
    if v_persisted <> 1 then
      raise exception 'provider payment snapshot lost its identity or ordering race'
        using errcode = '40001';
    end if;
  end if;

  v_result := private.apply_asaas_billing_snapshot(
    p_organization_id,
    v_customer_id,
    v_subscription_id,
    p_provider_subscription_status,
    v_payment_status,
    p_next_billing_date,
    v_observed_at,
    p_source
  );

  if coalesce(v_result ->> 'outcome', '') <> 'applied' then
    return v_result;
  end if;

  if v_payment_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH')
     and v_org.subscription_status not in (
       'suspended',
       'cancelled',
       'canceled'
     ) then
    v_confirmation := private.confirm_billing_checkout_intent(
      v_payment_id,
      v_subscription_id,
      v_payment_status,
      p_latest_payment_amount
    );

    if coalesce(v_confirmation ->> 'outcome', '') not in (
      'confirmed',
      'already_confirmed',
      'intent_not_found',
      'terminal_state'
    ) then
      raise exception 'billing intent confirmation failed: %', v_confirmation
        using errcode = '23514';
    end if;
  end if;

  if v_payment_id is null or v_payment_status is null then
    return v_result;
  end if;

  insert into public.asaas_payments (
    organization_id,
    asaas_payment_id,
    asaas_customer_id,
    asaas_subscription_id,
    status,
    value,
    due_date,
    raw_event,
    last_provider_observed_at,
    updated_at
  )
  values (
    p_organization_id,
    v_payment_id,
    v_customer_id,
    v_subscription_id,
    v_payment_status,
    p_latest_payment_amount,
    p_latest_payment_due_date,
    jsonb_build_object(
      'last_provider_snapshot', jsonb_build_object(
        'source', left(coalesce(nullif(btrim(p_source), ''), 'reconciliation'), 80),
        'status', v_payment_status,
        'due_date', p_latest_payment_due_date,
        'observed_at', v_observed_at
      )
    ),
    v_observed_at,
    now()
  )
  on conflict (asaas_payment_id) do update
  set
    asaas_customer_id = coalesce(
      public.asaas_payments.asaas_customer_id,
      excluded.asaas_customer_id
    ),
    asaas_subscription_id = coalesce(
      public.asaas_payments.asaas_subscription_id,
      excluded.asaas_subscription_id
    ),
    status = excluded.status,
    value = coalesce(excluded.value, public.asaas_payments.value),
    due_date = coalesce(excluded.due_date, public.asaas_payments.due_date),
    raw_event = coalesce(public.asaas_payments.raw_event, '{}'::jsonb)
      || excluded.raw_event,
    last_provider_observed_at = excluded.last_provider_observed_at,
    updated_at = now()
  where public.asaas_payments.organization_id = excluded.organization_id
    and (
      public.asaas_payments.asaas_customer_id is null
      or excluded.asaas_customer_id is null
      or public.asaas_payments.asaas_customer_id = excluded.asaas_customer_id
    )
    and (
      public.asaas_payments.asaas_subscription_id is null
      or excluded.asaas_subscription_id is null
      or public.asaas_payments.asaas_subscription_id = excluded.asaas_subscription_id
    )
    and excluded.last_provider_observed_at >= coalesce(
      greatest(
        public.asaas_payments.last_webhook_event_at,
        public.asaas_payments.last_provider_observed_at
      ),
      '-infinity'::timestamptz
    );

  get diagnostics v_persisted = row_count;
  if v_persisted <> 1 then
    raise exception 'provider payment snapshot lost its identity or ordering race'
      using errcode = '40001';
  end if;

  return v_result || jsonb_build_object(
    'payment_id', v_payment_id,
    'payment_status', v_payment_status,
    'payment_observed_at', v_observed_at
  );
end;
$function$;

revoke all on function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) from public, anon, authenticated, service_role;

-- Compatibility overload for existing database callers. New polling code uses
-- the overload above so payment due_date reaches the managed plan-change
-- trigger even when the corresponding webhook was lost.
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
language sql
security definer
set search_path = ''
as $function$
  select private.apply_asaas_billing_snapshot_with_payment(
    p_organization_id,
    p_provider_customer_id,
    p_provider_subscription_id,
    p_provider_subscription_status,
    p_latest_payment_id,
    p_latest_payment_status,
    p_latest_payment_amount,
    null::date,
    p_next_billing_date,
    p_observed_at,
    p_source
  );
$function$;

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

comment on function public.reconcile_asaas_payment_webhook(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) is 'Idempotently reconciles Asaas payment events; reversal states suspend access without reviving cancelled tenants.';

comment on function private.apply_asaas_billing_snapshot(
  uuid,
  text,
  text,
  text,
  text,
  date,
  timestamptz,
  text
) is 'Applies periodic Asaas billing state; refunds, cash receipt undo and chargebacks suspend access.';

comment on function private.apply_asaas_billing_snapshot_with_payment(
  uuid,
  text,
  text,
  text,
  text,
  text,
  numeric,
  date,
  date,
  timestamptz,
  text
) is 'Atomically applies an Asaas snapshot and persists the exact payment state used to derive access.';

comment on function private.apply_asaas_billing_snapshot_with_payment(
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
) is 'Compatibility overload for billing snapshots that do not carry a payment due date.';
