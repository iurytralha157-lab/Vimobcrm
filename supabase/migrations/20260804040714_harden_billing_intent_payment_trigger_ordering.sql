-- Payment rows fire their AFTER trigger before the outer webhook wrapper can
-- compare the event against the organization cursor. Resolve and lock the
-- exact intent and organization first, then fail closed for observations that
-- are missing or older than either provider cursor.
create or replace function private.confirm_billing_checkout_from_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_intent_found boolean := false;
  v_organization_cursor timestamptz;
  v_organization_customer_id text;
  v_organization_subscription_id text;
  v_payment_cursor timestamptz := greatest(
    new.last_webhook_event_at,
    new.last_provider_observed_at
  );
begin
  if v_payment_cursor is null then
    return null;
  end if;

  perform private.lock_asaas_billing_resources(
    new.asaas_payment_id,
    new.asaas_subscription_id
  );

  -- An explicit ledger link has precedence. Any mismatch fails closed instead
  -- of falling back to another identifier supplied on the payment row.
  if new.billing_intent_id is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents intent
    where intent.id = new.billing_intent_id
    for update;

    if not found
       or v_intent.organization_id is distinct from new.organization_id
       or (
         v_intent.provider_payment_id is not null
         and btrim(v_intent.provider_payment_id) is distinct from btrim(new.asaas_payment_id)
       )
       or (
         v_intent.provider_subscription_id is not null
         and new.asaas_subscription_id is not null
         and btrim(v_intent.provider_subscription_id)
           is distinct from btrim(new.asaas_subscription_id)
       ) then
      return null;
    end if;

    v_intent_found := true;
  end if;

  -- A provider payment id is globally unique and must never be allowed to
  -- fall through to a subscription belonging to a different organization.
  if not v_intent_found
     and nullif(btrim(coalesce(new.asaas_payment_id, '')), '') is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents intent
    where intent.provider_payment_id = btrim(new.asaas_payment_id)
    order by intent.created_at desc, intent.id desc
    limit 1
    for update;

    if found then
      if v_intent.organization_id is distinct from new.organization_id
         or (
           v_intent.provider_subscription_id is not null
           and new.asaas_subscription_id is not null
           and btrim(v_intent.provider_subscription_id)
             is distinct from btrim(new.asaas_subscription_id)
         ) then
        return null;
      end if;

      v_intent_found := true;
    end if;
  end if;

  if not v_intent_found
     and nullif(btrim(coalesce(new.asaas_subscription_id, '')), '') is not null then
    select intent.*
    into v_intent
    from private.billing_checkout_intents intent
    where intent.provider_subscription_id = btrim(new.asaas_subscription_id)
    order by intent.created_at desc, intent.id desc
    limit 1
    for update;

    if found then
      if v_intent.organization_id is distinct from new.organization_id
         or (
           v_intent.status <> 'confirmed'
           and v_intent.provider_payment_id is not null
           and btrim(v_intent.provider_payment_id)
             is distinct from btrim(new.asaas_payment_id)
         ) then
        return null;
      end if;

      v_intent_found := true;
    end if;
  end if;

  if not v_intent_found then
    return null;
  end if;

  select
    greatest(
      organization.asaas_last_event_at,
      organization.billing_last_reconciled_at
    ),
    organization.asaas_customer_id,
    organization.asaas_subscription_id
  into
    v_organization_cursor,
    v_organization_customer_id,
    v_organization_subscription_id
  from public.organizations organization
  where organization.id = v_intent.organization_id
  for update;

  if not found
     or v_intent.organization_id is distinct from new.organization_id
     or (
       nullif(btrim(coalesce(v_organization_customer_id, '')), '') is not null
       and nullif(btrim(coalesce(new.asaas_customer_id, '')), '') is not null
       and btrim(v_organization_customer_id)
         is distinct from btrim(new.asaas_customer_id)
     )
     or (
       nullif(btrim(coalesce(v_organization_subscription_id, '')), '') is not null
       and nullif(btrim(coalesce(new.asaas_subscription_id, '')), '') is not null
       and btrim(v_organization_subscription_id)
         is distinct from btrim(new.asaas_subscription_id)
     )
     or (
       v_organization_cursor is not null
       and v_organization_cursor > v_payment_cursor
     ) then
    return null;
  end if;

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
    where id = v_intent.id
      and organization_id = new.organization_id
      and billing_method in ('PIX', 'BOLETO')
      and status in ('creating', 'pending');
  elsif upper(btrim(coalesce(new.status, ''))) = 'OVERDUE' then
    update private.billing_checkout_intents
    set
      last_error = 'overdue',
      updated_at = now()
    where id = v_intent.id
      and organization_id = new.organization_id
      and billing_method in ('PIX', 'BOLETO')
      and status in ('creating', 'pending');
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
    where id = v_intent.id
      and organization_id = new.organization_id
      and billing_method = 'CREDIT_CARD'
      and status in ('creating', 'pending');
  end if;

  perform private.confirm_billing_checkout_intent(
    new.asaas_payment_id,
    new.asaas_subscription_id,
    new.status,
    new.value
  );

  return null;
end;
$function$;

revoke all on function private.confirm_billing_checkout_from_payment()
  from public, anon, authenticated, service_role;
