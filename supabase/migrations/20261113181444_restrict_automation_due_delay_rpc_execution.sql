-- Only the backend may release due waits and receive their execution rows.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

revoke execute on function public.release_due_automation_delays(integer)
from public, anon, authenticated;

grant execute on function public.release_due_automation_delays(integer)
to service_role;

do $migration$
declare
  target regprocedure := 'public.release_due_automation_delays(integer)'::regprocedure;
begin
  if pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
    or not pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') then
    raise exception 'automation_due_delay_rpc_execute_privileges_unexpected';
  end if;
end;
$migration$;

commit;
