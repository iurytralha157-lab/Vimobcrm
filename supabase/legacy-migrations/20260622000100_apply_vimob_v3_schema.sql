-- Vimob CRM v3 schema rollout generated from reviewed drafts.
-- Generated locally for remote push; source drafts remain in supabase/drafts.

-- BEGIN supabase\drafts\20260621_001_security_helpers.sql

-- Vimob CRM - DRAFT ONLY - security helpers and default grants
-- Do not run before review.
-- Purpose:
--   1. centralize organization isolation checks;
--   2. avoid recursive RLS policies on organization_members/users;
--   3. make Data API grants explicit for new Supabase projects.

create extension if not exists pgcrypto;

create schema if not exists private;

revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.available_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  domain text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_roles_unique_name unique (organization_id, name)
);

create table if not exists public.organization_role_permissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role_id uuid not null references public.organization_roles(id) on delete cascade,
  permission_id uuid not null references public.available_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint organization_role_permissions_unique unique (organization_id, role_id, permission_id)
);

create table if not exists public.user_organization_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role_id uuid not null references public.organization_roles(id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_organization_roles_unique unique (organization_id, user_id, role_id)
);

-- Compatibility table used by the current auth/proxy layer for global roles.
-- Organization-scoped permissions stay in organization_roles/user_organization_roles.
create table if not exists public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  role text not null,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint user_roles_unique unique (user_id, role),
  constraint user_roles_role_check check (role in ('super_admin'))
);

create table if not exists public.invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text,
  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  role text not null default 'user',
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invitations_role_check check (role in ('admin', 'manager', 'user'))
);

create or replace function private.current_user_id()
returns uuid
language sql
stable
as $$
  select auth.uid();
$$;

create or replace function private.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.is_active = true
      and u.role = 'super_admin'
  ) or exists (
    select 1
    from public.user_roles ur
    join public.users u on u.id = ur.user_id
    where ur.user_id = auth.uid()
      and ur.role = 'super_admin'
      and u.is_active = true
  );
$$;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.is_active = true
    );
$$;

create or replace function private.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role = any(allowed_roles)
    );
$$;

create or replace function private.has_permission(target_organization_id uuid, permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or exists (
      select 1
      from public.user_organization_roles uor
      join public.organization_role_permissions orp
        on orp.role_id = uor.role_id
       and orp.organization_id = uor.organization_id
      join public.available_permissions ap
        on ap.id = orp.permission_id
      where uor.organization_id = target_organization_id
        and uor.user_id = auth.uid()
        and uor.is_active = true
        and ap.key = permission_key
    )
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role in ('owner', 'admin')
    );
$$;

create or replace function private.can_access_lead(target_organization_id uuid, assigned_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select private.is_super_admin()
    or private.has_permission(target_organization_id, 'lead_view_all')
    or assigned_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_members om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.is_active = true
        and om.role in ('owner', 'admin', 'manager')
    );
$$;

grant execute on function private.current_user_id() to authenticated;
grant execute on function private.is_super_admin() to authenticated;
grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;
grant execute on function private.can_access_lead(uuid, uuid) to authenticated;

create index if not exists idx_organization_roles_org on public.organization_roles(organization_id);
create index if not exists idx_role_permissions_org_role on public.organization_role_permissions(organization_id, role_id);
create index if not exists idx_user_org_roles_user_org on public.user_organization_roles(user_id, organization_id);
create index if not exists idx_user_roles_user_role on public.user_roles(user_id, role);
create index if not exists idx_invitations_org on public.invitations(organization_id, created_at desc);
create index if not exists idx_invitations_token on public.invitations(token) where used_at is null;

drop trigger if exists set_updated_at_organization_roles on public.organization_roles;
create trigger set_updated_at_organization_roles
before update on public.organization_roles
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_user_organization_roles on public.user_organization_roles;
create trigger set_updated_at_user_organization_roles
before update on public.user_organization_roles
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_invitations on public.invitations;
create trigger set_updated_at_invitations
before update on public.invitations
for each row execute function private.set_updated_at();

alter table public.available_permissions enable row level security;
alter table public.organization_roles enable row level security;
alter table public.organization_role_permissions enable row level security;
alter table public.user_organization_roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.invitations enable row level security;

revoke all on public.available_permissions from anon, authenticated;
revoke all on public.organization_roles from anon, authenticated;
revoke all on public.organization_role_permissions from anon, authenticated;
revoke all on public.user_organization_roles from anon, authenticated;
revoke all on public.user_roles from anon, authenticated;
revoke all on public.invitations from anon, authenticated;

grant select on public.available_permissions to authenticated;
grant select on public.organization_roles to authenticated;
grant select on public.organization_role_permissions to authenticated;
grant select on public.user_organization_roles to authenticated;
grant select on public.user_roles to authenticated;
grant insert, update, delete on public.organization_roles to authenticated;
grant insert, update, delete on public.organization_role_permissions to authenticated;
grant insert, update, delete on public.user_organization_roles to authenticated;
grant insert, update, delete on public.user_roles to authenticated;
grant select, insert, update, delete on public.invitations to authenticated;

create policy "members can read permission catalog"
on public.available_permissions
for select
to authenticated
using (true);

create policy "members can read organization roles"
on public.organization_roles
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "admins can manage organization roles"
on public.organization_roles
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy "members can read role permissions"
on public.organization_role_permissions
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "admins can manage role permissions"
on public.organization_role_permissions
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy "members can read user organization roles"
on public.user_organization_roles
for select
to authenticated
using (private.is_org_member(organization_id));

create policy "admins can manage user organization roles"
on public.user_organization_roles
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_org_role(organization_id, array['owner', 'admin']));

create policy "users can read own global role"
on public.user_roles
for select
to authenticated
using (user_id = auth.uid() or private.is_super_admin());

create policy "super admins manage global roles"
on public.user_roles
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

create policy "admins can manage invitations"
on public.invitations
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_org_role(organization_id, array['owner', 'admin']));

create or replace function public.get_invitation_by_token(p_token text)
returns table(
  id uuid,
  email text,
  role text,
  organization_id uuid,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.email, i.role, i.organization_id, i.expires_at
  from public.invitations i
  where i.token = p_token
    and i.used_at is null
    and i.expires_at > now()
  limit 1
$$;

grant execute on function public.get_invitation_by_token(text) to anon, authenticated;

insert into public.available_permissions (key, label, domain, description) values
  ('lead_view_all', 'Ver todos os leads', 'crm', 'Permite visualizar leads da organização além dos próprios.'),
  ('lead_view_own', 'Ver leads próprios', 'crm', 'Permite visualizar leads atribuídos ao próprio usuário.'),
  ('lead_view_team', 'Ver leads da equipe', 'crm', 'Permite visualizar leads dos membros das equipes lideradas.'),
  ('lead_edit', 'Editar leads', 'crm', 'Permite editar leads permitidos pelo escopo do usuário.'),
  ('lead_edit_all', 'Editar todos os leads', 'crm', 'Permite editar todos os leads da organização.'),
  ('lead_delete', 'Excluir leads', 'crm', 'Permite excluir leads conforme política da organização.'),
  ('lead_assign', 'Atribuir leads', 'crm', 'Permite atribuir leads a usuários.'),
  ('lead_transfer', 'Transferir leads', 'crm', 'Permite transferir leads entre usuários e equipes.'),
  ('lead_manage', 'Gerenciar leads', 'crm', 'Permite criar, editar, mover e descartar leads.'),
  ('pipeline_lock', 'Bloquear pipelines', 'crm', 'Permite travar movimentações e regras de pipelines.'),
  ('property_manage', 'Gerenciar imóveis', 'properties', 'Permite criar e editar imóveis.'),
  ('whatsapp_manage', 'Gerenciar WhatsApp', 'communications', 'Permite administrar sessões e regras WhatsApp.'),
  ('financial_manage', 'Gerenciar financeiro', 'financial', 'Permite gerenciar contratos, comissões e contas.'),
  ('settings_manage', 'Gerenciar configurações', 'settings', 'Permite alterar configurações da organização.'),
  ('automations_view', 'Visualizar automações', 'automations', 'Permite visualizar automações.'),
  ('automations_edit', 'Editar automações', 'automations', 'Permite criar e editar automações.'),
  ('gamification_manage', 'Gerenciar arena', 'gamification', 'Permite configurar gamificação.')
on conflict (key) do update set
  label = excluded.label,
  domain = excluded.domain,
  description = excluded.description;

-- Recommended default stance for exposed public schema.
-- Review before applying to an existing project because it can affect old tables/functions.
-- alter default privileges for role postgres in schema public
--   revoke all on tables from anon, authenticated;
-- alter default privileges for role postgres in schema public
--   revoke all on sequences from anon, authenticated;
-- alter default privileges for role postgres in schema public
--   revoke execute on functions from anon, authenticated;


-- END supabase\drafts\20260621_001_security_helpers.sql

-- BEGIN supabase\drafts\20260621_002_crm_core.sql

-- Vimob CRM - DRAFT ONLY - CRM, leads, pipelines, teams and distribution
-- Do not run before review.
-- Pages covered:
--   /dashboard
--   /crm/pipelines
--   /crm/contacts
--   /crm/management?tab=teams
--   /crm/management?tab=distribution
--   /crm/management?tab=pipelines
--   /crm/management?tab=tags

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  position integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  stage_key text,
  color text,
  position integer not null default 0,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  sla_hours integer,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#FF4529',
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tags_unique_name unique (organization_id, name)
);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  assigned_at timestamptz,
  property_id uuid,
  interest_property_id uuid,
  interest_plan_id uuid,
  name text not null,
  email text,
  phone text,
  whatsapp text,
  whatsapp_avatar_url text,
  whatsapp_avatar_synced_at timestamptz,
  whatsapp_verified boolean,
  property_code text,
  message text,
  initial_message text,
  source text not null default 'manual',
  source_detail text,
  source_session_id text,
  source_webhook_id uuid,
  visitor_session_id text,
  meta_lead_id text,
  meta_form_id text,
  meta_campaign_id text,
  meta_adset_id text,
  meta_ad_id text,
  meta_click_id text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  status text not null default 'new',
  deal_status text not null default 'open',
  lost_reason text,
  feedback text,
  valor_interesse numeric(14,2),
  commission_percentage numeric(5,2),
  faixa_valor_imovel text,
  renda_familiar text,
  finalidade_compra text,
  procura_financiamento boolean,
  trabalha boolean,
  cargo text,
  empresa text,
  profissao text,
  cep text,
  endereco text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  is_own_resource boolean,
  priority text default 'normal',
  first_touch_at timestamptz,
  first_touch_seconds integer,
  first_touch_channel text,
  first_touch_actor_user_id uuid references public.users(id) on delete set null,
  first_response_at timestamptz,
  first_response_seconds integer,
  first_response_channel text,
  first_response_is_automation boolean,
  first_response_actor_user_id uuid references public.users(id) on delete set null,
  stage_entered_at timestamptz,
  last_entry_at timestamptz,
  reentry_count integer not null default 0,
  redistribution_count integer not null default 0,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_deal_status_check check (deal_status in ('open', 'won', 'lost')),
  constraint leads_priority_check check (priority in ('low', 'normal', 'high', 'urgent'))
);

create table if not exists public.lead_meta (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  platform text,
  campaign_id text,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  form_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_meta_unique_lead unique (lead_id)
);

create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint lead_tags_unique unique (lead_id, tag_id)
);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_user_id uuid references public.users(id) on delete set null,
  title text not null,
  description text,
  type text not null default 'call',
  day_offset integer not null default 0,
  due_at timestamptz,
  due_date timestamptz,
  is_done boolean not null default false,
  done_at timestamptz,
  done_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  outcome text,
  outcome_notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  type text not null,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  type text,
  event_type text not null,
  label text,
  title text,
  content text,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  property_id uuid,
  session_id text,
  event_type text not null,
  value numeric(14,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_entry_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  source text not null,
  entry_type text,
  property_id uuid,
  valor_interesse numeric(14,2),
  campaign_name text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.lead_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  uploaded_by uuid references public.users(id) on delete set null,
  file_name text not null,
  file_type text,
  storage_bucket text not null,
  storage_path text not null,
  public_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  logo_url text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_unique_name unique (organization_id, name)
);

create table if not exists public.team_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  is_leader boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint team_members_unique unique (team_id, user_id)
);

create table if not exists public.team_pipelines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint team_pipelines_unique unique (team_id, pipeline_id)
);

create table if not exists public.member_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  team_member_id uuid not null references public.team_members(id) on delete cascade,
  day_of_week integer not null,
  start_time time,
  end_time time,
  is_all_day boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_availability_day_check check (day_of_week between 0 and 6),
  constraint member_availability_unique unique (team_member_id, day_of_week)
);

create table if not exists public.round_robins (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  team_id uuid references public.teams(id) on delete set null,
  is_active boolean not null default true,
  current_position integer not null default 0,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_robin_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  weight integer not null default 1,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint round_robin_members_unique unique (round_robin_id, user_id)
);

create table if not exists public.round_robin_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid references public.round_robins(id) on delete cascade,
  name text not null,
  conditions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  priority integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.round_robin_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  round_robin_id uuid references public.round_robins(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.assignments_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  old_user_id uuid references public.users(id) on delete set null,
  new_user_id uuid references public.users(id) on delete set null,
  reason text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pipeline_sla_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete cascade,
  target_hours integer not null default 24,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stage_operational_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stage_operational_configs_unique unique (stage_id)
);

create table if not exists public.stage_automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  automation_id uuid,
  trigger_type text not null,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadence_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid references public.pipelines(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete cascade,
  stage_key text,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cadence_tasks_template (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cadence_template_id uuid not null references public.cadence_templates(id) on delete cascade,
  title text not null,
  type text not null default 'call',
  delay_days integer not null default 0,
  position integer not null default 0,
  message_template text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pipelines_org on public.pipelines(organization_id, position);
create index if not exists idx_stages_pipeline on public.stages(pipeline_id, position);
create index if not exists idx_leads_org_stage on public.leads(organization_id, stage_id);
create index if not exists idx_leads_assigned_user on public.leads(assigned_user_id);
create index if not exists idx_leads_stage_entered_at on public.leads(stage_id, stage_entered_at desc);
create index if not exists idx_leads_interest_property on public.leads(interest_property_id);
create index if not exists idx_lead_meta_lead on public.lead_meta(lead_id);
create index if not exists idx_lead_tasks_lead on public.lead_tasks(lead_id, is_done, due_date);
create index if not exists idx_activities_lead on public.activities(lead_id, created_at desc);
create index if not exists idx_lead_timeline_events_lead on public.lead_timeline_events(lead_id, created_at desc);
create index if not exists idx_team_members_team on public.team_members(team_id);
create index if not exists idx_round_robin_members_rr on public.round_robin_members(round_robin_id);

create or replace function private.set_lead_child_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_organization_id uuid;
begin
  select l.organization_id
    into resolved_organization_id
  from public.leads l
  where l.id = new.lead_id;

  if resolved_organization_id is null then
    raise exception 'Lead nao encontrado para preencher organization_id.';
  end if;

  new.organization_id = resolved_organization_id;
  return new;
end;
$$;

create or replace function private.set_member_availability_organization_id()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_organization_id uuid;
begin
  select tm.organization_id
    into resolved_organization_id
  from public.team_members tm
  where tm.id = new.team_member_id;

  if resolved_organization_id is null then
    raise exception 'Membro de equipe nao encontrado para preencher organization_id.';
  end if;

  new.organization_id = resolved_organization_id;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments'
  ]
  loop
    execute format('drop trigger if exists %I on public.%I', 'set_' || t || '_organization_id', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function private.set_lead_child_organization_id()', 'set_' || t || '_organization_id', t);
  end loop;
end $$;

drop trigger if exists set_member_availability_organization_id on public.member_availability;
create trigger set_member_availability_organization_id
before insert or update on public.member_availability
for each row execute function private.set_member_availability_organization_id();

do $$
declare
  t text;
begin
  foreach t in array array[
    'pipelines', 'stages', 'tags', 'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments',
    'teams', 'team_members', 'team_pipelines', 'member_availability', 'round_robins',
    'round_robin_members', 'round_robin_rules', 'round_robin_logs', 'assignments_log',
    'pipeline_sla_settings', 'stage_operational_configs', 'stage_automations',
    'cadence_templates', 'cadence_tasks_template'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_org_role(organization_id, array[''owner'', ''admin'', ''manager''])) with check (private.has_org_role(organization_id, array[''owner'', ''admin'', ''manager'']))', 'admins manage ' || t, t);
  end loop;
end $$;

alter table public.leads enable row level security;
grant select, insert, update, delete on public.leads to authenticated;

drop policy if exists "users can read permitted leads" on public.leads;
create policy "users can read permitted leads"
on public.leads
for select
to authenticated
using (private.can_access_lead(organization_id, assigned_user_id));

drop policy if exists "members can create leads" on public.leads;
create policy "members can create leads"
on public.leads
for insert
to authenticated
with check (private.is_org_member(organization_id));

drop policy if exists "users can update permitted leads" on public.leads;
create policy "users can update permitted leads"
on public.leads
for update
to authenticated
using (
  private.has_permission(organization_id, 'lead_manage')
  or assigned_user_id = auth.uid()
)
with check (
  private.has_permission(organization_id, 'lead_manage')
  or assigned_user_id = auth.uid()
);

drop policy if exists "admins can delete leads" on public.leads;
create policy "admins can delete leads"
on public.leads
for delete
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']));

do $$
declare
  t text;
begin
  foreach t in array array[
    'lead_meta', 'lead_tags', 'lead_tasks', 'activities',
    'lead_timeline_events', 'lead_events', 'lead_entry_events', 'lead_attachments'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'admins manage ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'users read permitted ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'users manage permitted ' || t, t);

    execute format(
      'create policy %I on public.%I for select to authenticated using (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and private.can_access_lead(l.organization_id, l.assigned_user_id)
        )
      )',
      'users read permitted ' || t,
      t,
      t
    );

    execute format(
      'create policy %I on public.%I for all to authenticated using (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and (
              private.has_permission(l.organization_id, ''lead_manage'')
              or l.assigned_user_id = auth.uid()
              or private.has_org_role(l.organization_id, array[''owner'', ''admin'', ''manager''])
            )
        )
      ) with check (
        exists (
          select 1
          from public.leads l
          where l.id = %I.lead_id
            and (
              private.has_permission(l.organization_id, ''lead_manage'')
              or l.assigned_user_id = auth.uid()
              or private.has_org_role(l.organization_id, array[''owner'', ''admin'', ''manager''])
            )
        )
      )',
      'users manage permitted ' || t,
      t,
      t,
      t
    );
  end loop;
end $$;


-- END supabase\drafts\20260621_002_crm_core.sql

-- BEGIN supabase\drafts\20260621_003_properties_public_site.sql

-- Vimob CRM - DRAFT ONLY - properties, locations and public site dependencies
-- Do not run before review.
-- Pages covered:
--   /properties
--   /properties/new
--   /properties/[id]/edit
--   /properties/locations
--   /properties/rentals
--   /properties/condominiums
--   /settings/site and its tabs

create table if not exists public.property_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  category text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint property_types_unique unique (organization_id, name)
);

create table if not exists public.property_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_value bigint not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists public.property_cities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  uf text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_cities_unique unique (organization_id, name, uf)
);

create table if not exists public.property_neighborhoods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  city_id uuid references public.property_cities(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_neighborhoods_unique unique (organization_id, city_id, name)
);

create table if not exists public.property_condominiums (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  city_id uuid references public.property_cities(id) on delete set null,
  neighborhood_id uuid references public.property_neighborhoods(id) on delete set null,
  name text not null,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_condominiums_unique unique (organization_id, name)
);

create table if not exists public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text,
  referencia_alternativa text,
  title text not null,
  property_type_id uuid references public.property_types(id) on delete set null,
  tipo text,
  finalidade text not null default 'venda',
  status text not null default 'draft',
  responsible_user_id uuid references public.users(id) on delete set null,
  owner_name text,
  owner_email text,
  owner_phone_residential text,
  owner_phone_commercial text,
  owner_cellphone text,
  origin_media text,
  uf text,
  cidade text,
  bairro text,
  endereco text,
  numero text,
  complemento text,
  cep text,
  latitude numeric(10,7),
  longitude numeric(10,7),
  address_visibility text not null default 'full',
  city_id uuid references public.property_cities(id) on delete set null,
  neighborhood_id uuid references public.property_neighborhoods(id) on delete set null,
  condominium_id uuid references public.property_condominiums(id) on delete set null,
  preco numeric(14,2),
  valor_locacao numeric(14,2),
  condominio numeric(14,2),
  iptu numeric(14,2),
  taxa_de_servico numeric(14,2),
  valor_itr numeric(14,2),
  valor_seguro_fianca numeric(14,2),
  seguro_incendio numeric(14,2),
  quartos integer,
  suites integer,
  banheiros integer,
  vagas integer,
  area_util numeric(12,2),
  area_total numeric(12,2),
  andar integer,
  ano_construcao integer,
  ano_reforma integer,
  mobiliado boolean not null default false,
  aceita_financiamento boolean not null default false,
  aceita_permuta boolean not null default false,
  is_featured boolean not null default false,
  published_on_site boolean not null default false,
  published_at timestamptz,
  video_imovel text,
  tour_virtual text,
  descricao text,
  descricao_site text,
  image_urls text[] not null default '{}',
  documents jsonb not null default '{}'::jsonb,
  comissao_venda numeric(5,2),
  comissao_locacao numeric(5,2),
  condicao_comercial text,
  codigo_iptu text,
  numero_matricula text,
  codigo_eletricidade text,
  codigo_agua text,
  status_descritivo text,
  aprovacao_ambiental text,
  observacoes_documentacao text,
  comentarios_internos text,
  local_chaves text,
  external_provider text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint properties_status_check check (status in ('draft', 'active', 'sold', 'rented', 'inactive', 'archived')),
  constraint properties_finalidade_check check (finalidade in ('venda', 'locacao', 'temporada', 'venda_locacao'))
);

create table if not exists public.property_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  category text,
  created_at timestamptz not null default now(),
  constraint property_features_unique unique (property_id, name)
);

create table if not exists public.property_proximities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null,
  distance text,
  category text,
  created_at timestamptz not null default now()
);

create table if not exists public.vista_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  api_url text not null,
  api_key_secret_ref text not null,
  status text not null default 'pending',
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.imoview_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  api_key_secret_ref text not null,
  status text not null default 'pending',
  last_sync_at timestamptz,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_properties_org_status on public.properties(organization_id, status);
create index if not exists idx_properties_responsible on public.properties(responsible_user_id);
create index if not exists idx_properties_location on public.properties(organization_id, cidade, bairro);
create index if not exists idx_properties_public on public.properties(organization_id, published_on_site, status);
create index if not exists idx_property_features_property on public.property_features(property_id);
create index if not exists idx_property_proximities_property on public.property_proximities(property_id);

do $$
declare
  t text;
begin
  foreach t in array array[
    'property_types', 'property_sequences', 'property_cities', 'property_neighborhoods',
    'property_condominiums', 'property_features', 'property_proximities',
    'vista_integrations', 'imoview_integrations'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'property admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''property_manage'')) with check (private.has_permission(organization_id, ''property_manage''))', 'property admins manage ' || t, t);
  end loop;
end $$;

alter table public.properties enable row level security;
grant select, insert, update, delete on public.properties to authenticated;
grant select (
  id,
  organization_id,
  code,
  title,
  property_type_id,
  tipo,
  finalidade,
  status,
  uf,
  cidade,
  bairro,
  city_id,
  neighborhood_id,
  condominium_id,
  preco,
  valor_locacao,
  condominio,
  iptu,
  quartos,
  suites,
  banheiros,
  vagas,
  area_util,
  area_total,
  andar,
  ano_construcao,
  ano_reforma,
  mobiliado,
  aceita_financiamento,
  aceita_permuta,
  is_featured,
  published_on_site,
  published_at,
  video_imovel,
  tour_virtual,
  descricao_site,
  image_urls,
  external_provider,
  external_id,
  created_at,
  updated_at
) on public.properties to anon;

drop policy if exists "public can read published properties" on public.properties;
create policy "public can read published properties"
on public.properties
for select
to anon
using (published_on_site = true and status = 'active');

drop policy if exists "members can read organization properties" on public.properties;
create policy "members can read organization properties"
on public.properties
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "property managers can create properties" on public.properties;
create policy "property managers can create properties"
on public.properties
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers and responsible can update properties" on public.properties;
create policy "property managers and responsible can update properties"
on public.properties
for update
to authenticated
using (
  private.has_permission(organization_id, 'property_manage')
  or responsible_user_id = auth.uid()
)
with check (
  private.has_permission(organization_id, 'property_manage')
  or responsible_user_id = auth.uid()
);

drop policy if exists "admins can delete properties" on public.properties;
create policy "admins can delete properties"
on public.properties
for delete
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']));

-- Public site tables already exist in a local migration. Keep this draft as review note:
--   organization_sites
--   site_menu_items
--   site_search_filters
--   site_analytics_events
-- Required review: ensure anon policies only expose active/published site data.

-- Public site hardening over the existing migration:
-- The authenticated app can manage/read the full site settings, but anon should only
-- see presentation fields needed to render the public website.
revoke select on public.organization_sites from anon;
grant select (
  id,
  organization_id,
  is_active,
  subdomain,
  custom_domain,
  site_title,
  site_description,
  logo_url,
  favicon_url,
  primary_color,
  secondary_color,
  accent_color,
  whatsapp,
  phone,
  email,
  address,
  city,
  state,
  instagram,
  facebook,
  youtube,
  linkedin,
  about_title,
  about_text,
  about_image_url,
  seo_title,
  seo_description,
  seo_keywords,
  google_analytics_id,
  hero_image_url,
  hero_title,
  hero_subtitle,
  page_banner_url,
  logo_width,
  logo_height,
  watermark_enabled,
  watermark_opacity,
  watermark_logo_url,
  watermark_size,
  watermark_position,
  site_theme,
  background_color,
  text_color,
  card_color,
  show_about_on_home,
  about_subtitle,
  about_stats,
  about_checkmarks,
  about_features,
  gtm_id,
  meta_pixel_id,
  google_ads_id,
  updated_at
) on public.organization_sites to anon;


-- END supabase\drafts\20260621_003_properties_public_site.sql

-- BEGIN supabase\drafts\20260621_004_communications_integrations.sql

-- Vimob CRM - DRAFT ONLY - WhatsApp/Evolution, Meta, notifications and integrations
-- Do not run before review.
-- Pages covered:
--   /crm/conversas
--   /settings?tab=whatsapp
--   /settings/whatsapp/inbound-rules
--   /settings/integrations/meta
--   notifications and push flows
--
-- Security principle:
--   Provider tokens, API keys and Evolution secrets should stay in Edge Functions/backend.
--   Client tables store safe identifiers/status and user-visible data only.

create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  provider text not null default 'evolution_go',
  provider_instance_id text,
  phone_number text,
  status text not null default 'disconnected',
  qr_code text,
  last_connected_at timestamptz,
  last_error text,
  created_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_sessions_status_check check (status in ('disconnected', 'connecting', 'connected', 'error', 'disabled'))
);

create table if not exists public.whatsapp_session_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid not null references public.whatsapp_sessions(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  can_read boolean not null default true,
  can_send boolean not null default false,
  created_at timestamptz not null default now(),
  constraint whatsapp_session_access_unique unique (session_id, user_id)
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  remote_jid text not null,
  contact_name text,
  contact_phone text,
  contact_picture text,
  contact_presence text,
  presence_updated_at timestamptz,
  is_group boolean not null default false,
  is_archived boolean not null default false,
  archived_at timestamptz,
  deleted_at timestamptz,
  unread_count integer not null default 0,
  last_message text,
  last_message_at timestamptz,
  last_message_preview text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_conversations_unique_remote unique (organization_id, session_id, remote_jid)
);

create table if not exists public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  sender_user_id uuid references public.users(id) on delete set null,
  provider_message_id text,
  message_id text,
  client_message_id text,
  from_me boolean not null default false,
  direction text not null default 'inbound',
  message_type text not null default 'text',
  content text,
  media_url text,
  media_mime_type text,
  media_storage_path text,
  media_status text,
  media_error text,
  media_size bigint,
  remote_jid text,
  reaction_to_message_id text,
  reaction_emoji text,
  reaction_sender_jid text,
  reaction_sender_name text,
  status text not null default 'received',
  error_message text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  received_at timestamptz,
  sender_jid text,
  sender_name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint whatsapp_messages_direction_check check (direction in ('inbound', 'outbound')),
  constraint whatsapp_messages_status_check check (status in ('draft', 'queued', 'pending', 'sent', 'delivered', 'read', 'received', 'failed', 'error')),
  constraint whatsapp_messages_unique_provider unique (conversation_id, message_id)
);

create table if not exists public.whatsapp_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete set null,
  remote_jid text not null,
  name text,
  picture_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_groups_unique unique (organization_id, session_id, remote_jid)
);

create table if not exists public.whatsapp_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#FF4529',
  created_at timestamptz not null default now(),
  constraint whatsapp_labels_unique unique (organization_id, name)
);

create table if not exists public.whatsapp_chat_labels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  label_id uuid not null references public.whatsapp_labels(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint whatsapp_chat_labels_unique unique (conversation_id, label_id)
);

create table if not exists public.whatsapp_message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  content text not null,
  variables text[] not null default '{}',
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.whatsapp_inbound_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  session_id uuid references public.whatsapp_sessions(id) on delete cascade,
  name text not null,
  match_type text not null default 'all',
  conditions jsonb not null default '{}'::jsonb,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  priority integer not null default 0,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.meta_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_type text not null default 'facebook_leads',
  page_id text,
  page_name text,
  page_picture_url text,
  facebook_user_id text,
  facebook_user_name text,
  instagram_business_account_id text,
  instagram_username text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  ad_account_id text,
  selected_ad_accounts jsonb not null default '[]'::jsonb,
  form_ids jsonb,
  field_mapping jsonb,
  campaign_property_mapping jsonb,
  default_status text,
  is_connected boolean not null default false,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  last_sync_at timestamptz,
  last_validated_at timestamptz,
  webhook_subscribed_at timestamptz,
  token_status text,
  token_expires_at timestamptz,
  health_status text,
  last_error text,
  access_token_secret_ref text,
  user_token_secret_ref text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_integrations_unique_page unique (organization_id, page_id)
);

create table if not exists public.meta_form_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  integration_id uuid references public.meta_integrations(id) on delete cascade,
  page_id text,
  form_id text not null,
  form_name text,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  default_status text,
  assigned_user_id uuid references public.users(id) on delete set null,
  round_robin_id uuid references public.round_robins(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  purpose text,
  source text,
  source_details text,
  default_values jsonb not null default '{}'::jsonb,
  auto_tags jsonb not null default '[]'::jsonb,
  field_mapping jsonb not null default '{}'::jsonb,
  custom_fields_config jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  created_by uuid references public.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_form_configs_unique unique (organization_id, form_id)
);

create or replace view public.meta_integrations_public
with (security_invoker = true)
as
select
  id,
  organization_id,
  integration_type,
  page_id,
  page_name,
  page_picture_url,
  facebook_user_id,
  facebook_user_name,
  instagram_business_account_id,
  instagram_username,
  pipeline_id,
  stage_id,
  assigned_user_id,
  ad_account_id,
  selected_ad_accounts,
  form_ids,
  field_mapping,
  campaign_property_mapping,
  default_status,
  is_connected,
  leads_received,
  last_lead_at,
  last_sync_at,
  last_validated_at,
  webhook_subscribed_at,
  token_status,
  token_expires_at,
  health_status,
  last_error,
  created_at,
  updated_at
from public.meta_integrations;

create table if not exists public.meta_webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  object_type text,
  event_type text,
  provider_event_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_campaign_insights (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id text not null,
  campaign_name text,
  adset_id text,
  adset_name text,
  ad_id text,
  ad_name text,
  spend numeric(14,2),
  impressions integer,
  clicks integer,
  leads_count integer,
  date_start date,
  date_stop date,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.meta_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  page_id text not null,
  provider_conversation_id text not null,
  lead_id uuid references public.leads(id) on delete set null,
  contact_name text,
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meta_conversations_unique unique (organization_id, page_id, provider_conversation_id)
);

create table if not exists public.meta_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.meta_conversations(id) on delete cascade,
  provider_message_id text,
  direction text not null,
  content text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.webhooks_integrations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null default 'incoming',
  provider text not null default 'custom',
  direction text not null default 'incoming',
  api_token text,
  webhook_url text,
  target_pipeline_id uuid references public.pipelines(id) on delete set null,
  target_team_id uuid references public.teams(id) on delete set null,
  target_stage_id uuid references public.stages(id) on delete set null,
  target_tag_ids uuid[] not null default '{}',
  target_property_id uuid references public.properties(id) on delete set null,
  field_mapping jsonb not null default '{}'::jsonb,
  leads_received integer not null default 0,
  last_lead_at timestamptz,
  last_triggered_at timestamptz,
  trigger_events text[] not null default '{}',
  secret_ref text,
  config jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint webhooks_integrations_type_check check (type in ('incoming', 'outgoing')),
  constraint webhooks_integrations_direction_check check (direction in ('incoming', 'outgoing'))
);

create table if not exists public.google_calendar_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  account_email text,
  token_secret_ref text not null,
  scopes text[] not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint google_calendar_tokens_unique unique (organization_id, user_id, account_email)
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  title text not null,
  content text,
  body text,
  type text not null default 'info',
  channel text not null default 'in_app',
  lead_id uuid references public.leads(id) on delete set null,
  target_url text,
  is_read boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null,
  p256dh text,
  auth text,
  user_agent text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_tokens_unique unique (user_id, endpoint)
);

create index if not exists idx_whatsapp_conversations_org_session on public.whatsapp_conversations(organization_id, session_id);
create index if not exists idx_whatsapp_messages_conversation on public.whatsapp_messages(conversation_id, created_at desc);
create index if not exists idx_notifications_user_unread on public.notifications(user_id, is_read, created_at desc);
create index if not exists idx_meta_integrations_org on public.meta_integrations(organization_id, created_at desc);
create index if not exists idx_meta_integrations_page on public.meta_integrations(organization_id, page_id);
create index if not exists idx_meta_form_configs_integration on public.meta_form_configs(integration_id, is_active);
create index if not exists idx_meta_webhook_events_created on public.meta_webhook_events(created_at desc);

create or replace function private.set_whatsapp_message_defaults()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  conversation_org_id uuid;
begin
  select c.organization_id
    into conversation_org_id
  from public.whatsapp_conversations c
  where c.id = new.conversation_id;

  if conversation_org_id is null then
    raise exception 'Conversa WhatsApp nao encontrada para preencher organization_id.';
  end if;

  new.organization_id = conversation_org_id;
  new.direction = case when new.from_me then 'outbound' else 'inbound' end;
  new.message_id = coalesce(new.message_id, new.client_message_id, gen_random_uuid()::text);
  new.provider_message_id = coalesce(new.provider_message_id, new.message_id);
  return new;
end;
$$;

drop trigger if exists set_whatsapp_message_defaults on public.whatsapp_messages;
create trigger set_whatsapp_message_defaults
before insert or update on public.whatsapp_messages
for each row execute function private.set_whatsapp_message_defaults();

drop trigger if exists set_updated_at_meta_integrations on public.meta_integrations;
create trigger set_updated_at_meta_integrations
before update on public.meta_integrations
for each row execute function private.set_updated_at();

drop trigger if exists set_updated_at_meta_form_configs on public.meta_form_configs;
create trigger set_updated_at_meta_form_configs
before update on public.meta_form_configs
for each row execute function private.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'whatsapp_sessions', 'whatsapp_session_access', 'whatsapp_conversations',
    'whatsapp_messages', 'whatsapp_groups', 'whatsapp_labels', 'whatsapp_chat_labels',
    'whatsapp_message_templates', 'whatsapp_inbound_rules', 'meta_form_configs',
    'meta_campaign_insights', 'meta_conversations', 'meta_messages',
    'webhooks_integrations', 'google_calendar_tokens'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'communication admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''whatsapp_manage'') or private.has_permission(organization_id, ''settings_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''whatsapp_manage'') or private.has_permission(organization_id, ''settings_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'communication admins manage ' || t, t);
  end loop;
end $$;

alter table public.meta_integrations enable row level security;
alter table public.notifications enable row level security;
alter table public.push_tokens enable row level security;
alter table public.meta_webhook_events enable row level security;

revoke all on public.meta_integrations from anon, authenticated;
grant select (
  id,
  organization_id,
  integration_type,
  page_id,
  page_name,
  page_picture_url,
  facebook_user_id,
  facebook_user_name,
  instagram_business_account_id,
  instagram_username,
  pipeline_id,
  stage_id,
  assigned_user_id,
  ad_account_id,
  selected_ad_accounts,
  form_ids,
  field_mapping,
  campaign_property_mapping,
  default_status,
  is_connected,
  leads_received,
  last_lead_at,
  last_sync_at,
  last_validated_at,
  webhook_subscribed_at,
  token_status,
  token_expires_at,
  health_status,
  last_error,
  created_at,
  updated_at
) on public.meta_integrations to authenticated;
grant select on public.meta_integrations_public to authenticated;
grant select, update on public.notifications to authenticated;
grant insert on public.notifications to authenticated;
grant select, insert, update, delete on public.push_tokens to authenticated;
grant select on public.meta_webhook_events to authenticated;

drop policy if exists "members read safe meta integration columns" on public.meta_integrations;
create policy "members read safe meta integration columns"
on public.meta_integrations
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "backend manages meta integrations" on public.meta_integrations;
create policy "backend manages meta integrations"
on public.meta_integrations
for all
to service_role
using (true)
with check (true);

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications"
on public.notifications
for select
to authenticated
using (user_id = auth.uid() or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "users update own notifications" on public.notifications;
create policy "users update own notifications"
on public.notifications
for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "system members can create notifications" on public.notifications;
create policy "system members can create notifications"
on public.notifications
for insert
to authenticated
with check (
  user_id = auth.uid()
  or private.has_org_role(organization_id, array['owner', 'admin'])
);

drop policy if exists "users manage own push tokens" on public.push_tokens;
create policy "users manage own push tokens"
on public.push_tokens
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "admins read meta webhook events" on public.meta_webhook_events;
create policy "admins read meta webhook events"
on public.meta_webhook_events
for select
to authenticated
using (organization_id is null or private.has_org_role(organization_id, array['owner', 'admin']));

-- No automatic lead notification/send policy:
-- notifications are internal user notifications only. Outbound WhatsApp must pass through backend/outbox.


-- END supabase\drafts\20260621_004_communications_integrations.sql

-- BEGIN supabase\drafts\20260621_005_schedule_financial.sql

-- Vimob CRM - DRAFT ONLY - Schedule, financial, contracts, commissions and DRE
-- Do not run before review.
-- Pages covered:
--   /agenda
--   /financeiro
--   /financeiro/contas
--   /financeiro/contratos
--   /financeiro/contratos/[id]
--   /financeiro/comissoes
--   /financeiro/corretor
--   /financeiro/dre
--
-- Security principle:
--   Agenda can be visible to organization members, but private events only to participants/admins.
--   Financial data is restricted to financial managers, owners/admins and the broker's own commissions.

create table if not exists public.schedule_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  property_id uuid references public.properties(id) on delete set null,
  title text not null,
  description text,
  event_type text not null default 'task',
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_all_day boolean not null default false,
  location text,
  status text not null default 'scheduled',
  visibility text not null default 'default',
  reminder_minutes integer,
  recurrence_parent_id uuid references public.schedule_events(id) on delete cascade,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid references public.users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint schedule_events_type_check check (event_type in ('call', 'email', 'meeting', 'task', 'message', 'visit')),
  constraint schedule_events_status_check check (status in ('scheduled', 'completed', 'cancelled', 'canceled', 'no_show')),
  constraint schedule_events_visibility_check check (visibility in ('default', 'public', 'private')),
  constraint schedule_events_time_check check (end_time >= start_time)
);

create table if not exists public.schedule_event_assignees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint schedule_event_assignees_unique unique (event_id, user_id)
);

create table if not exists public.schedule_event_comments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_id uuid not null references public.schedule_events(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.financial_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  type text not null,
  category_group text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_categories_type_check check (type in ('income', 'expense')),
  constraint financial_categories_unique unique (organization_id, name, type)
);

create table if not exists public.contract_sequences (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_number text,
  contract_type text,
  status text not null default 'draft',
  property_id uuid references public.properties(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  value numeric(14,2),
  commission_percentage numeric(7,4),
  commission_value numeric(14,2),
  client_name text,
  client_email text,
  client_phone text,
  client_document text,
  down_payment numeric(14,2),
  installments integer,
  payment_conditions text,
  start_date date,
  end_date date,
  signing_date date,
  closing_date date,
  notes text,
  attachments jsonb not null default '[]'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contracts_unique_number unique (organization_id, contract_number),
  constraint contracts_status_check check (status in ('draft', 'pending', 'active', 'signed', 'completed', 'cancelled', 'canceled')),
  constraint contracts_value_non_negative check (value is null or value >= 0)
);

create table if not exists public.contract_brokers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  commission_percentage numeric(7,4) not null default 0,
  commission_value numeric(14,2),
  role text,
  created_at timestamptz not null default now(),
  constraint contract_brokers_unique unique (contract_id, user_id)
);

create table if not exists public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  category text,
  category_group text,
  contract_id uuid references public.contracts(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  broker_id uuid references public.users(id) on delete set null,
  description text,
  amount numeric(14,2) not null default 0,
  paid_amount numeric(14,2) not null default 0,
  paid_value numeric(14,2) not null default 0,
  due_date date,
  paid_date date,
  payment_method text,
  status text not null default 'pending',
  notes text,
  created_by uuid references public.users(id) on delete set null,
  installment_number integer,
  total_installments integer,
  is_recurring boolean not null default false,
  recurring_type text,
  parent_entry_id uuid references public.financial_entries(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint financial_entries_type_check check (type in ('payable', 'receivable')),
  constraint financial_entries_status_check check (status in ('pending', 'partial', 'paid', 'overdue', 'cancelled', 'canceled')),
  constraint financial_entries_amount_non_negative check (amount >= 0),
  constraint financial_entries_recurring_type_check check (recurring_type is null or recurring_type in ('monthly', 'weekly', 'yearly'))
);

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  business_type text not null default 'all',
  commission_type text not null default 'percentage',
  commission_value numeric(14,4) not null default 0,
  percentage numeric(7,4) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commission_rules_business_type_check check (business_type in ('sale', 'rental', 'service', 'all')),
  constraint commission_rules_type_check check (commission_type in ('percentage', 'fixed'))
);

create table if not exists public.commissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contract_id uuid references public.contracts(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  rule_id uuid references public.commission_rules(id) on delete set null,
  amount numeric(14,2),
  base_value numeric(14,2) not null default 0,
  percentage numeric(7,4),
  calculated_value numeric(14,2) not null default 0,
  status text not null default 'forecast',
  forecast_date date,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  payment_proof text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commissions_status_check check (status in ('forecast', 'pending', 'approved', 'paid', 'cancelled', 'canceled', 'prevista', 'pendente', 'aprovada', 'paga'))
);

create table if not exists public.dre_account_groups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  group_type text not null,
  display_order integer not null default 0,
  parent_id uuid references public.dre_account_groups(id) on delete cascade,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  constraint dre_account_groups_type_check check (group_type in ('revenue', 'deduction', 'cost', 'expense', 'financial_expense', 'financial_revenue', 'tax'))
);

create table if not exists public.dre_account_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  group_id uuid not null references public.dre_account_groups(id) on delete cascade,
  category text not null,
  entry_type text not null,
  created_at timestamptz not null default now(),
  constraint dre_account_mappings_entry_type_check check (entry_type in ('payable', 'receivable')),
  constraint dre_account_mappings_unique unique (organization_id, category, entry_type)
);

create index if not exists idx_schedule_events_org_time on public.schedule_events(organization_id, start_time, end_time);
create index if not exists idx_schedule_events_user_time on public.schedule_events(user_id, start_time, end_time);
create index if not exists idx_schedule_assignees_event on public.schedule_event_assignees(event_id);
create index if not exists idx_schedule_comments_event on public.schedule_event_comments(event_id, created_at);
create index if not exists idx_financial_entries_org_due on public.financial_entries(organization_id, due_date, status);
create index if not exists idx_financial_entries_contract on public.financial_entries(contract_id);
create index if not exists idx_contracts_org_status on public.contracts(organization_id, status);
create index if not exists idx_contract_brokers_user on public.contract_brokers(user_id);
create index if not exists idx_commissions_org_user on public.commissions(organization_id, user_id, status);
create index if not exists idx_dre_groups_org_order on public.dre_account_groups(organization_id, display_order);
create index if not exists idx_dre_mappings_org_category on public.dre_account_mappings(organization_id, category, entry_type);

drop trigger if exists set_updated_at_schedule_events on public.schedule_events;
create trigger set_updated_at_schedule_events before update on public.schedule_events for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_financial_categories on public.financial_categories;
create trigger set_updated_at_financial_categories before update on public.financial_categories for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_contracts on public.contracts;
create trigger set_updated_at_contracts before update on public.contracts for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_financial_entries on public.financial_entries;
create trigger set_updated_at_financial_entries before update on public.financial_entries for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_commission_rules on public.commission_rules;
create trigger set_updated_at_commission_rules before update on public.commission_rules for each row execute function private.set_updated_at();
drop trigger if exists set_updated_at_commissions on public.commissions;
create trigger set_updated_at_commissions before update on public.commissions for each row execute function private.set_updated_at();

do $$
declare
  t text;
begin
  foreach t in array array[
    'schedule_events', 'schedule_event_assignees', 'schedule_event_comments',
    'financial_categories', 'contract_sequences', 'contracts', 'contract_brokers',
    'financial_entries', 'commission_rules', 'commissions',
    'dre_account_groups', 'dre_account_mappings'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

drop policy if exists "schedule members read visible events" on public.schedule_events;
create policy "schedule members read visible events"
on public.schedule_events
for select
to authenticated
using (
  private.is_org_member(organization_id)
  and (
    visibility <> 'private'
    or user_id = auth.uid()
    or private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
    or exists (
      select 1
      from public.schedule_event_assignees sea
      where sea.event_id = schedule_events.id
        and sea.user_id = auth.uid()
    )
  )
);

drop policy if exists "schedule participants manage events" on public.schedule_events;
create policy "schedule participants manage events"
on public.schedule_events
for all
to authenticated
using (
  private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or user_id = auth.uid()
)
with check (
  private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
  or user_id = auth.uid()
);

drop policy if exists "schedule members read assignees" on public.schedule_event_assignees;
create policy "schedule members read assignees"
on public.schedule_event_assignees
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "schedule owners manage assignees" on public.schedule_event_assignees;
create policy "schedule owners manage assignees"
on public.schedule_event_assignees
for all
to authenticated
using (
  exists (
    select 1
    from public.schedule_events se
    where se.id = schedule_event_assignees.event_id
      and (
        se.user_id = auth.uid()
        or private.has_org_role(se.organization_id, array['owner', 'admin', 'manager'])
      )
  )
)
with check (
  exists (
    select 1
    from public.schedule_events se
    where se.id = schedule_event_assignees.event_id
      and (
        se.user_id = auth.uid()
        or private.has_org_role(se.organization_id, array['owner', 'admin', 'manager'])
      )
  )
);

drop policy if exists "schedule members read comments" on public.schedule_event_comments;
create policy "schedule members read comments"
on public.schedule_event_comments
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists "schedule members create comments" on public.schedule_event_comments;
create policy "schedule members create comments"
on public.schedule_event_comments
for insert
to authenticated
with check (private.is_org_member(organization_id) and user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array[
    'financial_categories', 'contract_sequences', 'contracts',
    'financial_entries', 'commission_rules', 'dre_account_groups', 'dre_account_mappings'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', 'financial admins read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'financial admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'financial admins read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''financial_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'financial admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "brokers read own contracts" on public.contracts;
create policy "brokers read own contracts"
on public.contracts
for select
to authenticated
using (
  exists (
    select 1
    from public.contract_brokers cb
    where cb.contract_id = contracts.id
      and cb.user_id = auth.uid()
  )
);

drop policy if exists "financial admins read contract brokers" on public.contract_brokers;
create policy "financial admins read contract brokers"
on public.contract_brokers
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "financial admins manage contract brokers" on public.contract_brokers;
create policy "financial admins manage contract brokers"
on public.contract_brokers
for all
to authenticated
using (
  exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
)
with check (
  exists (
    select 1
    from public.contracts c
    where c.id = contract_brokers.contract_id
      and (
        private.has_permission(c.organization_id, 'financial_manage')
        or private.has_org_role(c.organization_id, array['owner', 'admin'])
      )
  )
);

drop policy if exists "brokers read own commissions" on public.commissions;
create policy "brokers read own commissions"
on public.commissions
for select
to authenticated
using (
  user_id = auth.uid()
  or private.has_permission(organization_id, 'financial_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
);

drop policy if exists "financial admins manage commissions" on public.commissions;
create policy "financial admins manage commissions"
on public.commissions
for all
to authenticated
using (private.has_permission(organization_id, 'financial_manage') or private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_permission(organization_id, 'financial_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

create or replace function private.get_schedule_events_secure_impl(
  p_user_id uuid default null,
  p_lead_id uuid default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
)
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  lead_id uuid,
  property_id uuid,
  title text,
  description text,
  event_type text,
  start_time timestamptz,
  end_time timestamptz,
  is_all_day boolean,
  location text,
  status text,
  visibility text,
  reminder_minutes integer,
  recurrence_parent_id uuid,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_avatar_url text,
  lead_name text,
  lead_phone text,
  property_title text,
  property_code text,
  completed_by_user_name text,
  assignee_user_ids uuid[],
  is_masked boolean
)
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  with current_memberships as (
    select om.organization_id, om.role
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.is_active = true
  ),
  base as (
    select
      se.*,
      array_remove(array_agg(distinct sea.user_id), null) as assignees,
      bool_or(se.user_id = auth.uid() or sea.user_id = auth.uid()) as is_participant,
      bool_or(cm.role in ('owner', 'admin', 'manager')) as is_manager
    from public.schedule_events se
    join current_memberships cm on cm.organization_id = se.organization_id
    left join public.schedule_event_assignees sea on sea.event_id = se.id
    where (p_user_id is null or se.user_id = p_user_id or sea.user_id = p_user_id)
      and (p_lead_id is null or se.lead_id = p_lead_id)
      and (p_start_time is null or se.end_time >= p_start_time)
      and (p_end_time is null or se.start_time <= p_end_time)
    group by se.id
  )
  select
    b.id,
    b.organization_id,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.user_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.lead_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.property_id end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'Horario ocupado' else b.title end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'Informacao privada' else b.description end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then 'task' else b.event_type end,
    b.start_time,
    b.end_time,
    b.is_all_day,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.location end,
    b.status,
    b.visibility,
    b.reminder_minutes,
    b.recurrence_parent_id,
    b.recurrence_rule,
    b.recurrence_until,
    b.recurrence_count,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else b.google_event_id end,
    b.completed_by,
    b.completed_at,
    b.created_at,
    b.updated_at,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else u.name end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else u.avatar_url end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else l.name end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else l.phone end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else p.title end,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then null else p.code end,
    cbu.name,
    case when b.visibility = 'public' and not b.is_participant and not b.is_manager then array[]::uuid[] else b.assignees end,
    (b.visibility = 'public' and not b.is_participant and not b.is_manager)
  from base b
  left join public.users u on u.id = b.user_id
  left join public.leads l on l.id = b.lead_id
  left join public.properties p on p.id = b.property_id
  left join public.users cbu on cbu.id = b.completed_by
  where b.visibility <> 'private' or b.is_participant or b.is_manager;
$$;

create or replace function public.get_schedule_events_secure(
  p_user_id uuid default null,
  p_lead_id uuid default null,
  p_start_time timestamptz default null,
  p_end_time timestamptz default null
)
returns table (
  id uuid,
  organization_id uuid,
  user_id uuid,
  lead_id uuid,
  property_id uuid,
  title text,
  description text,
  event_type text,
  start_time timestamptz,
  end_time timestamptz,
  is_all_day boolean,
  location text,
  status text,
  visibility text,
  reminder_minutes integer,
  recurrence_parent_id uuid,
  recurrence_rule text,
  recurrence_until timestamptz,
  recurrence_count integer,
  google_event_id text,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  user_name text,
  user_avatar_url text,
  lead_name text,
  lead_phone text,
  property_title text,
  property_code text,
  completed_by_user_name text,
  assignee_user_ids uuid[],
  is_masked boolean
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select * from private.get_schedule_events_secure_impl(p_user_id, p_lead_id, p_start_time, p_end_time);
$$;

grant execute on function public.get_schedule_events_secure(uuid, uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.copy_default_dre_groups(org_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if not (private.has_permission(org_id, 'financial_manage') or private.has_org_role(org_id, array['owner', 'admin'])) then
    raise exception 'Sem permissao para configurar DRE';
  end if;

  insert into public.dre_account_groups (organization_id, name, group_type, display_order, is_system)
  values
    (org_id, 'Receita operacional bruta', 'revenue', 10, true),
    (org_id, 'Deducoes da receita', 'deduction', 20, true),
    (org_id, 'Custos operacionais', 'cost', 30, true),
    (org_id, 'Despesas operacionais', 'expense', 40, true),
    (org_id, 'Despesas financeiras', 'financial_expense', 50, true),
    (org_id, 'Receitas financeiras', 'financial_revenue', 60, true),
    (org_id, 'Impostos sobre lucro', 'tax', 70, true)
  on conflict do nothing;
end;
$$;

grant execute on function public.copy_default_dre_groups(uuid) to authenticated;


-- END supabase\drafts\20260621_005_schedule_financial.sql

-- BEGIN supabase\drafts\20260621_006_automations_gamification_admin.sql

-- Vimob CRM - DRAFT ONLY - Automations, gamification, support, admin and system RPCs
-- Do not run before review.
-- Pages covered:
--   /automations
--   /gamificacao
--   /notifications
--   /suporte
--   /settings?tab=api
--   /admin/*
--
-- Security principle:
--   Super Admin can inspect platform-wide data.
--   Organization users can only read/write their own organization rows.
--   Notification/email dispatch and AI/outbox execution must stay in backend/Edge Functions.

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  trigger_type text not null default 'manual',
  trigger_config jsonb not null default '{}'::jsonb,
  flow_definition jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint automations_trigger_type_check check (
    trigger_type in ('message_received', 'scheduled', 'lead_stage_changed', 'lead_created', 'tag_added', 'inactivity', 'manual')
  )
);

create table if not exists public.automation_nodes (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  node_type text not null default 'action',
  action_type text,
  node_config jsonb not null default '{}'::jsonb,
  position_x numeric not null default 0,
  position_y numeric not null default 0,
  created_at timestamptz not null default now(),
  constraint automation_nodes_node_type_check check (node_type in ('trigger', 'action', 'condition', 'delay'))
);

create table if not exists public.automation_connections (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  source_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  target_node_id uuid not null references public.automation_nodes(id) on delete cascade,
  source_handle text,
  condition_branch text,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  content text not null,
  media_url text,
  media_type text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_executions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid references public.automations(id) on delete set null,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  status text not null default 'queued',
  current_node_id uuid references public.automation_nodes(id) on delete set null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  execution_data jsonb not null default '{}'::jsonb,
  next_execution_at timestamptz,
  constraint automation_executions_status_check check (status in ('queued', 'running', 'completed', 'failed', 'cancelled', 'canceled'))
);

create table if not exists public.gamification_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  event_type text not null,
  points_earned integer not null default 0,
  xp_earned integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gamification_missions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text,
  target_count integer not null default 1,
  current_progress integer not null default 0,
  bonus_points integer not null default 0,
  period text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_gamification_stats (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  total_points integer not null default 0,
  points integer not null default 0,
  xp integer not null default 0,
  xp_total integer not null default 0,
  xp_current_level integer not null default 0,
  xp_next_level integer not null default 1000,
  current_level integer not null default 1,
  current_rank text not null default 'Bronze',
  rank_tier text not null default 'Bronze',
  streak_days integer not null default 0,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_gamification_stats_unique unique (organization_id, user_id)
);

create table if not exists public.setup_guide_progress (
  user_id uuid primary key references public.users(id) on delete cascade,
  completed_steps jsonb not null default '{}'::jsonb,
  skipped boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  message text not null,
  button_text text,
  button_url text,
  is_active boolean not null default true,
  show_banner boolean not null default true,
  send_notification boolean not null default false,
  target_type text not null default 'all',
  target_organization_ids uuid[],
  target_user_ids uuid[],
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_target_type_check check (target_type in ('all', 'organizations', 'admins', 'specific'))
);

create table if not exists public.help_articles (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  content text not null,
  video_url text,
  image_url text,
  display_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.feature_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.users(id) on delete set null,
  category text not null,
  title text not null,
  description text not null,
  status text not null default 'pending',
  admin_response text,
  responded_at timestamptz,
  responded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_requests_status_check check (status in ('pending', 'analyzing', 'approved', 'rejected'))
);

create table if not exists public.onboarding_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  company_name text not null,
  cnpj text,
  company_address text,
  company_city text,
  company_neighborhood text,
  company_number text,
  company_complement text,
  company_phone text,
  company_whatsapp text,
  company_email text,
  segment text,
  responsible_name text not null,
  responsible_email text not null,
  responsible_cpf text,
  responsible_phone text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  site_title text,
  custom_domain text,
  site_seo_description text,
  about_text text,
  banner_url text,
  banner_title text,
  instagram text,
  facebook text,
  youtube text,
  linkedin text,
  team_size text,
  selected_plan_id uuid references public.admin_subscription_plans(id) on delete set null,
  confirmed_value numeric(12,2),
  billing_cycle text,
  privacy_policy_accepted boolean not null default false,
  terms_accepted boolean not null default false,
  privacy_policy_version text,
  terms_version text,
  legal_accepted_at timestamptz,
  onboarding_completed_at timestamptz,
  creci text,
  status text not null default 'pending',
  admin_notes text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  subject text not null,
  html_body text not null,
  text_body text,
  category text not null default 'system',
  variables text[] not null default '{}',
  is_active boolean not null default true,
  organization_id uuid references public.organizations(id) on delete cascade,
  editable_by_admin boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  template_slug text,
  to_email text not null,
  subject text,
  status text not null default 'queued',
  provider_message_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_api_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  key_prefix text not null,
  key_hash text not null,
  scopes text[] not null default array['properties:read'],
  is_active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_api_keys_prefix_unique unique (key_prefix)
);

create table if not exists public.password_change_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  changed_at timestamptz not null default now(),
  source text not null default 'settings',
  metadata jsonb not null default '{}'::jsonb,
  constraint password_change_events_source_check check (source in ('settings', 'recovery'))
);

create table if not exists public.password_change_lockouts (
  user_id uuid primary key references public.users(id) on delete cascade,
  locked_until timestamptz,
  lock_level integer not null default 0,
  last_lock_reason text,
  updated_at timestamptz not null default now()
);

-- Backend-owned future AI/outbox tables. They are included for the Super Admin AI screen,
-- but writes should be performed by the Go/Edge backend with service credentials.
create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft',
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.conversation_ai_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  conversation_id uuid references public.whatsapp_conversations(id) on delete cascade,
  last_response_id text,
  memory jsonb not null default '{}'::jsonb,
  restarted_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint conversation_ai_state_unique unique (organization_id, conversation_id)
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  job_type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  run_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outbox_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  conversation_id uuid references public.whatsapp_conversations(id) on delete set null,
  channel text not null default 'whatsapp',
  recipient text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  provider_message_id text,
  attempts integer not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_automation_nodes_automation on public.automation_nodes(automation_id);
create index if not exists idx_automation_connections_automation on public.automation_connections(automation_id);
create index if not exists idx_automation_executions_org_status on public.automation_executions(organization_id, status, started_at desc);
create index if not exists idx_gamification_events_org_user on public.gamification_events(organization_id, user_id, created_at desc);
create index if not exists idx_feature_requests_org_status on public.feature_requests(organization_id, status, created_at desc);
create index if not exists idx_onboarding_requests_status on public.onboarding_requests(status, created_at desc);
create index if not exists idx_email_logs_org_status on public.email_logs(organization_id, status, created_at desc);
create index if not exists idx_events_status on public.events(status, created_at);
create index if not exists idx_jobs_status_run_at on public.jobs(status, run_at);
create index if not exists idx_outbox_messages_status on public.outbox_messages(status, created_at);

do $$
declare
  t text;
begin
  foreach t in array array[
    'automations', 'automation_nodes', 'automation_connections', 'automation_templates', 'automation_executions',
    'gamification_events', 'gamification_missions', 'user_gamification_stats', 'setup_guide_progress',
    'announcements', 'help_articles', 'feature_requests', 'onboarding_requests',
    'email_templates', 'email_logs', 'organization_api_keys', 'password_change_events',
    'password_change_lockouts', 'ai_agents', 'conversation_ai_state', 'events', 'jobs', 'outbox_messages'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'automations', 'automation_templates', 'automation_executions',
    'gamification_events', 'gamification_missions', 'user_gamification_stats',
    'feature_requests', 'onboarding_requests', 'ai_agents', 'conversation_ai_state',
    'events', 'jobs', 'outbox_messages'
  ]
  loop
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

grant select, insert, update, delete on public.automation_nodes to authenticated;
grant select, insert, update, delete on public.automation_connections to authenticated;
grant select, insert, update, delete on public.setup_guide_progress to authenticated;
grant select on public.announcements to authenticated;
grant select on public.help_articles to anon, authenticated;
grant select, insert, update, delete on public.announcements to authenticated;
grant select, insert, update, delete on public.help_articles to authenticated;
grant select, insert, update, delete on public.email_templates to authenticated;
grant select, insert on public.email_logs to authenticated;
grant select (id, organization_id, name, key_prefix, scopes, is_active, last_used_at, created_by, created_at, updated_at) on public.organization_api_keys to authenticated;
grant delete on public.organization_api_keys to authenticated;
grant select on public.password_change_events to authenticated;
grant select on public.password_change_lockouts to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['automations', 'automation_templates']
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'automation admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''automations_edit'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''automations_edit'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'automation admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "members read automation nodes" on public.automation_nodes;
create policy "members read automation nodes"
on public.automation_nodes
for select
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and private.is_org_member(a.organization_id)
  )
);

drop policy if exists "automation admins manage nodes" on public.automation_nodes;
create policy "automation admins manage nodes"
on public.automation_nodes
for all
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
)
with check (
  exists (
    select 1
    from public.automations a
    where a.id = automation_nodes.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
);

drop policy if exists "members read automation connections" on public.automation_connections;
create policy "members read automation connections"
on public.automation_connections
for select
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and private.is_org_member(a.organization_id)
  )
);

drop policy if exists "automation admins manage connections" on public.automation_connections;
create policy "automation admins manage connections"
on public.automation_connections
for all
to authenticated
using (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
)
with check (
  exists (
    select 1
    from public.automations a
    where a.id = automation_connections.automation_id
      and (private.has_permission(a.organization_id, 'automations_edit') or private.has_org_role(a.organization_id, array['owner', 'admin']))
  )
);

drop policy if exists "automation admins read executions" on public.automation_executions;
create policy "automation admins read executions"
on public.automation_executions
for select
to authenticated
using (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "automation admins update executions" on public.automation_executions;
create policy "automation admins update executions"
on public.automation_executions
for update
to authenticated
using (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']))
with check (private.has_permission(organization_id, 'automations_edit') or private.has_org_role(organization_id, array['owner', 'admin']));

do $$
declare
  t text;
begin
  foreach t in array array['gamification_events', 'gamification_missions', 'user_gamification_stats']
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'gamification admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'gamification admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "users manage own setup guide" on public.setup_guide_progress;
create policy "users manage own setup guide"
on public.setup_guide_progress
for all
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

drop policy if exists "users read targeted active announcements" on public.announcements;
create policy "users read targeted active announcements"
on public.announcements
for select
to authenticated
using (
  is_active = true
  and (
    target_type = 'all'
    or (target_type = 'specific' and auth.uid() = any(target_user_ids))
    or (target_type = 'organizations' and exists (
      select 1 from public.organization_members om
      where om.user_id = auth.uid()
        and om.is_active = true
        and om.organization_id = any(target_organization_ids)
    ))
    or (target_type = 'admins' and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.role in ('admin', 'super_admin')
    ))
  )
);

drop policy if exists "super admins manage announcements" on public.announcements;
create policy "super admins manage announcements"
on public.announcements
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "public read active help articles" on public.help_articles;
create policy "public read active help articles"
on public.help_articles
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "super admins manage help articles" on public.help_articles;
create policy "super admins manage help articles"
on public.help_articles
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "users read own feature requests" on public.feature_requests;
create policy "users read own feature requests"
on public.feature_requests
for select
to authenticated
using (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "users create own feature requests" on public.feature_requests;
create policy "users create own feature requests"
on public.feature_requests
for insert
to authenticated
with check (user_id = auth.uid() and private.is_org_member(organization_id));

drop policy if exists "super admins respond feature requests" on public.feature_requests;
create policy "super admins respond feature requests"
on public.feature_requests
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "users read own onboarding requests" on public.onboarding_requests;
create policy "users read own onboarding requests"
on public.onboarding_requests
for select
to authenticated
using (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "users create own onboarding requests" on public.onboarding_requests;
create policy "users create own onboarding requests"
on public.onboarding_requests
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "super admins update onboarding requests" on public.onboarding_requests;
create policy "super admins update onboarding requests"
on public.onboarding_requests
for update
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage email templates" on public.email_templates;
create policy "super admins manage email templates"
on public.email_templates
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins read email logs" on public.email_logs;
create policy "super admins read email logs"
on public.email_logs
for select
to authenticated
using (private.is_super_admin());

drop policy if exists "backend users create own email logs" on public.email_logs;
create policy "backend users create own email logs"
on public.email_logs
for insert
to authenticated
with check (user_id = auth.uid() or private.is_super_admin());

drop policy if exists "admins read organization api keys" on public.organization_api_keys;
create policy "admins read organization api keys"
on public.organization_api_keys
for select
to authenticated
using (private.has_permission(organization_id, 'settings_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "admins delete organization api keys" on public.organization_api_keys;
create policy "admins delete organization api keys"
on public.organization_api_keys
for delete
to authenticated
using (private.has_permission(organization_id, 'settings_manage') or private.has_org_role(organization_id, array['owner', 'admin']));

drop policy if exists "users read own password events" on public.password_change_events;
create policy "users read own password events"
on public.password_change_events
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "users read own password lockout" on public.password_change_lockouts;
create policy "users read own password lockout"
on public.password_change_lockouts
for select
to authenticated
using (user_id = auth.uid());

do $$
declare
  t text;
begin
  foreach t in array array['ai_agents', 'conversation_ai_state', 'events', 'jobs', 'outbox_messages']
  loop
    execute format('drop policy if exists %I on public.%I', 'admins read backend table ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'backend admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (organization_id is null or private.has_org_role(organization_id, array[''owner'', ''admin'']) or private.is_super_admin())', 'admins read backend table ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.is_super_admin()) with check (private.is_super_admin())', 'backend admins manage ' || t, t);
  end loop;
end $$;

-- Super Admin management policies on existing core tables.
drop policy if exists "super admins manage plans" on public.admin_subscription_plans;
create policy "super admins manage plans"
on public.admin_subscription_plans
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage system settings" on public.system_settings;
create policy "super admins manage system settings"
on public.system_settings
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins manage organizations" on public.organizations;
create policy "super admins manage organizations"
on public.organizations
for all
to authenticated
using (private.is_super_admin())
with check (private.is_super_admin());

drop policy if exists "super admins read all users" on public.users;
create policy "super admins read all users"
on public.users
for select
to authenticated
using (private.is_super_admin());

grant insert, update, delete on public.admin_subscription_plans to authenticated;
grant insert, update, delete on public.system_settings to authenticated;
grant update on public.organizations to authenticated;

create or replace function public.get_user_organization_role(p_user_id uuid)
returns table (
  role_id uuid,
  role_name text,
  permissions text[]
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    r.id,
    r.name,
    coalesce(array_agg(p.key order by p.key) filter (where p.key is not null), array[]::text[])
  from public.user_organization_roles uor
  join public.organization_roles r on r.id = uor.role_id
  left join public.organization_role_permissions rp
    on rp.role_id = r.id
   and rp.organization_id = uor.organization_id
  left join public.available_permissions p on p.id = rp.permission_id
  where uor.user_id = p_user_id
    and (p_user_id = auth.uid() or private.is_super_admin())
  group by r.id, r.name
  limit 1;
$$;

grant execute on function public.get_user_organization_role(uuid) to authenticated;

create or replace function private.generate_organization_api_key_impl(p_name text, p_organization_id uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  raw_key text;
  prefix text;
begin
  if not (
    private.has_permission(p_organization_id, 'settings_manage')
    or private.has_org_role(p_organization_id, array['owner', 'admin'])
  ) then
    raise exception 'Sem permissao para gerar chave de API';
  end if;

  raw_key := 'vimob_' || encode(extensions.gen_random_bytes(32), 'hex');
  prefix := substring(raw_key from 1 for 14);

  insert into public.organization_api_keys (
    organization_id,
    name,
    key_prefix,
    key_hash,
    created_by
  )
  values (
    p_organization_id,
    coalesce(nullif(trim(p_name), ''), 'Chave Padrao'),
    prefix,
    encode(digest(raw_key, 'sha256'), 'hex'),
    auth.uid()
  );

  return raw_key;
end;
$$;

create or replace function public.generate_organization_api_key(p_name text, p_organization_id uuid)
returns text
language sql
volatile
security invoker
set search_path = public, private, pg_temp
as $$
  select private.generate_organization_api_key_impl(p_name, p_organization_id);
$$;

grant execute on function public.generate_organization_api_key(text, uuid) to authenticated;

create or replace function private.admin_dashboard_overview_impl(p_period_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'period_days', p_period_days,
    'financial', jsonb_build_object(
      'mrr', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('active', 'trial')), 0),
      'revenue_period', coalesce((select sum(subscription_value) from public.organizations where created_at >= now() - make_interval(days => p_period_days)), 0),
      'revenue_forecast', coalesce((select sum(subscription_value) from public.organizations where subscription_status in ('trial', 'pending_payment', 'active')), 0),
      'avg_ticket', coalesce((select avg(subscription_value) from public.organizations where subscription_value is not null), 0),
      'overdue_total', 0,
      'revenue_growth_pct', 0
    ),
    'platform', jsonb_build_object(
      'total_orgs', (select count(*) from public.organizations),
      'active_orgs', (select count(*) from public.organizations where is_active = true),
      'trial_orgs', (select count(*) from public.organizations where subscription_status = 'trial'),
      'cancelled_orgs', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled')),
      'active_users_today', (select count(*) from public.users where is_active = true and updated_at >= current_date),
      'orgs_growth_pct', 0
    ),
    'operational', jsonb_build_object(
      'leads_today', (select count(*) from public.leads where created_at >= current_date),
      'automations_today', (select count(*) from public.automation_executions where started_at >= current_date),
      'activities_today', (select count(*) from public.activities where created_at >= current_date),
      'errors_recent', (select count(*) from public.audit_logs where created_at >= now() - interval '24 hours' and action ilike '%error%'),
      'accesses_today', 0
    )
  ) else '{}'::jsonb end;
$$;

create or replace function public.admin_dashboard_overview(p_period_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select private.admin_dashboard_overview_impl(p_period_days);
$$;

grant execute on function public.admin_dashboard_overview(integer) to authenticated;

create or replace function public.admin_dashboard_timeseries(p_period_days integer default 30)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'revenue', '[]'::jsonb,
    'orgs', '[]'::jsonb,
    'usage', '[]'::jsonb,
    'health', jsonb_build_object(
      'active', (select count(*) from public.organizations where subscription_status = 'active'),
      'trial', (select count(*) from public.organizations where subscription_status = 'trial'),
      'overdue', (select count(*) from public.organizations where subscription_status in ('overdue', 'past_due')),
      'cancelled', (select count(*) from public.organizations where subscription_status in ('cancelled', 'canceled'))
    )
  ) else '{}'::jsonb end;
$$;

grant execute on function public.admin_dashboard_timeseries(integer) to authenticated;

create or replace function public.admin_dashboard_pending_boards()
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'overdue', '[]'::jsonb,
    'idle', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', idle_orgs.id,
        'name', idle_orgs.name,
        'last_access_at', idle_orgs.last_access_at,
        'days_idle', case when idle_orgs.last_access_at is null then null else floor(extract(epoch from (now() - idle_orgs.last_access_at)) / 86400)::int end
      ))
      from (
        select id, name, last_access_at
        from public.organizations
        where is_active = true
        order by last_access_at nulls first
        limit 20
      ) idle_orgs
    ), '[]'::jsonb),
    'issues', '[]'::jsonb,
    'trials', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', trial_orgs.id,
        'name', trial_orgs.name,
        'trial_ends_at', trial_orgs.trial_ends_at,
        'days_left', floor(extract(epoch from (trial_orgs.trial_ends_at - now())) / 86400)::int,
        'telefone', trial_orgs.telefone,
        'whatsapp', trial_orgs.whatsapp,
        'email', trial_orgs.email
      ))
      from (
        select id, name, trial_ends_at, telefone, whatsapp, email
        from public.organizations
        where subscription_status = 'trial'
          and trial_ends_at is not null
        order by trial_ends_at asc
        limit 20
      ) trial_orgs
    ), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

grant execute on function public.admin_dashboard_pending_boards() to authenticated;

create or replace function public.admin_dashboard_feed(p_limit integer default 30)
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  type text,
  severity text,
  title text,
  description text,
  metadata jsonb,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    al.id,
    al.organization_id,
    o.name,
    al.entity_type,
    'info',
    al.action,
    al.entity_id,
    coalesce(al.new_data, '{}'::jsonb),
    al.created_at
  from public.audit_logs al
  left join public.organizations o on o.id = al.organization_id
  where private.is_super_admin()
  order by al.created_at desc
  limit least(greatest(p_limit, 1), 100);
$$;

grant execute on function public.admin_dashboard_feed(integer) to authenticated;

create or replace function public.admin_list_organizations(p_search text default '', p_status text default 'all', p_segment text default 'all')
returns table (
  id uuid,
  name text,
  logo_url text,
  is_active boolean,
  subscription_status text,
  subscription_type text,
  segment text,
  created_at timestamptz,
  last_access_at timestamptz,
  user_count bigint,
  lead_count bigint,
  automation_count bigint,
  mrr numeric,
  health_score integer,
  days_trial_left integer,
  overdue_amount numeric
)
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select
    o.id,
    o.name,
    o.logo_url,
    o.is_active,
    o.subscription_status,
    o.subscription_type,
    o.segment,
    o.created_at,
    o.last_access_at,
    (select count(*) from public.users u where u.organization_id = o.id),
    (select count(*) from public.leads l where l.organization_id = o.id),
    (select count(*) from public.automations a where a.organization_id = o.id),
    coalesce(o.subscription_value, 0),
    case when o.is_active then 100 else 0 end,
    case when o.trial_ends_at is null then 0 else floor(extract(epoch from (o.trial_ends_at - now())) / 86400)::int end,
    0::numeric
  from public.organizations o
  where private.is_super_admin()
    and (coalesce(p_search, '') = '' or o.name ilike '%' || p_search || '%' or o.email ilike '%' || p_search || '%' or o.cnpj ilike '%' || p_search || '%')
    and (p_status = 'all' or o.subscription_status = p_status)
    and (p_segment = 'all' or o.segment = p_segment)
  order by o.created_at desc;
$$;

grant execute on function public.admin_list_organizations(text, text, text) to authenticated;

create or replace function public.get_database_stats_admin()
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$
  select case when private.is_super_admin() then jsonb_build_object(
    'database_size_bytes', 0,
    'database_size_pretty', 'n/a',
    'tables', '[]'::jsonb,
    'storage', jsonb_build_object('count', 0, 'size_bytes', 0),
    'counts', jsonb_build_object(
      'whatsapp_messages', (select count(*) from public.whatsapp_messages),
      'notifications', (select count(*) from public.notifications),
      'activities', (select count(*) from public.activities),
      'audit_logs', (select count(*) from public.audit_logs),
      'leads', (select count(*) from public.leads),
      'users', (select count(*) from public.users),
      'organizations', (select count(*) from public.organizations)
    )
  ) else '{}'::jsonb end;
$$;

grant execute on function public.get_database_stats_admin() to authenticated;


-- END supabase\drafts\20260621_006_automations_gamification_admin.sql

-- BEGIN supabase\drafts\20260621_007_storage_buckets.sql

-- Vimob CRM - DRAFT ONLY - Storage buckets and object RLS
-- Do not run before review.
-- Buckets covered:
--   avatars
--   logos
--   properties
--   site-images
--   whatsapp-media
--   automation-media
--   contract-documents
--
-- Security principle:
--   Public buckets only for assets intended to be public: avatars, logos, property/site images.
--   WhatsApp media and contract documents stay private and must use signed URLs.
--
-- Frontend alignment note:
--   Some current site uploads use site-images/sites/{file}. That path does not include organization_id.
--   This draft allows org admins to write that prefix for compatibility, but the safer production path is:
--   site-images/organizations/{organization_id}/sites/{file}.

create or replace function private.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return value::uuid;
exception when others then
  return null;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('logos', 'logos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('properties', 'properties', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('site-images', 'site-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('whatsapp-media', 'whatsapp-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'application/pdf', 'application/octet-stream']),
  ('automation-media', 'automation-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/ogg']),
  ('contract-documents', 'contract-documents', false, 26214400, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read public vimob buckets" on storage.objects;
create policy "public read public vimob buckets"
on storage.objects
for select
to anon, authenticated
using (bucket_id in ('avatars', 'logos', 'properties', 'site-images'));

drop policy if exists "users manage own avatars" on storage.objects;
create policy "users manage own avatars"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'avatars'
  and split_part(split_part(name, '/', 2), '-', 1) = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'avatars'
  and split_part(split_part(name, '/', 2), '-', 1) = auth.uid()::text
);

drop policy if exists "org admins manage logo assets" on storage.objects;
create policy "org admins manage logo assets"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'logos'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
)
with check (
  bucket_id = 'logos'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
);

drop policy if exists "property managers manage property images" on storage.objects;
create policy "property managers manage property images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'properties'
  and split_part(name, '/', 1) = 'orgs'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'property_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'properties'
  and split_part(name, '/', 1) = 'orgs'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'property_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
);

drop policy if exists "org admins manage site images" on storage.objects;
create policy "org admins manage site images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'site-images'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
)
with check (
  bucket_id = 'site-images'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
);

drop policy if exists "org members read private whatsapp media" on storage.objects;
create policy "org members read private whatsapp media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and private.is_org_member(private.safe_uuid(split_part(name, '/', 2)))
);

drop policy if exists "org members upload private whatsapp media" on storage.objects;
create policy "org members upload private whatsapp media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and private.is_org_member(private.safe_uuid(split_part(name, '/', 2)))
);

drop policy if exists "org members remove own whatsapp media" on storage.objects;
create policy "org members remove own whatsapp media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and (
    owner = auth.uid()
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'whatsapp_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
);

drop policy if exists "automation admins manage media" on storage.objects;
create policy "automation admins manage media"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'automation-media'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'automations_edit')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'automation-media'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'automations_edit')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
);

drop policy if exists "financial admins manage contract documents" on storage.objects;
create policy "financial admins manage contract documents"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'contract-documents'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'financial_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'contract-documents'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'financial_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
);


-- END supabase\drafts\20260621_007_storage_buckets.sql

-- BEGIN supabase\drafts\20260621_008_frontend_rpc_compatibility.sql

-- Vimob CRM - DRAFT ONLY - frontend RPC compatibility
-- Do not run before review.
-- Purpose:
--   1. cover RPCs already called by the frontend;
--   2. keep privileged work in private schema;
--   3. avoid automatic external sends from database code.

create or replace function private.get_current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select u.organization_id
  from public.users u
  where u.id = auth.uid()
$$;

create or replace function public.user_has_permission(p_permission_key text, p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
as $$
  select coalesce((
    select private.is_super_admin()
      or private.has_permission(u.organization_id, p_permission_key)
    from public.users u
    where u.id = coalesce(p_user_id, auth.uid())
      and (
        u.id = auth.uid()
        or private.has_org_role(u.organization_id, array['owner', 'admin'])
        or private.is_super_admin()
      )
  ), false)
$$;

create or replace function public.is_team_leader(check_user_id uuid default auth.uid())
returns boolean
language sql
stable
security invoker
as $$
  select coalesce(exists (
    select 1
    from public.team_members tm
    where tm.user_id = coalesce(check_user_id, auth.uid())
      and tm.is_leader = true
      and tm.is_active = true
      and private.is_org_member(tm.organization_id)
  ), false)
$$;

create or replace function public.get_user_led_team_ids()
returns uuid[]
language sql
stable
security invoker
as $$
  select coalesce(array_agg(tm.team_id), array[]::uuid[])
  from public.team_members tm
  where tm.user_id = auth.uid()
    and tm.is_leader = true
    and tm.is_active = true
    and private.is_org_member(tm.organization_id)
$$;

create or replace function public.get_dashboard_team_lead_ids(
  p_team_id uuid,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns table(lead_id uuid)
language sql
stable
security invoker
as $$
  select l.id
  from public.leads l
  join public.team_members tm
    on tm.user_id = l.assigned_user_id
   and tm.team_id = p_team_id
   and tm.is_active = true
  where private.can_access_lead(l.organization_id, l.assigned_user_id)
    and (p_date_from is null or l.created_at >= p_date_from)
    and (p_date_to is null or l.created_at <= p_date_to)
$$;

create or replace function public.count_unique_sessions(
  p_organization_id uuid,
  p_date_from timestamptz,
  p_date_to timestamptz
)
returns integer
language sql
stable
security invoker
as $$
  select count(distinct le.session_id)::integer
  from public.lead_events le
  where le.organization_id = p_organization_id
    and private.is_org_member(le.organization_id)
    and le.session_id is not null
    and le.created_at >= p_date_from
    and le.created_at <= p_date_to
$$;

create or replace function public.get_dashboard_stats()
returns jsonb
language sql
stable
security invoker
as $$
  with scoped_leads as (
    select l.*
    from public.leads l
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
  )
  select jsonb_build_object(
    'totalLeads', count(*),
    'leadsInProgress', count(*) filter (where coalesce(deal_status, 'open') = 'open'),
    'leadsClosed', count(*) filter (where deal_status = 'won'),
    'leadsLost', count(*) filter (where deal_status = 'lost'),
    'leadsTrend', 0,
    'closedTrend', 0
  )
  from scoped_leads
$$;

create or replace function public.get_funnel_data(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_source text default null,
  p_pipeline_id uuid default null,
  p_tag_id uuid default null,
  p_deal_status text default null
)
returns table(stage_name text, lead_count bigint, stage_key text)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  ),
  scoped_stages as (
    select s.id, s.name, s.stage_key, s.position
    from public.stages s
    where private.is_org_member(s.organization_id)
      and (p_pipeline_id is null or s.pipeline_id = p_pipeline_id)
      and s.is_active = true
  ),
  scoped_leads as (
    select l.*
    from public.leads l
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
      and (p_date_from is null or l.created_at >= p_date_from)
      and (p_date_to is null or l.created_at <= p_date_to)
      and (p_user_id is null or l.assigned_user_id = p_user_id)
      and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
      and (p_source is null or l.source = p_source)
      and (p_deal_status is null or l.deal_status = p_deal_status)
      and (p_tag_id is null or exists (
        select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id
      ))
  )
  select ss.name, count(sl.id), coalesce(ss.stage_key, ss.name)
  from scoped_stages ss
  left join scoped_leads sl on sl.stage_id = ss.id
  group by ss.id, ss.name, ss.stage_key, ss.position
  order by ss.position asc
$$;

create or replace function public.get_lead_sources_data(
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_team_id uuid default null,
  p_user_id uuid default null,
  p_source text default null,
  p_pipeline_id uuid default null,
  p_tag_id uuid default null,
  p_deal_status text default null
)
returns table(source_name text, lead_count bigint)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  )
  select coalesce(l.source, 'manual') as source_name, count(*) as lead_count
  from public.leads l
  where private.can_access_lead(l.organization_id, l.assigned_user_id)
    and (p_date_from is null or l.created_at >= p_date_from)
    and (p_date_to is null or l.created_at <= p_date_to)
    and (p_user_id is null or l.assigned_user_id = p_user_id)
    and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
    and (p_source is null or l.source = p_source)
    and (p_pipeline_id is null or exists (
      select 1 from public.stages s where s.id = l.stage_id and s.pipeline_id = p_pipeline_id
    ))
    and (p_tag_id is null or exists (
      select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id
    ))
    and (p_deal_status is null or l.deal_status = p_deal_status)
  group by coalesce(l.source, 'manual')
  order by count(*) desc
$$;

create or replace function public.list_contacts_paginated(
  p_search text default null,
  p_team_id uuid default null,
  p_pipeline_id uuid default null,
  p_stage_id uuid default null,
  p_assignee_id uuid default null,
  p_unassigned boolean default false,
  p_tag_id uuid default null,
  p_source text default null,
  p_deal_status text default null,
  p_created_from timestamptz default null,
  p_created_to timestamptz default null,
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc',
  p_page integer default 1,
  p_limit integer default 25,
  p_campaign_id text default null,
  p_adset_id text default null,
  p_ad_id text default null
)
returns table(
  id uuid,
  name text,
  phone text,
  email text,
  whatsapp_avatar_url text,
  pipeline_id uuid,
  pipeline_name text,
  stage_id uuid,
  stage_name text,
  stage_color text,
  assigned_user_id uuid,
  assignee_name text,
  assignee_avatar text,
  source text,
  created_at timestamptz,
  sla_status text,
  last_interaction_at timestamptz,
  last_interaction_preview text,
  last_interaction_channel text,
  tags jsonb,
  total_count bigint,
  deal_status text,
  lost_reason text,
  last_entry_at timestamptz,
  reentry_count integer
)
language sql
stable
security invoker
as $$
  with team_users as (
    select tm.user_id
    from public.team_members tm
    where p_team_id is not null
      and tm.team_id = p_team_id
      and tm.is_active = true
  ),
  filtered as (
    select
      l.*,
      p.name as pipeline_name,
      s.name as stage_name,
      s.color as stage_color,
      u.name as assignee_name,
      u.avatar_url as assignee_avatar,
      lm.campaign_id,
      lm.campaign_name,
      lm.adset_id,
      lm.adset_name,
      lm.ad_id,
      lm.ad_name,
      count(*) over() as total_count
    from public.leads l
    left join public.pipelines p on p.id = l.pipeline_id
    left join public.stages s on s.id = l.stage_id
    left join public.users u on u.id = l.assigned_user_id
    left join public.lead_meta lm on lm.lead_id = l.id
    where private.can_access_lead(l.organization_id, l.assigned_user_id)
      and (p_search is null or p_search = '' or l.name ilike '%' || p_search || '%' or l.email ilike '%' || p_search || '%' or l.phone ilike '%' || p_search || '%')
      and (p_team_id is null or l.assigned_user_id in (select user_id from team_users))
      and (p_pipeline_id is null or l.pipeline_id = p_pipeline_id)
      and (p_stage_id is null or l.stage_id = p_stage_id)
      and (p_assignee_id is null or l.assigned_user_id = p_assignee_id)
      and (p_unassigned = false or l.assigned_user_id is null)
      and (p_tag_id is null or exists (select 1 from public.lead_tags lt where lt.lead_id = l.id and lt.tag_id = p_tag_id))
      and (p_source is null or l.source = p_source)
      and (p_deal_status is null or l.deal_status = p_deal_status)
      and (p_created_from is null or l.created_at >= p_created_from)
      and (p_created_to is null or l.created_at <= p_created_to)
      and (p_campaign_id is null or lm.campaign_id = p_campaign_id or lm.campaign_name = p_campaign_id)
      and (p_adset_id is null or lm.adset_id = p_adset_id or lm.adset_name = p_adset_id)
      and (p_ad_id is null or lm.ad_id = p_ad_id or lm.ad_name = p_ad_id)
  )
  select
    f.id,
    f.name,
    f.phone,
    f.email,
    f.whatsapp_avatar_url,
    f.pipeline_id,
    f.pipeline_name,
    f.stage_id,
    f.stage_name,
    f.stage_color,
    f.assigned_user_id,
    f.assignee_name,
    f.assignee_avatar,
    coalesce(f.source, 'manual') as source,
    f.created_at,
    null::text as sla_status,
    f.last_contact_at as last_interaction_at,
    null::text as last_interaction_preview,
    null::text as last_interaction_channel,
    coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name)
      from public.lead_tags lt
      join public.tags t on t.id = lt.tag_id
      where lt.lead_id = f.id
    ), '[]'::jsonb) as tags,
    f.total_count,
    f.deal_status,
    f.lost_reason,
    f.last_entry_at,
    f.reentry_count
  from filtered f
  order by
    case when p_sort_by = 'name' and p_sort_dir = 'asc' then f.name end asc,
    case when p_sort_by = 'name' and p_sort_dir = 'desc' then f.name end desc,
    case when p_sort_by = 'last_interaction_at' and p_sort_dir = 'asc' then f.last_contact_at end asc nulls last,
    case when p_sort_by = 'last_interaction_at' and p_sort_dir = 'desc' then f.last_contact_at end desc nulls last,
    case when p_sort_by = 'stage' and p_sort_dir = 'asc' then f.stage_name end asc nulls last,
    case when p_sort_by = 'stage' and p_sort_dir = 'desc' then f.stage_name end desc nulls last,
    case when p_sort_dir = 'asc' then f.created_at end asc,
    case when p_sort_dir <> 'asc' then f.created_at end desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, (coalesce(p_page, 1) - 1) * greatest(1, least(coalesce(p_limit, 25), 100)))
$$;

create or replace function private.create_default_stages_for_pipeline_impl(p_org_id uuid, p_pipeline_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not private.has_org_role(p_org_id, array['owner', 'admin', 'manager']) then
    raise exception 'Sem permissao para criar etapas.';
  end if;

  insert into public.stages (organization_id, pipeline_id, name, stage_key, color, position)
  values
    (p_org_id, p_pipeline_id, 'Novo', 'new', '#FF4529', 0),
    (p_org_id, p_pipeline_id, 'Em atendimento', 'in_progress', '#f59e0b', 1),
    (p_org_id, p_pipeline_id, 'Visita agendada', 'scheduled_visit', '#3b82f6', 2),
    (p_org_id, p_pipeline_id, 'Fechamento', 'closing', '#10b981', 3)
  on conflict do nothing;
end;
$$;

create or replace function public.create_default_stages_for_pipeline(p_org_id uuid, p_pipeline_id uuid)
returns void
language sql
security invoker
as $$
  select private.create_default_stages_for_pipeline_impl(p_org_id, p_pipeline_id)
$$;

create or replace function private.reorder_stages_impl(p_stages jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stage_record record;
  target_org_id uuid;
begin
  for stage_record in
    select *
    from jsonb_to_recordset(p_stages) as x(
      id uuid,
      pipeline_id uuid,
      name text,
      color text,
      position integer,
      stage_key text
    )
  loop
    select p.organization_id
      into target_org_id
    from public.pipelines p
    where p.id = stage_record.pipeline_id;

    if target_org_id is null then
      raise exception 'Pipeline nao encontrada.';
    end if;

    if not private.has_org_role(target_org_id, array['owner', 'admin', 'manager']) then
      raise exception 'Sem permissao para reordenar etapas.';
    end if;

    insert into public.stages (id, organization_id, pipeline_id, name, color, position, stage_key)
    values (
      stage_record.id,
      target_org_id,
      stage_record.pipeline_id,
      stage_record.name,
      stage_record.color,
      coalesce(stage_record.position, 0),
      stage_record.stage_key
    )
    on conflict (id) do update set
      name = excluded.name,
      color = excluded.color,
      position = excluded.position,
      stage_key = excluded.stage_key,
      updated_at = now();
  end loop;
end;
$$;

create or replace function public.reorder_stages(p_stages jsonb)
returns void
language sql
security invoker
as $$
  select private.reorder_stages_impl(p_stages)
$$;

create or replace function private.transfer_lead_assignee_impl(p_lead_id uuid, p_assigned_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  if current_lead.id is null then
    raise exception 'Lead nao encontrado.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_transfer')
    or private.has_permission(current_lead.organization_id, 'lead_manage')
    or current_lead.assigned_user_id = auth.uid()
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para transferir lead.';
  end if;

  if p_assigned_user_id is not null and not exists (
    select 1
    from public.organization_members om
    where om.organization_id = current_lead.organization_id
      and om.user_id = p_assigned_user_id
      and om.is_active = true
  ) then
    raise exception 'Usuario destino nao pertence a organizacao.';
  end if;

  update public.leads
  set assigned_user_id = p_assigned_user_id,
      assigned_at = case when p_assigned_user_id is null then null else now() end,
      updated_at = now()
  where id = p_lead_id;

  insert into public.assignments_log (organization_id, lead_id, old_user_id, new_user_id, reason, created_by)
  values (current_lead.organization_id, p_lead_id, current_lead.assigned_user_id, p_assigned_user_id, 'manual_transfer', auth.uid());
end;
$$;

create or replace function public.transfer_lead_assignee(p_lead_id uuid, p_assigned_user_id uuid default null)
returns void
language sql
security invoker
as $$
  select private.transfer_lead_assignee_impl(p_lead_id, p_assigned_user_id)
$$;

create or replace function private.move_lead_stage_impl(
  p_lead_id uuid,
  p_stage_id uuid,
  p_is_own_resource boolean default null,
  p_stage_entered_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
  target_stage record;
  moved_lead jsonb;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  select *
    into target_stage
  from public.stages
  where id = p_stage_id;

  if current_lead.id is null or target_stage.id is null then
    raise exception 'Lead ou etapa nao encontrado.';
  end if;

  if current_lead.organization_id <> target_stage.organization_id then
    raise exception 'Lead e etapa pertencem a organizacoes diferentes.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_manage')
    or current_lead.assigned_user_id = auth.uid()
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para mover lead.';
  end if;

  update public.leads
  set stage_id = target_stage.id,
      pipeline_id = target_stage.pipeline_id,
      stage_entered_at = coalesce(p_stage_entered_at, now()),
      is_own_resource = coalesce(p_is_own_resource, is_own_resource),
      updated_at = now()
  where id = p_lead_id
  returning to_jsonb(public.leads.*) into moved_lead;

  return moved_lead;
end;
$$;

create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_stage_id uuid,
  p_is_own_resource boolean default null,
  p_stage_entered_at timestamptz default now()
)
returns jsonb
language sql
security invoker
as $$
  select private.move_lead_stage_impl(p_lead_id, p_stage_id, p_is_own_resource, p_stage_entered_at)
$$;

create or replace function public.register_lead_reentry(
  p_lead_id uuid,
  p_org_id uuid,
  p_entry_type text default 'reentry',
  p_source text default 'manual',
  p_property_id uuid default null,
  p_valor_interesse numeric default null,
  p_campaign_name text default null,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security invoker
as $$
begin
  if not exists (
    select 1
    from public.leads l
    where l.id = p_lead_id
      and l.organization_id = p_org_id
      and private.can_access_lead(l.organization_id, l.assigned_user_id)
  ) then
    raise exception 'Sem permissao para registrar reentrada.';
  end if;

  insert into public.lead_entry_events (
    organization_id,
    lead_id,
    source,
    entry_type,
    property_id,
    valor_interesse,
    campaign_name,
    utm_source,
    utm_medium,
    utm_campaign,
    payload
  )
  values (
    p_org_id,
    p_lead_id,
    coalesce(p_source, 'manual'),
    p_entry_type,
    p_property_id,
    p_valor_interesse,
    p_campaign_name,
    p_utm_source,
    p_utm_medium,
    p_utm_campaign,
    coalesce(p_metadata, '{}'::jsonb)
  );

  update public.leads
  set reentry_count = coalesce(reentry_count, 0) + 1,
      last_entry_at = now(),
      source = coalesce(p_source, source),
      interest_property_id = coalesce(p_property_id, interest_property_id),
      valor_interesse = coalesce(p_valor_interesse, valor_interesse),
      updated_at = now()
  where id = p_lead_id;
end;
$$;

create or replace function private.redistribute_lead_round_robin_impl(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_lead record;
  selected_queue record;
  selected_member record;
begin
  select *
    into current_lead
  from public.leads
  where id = p_lead_id;

  if current_lead.id is null then
    raise exception 'Lead nao encontrado.';
  end if;

  if not (
    private.has_permission(current_lead.organization_id, 'lead_assign')
    or private.has_permission(current_lead.organization_id, 'lead_manage')
    or private.has_org_role(current_lead.organization_id, array['owner', 'admin', 'manager'])
  ) then
    raise exception 'Sem permissao para distribuir lead.';
  end if;

  select rr.*
    into selected_queue
  from public.round_robins rr
  where rr.organization_id = current_lead.organization_id
    and rr.is_active = true
    and (rr.pipeline_id is null or rr.pipeline_id = current_lead.pipeline_id)
  order by rr.pipeline_id is null, rr.created_at asc
  limit 1;

  if selected_queue.id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_queue');
  end if;

  select rrm.*
    into selected_member
  from public.round_robin_members rrm
  join public.organization_members om
    on om.organization_id = current_lead.organization_id
   and om.user_id = rrm.user_id
   and om.is_active = true
  where rrm.round_robin_id = selected_queue.id
    and rrm.is_active = true
  order by rrm.position asc, rrm.created_at asc
  limit 1;

  if selected_member.id is null then
    return jsonb_build_object('assigned', false, 'reason', 'no_member');
  end if;

  perform private.transfer_lead_assignee_impl(p_lead_id, selected_member.user_id);

  insert into public.round_robin_logs (organization_id, round_robin_id, lead_id, assigned_user_id, reason, metadata)
  values (
    current_lead.organization_id,
    selected_queue.id,
    p_lead_id,
    selected_member.user_id,
    'round_robin',
    jsonb_build_object('source', 'frontend_rpc_compatibility')
  );

  return jsonb_build_object('assigned', true, 'user_id', selected_member.user_id, 'round_robin_id', selected_queue.id);
end;
$$;

create or replace function public.redistribute_lead_round_robin(p_lead_id uuid)
returns jsonb
language sql
security invoker
as $$
  select private.redistribute_lead_round_robin_impl(p_lead_id)
$$;

create or replace function public.handle_lead_intake(p_lead_id uuid)
returns jsonb
language sql
security invoker
as $$
  -- Safe compatibility wrapper: distribute internally only.
  -- It must not send WhatsApp, email, Meta events or other external notifications.
  select private.redistribute_lead_round_robin_impl(p_lead_id)
$$;

create or replace function public.rebind_whatsapp_conversation_session(
  p_conversation_id uuid,
  p_session_id uuid,
  p_remote_jid text
)
returns public.whatsapp_conversations
language plpgsql
security invoker
as $$
declare
  updated_conversation public.whatsapp_conversations;
begin
  update public.whatsapp_conversations wc
  set session_id = p_session_id,
      remote_jid = coalesce(nullif(p_remote_jid, ''), wc.remote_jid),
      updated_at = now()
  where wc.id = p_conversation_id
    and private.is_org_member(wc.organization_id)
  returning * into updated_conversation;

  if updated_conversation.id is null then
    raise exception 'Conversa WhatsApp nao encontrada ou sem permissao.';
  end if;

  return updated_conversation;
end;
$$;

create or replace function public.find_orphan_team_members()
returns table(member_id uuid, team_id uuid, user_id uuid, team_name text, reason text)
language sql
stable
security invoker
as $$
  select tm.id, tm.team_id, tm.user_id, t.name, 'Usuario sem membership ativo na organizacao'
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  left join public.organization_members om
    on om.organization_id = tm.organization_id
   and om.user_id = tm.user_id
   and om.is_active = true
  where private.has_org_role(tm.organization_id, array['owner', 'admin', 'manager'])
    and om.id is null
$$;

create or replace function public.find_orphan_rr_members()
returns table(member_id uuid, round_robin_id uuid, user_id uuid, queue_name text, reason text)
language sql
stable
security invoker
as $$
  select rrm.id, rrm.round_robin_id, rrm.user_id, rr.name, 'Usuario sem membership ativo na organizacao'
  from public.round_robin_members rrm
  join public.round_robins rr on rr.id = rrm.round_robin_id
  left join public.organization_members om
    on om.organization_id = rrm.organization_id
   and om.user_id = rrm.user_id
   and om.is_active = true
  where private.has_org_role(rrm.organization_id, array['owner', 'admin', 'manager'])
    and om.id is null
$$;

create or replace function public.cleanup_orphan_members()
returns jsonb
language plpgsql
security invoker
as $$
declare
  removed_team integer := 0;
  removed_rr integer := 0;
begin
  delete from public.team_members tm
  where exists (
    select 1
    from public.find_orphan_team_members() o
    where o.member_id = tm.id
  );
  get diagnostics removed_team = row_count;

  delete from public.round_robin_members rrm
  where exists (
    select 1
    from public.find_orphan_rr_members() o
    where o.member_id = rrm.id
  );
  get diagnostics removed_rr = row_count;

  return jsonb_build_object(
    'team_members_removed', removed_team,
    'round_robin_members_removed', removed_rr,
    'executed_at', now()
  );
end;
$$;

create or replace function public.list_all_organizations_admin()
returns table(
  id uuid,
  name text,
  logo_url text,
  is_active boolean,
  subscription_status text,
  max_users integer,
  admin_notes text,
  created_at timestamptz,
  last_access_at timestamptz,
  user_count bigint,
  lead_count bigint
)
language sql
stable
security invoker
as $$
  select
    o.id,
    o.name,
    o.logo_url,
    o.is_active,
    o.subscription_status,
    o.max_users,
    o.admin_notes,
    o.created_at,
    o.last_access_at,
    (select count(*) from public.organization_members om where om.organization_id = o.id and om.is_active = true) as user_count,
    (select count(*) from public.leads l where l.organization_id = o.id) as lead_count
  from public.organizations o
  where private.is_super_admin()
  order by o.created_at desc
$$;

create or replace function public.list_all_users_admin()
returns table(
  id uuid,
  name text,
  email text,
  avatar_url text,
  role text,
  organization_id uuid,
  organization_name text,
  is_active boolean,
  created_at timestamptz
)
language sql
stable
security invoker
as $$
  select
    u.id,
    u.name,
    u.email,
    u.avatar_url,
    u.role,
    u.organization_id,
    o.name as organization_name,
    u.is_active,
    u.created_at
  from public.users u
  left join public.organizations o on o.id = u.organization_id
  where private.is_super_admin()
  order by u.created_at desc
$$;

grant execute on function public.user_has_permission(text, uuid) to authenticated;
grant execute on function public.is_team_leader(uuid) to authenticated;
grant execute on function public.get_user_led_team_ids() to authenticated;
grant execute on function public.get_dashboard_team_lead_ids(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.count_unique_sessions(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_dashboard_stats() to authenticated;
grant execute on function public.get_funnel_data(timestamptz, timestamptz, uuid, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.get_lead_sources_data(timestamptz, timestamptz, uuid, uuid, text, uuid, uuid, text) to authenticated;
grant execute on function public.list_contacts_paginated(text, uuid, uuid, uuid, uuid, boolean, uuid, text, text, timestamptz, timestamptz, text, text, integer, integer, text, text, text) to authenticated;
grant execute on function public.create_default_stages_for_pipeline(uuid, uuid) to authenticated;
grant execute on function public.reorder_stages(jsonb) to authenticated;
grant execute on function public.transfer_lead_assignee(uuid, uuid) to authenticated;
grant execute on function public.move_lead_stage(uuid, uuid, boolean, timestamptz) to authenticated;
grant execute on function public.register_lead_reentry(uuid, uuid, text, text, uuid, numeric, text, text, text, text, jsonb) to authenticated;
grant execute on function public.redistribute_lead_round_robin(uuid) to authenticated;
grant execute on function public.handle_lead_intake(uuid) to authenticated;
grant execute on function public.rebind_whatsapp_conversation_session(uuid, uuid, text) to authenticated;
grant execute on function public.find_orphan_team_members() to authenticated;
grant execute on function public.find_orphan_rr_members() to authenticated;
grant execute on function public.cleanup_orphan_members() to authenticated;
grant execute on function public.list_all_organizations_admin() to authenticated;
grant execute on function public.list_all_users_admin() to authenticated;


-- END supabase\drafts\20260621_008_frontend_rpc_compatibility.sql
