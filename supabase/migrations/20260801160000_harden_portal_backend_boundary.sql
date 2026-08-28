-- Portal administration and provider ingress are backend API boundaries. The
-- browser must not retain a second authorization path through PostgREST.
alter table public.portal_integrations enable row level security;
alter table public.portal_integrations force row level security;
alter table public.portal_listing_publications enable row level security;
alter table public.portal_listing_publications force row level security;
alter table public.portal_import_reports enable row level security;
alter table public.portal_import_reports force row level security;
alter table public.portal_webhook_events enable row level security;
alter table public.portal_webhook_events force row level security;

-- Remove only policies reachable by browser roles. The existing backend policy
-- on portal_webhook_events may remain; table grants below still define the
-- service role's least-privilege surface.
do $drop_browser_portal_policies$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = any (
        array[
          'portal_integrations',
          'portal_listing_publications',
          'portal_import_reports',
          'portal_webhook_events'
        ]::text[]
      )
      and roles && array['public', 'anon', 'authenticated']::name[]
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      policy_record.policyname,
      policy_record.schemaname,
      policy_record.tablename
    );
  end loop;
end;
$drop_browser_portal_policies$;

revoke all privileges
on table
  public.portal_integrations,
  public.portal_listing_publications,
  public.portal_import_reports,
  public.portal_webhook_events
from public, anon, authenticated, service_role;

-- Normal portal operations select, insert and update these relations. DELETE is
-- also required by the trusted organization-purge workflow, which discovers
-- every tenant-scoped table and removes its rows before deleting the tenant.
grant select, insert, update, delete
on table
  public.portal_integrations,
  public.portal_listing_publications,
  public.portal_import_reports,
  public.portal_webhook_events
to service_role;

-- Canonical Grupo OLX feed reads are scoped by tenant, channel account and
-- desired/observed state. published_version and provider_listing_id complete
-- the feed projection and distinguish this access path from the general state
-- and provider identity indexes.
create index if not exists property_channel_publications_grupo_olx_feed_idx
  on public.property_channel_publications (
    organization_id,
    channel,
    channel_account_key,
    desired_state,
    observed_state,
    published_version,
    provider_listing_id
  )
  where channel = 'grupo_olx'
    and desired_state = 'published';
