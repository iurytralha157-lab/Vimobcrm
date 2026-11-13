-- Distribution uses the same bounded, lease-bound deferral and never replays a
-- completed assignment. Retain the existing signature, owner and ACLs.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $migration$
declare
  target regprocedure := 'public.defer_automation_stage_command(uuid,uuid,uuid,text,text)'::regprocedure;
  definition text;
  prior constant text := 'node->>''action_type'' = ''move_lead''';
  desired constant text := 'node->>''action_type'' in (''move_lead'', ''distribute_lead'')';
begin
  select pg_catalog.pg_get_functiondef(target::oid) into strict definition;
  if pg_catalog.strpos(definition, desired) > 0 then
    return;
  end if;
  if length(definition) - length(replace(definition, prior, '')) <> length(prior) then
    raise exception 'automation_distribution_deferral_contract_drift';
  end if;
  execute replace(definition, prior, desired);
end;
$migration$;

commit;
