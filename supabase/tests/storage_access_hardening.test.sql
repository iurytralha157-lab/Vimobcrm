begin;

create extension if not exists pgtap with schema extensions;
select plan(12);

select is(
  (select public from storage.buckets where id = 'whatsapp-media'),
  false,
  'WhatsApp media remains a private bucket'
);

select results_eq(
  $$select count(*)::bigint from storage.buckets where id in ('avatars', 'logos', 'properties', 'site-images') and file_size_limit = 10485760 and allowed_mime_types is not null$$,
  array[4::bigint],
  'public asset buckets have explicit size and MIME restrictions'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('Public read access whatsapp-media', 'WhatsApp media restricted to org users')$$,
  array[0::bigint],
  'legacy public WhatsApp policies are absent'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'Authenticated Manage site-images'$$,
  array[0::bigint],
  'cross-tenant site image management policy is absent'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('Anon can upload onboarding logos', 'Authenticated can upload org logos', 'Authenticated can upload to org folder', 'Manage logos bucket')$$,
  array[0::bigint],
  'legacy loose logo mutation policies are absent'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('Avatar images are publicly accessible', 'Logos are publicly accessible', 'Property images are publicly accessible', 'Public Read site-images', 'public read public vimob buckets')$$,
  array[0::bigint],
  'public asset buckets cannot be enumerated through legacy SELECT policies'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in (
        'Org members manage whatsapp-media',
        'org members read private whatsapp media'
      )
      and 'authenticated' = any(roles)
  ),
  'tenant-scoped WhatsApp compatibility policy remains'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'org admins manage site images'
      and 'authenticated' = any(roles)
  ),
  'tenant-scoped site image policy remains'
);

select results_eq(
  $$select count(*)::bigint from public.whatsapp_messages where media_url like '%/storage/v1/object/public/whatsapp-media/%'$$,
  array[0::bigint],
  'public WhatsApp URLs were canonicalized to private storage paths'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and (coalesce(qual, '') ilike '%check_storage_org_access%' or coalesce(with_check, '') ilike '%check_storage_org_access%')$$,
  array[0::bigint],
  'Storage policies do not depend on the legacy public helper'
);

select ok(
  coalesce((
    select bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'check_storage_org_access'
      and pg_get_function_identity_arguments(p.oid) = 'org_id_text text'
  ), true),
  'authenticated users cannot execute the legacy SECURITY DEFINER helper'
);

select results_eq(
  $$select count(*)::bigint from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname in ('property managers manage property images', 'org members read private whatsapp media', 'org members upload private whatsapp media', 'org members remove own whatsapp media', 'automation admins manage media') and 'authenticated' = any(roles)$$,
  array[5::bigint],
  'canonical permission-aware Storage policies are installed'
);

select * from finish();
rollback;
