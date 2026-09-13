begin;

-- Provider galleries need to rotate without deleting rows referenced by an
-- immutable publication version. Keep the locator row, but make provider
-- ownership an active set and mark a row retired only when the last provider
-- stops returning it in a complete gallery.
create or replace function private.property_asset_integration_providers(p_metadata jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  with provider_values as (
    select distinct pg_catalog.lower(pg_catalog.btrim(source.value)) as provider
    from pg_catalog.jsonb_array_elements_text(
      case
        when pg_catalog.jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)->'integration_providers') = 'array'
          then coalesce(p_metadata, '{}'::jsonb)->'integration_providers'
        when pg_catalog.lower(pg_catalog.btrim(coalesce(p_metadata, '{}'::jsonb)->>'integration_provider'))
          in ('imoview', 'vista')
          then pg_catalog.jsonb_build_array(
            pg_catalog.lower(pg_catalog.btrim(coalesce(p_metadata, '{}'::jsonb)->>'integration_provider'))
          )
        else '[]'::jsonb
      end
    ) as source(value)
  )
  select coalesce(
    pg_catalog.jsonb_agg(provider_values.provider order by provider_values.provider),
    '[]'::jsonb
  )
  from provider_values
  where provider_values.provider in ('imoview', 'vista');
$function$;

revoke all on function private.property_asset_integration_providers(jsonb)
  from public, anon, authenticated, service_role;

-- Normalize reserved integration metadata before enforcing its shape. Unknown
-- metadata is preserved. A historical managed row with no known provider stays
-- active; only an explicit, valid retired marker makes a row inactive.
with normalized_assets as (
  select
    asset.id,
    private.property_asset_integration_providers(asset.metadata) as providers,
    coalesce(pg_catalog.lower(asset.metadata->>'integration_managed'), 'false') = 'true'
      as was_managed,
    coalesce(pg_catalog.lower(asset.metadata->>'integration_retired'), 'false') = 'true'
      as wanted_retired,
    asset.metadata
      - 'integration_provider'
      - 'integration_providers'
      - 'integration_retired'
      - 'integration_managed' as base_metadata
  from public.property_assets as asset
  where asset.metadata ?| array[
    'integration_provider',
    'integration_providers',
    'integration_retired',
    'integration_managed'
  ]
), normalized_values as (
  select
    normalized.id,
    case
      when pg_catalog.jsonb_array_length(normalized.providers) > 0 then
        normalized.base_metadata || pg_catalog.jsonb_build_object(
          'integration_managed', true,
          'integration_providers', normalized.providers
        )
      when normalized.was_managed and normalized.wanted_retired then
        normalized.base_metadata || pg_catalog.jsonb_build_object(
          'integration_managed', true,
          'integration_providers', '[]'::jsonb,
          'integration_retired', true
        )
      when normalized.was_managed then
        normalized.base_metadata || pg_catalog.jsonb_build_object(
          'integration_managed', true,
          'integration_providers', '[]'::jsonb
        )
      else normalized.base_metadata
    end as metadata
  from normalized_assets as normalized
)
update public.property_assets as asset
set metadata = normalized.metadata,
    is_primary = case
      when coalesce(normalized.metadata->>'integration_retired', 'false') = 'true'
        then false
      else asset.is_primary
    end,
    updated_at = pg_catalog.now()
from normalized_values as normalized
where asset.id = normalized.id
  and (
    asset.metadata is distinct from normalized.metadata
    or (
      asset.is_primary
      and coalesce(normalized.metadata->>'integration_retired', 'false') = 'true'
    )
  );

do $add_property_asset_provider_archive_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_integration_archive_shape_check'
  ) then
    alter table public.property_assets
      add constraint property_assets_integration_archive_shape_check
      check (
        not (metadata ? 'integration_provider')
        and
        case
          when not (metadata ? 'integration_managed') then true
          else pg_catalog.jsonb_typeof(metadata->'integration_managed') = 'boolean'
        end
        and case
          when not (metadata ? 'integration_providers') then true
          when pg_catalog.jsonb_typeof(metadata->'integration_providers') <> 'array' then false
          else
            metadata->'integration_providers' <@ '["imoview", "vista"]'::jsonb
            and pg_catalog.jsonb_array_length(metadata->'integration_providers') =
              (case when metadata->'integration_providers' ? 'imoview' then 1 else 0 end)
              + (case when metadata->'integration_providers' ? 'vista' then 1 else 0 end)
            and (
              pg_catalog.jsonb_array_length(metadata->'integration_providers') = 0
              or (
                coalesce(metadata->>'integration_managed', 'false') = 'true'
                and asset_type = 'photo'
                and external_url is not null
              )
            )
        end
        and case
          when not (metadata ? 'integration_retired') then true
          when pg_catalog.jsonb_typeof(metadata->'integration_retired') <> 'boolean' then false
          when metadata->'integration_retired' = 'false'::jsonb then true
          else
            coalesce(metadata->>'integration_managed', 'false') = 'true'
            and not is_primary
            and asset_type = 'photo'
            and external_url is not null
            and case
              when not (metadata ? 'integration_providers') then false
              when pg_catalog.jsonb_typeof(metadata->'integration_providers') = 'array'
                then pg_catalog.jsonb_array_length(metadata->'integration_providers') = 0
              else false
            end
        end
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_primary_active_check'
  ) then
    alter table public.property_assets
      add constraint property_assets_primary_active_check
      check (
        not is_primary
        or coalesce(metadata->>'integration_retired', 'false') <> 'true'
      )
      not valid;
  end if;
end
$add_property_asset_provider_archive_constraints$;

alter table public.property_assets
  validate constraint property_assets_integration_archive_shape_check;
alter table public.property_assets
  validate constraint property_assets_primary_active_check;

create index if not exists property_assets_active_property_order_idx
  on public.property_assets (
    organization_id,
    property_id,
    asset_type,
    is_primary desc,
    sort_order,
    id
  )
  where coalesce(metadata->>'integration_retired', 'false') <> 'true';

-- A service-role writer may still manage manual assets, but provider rows use
-- this archive lifecycle exclusively. Prevent a second writer from deleting a
-- live property's provider row, changing its source identity/visibility, or
-- stripping the marker and then mutating it as if it were manual. Parent/org
-- cascades remain valid once the owning row is no longer visible.
create or replace function private.enforce_provider_property_asset_archive()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if coalesce(old.metadata->>'integration_managed', 'false') <> 'true' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if exists (
      select 1
      from public.organizations as organization
      where organization.id = old.organization_id
    ) and exists (
      select 1
      from public.properties as property
      where property.organization_id = old.organization_id
        and property.id = old.property_id
    ) then
      raise exception 'integration-managed property assets require logical retirement'
        using errcode = '23514',
          constraint = 'property_assets_integration_archive_guard';
    end if;
    return old;
  end if;

  if new.id is distinct from old.id
     or new.organization_id is distinct from old.organization_id
     or new.property_id is distinct from old.property_id
     or new.asset_type is distinct from old.asset_type
     or new.visibility is distinct from old.visibility
     or new.storage_path is distinct from old.storage_path
     or new.external_url is distinct from old.external_url
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or coalesce(new.metadata->>'integration_managed', 'false') <> 'true' then
    raise exception 'integration-managed property asset source is immutable'
      using errcode = '23514',
        constraint = 'property_assets_integration_archive_guard';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_provider_property_asset_archive()
  from public, anon, authenticated, service_role;

drop trigger if exists property_assets_enforce_provider_archive
  on public.property_assets;
create trigger property_assets_enforce_provider_archive
before delete or update of
  id,
  organization_id,
  property_id,
  asset_type,
  visibility,
  storage_path,
  external_url,
  checksum_sha256,
  metadata
on public.property_assets
for each row
execute function private.enforce_provider_property_asset_archive();

-- The hard limit applies to the current gallery. Retired provider rows remain
-- addressable for frozen publication snapshots, but do not consume a live slot.
create or replace function private.enforce_property_photo_asset_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  excluded_asset_id uuid;
  current_photo_count integer;
  old_is_active_photo boolean := false;
  new_is_active_photo boolean := false;
begin
  new_is_active_photo := new.asset_type = 'photo'
    and coalesce(new.metadata->>'integration_retired', 'false') <> 'true';

  if not new_is_active_photo then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    old_is_active_photo := old.asset_type = 'photo'
      and coalesce(old.metadata->>'integration_retired', 'false') <> 'true';
    excluded_asset_id := old.id;

    if old_is_active_photo
       and (old.organization_id, old.property_id)
         is not distinct from (new.organization_id, new.property_id) then
      return new;
    end if;
  end if;

  perform 1
  from public.properties as property
  where property.organization_id = new.organization_id
    and property.id = new.property_id
  for update;
  if not found then
    raise exception 'property asset parent does not exist'
      using errcode = '23503', constraint = 'property_assets_property_fkey';
  end if;

  -- Serialize before checking the unique locator. Once a concurrent insertion
  -- releases the parent lock, this branch sees its committed row and lets an
  -- idempotent INSERT ... ON CONFLICT reach the locator constraint even when
  -- the active gallery is now full.
  if tg_op = 'INSERT'
     and new.external_url is not null
     and exists (
       select 1
       from public.property_assets as existing_asset
       where existing_asset.property_id = new.property_id
         and existing_asset.asset_type = 'photo'
         and existing_asset.external_url = new.external_url
     ) then
    return new;
  end if;

  select pg_catalog.count(*)::integer
    into current_photo_count
  from public.property_assets as asset
  where asset.organization_id = new.organization_id
    and asset.property_id = new.property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
    and (excluded_asset_id is null or asset.id <> excluded_asset_id);

  if current_photo_count >= 20 then
    raise exception 'a property can have at most 20 active photos'
      using errcode = '23514', constraint = 'property_assets_photo_capacity';
  end if;

  return new;
end;
$function$;

revoke all on function private.enforce_property_photo_asset_capacity()
  from public, anon, authenticated, service_role;

drop trigger if exists property_assets_enforce_photo_capacity
  on public.property_assets;
create trigger property_assets_enforce_photo_capacity
before insert or update of organization_id, property_id, asset_type, metadata
on public.property_assets
for each row
execute function private.enforce_property_photo_asset_capacity();

create or replace function public.reconcile_imported_property_photos(
  p_organization_id uuid,
  p_property_id uuid,
  p_provider text,
  p_photo_urls text[],
  p_primary_url text default null,
  p_gallery_complete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_provider text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_provider, '')));
  v_raw_url text;
  v_url text;
  v_urls text[] := '{}'::text[];
  v_requested_primary text := nullif(pg_catalog.btrim(p_primary_url), '');
  v_hidden_urls jsonb;
  v_imoview_code text;
  v_vista_code text;
  v_existing_photo_count integer;
  v_activation_photo_count integer;
  v_total_photo_count integer;
  v_managed_photo_count integer;
  v_retired_photo_count integer;
  v_retired_in_run integer := 0;
  v_detached_in_run integer := 0;
  v_requested_primary_asset_id uuid;
  v_current_primary_asset_id uuid;
  v_current_primary_replaceable boolean := false;
  v_legacy_urls text[] := '{}'::text[];
  v_legacy_primary text;
begin
  if p_organization_id is null or p_property_id is null then
    raise exception 'organization and property are required'
      using errcode = '22023';
  end if;

  if v_provider not in ('imoview', 'vista') then
    raise exception 'unsupported property media provider'
      using errcode = '22023';
  end if;

  if coalesce(pg_catalog.cardinality(p_photo_urls), 0) > 20 then
    raise exception 'a provider gallery can have at most 20 photos'
      using errcode = '23514', constraint = 'property_assets_photo_capacity';
  end if;

  select
    coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb),
    nullif(pg_catalog.btrim(property.imoview_codigo), ''),
    nullif(pg_catalog.btrim(property.vista_codigo), '')
    into v_hidden_urls, v_imoview_code, v_vista_code
  from public.properties as property
  where property.organization_id = p_organization_id
    and property.id = p_property_id
  for update;

  if not found then
    raise exception 'property does not belong to organization'
      using errcode = '23503', constraint = 'property_assets_property_fkey';
  end if;

  if (v_provider = 'imoview' and v_imoview_code is null)
     or (v_provider = 'vista' and v_vista_code is null) then
    raise exception 'property is not linked to media provider'
      using errcode = '23514', constraint = 'property_assets_provider_reference_check';
  end if;

  foreach v_raw_url in array coalesce(p_photo_urls, '{}'::text[])
  loop
    v_url := pg_catalog.btrim(coalesce(v_raw_url, ''));
    if v_url = ''
       or pg_catalog.length(v_url) > 2048
       or v_url !~* '^https://[^[:space:]]+$' then
      raise exception 'provider photo URLs must be HTTPS and at most 2048 characters'
        using errcode = '22023';
    end if;
    if not (v_url = any(v_urls)) then
      v_urls := pg_catalog.array_append(v_urls, v_url);
    end if;
  end loop;

  if v_requested_primary is not null then
    if pg_catalog.length(v_requested_primary) > 2048
       or v_requested_primary !~* '^https://[^[:space:]]+$'
       or not (v_requested_primary = any(v_urls)) then
      raise exception 'primary provider photo must be part of the gallery'
        using errcode = '22023';
    end if;
  end if;

  -- Only a complete upstream gallery may remove this provider from absent
  -- rows. Shared rows keep the other active provider and remain live; sole
  -- ownership becomes a logical tombstone with the same id and locator.
  if p_gallery_complete is true then
    with provider_absences as (
      select
        asset.id,
        private.property_asset_integration_providers(asset.metadata) - v_provider
          as remaining_providers
      from public.property_assets as asset
      where asset.organization_id = p_organization_id
        and asset.property_id = p_property_id
        and asset.asset_type = 'photo'
        and asset.external_url is not null
        and not (asset.external_url = any(v_urls))
        and coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
        and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
        and private.property_asset_integration_providers(asset.metadata) ? v_provider
      for update
    ), detached as (
      update public.property_assets as asset
      set metadata = case
            when pg_catalog.jsonb_array_length(absence.remaining_providers) = 0 then
              (coalesce(asset.metadata, '{}'::jsonb)
                - 'integration_provider'
                - 'integration_retired')
                || pg_catalog.jsonb_build_object(
                  'integration_managed', true,
                  'integration_providers', '[]'::jsonb,
                  'integration_retired', true
                )
            else
              (coalesce(asset.metadata, '{}'::jsonb)
                - 'integration_provider'
                - 'integration_retired')
                || pg_catalog.jsonb_build_object(
                  'integration_managed', true,
                  'integration_providers', absence.remaining_providers
                )
          end,
          is_primary = case
            when pg_catalog.jsonb_array_length(absence.remaining_providers) = 0
              then false
            else asset.is_primary
          end,
          updated_at = pg_catalog.now()
      from provider_absences as absence
      where asset.id = absence.id
      returning pg_catalog.jsonb_array_length(absence.remaining_providers) = 0
        as retired
    )
    select
      pg_catalog.count(*) filter (where detached.retired)::integer,
      pg_catalog.count(*)::integer
      into v_retired_in_run, v_detached_in_run
    from detached;
  end if;

  select pg_catalog.count(*)::integer
    into v_existing_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true';

  -- Reappearing managed URLs count as activations even though their locator row
  -- already exists. The whole function is one transaction, so a capacity error
  -- also rolls back any retirement performed above.
  select pg_catalog.count(*)::integer
    into v_activation_photo_count
  from pg_catalog.unnest(v_urls) as source(url)
  where not exists (
    select 1
    from public.property_assets as asset
    where asset.organization_id = p_organization_id
      and asset.property_id = p_property_id
      and asset.asset_type = 'photo'
      and asset.external_url = source.url
      and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
  );

  if v_existing_photo_count + v_activation_photo_count > 20 then
    raise exception 'property_media_capacity_exhausted_append_only'
      using errcode = '23514',
        constraint = 'property_assets_photo_capacity',
        detail = 'The active canonical gallery would exceed 20 photos; retired provider rows do not consume capacity.';
  end if;

  -- Add this provider to current managed rows, adopt a matching row created by
  -- the legacy compatibility mirror, and reactivate a matching retired row in
  -- place. An unmarked/manual row that happens to share the URL is deliberately
  -- not adopted. Locator, checksum/hash, visibility and the legacy_mirror source
  -- marker are left untouched so frozen snapshots keep resolving the same row.
  update public.property_assets as asset
  set metadata = (coalesce(asset.metadata, '{}'::jsonb)
          - 'integration_provider'
          - 'integration_retired')
        || pg_catalog.jsonb_build_object(
          'integration_managed', true,
          'integration_providers',
            private.property_asset_integration_providers(asset.metadata)
              || pg_catalog.jsonb_build_array(v_provider),
          'access_model', 'external_origin_uncontrolled'
        ),
      updated_at = pg_catalog.now()
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and asset.external_url = any(v_urls)
    and (
      coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
      or coalesce(asset.metadata->>'legacy_mirror', 'false') = 'true'
    )
    and (
      coalesce(asset.metadata->>'integration_retired', 'false') = 'true'
      or not (private.property_asset_integration_providers(asset.metadata) ? v_provider)
    );

  insert into public.property_assets (
    organization_id,
    property_id,
    asset_type,
    visibility,
    external_url,
    sort_order,
    is_primary,
    metadata,
    created_at,
    updated_at
  )
  select
    p_organization_id,
    p_property_id,
    'photo',
    case when v_hidden_urls ? source.url then 'internal' else 'public' end,
    source.url,
    10 + source.position::integer - 1,
    false,
    pg_catalog.jsonb_build_object(
      'integration_managed', true,
      'integration_providers', pg_catalog.jsonb_build_array(v_provider),
      'access_model', 'external_origin_uncontrolled'
    ),
    pg_catalog.now(),
    pg_catalog.now()
  from pg_catalog.unnest(v_urls) with ordinality as source(url, position)
  where not exists (
    select 1
    from public.property_assets as asset
    where asset.organization_id = p_organization_id
      and asset.property_id = p_property_id
      and asset.asset_type = 'photo'
      and asset.external_url = source.url
  );

  -- A provider may rotate only its own sole-owned primary. Manual and shared
  -- primaries are preserved, and no retired row can be selected or promoted.
  select candidate.id
    into v_requested_primary_asset_id
  from public.property_assets as candidate
  where candidate.organization_id = p_organization_id
    and candidate.property_id = p_property_id
    and candidate.asset_type = 'photo'
    and candidate.visibility = 'public'
    and candidate.external_url = v_requested_primary
    and coalesce(candidate.metadata->>'integration_retired', 'false') <> 'true'
    and coalesce(candidate.metadata->>'integration_managed', 'false') = 'true'
    and private.property_asset_integration_providers(candidate.metadata) ? v_provider
  order by candidate.created_at, candidate.id
  limit 1;

  select
    current_primary.id,
    coalesce(current_primary.metadata->>'integration_managed', 'false') = 'true'
      and coalesce(current_primary.metadata->>'integration_retired', 'false') <> 'true'
      and private.property_asset_integration_providers(current_primary.metadata) ? v_provider
      and pg_catalog.jsonb_array_length(
        private.property_asset_integration_providers(current_primary.metadata)
      ) = 1
    into v_current_primary_asset_id, v_current_primary_replaceable
  from public.property_assets as current_primary
  where current_primary.organization_id = p_organization_id
    and current_primary.property_id = p_property_id
    and current_primary.asset_type = 'photo'
    and current_primary.is_primary
    and coalesce(current_primary.metadata->>'integration_retired', 'false') <> 'true'
  order by current_primary.created_at, current_primary.id
  limit 1;

  if v_requested_primary_asset_id is not null
     and v_current_primary_asset_id is distinct from v_requested_primary_asset_id
     and (v_current_primary_asset_id is null or v_current_primary_replaceable) then
    if v_current_primary_asset_id is not null then
      update public.property_assets as current_primary
      set is_primary = false,
          updated_at = pg_catalog.now()
      where current_primary.organization_id = p_organization_id
        and current_primary.property_id = p_property_id
        and current_primary.id = v_current_primary_asset_id
        and current_primary.asset_type = 'photo'
        and current_primary.is_primary
        and coalesce(current_primary.metadata->>'integration_retired', 'false') <> 'true'
        and coalesce(current_primary.metadata->>'integration_managed', 'false') = 'true'
        and private.property_asset_integration_providers(current_primary.metadata) ? v_provider
        and pg_catalog.jsonb_array_length(
          private.property_asset_integration_providers(current_primary.metadata)
        ) = 1;
    end if;

    update public.property_assets as asset
    set is_primary = true,
        updated_at = pg_catalog.now()
    where asset.organization_id = p_organization_id
      and asset.property_id = p_property_id
      and asset.id = v_requested_primary_asset_id
      and asset.asset_type = 'photo'
      and asset.visibility = 'public'
      and asset.external_url = v_requested_primary
      and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
      and not exists (
        select 1
        from public.property_assets as preserved_primary
        where preserved_primary.organization_id = p_organization_id
          and preserved_primary.property_id = p_property_id
          and preserved_primary.asset_type = 'photo'
          and preserved_primary.is_primary
          and coalesce(preserved_primary.metadata->>'integration_retired', 'false') <> 'true'
          and preserved_primary.id <> v_requested_primary_asset_id
      );
  end if;

  -- Compatibility columns contain only the active public external gallery.
  -- Retired locators remain reachable only through immutable version asset ids.
  select
    coalesce(
      pg_catalog.array_agg(asset.external_url order by asset.is_primary desc, asset.sort_order, asset.created_at, asset.id),
      '{}'::text[]
    )
    into v_legacy_urls
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.external_url is not null
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true';

  select asset.external_url
    into v_legacy_primary
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.is_primary
    and asset.external_url is not null
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
  limit 1;

  update public.properties as property
  set imagem_principal = v_legacy_primary,
      image_urls = v_legacy_urls,
      fotos = pg_catalog.to_jsonb(v_legacy_urls)
  where property.organization_id = p_organization_id
    and property.id = p_property_id;

  select pg_catalog.count(*)::integer
    into v_total_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true';

  select pg_catalog.count(*)::integer
    into v_managed_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
    and coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
    and private.property_asset_integration_providers(asset.metadata) ? v_provider;

  select pg_catalog.count(*)::integer
    into v_retired_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
    and coalesce(asset.metadata->>'integration_retired', 'false') = 'true';

  return pg_catalog.jsonb_build_object(
    'provider', v_provider,
    'property_id', p_property_id,
    'photo_count', v_total_photo_count,
    'managed_photo_count', v_managed_photo_count,
    'retired_photo_count', v_retired_photo_count,
    'retired_in_run', v_retired_in_run,
    'provider_ownerships_removed', v_detached_in_run,
    'gallery_complete', p_gallery_complete is true,
    'primary_url', v_legacy_primary
  );
end;
$function$;

revoke all on function public.reconcile_imported_property_photos(uuid, uuid, text, text[], text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.reconcile_imported_property_photos(uuid, uuid, text, text[], text, boolean)
  to service_role;

comment on function public.reconcile_imported_property_photos(uuid, uuid, text, text[], text, boolean) is
  'Service-role-only reconciliation for Imoview/Vista photos. Complete galleries logically retire missing sole-owned rows; partial galleries are additive, and reappearing locators reactivate their original asset id.';

-- Legacy property-column writes remain additive, but they must neither promote
-- a retired provider row nor treat a retired primary as a live primary.
create or replace function private.mirror_legacy_property_photos_to_assets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_active_urls text[] := '{}'::text[];
  v_active_primary text;
begin
  if pg_catalog.pg_trigger_depth() > 1 then
    return new;
  end if;

  with raw_media as (
    select
      nullif(pg_catalog.btrim(new.imagem_principal), '') as locator,
      0 as sort_order,
      true as wants_primary

    union all

    select
      nullif(pg_catalog.btrim(image.url), ''),
      10 + image.position::integer,
      false
    from pg_catalog.unnest(coalesce(new.image_urls, '{}'::text[]))
      with ordinality as image(url, position)

    union all

    select
      nullif(pg_catalog.btrim(case
        when pg_catalog.jsonb_typeof(image.node) = 'string' then image.node #>> '{}'
        when pg_catalog.jsonb_typeof(image.node) = 'object' then
          coalesce(image.node->>'url', image.node->>'src', image.node->>'publicUrl')
        else null
      end), ''),
      1000 + image.position::integer,
      false
    from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(new.fotos) = 'array'
        then new.fotos else '[]'::jsonb end
    ) with ordinality as image(node, position)
  ), ranked_media as (
    select
      media.*,
      coalesce(new.metadata->'hidden_site_image_urls', '[]'::jsonb) ? media.locator as is_hidden,
      row_number() over (
        partition by media.locator
        order by media.wants_primary desc, media.sort_order
      ) as locator_rank
    from raw_media as media
    where media.locator ~* '^https?://'
  )
  insert into public.property_assets (
    organization_id,
    property_id,
    asset_type,
    visibility,
    external_url,
    sort_order,
    is_primary,
    metadata,
    created_at,
    updated_at
  )
  select
    new.organization_id,
    new.id,
    'photo',
    case when media.is_hidden then 'internal' else 'public' end,
    media.locator,
    greatest(media.sort_order, 0),
    media.wants_primary
      and not media.is_hidden
      and not exists (
        select 1
        from public.property_assets as existing_primary
        where existing_primary.property_id = new.id
          and existing_primary.asset_type = 'photo'
          and existing_primary.is_primary
          and coalesce(existing_primary.metadata->>'integration_retired', 'false') <> 'true'
      ),
    pg_catalog.jsonb_build_object(
      'legacy_mirror', true,
      'access_model', 'external_origin_uncontrolled'
    ),
    coalesce(new.created_at, pg_catalog.now()),
    coalesce(new.updated_at, pg_catalog.now())
  from ranked_media as media
  where media.locator_rank = 1
  on conflict (property_id, asset_type, external_url)
    where external_url is not null
  do nothing;

  update public.property_assets as asset
  set is_primary = true,
      updated_at = pg_catalog.now()
  where asset.organization_id = new.organization_id
    and asset.property_id = new.id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.external_url = nullif(pg_catalog.btrim(new.imagem_principal), '')
    and asset.external_url ~* '^https?://'
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
    and not (
      coalesce(new.metadata->'hidden_site_image_urls', '[]'::jsonb)
        ? asset.external_url
    )
    and not exists (
      select 1
      from public.property_assets as existing_primary
      where existing_primary.property_id = new.id
        and existing_primary.asset_type = 'photo'
        and existing_primary.is_primary
        and coalesce(existing_primary.metadata->>'integration_retired', 'false') <> 'true'
    );

  -- Compatibility columns are a projection of active canonical rows. A stale
  -- legacy write that collides with a retired provider locator therefore stays
  -- retired and is removed from the compatibility projection instead of being
  -- allowed to resurrect it without provider evidence.
  select coalesce(
    pg_catalog.array_agg(
      asset.external_url
      order by asset.is_primary desc, asset.sort_order, asset.created_at, asset.id
    ),
    '{}'::text[]
  )
    into v_active_urls
  from public.property_assets as asset
  where asset.organization_id = new.organization_id
    and asset.property_id = new.id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.external_url is not null
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true';

  select asset.external_url
    into v_active_primary
  from public.property_assets as asset
  where asset.organization_id = new.organization_id
    and asset.property_id = new.id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.is_primary
    and asset.external_url is not null
    and coalesce(asset.metadata->>'integration_retired', 'false') <> 'true'
  order by asset.created_at, asset.id
  limit 1;

  update public.properties as property
  set imagem_principal = v_active_primary,
      image_urls = v_active_urls,
      fotos = pg_catalog.to_jsonb(v_active_urls)
  where property.organization_id = new.organization_id
    and property.id = new.id
    and (
      property.imagem_principal is distinct from v_active_primary
      or property.image_urls is distinct from v_active_urls
      or property.fotos is distinct from pg_catalog.to_jsonb(v_active_urls)
    );

  return new;
end;
$function$;

revoke all on function private.mirror_legacy_property_photos_to_assets()
  from public, anon, authenticated, service_role;

drop trigger if exists properties_mirror_legacy_photos_to_assets
  on public.properties;
create trigger properties_mirror_legacy_photos_to_assets
after insert or update of imagem_principal, image_urls, fotos, metadata
on public.properties
for each row
execute function private.mirror_legacy_property_photos_to_assets();

-- Reassert the backend-only table boundary and the narrow privileged RPC.
alter table public.property_assets enable row level security;
revoke all on table public.property_assets
  from public, anon, authenticated;
grant select, insert, update, delete on table public.property_assets
  to service_role;

commit;
