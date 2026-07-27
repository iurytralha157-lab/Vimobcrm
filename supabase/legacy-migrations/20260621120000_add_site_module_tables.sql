create table if not exists public.organization_sites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  is_active boolean not null default false,
  subdomain text,
  custom_domain text,
  domain_verified boolean not null default false,
  domain_verified_at timestamptz,
  site_title text,
  site_description text,
  logo_url text,
  favicon_url text,
  primary_color text,
  secondary_color text,
  accent_color text,
  whatsapp text,
  phone text,
  email text,
  address text,
  city text,
  state text,
  instagram text,
  facebook text,
  youtube text,
  linkedin text,
  about_title text,
  about_text text,
  about_image_url text,
  seo_title text,
  seo_description text,
  seo_keywords text,
  google_analytics_id text,
  hero_image_url text,
  hero_title text,
  hero_subtitle text,
  page_banner_url text,
  logo_width integer,
  logo_height integer,
  watermark_enabled boolean,
  watermark_opacity integer,
  watermark_logo_url text,
  watermark_size integer,
  watermark_position text,
  site_theme text not null default 'dark',
  background_color text not null default '#0D0D0D',
  text_color text not null default '#FFFFFF',
  card_color text not null default '#FFFFFF',
  show_about_on_home boolean default false,
  about_subtitle text,
  about_stats jsonb,
  about_checkmarks jsonb,
  about_features jsonb,
  gtm_id text,
  meta_pixel_id text,
  google_ads_id text,
  head_scripts text,
  body_scripts text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_sites_unique_org unique (organization_id),
  constraint organization_sites_unique_subdomain unique (subdomain),
  constraint organization_sites_unique_custom_domain unique (custom_domain)
);

create table if not exists public.site_menu_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  label text not null,
  link_type text not null,
  href text not null,
  position integer not null default 0,
  open_in_new_tab boolean default false,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.site_search_filters (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  filter_key text not null,
  label text not null,
  position integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

create table if not exists public.site_analytics_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  event_type text not null default 'page_view',
  page_path text not null,
  page_title text,
  referrer text,
  session_id text,
  device_type text,
  browser text,
  screen_width integer,
  screen_height integer,
  duration_seconds integer,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  created_at timestamptz not null default now()
);

create index if not exists idx_organization_sites_organization_id on public.organization_sites(organization_id);
create index if not exists idx_organization_sites_subdomain on public.organization_sites(subdomain);
create index if not exists idx_organization_sites_custom_domain on public.organization_sites(custom_domain);
create index if not exists idx_site_menu_items_organization_id on public.site_menu_items(organization_id);
create index if not exists idx_site_menu_items_position on public.site_menu_items(organization_id, position);
create index if not exists idx_site_search_filters_organization_id on public.site_search_filters(organization_id);
create index if not exists idx_site_search_filters_position on public.site_search_filters(organization_id, position);
create index if not exists idx_site_analytics_events_organization_id on public.site_analytics_events(organization_id);
create index if not exists idx_site_analytics_events_created_at on public.site_analytics_events(created_at desc);
create index if not exists idx_site_analytics_events_type on public.site_analytics_events(organization_id, event_type);

drop trigger if exists set_updated_at_organization_sites on public.organization_sites;
create trigger set_updated_at_organization_sites
before update on public.organization_sites
for each row execute function private.set_updated_at();

alter table public.organization_sites enable row level security;
alter table public.site_menu_items enable row level security;
alter table public.site_search_filters enable row level security;
alter table public.site_analytics_events enable row level security;

revoke all on public.organization_sites from anon, authenticated;
revoke all on public.site_menu_items from anon, authenticated;
revoke all on public.site_search_filters from anon, authenticated;
revoke all on public.site_analytics_events from anon, authenticated;

grant select on public.organization_sites to anon, authenticated;
grant insert, update, delete on public.organization_sites to authenticated;

grant select on public.site_menu_items to anon, authenticated;
grant insert, update, delete on public.site_menu_items to authenticated;

grant select on public.site_search_filters to anon, authenticated;
grant insert, update, delete on public.site_search_filters to authenticated;

grant select on public.site_analytics_events to authenticated;
grant insert on public.site_analytics_events to anon, authenticated;

create policy "public can read active organization sites"
on public.organization_sites
for select
to anon, authenticated
using (is_active = true);

create policy "members can read organization sites"
on public.organization_sites
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organization_sites.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

create policy "admins can manage organization sites"
on public.organization_sites
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organization_sites.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = organization_sites.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
);

create policy "public can read active site menu items"
on public.site_menu_items
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.organization_sites os
    where os.organization_id = site_menu_items.organization_id
      and os.is_active = true
  )
);

create policy "members can read site menu items"
on public.site_menu_items
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_menu_items.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

create policy "admins can manage site menu items"
on public.site_menu_items
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_menu_items.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_menu_items.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
);

create policy "public can read active site search filters"
on public.site_search_filters
for select
to anon, authenticated
using (
  is_active = true
  and exists (
    select 1
    from public.organization_sites os
    where os.organization_id = site_search_filters.organization_id
      and os.is_active = true
  )
);

create policy "members can read site search filters"
on public.site_search_filters
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_search_filters.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);

create policy "admins can manage site search filters"
on public.site_search_filters
for all
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_search_filters.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
)
with check (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_search_filters.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
      and om.role in ('owner', 'admin')
  )
);

create policy "public can insert site analytics events"
on public.site_analytics_events
for insert
to anon, authenticated
with check (
  exists (
    select 1
    from public.organization_sites os
    where os.organization_id = site_analytics_events.organization_id
      and os.is_active = true
  )
);

create policy "members can read site analytics events"
on public.site_analytics_events
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_members om
    where om.organization_id = site_analytics_events.organization_id
      and om.user_id = (select auth.uid())
      and om.is_active = true
  )
);
