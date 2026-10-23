-- Canonical API/domain producers own the activity journal. Browser table writes
-- can otherwise impersonate reserved history types and poison its projection.
-- Only mutation ACL changes here: existing SELECT projection, RLS, owner and
-- service_role/internal SECURITY DEFINER producers remain unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.activities'::regclass and relkind = 'r' and relrowsecurity
  ) or (select count(*) from pg_catalog.pg_roles
        where rolname in ('anon', 'authenticated', 'service_role')) <> 3
    or not pg_catalog.has_table_privilege('service_role', 'public.activities', 'INSERT')
    or exists (
      select 1 from unnest(array['id','organization_id','lead_id','user_id',
        'type','content','metadata','created_at']) required(column_name)
      where not exists (
        select 1 from pg_catalog.pg_attribute
        where attrelid = 'public.activities'::regclass
          and attname = required.column_name and attnum > 0 and not attisdropped
      )
    ) then
    raise exception 'activity_write_preflight_failed';
  end if;
end
$preflight$;

-- Preserve effective internal producer access and the existing browser SELECT
-- projection exactly, including inherited/column grants. If service_role only
-- relied on a PUBLIC grant being revoked below, the postflight must abort.
create temporary table activity_write_acl_before on commit drop as
select 'service_role'::text as role_name, null::smallint as attribute_number,
  acl.privilege_type, pg_catalog.has_table_privilege('service_role', c.oid, acl.privilege_type) as allowed
from pg_catalog.pg_class c,
  lateral pg_catalog.aclexplode(pg_catalog.acldefault('r', c.relowner)) acl
where c.oid = 'public.activities'::regclass
union all
select 'service_role', a.attnum, privilege.name,
  pg_catalog.has_column_privilege('service_role', a.attrelid, a.attnum, privilege.name)
from pg_catalog.pg_attribute a
cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege(name)
where a.attrelid = 'public.activities'::regclass and a.attnum > 0 and not a.attisdropped
union all
select browser.role_name, null::smallint, 'SELECT',
  pg_catalog.has_table_privilege(browser.role_name, 'public.activities', 'SELECT')
from unnest(array['anon','authenticated']) browser(role_name)
union all
select browser.role_name, a.attnum, 'SELECT',
  pg_catalog.has_column_privilege(browser.role_name, a.attrelid, a.attnum, 'SELECT')
from pg_catalog.pg_attribute a
cross join unnest(array['anon','authenticated']) browser(role_name)
where a.attrelid = 'public.activities'::regclass and a.attnum > 0 and not a.attisdropped;

revoke insert, update, delete, truncate, references, trigger
  on table public.activities from public, anon, authenticated;

-- Table revocation does not remove independent per-column grants, including
-- grants to PUBLIC. Cover every current live column without changing SELECT.
do $columns$
declare column_list text;
begin
  select string_agg(format('%I', attname), ', ' order by attnum) into column_list
  from pg_catalog.pg_attribute
  where attrelid = 'public.activities'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke insert (%1$s), update (%1$s), references (%1$s) on table public.activities from public, anon, authenticated', column_list);
end
$columns$;

do $postflight$
begin
  if exists (
    select 1 from pg_temp.activity_write_acl_before saved
    where saved.allowed is distinct from case
      when saved.attribute_number is null then pg_catalog.has_table_privilege(
        saved.role_name, 'public.activities', saved.privilege_type)
      else pg_catalog.has_column_privilege(saved.role_name, 'public.activities',
        saved.attribute_number, saved.privilege_type)
    end
  ) then
    raise exception 'activity_producer_or_projection_acl_changed';
  end if;
  -- Effective checks catch inherited grants, browser ownership and superuser
  -- configuration. Abort atomically rather than silently leaving a write path.
  if exists (
    select 1 from unnest(array['anon','authenticated']) browser(role_name)
    where pg_catalog.has_table_privilege(browser.role_name, 'public.activities',
            'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
       or pg_catalog.has_any_column_privilege(browser.role_name, 'public.activities',
            'INSERT, UPDATE, REFERENCES')
       or pg_catalog.pg_has_role(browser.role_name,
            (select relowner from pg_catalog.pg_class where oid = 'public.activities'::regclass), 'MEMBER')
  ) or exists (
    select 1 from pg_catalog.pg_class c, lateral pg_catalog.aclexplode(c.relacl) acl
    where c.oid = 'public.activities'::regclass and acl.grantee = 0
      and acl.privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
  ) or exists (
    select 1 from pg_catalog.pg_attribute a, lateral pg_catalog.aclexplode(a.attacl) acl
    where a.attrelid = 'public.activities'::regclass and a.attnum > 0 and not a.attisdropped
      and acl.grantee = 0 and acl.privilege_type in ('INSERT','UPDATE','REFERENCES')
  ) then
    raise exception 'activity_write_postflight_failed';
  end if;
end
$postflight$;

-- No rows, policies, SELECT grants or producer functions are changed. Direct
-- Data API mutations now fail by ACL even when a mutation RLS policy permits.
-- A rollback must be a separately reviewed forward migration restoring only
-- explicitly required ACL from a captured pre-change catalog. Blanket browser
-- write grants would reopen the reserved-event impersonation boundary.
commit;
