-- Launches and developments foundation.
--
-- The hierarchy is intentionally separate from `property_condominiums` and
-- `properties`: a development is a commercial product with lifecycle and
-- inventory, while a condominium is an operational/legal location and a
-- property is an individually marketable asset. Units may be promoted to a
-- property later through the optional property_id link.

create unique index if not exists properties_organization_id_id_uidx
  on public.properties (organization_id, id);

create table if not exists public.property_developers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  name text not null,
  legal_name text,
  tax_id text,
  country_code text not null default 'BR',
  website_url text,
  email text,
  phone text,
  logo_url text,
  status text not null default 'active',
  external_provider text,
  external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_developers_org_id_unique
    unique (organization_id, id),
  constraint property_developers_name_check
    check (length(btrim(name)) between 2 and 160),
  constraint property_developers_country_check
    check (country_code ~ '^[A-Z]{2}$'),
  constraint property_developers_status_check
    check (status in ('active', 'inactive', 'archived')),
  constraint property_developers_external_pair_check
    check (num_nonnulls(external_provider, external_id) in (0, 2)),
  constraint property_developers_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_developers is
  'Organization-scoped developers and construction companies for launches.';

create table if not exists public.property_developments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  developer_id uuid,
  code text not null,
  name text not null,
  development_type text not null default 'vertical',
  status text not null default 'planning',
  commercial_status text not null default 'draft',
  construction_progress numeric(5, 2) not null default 0,
  registration_number text,
  summary text,
  description text,
  address text,
  address_number text,
  complement text,
  neighborhood text,
  city text,
  state text,
  postal_code text,
  latitude numeric(10, 7),
  longitude numeric(10, 7),
  public_address_visibility text not null default 'approximate',
  launch_date date,
  construction_started_at date,
  expected_delivery_date date,
  delivered_at date,
  main_image_url text,
  image_urls text[] not null default '{}'::text[],
  amenities text[] not null default '{}'::text[],
  video_url text,
  virtual_tour_url text,
  published_on_site boolean not null default false,
  responsible_user_id uuid references public.users(id) on delete set null,
  external_provider text,
  external_id text,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_developments_org_id_unique
    unique (organization_id, id),
  constraint property_developments_developer_fkey
    foreign key (organization_id, developer_id)
    references public.property_developers (organization_id, id)
    on delete restrict,
  constraint property_developments_code_check
    check (length(btrim(code)) between 1 and 80),
  constraint property_developments_name_check
    check (length(btrim(name)) between 2 and 200),
  constraint property_developments_type_check
    check (
      development_type in (
        'vertical',
        'horizontal',
        'mixed_use',
        'land_subdivision',
        'commercial'
      )
    ),
  constraint property_developments_status_check
    check (
      status in (
        'planning',
        'pre_launch',
        'launched',
        'under_construction',
        'ready',
        'delivered',
        'suspended',
        'cancelled',
        'archived'
      )
    ),
  constraint property_developments_commercial_status_check
    check (commercial_status in ('draft', 'active', 'paused', 'sold_out', 'closed')),
  constraint property_developments_progress_check
    check (construction_progress between 0 and 100),
  constraint property_developments_state_check
    check (state is null or state ~ '^[A-Z]{2}$'),
  constraint property_developments_latitude_check
    check (latitude is null or latitude between -90 and 90),
  constraint property_developments_longitude_check
    check (longitude is null or longitude between -180 and 180),
  constraint property_developments_address_visibility_check
    check (public_address_visibility in ('exact', 'approximate', 'hidden')),
  constraint property_developments_delivery_check
    check (
      expected_delivery_date is null
      or launch_date is null
      or expected_delivery_date >= launch_date
    ),
  constraint property_developments_delivered_check
    check (
      delivered_at is null
      or construction_started_at is null
      or delivered_at >= construction_started_at
    ),
  constraint property_developments_external_pair_check
    check (num_nonnulls(external_provider, external_id) in (0, 2)),
  constraint property_developments_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_developments is
  'Commercial launch and development lifecycle, distinct from condominiums.';

create table if not exists public.property_development_phases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  code text not null,
  name text not null,
  sort_order integer not null default 0,
  status text not null default 'planned',
  launch_date date,
  construction_started_at date,
  expected_delivery_date date,
  delivered_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_phases_scope_unique
    unique (organization_id, development_id, id),
  constraint property_development_phases_development_fkey
    foreign key (organization_id, development_id)
    references public.property_developments (organization_id, id)
    on delete restrict,
  constraint property_development_phases_code_check
    check (length(btrim(code)) between 1 and 80),
  constraint property_development_phases_name_check
    check (length(btrim(name)) between 1 and 160),
  constraint property_development_phases_sort_check
    check (sort_order >= 0),
  constraint property_development_phases_status_check
    check (
      status in (
        'planned',
        'pre_launch',
        'launched',
        'under_construction',
        'delivered',
        'suspended',
        'cancelled'
      )
    ),
  constraint property_development_phases_delivery_check
    check (
      expected_delivery_date is null
      or launch_date is null
      or expected_delivery_date >= launch_date
    ),
  constraint property_development_phases_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.property_development_buildings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  phase_id uuid not null,
  code text not null,
  name text not null,
  building_type text not null default 'tower',
  floor_count integer,
  sort_order integer not null default 0,
  status text not null default 'planned',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_buildings_scope_unique
    unique (organization_id, development_id, id),
  constraint property_development_buildings_development_fkey
    foreign key (organization_id, development_id)
    references public.property_developments (organization_id, id)
    on delete restrict,
  constraint property_development_buildings_phase_fkey
    foreign key (organization_id, development_id, phase_id)
    references public.property_development_phases (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_buildings_code_check
    check (length(btrim(code)) between 1 and 80),
  constraint property_development_buildings_name_check
    check (length(btrim(name)) between 1 and 160),
  constraint property_development_buildings_type_check
    check (building_type in ('tower', 'block', 'quadra', 'sector', 'street')),
  constraint property_development_buildings_floor_check
    check (floor_count is null or floor_count >= 0),
  constraint property_development_buildings_sort_check
    check (sort_order >= 0),
  constraint property_development_buildings_status_check
    check (status in ('planned', 'active', 'delivered', 'inactive')),
  constraint property_development_buildings_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.property_development_floor_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  code text not null,
  name text not null,
  status text not null default 'draft',
  property_type text,
  bedrooms integer,
  suites integer,
  bathrooms integer,
  parking_spaces integer,
  private_area numeric(12, 2),
  total_area numeric(12, 2),
  balcony_area numeric(12, 2),
  garden_area numeric(12, 2),
  description text,
  image_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_floor_plans_scope_unique
    unique (organization_id, development_id, id),
  constraint property_development_floor_plans_development_fkey
    foreign key (organization_id, development_id)
    references public.property_developments (organization_id, id)
    on delete restrict,
  constraint property_development_floor_plans_code_check
    check (length(btrim(code)) between 1 and 80),
  constraint property_development_floor_plans_name_check
    check (length(btrim(name)) between 1 and 160),
  constraint property_development_floor_plans_status_check
    check (status in ('draft', 'active', 'inactive', 'archived')),
  constraint property_development_floor_plans_counts_check
    check (
      (bedrooms is null or bedrooms >= 0)
      and (suites is null or suites >= 0)
      and (bathrooms is null or bathrooms >= 0)
      and (parking_spaces is null or parking_spaces >= 0)
      and (suites is null or bedrooms is null or suites <= bedrooms)
    ),
  constraint property_development_floor_plans_areas_check
    check (
      (private_area is null or private_area > 0)
      and (total_area is null or total_area > 0)
      and (balcony_area is null or balcony_area > 0)
      and (garden_area is null or garden_area > 0)
      and (total_area is null or private_area is null or total_area >= private_area)
    ),
  constraint property_development_floor_plans_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.property_development_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  building_id uuid not null,
  floor_plan_id uuid,
  property_id uuid,
  code text not null,
  unit_number text not null,
  floor_number integer,
  position text,
  orientation text,
  private_area numeric(12, 2),
  total_area numeric(12, 2),
  ideal_fraction numeric(12, 8),
  status text not null default 'available',
	published boolean not null default false,
	publication_pending boolean not null default false,
  external_provider text,
  external_id text,
  source_updated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_units_scope_unique
    unique (organization_id, development_id, id),
  constraint property_development_units_development_fkey
    foreign key (organization_id, development_id)
    references public.property_developments (organization_id, id)
    on delete restrict,
  constraint property_development_units_building_fkey
    foreign key (organization_id, development_id, building_id)
    references public.property_development_buildings (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_units_floor_plan_fkey
    foreign key (organization_id, development_id, floor_plan_id)
    references public.property_development_floor_plans (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_units_property_fkey
    foreign key (organization_id, property_id)
    references public.properties (organization_id, id)
    on delete restrict,
  constraint property_development_units_code_check
    check (length(btrim(code)) between 1 and 100),
  constraint property_development_units_number_check
    check (length(btrim(unit_number)) between 1 and 80),
  constraint property_development_units_status_check
    check (
      status in (
        'available',
        'negotiation',
        'reserved',
        'sold',
        'blocked',
        'unavailable',
        'withdrawn'
      )
    ),
  constraint property_development_units_areas_check
    check (
      (private_area is null or private_area > 0)
      and (total_area is null or total_area > 0)
      and (total_area is null or private_area is null or total_area >= private_area)
      and (ideal_fraction is null or ideal_fraction > 0)
    ),
  constraint property_development_units_external_pair_check
    check (num_nonnulls(external_provider, external_id) in (0, 2)),
  constraint property_development_units_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.property_development_units
	add column if not exists publication_pending boolean not null default false,
	alter column published set default false;

create table if not exists public.property_development_price_tables (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  name text not null,
  version integer not null,
  status text not null default 'draft',
  currency text not null default 'BRL',
  valid_from date,
  valid_until date,
  notes text,
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_price_tables_scope_unique
    unique (organization_id, development_id, id),
  constraint property_development_price_tables_version_unique
    unique (development_id, version),
  constraint property_development_price_tables_development_fkey
    foreign key (organization_id, development_id)
    references public.property_developments (organization_id, id)
    on delete restrict,
  constraint property_development_price_tables_name_check
    check (length(btrim(name)) between 1 and 160),
  constraint property_development_price_tables_version_check
    check (version > 0),
  constraint property_development_price_tables_status_check
    check (status in ('draft', 'approved', 'active', 'expired', 'archived')),
  constraint property_development_price_tables_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint property_development_price_tables_validity_check
    check (valid_until is null or valid_from is null or valid_until >= valid_from),
  constraint property_development_price_tables_approval_check
    check (
      status = 'draft'
      or status = 'archived'
      or approved_at is not null
    ),
  constraint property_development_price_tables_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.property_development_price_tables
  drop constraint if exists property_development_price_tables_approval_check;
alter table public.property_development_price_tables
  add constraint property_development_price_tables_approval_check
  check (
    status = 'draft'
    or status = 'archived'
    or approved_at is not null
  );

create table if not exists public.property_development_unit_prices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  price_table_id uuid not null,
  unit_id uuid not null,
  list_price numeric(16, 2) not null,
  minimum_price numeric(16, 2),
  price_per_sqm numeric(16, 2),
  payment_terms jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_unit_prices_table_unit_unique
    unique (price_table_id, unit_id),
  constraint property_development_unit_prices_price_table_fkey
    foreign key (organization_id, development_id, price_table_id)
    references public.property_development_price_tables (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_unit_prices_unit_fkey
    foreign key (organization_id, development_id, unit_id)
    references public.property_development_units (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_unit_prices_amounts_check
    check (
      list_price > 0
      and (minimum_price is null or minimum_price > 0)
      and (minimum_price is null or minimum_price <= list_price)
      and (price_per_sqm is null or price_per_sqm > 0)
    ),
  constraint property_development_unit_prices_payment_object_check
    check (jsonb_typeof(payment_terms) = 'object'),
  constraint property_development_unit_prices_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.property_development_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  unit_id uuid not null,
  lead_id uuid references public.leads(id) on delete set null,
  price_table_id uuid,
  status text not null default 'active',
  reserved_by uuid not null references public.users(id) on delete restrict,
  updated_by uuid references public.users(id) on delete set null,
  expires_at timestamptz,
  converted_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  list_price_snapshot numeric(16, 2),
  currency text not null default 'BRL',
  payment_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_development_reservations_unit_fkey
    foreign key (organization_id, development_id, unit_id)
    references public.property_development_units (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_reservations_price_table_fkey
    foreign key (organization_id, development_id, price_table_id)
    references public.property_development_price_tables (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_reservations_status_check
    check (status in ('active', 'converted', 'cancelled', 'expired')),
  constraint property_development_reservations_expiration_check
    check (
      (status <> 'active' or expires_at is not null)
      and (expires_at is null or expires_at > created_at)
    ),
  constraint property_development_reservations_price_check
    check (list_price_snapshot is null or list_price_snapshot > 0),
  constraint property_development_reservations_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint property_development_reservations_idempotency_check
    check (
      idempotency_key is null
      or length(btrim(idempotency_key)) between 1 and 200
    ),
  constraint property_development_reservations_payment_object_check
    check (jsonb_typeof(payment_snapshot) = 'object'),
  constraint property_development_reservations_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

alter table public.property_development_reservations
  add column if not exists updated_by uuid
  references public.users(id) on delete set null;

create table if not exists public.property_development_unit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  development_id uuid not null,
  unit_id uuid not null,
  event_type text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_development_unit_events_unit_fkey
    foreign key (organization_id, development_id, unit_id)
    references public.property_development_units (
      organization_id,
      development_id,
      id
    )
    on delete restrict,
  constraint property_development_unit_events_type_check
    check (
      event_type in (
        'created',
        'updated',
        'status_changed',
        'price_changed',
        'property_linked',
        'reservation_created',
        'reservation_released',
        'imported'
      )
    ),
  constraint property_development_unit_events_before_object_check
    check (before_data is null or jsonb_typeof(before_data) = 'object'),
  constraint property_development_unit_events_after_object_check
    check (after_data is null or jsonb_typeof(after_data) = 'object'),
  constraint property_development_unit_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists property_developers_org_name_uidx
  on public.property_developers (organization_id, lower(btrim(name)));

create unique index if not exists property_developers_org_tax_uidx
  on public.property_developers (
    organization_id,
    country_code,
    regexp_replace(tax_id, '[^0-9A-Za-z]', '', 'g')
  )
  where tax_id is not null;

create unique index if not exists property_developers_external_uidx
  on public.property_developers (organization_id, external_provider, external_id)
  where external_provider is not null and external_id is not null;

create index if not exists property_developers_org_status_name_idx
  on public.property_developers (organization_id, status, lower(name));

create unique index if not exists property_developments_org_code_uidx
  on public.property_developments (organization_id, lower(btrim(code)));

create unique index if not exists property_developments_external_uidx
  on public.property_developments (organization_id, external_provider, external_id)
  where external_provider is not null and external_id is not null;

create index if not exists property_developments_org_status_updated_idx
  on public.property_developments (organization_id, status, updated_at desc);

create index if not exists property_developments_org_commercial_idx
  on public.property_developments (organization_id, commercial_status, updated_at desc);

create index if not exists property_developments_developer_idx
  on public.property_developments (organization_id, developer_id);

create index if not exists property_developments_responsible_idx
  on public.property_developments (organization_id, responsible_user_id);

create index if not exists property_developments_location_idx
  on public.property_developments (organization_id, state, city, neighborhood);

create unique index if not exists property_development_phases_code_uidx
  on public.property_development_phases (
    development_id,
    lower(btrim(code))
  );

create index if not exists property_development_phases_order_idx
  on public.property_development_phases (
    organization_id,
    development_id,
    sort_order,
    name
  );

create unique index if not exists property_development_buildings_code_uidx
  on public.property_development_buildings (
    development_id,
    lower(btrim(code))
  );

create unique index if not exists property_development_buildings_phase_name_uidx
  on public.property_development_buildings (
    phase_id,
    lower(btrim(name))
  );

create index if not exists property_development_buildings_order_idx
  on public.property_development_buildings (
    organization_id,
    development_id,
    phase_id,
    sort_order,
    name
  );

create unique index if not exists property_development_floor_plans_code_uidx
  on public.property_development_floor_plans (
    development_id,
    lower(btrim(code))
  );

create index if not exists property_development_floor_plans_status_idx
  on public.property_development_floor_plans (
    organization_id,
    development_id,
    status,
    private_area
  );

create unique index if not exists property_development_units_code_uidx
  on public.property_development_units (
    development_id,
    lower(btrim(code))
  );

create unique index if not exists property_development_units_number_uidx
  on public.property_development_units (
    building_id,
    lower(btrim(unit_number))
  );

create unique index if not exists property_development_units_property_uidx
  on public.property_development_units (property_id)
  where property_id is not null;

create unique index if not exists property_development_units_external_uidx
  on public.property_development_units (organization_id, external_provider, external_id)
  where external_provider is not null and external_id is not null;

create index if not exists property_development_units_status_idx
  on public.property_development_units (
    organization_id,
    development_id,
    status,
    building_id,
    floor_number
  );

create index if not exists property_development_units_available_idx
  on public.property_development_units (
    organization_id,
    development_id,
    building_id,
    floor_plan_id,
    floor_number
  )
  where status = 'available' and published;

create index if not exists property_development_units_publication_pending_idx
	on public.property_development_units (organization_id, development_id)
	where publication_pending;

create index if not exists property_development_units_floor_plan_idx
  on public.property_development_units (
    organization_id,
    floor_plan_id,
    status
  );

create unique index if not exists property_development_price_tables_active_uidx
  on public.property_development_price_tables (development_id)
  where status = 'active';

create index if not exists property_development_price_tables_status_idx
  on public.property_development_price_tables (
    organization_id,
    development_id,
    status,
    version desc
  );

create index if not exists property_development_unit_prices_unit_idx
  on public.property_development_unit_prices (
    organization_id,
    development_id,
    unit_id,
    price_table_id
  );

create unique index if not exists property_development_reservations_active_uidx
  on public.property_development_reservations (unit_id)
  where status = 'active';

create unique index if not exists property_development_reservations_idempotency_uidx
  on public.property_development_reservations (organization_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists property_development_reservations_expiration_idx
  on public.property_development_reservations (organization_id, expires_at)
  where status = 'active';

create index if not exists property_development_reservations_lead_idx
  on public.property_development_reservations (organization_id, lead_id, created_at desc);

create index if not exists property_development_reservations_lead_fk_idx
  on public.property_development_reservations (lead_id)
  where lead_id is not null;

create index if not exists property_development_reservations_updated_by_idx
  on public.property_development_reservations (updated_by)
  where updated_by is not null;

create index if not exists property_development_unit_events_unit_time_idx
  on public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    created_at desc,
    id desc
  );

create index if not exists property_development_unit_events_development_time_idx
  on public.property_development_unit_events (
    organization_id,
    development_id,
    created_at desc,
    id desc
  );

create or replace function private.enforce_property_development_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  user_column text;
  user_text text;
  user_id uuid;
begin
  foreach user_column in array array[
    'created_by',
    'updated_by',
    'responsible_user_id',
    'approved_by',
    'reserved_by'
  ]::text[]
  loop
	if tg_op = 'UPDATE' then
	  if new.organization_id is not distinct from old.organization_id
	     and (to_jsonb(new) ->> user_column) is not distinct from (to_jsonb(old) ->> user_column) then
	    continue;
	  end if;
	end if;

    user_text := nullif(btrim(to_jsonb(new) ->> user_column), '');
    if user_text is null then
      continue;
    end if;

    user_id := private.safe_uuid(user_text);
    if user_id is null
       or not private.property_user_belongs_to_organization(
         new.organization_id,
         user_id
       ) then
      raise exception using
        errcode = '23514',
        message = format(
          'property_development_user_cross_tenant_reference:%s',
          user_column
        );
    end if;
  end loop;

  -- PL/pgSQL resolves fields on a generic trigger record before SQL boolean
  -- short-circuiting. Keep the table guard in its own block so tables without
  -- lead_id never attempt to dereference that field.
  if tg_table_name = 'property_development_reservations' then
	if tg_op = 'UPDATE' then
	  if new.organization_id is not distinct from old.organization_id
	     and new.lead_id is not distinct from old.lead_id then
	    return new;
	  end if;
	end if;

    if new.lead_id is not null
       and not exists (
         select 1
         from public.leads as lead
         where lead.id = new.lead_id
           and lead.organization_id = new.organization_id
       ) then
      raise exception using
        errcode = '23514',
        message = 'property_development_lead_cross_tenant_reference';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_property_development_tenant_scope()
  from public, anon, authenticated, service_role;

create or replace function private.guard_property_development_price_table()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status in ('active', 'expired', 'archived')
     and (
       new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.development_id is distinct from old.development_id
       or new.name is distinct from old.name
       or new.version is distinct from old.version
       or new.currency is distinct from old.currency
       or new.valid_from is distinct from old.valid_from
       or (
         new.valid_until is distinct from old.valid_until
         and not (
           old.status = 'active'
           and new.status = 'expired'
           and old.valid_until is null
         )
       )
       or new.notes is distinct from old.notes
       or new.approved_at is distinct from old.approved_at
       or new.metadata is distinct from old.metadata
       or new.created_at is distinct from old.created_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_price_table_is_immutable';
  end if;

  if new.status is distinct from old.status
     and not (
       (old.status = 'draft' and new.status in ('approved', 'active', 'archived'))
       or (old.status = 'approved' and new.status in ('draft', 'active', 'archived'))
       or (old.status = 'active' and new.status in ('expired', 'archived'))
       or (old.status = 'expired' and new.status = 'archived')
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_price_table_transition_invalid';
  end if;

  return new;
end;
$$;

revoke all on function private.guard_property_development_price_table()
  from public, anon, authenticated, service_role;

create or replace function private.guard_property_development_unit_price()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_price_table_id uuid;
  target_status text;
begin
  target_price_table_id := new.price_table_id;

  select price_table.status
  into target_status
  from public.property_development_price_tables as price_table
  where price_table.id = target_price_table_id;

  if target_status is distinct from 'draft' then
    if tg_op = 'INSERT' then
      raise exception using
        errcode = '23514',
        message = 'property_development_unit_price_requires_draft_table';
    end if;

    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.development_id is distinct from old.development_id
       or new.price_table_id is distinct from old.price_table_id
       or new.unit_id is distinct from old.unit_id
       or new.list_price is distinct from old.list_price
       or new.minimum_price is distinct from old.minimum_price
       or new.price_per_sqm is distinct from old.price_per_sqm
       or new.payment_terms is distinct from old.payment_terms
       or new.metadata is distinct from old.metadata
       or new.created_at is distinct from old.created_at
       or (
         new.created_by is distinct from old.created_by
         and new.created_by is not null
       )
       or (
         new.updated_by is distinct from old.updated_by
         and new.updated_by is not null
       ) then
      raise exception using
        errcode = '23514',
        message = 'property_development_unit_price_requires_draft_table';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_property_development_unit_price()
  from public, anon, authenticated, service_role;

create or replace function private.guard_property_development_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.development_id is distinct from old.development_id
     or new.unit_id is distinct from old.unit_id
     or (
       new.lead_id is distinct from old.lead_id
       and not (old.lead_id is not null and new.lead_id is null)
     )
     or new.price_table_id is distinct from old.price_table_id
     or new.reserved_by is distinct from old.reserved_by
     or new.list_price_snapshot is distinct from old.list_price_snapshot
     or new.currency is distinct from old.currency
     or new.payment_snapshot is distinct from old.payment_snapshot
     or new.idempotency_key is distinct from old.idempotency_key
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_identity_is_immutable';
  end if;

  if new.status is distinct from old.status
     and not (
       old.status = 'active'
       and new.status in ('converted', 'cancelled', 'expired')
     ) then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_transition_invalid';
  end if;

  if new.status = 'active'
     and new.expires_at is distinct from old.expires_at
     and new.expires_at <= now() then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_expiration_invalid';
  end if;

  if old.status = 'active' and new.status = 'converted' then
    new.converted_at := now();
    new.cancelled_at := null;
  elsif old.status = 'active' and new.status = 'cancelled' then
    new.cancelled_at := now();
    new.converted_at := null;
  elsif old.status = 'active' and new.status = 'expired' then
    new.converted_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_property_development_reservation()
  from public, anon, authenticated, service_role;

create or replace function private.capture_property_development_unit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_name text;
begin
  if tg_op = 'INSERT' then
    event_name := 'created';
  elsif new.status is distinct from old.status then
    event_name := 'status_changed';
  elsif new.property_id is distinct from old.property_id then
    event_name := 'property_linked';
  else
    event_name := 'updated';
  end if;

  insert into public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    event_type,
    before_data,
    after_data,
    created_by
  ) values (
    new.organization_id,
    new.development_id,
    new.id,
    event_name,
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    coalesce(new.updated_by, new.created_by)
  );

  return new;
end;
$$;

revoke all on function private.capture_property_development_unit_event()
  from public, anon, authenticated, service_role;

create or replace function private.capture_property_development_unit_price_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_row public.property_development_unit_prices%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.id is not distinct from old.id
       and new.organization_id is not distinct from old.organization_id
       and new.development_id is not distinct from old.development_id
       and new.price_table_id is not distinct from old.price_table_id
       and new.unit_id is not distinct from old.unit_id
       and new.list_price is not distinct from old.list_price
       and new.minimum_price is not distinct from old.minimum_price
       and new.price_per_sqm is not distinct from old.price_per_sqm
       and new.payment_terms is not distinct from old.payment_terms
       and new.metadata is not distinct from old.metadata then
      return new;
    end if;
  end if;

  source_row := new;

  insert into public.property_development_unit_events (
    organization_id,
    development_id,
    unit_id,
    event_type,
    before_data,
    after_data,
    created_by,
    metadata
  ) values (
    source_row.organization_id,
    source_row.development_id,
    source_row.unit_id,
    'price_changed',
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    to_jsonb(new),
    coalesce(source_row.updated_by, source_row.created_by),
    jsonb_build_object('price_table_id', source_row.price_table_id)
  );

  return new;
end;
$$;

revoke all on function private.capture_property_development_unit_price_event()
  from public, anon, authenticated, service_role;

create or replace function private.apply_property_development_reservation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_unit_status text;
	current_unit_published boolean;
	current_unit_publication_pending boolean;
	has_active_unit_price boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'active' then
      return new;
    end if;

	if new.expires_at is null or new.expires_at <= now() then
		raise exception using
			errcode = '23514',
			message = 'property_development_reservation_expiration_invalid';
	end if;

	select unit.status, unit.published, unit.publication_pending
	into current_unit_status, current_unit_published, current_unit_publication_pending
    from public.property_development_units as unit
    where unit.id = new.unit_id
      and unit.organization_id = new.organization_id
      and unit.development_id = new.development_id
    for update;

	if current_unit_status not in ('available', 'negotiation')
	   or not current_unit_published
	   or current_unit_publication_pending then
      raise exception using
        errcode = '23514',
		message = 'property_development_unit_not_commercially_available_for_reservation';
    end if;

	select exists (
		select 1
		from public.property_development_unit_prices as unit_price
		join public.property_development_price_tables as price_table
		  on price_table.id = unit_price.price_table_id
		 and price_table.organization_id = unit_price.organization_id
		 and price_table.development_id = unit_price.development_id
		where unit_price.organization_id = new.organization_id
		  and unit_price.development_id = new.development_id
		  and unit_price.unit_id = new.unit_id
		  and unit_price.price_table_id = new.price_table_id
		  and price_table.status = 'active'
	)
	into has_active_unit_price;

	if not has_active_unit_price then
		raise exception using
			errcode = '23514',
			message = 'property_development_reservation_requires_active_unit_price';
	end if;

    update public.property_development_units
    set status = 'reserved',
		updated_by = coalesce(new.updated_by, new.reserved_by),
        updated_at = now()
    where id = new.unit_id
      and organization_id = new.organization_id
      and development_id = new.development_id;

    return new;
  end if;

  if old.status <> 'active' and new.status = 'active' then
    raise exception using
      errcode = '23514',
      message = 'property_development_reservation_cannot_reactivate';
  end if;

  if old.status = 'active' and new.status = 'converted' then
    update public.property_development_units
    set status = 'sold',
		published = false,
		publication_pending = false,
		updated_by = coalesce(new.updated_by, new.reserved_by),
        updated_at = now()
    where id = new.unit_id
	  and organization_id = new.organization_id
	  and development_id = new.development_id
      and status = 'reserved';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'property_development_reserved_unit_state_invalid';
    end if;
  elsif old.status = 'active' and new.status in ('cancelled', 'expired') then
    update public.property_development_units
    set status = 'available',
		updated_by = coalesce(new.updated_by, new.reserved_by),
        updated_at = now()
    where id = new.unit_id
	  and organization_id = new.organization_id
	  and development_id = new.development_id
      and status = 'reserved';

    if not found then
      raise exception using
        errcode = '23514',
        message = 'property_development_reserved_unit_state_invalid';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_property_development_reservation()
  from public, anon, authenticated, service_role;

drop trigger if exists trg_property_developers_updated_at
  on public.property_developers;
create trigger trg_property_developers_updated_at
before update on public.property_developers
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_developments_updated_at
  on public.property_developments;
create trigger trg_property_developments_updated_at
before update on public.property_developments
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_phases_updated_at
  on public.property_development_phases;
create trigger trg_property_development_phases_updated_at
before update on public.property_development_phases
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_buildings_updated_at
  on public.property_development_buildings;
create trigger trg_property_development_buildings_updated_at
before update on public.property_development_buildings
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_floor_plans_updated_at
  on public.property_development_floor_plans;
create trigger trg_property_development_floor_plans_updated_at
before update on public.property_development_floor_plans
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_units_updated_at
  on public.property_development_units;
create trigger trg_property_development_units_updated_at
before update on public.property_development_units
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_price_tables_updated_at
  on public.property_development_price_tables;
create trigger trg_property_development_price_tables_updated_at
before update on public.property_development_price_tables
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_unit_prices_updated_at
  on public.property_development_unit_prices;
create trigger trg_property_development_unit_prices_updated_at
before update on public.property_development_unit_prices
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_property_development_reservations_updated_at
  on public.property_development_reservations;
create trigger trg_property_development_reservations_updated_at
before update on public.property_development_reservations
for each row execute function public.update_updated_at_column();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'property_developers',
    'property_developments',
    'property_development_phases',
    'property_development_buildings',
    'property_development_floor_plans',
    'property_development_units',
    'property_development_price_tables',
    'property_development_unit_prices',
    'property_development_reservations',
    'property_development_unit_events'
  ]::text[]
  loop
    execute format(
      'drop trigger if exists trg_%I_tenant_scope on public.%I',
      table_name,
      table_name
    );
    execute format(
      'create trigger trg_%I_tenant_scope before insert or update on public.%I for each row execute function private.enforce_property_development_tenant_scope()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

drop trigger if exists trg_property_development_price_table_guard
  on public.property_development_price_tables;
create trigger trg_property_development_price_table_guard
before update on public.property_development_price_tables
for each row execute function private.guard_property_development_price_table();

drop trigger if exists trg_property_development_unit_price_guard
  on public.property_development_unit_prices;
create trigger trg_property_development_unit_price_guard
before insert or update on public.property_development_unit_prices
for each row execute function private.guard_property_development_unit_price();

drop trigger if exists trg_property_development_reservation_guard
  on public.property_development_reservations;
create trigger trg_property_development_reservation_guard
before update on public.property_development_reservations
for each row execute function private.guard_property_development_reservation();

drop trigger if exists trg_property_development_unit_event
  on public.property_development_units;
create trigger trg_property_development_unit_event
after insert or update on public.property_development_units
for each row execute function private.capture_property_development_unit_event();

drop trigger if exists trg_property_development_unit_price_event
  on public.property_development_unit_prices;
create trigger trg_property_development_unit_price_event
after insert or update on public.property_development_unit_prices
for each row execute function private.capture_property_development_unit_price_event();

drop trigger if exists trg_property_development_reservation_state
  on public.property_development_reservations;
create trigger trg_property_development_reservation_state
after insert or update of status on public.property_development_reservations
for each row execute function private.apply_property_development_reservation();

alter table public.property_developers enable row level security;
alter table public.property_developments enable row level security;
alter table public.property_development_phases enable row level security;
alter table public.property_development_buildings enable row level security;
alter table public.property_development_floor_plans enable row level security;
alter table public.property_development_units enable row level security;
alter table public.property_development_price_tables enable row level security;
alter table public.property_development_unit_prices enable row level security;
alter table public.property_development_reservations enable row level security;
alter table public.property_development_unit_events enable row level security;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'property_developers',
    'property_developments',
    'property_development_phases',
    'property_development_buildings',
    'property_development_floor_plans',
    'property_development_units',
    'property_development_price_tables',
    'property_development_unit_prices',
    'property_development_reservations'
  ]::text[]
  loop
    execute format('drop policy if exists "development viewers read %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "development viewers read %1$s" on public.%1$I for select to authenticated using ((select private.has_permission(%1$I.organization_id, ''property_view'')) or (select private.has_permission(%1$I.organization_id, ''property_manage'')))',
      table_name
    );
    execute format('drop policy if exists "development managers manage %1$s" on public.%1$I', table_name);
    execute format('drop policy if exists "development managers create %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "development managers create %1$s" on public.%1$I for insert to authenticated with check ((select private.has_permission(%1$I.organization_id, ''property_manage'')))',
      table_name
    );
    execute format('drop policy if exists "development managers update %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "development managers update %1$s" on public.%1$I for update to authenticated using ((select private.has_permission(%1$I.organization_id, ''property_manage''))) with check ((select private.has_permission(%1$I.organization_id, ''property_manage'')))',
      table_name
    );
    execute format('drop policy if exists "development managers delete %1$s" on public.%1$I', table_name);
    execute format(
      'create policy "development managers delete %1$s" on public.%1$I for delete to authenticated using ((select private.has_permission(%1$I.organization_id, ''property_manage'')))',
      table_name
    );
  end loop;
end;
$$;

drop policy if exists "development managers delete property_development_price_tables"
  on public.property_development_price_tables;
drop policy if exists "development managers delete property_development_unit_prices"
  on public.property_development_unit_prices;
drop policy if exists "development managers delete property_development_reservations"
  on public.property_development_reservations;

drop policy if exists "development viewers read unit events"
  on public.property_development_unit_events;
create policy "development viewers read unit events"
on public.property_development_unit_events
for select
to authenticated
using (
  (select private.has_permission(
    property_development_unit_events.organization_id,
    'property_view'
  ))
  or (select private.has_permission(
    property_development_unit_events.organization_id,
    'property_manage'
  ))
);

drop policy if exists "development managers create unit events"
  on public.property_development_unit_events;
create policy "development managers create unit events"
on public.property_development_unit_events
for insert
to authenticated
with check (
  (select private.has_permission(
    property_development_unit_events.organization_id,
    'property_manage'
  ))
);

-- Backend-owned tables. RLS remains as defense in depth for a future direct
-- surface, but the browser deliberately receives no table privileges.
revoke all on table public.property_developers
  from public, anon, authenticated, service_role;
revoke all on table public.property_developments
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_phases
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_buildings
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_floor_plans
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_units
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_price_tables
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_unit_prices
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_reservations
  from public, anon, authenticated, service_role;
revoke all on table public.property_development_unit_events
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.property_developers,
  public.property_developments,
  public.property_development_phases,
  public.property_development_buildings,
  public.property_development_floor_plans,
  public.property_development_units
  to service_role;

grant select, insert, update
  on table
  public.property_development_price_tables,
  public.property_development_unit_prices,
  public.property_development_reservations
  to service_role;

grant select, insert
  on table public.property_development_unit_events
  to service_role;
