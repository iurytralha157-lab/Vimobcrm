-- Keep portal authorization equivalent while avoiding duplicate SELECT policies.
drop policy if exists "admins manage portal integrations" on public.portal_integrations;

create policy "admins insert portal integrations"
on public.portal_integrations
for insert
to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

create policy "admins update portal integrations"
on public.portal_integrations
for update
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

create policy "admins delete portal integrations"
on public.portal_integrations
for delete
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

drop policy if exists "admins manage portal publications" on public.portal_listing_publications;

create policy "admins insert portal publications"
on public.portal_listing_publications
for insert
to authenticated
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

create policy "admins update portal publications"
on public.portal_listing_publications
for update
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin())
with check (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

create policy "admins delete portal publications"
on public.portal_listing_publications
for delete
to authenticated
using (private.has_org_role(organization_id, array['owner', 'admin']) or private.is_super_admin());

create index if not exists portal_integrations_created_by_idx
  on public.portal_integrations (created_by)
  where created_by is not null;

create index if not exists portal_integrations_pipeline_idx
  on public.portal_integrations (default_pipeline_id)
  where default_pipeline_id is not null;

create index if not exists portal_integrations_stage_idx
  on public.portal_integrations (default_stage_id)
  where default_stage_id is not null;

create index if not exists portal_integrations_assignee_idx
  on public.portal_integrations (default_assigned_user_id)
  where default_assigned_user_id is not null;

create index if not exists portal_integrations_round_robin_idx
  on public.portal_integrations (default_round_robin_id)
  where default_round_robin_id is not null;

create index if not exists portal_webhook_events_property_idx
  on public.portal_webhook_events (property_id)
  where property_id is not null;
