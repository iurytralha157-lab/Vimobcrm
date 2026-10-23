-- Close revoked-JWT reads of leads and their attachment metadata through the
-- Data API, including Pipeline's direct reads. Keep organization/owner/team
-- authorization in the existing permissive policies; this is an AND boundary.
-- Service/admin database roles retain PostgreSQL's existing RLS bypass. App
-- owner/admin users still use authenticated and must have a live Auth session.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

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
     or not exists (
       select 1 from pg_catalog.pg_class
       where oid = pg_catalog.to_regclass('public.leads') and relrowsecurity
     )
     or not exists (
       select 1 from pg_catalog.pg_class
       where oid = pg_catalog.to_regclass('public.lead_attachments') and relrowsecurity
     )
     or pg_catalog.strpos(coalesce(pg_catalog.pg_get_functiondef(
       pg_catalog.to_regprocedure('private.can_read_lead(uuid,uuid,uuid)')::oid
     ), ''), 'denied_own_permission') = 0
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'leads'
         and policyname = 'leads_select_active_broker_team' and cmd = 'SELECT'
         and permissive = 'PERMISSIVE'
     )
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'public' and tablename = 'lead_attachments'
         and policyname = 'Users can view accessible lead attachments' and cmd = 'SELECT'
         and permissive = 'PERMISSIVE'
     )
     or pg_catalog.to_regprocedure('private.has_active_lead_read_session()') is not null
  then
    raise exception 'lead_session_read_preflight_failed: expected Auth tables, read policies, privileges or helper name are unavailable';
  end if;
end;
$preflight$;

-- A definer is necessary only to read auth.sessions without granting that
-- sensitive table to browser roles. No role/user_metadata claim grants access.
create function private.has_active_lead_read_session()
returns boolean language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_user_id uuid;
  actor_session_id uuid;
  raw_session_id text;
  token_claims jsonb;
begin
  actor_user_id := auth.uid();
  token_claims := auth.jwt();
  raw_session_id := nullif(pg_catalog.btrim(token_claims ->> 'session_id'), '');
  if actor_user_id is null or raw_session_id is null
     or raw_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  -- The Go/browser boundary isolates password-recovery sessions from CRM
  -- reads. A live session alone must not reopen that route through the API.
  if coalesce(pg_catalog.jsonb_typeof(token_claims -> 'amr'), 'array') <> 'array'
     or exists (
       select 1 from pg_catalog.jsonb_array_elements(
         coalesce(token_claims -> 'amr', '[]'::jsonb)
       ) as method(value)
       where pg_catalog.jsonb_typeof(method.value) <> 'object'
          or pg_catalog.jsonb_typeof(method.value -> 'method') is distinct from 'string'
          or pg_catalog.lower(pg_catalog.btrim(method.value ->> 'method')) = 'recovery'
     )
  then
    return false;
  end if;
  actor_session_id := raw_session_id::uuid;
  return exists (
    select 1 from auth.sessions as session
    where session.id = actor_session_id and session.user_id = actor_user_id
  );
exception when others then
  return false;
end;
$function$;
revoke all on function private.has_active_lead_read_session()
  from public, anon, authenticated, service_role;
grant execute on function private.has_active_lead_read_session() to authenticated;

create policy leads_select_requires_active_session
on public.leads as restrictive for select to authenticated
using ((select private.has_active_lead_read_session()));

create policy lead_attachments_select_requires_active_session
on public.lead_attachments as restrictive for select to authenticated
using ((select private.has_active_lead_read_session()));

-- Deliberate rollback (separate, approved forward migration, never CASCADE):
-- drop policy leads_select_requires_active_session on public.leads;
-- drop policy lead_attachments_select_requires_active_session on public.lead_attachments;
-- drop function private.has_active_lead_read_session();
-- That rollback reopens the prior revoked-JWT read window until token expiry.
commit;
