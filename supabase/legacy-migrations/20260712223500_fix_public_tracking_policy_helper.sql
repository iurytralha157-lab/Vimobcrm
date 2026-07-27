begin;

set local lock_timeout = '2s';
set local statement_timeout = '30s';

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
    execute 'drop policy if exists "Public sites can insert validated lead events" on public.lead_events';
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
  end if;
end
$do$;

commit;
