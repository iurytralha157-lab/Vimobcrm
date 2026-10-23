-- The Go command owns the complete commercial transition. Older Edge workers
-- must fail explicitly rather than bypass property reservation and history.
-- Rollout/rollback: see docs/runbooks/pipeline-stage-command.md. Do not apply
-- until the API command and updated Edge executor have been prepared together.
set lock_timeout = '5s';

create or replace function private.automation_move_lead_stage(
  p_organization_id uuid, p_lead_id uuid, p_stage_id uuid,
  p_pipeline_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'canonical_lead_command_required';
end;
$function$;
revoke all on function private.automation_move_lead_stage(uuid, uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

-- Only a fenced move node can defer after an unavailable/ambiguous API reply.
-- It keeps its effect key and current node; retry never fabricates success.
create or replace function public.defer_automation_stage_command(
  p_organization_id uuid, p_execution_id uuid, p_step_id uuid,
  p_node_key text, p_lease_token text
) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare
  execution_row public.automation_executions%rowtype;
  retries integer;
  retry_map jsonb;
  next_attempt timestamptz;
begin
  select e.* into execution_row from public.automation_executions e
  join public.automation_flow_versions fv on fv.id = e.flow_version_id
    and fv.organization_id = e.organization_id and fv.requires_review = false
  where e.id = p_execution_id and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key and e.locked_by = p_lease_token
    and e.status = 'running' and e.cancellation_requested_at is null
    and exists (select 1 from public.organization_modules om
      where om.organization_id = e.organization_id
        and lower(trim(om.module_name)) = 'automations' and om.is_enabled = true)
    and exists (select 1 from jsonb_array_elements(fv.graph->'nodes') node
      where node->>'id' = p_node_key and node->>'type' = 'action'
        and node->>'action_type' = 'move_lead')
  for update of e;
  if not found then return jsonb_build_object('ok', false, 'status', 'lease_changed'); end if;
  if jsonb_typeof(coalesce(execution_row.execution_data, '{}'::jsonb)) <> 'object' then
    return jsonb_build_object('ok', false, 'status', 'retry_state_invalid');
  end if;

  perform 1 from public.automation_execution_steps s
  where s.id = p_step_id and s.execution_id = p_execution_id
    and s.organization_id = p_organization_id and s.node_key = p_node_key
    and s.status = 'running' and s.attempt = execution_row.attempt_count
  for update;
  if not found then return jsonb_build_object('ok', false, 'status', 'step_changed'); end if;

  retry_map := coalesce(execution_row.execution_data->'stage_command_retries', '{}'::jsonb);
  if jsonb_typeof(retry_map) <> 'object' then
    return jsonb_build_object('ok', false, 'status', 'retry_state_invalid');
  end if;
  retries := case when retry_map->>p_node_key is null then 0
    when retry_map->>p_node_key ~ '^[0-3]$' then (retry_map->>p_node_key)::integer
    else 3 end;
  if retries >= 3 then
    update public.automation_execution_steps set status = 'failed',
      completed_at = now(), error_message = 'automation_command_retry_exhausted'
      where id = p_step_id;
    update public.automation_executions set status = 'failed', completed_at = now(),
      error_message = 'automation_command_retry_exhausted', locked_at = null,
      locked_by = null, next_execution_at = null, updated_at = now()
      where id = p_execution_id;
    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
  next_attempt := now() + (30 * (1 << retries)) * interval '1 second';
  retry_map := retry_map || jsonb_build_object(p_node_key, retries + 1);
  update public.automation_execution_steps set status = 'failed',
    completed_at = now(), error_message = 'automation_command_deferred'
    where id = p_step_id;
  update public.automation_executions set status = 'queued', locked_at = null,
    locked_by = null, error_message = 'automation_command_deferred',
    next_execution_at = next_attempt, updated_at = now(),
    execution_data = jsonb_set(coalesce(execution_data, '{}'::jsonb),
      '{stage_command_retries}', retry_map, true)
    where id = p_execution_id;
  return jsonb_build_object('ok', true, 'status', 'queued',
    'attempts', retries + 1, 'next_execution_at', next_attempt);
end;
$function$;
revoke all on function public.defer_automation_stage_command(uuid, uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.defer_automation_stage_command(uuid, uuid, uuid, text, text)
  to service_role;

-- Preserve the previous bounded claim/lease contract, adding the deferral clock.
create or replace function public.claim_automation_executions(
  p_worker_id text, p_batch_size integer default 25
) returns setof public.automation_executions
language sql security definer set search_path = '' as $function$
  with exhausted_candidates as (
    select e.id from public.automation_executions e
    where e.flow_version_id is not null and e.status in ('queued', 'running')
      and e.attempt_count >= 25
      and (e.status = 'queued' or e.locked_at < now() - interval '15 minutes')
    order by e.started_at, e.id limit 100 for update skip locked
  ), exhausted as (
    update public.automation_executions e set status = 'failed', completed_at = now(),
      error_message = 'retry_exhausted', locked_at = null, locked_by = null, updated_at = now()
    from exhausted_candidates c where e.id = c.id returning e.id
  ), exhausted_steps as (
    update public.automation_execution_steps s set status = 'failed',
      completed_at = now(), error_message = 'retry_exhausted'
    where s.execution_id in (select id from exhausted) and s.status in ('running', 'waiting')
    returning s.id
  ), candidates as (
    select e.id from public.automation_executions e
    where e.flow_version_id is not null and e.cancellation_requested_at is null
      and e.attempt_count < 25
      and exists (select 1 from public.organization_modules om
        where om.organization_id = e.organization_id
          and lower(trim(om.module_name)) = 'automations' and om.is_enabled = true)
      and ((e.status = 'queued' and (e.next_execution_at is null or e.next_execution_at <= now()))
        or (e.status = 'running' and e.locked_at < now() - interval '15 minutes'))
    order by e.started_at, e.id
    limit least(greatest(coalesce(p_batch_size, 25), 1), 100) for update skip locked
  ), claimed as (
    update public.automation_executions e set status = 'running',
      attempt_count = e.attempt_count + 1, locked_at = now(),
      locked_by = left(coalesce(p_worker_id, 'worker'), 200), error_message = null,
      next_execution_at = null, updated_at = now()
    from candidates c where e.id = c.id returning e.*
  ) select * from claimed;
$function$;
revoke all on function public.claim_automation_executions(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_automation_executions(text, integer) to service_role;

-- The direct starter uses the same database clock as the batch claim. An Edge
-- clock ahead of PostgreSQL must not bypass a deferred command's backoff.
create or replace function public.claim_specific_automation_execution(
  p_organization_id uuid, p_execution_id uuid, p_worker_id text
) returns setof public.automation_executions
language sql security definer set search_path = '' as $function$
  update public.automation_executions e set status = 'running',
    attempt_count = e.attempt_count + 1, locked_at = now(),
    locked_by = p_worker_id, error_message = null, next_execution_at = null,
    updated_at = now()
  where e.id = p_execution_id and e.organization_id = p_organization_id
    and e.flow_version_id is not null and e.status = 'queued'
    and e.cancellation_requested_at is null and e.attempt_count < 25
    and (e.next_execution_at is null or e.next_execution_at <= now())
    and length(btrim(coalesce(p_worker_id, ''))) between 1 and 200
    and exists (select 1 from public.organization_modules om
      where om.organization_id = e.organization_id
        and lower(trim(om.module_name)) = 'automations' and om.is_enabled = true)
  returning e.*;
$function$;
revoke all on function public.claim_specific_automation_execution(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.claim_specific_automation_execution(uuid, uuid, text)
  to service_role;
reset lock_timeout;
