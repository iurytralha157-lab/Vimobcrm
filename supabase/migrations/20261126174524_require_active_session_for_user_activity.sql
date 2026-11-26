begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $preflight$
begin
  if not exists (
       select 1 from pg_catalog.pg_class
       where oid = pg_catalog.to_regclass('public.user_activity_sessions')
         and relrowsecurity
     )
     or pg_catalog.has_table_privilege(
       current_user, pg_catalog.to_regclass('auth.sessions'), 'SELECT'
     ) is not true
     or not exists (
       select 1 from pg_catalog.pg_attribute
       where attrelid = pg_catalog.to_regclass('auth.sessions')
         and attname = 'not_after'
         and atttypid = 'timestamp with time zone'::pg_catalog.regtype
         and not attisdropped
     )
  then
    raise exception 'user_activity_session_preflight_failed: expected RLS and Auth session catalog are unavailable';
  end if;
end;
$preflight$;

-- The definer only checks Auth state for the requesting user. Access to
-- auth.sessions itself stays outside the browser roles.
create function private.has_active_user_activity_auth_session()
returns boolean
language plpgsql stable security definer set search_path = ''
as $function$
declare
  actor_user_id uuid;
  claims jsonb;
  raw_session_id text;
  request_time timestamptz := pg_catalog.statement_timestamp();
begin
  actor_user_id := auth.uid();
  claims := auth.jwt();
  raw_session_id := nullif(pg_catalog.btrim(claims ->> 'session_id'), '');

  if actor_user_id is null or raw_session_id is null
     or raw_session_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or pg_catalog.jsonb_typeof(claims -> 'exp') is distinct from 'number'
  then
    return false;
  end if;

  if (claims ->> 'exp')::numeric <= pg_catalog.date_part('epoch', request_time)
     or coalesce(pg_catalog.jsonb_typeof(claims -> 'amr'), 'array') <> 'array'
     or exists (
       select 1
       from pg_catalog.jsonb_array_elements(coalesce(claims -> 'amr', '[]'::jsonb)) as method(value)
       where pg_catalog.jsonb_typeof(method.value) <> 'object'
          or pg_catalog.jsonb_typeof(method.value -> 'method') is distinct from 'string'
          or pg_catalog.lower(pg_catalog.btrim(method.value ->> 'method')) = 'recovery'
     )
  then
    return false;
  end if;

  return exists (
    select 1 from auth.sessions as auth_session
    where auth_session.id = raw_session_id::uuid
      and auth_session.user_id = actor_user_id
      and (auth_session.not_after is null or auth_session.not_after > request_time)
  );
exception when others then
  return false;
end;
$function$;

revoke all on function private.has_active_user_activity_auth_session()
from public, anon, authenticated, service_role;
grant execute on function private.has_active_user_activity_auth_session() to authenticated;

-- Presence rows represent browser visits. Their session_id is distinct from the
-- authenticated Auth session in the JWT. Keep the existing owner and membership
-- policies and apply the Auth session requirement to the browser role.
create policy user_activity_requires_active_auth_session
on public.user_activity_sessions as restrictive for all to authenticated
using ((select private.has_active_user_activity_auth_session()))
with check ((select private.has_active_user_activity_auth_session()));

commit;
