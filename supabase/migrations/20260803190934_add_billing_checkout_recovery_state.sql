create or replace function public.get_billing_checkout_state(
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_payment jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_organization_id is null then
    raise exception 'organization is required'
      using errcode = '22023';
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents intent
  where intent.organization_id = p_organization_id
    and intent.status in ('creating', 'pending')
  order by intent.created_at desc
  limit 1;

  if not found then
    return null;
  end if;

  select jsonb_build_object(
    'id', payment.asaas_payment_id,
    'status', payment.status,
    'billing_type', payment.billing_type,
    'value', payment.value,
    'due_date', payment.due_date,
    'payment_date', payment.payment_date,
    'invoice_url', payment.invoice_url,
    'updated_at', payment.updated_at
  )
  into v_payment
  from public.asaas_payments payment
  where payment.organization_id = p_organization_id
    and payment.billing_intent_id = v_intent.id
  order by payment.updated_at desc nulls last, payment.created_at desc nulls last
  limit 1;

  return jsonb_build_object(
    'intent_id', v_intent.id,
    'organization_id', v_intent.organization_id,
    'plan_id', v_intent.pending_plan_id,
    'billing_method', v_intent.billing_method,
    'status', v_intent.status,
    'billing_period_months', v_intent.billing_period_months,
    'amount', v_intent.amount,
    'external_reference', v_intent.external_reference,
    'provider_customer_id', v_intent.provider_customer_id,
    'provider_payment_id', v_intent.provider_payment_id,
    'provider_subscription_id', v_intent.provider_subscription_id,
    'provider_checkout_id', v_intent.provider_checkout_id,
    'provider_status', coalesce(
      v_payment ->> 'status',
      nullif(v_intent.provider_response ->> 'status', '')
    ),
    'card_last4', case
      when coalesce(v_intent.provider_response ->> 'cardLast4', '') ~ '^[0-9]{4}$'
        then v_intent.provider_response ->> 'cardLast4'
      else null
    end,
    'has_error', v_intent.last_error is not null,
    'payment', v_payment,
    'created_at', v_intent.created_at,
    'updated_at', v_intent.updated_at
  );
end;
$function$;

revoke all on function public.get_billing_checkout_state(uuid)
  from public, anon, authenticated;
grant execute on function public.get_billing_checkout_state(uuid)
  to service_role;

comment on function public.get_billing_checkout_state(uuid) is
  'Returns the single active billing checkout intent and its latest safe payment snapshot to service-role reconciliation code.';

create or replace function public.cancel_billing_checkout_resource(
  p_organization_id uuid,
  p_intent_id uuid,
  p_payment_id text,
  p_subscription_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_payment_id text := nullif(btrim(coalesce(p_payment_id, '')), '');
  v_subscription_id text := nullif(btrim(coalesce(p_subscription_id, '')), '');
  v_has_paid_payment boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_organization_id is null or p_intent_id is null then
    raise exception 'invalid billing cancellation request'
      using errcode = '22023';
  end if;

  select intent.*
  into v_intent
  from private.billing_checkout_intents intent
  where intent.id = p_intent_id
    and intent.organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_payment_id is not null
    and v_intent.provider_payment_id is distinct from v_payment_id
    and not exists (
      select 1
      from public.asaas_payments payment
      where payment.organization_id = p_organization_id
        and payment.billing_intent_id = p_intent_id
        and payment.asaas_payment_id = v_payment_id
    ) then
    raise exception 'payment does not belong to billing intent'
      using errcode = '22023';
  end if;

  if v_subscription_id is not null
    and v_intent.provider_subscription_id is distinct from v_subscription_id then
    raise exception 'subscription does not belong to billing intent'
      using errcode = '22023';
  end if;

  if v_intent.status = 'confirmed' then
    return jsonb_build_object('outcome', 'already_paid');
  end if;

  select exists (
    select 1
    from public.asaas_payments payment
    where payment.organization_id = p_organization_id
      and payment.billing_intent_id = p_intent_id
      and upper(btrim(coalesce(payment.status, ''))) in (
        'CONFIRMED',
        'RECEIVED',
        'RECEIVED_IN_CASH'
      )
  )
  into v_has_paid_payment;

  if v_has_paid_payment then
    return jsonb_build_object('outcome', 'already_paid');
  end if;

  if v_intent.status in ('cancelled', 'failed') then
    return jsonb_build_object(
      'outcome',
      case when v_intent.status = 'cancelled'
        then 'already_cancelled'
        else 'already_failed'
      end,
      'payment_id', v_intent.provider_payment_id,
      'subscription_id', v_intent.provider_subscription_id
    );
  end if;

  update private.billing_checkout_intents
  set
    status = 'cancelled',
    cancelled_at = coalesce(cancelled_at, now()),
    last_error = 'checkout_cancelled',
    updated_at = now()
  where id = p_intent_id;

  update public.asaas_payments
  set
    status = 'CANCELED',
    raw_event = coalesce(raw_event, '{}'::jsonb) || jsonb_build_object(
      'local_cancellation',
      jsonb_build_object(
        'source', 'checkout_recovery',
        'recorded_at', now()
      )
    ),
    updated_at = now()
  where organization_id = p_organization_id
    and billing_intent_id = p_intent_id
    and upper(btrim(coalesce(status, ''))) not in (
      'CONFIRMED',
      'RECEIVED',
      'RECEIVED_IN_CASH'
    );

  update public.organizations
  set
    asaas_subscription_id = null,
    updated_at = now()
  where id = p_organization_id
    and v_intent.provider_subscription_id is not null
    and asaas_subscription_id = v_intent.provider_subscription_id
    and subscription_status is distinct from 'active';

  return jsonb_build_object(
    'outcome', 'cancelled',
    'payment_id', v_intent.provider_payment_id,
    'subscription_id', v_intent.provider_subscription_id
  );
end;
$function$;

revoke all on function public.cancel_billing_checkout_resource(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.cancel_billing_checkout_resource(uuid, uuid, text, text)
  to service_role;

comment on function public.cancel_billing_checkout_resource(uuid, uuid, text, text) is
  'Closes an unconfirmed checkout intent after its Asaas payment or subscription has been cancelled.';
