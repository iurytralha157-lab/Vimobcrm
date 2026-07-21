set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function private.automation_assign_lead_user(
  p_organization_id uuid,
  p_lead_id uuid,
  p_user_id uuid,
  p_actor_user_id uuid,
  p_execution_id uuid,
  p_node_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_user_id uuid;
  lead_team_id uuid;
  lead_name text;
  target_user_name text;
begin
  if p_user_id is null then
    raise exception 'automation_assignee_required';
  end if;

  select l.assigned_user_id, l.team_id, coalesce(nullif(l.name, ''), 'Lead')
  into previous_user_id, lead_team_id, lead_name
  from public.leads l
  where l.organization_id = p_organization_id and l.id = p_lead_id
  for update;
  if not found then
    raise exception 'automation_target_lead_not_found';
  end if;

  select coalesce(nullif(u.name, ''), nullif(u.email, ''), 'Usuario')
  into target_user_name
  from public.organization_members om
  join public.users u on u.id = om.user_id and coalesce(u.is_active, true) = true
  where om.organization_id = p_organization_id
    and om.user_id = p_user_id
    and coalesce(om.is_active, true) = true;
  if target_user_name is null then
    raise exception 'automation_assignee_not_active_in_organization';
  end if;

  if lead_team_id is not null and not exists (
    select 1 from public.team_members tm
    where tm.organization_id = p_organization_id
      and tm.team_id = lead_team_id
      and tm.user_id = p_user_id
      and coalesce(tm.is_active, true) = true
  ) then
    raise exception 'automation_assignee_not_in_lead_team';
  end if;

  if previous_user_id is distinct from p_user_id then
    update public.leads
    set assigned_user_id = p_user_id,
        assigned_at = now(),
        updated_at = now()
    where organization_id = p_organization_id and id = p_lead_id;

    insert into public.assignments_log (
      organization_id, lead_id, old_user_id, new_user_id, reason, created_by
    ) values (
      p_organization_id, p_lead_id, previous_user_id, p_user_id,
      'automation_assignment', p_actor_user_id
    );

    perform private.notify_automation_attention(
      p_organization_id,
      p_lead_id,
      p_user_id,
      'Lead atribuido para voce',
      lead_name || ' foi atribuido por uma automacao.',
      'automation_lead_assigned',
      'automation-assignment:' || p_execution_id::text || ':' || p_node_key,
      jsonb_build_object(
        'execution_id', p_execution_id,
        'node_key', p_node_key,
        'previous_user_id', previous_user_id,
        'assigned_user_id', p_user_id
      )
    );
  end if;

  return jsonb_build_object(
    'assignment_changed', previous_user_id is distinct from p_user_id,
    'previous_user_id', previous_user_id,
    'assigned_user_id', p_user_id,
    'assigned_user_name', target_user_name
  );
end;
$$;

create or replace function public.apply_automation_internal_effect(
  p_organization_id uuid,
  p_execution_id uuid,
  p_node_key text,
  p_lease_token text,
  p_effect_key text,
  p_effect_type text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  effect_id uuid;
  target_lead_id uuid;
  target_status text;
  target_uuid uuid;
  target_pipeline_id uuid;
  actor_user_id uuid;
  old_lead jsonb;
  new_lead jsonb;
  effect_response jsonb := '{}'::jsonb;
begin
  select e.lead_id, fv.created_by, to_jsonb(l)
  into target_lead_id, actor_user_id, old_lead
  from public.automation_executions e
  join public.automation_flow_versions fv on fv.id = e.flow_version_id
  join public.leads l on l.id = e.lead_id and l.organization_id = e.organization_id
  join public.organization_modules om
    on om.organization_id = e.organization_id
   and lower(trim(om.module_name)) = 'automations'
   and coalesce(om.is_enabled, false) = true
  where e.id = p_execution_id
    and e.organization_id = p_organization_id
    and e.current_node_key = p_node_key
    and e.locked_by = p_lease_token
    and e.status = 'running'
    and e.cancellation_requested_at is null
  for update of e, l;

  if target_lead_id is null then
    return jsonb_build_object('ok', false, 'status', 'execution_not_running');
  end if;

  perform pg_catalog.set_config('vimob.automation_execution_id', p_execution_id::text, true);

  insert into public.automation_effect_dispatches (
    organization_id, execution_id, node_key, effect_key, effect_type, status, request
  ) values (
    p_organization_id, p_execution_id, p_node_key, p_effect_key, p_effect_type,
    'sending', coalesce(p_payload, '{}'::jsonb)
  ) on conflict (effect_key) do nothing
  returning id into effect_id;

  if effect_id is null then
    select status, response into target_status, effect_response
    from public.automation_effect_dispatches where effect_key = p_effect_key;
    return jsonb_build_object(
      'ok', target_status = 'succeeded',
      'status', coalesce(target_status, 'missing'),
      'response', coalesce(effect_response, '{}'::jsonb)
    );
  end if;

  begin
    case p_effect_type
      when 'add_tag' then
        target_uuid := nullif(p_payload->>'tag_id', '')::uuid;
        if not exists (
          select 1 from public.tags t
          where t.id = target_uuid and t.organization_id = p_organization_id
        ) then
          raise exception 'Tag does not belong to the organization.';
        end if;
        insert into public.lead_tags(organization_id, lead_id, tag_id)
        values (p_organization_id, target_lead_id, target_uuid)
        on conflict (lead_id, tag_id) do nothing;
      when 'remove_tag' then
        target_uuid := nullif(p_payload->>'tag_id', '')::uuid;
        delete from public.lead_tags
        where organization_id = p_organization_id
          and lead_id = target_lead_id
          and tag_id = target_uuid;
      when 'move_lead' then
        target_uuid := nullif(p_payload->>'stage_id', '')::uuid;
        target_pipeline_id := nullif(p_payload->>'pipeline_id', '')::uuid;
        effect_response := private.automation_move_lead_stage(
          p_organization_id, target_lead_id, target_uuid, target_pipeline_id
        );
      when 'assign_user' then
        target_uuid := nullif(p_payload->>'user_id', '')::uuid;
        effect_response := private.automation_assign_lead_user(
          p_organization_id, target_lead_id, target_uuid, actor_user_id,
          p_execution_id, p_node_key
        );
      when 'property_interest' then
        raise exception 'property_interest_requires_canonical_lead_command_service';
      when 'deal_status' then
        raise exception 'deal_status_requires_canonical_lead_service';
      else
        raise exception 'Unsupported internal automation effect.';
    end case;

    select to_jsonb(l) into new_lead
    from public.leads l
    where l.id = target_lead_id and l.organization_id = p_organization_id;

    insert into public.audit_logs (
      organization_id, user_id, action, entity_type, entity_id, old_data, new_data
    ) values (
      p_organization_id, actor_user_id, 'automation_' || p_effect_type,
      'lead', target_lead_id::text,
      jsonb_build_object(
        'stage_id', old_lead->'stage_id', 'pipeline_id', old_lead->'pipeline_id',
        'assigned_user_id', old_lead->'assigned_user_id',
        'interest_property_id', old_lead->'interest_property_id', 'deal_status', old_lead->'deal_status'
      ),
      jsonb_build_object(
        'stage_id', new_lead->'stage_id', 'pipeline_id', new_lead->'pipeline_id',
        'assigned_user_id', new_lead->'assigned_user_id',
        'interest_property_id', new_lead->'interest_property_id', 'deal_status', new_lead->'deal_status',
        'origin', 'automation', 'execution_id', p_execution_id,
        'node_key', p_node_key, 'effect_key', p_effect_key
      )
    );

    insert into public.activities (
      organization_id, lead_id, user_id, type, content, metadata
    ) values (
      p_organization_id, target_lead_id, actor_user_id,
      'automation_' || p_effect_type,
      'Acao executada pela automacao: ' || p_effect_type,
      jsonb_build_object(
        'origin', 'automation', 'execution_id', p_execution_id,
        'node_key', p_node_key, 'effect_key', p_effect_key
      ) || coalesce(effect_response, '{}'::jsonb)
    );

    update public.automation_effect_dispatches
    set status = 'succeeded', response = coalesce(effect_response, '{}'::jsonb), completed_at = now()
    where id = effect_id;

    return jsonb_build_object(
      'ok', true, 'status', 'succeeded', 'effect_id', effect_id,
      'response', coalesce(effect_response, '{}'::jsonb)
    );
  exception when others then
    update public.automation_effect_dispatches
    set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 4000)
    where id = effect_id;
    return jsonb_build_object(
      'ok', false, 'status', 'failed', 'error', sqlerrm, 'effect_id', effect_id
    );
  end;
end;
$$;

revoke execute on function private.automation_assign_lead_user(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb)
  to service_role;
