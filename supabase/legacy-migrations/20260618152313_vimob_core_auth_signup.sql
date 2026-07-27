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

create table if not exists public.admin_subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  price numeric(12,2) not null default 0,
  billing_cycle text,
  trial_enabled boolean not null default false,
  trial_days integer,
  max_users integer,
  max_leads integer,
  max_whatsapp_sessions integer,
  modules text[] not null default array['crm', 'properties', 'schedule', 'whatsapp', 'financial'],
  is_active boolean not null default true,
  is_public boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_subscription_plans_price_non_negative check (price >= 0),
  constraint admin_subscription_plans_trial_days_non_negative check (trial_days is null or trial_days >= 0)
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  logo_url text,
  theme_mode text not null default 'system',
  accent_color text not null default '#FF4529',
  is_active boolean not null default true,
  segment text not null default 'imobiliario',
  cnpj text,
  creci text,
  inscricao_estadual text,
  razao_social text,
  nome_fantasia text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  telefone text,
  whatsapp text,
  email text,
  website text,
  default_commission_percentage numeric(5,2),
  plan_id uuid references public.admin_subscription_plans(id) on delete set null,
  subscription_status text not null default 'trial',
  subscription_type text,
  subscription_value numeric(12,2),
  trial_ends_at timestamptz,
  next_billing_date date,
  billing_day integer,
  checkout_token text unique default encode(gen_random_bytes(24), 'hex'),
  max_users integer not null default 3,
  max_whatsapp_sessions_override integer,
  is_financial_module_enabled boolean not null default true,
  asaas_customer_id text,
  asaas_subscription_id text,
  asaas_payment_link_id text,
  asaas_payment_link_url text,
  admin_notes text,
  created_by uuid references auth.users(id) on delete set null,
  last_access_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_segment_check check (segment in ('imobiliario', 'servicos', 'optional_modules')),
  constraint organizations_subscription_status_check check (
    subscription_status in ('trial', 'pending_payment', 'active', 'blocked', 'overdue', 'past_due', 'suspended', 'cancelled', 'canceled')
  )
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  name text not null,
  email text not null unique,
  role text not null default 'user',
  avatar_url text,
  is_active boolean not null default true,
  language text default 'pt-BR',
  phone text,
  whatsapp text,
  cpf text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  points integer not null default 0,
  xp integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint users_role_check check (role in ('super_admin', 'admin', 'user'))
);

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null default 'user',
  is_active boolean not null default true,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_members_role_check check (role in ('owner', 'admin', 'manager', 'user')),
  constraint organization_members_unique_user_org unique (organization_id, user_id)
);

create table if not exists public.organization_modules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_name text not null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_modules_unique unique (organization_id, module_name)
);

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

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  value jsonb not null default '{}'::jsonb,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_users_organization_id on public.users(organization_id);
create index if not exists idx_organization_members_user_id on public.organization_members(user_id);
create index if not exists idx_organization_members_organization_id on public.organization_members(organization_id);
create index if not exists idx_subscriptions_organization_id on public.subscriptions(organization_id);
create index if not exists idx_legal_consents_user_id on public.legal_consents(user_id);
create index if not exists idx_audit_logs_organization_id on public.audit_logs(organization_id);
create index if not exists idx_audit_logs_user_id on public.audit_logs(user_id);

drop trigger if exists set_updated_at_admin_subscription_plans on public.admin_subscription_plans;
create trigger set_updated_at_admin_subscription_plans
before update on public.admin_subscription_plans
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_organizations on public.organizations;
create trigger set_updated_at_organizations
before update on public.organizations
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_users on public.users;
create trigger set_updated_at_users
before update on public.users
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_organization_members on public.organization_members;
create trigger set_updated_at_organization_members
before update on public.organization_members
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_organization_modules on public.organization_modules;
create trigger set_updated_at_organization_modules
before update on public.organization_modules
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_subscriptions on public.subscriptions;
create trigger set_updated_at_subscriptions
before update on public.subscriptions
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_system_settings on public.system_settings;
create trigger set_updated_at_system_settings
before update on public.system_settings
for each row execute function private.set_updated_at();

alter table public.admin_subscription_plans enable row level security;
alter table public.organizations enable row level security;
alter table public.users enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_modules enable row level security;
alter table public.subscriptions enable row level security;
alter table public.legal_consents enable row level security;
alter table public.audit_logs enable row level security;
alter table public.system_settings enable row level security;

revoke all on public.admin_subscription_plans from anon, authenticated;
revoke all on public.organizations from anon, authenticated;
revoke all on public.users from anon, authenticated;
revoke all on public.organization_members from anon, authenticated;
revoke all on public.organization_modules from anon, authenticated;
revoke all on public.subscriptions from anon, authenticated;
revoke all on public.legal_consents from anon, authenticated;
revoke all on public.audit_logs from anon, authenticated;
revoke all on public.system_settings from anon, authenticated;

grant select on public.admin_subscription_plans to anon, authenticated;
grant select on public.system_settings to anon, authenticated;
grant select on public.organizations to authenticated;
grant select on public.users to authenticated;
grant update (organization_id, avatar_url, language, phone, whatsapp, cpf, cep, endereco, numero, complemento, bairro, cidade, uf, updated_at) on public.users to authenticated;
grant select, update (updated_at) on public.organization_members to authenticated;
grant select on public.organization_modules to authenticated;
grant select on public.subscriptions to authenticated;
grant select, insert on public.legal_consents to authenticated;
grant select, insert on public.audit_logs to authenticated;

create policy "public can read active public plans"
on public.admin_subscription_plans
for select
using (is_active = true and is_public = true);

create policy "public can read system settings"
on public.system_settings
for select
using (true);

create policy "members can read their organizations"
on public.organizations
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organizations.id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

create policy "users can read own profile"
on public.users
for select
to authenticated
using (id = (select auth.uid()));

create policy "users can update safe own profile columns"
on public.users
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

create policy "users can read own memberships"
on public.organization_members
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users can touch own membership timestamp"
on public.organization_members
for update
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "members can read enabled organization modules"
on public.organization_modules
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organization_modules.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

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

create policy "users can read own legal consents"
on public.legal_consents
for select
to authenticated
using (user_id = (select auth.uid()));

create policy "users can create own legal consents"
on public.legal_consents
for insert
to authenticated
with check (user_id = (select auth.uid()));

create policy "members can read organization audit logs"
on public.audit_logs
for select
to authenticated
using (
  user_id = (select auth.uid())
  or exists (
    select 1
    from public.organization_members om
    where om.organization_id = audit_logs.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin', 'manager')
  )
);

create policy "users can create own audit logs"
on public.audit_logs
for insert
to authenticated
with check (user_id = (select auth.uid()));

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
    'trial-7',
    'Teste gratis',
    'Teste gratuito de 7 dias para validar o Vimob CRM.',
    0,
    'trial',
    true,
    7,
    3,
    500,
    1,
    array['crm', 'properties', 'schedule', 'whatsapp'],
    true,
    true
  ),
  (
    'starter-197',
    'Vimob Starter',
    'Plano inicial para operacao imobiliaria enxuta.',
    197,
    'monthly',
    false,
    null,
    5,
    3000,
    1,
    array['crm', 'properties', 'schedule', 'whatsapp'],
    true,
    true
  ),
  (
    'master-497',
    'Vimob Master',
    'Plano completo para equipes em crescimento.',
    497,
    'monthly',
    false,
    null,
    20,
    20000,
    3,
    array['crm', 'properties', 'schedule', 'whatsapp', 'financial', 'automations'],
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
  is_public = excluded.is_public;

insert into public.system_settings (key, value, description)
values (
  'branding',
  jsonb_build_object(
    'logo_url_light', null,
    'logo_url_dark', null,
    'feature_flags', jsonb_build_object(),
    'maintenance_mode', false
  ),
  'Default global branding and platform settings.'
)
on conflict (key) do nothing;
