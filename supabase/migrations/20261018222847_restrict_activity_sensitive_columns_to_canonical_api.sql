-- Activity content/metadata can contain private property and commission data.
-- RLS selects rows; the canonical Go API additionally projects those fields
-- against current property scope. Direct clients retain only invalidation
-- identifiers, under the existing lead/session RLS. No history is deleted.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
    select 1 from pg_catalog.pg_class
    where oid = 'public.activities'::regclass and relkind = 'r' and relrowsecurity
  ) or not exists (
    select 1 from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'activities'
      and policyname = 'activities_select_requires_visible_lead_and_session'
      and permissive = 'RESTRICTIVE' and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) or exists (
    select 1 from unnest(array['id','organization_id','lead_id','user_id',
      'type','created_at','content','metadata']) required(column_name)
    where not exists (
      select 1 from pg_catalog.pg_attribute
      where attrelid = 'public.activities'::regclass
        and attname = required.column_name and attnum > 0 and not attisdropped
    )
  ) or not pg_catalog.has_table_privilege('service_role','public.activities','SELECT') then
    raise exception 'activity_projection_preflight_failed';
  end if;
end
$preflight$;

-- Table SELECT overrides column restrictions. Clear both kinds of SELECT ACL,
-- including grants to PUBLIC, before granting this explicit safe projection.
revoke select on table public.activities from public, anon, authenticated;
do $columns$
declare column_list text;
begin
  select string_agg(format('%I',attname),', ' order by attnum) into column_list
  from pg_catalog.pg_attribute
  where attrelid = 'public.activities'::regclass and attnum > 0 and not attisdropped;
  execute format('revoke select (%s) on table public.activities from public, anon, authenticated', column_list);
end
$columns$;
grant select (id,organization_id,lead_id,user_id,type,created_at)
  on public.activities to authenticated;

do $postflight$
begin
  -- Effective privileges also catch inherited grants, ownership and superuser
  -- attributes. Abort the whole transaction instead of leaving a partial fix.
  if pg_catalog.has_table_privilege('authenticated','public.activities','SELECT')
    or pg_catalog.has_table_privilege('anon','public.activities','SELECT')
    or exists (
      select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.activities'::regclass and a.attnum > 0 and not a.attisdropped
        and (
          pg_catalog.has_column_privilege('anon',a.attrelid,a.attnum,'SELECT')
          or pg_catalog.has_column_privilege('authenticated',a.attrelid,a.attnum,'SELECT')
             is distinct from (a.attname = any(array['id','organization_id','lead_id','user_id','type','created_at']))
          or not pg_catalog.has_column_privilege('service_role',a.attrelid,a.attnum,'SELECT')
        )
    ) or exists (
      select 1 from pg_catalog.pg_class c, lateral pg_catalog.aclexplode(c.relacl) acl
      where c.oid = 'public.activities'::regclass and acl.grantee = 0 and acl.privilege_type = 'SELECT'
    ) or exists (
      select 1 from pg_catalog.pg_attribute a, lateral pg_catalog.aclexplode(a.attacl) acl
      where a.attrelid = 'public.activities'::regclass and acl.grantee = 0 and acl.privilege_type = 'SELECT'
    ) then
    raise exception 'activity_projection_postflight_failed';
  end if;
end
$postflight$;

-- Go server/service_role reads and every existing RLS/mutation policy remain
-- intact. Direct SELECT *, row_to_json(activity), content/metadata and sensitive
-- RETURNING now fail; callers must use /v1/activities for the projected history.
-- The repository uses Go/browser invalidation events, not activities Postgres
-- Changes. Safe identifiers/PK stay selectable, but Realtime delivery must be
-- verified separately against the deployed Realtime version before rollout.
-- Forward rollback may restore prior SELECT ACL only after a replacement
-- projection boundary is live: granting table SELECT reopens this disclosure.
commit;
