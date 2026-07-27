-- Keep public visual assets directly addressable, but prevent anonymous bucket
-- enumeration and all legacy cross-tenant mutation paths. Private WhatsApp
-- assets are returned by the API through short-lived signed URLs.
drop policy if exists "Public read access whatsapp-media" on storage.objects;
drop policy if exists "WhatsApp media restricted to org users" on storage.objects;
drop policy if exists "Authenticated Manage site-images" on storage.objects;
drop policy if exists "Anon can upload onboarding logos" on storage.objects;
drop policy if exists "Anon can view onboarding logos" on storage.objects;
drop policy if exists "Authenticated can upload org logos" on storage.objects;
drop policy if exists "Authenticated can upload to org folder" on storage.objects;
drop policy if exists "Manage logos bucket" on storage.objects;

-- Public buckets do not require SELECT policies for direct object delivery.
-- Removing these policies prevents list/enumeration through the Storage API.
drop policy if exists "Avatar images are publicly accessible" on storage.objects;
drop policy if exists "Logos are publicly accessible" on storage.objects;
drop policy if exists "Property images are publicly accessible" on storage.objects;
drop policy if exists "Public Read site-images" on storage.objects;
drop policy if exists "public read public vimob buckets" on storage.objects;

update storage.buckets
set public = false
where id = 'whatsapp-media';

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
where id in ('avatars', 'properties');

update storage.buckets
set file_size_limit = 10485760,
    allowed_mime_types = array[
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/svg+xml',
      'image/x-icon',
      'image/vnd.microsoft.icon'
    ]
where id in ('logos', 'site-images');

-- Canonicalize the small set of historical public WhatsApp URLs that point to
-- an object owned by the same organization. Unsafe or external URLs are left
-- untouched and are never signed by the API.
with candidates as (
  select
    id,
    organization_id,
    split_part(
      split_part(media_url, '/storage/v1/object/public/whatsapp-media/', 2),
      '?',
      1
    ) as derived_path
  from public.whatsapp_messages
  where media_url like '%/storage/v1/object/public/whatsapp-media/%'
)
update public.whatsapp_messages as message
set media_storage_path = coalesce(nullif(message.media_storage_path, ''), candidate.derived_path),
    media_url = null,
    media_status = coalesce(message.media_status, 'ready')
from candidates as candidate
where candidate.id = message.id
  and (
    candidate.derived_path like 'orgs/' || candidate.organization_id::text || '/%'
    or candidate.derived_path like candidate.organization_id::text || '/%'
  );
