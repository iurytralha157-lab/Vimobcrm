-- Relational real-estate foundation.
--
-- `properties` remains the compatibility aggregate consumed by the current
-- application. These tables add normalized offers, ownership, assets and key
-- custody without removing or renaming any legacy column. The locked backfill
-- is intentionally additive: retries fill missing rows and never overwrite a
-- record already maintained through the normalized model.

create table if not exists public.property_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  offer_type text not null,
  status text not null default 'draft',
  price numeric(16, 2),
  currency text not null default 'BRL',
  price_period text,
  terms jsonb not null default '{}'::jsonb,
  available_from date,
  available_until date,
  published_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_offers_property_type_unique
    unique (property_id, offer_type),
  constraint property_offers_type_check
    check (offer_type in ('sale', 'rent', 'seasonal')),
  constraint property_offers_status_check
    check (
      status in (
        'draft',
        'active',
        'paused',
        'reserved',
        'completed',
        'withdrawn',
        'expired'
      )
    ),
  constraint property_offers_price_check
    check (price is null or price >= 0),
  constraint property_offers_currency_check
    check (currency ~ '^[A-Z]{3}$'),
  constraint property_offers_price_period_check
    check (
      price_period is null
      or price_period in ('total', 'daily', 'weekly', 'monthly', 'yearly')
    ),
  constraint property_offers_sale_period_check
    check (
      offer_type <> 'sale'
      or price_period is null
      or price_period = 'total'
    ),
  constraint property_offers_availability_check
    check (
      available_until is null
      or available_from is null
      or available_until >= available_from
    ),
  constraint property_offers_terms_object_check
    check (jsonb_typeof(terms) = 'object'),
  constraint property_offers_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_offers is
  'Independent sale, long-term rental and seasonal offers for one property.';

create table if not exists public.property_ownerships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  owner_id uuid not null
    references public.property_owners(id) on delete restrict,
  ownership_percentage numeric(5, 2) not null default 100,
  is_primary boolean not null default false,
  valid_from date not null default current_date,
  valid_to date,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_ownerships_owner_period_unique
    unique (property_id, owner_id, valid_from),
  constraint property_ownerships_percentage_check
    check (
      ownership_percentage > 0
      and ownership_percentage <= 100
    ),
  constraint property_ownerships_validity_check
    check (valid_to is null or valid_to >= valid_from)
);

comment on table public.property_ownerships is
  'Time-bounded many-to-many ownership, including share and principal owner.';

create table if not exists public.property_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  asset_type text not null,
  visibility text not null default 'internal',
  storage_path text,
  external_url text,
  title text,
  description text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  checksum_sha256 text,
  sort_order integer not null default 0,
  is_primary boolean not null default false,
  document_category text,
  expires_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_assets_type_check
    check (
      asset_type in (
        'photo',
        'video',
        'virtual_tour',
        'floor_plan',
        'document'
      )
    ),
  constraint property_assets_visibility_check
    check (visibility in ('public', 'internal', 'confidential')),
  constraint property_assets_locator_check
    check (
      num_nonnulls(
        nullif(btrim(storage_path), ''),
        nullif(btrim(external_url), '')
      ) = 1
    ),
  constraint property_assets_size_check
    check (file_size_bytes is null or file_size_bytes >= 0),
  constraint property_assets_checksum_check
    check (
      checksum_sha256 is null
      or checksum_sha256 ~ '^[0-9a-fA-F]{64}$'
    ),
  constraint property_assets_sort_order_check
    check (sort_order >= 0),
  constraint property_assets_document_category_check
    check (asset_type = 'document' or document_category is null),
  constraint property_assets_expiration_check
    check (asset_type = 'document' or expires_at is null),
  constraint property_assets_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_assets is
  'Metadata for media and documents. Storage access remains governed separately.';

create table if not exists public.property_keys (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_id uuid not null
    references public.properties(id) on delete cascade,
  label text not null default 'Chave principal',
  key_code text,
  status text not null default 'available',
  current_location text,
  holder_user_id uuid references public.users(id) on delete set null,
  holder_name text,
  checked_out_at timestamptz,
  expected_return_at timestamptz,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_keys_label_check
    check (length(btrim(label)) between 1 and 120),
  constraint property_keys_code_check
    check (key_code is null or length(btrim(key_code)) between 1 and 120),
  constraint property_keys_status_check
    check (status in ('available', 'checked_out', 'lost', 'inactive')),
  constraint property_keys_expected_return_check
    check (
      expected_return_at is null
      or checked_out_at is null
      or expected_return_at >= checked_out_at
    ),
  constraint property_keys_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_keys is
  'Current custody state for each physical key or key set of a property.';

create table if not exists public.property_key_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  property_key_id uuid not null
    references public.property_keys(id) on delete restrict,
  movement_type text not null,
  holder_user_id uuid references public.users(id) on delete set null,
  holder_name text,
  from_location text,
  to_location text,
  occurred_at timestamptz not null default now(),
  expected_return_at timestamptz,
  idempotency_key text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_key_movements_type_check
    check (
      movement_type in (
        'registration',
        'checkout',
        'transfer',
        'return',
        'location_change',
        'mark_lost',
        'mark_found',
        'deactivate',
        'reactivate'
      )
    ),
  constraint property_key_movements_holder_check
    check (
      movement_type not in ('checkout', 'transfer')
      or holder_user_id is not null
      or nullif(btrim(holder_name), '') is not null
    ),
  constraint property_key_movements_expected_return_check
    check (
      expected_return_at is null
      or expected_return_at >= occurred_at
    ),
  constraint property_key_movements_idempotency_check
    check (
      idempotency_key is null
      or length(btrim(idempotency_key)) between 1 and 200
    ),
  constraint property_key_movements_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

comment on table public.property_key_movements is
  'Append-only custody events; the event trigger maintains property_keys state.';

create index if not exists property_offers_org_status_idx
  on public.property_offers (organization_id, status, offer_type, price);

create index if not exists property_offers_property_status_idx
  on public.property_offers (property_id, status);

create index if not exists property_ownerships_org_owner_idx
  on public.property_ownerships (
    organization_id,
    owner_id,
    valid_to
  );

create index if not exists property_ownerships_property_validity_idx
  on public.property_ownerships (property_id, valid_from, valid_to);

create unique index if not exists property_ownerships_open_primary_uidx
  on public.property_ownerships (property_id)
  where is_primary and valid_to is null;

create index if not exists property_assets_property_order_idx
  on public.property_assets (
    organization_id,
    property_id,
    asset_type,
    sort_order
  );

create unique index if not exists property_assets_external_locator_uidx
  on public.property_assets (property_id, asset_type, external_url)
  where external_url is not null;

create unique index if not exists property_assets_storage_locator_uidx
  on public.property_assets (property_id, asset_type, storage_path)
  where storage_path is not null;

create unique index if not exists property_assets_primary_photo_uidx
  on public.property_assets (property_id)
  where asset_type = 'photo' and is_primary;

create index if not exists property_keys_org_status_idx
  on public.property_keys (organization_id, property_id, status);

create unique index if not exists property_keys_property_label_uidx
  on public.property_keys (property_id, lower(btrim(label)));

create unique index if not exists property_keys_org_code_uidx
  on public.property_keys (organization_id, lower(btrim(key_code)))
  where key_code is not null;

create index if not exists property_key_movements_key_time_idx
  on public.property_key_movements (
    organization_id,
    property_key_id,
    occurred_at desc
  );

create index if not exists property_key_movements_due_idx
  on public.property_key_movements (organization_id, expected_return_at)
  where movement_type in ('checkout', 'transfer')
    and expected_return_at is not null;

create unique index if not exists property_key_movements_idempotency_uidx
  on public.property_key_movements (organization_id, idempotency_key)
  where idempotency_key is not null;

-- A regular foreign key guarantees that a reference exists. This trigger adds
-- the tenant invariant that a reference must also belong to the same
-- organization, while leaving potentially inconsistent legacy rows untouched.
create or replace function private.enforce_real_estate_tenant_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  referenced_organization_id uuid;
  referenced_user_column text;
  referenced_user_text text;
  referenced_user_id uuid;
begin
  if tg_table_name in (
    'property_offers',
    'property_ownerships',
    'property_assets',
    'property_keys'
  ) then
    select property.organization_id
    into referenced_organization_id
    from public.properties as property
    where property.id = new.property_id;

    if referenced_organization_id is not null
       and referenced_organization_id is distinct from new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'real_estate_property_cross_tenant_reference';
    end if;
  end if;

  if tg_table_name = 'property_ownerships' then
    select owner.organization_id
    into referenced_organization_id
    from public.property_owners as owner
    where owner.id = new.owner_id;

    if referenced_organization_id is not null
       and referenced_organization_id is distinct from new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'real_estate_owner_cross_tenant_reference';
    end if;
  end if;

  if tg_table_name = 'property_key_movements' then
    select property_key.organization_id
    into referenced_organization_id
    from public.property_keys as property_key
    where property_key.id = new.property_key_id;

    if referenced_organization_id is not null
       and referenced_organization_id is distinct from new.organization_id then
      raise exception using
        errcode = '23514',
        message = 'real_estate_key_cross_tenant_reference';
    end if;
  end if;

  foreach referenced_user_column in array array[
    'created_by',
    'updated_by',
    'holder_user_id'
  ]::text[]
  loop
    referenced_user_text := nullif(
      btrim(to_jsonb(new) ->> referenced_user_column),
      ''
    );

    if referenced_user_text is null then
      continue;
    end if;

    referenced_user_id := private.safe_uuid(referenced_user_text);
    if referenced_user_id is null
       or not private.property_user_belongs_to_organization(
         new.organization_id,
         referenced_user_id
       ) then
      raise exception using
        errcode = '23514',
        message = format(
          'real_estate_user_cross_tenant_reference:%s',
          referenced_user_column
        );
    end if;
  end loop;

  return new;
end;
$$;

revoke all on function private.enforce_real_estate_tenant_scope()
  from public, anon, authenticated, service_role;

-- Policy-only helper. SECURITY DEFINER is required because normalized tables
-- stay behind the BFF and authenticated roles cannot select `properties` or
-- `property_keys` directly. The result discloses no row data and delegates the
-- actual own/team/all decision to the canonical property visibility helper.
create or replace function private.can_view_real_estate_record(
  target_organization_id uuid,
  target_property_id uuid,
  target_property_key_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    target_organization_id is not null
    and (select auth.uid()) is not null
    and exists (
      select 1
      from public.properties as property
      where property.organization_id = target_organization_id
        and (
          property.id = target_property_id
          or exists (
            select 1
            from public.property_keys as property_key
            where property_key.id = target_property_key_id
              and property_key.organization_id = target_organization_id
              and property_key.property_id = property.id
          )
        )
        and private.can_view_property_record(
          property.organization_id,
          property.created_by,
          property.responsible_user_id
        )
    );
$$;

comment on function private.can_view_real_estate_record(uuid, uuid, uuid) is
  'Delegates normalized property rows to the canonical own/team/all visibility contract.';

revoke all on function private.can_view_real_estate_record(uuid, uuid, uuid)
  from public, anon;
grant execute on function private.can_view_real_estate_record(uuid, uuid, uuid)
  to authenticated, service_role;

create or replace function private.validate_property_ownership_allocation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Serialize allocations per property so concurrent inserts cannot both
  -- observe a total at or below 100 percent and then over-allocate it.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.property_id::text, 0)
  );

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
    )
    select 1
    from boundaries
    where (
      select coalesce(sum(ownership.ownership_percentage), 0)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to >= boundaries.boundary_date
        )
    ) > 100
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_allocation_exceeds_100';
  end if;

  if exists (
    with boundaries as (
      select distinct ownership.valid_from as boundary_date
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
    )
    select 1
    from boundaries
    where (
      select count(*)
      from public.property_ownerships as ownership
      where ownership.property_id = new.property_id
        and ownership.is_primary
        and ownership.valid_from <= boundaries.boundary_date
        and (
          ownership.valid_to is null
          or ownership.valid_to >= boundaries.boundary_date
        )
    ) > 1
  ) then
    raise exception using
      errcode = '23514',
      message = 'property_ownership_primary_period_overlap';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_property_ownership_allocation()
  from public, anon, authenticated, service_role;

create or replace function private.apply_property_key_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_key public.property_keys%rowtype;
begin
  select property_key.*
  into current_key
  from public.property_keys as property_key
  where property_key.id = new.property_key_id
    and property_key.organization_id = new.organization_id
  for update;

  if not found then
    return new;
  end if;

  if new.movement_type = 'checkout' then
    if current_key.status <> 'available' then
      raise exception using
        errcode = '23514',
        message = 'property_key_not_available';
    end if;

    update public.property_keys
    set status = 'checked_out',
        holder_user_id = new.holder_user_id,
        holder_name = nullif(btrim(new.holder_name), ''),
        checked_out_at = new.occurred_at,
        expected_return_at = new.expected_return_at
    where id = new.property_key_id;
  elsif new.movement_type = 'transfer' then
    if current_key.status <> 'checked_out' then
      raise exception using
        errcode = '23514',
        message = 'property_key_not_checked_out';
    end if;

    update public.property_keys
    set holder_user_id = new.holder_user_id,
        holder_name = nullif(btrim(new.holder_name), ''),
        expected_return_at = new.expected_return_at
    where id = new.property_key_id;
  elsif new.movement_type = 'return' then
    if current_key.status <> 'checked_out' then
      raise exception using
        errcode = '23514',
        message = 'property_key_not_checked_out';
    end if;

    update public.property_keys
    set status = 'available',
        current_location = coalesce(
          nullif(btrim(new.to_location), ''),
          current_location
        ),
        holder_user_id = null,
        holder_name = null,
        checked_out_at = null,
        expected_return_at = null
    where id = new.property_key_id;
  elsif new.movement_type = 'location_change' then
    if current_key.status <> 'available'
       or nullif(btrim(new.to_location), '') is null then
      raise exception using
        errcode = '23514',
        message = 'property_key_location_change_invalid';
    end if;

    update public.property_keys
    set current_location = btrim(new.to_location)
    where id = new.property_key_id;
  elsif new.movement_type = 'mark_lost' then
    if current_key.status = 'inactive' then
      raise exception using
        errcode = '23514',
        message = 'property_key_inactive';
    end if;

    update public.property_keys
    set status = 'lost'
    where id = new.property_key_id;
  elsif new.movement_type = 'mark_found' then
    if current_key.status <> 'lost' then
      raise exception using
        errcode = '23514',
        message = 'property_key_not_lost';
    end if;

    update public.property_keys
    set status = 'available',
        current_location = coalesce(
          nullif(btrim(new.to_location), ''),
          current_location
        ),
        holder_user_id = null,
        holder_name = null,
        checked_out_at = null,
        expected_return_at = null
    where id = new.property_key_id;
  elsif new.movement_type = 'deactivate' then
    update public.property_keys
    set status = 'inactive',
        holder_user_id = null,
        holder_name = null,
        checked_out_at = null,
        expected_return_at = null
    where id = new.property_key_id;
  elsif new.movement_type = 'reactivate' then
    if current_key.status <> 'inactive' then
      raise exception using
        errcode = '23514',
        message = 'property_key_not_inactive';
    end if;

    update public.property_keys
    set status = 'available',
        current_location = coalesce(
          nullif(btrim(new.to_location), ''),
          current_location
        )
    where id = new.property_key_id;
  elsif new.movement_type = 'registration' then
    if current_key.status <> 'available'
       or exists (
         select 1
         from public.property_key_movements as prior_movement
         where prior_movement.property_key_id = new.property_key_id
           and prior_movement.id <> new.id
       ) then
      raise exception using
        errcode = '23514',
        message = 'property_key_registration_not_initial';
    end if;

    update public.property_keys
    set status = 'available',
        current_location = coalesce(
          nullif(btrim(new.to_location), ''),
          current_location
        )
    where id = new.property_key_id;
  end if;

  return new;
end;
$$;

revoke all on function private.apply_property_key_movement()
  from public, anon, authenticated, service_role;

drop trigger if exists property_offers_tenant_scope
  on public.property_offers;
create trigger property_offers_tenant_scope
before insert or update of
  organization_id, property_id, created_by, updated_by
on public.property_offers
for each row
execute function private.enforce_real_estate_tenant_scope();

drop trigger if exists property_ownerships_tenant_scope
  on public.property_ownerships;
create trigger property_ownerships_tenant_scope
before insert or update of
  organization_id, property_id, owner_id, created_by
on public.property_ownerships
for each row
execute function private.enforce_real_estate_tenant_scope();

drop trigger if exists property_assets_tenant_scope
  on public.property_assets;
create trigger property_assets_tenant_scope
before insert or update of organization_id, property_id, created_by
on public.property_assets
for each row
execute function private.enforce_real_estate_tenant_scope();

drop trigger if exists property_keys_tenant_scope
  on public.property_keys;
create trigger property_keys_tenant_scope
before insert or update of
  organization_id, property_id, holder_user_id, created_by
on public.property_keys
for each row
execute function private.enforce_real_estate_tenant_scope();

drop trigger if exists property_key_movements_tenant_scope
  on public.property_key_movements;
create trigger property_key_movements_tenant_scope
before insert or update of
  organization_id, property_key_id, holder_user_id, created_by
on public.property_key_movements
for each row
execute function private.enforce_real_estate_tenant_scope();

drop trigger if exists property_ownerships_validate_allocation
  on public.property_ownerships;
create constraint trigger property_ownerships_validate_allocation
after insert or update
on public.property_ownerships
deferrable initially immediate
for each row
execute function private.validate_property_ownership_allocation();

drop trigger if exists property_key_movements_apply_state
  on public.property_key_movements;
create trigger property_key_movements_apply_state
after insert
on public.property_key_movements
for each row
execute function private.apply_property_key_movement();

drop trigger if exists property_offers_set_updated_at
  on public.property_offers;
create trigger property_offers_set_updated_at
before update on public.property_offers
for each row execute function public.update_updated_at_column();

drop trigger if exists property_ownerships_set_updated_at
  on public.property_ownerships;
create trigger property_ownerships_set_updated_at
before update on public.property_ownerships
for each row execute function public.update_updated_at_column();

drop trigger if exists property_assets_set_updated_at
  on public.property_assets;
create trigger property_assets_set_updated_at
before update on public.property_assets
for each row execute function public.update_updated_at_column();

drop trigger if exists property_keys_set_updated_at
  on public.property_keys;
create trigger property_keys_set_updated_at
before update on public.property_keys
for each row execute function public.update_updated_at_column();

-- The function remains available to trusted database operators so a phased
-- import can safely be retried. It never updates or deletes normalized rows.
create or replace function private.backfill_real_estate_foundation()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  with normalized as (
    select
      property.*,
      lower(
        concat_ws(
          ' ',
          nullif(btrim(property.finalidade), ''),
          nullif(btrim(property.tipo_de_negocio), '')
        )
      ) as deal_text,
      lower(coalesce(property.status, '')) as legacy_status
    from public.properties as property
  ),
  classified as (
    select
      normalized.*,
      (
        deal_text like '%venda%'
        or deal_text like '%sale%'
        or deal_text like '%lanc%'
      ) as has_sale,
      (
        deal_text like '%alug%'
        or deal_text like '%loca%'
        or deal_text like '%rent%'
      ) as has_rent,
      (
        deal_text like '%temporada%'
        or deal_text like '%season%'
      ) as has_seasonal
    from normalized
  ),
  offer_candidates as (
    select
      classified.*,
      candidate.offer_type,
      candidate.price,
      candidate.price_period
    from classified
    cross join lateral (
      values
        (
          'sale'::text,
          case when classified.preco >= 0 then classified.preco end,
          'total'::text,
          classified.has_sale
          or (
            not classified.has_sale
            and not classified.has_rent
            and not classified.has_seasonal
            and classified.preco is not null
          )
        ),
        (
          'rent'::text,
          coalesce(
            case
              when classified.valor_locacao >= 0
                then classified.valor_locacao
            end,
            case when classified.preco >= 0 then classified.preco end
          ),
          'monthly'::text,
          classified.has_rent and not classified.has_seasonal
        ),
        (
          'seasonal'::text,
          coalesce(
            case
              when classified.valor_locacao >= 0
                then classified.valor_locacao
            end,
            case when classified.preco >= 0 then classified.preco end
          ),
          'daily'::text,
          classified.has_seasonal
        )
    ) as candidate(offer_type, price, price_period, eligible)
    where candidate.eligible
  )
  insert into public.property_offers (
    organization_id,
    property_id,
    offer_type,
    status,
    price,
    currency,
    price_period,
    terms,
    created_by,
    metadata,
    created_at,
    updated_at
  )
  select
    candidate.organization_id,
    candidate.id,
    candidate.offer_type,
    case
      when candidate.offer_type = 'sale'
           and candidate.legacy_status in ('sold', 'vendido')
        then 'completed'
      when candidate.offer_type in ('rent', 'seasonal')
           and candidate.legacy_status in (
             'rented',
             'alugado',
             'locado'
           )
        then 'completed'
      when candidate.legacy_status in ('reserved', 'reservado')
        then 'reserved'
      when candidate.legacy_status in (
        'active',
        'available',
        'ativo',
        'disponivel'
      ) then 'active'
      when candidate.legacy_status in ('draft', 'rascunho')
        then 'draft'
      when candidate.legacy_status in (
        'inactive',
        'archived',
        'inativo',
        'arquivado'
      ) then 'withdrawn'
      else 'paused'
    end,
    candidate.price,
    'BRL',
    candidate.price_period,
    case
      when candidate.offer_type = 'sale' then
        jsonb_strip_nulls(
          jsonb_build_object(
            'payment_condition',
            nullif(btrim(candidate.condicao_pagamento), '')
          )
        )
      else
        jsonb_strip_nulls(
          jsonb_build_object(
            'condominium_fee', candidate.condominio,
            'property_tax', candidate.iptu,
            'fire_insurance', candidate.seguro_incendio,
            'service_fee', candidate.taxa_de_servico,
            'guarantee_insurance', candidate.valor_seguro_fianca
          )
        )
    end,
    case
      when private.property_user_belongs_to_organization(
        candidate.organization_id,
        candidate.created_by
      ) then candidate.created_by
    end,
    jsonb_build_object(
      'legacy_backfill', true,
      'legacy_deal_text', candidate.deal_text
    ),
    candidate.created_at,
    candidate.updated_at
  from offer_candidates as candidate
  on conflict do nothing;

  insert into public.property_ownerships (
    organization_id,
    property_id,
    owner_id,
    ownership_percentage,
    is_primary,
    valid_from,
    created_by,
    created_at,
    updated_at
  )
  select
    property.organization_id,
    property.id,
    property.owner_id,
    100,
    true,
    property.created_at::date,
    case
      when private.property_user_belongs_to_organization(
        property.organization_id,
        property.created_by
      ) then property.created_by
    end,
    property.created_at,
    property.updated_at
  from public.properties as property
  join public.property_owners as owner
    on owner.id = property.owner_id
   and owner.organization_id = property.organization_id
  where property.owner_id is not null
    and not exists (
      select 1
      from public.property_ownerships as existing
      where existing.property_id = property.id
    )
  on conflict do nothing;

  with raw_media as (
    select
      property.organization_id,
      property.id as property_id,
      'photo'::text as asset_type,
      nullif(btrim(property.imagem_principal), '') as locator,
      0 as sort_order,
      true as is_primary,
      'public'::text as visibility,
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end as created_by,
      property.created_at,
      property.updated_at
    from public.properties as property
    union all
    select
      property.organization_id,
      property.id,
      'photo',
      nullif(btrim(image.url), ''),
      10 + image.position::integer,
      false,
      'public',
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end as created_by,
      property.created_at,
      property.updated_at
    from public.properties as property
    cross join lateral unnest(
      coalesce(property.image_urls, '{}'::text[])
    ) with ordinality as image(url, position)
    union all
    select
      property.organization_id,
      property.id,
      'photo',
      nullif(
        btrim(
          case
            when jsonb_typeof(image.node) = 'string'
              then image.node #>> '{}'
            when jsonb_typeof(image.node) = 'object' then
              coalesce(
                image.node ->> 'url',
                image.node ->> 'src',
                image.node ->> 'path',
                image.node ->> 'storage_path'
              )
          end
        ),
        ''
      ),
      1000 + image.position::integer,
      false,
      'public',
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(property.fotos) = 'array'
          then property.fotos
        else '[]'::jsonb
      end
    ) with ordinality as image(node, position)
    union all
    select
      property.organization_id,
      property.id,
      'video',
      nullif(btrim(property.video_imovel), ''),
      0,
      false,
      'public',
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
    union all
    select
      property.organization_id,
      property.id,
      'virtual_tour',
      nullif(btrim(property.tour_virtual), ''),
      0,
      false,
      'public',
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
  ),
  ranked_media as (
    select
      media.*,
      row_number() over (
        partition by media.property_id, media.asset_type, media.locator
        order by media.is_primary desc, media.sort_order
      ) as locator_rank
    from raw_media as media
    where media.locator is not null
  )
  insert into public.property_assets (
    organization_id,
    property_id,
    asset_type,
    visibility,
    storage_path,
    external_url,
    sort_order,
    is_primary,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  select
    media.organization_id,
    media.property_id,
    media.asset_type,
    media.visibility,
    case
      when media.locator ~* '^[a-z][a-z0-9+.-]*://'
        then null
      else media.locator
    end,
    case
      when media.locator ~* '^[a-z][a-z0-9+.-]*://'
        then media.locator
      else null
    end,
    greatest(media.sort_order, 0),
    media.is_primary,
    jsonb_build_object('legacy_backfill', true),
    media.created_by,
    media.created_at,
    media.updated_at
  from ranked_media as media
  where media.locator_rank = 1
  on conflict do nothing;

  with document_nodes as (
    select
      property.organization_id,
      property.id as property_id,
      document.node,
      null::text as source_key,
      document.position::integer as position,
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end as created_by,
      property.created_at,
      property.updated_at
    from public.properties as property
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(property.documents) = 'array'
          then property.documents
        else '[]'::jsonb
      end
    ) with ordinality as document(node, position)
    union all
    select
      property.organization_id,
      property.id,
      document.node,
      null,
      1000 + document.position::integer,
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(property.arquivos) = 'array'
          then property.arquivos
        else '[]'::jsonb
      end
    ) with ordinality as document(node, position)
    union all
    select
      property.organization_id,
      property.id,
      document.node,
      document.source_key,
      2000 + row_number() over (order by document.source_key)::integer,
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
    cross join lateral jsonb_each(
      case
        when jsonb_typeof(property.documents) = 'object'
          and not (
            property.documents
            ?| array['url', 'href', 'path', 'storage_path']
          ) then property.documents
        else '{}'::jsonb
      end
    ) as document(source_key, node)
    union all
    select
      property.organization_id,
      property.id,
      property.documents,
      null,
      3000,
      case
        when private.property_user_belongs_to_organization(
          property.organization_id,
          property.created_by
        ) then property.created_by
      end,
      property.created_at,
      property.updated_at
    from public.properties as property
    where jsonb_typeof(property.documents) = 'object'
      and property.documents
        ?| array['url', 'href', 'path', 'storage_path']
  ),
  normalized_documents as (
    select
      document.*,
      nullif(
        btrim(
          case
            when jsonb_typeof(document.node) = 'string'
              then document.node #>> '{}'
            when jsonb_typeof(document.node) = 'object' then
              coalesce(
                document.node ->> 'url',
                document.node ->> 'href',
                document.node ->> 'path',
                document.node ->> 'storage_path'
              )
          end
        ),
        ''
      ) as locator,
      case
        when jsonb_typeof(document.node) = 'object' then
          coalesce(
            nullif(document.node ->> 'title', ''),
            nullif(document.node ->> 'name', ''),
            nullif(document.node ->> 'file_name', ''),
            document.source_key
          )
        else document.source_key
      end as title
    from document_nodes as document
  ),
  ranked_documents as (
    select
      document.*,
      row_number() over (
        partition by document.property_id, document.locator
        order by document.position
      ) as locator_rank
    from normalized_documents as document
    where document.locator is not null
  )
  insert into public.property_assets (
    organization_id,
    property_id,
    asset_type,
    visibility,
    storage_path,
    external_url,
    title,
    file_name,
    sort_order,
    is_primary,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  select
    document.organization_id,
    document.property_id,
    'document',
    'internal',
    case
      when document.locator ~* '^[a-z][a-z0-9+.-]*://'
        then null
      else document.locator
    end,
    case
      when document.locator ~* '^[a-z][a-z0-9+.-]*://'
        then document.locator
      else null
    end,
    document.title,
    document.title,
    greatest(document.position, 0),
    false,
    jsonb_build_object('legacy_backfill', true),
    document.created_by,
    document.created_at,
    document.updated_at
  from ranked_documents as document
  where document.locator_rank = 1
  on conflict do nothing;

  insert into public.property_keys (
    organization_id,
    property_id,
    label,
    status,
    current_location,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  select
    property.organization_id,
    property.id,
    'Chave principal',
    'available',
    btrim(property.local_chaves),
    jsonb_build_object('legacy_backfill', true),
    case
      when private.property_user_belongs_to_organization(
        property.organization_id,
        property.created_by
      ) then property.created_by
    end,
    property.created_at,
    property.updated_at
  from public.properties as property
  where nullif(btrim(property.local_chaves), '') is not null
  on conflict do nothing;
end;
$$;

revoke all on function private.backfill_real_estate_foundation()
  from public, anon, authenticated, service_role;

select private.backfill_real_estate_foundation();

alter table public.property_offers enable row level security;
alter table public.property_ownerships enable row level security;
alter table public.property_assets enable row level security;
alter table public.property_keys enable row level security;
alter table public.property_key_movements enable row level security;

drop policy if exists "property viewers read offers"
  on public.property_offers;
create policy "property viewers read offers"
on public.property_offers
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_offers.organization_id,
    property_offers.property_id,
    null::uuid
  ))
);

drop policy if exists "property managers create offers"
  on public.property_offers;
create policy "property managers create offers"
on public.property_offers
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers update offers"
  on public.property_offers;
create policy "property managers update offers"
on public.property_offers
for update
to authenticated
using (private.has_permission(organization_id, 'property_manage'))
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers delete offers"
  on public.property_offers;
create policy "property managers delete offers"
on public.property_offers
for delete
to authenticated
using (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property viewers read ownerships"
  on public.property_ownerships;
create policy "property viewers read ownerships"
on public.property_ownerships
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_ownerships.organization_id,
    property_ownerships.property_id,
    null::uuid
  ))
);

drop policy if exists "property managers create ownerships"
  on public.property_ownerships;
create policy "property managers create ownerships"
on public.property_ownerships
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers update ownerships"
  on public.property_ownerships;
create policy "property managers update ownerships"
on public.property_ownerships
for update
to authenticated
using (private.has_permission(organization_id, 'property_manage'))
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers delete ownerships"
  on public.property_ownerships;
create policy "property managers delete ownerships"
on public.property_ownerships
for delete
to authenticated
using (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property viewers read assets"
  on public.property_assets;
create policy "property viewers read assets"
on public.property_assets
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_assets.organization_id,
    property_assets.property_id,
    null::uuid
  ))
);

drop policy if exists "property managers create assets"
  on public.property_assets;
create policy "property managers create assets"
on public.property_assets
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers update assets"
  on public.property_assets;
create policy "property managers update assets"
on public.property_assets
for update
to authenticated
using (private.has_permission(organization_id, 'property_manage'))
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers delete assets"
  on public.property_assets;
create policy "property managers delete assets"
on public.property_assets
for delete
to authenticated
using (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property viewers read keys"
  on public.property_keys;
create policy "property viewers read keys"
on public.property_keys
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_keys.organization_id,
    property_keys.property_id,
    null::uuid
  ))
);

drop policy if exists "property managers create keys"
  on public.property_keys;
create policy "property managers create keys"
on public.property_keys
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers update keys"
  on public.property_keys;
create policy "property managers update keys"
on public.property_keys
for update
to authenticated
using (private.has_permission(organization_id, 'property_manage'))
with check (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property managers delete keys"
  on public.property_keys;
create policy "property managers delete keys"
on public.property_keys
for delete
to authenticated
using (private.has_permission(organization_id, 'property_manage'));

drop policy if exists "property viewers read key movements"
  on public.property_key_movements;
create policy "property viewers read key movements"
on public.property_key_movements
for select
to authenticated
using (
  (select private.can_view_real_estate_record(
    property_key_movements.organization_id,
    null::uuid,
    property_key_movements.property_key_id
  ))
);

drop policy if exists "property managers create key movements"
  on public.property_key_movements;
create policy "property managers create key movements"
on public.property_key_movements
for insert
to authenticated
with check (private.has_permission(organization_id, 'property_manage'));

-- Backend-owned tables: the RLS policies above are defense in depth for a
-- future direct surface, but browser roles are deliberately not exposed now.
revoke all on table public.property_offers
  from public, anon, authenticated, service_role;
revoke all on table public.property_ownerships
  from public, anon, authenticated, service_role;
revoke all on table public.property_assets
  from public, anon, authenticated, service_role;
revoke all on table public.property_keys
  from public, anon, authenticated, service_role;
revoke all on table public.property_key_movements
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.property_offers
  to service_role;
grant select, insert, update, delete
  on table public.property_ownerships
  to service_role;
grant select, insert, update, delete
  on table public.property_assets
  to service_role;
grant select, insert, update, delete
  on table public.property_keys
  to service_role;
grant select, insert
  on table public.property_key_movements
  to service_role;
