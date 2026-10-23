-- WhatsApp broadcast authorization remains owner/lead/tenant scoped in its
-- existing permissive policy. Add a session-liveness AND boundary without
-- replacing that function or granting access to auth.sessions.
-- Realtime caches authorization per connection; this protects joins and JWT
-- reauthorization, not immediate eviction of an already authorized socket.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $preflight$
begin
  if pg_catalog.to_regclass('realtime.messages') is null
     or not exists (select 1 from pg_catalog.pg_class
                    where oid = 'realtime.messages'::regclass and relrowsecurity)
     or pg_catalog.to_regprocedure('realtime.topic()') is null
     or not exists (
       select 1 from pg_catalog.pg_proc
       where oid = pg_catalog.to_regprocedure('private.has_active_lead_read_session()')
         and prosecdef and provolatile = 's'
         and pg_catalog.strpos(pg_catalog.pg_get_functiondef(oid), 'auth.sessions') > 0
     )
     or not pg_catalog.has_function_privilege('authenticated',
          'private.has_active_lead_read_session()', 'execute')
     or pg_catalog.has_function_privilege('anon',
          'private.has_active_lead_read_session()', 'execute')
     or not exists (
       select 1 from pg_catalog.pg_policies
       where schemaname = 'realtime' and tablename = 'messages'
         and policyname = 'whatsapp_authorized_private_broadcast'
         and cmd = 'SELECT' and permissive = 'PERMISSIVE'
         and 'authenticated' = any(roles)
         and pg_catalog.strpos(qual, 'can_receive_whatsapp_broadcast') > 0
     )
  then
    raise exception 'whatsapp_active_session_preflight_failed: active-session helper or private broadcast policy is unavailable';
  end if;
end;
$preflight$;

-- Scope both the channel authorization probe and a concrete message row.
-- Other domains on realtime.messages retain their existing policies.
drop policy if exists whatsapp_broadcast_requires_active_session on realtime.messages;
create policy whatsapp_broadcast_requires_active_session
on realtime.messages as restrictive for select to authenticated
using (
  extension <> 'broadcast'
  or (coalesce(topic, '') not like 'whatsapp:%'
      and coalesce((select realtime.topic()), '') not like 'whatsapp:%')
  or (select private.has_active_lead_read_session())
);

-- Rollback, if separately approved: drop only this restrictive policy.
-- That reopens authorization with revoked JWTs until their token expiry.
commit;
