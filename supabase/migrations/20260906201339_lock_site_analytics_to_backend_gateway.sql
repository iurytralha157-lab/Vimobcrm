-- Raw site analytics are consumed by the tenant-aware Go analytics gateway.
-- Browser access through PostgREST would bypass its module and
-- dashboard_site_view authorization checks, so keep this event stream
-- backend-only.

alter table public.site_analytics_events enable row level security;

do $policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'site_analytics_events'
  loop
    execute format(
      'drop policy if exists %I on public.site_analytics_events',
      policy_row.policyname
    );
  end loop;
end
$policies$;

revoke all privileges on table public.site_analytics_events
  from public, anon, authenticated, service_role;

grant select, insert, update, delete
  on table public.site_analytics_events
  to service_role;

comment on table public.site_analytics_events is
  'Backend-owned raw site analytics event stream; browser access is served by the permission-gated Go API.';
