create extension if not exists pgcrypto;

create schema if not exists private;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

alter table if exists public.admin_subscription_plans
  add column if not exists slug text,
  add column if not exists is_public boolean not null default true;

alter table if exists public.organizations
  add column if not exists slug text;

create unique index if not exists organizations_slug_unique_idx
  on public.organizations (slug)
  where slug is not null;

update public.admin_subscription_plans
set slug = case
  when slug is not null and btrim(slug) <> '' then slug
  when coalesce(trial_enabled, false) = true and price = 197 then 'starter-197'
  when price = 297 then 'intermediario-297'
  when price = 497 then 'master-497'
  when price = 0 then 'trial'
  else 'plan-' || left(id::text, 8)
end
where slug is null or btrim(slug) = '';

create unique index if not exists admin_subscription_plans_slug_unique_idx
  on public.admin_subscription_plans (slug);

alter table if exists public.admin_subscription_plans
  alter column slug set not null,
  alter column is_public set default true;

insert into public.admin_subscription_plans (
  slug,
  name,
  description,
  price,
  billing_cycle,
  trial_enabled,
  trial_days,
  max_users,
  max_leads,
  max_whatsapp_sessions,
  modules,
  is_active,
  is_public
) values
  (
    'starter-197',
    'Vimob Starter',
    'CRM, agenda, WhatsApp e integracao Meta com 7 dias gratis.',
    197,
    'monthly',
    true,
    7,
    5,
    3000,
    1,
    array['crm', 'agenda', 'whatsapp', 'meta'],
    true,
    true
  ),
  (
    'intermediario-297',
    'Vimob Pro',
    'Tudo do Starter, com controle de imoveis e site publico.',
    297,
    'monthly',
    false,
    null,
    10,
    8000,
    2,
    array['crm', 'agenda', 'whatsapp', 'meta', 'properties', 'site'],
    true,
    true
  ),
  (
    'master-497',
    'Vimob Master',
    'Tudo do Pro, com automacoes e integracoes com portais.',
    497,
    'monthly',
    false,
    null,
    20,
    20000,
    3,
    array['crm', 'agenda', 'whatsapp', 'meta', 'properties', 'site', 'automations', 'webhooks', 'api'],
    true,
    true
  )
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  price = excluded.price,
  billing_cycle = excluded.billing_cycle,
  trial_enabled = excluded.trial_enabled,
  trial_days = excluded.trial_days,
  max_users = excluded.max_users,
  max_leads = excluded.max_leads,
  max_whatsapp_sessions = excluded.max_whatsapp_sessions,
  modules = excluded.modules,
  is_active = excluded.is_active,
  is_public = excluded.is_public,
  updated_at = now();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_id uuid references public.admin_subscription_plans(id) on delete set null,
  status text not null default 'trial',
  provider text,
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  trial_ends_at timestamptz,
  cancel_at timestamptz,
  canceled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscriptions_status_check check (
    status in ('trial', 'pending_payment', 'active', 'blocked', 'overdue', 'past_due', 'suspended', 'cancelled', 'canceled')
  )
);

create table if not exists public.legal_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  accepted_at timestamptz not null default now(),
  ip_address inet,
  user_agent text,
  source text not null default 'signup',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_organization_id
  on public.subscriptions(organization_id);

create index if not exists idx_subscriptions_plan_id
  on public.subscriptions(plan_id);

create index if not exists idx_legal_consents_user_id
  on public.legal_consents(user_id);

create index if not exists idx_legal_consents_organization_id
  on public.legal_consents(organization_id);

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions
before update on public.subscriptions
for each row execute function private.set_updated_at();

alter table if exists public.admin_subscription_plans enable row level security;
alter table if exists public.subscriptions enable row level security;
alter table if exists public.legal_consents enable row level security;

grant select on public.admin_subscription_plans to anon, authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert on public.legal_consents to authenticated;

drop policy if exists "public can read active public plans" on public.admin_subscription_plans;
create policy "public can read active public plans"
on public.admin_subscription_plans
for select
to anon, authenticated
using (coalesce(is_active, true) = true and coalesce(is_public, true) = true);

drop policy if exists "members can read organization subscriptions" on public.subscriptions;
create policy "members can read organization subscriptions"
on public.subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = subscriptions.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

drop policy if exists "users can read own legal consents" on public.legal_consents;
create policy "users can read own legal consents"
on public.legal_consents
for select
to authenticated
using (user_id = (select auth.uid()));

drop policy if exists "users can insert own legal consents" on public.legal_consents;
create policy "users can insert own legal consents"
on public.legal_consents
for insert
to authenticated
with check (user_id = (select auth.uid()));
