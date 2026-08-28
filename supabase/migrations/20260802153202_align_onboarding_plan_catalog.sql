-- Make the subscription-plan catalog the source of truth for onboarding.
-- This migration deliberately does not resync existing organizations: their
-- current module overrides remain untouched until a controlled rollout.

alter table public.admin_subscription_plans
  add column if not exists reference_price numeric(10, 2),
  add column if not exists discount_percentage integer not null default 0,
  add column if not exists display_features text[] not null default array[]::text[],
  add column if not exists display_order integer not null default 0,
  add column if not exists billing_periods integer[] not null default array[1];

-- Preserve the cadence of any pre-existing annual subscription before the
-- canonical catalog starts treating plan.price as a monthly base value.
alter table public.organizations
  add column if not exists subscription_billing_period_months integer not null default 1;

alter table public.subscriptions
  add column if not exists billing_period_months integer not null default 1;

update public.organizations organization_row
set subscription_billing_period_months = 12
from public.admin_subscription_plans plan
where plan.id = organization_row.plan_id
  and lower(btrim(coalesce(plan.billing_cycle, ''))) in ('yearly', 'annual', 'anual')
  and organization_row.subscription_billing_period_months = 1;

update public.subscriptions subscription_row
set billing_period_months = 12
from public.admin_subscription_plans plan
where plan.id = subscription_row.plan_id
  and lower(btrim(coalesce(plan.billing_cycle, ''))) in ('yearly', 'annual', 'anual')
  and subscription_row.billing_period_months = 1;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_subscription_plans_reference_price_check'
      and conrelid = 'public.admin_subscription_plans'::regclass
  ) then
    alter table public.admin_subscription_plans
      add constraint admin_subscription_plans_reference_price_check
      check (reference_price is null or reference_price >= price);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_subscription_plans_discount_percentage_check'
      and conrelid = 'public.admin_subscription_plans'::regclass
  ) then
    alter table public.admin_subscription_plans
      add constraint admin_subscription_plans_discount_percentage_check
      check (discount_percentage between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_subscription_plans_display_order_check'
      and conrelid = 'public.admin_subscription_plans'::regclass
  ) then
    alter table public.admin_subscription_plans
      add constraint admin_subscription_plans_display_order_check
      check (display_order >= 0);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'admin_subscription_plans_billing_periods_check'
      and conrelid = 'public.admin_subscription_plans'::regclass
  ) then
    alter table public.admin_subscription_plans
      add constraint admin_subscription_plans_billing_periods_check
      check (
        cardinality(billing_periods) > 0
        and billing_periods <@ array[1, 6, 12]::integer[]
      );
  end if;
end;
$$;

do $$
declare
  v_starter_count integer;
  v_pro_count integer;
  v_master_count integer;
begin
  select count(*) into v_starter_count
  from public.admin_subscription_plans
  where lower(btrim(slug)) in ('starter', 'starter-197');

  if v_starter_count = 0 then
    insert into public.admin_subscription_plans (
      slug,
      name,
      price,
      billing_cycle,
      trial_enabled,
      trial_days,
      max_users,
      max_whatsapp_sessions,
      is_active,
      is_public
    )
    values (
      'starter-197',
      'Starter',
      197.00,
      'monthly',
      true,
      7,
      5,
      5,
      true,
      true
    );
    v_starter_count := 1;
  end if;

  select count(*) into v_pro_count
  from public.admin_subscription_plans
  where lower(btrim(slug)) in ('pro', 'pro-297', 'intermediario-297');

  if v_pro_count = 0 then
    insert into public.admin_subscription_plans (
      slug,
      name,
      price,
      billing_cycle,
      trial_enabled,
      trial_days,
      max_users,
      max_whatsapp_sessions,
      is_active,
      is_public
    )
    values (
      'intermediario-297',
      'Pro',
      297.00,
      'monthly',
      false,
      0,
      10,
      10,
      true,
      true
    );
    v_pro_count := 1;
  end if;

  select count(*) into v_master_count
  from public.admin_subscription_plans
  where lower(btrim(slug)) in ('master', 'master-497');

  if v_master_count = 0 then
    insert into public.admin_subscription_plans (
      slug,
      name,
      price,
      billing_cycle,
      trial_enabled,
      trial_days,
      max_users,
      max_whatsapp_sessions,
      is_active,
      is_public
    )
    values (
      'master-497',
      'Master',
      497.00,
      'monthly',
      false,
      0,
      20,
      20,
      true,
      true
    );
    v_master_count := 1;
  end if;

  if v_starter_count <> 1 or v_pro_count <> 1 or v_master_count <> 1 then
    raise exception
      'canonical plan catalog mismatch: starter=%, pro=%, master=%',
      v_starter_count,
      v_pro_count,
      v_master_count
      using errcode = '23514';
  end if;
end;
$$;

update public.admin_subscription_plans
set
  slug = 'starter-197',
  name = 'Starter',
  price = 197.00,
  billing_cycle = 'monthly',
  trial_enabled = true,
  trial_days = 7,
  max_users = 5,
  max_whatsapp_sessions = 5,
  is_active = true,
  is_public = true,
  description = 'Pipeline, agenda e integrações para organizar sua operação comercial.',
  reference_price = 394.00,
  discount_percentage = 50,
  display_order = 1,
  billing_periods = array[1, 6, 12]::integer[],
  display_features = array[
    'Pipeline em Kanban',
    'Dashboard',
    'Agenda',
    'Google Agenda integrado',
    'WhatsApp',
    'Integração Meta'
  ]::text[],
  modules = array[
    'crm',
    'agenda',
    'whatsapp',
    'round_robin'
  ]::text[],
  updated_at = now()
where lower(btrim(slug)) in ('starter', 'starter-197');

update public.admin_subscription_plans
set
  slug = 'intermediario-297',
  name = 'Pro',
  price = 297.00,
  billing_cycle = 'monthly',
  trial_enabled = false,
  trial_days = 0,
  max_users = 10,
  max_whatsapp_sessions = 10,
  is_active = true,
  is_public = true,
  description = 'Tudo do Starter, com imóveis, site público e automações.',
  reference_price = 594.00,
  discount_percentage = 50,
  display_order = 2,
  billing_periods = array[1, 6, 12]::integer[],
  display_features = array[
    'Pipeline em Kanban',
    'Dashboard',
    'Agenda',
    'Google Agenda integrado',
    'WhatsApp',
    'Integração Meta',
    'Imóveis',
    'Site público',
    'Automações'
  ]::text[],
  modules = array[
    'crm',
    'agenda',
    'whatsapp',
    'round_robin',
    'properties',
    'site',
    'automations'
  ]::text[],
  updated_at = now()
where lower(btrim(slug)) in ('pro', 'pro-297', 'intermediario-297');

update public.admin_subscription_plans
set
  slug = 'master-497',
  name = 'Master',
  price = 497.00,
  billing_cycle = 'monthly',
  trial_enabled = false,
  trial_days = 0,
  max_users = 20,
  max_whatsapp_sessions = 20,
  is_active = true,
  is_public = true,
  description = 'Tudo do Pro, com portais, marketing e gamificação.',
  reference_price = 994.00,
  discount_percentage = 50,
  display_order = 3,
  billing_periods = array[1, 6, 12]::integer[],
  display_features = array[
    'Pipeline em Kanban',
    'Dashboard',
    'Agenda',
    'Google Agenda integrado',
    'WhatsApp',
    'Integração Meta',
    'Imóveis',
    'Site público',
    'Automações',
    'Portais imobiliários',
    'Marketing',
    'Gamificação'
  ]::text[],
  modules = array[
    'crm',
    'agenda',
    'whatsapp',
    'round_robin',
    'properties',
    'site',
    'automations',
    'portals',
    'campaigns',
    'gamification'
  ]::text[],
  updated_at = now()
where lower(btrim(slug)) in ('master', 'master-497');

-- Keep historical plan rows for referential integrity, but they are no longer
-- valid public onboarding choices. The API also enforces is_public server-side.
update public.admin_subscription_plans
set
  is_active = false,
  is_public = false,
  updated_at = now()
where lower(btrim(slug)) in (
    'trial',
    'plan-05ec0d1c',
    'basic',
    'basico',
    'basic-197'
  )
  or (
    lower(btrim(name)) in ('trial', 'básico', 'basico')
    and lower(btrim(slug)) not in (
      'starter-197',
      'intermediario-297',
      'master-497'
    )
  );

-- Only the canonical catalog is public. Noncanonical rows may remain active
-- for existing organizations, but cannot be contracted by new signups.
update public.admin_subscription_plans
set
  is_public = false,
  updated_at = now()
where lower(btrim(slug)) not in (
  'starter-197',
  'intermediario-297',
  'master-497'
);

create index if not exists admin_subscription_plans_public_display_idx
  on public.admin_subscription_plans (
    is_public,
    is_active,
    display_order,
    price,
    name
  );

-- A plan price is the monthly base. Checkout may charge that base every one,
-- six or twelve months, without an additional period discount.
alter table private.billing_checkout_intents
  add column if not exists billing_period_months integer;

update private.billing_checkout_intents
set billing_period_months = case
  when billing_cycle = 'yearly' then 12
  when billing_cycle = 'semiannual' then 6
  else 1
end
where billing_period_months is null;

alter table private.billing_checkout_intents
  alter column billing_period_months set default 1,
  alter column billing_period_months set not null;

alter table private.billing_checkout_intents
  drop constraint if exists billing_checkout_intents_billing_cycle_check;

alter table private.billing_checkout_intents
  add constraint billing_checkout_intents_billing_cycle_check
    check (billing_cycle in ('monthly', 'semiannual', 'yearly'));

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'billing_checkout_intents_billing_period_months_check'
      and conrelid = 'private.billing_checkout_intents'::regclass
  ) then
    alter table private.billing_checkout_intents
      add constraint billing_checkout_intents_billing_period_months_check
      check (billing_period_months in (1, 6, 12));
  end if;
end;
$$;

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
     or v_method not in ('PIX', 'CREDIT_CARD')
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
)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout_intent(
  uuid,
  text,
  integer,
  uuid,
  numeric
)
  to service_role;

create or replace function public.reserve_billing_checkout_intent(
  p_organization_id uuid,
  p_billing_method text,
  p_billing_period_months integer
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.reserve_billing_checkout_intent(
    p_organization_id,
    p_billing_method,
    p_billing_period_months,
    null,
    null
  );
$$;

revoke all on function public.reserve_billing_checkout_intent(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout_intent(uuid, text, integer)
  to service_role;

create or replace function public.reserve_billing_checkout_intent(
  p_organization_id uuid,
  p_billing_method text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.reserve_billing_checkout_intent(
    p_organization_id,
    p_billing_method,
    1
  );
$$;

revoke all on function public.reserve_billing_checkout_intent(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reserve_billing_checkout_intent(uuid, text)
  to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'organizations_subscription_billing_period_months_check'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint organizations_subscription_billing_period_months_check
      check (subscription_billing_period_months in (1, 6, 12));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'subscriptions_billing_period_months_check'
      and conrelid = 'public.subscriptions'::regclass
  ) then
    alter table public.subscriptions
      add constraint subscriptions_billing_period_months_check
      check (billing_period_months in (1, 6, 12));
  end if;
end;
$$;

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
  v_period_end timestamptz;
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

  if v_intent.status = 'confirmed' then
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
$$;

revoke all on function private.confirm_billing_checkout_intent(
  text,
  text,
  text,
  numeric
) from public, anon, authenticated, service_role;

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
as $$
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

  -- The legacy reconciler derives the next period from plan.billing_cycle,
  -- which is intentionally monthly now that plan.price is the monthly base.
  -- Reapply the checkout term only for a newly processed paid event. The
  -- current payment due date is the anchor, so later subscription renewals
  -- advance by another 6/12 months instead of returning to the first term.
  -- Existing organizations without a checkout intent use the period that was
  -- backfilled before the catalog became monthly-price based.
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
      'intent_not_found'
    ) then
      raise exception 'billing intent confirmation failed: %', v_confirmation
        using errcode = '23514';
    end if;

    if coalesce(v_confirmation ->> 'outcome', '') <> 'intent_not_found' then
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
    elsif coalesce(v_result ->> 'organization_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
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
$$;

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

create or replace function public.reconcile_asaas_subscription_webhook_with_period_intent(
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
  v_result jsonb;
  v_organization_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  v_result := public.reconcile_asaas_subscription_webhook_with_intent(
    p_event_id,
    p_event_type,
    p_event_at,
    p_subscription,
    p_payload
  );

  if coalesce(v_result ->> 'outcome', '') = 'processed'
     and upper(btrim(coalesce(p_event_type, ''))) in (
       'SUBSCRIPTION_CREATED',
       'SUBSCRIPTION_UPDATED'
     )
     and coalesce(v_result ->> 'organization_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_organization_id := (v_result ->> 'organization_id')::uuid;

    -- SUBSCRIPTION_CREATED can arrive after PAYMENT_CONFIRMED carrying the
    -- checkout's first due date. Never let that older provider snapshot move
    -- the organization behind the paid period already persisted locally.
    update public.organizations organization_row
    set
      next_billing_date = coalesce(
        greatest(
          organization_row.next_billing_date,
          (
          select max(subscription_row.current_period_end::date)
          from public.subscriptions subscription_row
          where subscription_row.organization_id = organization_row.id
            and (
              nullif(btrim(coalesce(p_subscription ->> 'id', '')), '') is null
              or subscription_row.provider_subscription_id is null
              or subscription_row.provider_subscription_id = btrim(
                p_subscription ->> 'id'
              )
            )
          )
        ),
        organization_row.next_billing_date
      ),
      updated_at = now()
    where organization_row.id = v_organization_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.reconcile_asaas_subscription_webhook_with_period_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_asaas_subscription_webhook_with_period_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

alter table private.asaas_webhook_events
  drop constraint if exists asaas_webhook_events_event_type_check,
  drop constraint if exists asaas_webhook_events_resource_type_check;

alter table private.asaas_webhook_events
  add constraint asaas_webhook_events_event_type_check
    check (
      left(event_type, 8) = 'PAYMENT_'
      or left(event_type, 13) = 'SUBSCRIPTION_'
      or left(event_type, 9) = 'CHECKOUT_'
    ),
  add constraint asaas_webhook_events_resource_type_check
    check (resource_type in ('payment', 'subscription', 'checkout'));

create or replace function public.reconcile_asaas_checkout_webhook_with_intent(
  p_event_id text,
  p_event_type text,
  p_event_at timestamptz,
  p_checkout jsonb,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event_id text := nullif(btrim(coalesce(p_event_id, '')), '');
  v_event_type text := upper(btrim(coalesce(p_event_type, '')));
  v_event_at timestamptz := coalesce(p_event_at, now());
  v_checkout_id text := nullif(btrim(coalesce(p_checkout ->> 'id', '')), '');
  v_intent private.billing_checkout_intents%rowtype;
  v_inserted integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if v_event_id is null
     or char_length(v_event_id) > 512
     or v_checkout_id is null
     or char_length(v_checkout_id) > 255
     or v_event_type not in (
       'CHECKOUT_CREATED',
       'CHECKOUT_CANCELED',
       'CHECKOUT_EXPIRED',
       'CHECKOUT_PAID'
     )
     or p_payload is null
     or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'invalid Asaas checkout webhook'
      using errcode = '22023';
  end if;

  select *
  into v_intent
  from private.billing_checkout_intents
  where provider_checkout_id = v_checkout_id
    or (
      provider_checkout_id is null
      and external_reference = nullif(
        btrim(coalesce(p_checkout ->> 'externalReference', '')),
        ''
      )
    )
  order by created_at desc, id desc
  limit 1
  for update;

  if not found then
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
      'checkout',
      v_checkout_id,
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
      'checkout_id', v_checkout_id
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
    'checkout',
    v_checkout_id,
    v_intent.organization_id,
    v_event_at,
    'processed',
    p_payload
  )
  on conflict (event_id) do update
  set
    organization_id = excluded.organization_id,
    provider_event_at = excluded.provider_event_at,
    outcome = 'processed',
    payload = excluded.payload,
    processed_at = now()
  where private.asaas_webhook_events.outcome = 'unmatched'
    and private.asaas_webhook_events.event_type = excluded.event_type
    and private.asaas_webhook_events.resource_type = excluded.resource_type
    and private.asaas_webhook_events.resource_id = excluded.resource_id;

  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    return jsonb_build_object(
      'outcome', 'duplicate',
      'event_id', v_event_id,
      'checkout_id', v_checkout_id,
      'intent_id', v_intent.id,
      'organization_id', v_intent.organization_id
    );
  end if;

  update private.billing_checkout_intents
  set
    status = case
      when v_event_type in ('CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED')
        and status in ('creating', 'pending')
        then 'cancelled'
      else status
    end,
    cancelled_at = case
      when v_event_type in ('CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED')
        and status in ('creating', 'pending')
        then coalesce(cancelled_at, v_event_at)
      else cancelled_at
    end,
    provider_checkout_id = coalesce(provider_checkout_id, v_checkout_id),
    provider_response = coalesce(provider_response, '{}'::jsonb)
      || p_checkout
      || jsonb_build_object(
        'checkout', p_checkout,
        'checkout_event', v_event_type,
        'checkout_event_at', v_event_at
      ),
    last_error = case
      when v_event_type = 'CHECKOUT_EXPIRED' then 'hosted_checkout_expired'
      when v_event_type = 'CHECKOUT_CANCELED' then 'hosted_checkout_cancelled'
      else last_error
    end,
    updated_at = now()
  where id = v_intent.id;

  return jsonb_build_object(
    'outcome', 'processed',
    'event_id', v_event_id,
    'checkout_id', v_checkout_id,
    'intent_id', v_intent.id,
    'organization_id', v_intent.organization_id,
    'checkout_status', v_event_type
  );
end;
$$;

revoke all on function public.reconcile_asaas_checkout_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) from public, anon, authenticated;
grant execute on function public.reconcile_asaas_checkout_webhook_with_intent(
  text,
  text,
  timestamptz,
  jsonb,
  jsonb
) to service_role;

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

  select array_agg(
    distinct case
      when lower(btrim(module_name)) in ('dashboard', 'leads', 'contacts', 'pipelines') then 'crm'
      else lower(btrim(module_name))
    end
  )
  into v_modules
  from public.admin_subscription_plans plan
  cross join lateral unnest(plan.modules) as module_name
  where plan.id = p_plan_id
    and nullif(btrim(module_name), '') is not null;

  if coalesce(cardinality(v_modules), 0) = 0 then
    v_modules := array['crm', 'agenda', 'whatsapp', 'round_robin']::text[];
  end if;

  select array_agg(distinct module_name)
  into v_modules
  from unnest(
    coalesce(v_modules, array[]::text[])
      || array['crm', 'whatsapp', 'round_robin']::text[]
  ) as required(module_name);

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
        'performance',
        'gamification'
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

comment on column public.admin_subscription_plans.reference_price is
  'Reference price displayed before the current plan price; null means no comparison price.';

comment on column public.admin_subscription_plans.discount_percentage is
  'Promotional discount percentage displayed during plan selection.';

comment on column public.admin_subscription_plans.display_features is
  'Ordered, customer-facing feature labels for onboarding and plan comparison.';

comment on column public.admin_subscription_plans.display_order is
  'Stable display order for public plan selection.';

comment on column public.admin_subscription_plans.billing_periods is
  'Billing periods, in months, available for checkout at the monthly base price.';

comment on column public.organizations.subscription_billing_period_months is
  'Current contracted billing period in months; subscription_value remains the monthly equivalent.';

comment on column public.subscriptions.billing_period_months is
  'Current contracted billing period in months.';

comment on function private.sync_organization_plan_modules(uuid, uuid) is
  'Synchronizes a plan module catalog, including gamification, for one organization.';
