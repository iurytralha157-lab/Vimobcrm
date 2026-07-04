alter table public.properties
  add column if not exists owner_id uuid,
  add column if not exists aceita_permuta boolean default false;

alter table public.properties
  alter column aceita_permuta set default false;

update public.properties
set aceita_permuta = false
where aceita_permuta is null;

alter table public.property_condominiums
  add column if not exists photo_url text,
  add column if not exists cep text,
  add column if not exists number text,
  add column if not exists complement text,
  add column if not exists default_condominium_fee numeric(14,2),
  add column if not exists has_concierge boolean not null default false,
  add column if not exists concierge_type text,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.property_owners (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone_residential text,
  phone_commercial text,
  cellphone text,
  email text,
  media_source text,
  notify_email boolean not null default false,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.properties
  drop constraint if exists properties_owner_id_fkey,
  add constraint properties_owner_id_fkey
    foreign key (owner_id) references public.property_owners(id) on delete set null;

create index if not exists idx_properties_org_accepts_exchange
  on public.properties (organization_id, aceita_permuta);

create index if not exists idx_properties_org_owner
  on public.properties (organization_id, owner_id);

create index if not exists idx_property_owners_org_name
  on public.property_owners (organization_id, lower(name));

create unique index if not exists property_owners_org_identity_unique
  on public.property_owners (
    organization_id,
    lower(name),
    coalesce(cellphone, ''),
    coalesce(email, '')
  );

alter table public.property_owners enable row level security;

drop policy if exists "property owners read by organization" on public.property_owners;
create policy "property owners read by organization"
on public.property_owners
for select
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin', 'manager']));

drop policy if exists "property owners manage by organization" on public.property_owners;
create policy "property owners manage by organization"
on public.property_owners
for all
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin', 'manager']))
with check (private.has_org_role(organization_id, array['owner', 'admin', 'manager']));

grant select, insert, update, delete on public.property_owners to service_role;

insert into public.property_cities (organization_id, name, uf)
select distinct
  p.organization_id,
  btrim(p.cidade),
  nullif(upper(btrim(p.uf)), '')
from public.properties p
where nullif(btrim(p.cidade), '') is not null
on conflict do nothing;

update public.properties p
set city_id = c.id
from public.property_cities c
where p.city_id is null
  and c.organization_id = p.organization_id
  and lower(c.name) = lower(btrim(p.cidade))
  and coalesce(c.uf, '') = coalesce(nullif(upper(btrim(p.uf)), ''), '');

insert into public.property_neighborhoods (organization_id, city_id, name)
select distinct
  p.organization_id,
  p.city_id,
  btrim(p.bairro)
from public.properties p
where p.city_id is not null
  and nullif(btrim(p.bairro), '') is not null
on conflict do nothing;

update public.properties p
set neighborhood_id = n.id
from public.property_neighborhoods n
where p.neighborhood_id is null
  and n.organization_id = p.organization_id
  and n.city_id = p.city_id
  and lower(n.name) = lower(btrim(p.bairro));

insert into public.property_owners (
  organization_id,
  name,
  phone_residential,
  phone_commercial,
  cellphone,
  email,
  media_source,
  notify_email
)
select distinct on (
  p.organization_id,
  lower(btrim(p.owner_name)),
  coalesce(nullif(btrim(p.owner_cellphone), ''), ''),
  coalesce(nullif(lower(btrim(p.owner_email)), ''), '')
)
  p.organization_id,
  btrim(p.owner_name),
  nullif(btrim(p.owner_phone_residential), ''),
  nullif(btrim(p.owner_phone_commercial), ''),
  nullif(btrim(p.owner_cellphone), ''),
  nullif(lower(btrim(p.owner_email)), ''),
  nullif(btrim(p.owner_media_source), ''),
  coalesce(p.owner_notify_email, false)
from public.properties p
where nullif(btrim(p.owner_name), '') is not null
on conflict do nothing;

update public.properties p
set owner_id = po.id
from public.property_owners po
where p.owner_id is null
  and po.organization_id = p.organization_id
  and lower(po.name) = lower(btrim(p.owner_name))
  and coalesce(po.cellphone, '') = coalesce(nullif(btrim(p.owner_cellphone), ''), '')
  and coalesce(po.email, '') = coalesce(nullif(lower(btrim(p.owner_email)), ''), '');
