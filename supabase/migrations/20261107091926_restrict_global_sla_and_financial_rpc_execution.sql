-- These global sweeps intentionally run across organizations for backend jobs.
begin;
set local lock_timeout = '3s';

revoke execute on function
  public.get_sla_pending_leads(),
  public.mark_overdue_financial_entries()
from public, anon, authenticated;

grant execute on function
  public.get_sla_pending_leads(),
  public.mark_overdue_financial_entries()
to service_role;

commit;
