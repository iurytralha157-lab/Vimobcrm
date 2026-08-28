-- Keep the checkout intent as the immutable proof for the first charge while
-- allowing later payments from the exact same provider subscription to be
-- reconciled as renewals. Provider identifiers are matched deterministically:
-- payment first, then subscription, with cross-identifier validation.
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
  v_intent_found boolean := false;
  v_found_by_payment boolean := false;
  v_original_payment boolean := false;
  v_payment_observed_at timestamptz;
begin
  if v_payment_status not in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
    return jsonb_build_object('outcome', 'not_paid');
  end if;

  if v_payment_id is null and v_subscription_id is null then
    return jsonb_build_object('outcome', 'provider_resource_missing');
  end if;

  if v_payment_id is null then
    return jsonb_build_object('outcome', 'payment_id_missing');
  end if;

  if char_length(v_payment_id) > 255
     or char_length(coalesce(v_subscription_id, '')) > 255 then
    return jsonb_build_object('outcome', 'identifier_invalid');
  end if;

  perform private.lock_asaas_billing_resources(
    v_payment_id,
    v_subscription_id
  );

  -- A payment id is globally unique and therefore has precedence. This also
  -- makes a replay with a forged subscription fail instead of matching some
  -- other intent through the subscription side of an OR predicate.
  select intent.*
  into v_intent
  from private.billing_checkout_intents intent
  where intent.status in ('creating', 'pending', 'confirmed')
    and intent.provider_payment_id = v_payment_id
  order by intent.created_at desc, intent.id desc
  limit 1
  for update;

  if found then
    v_intent_found := true;
    v_found_by_payment := true;
  elsif v_subscription_id is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents intent
    where intent.status in ('creating', 'pending', 'confirmed')
      and intent.provider_subscription_id = v_subscription_id
    order by intent.created_at desc, intent.id desc
    limit 1
    for update;

    v_intent_found := found;
  end if;

  if not v_intent_found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_subscription_id is not null
     and (
       v_intent.provider_subscription_id is null
       or btrim(v_intent.provider_subscription_id) <> v_subscription_id
     ) then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'subscription',
      'intent_id', v_intent.id
    );
  end if;

  if not v_found_by_payment
     and v_intent.provider_payment_id is not null
     and btrim(v_intent.provider_payment_id) <> v_payment_id
     and v_intent.status <> 'confirmed' then
    return jsonb_build_object(
      'outcome', 'identifier_mismatch',
      'field', 'payment',
      'intent_id', v_intent.id
    );
  end if;

  v_original_payment := v_intent.provider_payment_id is not null
    and btrim(v_intent.provider_payment_id) = v_payment_id;

  if v_intent.status = 'confirmed' then
    -- Only a different payment id on the exact stored subscription is a
    -- renewal. Its amount belongs to the new billing cycle and must not be
    -- compared with the immutable amount of the original checkout.
    if not v_original_payment then
      if v_subscription_id is null
         or v_intent.provider_subscription_id is null
         or btrim(v_intent.provider_subscription_id) <> v_subscription_id then
        return jsonb_build_object(
          'outcome', 'identifier_mismatch',
          'field', 'renewal',
          'intent_id', v_intent.id
        );
      end if;

      return jsonb_build_object(
        'outcome', 'already_confirmed',
        'intent_id', v_intent.id,
        'billing_period_months', v_intent.billing_period_months,
        'renewal', true,
        'payment_id', v_payment_id
      );
    end if;

    -- A replay of the original charge remains subject to the frozen quote.
    if p_paid_amount is null then
      return jsonb_build_object(
        'outcome', 'amount_missing',
        'intent_id', v_intent.id
      );
    end if;

    if abs(v_intent.amount - p_paid_amount) > 0.01 then
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
      'billing_period_months', v_intent.billing_period_months,
      'renewal', false
    );
  end if;

  select organization.*
  into v_org
  from public.organizations organization
  where organization.id = v_intent.organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'organization_not_found');
  end if;

  -- A legitimate checkout has already moved the organization to
  -- pending_payment. A historical intent must never reactivate terminal
  -- access when called indirectly by the payment-row confirmation trigger.
  if lower(btrim(coalesce(v_org.subscription_status, ''))) in (
    'suspended',
    'cancelled',
    'canceled'
  ) then
    return jsonb_build_object(
      'outcome', 'terminal_state',
      'intent_id', v_intent.id,
      'status', lower(btrim(v_org.subscription_status))
    );
  end if;

  -- The payment-row trigger executes before the outer webhook wrapper can
  -- reject an out-of-order event. Keep that trigger fail-closed against both
  -- the webhook and periodic-reconciliation organization cursors.
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

  if p_paid_amount is null then
    update private.billing_checkout_intents
    set
      last_error = 'amount_missing',
      updated_at = now()
    where id = v_intent.id;

    return jsonb_build_object(
      'outcome', 'amount_missing',
      'intent_id', v_intent.id
    );
  end if;

  if abs(v_intent.amount - p_paid_amount) > 0.01 then
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

  select plan.*
  into v_plan
  from public.admin_subscription_plans plan
  where plan.id = v_intent.pending_plan_id;

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

-- Keep terminal_state non-fatal for the payment webhook. The provider payment
-- still needs to be persisted and acknowledged, but no intent-derived plan or
-- billing period may be applied while the organization is terminal.
create or replace function public.reconcile_asaas_payment_webhook_with_period_intent(
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
  v_result jsonb;
  v_confirmation jsonb;
  v_status text := upper(btrim(coalesce(p_payment ->> 'status', '')));
  v_amount numeric;
  v_intent private.billing_checkout_intents%rowtype;
  v_organization_id uuid;
  v_plan_id uuid;
  v_billing_period_months integer;
  v_billing_cycle text;
  v_charged_amount numeric;
  v_is_recurring boolean := false;
  v_period_anchor date;
  v_period_start timestamptz;
  v_period_end timestamptz;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  v_result := public.reconcile_asaas_payment_webhook_with_intent(
    p_event_id,
    p_event_type,
    p_event_at,
    p_payment,
    p_payload
  );

  if upper(btrim(coalesce(p_event_type, ''))) = 'PAYMENT_CONFIRMED' then
    v_status := 'CONFIRMED';
  elsif upper(btrim(coalesce(p_event_type, ''))) = 'PAYMENT_RECEIVED' then
    v_status := 'RECEIVED';
  elsif upper(btrim(coalesce(p_event_type, ''))) = 'PAYMENT_RECEIVED_IN_CASH' then
    v_status := 'RECEIVED_IN_CASH';
  end if;

  if jsonb_typeof(p_payment -> 'value') = 'number' then
    v_amount := (p_payment ->> 'value')::numeric;
  end if;

  if coalesce(v_result ->> 'outcome', '') = 'processed'
     and v_status in ('CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH') then
    v_confirmation := private.confirm_billing_checkout_intent(
      p_payment ->> 'id',
      p_payment ->> 'subscription',
      v_status,
      v_amount
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

    if coalesce(v_confirmation ->> 'outcome', '') in (
      'confirmed',
      'already_confirmed'
    ) then
      select intent.*
      into v_intent
      from private.billing_checkout_intents intent
      where intent.status = 'confirmed'
        and intent.id = (v_confirmation ->> 'intent_id')::uuid
      for update;

      if found then
        v_organization_id := v_intent.organization_id;
        v_plan_id := v_intent.pending_plan_id;
        v_billing_period_months := v_intent.billing_period_months;
        v_billing_cycle := v_intent.billing_cycle;
        v_charged_amount := coalesce(v_amount, v_intent.amount);
        v_is_recurring := v_intent.billing_method = 'CREDIT_CARD'
          or nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '') is not null;
      end if;
    elsif coalesce(v_confirmation ->> 'outcome', '') = 'intent_not_found'
       and coalesce(v_result ->> 'organization_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select
        organization_row.id,
        organization_row.plan_id,
        case
          when subscription_row.billing_period_months in (1, 6, 12)
            then subscription_row.billing_period_months
          when organization_row.subscription_billing_period_months in (1, 6, 12)
            then organization_row.subscription_billing_period_months
          else 1
        end
      into
        v_organization_id,
        v_plan_id,
        v_billing_period_months
      from public.organizations organization_row
      left join lateral (
        select candidate.billing_period_months
        from public.subscriptions candidate
        where candidate.organization_id = organization_row.id
          and candidate.plan_id = organization_row.plan_id
          and (
            nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '') is null
            or candidate.provider_subscription_id is null
            or candidate.provider_subscription_id = btrim(p_payment ->> 'subscription')
          )
        order by
          case
            when candidate.provider_subscription_id = nullif(
              btrim(coalesce(p_payment ->> 'subscription', '')),
              ''
            ) then 0
            else 1
          end,
          case when candidate.status = 'active' then 0 else 1 end,
          candidate.updated_at desc nulls last,
          candidate.id desc
        limit 1
      ) subscription_row on true
      where organization_row.id = (v_result ->> 'organization_id')::uuid
      for update of organization_row;

      v_billing_cycle := case v_billing_period_months
        when 6 then 'semiannual'
        when 12 then 'yearly'
        else 'monthly'
      end;
      v_charged_amount := v_amount;
      v_is_recurring := nullif(
        btrim(coalesce(p_payment ->> 'subscription', '')),
        ''
      ) is not null;
    end if;

    if v_organization_id is not null
       and v_plan_id is not null
       and v_billing_period_months in (1, 6, 12) then
      if v_is_recurring then
        if coalesce(p_payment ->> 'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
          v_period_anchor := (p_payment ->> 'dueDate')::date;
          v_period_start := v_period_anchor::timestamptz;
        end if;
      else
        if coalesce(p_payment ->> 'paymentDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
          v_period_anchor := (p_payment ->> 'paymentDate')::date;
        elsif coalesce(p_payment ->> 'dueDate', '') ~ '^\d{4}-\d{2}-\d{2}$' then
          v_period_anchor := (p_payment ->> 'dueDate')::date;
        else
          v_period_anchor := coalesce(p_event_at, now())::date;
        end if;
        v_period_start := v_period_anchor::timestamptz;
      end if;

      if v_period_anchor is not null then
        v_period_end := (
          v_period_anchor + make_interval(months => v_billing_period_months)
        )::timestamptz;

        update public.organizations
        set
          subscription_billing_period_months = v_billing_period_months,
          next_billing_date = greatest(
            coalesce(next_billing_date, '-infinity'::date),
            v_period_end::date
          ),
          updated_at = now()
        where id = v_organization_id
          and plan_id = v_plan_id
          and subscription_status = 'active';

        update public.subscriptions
        set
          billing_period_months = v_billing_period_months,
          current_period_start = case
            when current_period_end is null or v_period_end > current_period_end
              then v_period_start
            else current_period_start
          end,
          current_period_end = greatest(
            coalesce(current_period_end, '-infinity'::timestamptz),
            v_period_end
          ),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'billing_period_months', v_billing_period_months,
            'billing_cycle', v_billing_cycle,
            'charged_amount', v_charged_amount,
            'period_anchor', v_period_anchor
          ),
          updated_at = now()
        where organization_id = v_organization_id
          and plan_id = v_plan_id
          and (
            nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '') is null
            or provider_subscription_id is null
            or provider_subscription_id = btrim(p_payment ->> 'subscription')
          );
      end if;
    end if;
  end if;

  return v_result;
end;
$function$;

revoke all on function public.reconcile_asaas_payment_webhook_with_period_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_asaas_payment_webhook_with_period_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;
