-- Additional contract alignment for the new Supabase project.

create table if not exists public.property_feature_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  icon text,
  created_at timestamptz not null default now()
);

create table if not exists public.property_proximity_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  icon text,
  created_at timestamptz not null default now()
);

create unique index if not exists property_feature_catalog_org_name_unique
  on public.property_feature_catalog (organization_id, lower(name));

create unique index if not exists property_proximity_catalog_org_name_unique
  on public.property_proximity_catalog (organization_id, lower(name));

create index if not exists idx_property_feature_catalog_org
  on public.property_feature_catalog (organization_id);

create index if not exists idx_property_proximity_catalog_org
  on public.property_proximity_catalog (organization_id);

do $$
begin
  if to_regclass('public.property_features') is not null then
    insert into public.property_feature_catalog (organization_id, name, icon, created_at)
    select organization_id, name, icon, coalesce(created_at, now())
    from public.property_features
    where organization_id is not null
      and nullif(trim(name), '') is not null
    on conflict do nothing;
  end if;

  if to_regclass('public.property_proximities') is not null then
    insert into public.property_proximity_catalog (organization_id, name, icon, created_at)
    select organization_id, name, icon, coalesce(created_at, now())
    from public.property_proximities
    where organization_id is not null
      and nullif(trim(name), '') is not null
    on conflict do nothing;
  end if;
end $$;

alter table if exists public.property_feature_catalog enable row level security;
alter table if exists public.property_proximity_catalog enable row level security;

revoke all on public.property_feature_catalog from anon, authenticated;
revoke all on public.property_proximity_catalog from anon, authenticated;
grant select, insert, update, delete on public.property_feature_catalog to service_role;
grant select, insert, update, delete on public.property_proximity_catalog to service_role;

alter table if exists public.organization_api_keys
  add column if not exists key_prefix text,
  add column if not exists updated_at timestamptz not null default now();

update public.organization_api_keys
set key_prefix = coalesce(nullif(key_prefix, ''), left(coalesce(key_hash, ''), 14))
where key_prefix is null
   or key_prefix = '';

alter table if exists public.organization_api_keys
  alter column key_prefix set default '',
  alter column key_prefix set not null;
