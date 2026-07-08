-- Align properties/team availability tables with the backend contracts used by Vimob API.

alter table if exists public.member_availability
  add column if not exists organization_id uuid;

update public.member_availability ma
set organization_id = teams.organization_id
from public.team_members tm
join public.teams teams
  on teams.id = tm.team_id
where ma.team_member_id = tm.id
  and ma.organization_id is null;

create index if not exists idx_member_availability_organization_member
  on public.member_availability (organization_id, team_member_id);

create unique index if not exists idx_member_availability_member_day
  on public.member_availability (team_member_id, day_of_week);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_availability'
      and column_name = 'organization_id'
      and is_nullable = 'YES'
  ) and not exists (
    select 1
    from public.member_availability
    where organization_id is null
  ) then
    alter table public.member_availability
      alter column organization_id set not null;
  end if;
end $$;

alter table if exists public.property_owners
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_property_owners_created_by
  on public.property_owners (created_by);

create index if not exists idx_property_owners_org_created_by
  on public.property_owners (organization_id, created_by);

alter table if exists public.property_owners enable row level security;

drop policy if exists "members read property owners" on public.property_owners;
create policy "members read property owners"
  on public.property_owners
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "members create property owners" on public.property_owners;
create policy "members create property owners"
  on public.property_owners
  for insert
  to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "members update own property owners" on public.property_owners;
create policy "members update own property owners"
  on public.property_owners
  for update
  to authenticated
  using (
    private.has_org_role(organization_id, array['owner', 'admin', 'manager'])
    or created_by = auth.uid()
    or exists (
      select 1
      from public.properties p
      where p.organization_id = property_owners.organization_id
        and p.owner_id = property_owners.id
        and (p.created_by = auth.uid() or p.responsible_user_id = auth.uid())
    )
  )
  with check (private.is_org_member(organization_id));
