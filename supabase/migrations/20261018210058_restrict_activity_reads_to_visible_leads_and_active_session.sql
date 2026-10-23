-- Activity history follows the lead's current read audience, including after
-- transfer. Never use the historical activity author as an ownership grant.
-- Existing permissive policies keep their organization-only activity contract;
-- this restrictive ceiling adds session liveness and visible-parent checks.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
begin
  if pg_catalog.to_regprocedure('private.has_active_lead_read_session()') is null
     or not pg_catalog.has_function_privilege(
       'authenticated', 'private.has_active_lead_read_session()', 'execute'
     )
     or not pg_catalog.has_table_privilege('authenticated', 'public.leads', 'select')
     or not pg_catalog.has_table_privilege('authenticated', 'public.activities', 'select')
     or (select count(*) from pg_catalog.pg_class
         where oid in (pg_catalog.to_regclass('public.activities'),
                       pg_catalog.to_regclass('public.leads'))
           and relkind in ('r', 'p') and relrowsecurity) <> 2
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'activities'
         and policyname = 'vimob_canonical_ad7468a679b0911da5b9a704'
         and cmd = 'SELECT' and permissive = 'PERMISSIVE'
     )
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'leads'
         and policyname = 'leads_select_active_broker_team'
         and cmd = 'SELECT' and permissive = 'PERMISSIVE'
     )
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'leads'
         and policyname = 'leads_select_requires_active_session'
         and cmd = 'SELECT' and permissive = 'RESTRICTIVE'
     )
     or exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'activities'
         and policyname = 'activities_select_requires_visible_lead_and_session'
     )
  then
    raise exception 'activity_read_preflight_failed: expected activity/lead RLS and active-session boundary are unavailable';
  end if;
end;
$preflight$;

create policy activities_select_requires_visible_lead_and_session
on public.activities as restrictive for select to authenticated
using (
  (select private.has_active_lead_read_session())
  and (
    lead_id is null
    or exists (
      -- Invoker SELECT deliberately reuses every current lead RLS ceiling:
      -- membership, individual permissions, active teams and private pool.
      select 1 from public.leads as visible_lead
      where visible_lead.id = activities.lead_id
        and (activities.organization_id is null
             or visible_lead.organization_id = activities.organization_id)
    )
  )
);

-- SELECT also governs rows visible to UPDATE/DELETE RETURNING and Postgres
-- Changes authorization. Existing mutation rules/grants remain unchanged;
-- backend service/database roles retain their existing RLS bypass. Realtime
-- delivery on an already-open channel must be verified independently.
-- Rollback: a separate approved forward migration may DROP only this policy.
-- That rollback reopens out-of-scope/revoked-session activity reads.
commit;
