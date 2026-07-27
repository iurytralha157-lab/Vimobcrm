-- Replace remote-only legacy Storage policies with the repository's canonical
-- permission-aware policies. The old helper accepted inactive memberships and
-- was also exposed as an authenticated SECURITY DEFINER RPC.
drop policy if exists "Org members manage properties" on storage.objects;
drop policy if exists "Org members manage whatsapp-media" on storage.objects;
drop policy if exists "Org members manage automation-media" on storage.objects;

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

do $$
begin
  if to_regprocedure('public.check_storage_org_access(text)') is not null then
    revoke execute on function public.check_storage_org_access(text)
      from public, anon, authenticated;
  end if;
end;
$$;
