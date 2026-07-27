begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

-- New objects must be explicitly exposed to the Data API.
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;

-- Anonymous tracking needs a policy helper that can verify the public site
-- without evaluating authenticated-only policies on organization_sites.
create or replace function private.can_track_public_site(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select target_organization_id is not null
    and exists (
      select 1
      from public.organization_sites site
      join public.organizations organization
        on organization.id = site.organization_id
      where site.organization_id = target_organization_id
        and site.is_active = true
        and coalesce(organization.is_active, true) = true
    );
$function$;

revoke all on function private.can_track_public_site(uuid) from public;
grant usage on schema private to anon;
grant execute on function private.can_track_public_site(uuid) to anon, authenticated, service_role;

-- Fresh databases use the canonical attachment shape and already have scoped
-- policies. Only repair the legacy production shape that has no tenant column.
do $do$
begin
  if to_regclass('public.lead_attachments') is not null
     and not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'lead_attachments'
         and column_name = 'organization_id'
     ) then
    execute 'drop policy if exists "Users can insert attachments" on public.lead_attachments';
    execute 'drop policy if exists "Users can view attachments of their leads" on public.lead_attachments';
    execute 'drop policy if exists "Users can view accessible lead attachments" on public.lead_attachments';
    execute 'revoke all privileges on table public.lead_attachments from anon, authenticated';
    execute 'grant select on table public.lead_attachments to authenticated';
    execute $policy$
      create policy "Users can view accessible lead attachments"
      on public.lead_attachments
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.leads lead
          where lead.id = lead_attachments.lead_id
            and private.can_access_lead(lead.organization_id, lead.assigned_user_id)
        )
      )
    $policy$;
  end if;
end
$do$;

-- Production still has the legacy analytics shape for lead_events, while fresh
-- databases use lead_events as a lead-owned history table. Repair only the
-- analytics shape and leave the canonical history policies untouched.
do $do$
begin
  if to_regclass('public.lead_events') is not null
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'lead_events'
         and column_name = 'page_path'
     ) then
    execute 'drop policy if exists "Anyone can insert lead events" on public.lead_events';
    execute 'drop policy if exists "Authenticated users can read lead events" on public.lead_events';
    execute 'drop policy if exists "select_authenticated" on public.lead_events';
    execute 'drop policy if exists "Public sites can insert validated lead events" on public.lead_events';
    execute 'drop policy if exists "Organization members can read lead events" on public.lead_events';
    execute 'revoke all privileges on table public.lead_events from anon, authenticated';
    execute 'grant insert on table public.lead_events to anon, authenticated';
    execute 'grant select on table public.lead_events to authenticated';
    execute $policy$
      create policy "Public sites can insert validated lead events"
      on public.lead_events
      for insert
      to anon, authenticated
      with check (
        organization_id is not null
        and event_type in ('pageview', 'favorite', 'form_submit', 'whatsapp_click', 'cta_click')
        and length(coalesce(page_path, '')) between 1 and 2048
        and length(coalesce(page_title, '')) <= 500
        and length(coalesce(referrer, '')) <= 2048
        and length(coalesce(session_id, '')) <= 200
        and length(coalesce(utm_source, '')) <= 500
        and length(coalesce(utm_medium, '')) <= 500
        and length(coalesce(utm_campaign, '')) <= 500
        and pg_column_size(coalesce(metadata, '{}'::jsonb)) <= 32768
        and coalesce(screen_width, 0) between 0 and 100000
        and coalesce(screen_height, 0) between 0 and 100000
        and private.can_track_public_site(organization_id)
      )
    $policy$;
    execute $policy$
      create policy "Organization members can read lead events"
      on public.lead_events
      for select
      to authenticated
      using (private.is_org_member(organization_id))
    $policy$;
  end if;
end
$do$;

-- Public onboarding goes through the rate-limited server endpoint. Keep the
-- existing authenticated own-row policies, but remove anonymous table access.
drop policy if exists "Anon can submit onboarding requests" on public.onboarding_requests;
drop policy if exists "Anon can view own onboarding request" on public.onboarding_requests;

revoke all privileges on table public.onboarding_requests from anon, authenticated;
grant select, insert, update on table public.onboarding_requests to authenticated;

-- The legacy production policy accepts every anonymous payload. Fresh databases
-- already validate public inserts against an active site, so leave those intact.
do $do$
begin
  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
      and policyname = 'Allow anonymous inserts for tracking'
  ) then
    execute 'drop policy if exists "Allow anonymous inserts for tracking" on public.site_analytics_events';
    execute 'drop policy if exists "Users can view own org analytics" on public.site_analytics_events';
    execute 'drop policy if exists "Organization members can read site analytics" on public.site_analytics_events';
    execute 'revoke all privileges on table public.site_analytics_events from anon, authenticated';
    execute 'grant select on table public.site_analytics_events to authenticated';
    execute $policy$
      create policy "Organization members can read site analytics"
      on public.site_analytics_events
      for select
      to authenticated
      using (private.is_org_member(organization_id))
    $policy$;
  end if;
end
$do$;

commit;
