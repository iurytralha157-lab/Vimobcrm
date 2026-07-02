create schema if not exists private;

create or replace function private.is_org_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.organization_id = target_organization_id
      and coalesce(u.is_active, true) = true
  )
  or exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = target_organization_id
      and coalesce(om.is_active, true) = true
  );
$$;

create or replace function private.has_org_role(target_organization_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and u.organization_id = target_organization_id
      and coalesce(u.is_active, true) = true
      and u.role = any(allowed_roles)
  )
  or exists (
    select 1
    from public.organization_members om
    where om.user_id = auth.uid()
      and om.organization_id = target_organization_id
      and coalesce(om.is_active, true) = true
      and om.role = any(allowed_roles)
  )
  or exists (
    select 1
    from public.users u
    where u.id = auth.uid()
      and coalesce(u.is_active, true) = true
      and u.role = 'super_admin'
  );
$$;

create or replace function private.has_permission(target_organization_id uuid, permission_key text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  allowed boolean;
begin
  if private.has_org_role(target_organization_id, array['owner', 'admin', 'super_admin']) then
    return true;
  end if;

  if to_regprocedure('public.user_has_permission(text, uuid)') is not null then
    execute 'select public.user_has_permission($1, auth.uid())'
      into allowed
      using permission_key;

    return coalesce(allowed, false) and private.is_org_member(target_organization_id);
  end if;

  return false;
end;
$$;

grant execute on function private.is_org_member(uuid) to authenticated;
grant execute on function private.has_org_role(uuid, text[]) to authenticated;
grant execute on function private.has_permission(uuid, text) to authenticated;

alter table public.gamification_missions
  add column if not exists action_type text,
  add column if not exists target_scope text not null default 'organization',
  add column if not exists target_user_id uuid references public.users(id) on delete set null;

create table if not exists public.gamification_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_type text not null,
  points integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_rules_unique unique (organization_id, action_type)
);

create table if not exists public.gamification_participants (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  participates boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists public.gamification_seasons (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  reset_reason text,
  is_active boolean not null default true,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.gamification_manual_entries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  action_key text not null,
  quantity integer not null default 1,
  notes text,
  status text not null default 'pending',
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gamification_manual_entries_status_check check (status in ('pending', 'approved', 'rejected')),
  constraint gamification_manual_entries_quantity_check check (quantity between 1 and 100)
);

create index if not exists idx_gamification_rules_org on public.gamification_rules(organization_id, action_type);
create index if not exists idx_gamification_participants_org on public.gamification_participants(organization_id, participates);
create index if not exists idx_gamification_seasons_org on public.gamification_seasons(organization_id, is_active, started_at desc);
create index if not exists idx_gamification_manual_entries_org_status on public.gamification_manual_entries(organization_id, status, created_at desc);
create index if not exists idx_gamification_manual_entries_user on public.gamification_manual_entries(user_id, created_at desc);

alter table public.gamification_rules enable row level security;
alter table public.gamification_participants enable row level security;
alter table public.gamification_seasons enable row level security;
alter table public.gamification_manual_entries enable row level security;

grant select, insert, update, delete on public.gamification_rules to authenticated;
grant select, insert, update, delete on public.gamification_participants to authenticated;
grant select, insert, update, delete on public.gamification_seasons to authenticated;
grant select, insert, update, delete on public.gamification_manual_entries to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['gamification_rules', 'gamification_participants', 'gamification_seasons']
  loop
    execute format('drop policy if exists %I on public.%I', 'members read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'gamification admins manage ' || t, t);
    execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'members read ' || t, t);
    execute format('create policy %I on public.%I for all to authenticated using (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin''])) with check (private.has_permission(organization_id, ''gamification_manage'') or private.has_org_role(organization_id, array[''owner'', ''admin'']))', 'gamification admins manage ' || t, t);
  end loop;
end $$;

drop policy if exists "members read gamification manual entries" on public.gamification_manual_entries;
create policy "members read gamification manual entries"
on public.gamification_manual_entries
for select
to authenticated
using (
  user_id = auth.uid()
  or private.has_permission(organization_id, 'gamification_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
);

drop policy if exists "members create own gamification manual entries" on public.gamification_manual_entries;
create policy "members create own gamification manual entries"
on public.gamification_manual_entries
for insert
to authenticated
with check (
  user_id = auth.uid()
  and private.is_org_member(organization_id)
);

drop policy if exists "gamification admins manage manual entries" on public.gamification_manual_entries;
create policy "gamification admins manage manual entries"
on public.gamification_manual_entries
for update
to authenticated
using (
  private.has_permission(organization_id, 'gamification_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
)
with check (
  private.has_permission(organization_id, 'gamification_manage')
  or private.has_org_role(organization_id, array['owner', 'admin'])
);
