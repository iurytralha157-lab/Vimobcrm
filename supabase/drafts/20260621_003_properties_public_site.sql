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
