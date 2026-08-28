-- Durable, idempotent plan changes for an existing Asaas subscription.
-- The provider update is performed by the Go settings boundary. This table
-- records the request before the network call and keeps the current plan in
-- force until a matching future payment is confirmed.

create table if not exists private.billing_plan_changes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  from_plan_id uuid not null
    references public.admin_subscription_plans(id) on delete restrict,
  target_plan_id uuid not null
    references public.admin_subscription_plans(id) on delete restrict,
  requested_by uuid references auth.users(id) on delete set null,
  provider_subscription_id text not null,
  billing_period_months integer not null
    check (billing_period_months in (1, 6, 12)),
  amount numeric(12, 2) not null check (amount > 0),
  provider_cycle text not null
    check (provider_cycle in ('MONTHLY', 'SEMIANNUALLY', 'YEARLY')),
  description text not null,
  status text not null default 'provider_updating'
    check (status in (
      'provider_updating',
      'scheduled',
      'applying',
      'applied',
      'failed',
      'cancelled'
    )),
  provider_request_started_at timestamptz not null default now(),
  provider_updated_at timestamptz,
  effective_on date,
  applied_at timestamptz,
  failed_at timestamptz,
  last_error text,
  provider_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_plan_changes_distinct_plans_check
    check (from_plan_id <> target_plan_id),
  constraint billing_plan_changes_provider_subscription_check
    check (nullif(btrim(provider_subscription_id), '') is not null)
);

create unique index if not exists billing_plan_changes_one_active_per_org_idx
  on private.billing_plan_changes (organization_id)
  where status in ('provider_updating', 'scheduled', 'applying');

create index if not exists billing_plan_changes_organization_idx
  on private.billing_plan_changes (organization_id);

create index if not exists billing_plan_changes_provider_due_idx
  on private.billing_plan_changes (
    provider_subscription_id,
    effective_on,
    organization_id
  )
  where status = 'scheduled';

create index if not exists billing_plan_changes_from_plan_idx
  on private.billing_plan_changes (from_plan_id);

create index if not exists billing_plan_changes_target_plan_idx
  on private.billing_plan_changes (target_plan_id);

create index if not exists billing_plan_changes_requested_by_idx
  on private.billing_plan_changes (requested_by);

alter table private.billing_plan_changes enable row level security;
revoke all on table private.billing_plan_changes
  from public, anon, authenticated, service_role;

comment on table private.billing_plan_changes is
  'Server-only state machine for idempotent plan changes on an existing provider subscription.';

-- Preserve the existing billing guard while allowing only the exact managed
-- transition currently being applied by the payment trigger below.
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

  if tg_op = 'UPDATE'
     and old.pending_plan_id is not null
     and new.subscription_status = 'active'
     and not exists (
       select 1
       from private.billing_checkout_intents intent
       where intent.organization_id = old.id
         and intent.pending_plan_id = old.pending_plan_id
         and intent.status = 'confirmed'
     )
     and not exists (
       select 1
       from private.billing_plan_changes plan_change
       where plan_change.organization_id = old.id
         and plan_change.target_plan_id = old.pending_plan_id
         and plan_change.provider_subscription_id = old.asaas_subscription_id
         and plan_change.status = 'applying'
     ) then
    new.subscription_status := old.subscription_status;
    new.subscription_type := old.subscription_type;
    new.plan_id := old.plan_id;
    new.pending_plan_id := old.pending_plan_id;
    new.subscription_value := old.subscription_value;
    new.max_users := old.max_users;
    new.trial_ends_at := old.trial_ends_at;
  end if;

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

create or replace function private.apply_scheduled_billing_plan_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_change private.billing_plan_changes%rowtype;
  v_plan public.admin_subscription_plans%rowtype;
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
    -- The commercial price accepted by the provider is immutable for this
    -- change even if the catalog price changes or the plan is later hidden.
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
    and asaas_subscription_id = v_change.provider_subscription_id;

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
$$;

revoke all on function private.apply_scheduled_billing_plan_change()
  from public, anon, authenticated, service_role;

drop trigger if exists asaas_payments_apply_scheduled_plan_change
  on public.asaas_payments;

create trigger asaas_payments_apply_scheduled_plan_change
after insert or update of
  status,
  value,
  due_date,
  asaas_subscription_id
on public.asaas_payments
for each row
execute function private.apply_scheduled_billing_plan_change();
