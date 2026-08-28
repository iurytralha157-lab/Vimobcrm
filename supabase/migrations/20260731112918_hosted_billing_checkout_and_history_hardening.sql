alter table private.billing_checkout_intents
  add column if not exists provider_checkout_id text;

create unique index if not exists billing_checkout_intents_provider_checkout_idx
  on private.billing_checkout_intents (provider_checkout_id)
  where provider_checkout_id is not null;

create or replace function public.register_billing_hosted_checkout(
  p_intent_id uuid,
  p_checkout_id text,
  p_provider_response jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_intent private.billing_checkout_intents%rowtype;
  v_checkout_id text := nullif(btrim(coalesce(p_checkout_id, '')), '');
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_intent_id is null
     or v_checkout_id is null
     or jsonb_typeof(coalesce(p_provider_response, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid hosted checkout registration'
      using errcode = '22023';
  end if;

  select *
  into v_intent
  from private.billing_checkout_intents
  where id = p_intent_id
  for update;

  if not found then
    return jsonb_build_object('outcome', 'intent_not_found');
  end if;

  if v_intent.billing_method <> 'CREDIT_CARD' then
    raise exception 'hosted checkout requires credit card billing intent'
      using errcode = '22023';
  end if;

  if v_intent.provider_checkout_id is not null
     and v_intent.provider_checkout_id <> v_checkout_id then
    raise exception 'billing intent already has a different checkout'
      using errcode = '22023';
  end if;

  if v_intent.status not in ('creating', 'pending', 'confirmed') then
    return jsonb_build_object('outcome', 'intent_not_registerable');
  end if;

  update private.billing_checkout_intents
  set
    status = case when status = 'confirmed' then status else 'pending' end,
    provider_checkout_id = v_checkout_id,
    provider_response = coalesce(p_provider_response, '{}'::jsonb),
    provider_registered_at = coalesce(provider_registered_at, now()),
    last_error = null,
    updated_at = now()
  where id = p_intent_id;

  return jsonb_build_object(
    'outcome',
    case when v_intent.status = 'pending' then 'reused' else 'registered' end,
    'intent_id', p_intent_id,
    'organization_id', v_intent.organization_id,
    'provider_checkout_id', v_checkout_id
  );
end;
$$;

revoke all on function public.register_billing_hosted_checkout(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.register_billing_hosted_checkout(uuid, text, jsonb)
  to service_role;

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
  v_intent_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  perform private.lock_asaas_billing_resources(
    p_payment ->> 'id',
    p_payment ->> 'subscription'
  );

  select intent.id, intent.organization_id
  into v_intent_id, v_organization_id
  from private.billing_checkout_intents intent
  where (
      intent.external_reference = nullif(
        btrim(coalesce(p_payment ->> 'externalReference', '')),
        ''
      )
      or intent.provider_checkout_id = nullif(
        btrim(coalesce(p_payment ->> 'checkoutSession', '')),
        ''
      )
    )
    and (
      intent.provider_customer_id is null
      or nullif(btrim(coalesce(p_payment ->> 'customer', '')), '') is null
      or intent.provider_customer_id = btrim(p_payment ->> 'customer')
    )
    and (
      intent.provider_subscription_id is null
      or nullif(btrim(coalesce(p_payment ->> 'subscription', '')), '') is null
      or intent.provider_subscription_id = btrim(p_payment ->> 'subscription')
    )
  order by intent.created_at desc, intent.id desc
  limit 1
  for update;

  if v_organization_id is null then
    v_organization_id :=
      private.billing_checkout_organization_from_reference(
        p_payment ->> 'externalReference',
        p_payment ->> 'customer',
        p_payment ->> 'subscription'
      );
  end if;

  if v_organization_id is not null then
    v_payment := jsonb_set(
      p_payment,
      '{externalReference}',
      to_jsonb(v_organization_id::text),
      true
    );
  end if;

  v_result := public.reconcile_asaas_payment_webhook(
    p_event_id,
    p_event_type,
    p_event_at,
    v_payment,
    p_payload
  );

  if v_intent_id is not null then
    update private.billing_checkout_intents
    set
      status = case when status = 'creating' then 'pending' else status end,
      provider_customer_id = coalesce(
        nullif(btrim(p_payment ->> 'customer'), ''),
        provider_customer_id
      ),
      provider_payment_id = coalesce(
        nullif(btrim(p_payment ->> 'id'), ''),
        provider_payment_id
      ),
      provider_subscription_id = coalesce(
        nullif(btrim(p_payment ->> 'subscription'), ''),
        provider_subscription_id
      ),
      provider_registered_at = coalesce(provider_registered_at, now()),
      updated_at = now()
    where id = v_intent_id;

    update public.organizations
    set
      asaas_customer_id = coalesce(
        nullif(btrim(p_payment ->> 'customer'), ''),
        asaas_customer_id
      ),
      asaas_subscription_id = coalesce(
        nullif(btrim(p_payment ->> 'subscription'), ''),
        asaas_subscription_id
      ),
      updated_at = now()
    where id = v_organization_id;

    update public.subscriptions
    set
      provider = 'asaas',
      provider_customer_id = coalesce(
        nullif(btrim(p_payment ->> 'customer'), ''),
        provider_customer_id
      ),
      provider_subscription_id = coalesce(
        nullif(btrim(p_payment ->> 'subscription'), ''),
        provider_subscription_id
      ),
      updated_at = now()
    where organization_id = v_organization_id;

    update public.asaas_payments
    set
      billing_intent_id = v_intent_id,
      updated_at = now()
    where asaas_payment_id = p_payment ->> 'id'
      and organization_id = v_organization_id
      and billing_intent_id is distinct from v_intent_id;
  end if;

  return v_result;
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
  v_intent_id uuid;
  v_result jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  perform private.lock_asaas_billing_resources(
    null,
    p_subscription ->> 'id'
  );

  select intent.id, intent.organization_id
  into v_intent_id, v_organization_id
  from private.billing_checkout_intents intent
  where intent.external_reference = nullif(
      btrim(coalesce(p_subscription ->> 'externalReference', '')),
      ''
    )
    and (
      intent.provider_customer_id is null
      or nullif(btrim(coalesce(p_subscription ->> 'customer', '')), '') is null
      or intent.provider_customer_id = btrim(p_subscription ->> 'customer')
    )
    and (
      intent.provider_subscription_id is null
      or intent.provider_subscription_id = nullif(
        btrim(coalesce(p_subscription ->> 'id', '')),
        ''
      )
    )
  order by intent.created_at desc, intent.id desc
  limit 1
  for update;

  if v_organization_id is null then
    v_organization_id :=
      private.billing_checkout_organization_from_reference(
        p_subscription ->> 'externalReference',
        p_subscription ->> 'customer',
        p_subscription ->> 'id'
      );
  end if;

  if v_organization_id is not null then
    v_subscription := jsonb_set(
      p_subscription,
      '{externalReference}',
      to_jsonb(v_organization_id::text),
      true
    );
  end if;

  v_result := public.reconcile_asaas_subscription_webhook(
    p_event_id,
    p_event_type,
    p_event_at,
    v_subscription,
    p_payload
  );

  if v_intent_id is not null then
    update private.billing_checkout_intents
    set
      status = case when status = 'creating' then 'pending' else status end,
      provider_customer_id = coalesce(
        nullif(btrim(p_subscription ->> 'customer'), ''),
        provider_customer_id
      ),
      provider_subscription_id = coalesce(
        nullif(btrim(p_subscription ->> 'id'), ''),
        provider_subscription_id
      ),
      provider_registered_at = coalesce(provider_registered_at, now()),
      updated_at = now()
    where id = v_intent_id;

    update public.organizations
    set
      asaas_customer_id = coalesce(
        nullif(btrim(p_subscription ->> 'customer'), ''),
        asaas_customer_id
      ),
      asaas_subscription_id = coalesce(
        nullif(btrim(p_subscription ->> 'id'), ''),
        asaas_subscription_id
      ),
      updated_at = now()
    where id = v_organization_id;

    update public.subscriptions
    set
      provider = 'asaas',
      provider_customer_id = coalesce(
        nullif(btrim(p_subscription ->> 'customer'), ''),
        provider_customer_id
      ),
      provider_subscription_id = coalesce(
        nullif(btrim(p_subscription ->> 'id'), ''),
        provider_subscription_id
      ),
      updated_at = now()
    where organization_id = v_organization_id;

    update public.asaas_payments
    set
      billing_intent_id = v_intent_id,
      updated_at = now()
    where organization_id = v_organization_id
      and asaas_subscription_id = p_subscription ->> 'id'
      and billing_intent_id is distinct from v_intent_id;
  end if;

  return v_result;
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

revoke all on table public.asaas_payments from anon, authenticated;
grant select, insert, update on table public.asaas_payments to service_role;

comment on column private.billing_checkout_intents.provider_checkout_id is
  'Identificador da sessao hospedada do Asaas; nunca exposto diretamente pelo Data API.';
