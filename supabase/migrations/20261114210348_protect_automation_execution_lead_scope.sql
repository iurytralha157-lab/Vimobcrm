-- Reply and trigger data can include original WhatsApp text. The browser
-- must be allowed to read the current lead before it can read raw execution
-- rows. The Go API continues to expose an operational status projection.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if pg_catalog.to_regprocedure('auth.uid()') is null
     or pg_catalog.to_regprocedure('auth.jwt()') is null
     or pg_catalog.to_regclass('auth.sessions') is null
     or not pg_catalog.has_table_privilege(current_user, 'auth.sessions', 'select')
     or (select count(*) from pg_catalog.pg_attribute
         where attrelid = pg_catalog.to_regclass('auth.sessions')
           and attname in ('id', 'user_id') and not attisdropped
           and atttypid = 'uuid'::regtype) <> 2
     or not pg_catalog.has_table_privilege('authenticated', 'public.leads', 'select')
     or (select count(*) from pg_catalog.pg_class
         where oid in ('public.automation_executions'::regclass, 'public.leads'::regclass)
           and relrowsecurity) <> 2
  then
    raise exception 'automation_execution_scope_preflight_failed';
  end if;
end;
$preflight$;

-- This boundary works on deployments where the equivalent Leads helper is
-- unavailable. The definer only checks the requesting user's Auth session.
create function private.has_active_automation_execution_read_session()
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_user_id uuid;
  raw_session_id text;
  token_claims jsonb;
begin
  actor_user_id := auth.uid();
  token_claims := auth.jwt();
  raw_session_id := nullif(pg_catalog.btrim(token_claims->>'session_id'), '');
  if actor_user_id is null or raw_session_id is null
     or raw_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  if coalesce(pg_catalog.jsonb_typeof(token_claims->'amr'), 'array') <> 'array'
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(
         coalesce(token_claims->'amr', '[]'::jsonb)
       ) as method(value)
       where pg_catalog.jsonb_typeof(method.value) <> 'object'
          or pg_catalog.jsonb_typeof(method.value->'method') is distinct from 'string'
          or pg_catalog.lower(pg_catalog.btrim(method.value->>'method')) = 'recovery'
     )
  then
    return false;
  end if;
  return exists (
    select 1 from auth.sessions as session
    where session.id = raw_session_id::uuid and session.user_id = actor_user_id
  );
exception when others then
  return false;
end;
$function$;
revoke all on function private.has_active_automation_execution_read_session()
  from public, anon, authenticated, service_role;
grant execute on function private.has_active_automation_execution_read_session() to authenticated;

create policy automation_executions_require_visible_lead
on public.automation_executions as restrictive for select to authenticated
using (
  (select private.has_active_automation_execution_read_session())
  and exists (
    -- Run this query as the client so the current Leads RLS rules also
    -- cover ownership, teams, and candidates in private lead pools.
    select 1 from public.leads as visible_lead
    where visible_lead.id = automation_executions.lead_id
      and visible_lead.organization_id = automation_executions.organization_id
  )
);

revoke select on table public.automation_executions from public, anon;

-- service_role keeps its runtime read/write contract. A rollback must keep
-- this read boundary in place for replies already retained in executions.
commit;
