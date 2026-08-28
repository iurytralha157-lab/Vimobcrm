-- Remove the legacy global-read branch from prospecting reports. The table
-- contains user-authored descriptions and metadata and must stay tenant scoped.
revoke all privileges on table public.prospecting_reports from anon;

drop policy if exists "prospecting reports consolidated select"
on public.prospecting_reports;

create policy "prospecting reports consolidated select"
on public.prospecting_reports
as permissive
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or public.is_super_admin()
  or private.is_org_member(organization_id)
);

-- WhatsApp media is served by the backend through short-lived signed URLs
-- after conversation/lead authorization. A same-organization Storage SELECT
-- policy bypasses that finer-grained authorization and allows enumeration.
drop policy if exists "org members read private whatsapp media"
on storage.objects;
