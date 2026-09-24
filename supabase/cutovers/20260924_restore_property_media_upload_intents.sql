-- Emergency, schema-only cutover for the property media upload-intent 42P01.
-- Review docs/runbooks/property-media-upload-recovery-2026-09-24.md first.
-- This is deliberately outside supabase/migrations and does not mark
-- 20260908000636 as applied. Do not run it through db push.
-- The table, cleanup outbox and trigger definitions below are copied from
-- 20260908000636_normalize_property_media_lifecycle.sql. The legacy media
-- backfill, property-photo projection, bucket policy changes, and the older photo
-- capacity/mirror functions are intentionally excluded.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $property_media_upload_cutover_preflight$
begin
  if pg_catalog.to_regclass('public.property_asset_upload_intents') is not null
     or pg_catalog.to_regclass('public.property_asset_storage_cleanup_queue') is not null
     or pg_catalog.to_regclass('public.property_asset_upload_intents_expiry_idx') is not null
     or pg_catalog.to_regclass('public.property_asset_upload_intents_property_idx') is not null
     or pg_catalog.to_regclass('public.property_asset_storage_cleanup_due_idx') is not null
     or pg_catalog.to_regprocedure('private.queue_property_asset_storage_cleanup()') is not null
     or pg_catalog.to_regprocedure('private.queue_property_asset_upload_cleanup_on_cascade()') is not null
     or exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = pg_catalog.to_regclass('public.property_assets')
         and tgname = 'property_assets_queue_storage_cleanup'
     ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_partial_or_already_applied';
  end if;

  if pg_catalog.to_regclass('public.organizations') is null
     or pg_catalog.to_regclass('public.users') is null
     or pg_catalog.to_regclass('public.properties') is null
     or pg_catalog.to_regclass('public.property_assets') is null
     or pg_catalog.to_regclass('storage.buckets') is null
     or pg_catalog.to_regclass('storage.objects') is null
     or pg_catalog.to_regnamespace('private') is null
     or pg_catalog.to_regprocedure('gen_random_uuid()') is null then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_missing_dependency';
  end if;

  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_migration_ledger_unexpected';
  end if;

  if exists (
    select 1
    from (values
      ('public.organizations'::regclass, 'id', 'uuid'::regtype),
      ('public.users'::regclass, 'id', 'uuid'::regtype),
      ('public.properties'::regclass, 'id', 'uuid'::regtype),
      ('public.properties'::regclass, 'organization_id', 'uuid'::regtype),
      ('public.property_assets'::regclass, 'id', 'uuid'::regtype),
      ('public.property_assets'::regclass, 'organization_id', 'uuid'::regtype),
      ('public.property_assets'::regclass, 'property_id', 'uuid'::regtype),
      ('public.property_assets'::regclass, 'storage_path', 'text'::regtype)
    ) as required(table_oid, column_name, column_type)
    left join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = required.table_oid
     and attribute.attname = required.column_name
     and attribute.attnum > 0
     and not attribute.attisdropped
    where attribute.attnum is null
       or attribute.atttypid <> required.column_type
  ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_column_contract_mismatch';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_index as index_row
    where index_row.indexrelid = pg_catalog.to_regclass('public.properties_organization_id_id_uidx')
      and index_row.indrelid = 'public.properties'::regclass
      and index_row.indisunique
      and index_row.indisvalid
  ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_missing_property_tenant_key';
  end if;

  if not exists (
       select 1 from pg_catalog.pg_index
       where indexrelid = pg_catalog.to_regclass('public.property_assets_storage_locator_uidx')
         and indrelid = 'public.property_assets'::regclass
         and indisunique and indisvalid
     )
     or not exists (
       select 1 from pg_catalog.pg_index
       where indexrelid = pg_catalog.to_regclass('public.property_assets_primary_photo_uidx')
         and indrelid = 'public.property_assets'::regclass
         and indisunique and indisvalid
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.property_assets'::regclass
         and tgname = 'property_assets_enforce_storage_path'
         and tgenabled <> 'D'
     ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_asset_boundary_not_ready';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'property-private'
      and public = false
      and file_size_limit = 10485760
      and allowed_mime_types @> array[
        'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'
      ]::text[]
  ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_private_bucket_mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
  ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_browser_storage_mutation_policy_present';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'storage.objects'::regclass and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.property_assets'::regclass and relrowsecurity
  ) or exists (
    select 1
    from (values ('anon'), ('authenticated')) as browser_role(role_name)
    cross join (values
      ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
    ) as privilege_name(name)
    where pg_catalog.has_table_privilege(
      browser_role.role_name,
      'public.property_assets',
      privilege_name.name
    )
  ) or exists (
    select 1
    from (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as privilege_name(name)
    where not pg_catalog.has_table_privilege(
      'service_role',
      'public.property_assets',
      privilege_name.name
    )
  ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_existing_asset_boundary_mismatch';
  end if;

end;
$property_media_upload_cutover_preflight$;

-- BEGIN EXACT LIFECYCLE BLOCK FROM 20260908000636 LINES 41-274.
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
-- END EXACT LIFECYCLE BLOCK.

-- BEGIN EXACT ACCESS BLOCK FROM 20260908000636 LINES 770-786.
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
-- END EXACT ACCESS BLOCK.

do $property_media_upload_cutover_postcheck$
begin
  if pg_catalog.to_regclass('public.property_asset_upload_intents') is null
     or pg_catalog.to_regclass('public.property_asset_storage_cleanup_queue') is null
     or pg_catalog.to_regclass('public.property_asset_upload_intents_expiry_idx') is null
     or pg_catalog.to_regclass('public.property_asset_upload_intents_property_idx') is null
     or pg_catalog.to_regclass('public.property_asset_storage_cleanup_due_idx') is null
     or pg_catalog.to_regprocedure('private.queue_property_asset_storage_cleanup()') is null
     or pg_catalog.to_regprocedure('private.queue_property_asset_upload_cleanup_on_cascade()') is null
     or exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
         and roles && array['public', 'anon', 'authenticated']::name[]
     )
     or not exists (
       select 1 from pg_catalog.pg_class
       where oid = 'public.property_asset_upload_intents'::regclass and relrowsecurity
     )
     or not exists (
       select 1 from pg_catalog.pg_class
       where oid = 'public.property_asset_storage_cleanup_queue'::regclass and relrowsecurity
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.property_assets'::regclass
         and tgname = 'property_assets_queue_storage_cleanup'
         and tgenabled <> 'D'
     )
     or not exists (
       select 1 from pg_catalog.pg_trigger
       where tgrelid = 'public.property_asset_upload_intents'::regclass
         and tgname = 'property_asset_upload_intents_queue_cleanup_on_cascade'
         and tgenabled <> 'D'
     )
     or exists (
       select 1
       from (values
         ('public.property_asset_upload_intents', 'anon'),
         ('public.property_asset_upload_intents', 'authenticated'),
         ('public.property_asset_storage_cleanup_queue', 'anon'),
         ('public.property_asset_storage_cleanup_queue', 'authenticated')
       ) as browser_access(table_name, role_name)
       cross join (values
         ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')
       ) as browser_privilege(privilege_name)
       where pg_catalog.has_table_privilege(
         browser_access.role_name,
         browser_access.table_name,
         browser_privilege.privilege_name
       )
     )
     or exists (
       select 1
       from (values
         ('public.property_asset_upload_intents'),
         ('public.property_asset_storage_cleanup_queue')
       ) as worker_access(table_name)
       where not pg_catalog.has_table_privilege(
         'service_role', worker_access.table_name, 'SELECT'
       ) or not pg_catalog.has_table_privilege(
         'service_role', worker_access.table_name, 'INSERT'
       ) or not pg_catalog.has_table_privilege(
         'service_role', worker_access.table_name, 'UPDATE'
       ) or not pg_catalog.has_table_privilege(
         'service_role', worker_access.table_name, 'DELETE'
       )
     )
     or not exists (
       select 1 from storage.buckets
       where id = 'property-private' and public = false
     ) then
    raise exception using errcode = '55000',
      message = 'property_media_upload_cutover_postcheck_failed';
  end if;
end;
$property_media_upload_cutover_postcheck$;

commit;
