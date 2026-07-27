set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A reply-aware wait is the single coordination point for conversational
-- automations. The database classifies the inbound message and either resumes
-- the replied branch or hands the lead back to a person atomically.
create or replace function private.notify_automation_attention(
  p_organization_id uuid,
  p_lead_id uuid,
  p_user_id uuid,
  p_title text,
  p_content text,
  p_event_key text,
  p_dedupe_key text,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or nullif(trim(coalesce(p_dedupe_key, '')), '') is null then
    return;
  end if;

  insert into public.notifications (
    organization_id, user_id, title, content, body, type, channel,
    lead_id, target_url, is_read, metadata
  ) values (
    p_organization_id,
    p_user_id,
    left(coalesce(nullif(trim(p_title), ''), 'Automacao requer atencao'), 200),
    left(coalesce(p_content, ''), 2000),
    left(coalesce(p_content, ''), 2000),
    'lead',
    'in_app',
    p_lead_id,
    '/crm/conversas?lead=' || p_lead_id::text,
    false,
    jsonb_build_object(
      'event_key', p_event_key,
      'dedupe_key', p_dedupe_key,
      'whatsapp_dispatch_required', false,
      'dispatch', jsonb_build_object(
        'whatsapp', jsonb_build_object('required', false, 'status', 'skipped'),
        'push', jsonb_build_object('required', true, 'status', 'pending')
      )
    ) || coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict do nothing;
end;
$$;

create or replace function private.cancel_lead_automation_executions(
  p_organization_id uuid,
  p_lead_id uuid,
  p_reason text,
  p_conversation_id uuid default null
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_ids uuid[] := array[]::uuid[];
begin
  with cancelled as (
    update public.automation_executions e
    set status = 'cancelled',
        cancellation_requested_at = now(),
        completed_at = now(),
        error_message = left(coalesce(nullif(p_reason, ''), 'automation_handoff'), 4000),
        next_execution_at = null,
        locked_at = null,
        locked_by = null,
        updated_at = now()
    where e.organization_id = p_organization_id
      and e.lead_id = p_lead_id
      and e.status in ('queued', 'running', 'waiting')
      and (
        p_conversation_id is null
        or e.conversation_id is null
        or e.conversation_id = p_conversation_id
      )
    returning e.id
  ), closed_steps as (
    update public.automation_execution_steps s
    set status = 'cancelled',
        completed_at = now(),
        error_message = left(coalesce(nullif(p_reason, ''), 'automation_handoff'), 4000)
    where s.organization_id = p_organization_id
      and s.execution_id in (select id from cancelled)
      and s.status in ('running', 'waiting')
    returning s.id
  )
  select coalesce(array_agg(c.id), array[]::uuid[])
  into cancelled_ids
  from cancelled c;

  return cancelled_ids;
end;
$$;

create or replace function private.capture_automation_inbound_message_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.from_me, false) = false
     and new.direction = 'inbound'
     and new.lead_id is not null then
    perform private.enqueue_automation_event(
      new.organization_id, 'message_received', 'whatsapp_message', new.id,
      new.lead_id, new.conversation_id,
      'message_received:' || new.id::text,
      jsonb_build_object(
        'message_id', new.id,
        'lead_id', new.lead_id,
        'conversation_id', new.conversation_id,
        'session_id', new.session_id,
        'message_type', coalesce(nullif(new.message_type, ''), 'text'),
        'content', new.content,
        'occurred_at', coalesce(new.received_at, new.created_at, now())
      )
    );
  end if;
  return new;
exception when others then
  raise warning 'automation message event enqueue failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_automation_inbound_message on public.whatsapp_messages;
create trigger zz_automation_inbound_message
after insert on public.whatsapp_messages
for each row execute function private.capture_automation_inbound_message_event();

create or replace function public.process_automation_inbound_message(
  p_organization_id uuid,
  p_lead_id uuid,
  p_conversation_id uuid,
  p_message_id uuid,
  p_message_type text,
  p_content text,
  p_occurred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  candidate record;
  wait_step record;
  normalized_type text := lower(trim(coalesce(p_message_type, 'text')));
  normalized_content text := lower(trim(coalesce(p_content, '')));
  expected_keywords jsonb;
  keyword text;
  keyword_matched boolean;
  handoff_reason text;
  burst_limit integer;
  recent_message_count integer;
  resume_result jsonb;
  resumed_ids uuid[] := array[]::uuid[];
  cancelled_ids uuid[] := array[]::uuid[];
  target_user_id uuid;
  target_lead_name text;
  preview text;
begin
  if p_organization_id is null or p_lead_id is null or p_message_id is null or p_occurred_at is null then
    return jsonb_build_object('ok', false, 'status', 'invalid_input');
  end if;

  preview := left(coalesce(nullif(trim(p_content), ''), '[' || normalized_type || ']'), 300);

  for candidate in
    select
      e.id,
      e.conversation_id,
      e.current_node_key,
      e.next_execution_at,
      fv.created_by,
      coalesce((
        select node->'config'
        from jsonb_array_elements(coalesce(fv.graph->'nodes', '[]'::jsonb)) node
        where node->>'id' = e.current_node_key and node->>'type' = 'delay'
        limit 1
      ), '{}'::jsonb) as wait_config,
      l.assigned_user_id,
      l.name as lead_name
    from public.automation_executions e
    join public.automation_flow_versions fv
      on fv.id = e.flow_version_id
     and fv.organization_id = e.organization_id
     and fv.requires_review = false
    join public.leads l
      on l.id = e.lead_id and l.organization_id = e.organization_id
    where e.organization_id = p_organization_id
      and e.lead_id = p_lead_id
      and e.status = 'waiting'
      and e.cancellation_requested_at is null
      and (e.conversation_id is null or p_conversation_id is null or e.conversation_id = p_conversation_id)
    order by e.started_at, e.id
  loop
    if not coalesce((candidate.wait_config->>'stop_on_reply')::boolean, false) then
      continue;
    end if;

    select s.id, s.started_at
    into wait_step
    from public.automation_execution_steps s
    where s.organization_id = p_organization_id
      and s.execution_id = candidate.id
      and s.node_key = candidate.current_node_key
      and s.status = 'waiting'
    order by s.attempt desc, s.started_at desc
    limit 1;

    if wait_step.id is null
       or p_occurred_at < wait_step.started_at
       or candidate.next_execution_at is null
       or p_occurred_at > candidate.next_execution_at then
      continue;
    end if;

    handoff_reason := null;
    burst_limit := greatest(coalesce(nullif(candidate.wait_config->>'handoff_after_message_burst', '')::integer, 3), 0);

    if normalized_type not in ('text', 'conversation', 'extendedtextmessage')
       and coalesce((candidate.wait_config->>'handoff_on_non_text')::boolean, true) then
      handoff_reason := 'automation_handoff_non_text:' || normalized_type;
    end if;

    if handoff_reason is null and burst_limit > 0 then
      select count(*)
      into recent_message_count
      from public.whatsapp_messages m
      where m.organization_id = p_organization_id
        and m.lead_id = p_lead_id
        and coalesce(m.from_me, false) = false
        and m.direction = 'inbound'
        and coalesce(m.received_at, m.created_at) >= p_occurred_at - interval '2 minutes'
        and coalesce(m.received_at, m.created_at) <= p_occurred_at + interval '2 minutes';
      if recent_message_count >= burst_limit then
        handoff_reason := 'automation_handoff_message_burst';
      end if;
    end if;

    if handoff_reason is null
       and normalized_type in ('text', 'conversation', 'extendedtextmessage')
       and lower(coalesce(candidate.wait_config->>'reply_match_mode', 'any_text')) = 'keywords' then
      expected_keywords := coalesce(candidate.wait_config->'expected_reply_keywords', '[]'::jsonb);
      keyword_matched := false;
      if jsonb_typeof(expected_keywords) = 'array' then
        for keyword in select lower(trim(value)) from jsonb_array_elements_text(expected_keywords)
        loop
          if keyword <> '' and position(keyword in normalized_content) > 0 then
            keyword_matched := true;
            exit;
          end if;
        end loop;
      end if;
      if not keyword_matched
         and coalesce((candidate.wait_config->>'handoff_on_unmatched_reply')::boolean, true) then
        handoff_reason := 'automation_handoff_unmatched_reply';
      end if;
    end if;

    target_user_id := coalesce(candidate.assigned_user_id, candidate.created_by);
    target_lead_name := coalesce(nullif(candidate.lead_name, ''), 'Lead');

    if handoff_reason is not null then
      if (select count(*) from unnest(private.cancel_lead_automation_executions(
        p_organization_id, p_lead_id, handoff_reason, p_conversation_id
      ))) > 0 then
        cancelled_ids := array_append(cancelled_ids, candidate.id);
        perform private.notify_automation_attention(
          p_organization_id,
          p_lead_id,
          target_user_id,
          'Automacao pausada: atendimento humano necessario',
          target_lead_name || ' enviou uma resposta fora do fluxo (' || preview || ').',
          'automation_handoff',
          'automation_handoff:' || p_message_id::text || ':' || target_user_id::text,
          jsonb_build_object(
            'reason', handoff_reason,
            'message_id', p_message_id,
            'conversation_id', p_conversation_id,
            'execution_id', candidate.id
          )
        );

        insert into public.lead_timeline_events (
          organization_id, lead_id, event_type, title, description,
          user_id, actor_user_id, metadata, event_at
        ) values (
          p_organization_id, p_lead_id,
          'automation_handoff',
          'Automacao pausada para atendimento humano', preview,
          target_user_id, target_user_id,
          jsonb_build_object(
            'reason', handoff_reason,
            'message_id', p_message_id,
            'conversation_id', p_conversation_id,
            'execution_id', candidate.id
          ),
          p_occurred_at
        );
      end if;
      exit;
    end if;

    resume_result := public.resume_automation_delay(
      p_organization_id,
      candidate.id,
      'replied',
      p_occurred_at,
      jsonb_build_object(
        'message_id', p_message_id,
        'message_type', normalized_type,
        'content', p_content,
        'conversation_id', p_conversation_id
      ),
      p_lead_id,
      p_conversation_id
    );

    if coalesce((resume_result->>'ok')::boolean, false) then
      resumed_ids := array_append(resumed_ids, candidate.id);
      perform private.notify_automation_attention(
        p_organization_id,
        p_lead_id,
        target_user_id,
        'Lead respondeu a automacao',
        target_lead_name || ' respondeu: ' || preview,
        'automation_reply',
        'automation_reply:' || p_message_id::text || ':' || target_user_id::text,
        jsonb_build_object(
          'message_id', p_message_id,
          'conversation_id', p_conversation_id,
          'execution_id', candidate.id
        )
      );
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'status', 'processed',
    'resumed_execution_ids', to_jsonb(resumed_ids),
    'cancelled_execution_ids', to_jsonb(cancelled_ids)
  );
end;
$$;

create or replace function private.capture_automation_human_outbound_handoff()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cancelled_ids uuid[];
  target_user_id uuid;
  target_lead_name text;
begin
  if coalesce(new.from_me, false) = false
     or new.direction <> 'outbound'
     or new.lead_id is null
     or coalesce(new.metadata->>'origin', '') = 'automation' then
    return new;
  end if;

  cancelled_ids := private.cancel_lead_automation_executions(
    new.organization_id,
    new.lead_id,
    'automation_handoff_human_outbound',
    null
  );

  if cardinality(cancelled_ids) > 0 then
    select l.assigned_user_id, l.name
    into target_user_id, target_lead_name
    from public.leads l
    where l.organization_id = new.organization_id and l.id = new.lead_id;

    perform private.notify_automation_attention(
      new.organization_id,
      new.lead_id,
      coalesce(target_user_id, new.sender_user_id),
      'Automacao interrompida pelo atendimento humano',
      coalesce(nullif(target_lead_name, ''), 'Lead') || ' agora esta em atendimento manual.',
      'automation_human_outbound',
      'automation_human_outbound:' || new.id::text || ':' || coalesce(target_user_id, new.sender_user_id)::text,
      jsonb_build_object(
        'message_id', new.id,
        'conversation_id', new.conversation_id,
        'execution_ids', to_jsonb(cancelled_ids)
      )
    );

    insert into public.lead_timeline_events (
      organization_id, lead_id, event_type, title, description,
      user_id, actor_user_id, metadata, event_at
    ) values (
      new.organization_id, new.lead_id,
      'automation_human_outbound',
      'Automacao interrompida por mensagem humana',
      left(coalesce(new.content, '[midia]'), 500),
      coalesce(new.sender_user_id, target_user_id),
      coalesce(new.sender_user_id, target_user_id),
      jsonb_build_object(
        'message_id', new.id,
        'conversation_id', new.conversation_id,
        'execution_ids', to_jsonb(cancelled_ids)
      ),
      coalesce(new.sent_at, new.created_at, now())
    );
  end if;

  return new;
exception when others then
  raise warning 'automation human outbound handoff failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists zz_automation_human_outbound_handoff on public.whatsapp_messages;
create trigger zz_automation_human_outbound_handoff
after insert on public.whatsapp_messages
for each row execute function private.capture_automation_human_outbound_handoff();

create or replace function private.automation_move_lead_stage(
  p_organization_id uuid,
  p_lead_id uuid,
  p_stage_id uuid,
  p_pipeline_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  destination record;
  previous_stage_id uuid;
  previous_pipeline_id uuid;
begin
  select s.id, s.pipeline_id, s.name
  into destination
  from public.stages s
  join public.pipelines p
    on p.id = s.pipeline_id
   and p.organization_id = s.organization_id
   and p.is_active = true
  where s.organization_id = p_organization_id
    and s.id = p_stage_id
    and s.is_active = true
    and (p_pipeline_id is null or s.pipeline_id = p_pipeline_id)
  limit 1;

  if destination.id is null then
    raise exception 'automation_destination_stage_invalid';
  end if;

  select l.stage_id, l.pipeline_id
  into previous_stage_id, previous_pipeline_id
  from public.leads l
  where l.organization_id = p_organization_id and l.id = p_lead_id
  for update;

  if not found then
    raise exception 'automation_target_lead_not_found';
  end if;

  update public.leads l
  set stage_id = destination.id,
      pipeline_id = destination.pipeline_id,
      stage_entered_at = case
        when l.stage_id is distinct from destination.id or l.pipeline_id is distinct from destination.pipeline_id
          then now()
        else l.stage_entered_at
      end,
      board_order_at = case
        when l.stage_id is distinct from destination.id or l.pipeline_id is distinct from destination.pipeline_id
          then now()
        else l.board_order_at
      end,
      updated_at = now()
  where l.organization_id = p_organization_id and l.id = p_lead_id;

  return jsonb_build_object(
    'stage_changed', previous_stage_id is distinct from destination.id
      or previous_pipeline_id is distinct from destination.pipeline_id,
    'from_stage_id', previous_stage_id,
    'from_pipeline_id', previous_pipeline_id,
    'to_stage_id', destination.id,
    'to_pipeline_id', destination.pipeline_id,
    'to_stage_name', destination.name
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
    select status, response
    into target_status, effect_response
    from public.automation_effect_dispatches
    where effect_key = p_effect_key;
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
          p_organization_id,
          target_lead_id,
          target_uuid,
          target_pipeline_id
        );
      when 'assign_user' then
        raise exception 'assign_user_requires_canonical_lead_command_service';
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
      p_organization_id,
      actor_user_id,
      'automation_' || p_effect_type,
      'lead',
      target_lead_id::text,
      jsonb_build_object(
        'stage_id', old_lead->'stage_id',
        'pipeline_id', old_lead->'pipeline_id',
        'assigned_user_id', old_lead->'assigned_user_id',
        'interest_property_id', old_lead->'interest_property_id',
        'deal_status', old_lead->'deal_status'
      ),
      jsonb_build_object(
        'stage_id', new_lead->'stage_id',
        'pipeline_id', new_lead->'pipeline_id',
        'assigned_user_id', new_lead->'assigned_user_id',
        'interest_property_id', new_lead->'interest_property_id',
        'deal_status', new_lead->'deal_status',
        'origin', 'automation',
        'execution_id', p_execution_id,
        'node_key', p_node_key,
        'effect_key', p_effect_key
      )
    );

    insert into public.activities (
      organization_id, lead_id, user_id, type, content, metadata
    ) values (
      p_organization_id,
      target_lead_id,
      actor_user_id,
      'automation_' || p_effect_type,
      'Acao executada pela automacao: ' || p_effect_type,
      jsonb_build_object(
        'origin', 'automation',
        'execution_id', p_execution_id,
        'node_key', p_node_key,
        'effect_key', p_effect_key
      ) || coalesce(effect_response, '{}'::jsonb)
    );

    update public.automation_effect_dispatches
    set status = 'succeeded',
        response = coalesce(effect_response, '{}'::jsonb),
        completed_at = now()
    where id = effect_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'succeeded',
      'effect_id', effect_id,
      'response', coalesce(effect_response, '{}'::jsonb)
    );
  exception when others then
    update public.automation_effect_dispatches
    set status = 'failed', completed_at = now(), error_message = left(sqlerrm, 4000)
    where id = effect_id;
    return jsonb_build_object(
      'ok', false,
      'status', 'failed',
      'error', sqlerrm,
      'effect_id', effect_id
    );
  end;
end;
$$;

revoke execute on function private.notify_automation_attention(uuid, uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function private.cancel_lead_automation_executions(uuid, uuid, text, uuid)
  from public, anon, authenticated;
revoke execute on function private.capture_automation_inbound_message_event()
  from public, anon, authenticated;
revoke execute on function private.capture_automation_human_outbound_handoff()
  from public, anon, authenticated;
revoke execute on function private.automation_move_lead_stage(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.process_automation_inbound_message(uuid, uuid, uuid, uuid, text, text, timestamptz)
  from public, anon, authenticated;
revoke execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.process_automation_inbound_message(uuid, uuid, uuid, uuid, text, text, timestamptz)
  to service_role;
grant execute on function public.apply_automation_internal_effect(uuid, uuid, text, text, text, text, jsonb)
  to service_role;
