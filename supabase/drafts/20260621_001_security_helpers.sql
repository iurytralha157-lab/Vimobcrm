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
