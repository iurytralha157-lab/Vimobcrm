-- Only the backend may resume a wait from a trusted inbound event or timeout.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

revoke execute on function public.resume_automation_delay(uuid, uuid, text, timestamptz, jsonb, uuid, uuid)
from public, anon, authenticated;

grant execute on function public.resume_automation_delay(uuid, uuid, text, timestamptz, jsonb, uuid, uuid)
to service_role;

do $migration$
declare
  target regprocedure := 'public.resume_automation_delay(uuid,uuid,text,timestamptz,jsonb,uuid,uuid)'::regprocedure;
begin
  if pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') then
    raise exception 'automation_wait_resume_rpc_execute_privileges_unexpected';
  end if;
end;
$migration$;

commit;
