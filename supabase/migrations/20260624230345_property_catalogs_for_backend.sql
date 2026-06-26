create table if not exists public.property_feature_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.property_proximity_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  icon text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists property_feature_catalog_org_name_unique
on public.property_feature_catalog (organization_id, lower(name));

create unique index if not exists property_proximity_catalog_org_name_unique
on public.property_proximity_catalog (organization_id, lower(name));

create index if not exists idx_property_feature_catalog_org
on public.property_feature_catalog (organization_id);

create index if not exists idx_property_proximity_catalog_org
on public.property_proximity_catalog (organization_id);

alter table public.property_feature_catalog enable row level security;
alter table public.property_proximity_catalog enable row level security;

revoke all on public.property_feature_catalog from anon, authenticated;
revoke all on public.property_proximity_catalog from anon, authenticated;

grant select, insert, update, delete on public.property_feature_catalog to service_role;
grant select, insert, update, delete on public.property_proximity_catalog to service_role;
