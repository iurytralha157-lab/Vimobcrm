begin;

set local role postgres;
set local search_path = public, private, auth, extensions, pgtap, pg_catalog;

create extension if not exists pgtap with schema extensions;
select plan(36);

select ok(
  (select public from storage.buckets where id = 'properties')
  and not (select public from storage.buckets where id = 'property-private'),
  'legacy public URLs stay readable while canonical property originals stay private'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and roles && array['public', 'anon', 'authenticated']::name[]
      and (
        coalesce(qual, '') ~* '''(properties|property-private)'''
        or coalesce(with_check, '') ~* '''(properties|property-private)'''
      )
  ),
  0::bigint,
  'browser roles cannot mutate legacy or canonical property Storage objects'
);

select has_table(
  'public',
  'property_asset_upload_intents',
  'private property uploads have durable reservations'
);

select has_column(
  'public',
  'property_asset_upload_intents',
  'consumed_at',
  'signed upload reservations remain as tombstones after attachment'
);

select has_table(
  'public',
  'property_asset_storage_cleanup_queue',
  'private property object deletion has a durable outbox'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.property_asset_upload_intents'::regclass)
  and (select relrowsecurity from pg_class where oid = 'public.property_asset_storage_cleanup_queue'::regclass),
  'both lifecycle tables enforce RLS'
);

select is(
  (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'property_asset_upload_intents',
        'property_asset_storage_cleanup_queue'
      ])
  ),
  0::bigint,
  'lifecycle tables expose no browser RLS policies'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.property_asset_upload_intents',
    'select,insert,update,delete'
  )
  and not has_table_privilege(
    'anon',
    'public.property_asset_storage_cleanup_queue',
    'select,insert,update,delete'
  )
  and not has_table_privilege(
    'authenticated',
    'public.property_asset_upload_intents',
    'select,insert,update,delete'
  )
  and not has_table_privilege(
    'authenticated',
    'public.property_asset_storage_cleanup_queue',
    'select,insert,update,delete'
  ),
  'browser roles have no direct lifecycle-table CRUD'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.property_asset_upload_intents',
    'select,insert,update,delete'
  )
  and has_table_privilege(
    'service_role',
    'public.property_asset_storage_cleanup_queue',
    'select,insert,update,delete'
  ),
  'the backend service can process reservations and cleanup work'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.property_asset_upload_intents'::regclass
      and conname = any(array[
        'property_asset_upload_intents_type_check',
        'property_asset_upload_intents_name_check',
        'property_asset_upload_intents_mime_check',
        'property_asset_upload_intents_size_check',
        'property_asset_upload_intents_expiry_check',
        'property_asset_upload_intents_path_check',
        'property_asset_upload_intents_cleanup_attempts_check',
        'property_asset_upload_intents_error_check'
      ])
  ),
  8::bigint,
  'upload reservations enforce type, file, expiry, namespace and retry bounds'
);

select is(
  (
    select count(*)
    from pg_constraint
    where conrelid = 'public.property_asset_storage_cleanup_queue'::regclass
      and conname = any(array[
        'property_asset_storage_cleanup_bucket_check',
        'property_asset_storage_cleanup_path_check',
        'property_asset_storage_cleanup_attempts_check',
        'property_asset_storage_cleanup_error_check'
      ])
  ),
  4::bigint,
  'cleanup work is restricted to the canonical private namespace'
);

select has_trigger(
  'public',
  'property_assets',
  'property_assets_queue_storage_cleanup',
  'asset deletion and storage replacement enqueue object cleanup'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'private.queue_property_asset_storage_cleanup()'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.queue_property_asset_storage_cleanup()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.queue_property_asset_storage_cleanup()',
    'execute'
  ),
  'cleanup trigger primitive is invoker-rights and cannot be called directly'
);

select has_trigger(
  'public',
  'property_asset_upload_intents',
  'property_asset_upload_intents_queue_cleanup_on_cascade',
  'cascaded upload reservations preserve their object path for cleanup'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'private.queue_property_asset_upload_cleanup_on_cascade()'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.queue_property_asset_upload_cleanup_on_cascade()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.queue_property_asset_upload_cleanup_on_cascade()',
    'execute'
  ),
  'upload-cascade cleanup is invoker-rights and trigger-only'
);

select has_trigger(
  'public',
  'property_assets',
  'property_assets_enforce_photo_capacity',
  'every canonical asset writer is subject to the 20-photo limit'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'private.enforce_property_photo_asset_capacity()'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.enforce_property_photo_asset_capacity()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.enforce_property_photo_asset_capacity()',
    'execute'
  ),
  'photo capacity enforcement is invoker-rights and trigger-only'
);

select has_trigger(
  'public',
  'properties',
  'properties_mirror_legacy_photos_to_assets',
  'future legacy property media is mirrored into the asset catalog'
);

select ok(
  not (
    select prosecdef
    from pg_proc
    where oid = 'private.mirror_legacy_property_photos_to_assets()'::regprocedure
  )
  and not has_function_privilege(
    'authenticated',
    'private.mirror_legacy_property_photos_to_assets()',
    'execute'
  )
  and not has_function_privilege(
    'service_role',
    'private.mirror_legacy_property_photos_to_assets()',
    'execute'
  ),
  'legacy mirror is invoker-rights and cannot be called directly'
);

select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.property_assets'::regclass
      and conname = 'property_assets_primary_public_check'
      and convalidated
  ),
  'the validated primary-photo constraint is installed'
);

insert into public.organizations (id, name, slug, is_active)
values (
  'a9100000-0000-4000-8000-000000000001',
  'Property Media Lifecycle Test',
  'property-media-lifecycle-test',
  true
);

insert into public.properties (id, organization_id, code, status)
values
  (
    'a9200000-0000-4000-8000-000000000001',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-PROMOTE',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000002',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-HIDDEN',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000003',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-CLEANUP',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000004',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-CASCADE',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000005',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-CAPACITY',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000006',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-LEGACY-CAPACITY',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000007',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-REPLACEMENT-CLEANUP',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000008',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-REPLAY-DEADLINE',
    'ativo'
  ),
  (
    'a9200000-0000-4000-8000-000000000009',
    'a9100000-0000-4000-8000-000000000001',
    'MEDIA-REPLACEMENT-CASCADE',
    'ativo'
  );

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  external_url, sort_order, is_primary
)
values
  (
    'a9300000-0000-4000-8000-000000000001',
    'a9100000-0000-4000-8000-000000000001',
    'a9200000-0000-4000-8000-000000000001',
    'photo', 'public', 'https://media.example.test/main.jpg', 10, false
  ),
  (
    'a9300000-0000-4000-8000-000000000002',
    'a9100000-0000-4000-8000-000000000001',
    'a9200000-0000-4000-8000-000000000002',
    'photo', 'internal', 'https://media.example.test/hidden.jpg', 10, false
  );

update public.properties
set imagem_principal = 'https://media.example.test/main.jpg'
where id = 'a9200000-0000-4000-8000-000000000001';

select is(
  (
    select is_primary
    from public.property_assets
    where id = 'a9300000-0000-4000-8000-000000000001'
  ),
  true,
  'a pre-existing public gallery row is promoted when it becomes legacy main'
);

update public.properties
set imagem_principal = 'https://media.example.test/hidden.jpg',
    metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{hidden_site_image_urls}',
      '["https://media.example.test/hidden.jpg"]'::jsonb,
      true
    )
where id = 'a9200000-0000-4000-8000-000000000002';

select is(
  (
    select is_primary
    from public.property_assets
    where id = 'a9300000-0000-4000-8000-000000000002'
  ),
  false,
  'a hidden/internal legacy locator is never promoted to primary'
);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, visibility,
      external_url, is_primary
    ) values (
      'a9100000-0000-4000-8000-000000000001',
      'a9200000-0000-4000-8000-000000000003',
      'photo', 'internal', 'https://media.example.test/not-public.jpg', true
    )
  $$,
  '23514',
  null,
  'an internal photo cannot be primary'
);

insert into public.property_assets (
  organization_id, property_id, asset_type, visibility,
  external_url, sort_order, is_primary
)
select
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000005',
  'photo', 'public',
  'https://media.example.test/capacity-' || position || '.jpg',
  position,
  position = 1
from generate_series(1, 20) as photo(position);

select throws_ok(
  $$
    insert into public.property_assets (
      organization_id, property_id, asset_type, visibility,
      external_url, sort_order, is_primary
    ) values (
      'a9100000-0000-4000-8000-000000000001',
      'a9200000-0000-4000-8000-000000000005',
      'photo', 'public', 'https://media.example.test/capacity-21.jpg', 21, false
    )
  $$,
  '23514',
  null,
  'a twenty-first canonical photo is rejected at the database boundary'
);

select is(
  (
    select count(*)
    from public.property_assets
    where property_id = 'a9200000-0000-4000-8000-000000000005'
      and asset_type = 'photo'
  ),
  20::bigint,
  'a rejected photo does not change the canonical gallery'
);

select lives_ok(
  $$
    update public.properties
    set image_urls = array(
          select 'https://media.example.test/capacity-' || position || '.jpg'
          from generate_series(1, 20) as photo(position)
        ),
        metadata = jsonb_set(metadata, '{media_reconciled}', 'true'::jsonb, true)
    where id = 'a9200000-0000-4000-8000-000000000005'
  $$,
  'a full gallery accepts an idempotent legacy media/metadata projection'
);

select is(
  (
    select count(*)
    from public.property_assets
    where property_id = 'a9200000-0000-4000-8000-000000000005'
      and asset_type = 'photo'
  ),
  20::bigint,
  'an idempotent full-gallery mirror does not create extra photos'
);

select throws_ok(
  $$
    update public.properties
    set image_urls = array(
      select 'https://legacy.example.test/photo-' || position || '.jpg'
      from generate_series(1, 21) as photo(position)
    )
    where id = 'a9200000-0000-4000-8000-000000000006'
  $$,
  '23514',
  null,
  'a legacy compatibility write cannot mirror more than 20 photos'
);

select ok(
  (
    select cardinality(coalesce(image_urls, '{}'::text[])) = 0
    from public.properties
    where id = 'a9200000-0000-4000-8000-000000000006'
  )
  and not exists (
    select 1
    from public.property_assets
    where property_id = 'a9200000-0000-4000-8000-000000000006'
      and asset_type = 'photo'
  ),
  'the rejected legacy write rolls back both projection and mirrored assets'
);

insert into public.property_asset_upload_intents (
  organization_id, property_id, storage_path, asset_type,
  file_name, mime_type, file_size_bytes, expires_at
)
values (
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000006',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000006/a9400000-0000-4000-8000-000000000002/discarded.jpg',
  'photo', 'discarded.jpg', 'image/jpeg', 1024, now() + interval '10 minutes'
);

delete from public.property_asset_upload_intents
where storage_path =
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000006/a9400000-0000-4000-8000-000000000002/discarded.jpg';

select ok(
  not exists (
    select 1
    from public.property_asset_storage_cleanup_queue
    where storage_path =
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000006/a9400000-0000-4000-8000-000000000002/discarded.jpg'
  ),
  'deleting an upload intent while its property exists does not enqueue a second object removal'
);

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  storage_path, sort_order, is_primary
)
values (
  'a9300000-0000-4000-8000-000000000003',
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000003',
  'photo', 'public',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000003/a9300000-0000-4000-8000-000000000003/photo.jpg',
  0, true
);

delete from public.property_assets
where id = 'a9300000-0000-4000-8000-000000000003';

select is(
  (
    select count(*)
    from public.property_asset_storage_cleanup_queue
    where asset_id = 'a9300000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'deleting a canonical object-backed asset enqueues cleanup'
);

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  storage_path, sort_order, is_primary, metadata
)
values (
  'a9300000-0000-4000-8000-000000000007',
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000007',
  'photo', 'public',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9300000-0000-4000-8000-000000000007/original.jpg',
  0, true,
  '{}'::jsonb
);

update public.property_assets
set storage_path =
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9400000-0000-4000-8000-000000000007/replacement-1.jpg',
    metadata = '{"legacy_backfill":true}'::jsonb
where id = 'a9300000-0000-4000-8000-000000000007';

update public.property_assets
set storage_path =
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9500000-0000-4000-8000-000000000007/replacement-2.jpg'
where id = 'a9300000-0000-4000-8000-000000000007';

delete from public.property_assets
where id = 'a9300000-0000-4000-8000-000000000007';

select ok(
  (
    select count(*) = 3
      and count(*) filter (where asset_id = 'a9300000-0000-4000-8000-000000000007') = 1
      and count(*) filter (where asset_id is null) = 2
    from public.property_asset_storage_cleanup_queue
    where storage_path = any(array[
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9300000-0000-4000-8000-000000000007/original.jpg',
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9400000-0000-4000-8000-000000000007/replacement-1.jpg',
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000007/a9500000-0000-4000-8000-000000000007/replacement-2.jpg'
    ])
  ),
  'successive replacement and delete enqueue every canonical path without assuming the row UUID'
);

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  storage_path, sort_order, is_primary, metadata
)
values (
  'a9300000-0000-4000-8000-000000000009',
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000009',
  'photo', 'public',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000009/a9400000-0000-4000-8000-000000000009/replacement-cascade.jpg',
  0, true,
  '{"legacy_backfill":true}'::jsonb
);

delete from public.properties
where id = 'a9200000-0000-4000-8000-000000000009';

select ok(
  exists (
    select 1
    from public.property_asset_storage_cleanup_queue
    where storage_path =
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000009/a9400000-0000-4000-8000-000000000009/replacement-cascade.jpg'
      and asset_id is null
  ),
  'property cascade enqueues a replacement path whose UUID differs from the asset row'
);

insert into public.property_asset_upload_intents (
  organization_id, property_id, storage_path, asset_type,
  file_name, mime_type, file_size_bytes, expires_at, consumed_at
)
values (
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000008',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000008/a9300000-0000-4000-8000-000000000008/replay.jpg',
  'photo', 'replay.jpg', 'image/jpeg', 1024,
  now() + interval '10 minutes', now()
);

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  storage_path, sort_order, is_primary
)
values (
  'a9300000-0000-4000-8000-000000000008',
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000008',
  'photo', 'public',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000008/a9300000-0000-4000-8000-000000000008/replay.jpg',
  0, true
);

delete from public.property_assets
where id = 'a9300000-0000-4000-8000-000000000008';

select ok(
  exists (
    select 1
    from public.property_asset_storage_cleanup_queue
    where storage_path =
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000008/a9300000-0000-4000-8000-000000000008/replay.jpg'
      and available_at >= now() + interval '14 minutes'
  ),
  'asset deletion cannot free a signed upload path before token expiry plus margin'
);

insert into public.property_assets (
  id, organization_id, property_id, asset_type, visibility,
  storage_path, sort_order, is_primary
)
values (
  'a9300000-0000-4000-8000-000000000004',
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000004',
  'photo', 'public',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000004/a9300000-0000-4000-8000-000000000004/photo.jpg',
  0, true
);

delete from public.properties
where id = 'a9200000-0000-4000-8000-000000000004';

select is(
  (
    select count(*)
    from public.property_asset_storage_cleanup_queue
    where asset_id = 'a9300000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'property cascade deletion keeps durable object cleanup work'
);

insert into public.property_asset_upload_intents (
  organization_id, property_id, storage_path, asset_type,
  file_name, mime_type, file_size_bytes, expires_at
)
values (
  'a9100000-0000-4000-8000-000000000001',
  'a9200000-0000-4000-8000-000000000003',
  'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000003/a9400000-0000-4000-8000-000000000001/pending.jpg',
  'photo', 'pending.jpg', 'image/jpeg', 1024, now() + interval '10 minutes'
);

delete from public.properties
where id = 'a9200000-0000-4000-8000-000000000003';

select ok(
  not exists (
    select 1
    from public.property_asset_upload_intents
    where property_id = 'a9200000-0000-4000-8000-000000000003'
  )
  and exists (
    select 1
    from public.property_asset_storage_cleanup_queue
    where storage_path =
      'orgs/a9100000-0000-4000-8000-000000000001/properties/a9200000-0000-4000-8000-000000000003/a9400000-0000-4000-8000-000000000001/pending.jpg'
      and asset_id is null
      and available_at >= now() + interval '14 minutes'
  ),
  'property cascade preserves an unconsumed path until token expiry plus margin'
);

select * from finish();
rollback;
