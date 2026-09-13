begin;

create or replace function private.property_asset_integration_providers(p_metadata jsonb)
returns jsonb
language sql
immutable
security invoker
set search_path = ''
as $function$
  select case
    when pg_catalog.jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)->'integration_providers') = 'array'
      then coalesce(p_metadata, '{}'::jsonb)->'integration_providers'
    when coalesce(p_metadata, '{}'::jsonb)->>'integration_provider' in ('imoview', 'vista')
      then pg_catalog.jsonb_build_array(coalesce(p_metadata, '{}'::jsonb)->>'integration_provider')
    else '[]'::jsonb
  end;
$function$;

revoke all on function private.property_asset_integration_providers(jsonb)
  from public, anon, authenticated, service_role;

-- Provider photos stay append-only until publication versions have an
-- explicit archival lifecycle. Deleting or hiding a referenced asset would
-- break the immutable public media resolver, which joins the frozen asset_id
-- and source_hash back to this live row.
create or replace function public.reconcile_imported_property_photos(
  p_organization_id uuid,
  p_property_id uuid,
  p_provider text,
  p_photo_urls text[],
  p_primary_url text default null,
  p_gallery_complete boolean default true
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
  v_missing_photo_count integer;
  v_total_photo_count integer;
  v_managed_photo_count integer;
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

  -- The same remote URL can legitimately be returned by both providers. Add
  -- shared ownership to an already managed row so either provider can rotate
  -- independently without deleting the other's still-current asset.
  update public.property_assets as asset
  set metadata = (coalesce(asset.metadata, '{}'::jsonb) - 'integration_provider')
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
    and coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
    and not (private.property_asset_integration_providers(asset.metadata) ? v_provider);

  select pg_catalog.count(*)::integer
    into v_existing_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo';

  select pg_catalog.count(*)::integer
    into v_missing_photo_count
  from pg_catalog.unnest(v_urls) as source(url)
  where not exists (
    select 1
    from public.property_assets as asset
    where asset.organization_id = p_organization_id
      and asset.property_id = p_property_id
      and asset.asset_type = 'photo'
      and asset.external_url = source.url
  );

  if v_existing_photo_count + v_missing_photo_count > 20 then
    raise exception 'property_media_capacity_exhausted_append_only'
      using errcode = '23514',
        constraint = 'property_assets_photo_capacity',
        detail = 'Imported media is append-only while immutable publication versions reference live assets; archive safely before adding more photos.';
  end if;

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

  -- A sync may rotate only its own sole-owned primary to the explicitly
  -- requested public asset. Manual, shared, and other-provider primaries are
  -- preserved. Clearing happens first to satisfy the one-primary invariant.
  select candidate.id
    into v_requested_primary_asset_id
  from public.property_assets as candidate
  where candidate.organization_id = p_organization_id
    and candidate.property_id = p_property_id
    and candidate.asset_type = 'photo'
    and candidate.visibility = 'public'
    and candidate.external_url = v_requested_primary
    and coalesce(candidate.metadata->>'integration_managed', 'false') = 'true'
    and private.property_asset_integration_providers(candidate.metadata) ? v_provider
  order by candidate.created_at, candidate.id
  limit 1;

  select
    current_primary.id,
    coalesce(current_primary.metadata->>'integration_managed', 'false') = 'true'
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
      and not exists (
        select 1
        from public.property_assets as preserved_primary
        where preserved_primary.organization_id = p_organization_id
          and preserved_primary.property_id = p_property_id
          and preserved_primary.asset_type = 'photo'
          and preserved_primary.is_primary
          and preserved_primary.id <> v_requested_primary_asset_id
      );
  end if;

  -- Compatibility columns mirror the safe canonical public external gallery.
  -- Storage-backed and internal/confidential assets remain canonical-only and
  -- can never leak through a legacy/public fallback.
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
    and asset.external_url is not null;

  select asset.external_url
    into v_legacy_primary
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.is_primary
    and asset.external_url is not null
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
    and asset.asset_type = 'photo';

  select pg_catalog.count(*)::integer
    into v_managed_photo_count
  from public.property_assets as asset
  where asset.organization_id = p_organization_id
    and asset.property_id = p_property_id
    and asset.asset_type = 'photo'
    and coalesce(asset.metadata->>'integration_managed', 'false') = 'true'
    and private.property_asset_integration_providers(asset.metadata) ? v_provider;

  return pg_catalog.jsonb_build_object(
    'provider', v_provider,
    'property_id', p_property_id,
    'photo_count', v_total_photo_count,
    'managed_photo_count', v_managed_photo_count,
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
  'Service-role-only append-only ingestion for Imoview/Vista external property photos; never adopts or removes pre-existing manual/legacy assets.';

commit;
