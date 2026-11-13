-- A reply-aware wait can intentionally end on its unconnected outcome.
-- Preserve the original function, privileges and pending-reply race protection.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';

do $migration$
declare
  target regprocedure := 'public.resume_automation_delay(uuid,uuid,text,timestamptz,jsonb,uuid,uuid)'::regprocedure;
  definition text;
  prior_simple constant text := ') = ''default''';
  desired_simple constant text := $simple$) in ('default', case when outgoing_count = 1 then 'no_reply' end)$simple$;
  prior constant text := 'if outgoing_count > 0 and target_node_key is null then';
  desired constant text := $replacement$if outgoing_count > 0 and target_node_key is null and not (
    is_reply_aware and outgoing_count = 1 and exists (
      select 1
      from jsonb_array_elements(coalesce(target_graph->'connections', '[]'::jsonb)) edge
      where edge->>'source' = target_execution.current_node_key
        and nullif(edge->>'target', '') is not null
        and exists (
          select 1 from jsonb_array_elements(coalesce(target_graph->'nodes', '[]'::jsonb)) node
          where node->>'id' = edge->>'target'
        )
        and coalesce(nullif(edge->>'condition_branch', ''), nullif(edge->>'source_handle', '')) =
          case when p_branch = 'replied' then 'no_reply' else 'replied' end
    )
  ) then$replacement$;
begin
  select pg_catalog.pg_get_functiondef(target::oid) into strict definition;
  if pg_catalog.strpos(definition, desired) > 0 and pg_catalog.strpos(definition, desired_simple) > 0 then
    return;
  end if;
  if length(definition) - length(replace(definition, prior, '')) <> length(prior)
    or length(definition) - length(replace(definition, prior_simple, '')) <> length(prior_simple) then
    raise exception 'automation_wait_outcome_contract_drift';
  end if;
  execute replace(replace(definition, prior, desired), prior_simple, desired_simple);
end;
$migration$;

commit;
