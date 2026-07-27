-- Objetos personalizados fora de public/private.
-- Gerado a partir do catálogo de produção em 2026-07-22.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('automation-media', 'automation-media', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/ogg', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4']),
  ('avatars', 'avatars', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('contract-documents', 'contract-documents', false, 26214400, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']),
  ('logos', 'logos', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('properties', 'properties', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('site-images', 'site-images', true, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']),
  ('whatsapp-media', 'whatsapp-media', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/mpeg', 'video/quicktime', 'video/webm', 'video/ogg', 'audio/aac', 'audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/webm', 'audio/mp4', 'application/pdf', 'application/octet-stream'])
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists whatsapp_authorized_private_broadcast on realtime.messages;
create policy whatsapp_authorized_private_broadcast on realtime.messages as permissive for select to authenticated
using (((extension = 'broadcast'::text) AND private.can_receive_whatsapp_broadcast(( SELECT realtime.topic() AS topic))));

drop policy if exists "Users manage own avatar" on storage.objects;
create policy "Users manage own avatar" on storage.objects as permissive for all to authenticated
using (((bucket_id = 'avatars'::text) AND (is_super_admin() OR (name ~~ ((( SELECT auth.uid() AS uid))::text || '%'::text)) OR (name ~~ (('avatars/'::text || (( SELECT auth.uid() AS uid))::text) || '%'::text)))))
with check (((bucket_id = 'avatars'::text) AND (is_super_admin() OR (name ~~ ((( SELECT auth.uid() AS uid))::text || '%'::text)) OR (name ~~ (('avatars/'::text || (( SELECT auth.uid() AS uid))::text) || '%'::text)))));

drop policy if exists "automation admins manage media" on storage.objects;
create policy "automation admins manage media" on storage.objects as permissive for all to authenticated
using (((bucket_id = 'automation-media'::text) AND (private.has_permission(private.safe_uuid(split_part(name, '/'::text, 1)), 'automations_edit'::text) OR private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 1)), ARRAY['owner'::text, 'admin'::text]))))
with check (((bucket_id = 'automation-media'::text) AND (private.has_permission(private.safe_uuid(split_part(name, '/'::text, 1)), 'automations_edit'::text) OR private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 1)), ARRAY['owner'::text, 'admin'::text]))));

drop policy if exists contract_docs_delete on storage.objects;
create policy contract_docs_delete on storage.objects as permissive for delete to authenticated
using (((bucket_id = 'contract-documents'::text) AND ((storage.foldername(name))[1] IN ( SELECT (users.organization_id)::text AS organization_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))))));

drop policy if exists contract_docs_insert on storage.objects;
create policy contract_docs_insert on storage.objects as permissive for insert to authenticated
with check (((bucket_id = 'contract-documents'::text) AND ((storage.foldername(name))[1] IN ( SELECT (users.organization_id)::text AS organization_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))))));

drop policy if exists contract_docs_select on storage.objects;
create policy contract_docs_select on storage.objects as permissive for select to authenticated
using (((bucket_id = 'contract-documents'::text) AND ((storage.foldername(name))[1] IN ( SELECT (users.organization_id)::text AS organization_id
   FROM users
  WHERE (users.id = ( SELECT auth.uid() AS uid))))));

drop policy if exists "org admins manage logo assets" on storage.objects;
create policy "org admins manage logo assets" on storage.objects as permissive for all to authenticated
using (((bucket_id = 'logos'::text) AND (split_part(name, '/'::text, 1) = 'organizations'::text) AND (private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]) OR private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'settings_manage'::text))))
with check (((bucket_id = 'logos'::text) AND (split_part(name, '/'::text, 1) = 'organizations'::text) AND (private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]) OR private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'settings_manage'::text))));

drop policy if exists "org admins manage site images" on storage.objects;
create policy "org admins manage site images" on storage.objects as permissive for all to authenticated
using (((bucket_id = 'site-images'::text) AND (split_part(name, '/'::text, 1) = 'organizations'::text) AND (private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]) OR private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'settings_manage'::text))))
with check (((bucket_id = 'site-images'::text) AND (split_part(name, '/'::text, 1) = 'organizations'::text) AND (private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]) OR private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'settings_manage'::text))));

drop policy if exists "org members read private whatsapp media" on storage.objects;
create policy "org members read private whatsapp media" on storage.objects as permissive for select to authenticated
using (((bucket_id = 'whatsapp-media'::text) AND (split_part(name, '/'::text, 1) = 'orgs'::text) AND private.is_org_member(private.safe_uuid(split_part(name, '/'::text, 2)))));

drop policy if exists "org members remove own whatsapp media" on storage.objects;
create policy "org members remove own whatsapp media" on storage.objects as permissive for delete to authenticated
using (((bucket_id = 'whatsapp-media'::text) AND (split_part(name, '/'::text, 1) = 'orgs'::text) AND ((owner = auth.uid()) OR private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'whatsapp_manage'::text) OR private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]))));

drop policy if exists "org members upload private whatsapp media" on storage.objects;
create policy "org members upload private whatsapp media" on storage.objects as permissive for insert to authenticated
with check (((bucket_id = 'whatsapp-media'::text) AND (split_part(name, '/'::text, 1) = 'orgs'::text) AND private.is_org_member(private.safe_uuid(split_part(name, '/'::text, 2)))));

drop policy if exists "property managers manage property images" on storage.objects;
create policy "property managers manage property images" on storage.objects as permissive for all to authenticated
using (((bucket_id = 'properties'::text) AND (split_part(name, '/'::text, 1) = 'orgs'::text) AND (private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'property_manage'::text) OR private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]))))
with check (((bucket_id = 'properties'::text) AND (split_part(name, '/'::text, 1) = 'orgs'::text) AND (private.has_permission(private.safe_uuid(split_part(name, '/'::text, 2)), 'property_manage'::text) OR private.has_org_role(private.safe_uuid(split_part(name, '/'::text, 2)), ARRAY['owner'::text, 'admin'::text]))));

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gamification_events'
  ) then
    alter publication supabase_realtime add table public.gamification_events;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gamification_manual_entries'
  ) then
    alter publication supabase_realtime add table public.gamification_manual_entries;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gamification_missions'
  ) then
    alter publication supabase_realtime add table public.gamification_missions;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gamification_participants'
  ) then
    alter publication supabase_realtime add table public.gamification_participants;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'gamification_seasons'
  ) then
    alter publication supabase_realtime add table public.gamification_seasons;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'stages'
  ) then
    alter publication supabase_realtime add table public.stages;
  end if;
end
$publication$;

do $publication$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'user_gamification_stats'
  ) then
    alter publication supabase_realtime add table public.user_gamification_stats;
  end if;
end
$publication$;
