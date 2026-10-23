-- Direct clients have only activity invalidation columns, but user_id and the
-- event's existence can still identify a private Agenda participant. Agenda
-- history is projected by the canonical API; other activity rows stay readable.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid=pg_catalog.to_regclass('public.activities') and relkind='r' and relrowsecurity
  ) or (select count(*) from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role'))<>3
  or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='activities'
      and policyname='vimob_canonical_ad7468a679b0911da5b9a704'
      and permissive='PERMISSIVE' and cmd='SELECT'
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='activities'
      and policyname='activities_select_requires_visible_lead_and_session'
      and permissive='RESTRICTIVE' and cmd='SELECT' and roles=array['authenticated']::name[]
  ) or exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='activities'
      and policyname='activities_select_agenda_requires_canonical_api'
  ) or exists (
    select 1 from pg_catalog.pg_roles browser
    where browser.rolname in ('anon','authenticated')
      and (browser.rolsuper or browser.rolbypassrls or pg_catalog.pg_has_role(browser.oid,
        (select relowner from pg_catalog.pg_class where oid='public.activities'::regclass),'MEMBER'))
  ) or exists (
    select 1 from pg_catalog.pg_attribute column_attribute
    where column_attribute.attrelid='public.activities'::regclass
      and column_attribute.attnum>0 and not column_attribute.attisdropped
      and (pg_catalog.has_column_privilege('authenticated',column_attribute.attrelid,column_attribute.attnum,'SELECT')
           is distinct from (column_attribute.attname=any(array['id','organization_id','lead_id','user_id','type','created_at']))
        or pg_catalog.has_column_privilege('anon',column_attribute.attrelid,column_attribute.attnum,'SELECT')
        or not pg_catalog.has_column_privilege('service_role',column_attribute.attrelid,column_attribute.attnum,'SELECT'))
  ) or pg_catalog.has_table_privilege('authenticated','public.activities','SELECT')
     or pg_catalog.has_table_privilege('anon','public.activities','SELECT')
  or exists (
    select 1 from pg_catalog.pg_roles service
    where service.rolname='service_role' and not service.rolsuper and not service.rolbypassrls
      and not pg_catalog.pg_has_role(service.oid,
        (select relowner from pg_catalog.pg_class where oid='public.activities'::regclass),'USAGE')
      and (pg_catalog.pg_has_role(service.oid,'anon','MEMBER')
        or pg_catalog.pg_has_role(service.oid,'authenticated','MEMBER'))
  )
  then
    raise exception using errcode='55000',message='agenda_activity_browser_read_preflight_failed';
  end if;
end;
$preflight$;

create temporary table pg_temp.agenda_activity_acl_before on commit drop as
select c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity,
  (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('number',a.attnum,'acl',a.attacl::text) order by a.attnum)
   from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as column_acl
from pg_catalog.pg_class c where c.oid='public.activities'::regclass;

create policy activities_select_agenda_requires_canonical_api
on public.activities as restrictive for select to anon,authenticated
using (not (
  pg_catalog.left(pg_catalog.lower(pg_catalog.btrim(coalesce(type,''))),7)='agenda_'
  or pg_catalog.lower(pg_catalog.btrim(coalesce(type,'')))=any(array[
    'visit_scheduled','visit_confirmed','visit_made',
    'meeting_scheduled','meeting_held','meeting_made'
  ])
  -- Presence is sufficient: malformed/null IDs must not reopen the raw journal.
  or coalesce(metadata ? 'schedule_event_id',false)
));

do $postflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname='public' and tablename='activities'
      and policyname='activities_select_agenda_requires_canonical_api'
      and permissive='RESTRICTIVE' and cmd='SELECT'
      and roles @> array['anon','authenticated']::name[] and pg_catalog.cardinality(roles)=2
  ) or not exists (
    select 1 from pg_catalog.pg_class c join pg_temp.agenda_activity_acl_before saved
      on c.relowner=saved.relowner and c.relacl is not distinct from saved.relacl
       and c.relrowsecurity=saved.relrowsecurity and c.relforcerowsecurity=saved.relforcerowsecurity
    where c.oid='public.activities'::regclass and saved.column_acl is not distinct from
      (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('number',a.attnum,'acl',a.attacl::text) order by a.attnum)
       from pg_catalog.pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped)
  ) then
    raise exception using errcode='55000',message='agenda_activity_browser_read_postflight_failed';
  end if;
end;
$postflight$;

-- No grants, writes or existing policies are changed. Backend service/owner
-- reads retain their projection input; no history is deleted or rewritten.
-- A separate approved forward rollback may drop only this policy after an
-- equivalent boundary is installed. That rollback reopens actor/existence reads.
commit;
