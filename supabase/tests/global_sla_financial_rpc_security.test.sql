begin;

create extension if not exists pgtap with schema extensions;
select plan(6);

select is(
  has_function_privilege(actor.role_name::name, rpc.signature, 'execute'),
  actor.can_execute,
  actor.role_name || ' execute ' || rpc.signature
)
from (values
  ('anon', false),
  ('authenticated', false),
  ('service_role', true)
) as actor(role_name, can_execute)
cross join (values
  ('public.get_sla_pending_leads()'),
  ('public.mark_overdue_financial_entries()')
) as rpc(signature);

select * from finish();
rollback;
