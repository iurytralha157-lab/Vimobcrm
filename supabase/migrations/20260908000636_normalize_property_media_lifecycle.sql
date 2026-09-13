begin;

-- Normalize the legacy property-photo projection and make private Storage
-- uploads/deletes recoverable. Browser roles never receive table or bucket
-- access; the BFF owns the complete lifecycle.

-- Keep historical `/object/public/properties/...` URLs readable, but retire
-- every direct browser mutation path. The canonical private bucket is also
-- reasserted as private and remains accessible only through BFF-issued signed
-- URLs. Service-role access does not depend on RLS policies.
update storage.buckets
set public = false,
    updated_at = now()
where id = 'property-private'
  and public;

do $drop_property_browser_mutation_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (
        coalesce(qual, '') ~* '''(properties|property-private)'''
        or coalesce(with_check, '') ~* '''(properties|property-private)'''
      )
  loop
    execute pg_catalog.format(
      'drop policy %I on storage.objects',
      policy_row.policyname
    );
  end loop;
end
$drop_property_browser_mutation_policies$;

create table if not exists public.property_asset_upload_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null,
  storage_path text not null unique,
  asset_type text not null,
  file_name text not null,
  mime_type text not null,
  file_size_bytes bigint not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  discard_requested_at timestamptz,
  cleanup_claimed_until timestamptz,
  cleanup_attempts integer not null default 0,
  last_cleanup_error text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint property_asset_upload_intents_property_fkey
    foreign key (organization_id, property_id)
    references public.properties(organization_id, id)
    on delete cascade,
  constraint property_asset_upload_intents_type_check
    check (asset_type in ('photo', 'video', 'virtual_tour', 'floor_plan', 'document')),
  constraint property_asset_upload_intents_name_check
    check (file_name = btrim(file_name) and file_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$'),
  constraint property_asset_upload_intents_mime_check
    check (mime_type = lower(btrim(mime_type)) and char_length(mime_type) between 3 and 160),
  constraint property_asset_upload_intents_size_check
    check (file_size_bytes between 1 and 10485760),
  constraint property_asset_upload_intents_expiry_check
    check (expires_at > created_at),
  constraint property_asset_upload_intents_path_check
    check (
      storage_path like
        'orgs/' || organization_id::text || '/properties/' || property_id::text || '/%'
    ),
  constraint property_asset_upload_intents_cleanup_attempts_check
    check (cleanup_attempts >= 0),
  constraint property_asset_upload_intents_error_check
    check (last_cleanup_error is null or char_length(last_cleanup_error) <= 2000)
);

alter table public.property_asset_upload_intents
  add column if not exists consumed_at timestamptz;

create index if not exists property_asset_upload_intents_expiry_idx
  on public.property_asset_upload_intents (expires_at, created_at);

create index if not exists property_asset_upload_intents_property_idx
  on public.property_asset_upload_intents (organization_id, property_id, created_at);

create table if not exists public.property_asset_storage_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  property_id uuid not null,
  asset_id uuid,
  bucket text not null default 'property-private',
  storage_path text not null unique,
  cleanup_attempts integer not null default 0,
  available_at timestamptz not null default now(),
  last_cleanup_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint property_asset_storage_cleanup_bucket_check
    check (bucket = 'property-private'),
  constraint property_asset_storage_cleanup_path_check
    check (
      storage_path like
        'orgs/' || organization_id::text || '/properties/' || property_id::text || '/%'
      and (
        asset_id is null
        or storage_path like
          'orgs/' || organization_id::text || '/properties/' || property_id::text || '/' || asset_id::text || '/%'
      )
    ),
  constraint property_asset_storage_cleanup_attempts_check
    check (cleanup_attempts >= 0),
  constraint property_asset_storage_cleanup_error_check
    check (last_cleanup_error is null or char_length(last_cleanup_error) <= 2000)
);

create index if not exists property_asset_storage_cleanup_due_idx
  on public.property_asset_storage_cleanup_queue (available_at, created_at);

create or replace function private.queue_property_asset_storage_cleanup()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  expected_property_prefix text;
  expected_asset_prefix text;
  cleanup_asset_id uuid;
  cleanup_not_before timestamptz;
begin
  if old.storage_path is null
     or (tg_op = 'UPDATE' and old.storage_path is not distinct from new.storage_path) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  expected_property_prefix := pg_catalog.format(
    'orgs/%s/properties/%s/',
    old.organization_id,
    old.property_id
  );
  expected_asset_prefix := pg_catalog.format(
    'orgs/%s/properties/%s/%s/',
    old.organization_id,
    old.property_id,
    old.id
  );

  if pg_catalog.left(
       old.storage_path,
       pg_catalog.length(expected_property_prefix)
     ) = expected_property_prefix then
    cleanup_asset_id := case
      when pg_catalog.left(
        old.storage_path,
        pg_catalog.length(expected_asset_prefix)
      ) = expected_asset_prefix then old.id
      else null
    end;

    select greatest(now(), coalesce(max(intent.expires_at) + interval '5 minutes', now()))
      into cleanup_not_before
    from public.property_asset_upload_intents as intent
    where intent.organization_id = old.organization_id
      and intent.property_id = old.property_id
      and intent.storage_path = old.storage_path;

    insert into public.property_asset_storage_cleanup_queue (
      organization_id,
      property_id,
      asset_id,
      storage_path,
      available_at
    )
    values (
      old.organization_id,
      old.property_id,
      cleanup_asset_id,
      old.storage_path,
      cleanup_not_before
    )
    on conflict (storage_path) do update
    set available_at = greatest(
          public.property_asset_storage_cleanup_queue.available_at,
          excluded.available_at
        ),
        asset_id = coalesce(
          public.property_asset_storage_cleanup_queue.asset_id,
          excluded.asset_id
        ),
        updated_at = now();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

revoke all on function private.queue_property_asset_storage_cleanup()
  from public, anon, authenticated, service_role;

drop trigger if exists property_assets_queue_storage_cleanup
  on public.property_assets;
create trigger property_assets_queue_storage_cleanup
before delete or update of storage_path
on public.property_assets
for each row
execute function private.queue_property_asset_storage_cleanup();

-- Upload intent tombstones normally disappear only after their signed token's
-- expiry plus a safety margin. A property/org cascade is the path where the
-- parent disappears first, so preserve the path and its not-before deadline in
-- the same durable cleanup queue before the intent row disappears.
create or replace function private.queue_property_asset_upload_cleanup_on_cascade()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if exists (
    select 1
    from public.properties as property
    where property.organization_id = old.organization_id
      and property.id = old.property_id
  ) or exists (
    select 1
    from public.property_assets as asset
    where asset.organization_id = old.organization_id
      and asset.property_id = old.property_id
      and asset.storage_path = old.storage_path
  ) then
    return old;
  end if;

  insert into public.property_asset_storage_cleanup_queue (
    organization_id,
    property_id,
    asset_id,
    storage_path,
    available_at
  )
  values (
    old.organization_id,
    old.property_id,
    null,
    old.storage_path,
    greatest(now(), old.expires_at + interval '5 minutes')
  )
  on conflict (storage_path) do update
  set available_at = greatest(
        public.property_asset_storage_cleanup_queue.available_at,
        excluded.available_at
      ),
      updated_at = now();

  return old;
end;
$function$;

revoke all on function private.queue_property_asset_upload_cleanup_on_cascade()
  from public, anon, authenticated, service_role;

drop trigger if exists property_asset_upload_intents_queue_cleanup_on_cascade
  on public.property_asset_upload_intents;
create trigger property_asset_upload_intents_queue_cleanup_on_cascade
before delete
on public.property_asset_upload_intents
for each row
execute function private.queue_property_asset_upload_cleanup_on_cascade();

-- The 20-photo contract is a database invariant, not only a BFF/UI rule.
-- Locking the parent property serializes single-row writers with the canonical
-- asset API. The trigger also protects trusted integrations and legacy mirror
-- writes that bypass the HTTP asset manager.
create or replace function private.enforce_property_photo_asset_capacity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  excluded_asset_id uuid;
  current_photo_count integer;
begin
  if new.asset_type <> 'photo' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if old.asset_type = 'photo'
       and (old.organization_id, old.property_id)
         is not distinct from (new.organization_id, new.property_id) then
      return new;
    end if;
    excluded_asset_id := old.id;
  end if;

  -- BEFORE triggers run before INSERT ... ON CONFLICT. Let an already
  -- canonical external locator reach its unique conflict so an idempotent
  -- legacy mirror remains a no-op even when the gallery is full.
  if new.external_url is not null and exists (
    select 1
    from public.property_assets as existing_asset
    where existing_asset.property_id = new.property_id
      and existing_asset.asset_type = 'photo'
      and existing_asset.external_url = new.external_url
      and (excluded_asset_id is null or existing_asset.id <> excluded_asset_id)
  ) then
    return new;
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

  select count(*)::integer
    into current_photo_count
  from public.property_assets as asset
  where asset.organization_id = new.organization_id
    and asset.property_id = new.property_id
    and asset.asset_type = 'photo'
    and (excluded_asset_id is null or asset.id <> excluded_asset_id);

  if current_photo_count >= 20 then
    raise exception 'a property can have at most 20 photos'
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
before insert or update of organization_id, property_id, asset_type
on public.property_assets
for each row
execute function private.enforce_property_photo_asset_capacity();

-- Do not silently truncate a historical gallery. A tenant whose union of
-- canonical photos and missing legacy HTTP(S) locators exceeds the supported
-- capacity must choose what to retain before this migration is applied.
do $property_photo_capacity_preflight$
begin
  if exists (
    with raw_legacy_media as (
      select
        property.organization_id,
        property.id as property_id,
        nullif(btrim(property.imagem_principal), '') as locator
      from public.properties as property

      union all

      select
        property.organization_id,
        property.id,
        nullif(btrim(image.url), '')
      from public.properties as property
      cross join lateral unnest(coalesce(property.image_urls, '{}'::text[]))
        as image(url)

      union all

      select
        property.organization_id,
        property.id,
        nullif(btrim(case
          when jsonb_typeof(image.node) = 'string' then image.node #>> '{}'
          when jsonb_typeof(image.node) = 'object' then
            coalesce(image.node->>'url', image.node->>'src', image.node->>'publicUrl')
          else null
        end), '')
      from public.properties as property
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(property.fotos) = 'array'
          then property.fotos else '[]'::jsonb end
      ) as image(node)
    ), missing_legacy_media as (
      select distinct
        media.organization_id,
        media.property_id,
        media.locator
      from raw_legacy_media as media
      where media.locator ~* '^https?://'
        and not exists (
          select 1
          from public.property_assets as asset
          where asset.organization_id = media.organization_id
            and asset.property_id = media.property_id
            and asset.asset_type = 'photo'
            and asset.external_url = media.locator
        )
    ), prospective_photos as (
      select asset.organization_id, asset.property_id, 'asset:' || asset.id::text as identity
      from public.property_assets as asset
      where asset.asset_type = 'photo'

      union all

      select media.organization_id, media.property_id, 'legacy:' || media.locator
      from missing_legacy_media as media
    )
    select 1
    from prospective_photos
    group by organization_id, property_id
    having count(*) > 20
  ) then
    raise exception 'property photo capacity exceeds 20; repair the canonical/legacy gallery before this migration'
      using errcode = '23514', constraint = 'property_assets_photo_capacity';
  end if;
end
$property_photo_capacity_preflight$;

-- Older forms stored public URLs directly on properties. Mirror any missing
-- HTTP(S) photos into the asset catalog, preserving the old hidden-site intent.
with raw_media as (
  select
    property.organization_id,
    property.id as property_id,
    nullif(btrim(property.imagem_principal), '') as locator,
    0 as sort_order,
    true as wants_primary,
    coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb) as hidden_urls,
    property.created_by,
    property.created_at,
    property.updated_at
  from public.properties as property

  union all

  select
    property.organization_id,
    property.id,
    nullif(btrim(image.url), ''),
    10 + image.position::integer,
    false,
    coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb),
    property.created_by,
    property.created_at,
    property.updated_at
  from public.properties as property
  cross join lateral unnest(coalesce(property.image_urls, '{}'::text[]))
    with ordinality as image(url, position)

  union all

  select
    property.organization_id,
    property.id,
    nullif(btrim(case
      when jsonb_typeof(image.node) = 'string' then image.node #>> '{}'
      when jsonb_typeof(image.node) = 'object' then
        coalesce(image.node->>'url', image.node->>'src', image.node->>'publicUrl')
      else null
    end), ''),
    1000 + image.position::integer,
    false,
    coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb),
    property.created_by,
    property.created_at,
    property.updated_at
  from public.properties as property
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(property.fotos) = 'array'
      then property.fotos else '[]'::jsonb end
  ) with ordinality as image(node, position)
), ranked_media as (
  select
    media.*,
    coalesce(media.hidden_urls ? media.locator, false) as is_hidden,
    row_number() over (
      partition by media.property_id, media.locator
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
  created_by,
  created_at,
  updated_at
)
select
  media.organization_id,
  media.property_id,
  'photo',
  case when media.is_hidden then 'internal' else 'public' end,
  media.locator,
  greatest(media.sort_order, 0),
  media.wants_primary
    and not media.is_hidden
    and not exists (
      select 1
      from public.property_assets as existing_primary
      where existing_primary.property_id = media.property_id
        and existing_primary.asset_type = 'photo'
        and existing_primary.is_primary
    ),
  jsonb_build_object(
    'legacy_backfill', true,
    'access_model', 'external_origin_uncontrolled'
  ),
  case when exists (
    select 1 from public.organization_members member
    where member.organization_id = media.organization_id
      and member.user_id = media.created_by
      and member.is_active = true
  ) then media.created_by else null end,
  media.created_at,
  media.updated_at
from ranked_media as media
where media.locator_rank = 1
on conflict (property_id, asset_type, external_url)
  where external_url is not null
do nothing;

-- A mixed database can already contain the legacy main locator as a normal
-- gallery asset. Promote that exact public locator when there is no primary;
-- never turn a hidden/internal external origin into a publishable photo.
update public.property_assets as asset
set is_primary = true,
    updated_at = now()
from public.properties as property
where asset.organization_id = property.organization_id
  and asset.property_id = property.id
  and asset.asset_type = 'photo'
  and asset.visibility = 'public'
  and asset.external_url = nullif(btrim(property.imagem_principal), '')
  and asset.external_url ~* '^https?://'
  and not (
    coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb)
      ? asset.external_url
  )
  and not exists (
    select 1
    from public.property_assets as existing_primary
    where existing_primary.property_id = property.id
      and existing_primary.asset_type = 'photo'
      and existing_primary.is_primary
  );

-- The old hidden list remains compatibility metadata only. Canonical assets
-- are authoritative, and an external URL is explicitly not represented as a
-- private object merely because it is hidden from channels.
update public.property_assets as asset
set visibility = 'internal',
    is_primary = false,
    metadata = asset.metadata || jsonb_build_object(
      'access_model', 'external_origin_uncontrolled'
    ),
    updated_at = now()
from public.properties as property
where asset.organization_id = property.organization_id
  and asset.property_id = property.id
  and asset.external_url is not null
  and coalesce(asset.metadata->>'legacy_backfill', 'false') = 'true'
  and coalesce(property.metadata->'hidden_site_image_urls', '[]'::jsonb) ? asset.external_url;

update public.property_assets
set metadata = metadata || jsonb_build_object(
      'access_model', 'external_origin_uncontrolled'
    ),
    updated_at = now()
where external_url is not null
  and coalesce(metadata->>'access_model', '') <> 'external_origin_uncontrolled';

-- Integrations that still write the compatibility columns are mirrored
-- append-only. Removing a legacy URL never deletes or mutates a canonical
-- asset (and therefore cannot invalidate an immutable publication snapshot).
create or replace function private.mirror_legacy_property_photos_to_assets()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
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
      ),
    pg_catalog.jsonb_build_object(
      'legacy_mirror', true,
      'access_model', 'external_origin_uncontrolled'
    ),
    coalesce(new.created_at, now()),
    coalesce(new.updated_at, now())
  from ranked_media as media
  where media.locator_rank = 1
  on conflict (property_id, asset_type, external_url)
    where external_url is not null
  do nothing;

  -- ON CONFLICT may have matched a gallery row created by an earlier import.
  -- Promote only that same public locator and only while no primary exists.
  update public.property_assets as asset
  set is_primary = true,
      updated_at = now()
  where asset.organization_id = new.organization_id
    and asset.property_id = new.id
    and asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and asset.external_url = nullif(pg_catalog.btrim(new.imagem_principal), '')
    and asset.external_url ~* '^https?://'
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

update public.property_assets
set is_primary = false,
    updated_at = now()
where is_primary
  and (asset_type <> 'photo' or visibility <> 'public');

with primary_candidates as (
  select
    asset.id,
    row_number() over (
      partition by asset.property_id
      order by asset.sort_order, asset.created_at, asset.id
    ) as candidate_rank
  from public.property_assets as asset
  where asset.asset_type = 'photo'
    and asset.visibility = 'public'
    and not exists (
      select 1
      from public.property_assets as current_primary
      where current_primary.property_id = asset.property_id
        and current_primary.asset_type = 'photo'
        and current_primary.is_primary
    )
)
update public.property_assets as asset
set is_primary = true,
    updated_at = now()
from primary_candidates as candidate
where asset.id = candidate.id
  and candidate.candidate_rank = 1;

do $add_property_assets_primary_public_check$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_primary_public_check'
  ) then
    alter table public.property_assets
      add constraint property_assets_primary_public_check
      check (not is_primary or (asset_type = 'photo' and visibility = 'public'))
      not valid;
  end if;
end
$add_property_assets_primary_public_check$;

alter table public.property_assets
  validate constraint property_assets_primary_public_check;

alter table public.property_asset_upload_intents enable row level security;
alter table public.property_asset_storage_cleanup_queue enable row level security;

revoke all on table
  public.property_asset_upload_intents,
  public.property_asset_storage_cleanup_queue
from public, anon, authenticated, service_role;

grant select, insert, update, delete on table
  public.property_asset_upload_intents,
  public.property_asset_storage_cleanup_queue
to service_role;

comment on table public.property_asset_upload_intents is
  'Short-lived BFF upload reservations for private property assets; never browser-readable.';
comment on table public.property_asset_storage_cleanup_queue is
  'Durable outbox for deleting canonical property objects after asset mutations or cascades.';

commit;
