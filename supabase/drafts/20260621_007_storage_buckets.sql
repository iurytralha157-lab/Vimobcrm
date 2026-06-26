-- Vimob CRM - DRAFT ONLY - Storage buckets and object RLS
-- Do not run before review.
-- Buckets covered:
--   avatars
--   logos
--   properties
--   site-images
--   whatsapp-media
--   automation-media
--   contract-documents
--
-- Security principle:
--   Public buckets only for assets intended to be public: avatars, logos, property/site images.
--   WhatsApp media and contract documents stay private and must use signed URLs.
--
-- Frontend alignment note:
--   Some current site uploads use site-images/sites/{file}. That path does not include organization_id.
--   This draft allows org admins to write that prefix for compatibility, but the safer production path is:
--   site-images/organizations/{organization_id}/sites/{file}.

create or replace function private.safe_uuid(value text)
returns uuid
language plpgsql
immutable
as $$
begin
  if value is null or value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return null;
  end if;

  return value::uuid;
exception when others then
  return null;
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('logos', 'logos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('properties', 'properties', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('site-images', 'site-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('whatsapp-media', 'whatsapp-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/ogg', 'application/pdf', 'application/octet-stream']),
  ('automation-media', 'automation-media', false, 26214400, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'audio/mpeg', 'audio/mp4', 'audio/ogg']),
  ('contract-documents', 'contract-documents', false, 26214400, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read public vimob buckets" on storage.objects;
create policy "public read public vimob buckets"
on storage.objects
for select
to anon, authenticated
using (bucket_id in ('avatars', 'logos', 'properties', 'site-images'));

drop policy if exists "users manage own avatars" on storage.objects;
create policy "users manage own avatars"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'avatars'
  and split_part(split_part(name, '/', 2), '-', 1) = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and split_part(name, '/', 1) = 'avatars'
  and split_part(split_part(name, '/', 2), '-', 1) = auth.uid()::text
);

drop policy if exists "org admins manage logo assets" on storage.objects;
create policy "org admins manage logo assets"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'logos'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
)
with check (
  bucket_id = 'logos'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
);

drop policy if exists "property managers manage property images" on storage.objects;
create policy "property managers manage property images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'properties'
  and split_part(name, '/', 1) = 'orgs'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'property_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'properties'
  and split_part(name, '/', 1) = 'orgs'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'property_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
);

drop policy if exists "org admins manage site images" on storage.objects;
create policy "org admins manage site images"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'site-images'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
)
with check (
  bucket_id = 'site-images'
  and (
    (
      split_part(name, '/', 1) = 'organizations'
      and (
        private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
        or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'settings_manage')
      )
    )
    or (
      split_part(name, '/', 1) = 'sites'
      and exists (
        select 1
        from public.organization_members om
        where om.user_id = auth.uid()
          and om.is_active = true
          and om.role in ('owner', 'admin')
      )
    )
  )
);

drop policy if exists "org members read private whatsapp media" on storage.objects;
create policy "org members read private whatsapp media"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and private.is_org_member(private.safe_uuid(split_part(name, '/', 2)))
);

drop policy if exists "org members upload private whatsapp media" on storage.objects;
create policy "org members upload private whatsapp media"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and private.is_org_member(private.safe_uuid(split_part(name, '/', 2)))
);

drop policy if exists "org members remove own whatsapp media" on storage.objects;
create policy "org members remove own whatsapp media"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'whatsapp-media'
  and split_part(name, '/', 1) = 'orgs'
  and (
    owner = auth.uid()
    or private.has_permission(private.safe_uuid(split_part(name, '/', 2)), 'whatsapp_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 2)), array['owner', 'admin'])
  )
);

drop policy if exists "automation admins manage media" on storage.objects;
create policy "automation admins manage media"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'automation-media'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'automations_edit')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'automation-media'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'automations_edit')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
);

drop policy if exists "financial admins manage contract documents" on storage.objects;
create policy "financial admins manage contract documents"
on storage.objects
for all
to authenticated
using (
  bucket_id = 'contract-documents'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'financial_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
)
with check (
  bucket_id = 'contract-documents'
  and (
    private.has_permission(private.safe_uuid(split_part(name, '/', 1)), 'financial_manage')
    or private.has_org_role(private.safe_uuid(split_part(name, '/', 1)), array['owner', 'admin'])
  )
);
