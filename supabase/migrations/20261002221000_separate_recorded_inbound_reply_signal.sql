-- Recorded WhatsApp history can resolve a waiting follow-up, but may not
-- start an unrelated automation. The canonical message_received event and its
-- binding-epoch claim checks remain unchanged. This database fence also
-- protects an older Edge runtime in flight during the release.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $recorded_reply_preflight$
declare
  v_start_function regprocedure := pg_catalog.to_regprocedure(
    'public.start_automation_execution_from_event(uuid,uuid,uuid,uuid,uuid,text,jsonb)'
  );
begin
  if v_start_function is null or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'whatsapp_messages'
      and column_name = 'capture_state'
  ) then
    raise exception 'Recorded inbound automation start dependencies have drifted';
  end if;
  if pg_catalog.strpos(
    pg_catalog.pg_get_functiondef(v_start_function),
    'recent_count >= 10'
  ) = 0 then
    raise exception 'Automation start function has drifted';
  end if;
end;
$recorded_reply_preflight$;

CREATE OR REPLACE FUNCTION "public"."start_automation_execution_from_event"("p_event_id" "uuid", "p_automation_id" "uuid", "p_flow_version_id" "uuid", "p_lead_id" "uuid", "p_conversation_id" "uuid", "p_first_node_key" "text", "p_execution_data" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  event_row public.automation_event_outbox%rowtype;
  execution_id uuid;
  recent_count integer;
  causal_depth integer := coalesce((p_execution_data->>'causal_depth')::integer, 0);
begin
  select * into event_row
  from public.automation_event_outbox
  where id = p_event_id and status = 'processing'
  for update;

  if event_row.id is null or event_row.lead_id is distinct from p_lead_id or causal_depth < 0 then
    return jsonb_build_object('ok', false, 'status', 'invalid_event');
  end if;
  -- A saved inbound message is still a reply to a waiting follow-up. It is
  -- never a new automation trigger, including while an older Edge runtime
  -- remains in flight during a rolling release.
  if event_row.event_type = 'message_received'
     and event_row.aggregate_type = 'whatsapp_message'
     and exists (
       select 1
       from public.whatsapp_messages as message
       where message.id = event_row.aggregate_id
         and message.organization_id = event_row.organization_id
         and message.capture_state = 'recorded'
     ) then
    return jsonb_build_object('ok', true, 'status', 'reply_only');
  end if;

  if causal_depth > 10 then
    update public.automation_event_outbox
    set status = 'dead_letter', dead_lettered_at = now(),
        last_error = 'causal_depth_exceeded', locked_at = null, locked_by = null, updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'status', 'causal_depth_exceeded');
  end if;

  if not exists (
    select 1
    from public.automations a
    join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
    join public.organization_modules om
      on om.organization_id = a.organization_id
     and lower(trim(om.module_name)) = 'automations'
     and coalesce(om.is_enabled, false) = true
    where a.id = p_automation_id
      and a.organization_id = event_row.organization_id
      and a.is_active = true
      and a.deleted_at is null
      and fv.id = p_flow_version_id
      and fv.requires_review = false
      and fv.first_node_key = p_first_node_key
  ) then
    return jsonb_build_object('ok', false, 'status', 'automation_inactive');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_automation_id::text || ':' || p_lead_id::text, 0)
  );

  select count(*) into recent_count
  from public.automation_executions e
  where e.automation_id = p_automation_id
    and e.lead_id = p_lead_id
    and e.flow_version_id is not null
    and e.started_at >= now() - interval '1 hour';

  if recent_count >= 10 then
    insert into public.automation_circuit_breakers (
      organization_id, automation_id, lead_id, window_started_at,
      execution_count, open_until, reason, updated_at
    ) values (
      event_row.organization_id, p_automation_id, p_lead_id, now() - interval '1 hour',
      recent_count, now() + interval '1 hour', 'max_10_executions_per_hour', now()
    ) on conflict (automation_id, lead_id) do update
      set execution_count = excluded.execution_count,
          open_until = excluded.open_until,
          reason = excluded.reason,
          updated_at = now();
    update public.automation_event_outbox
    set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{runtime_decisions}',
          coalesce(payload->'runtime_decisions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'type', 'circuit_open',
            'automation_id', p_automation_id,
            'flow_version_id', p_flow_version_id,
            'recent_count', recent_count,
            'recorded_at', now()
          )),
          true
        ),
        last_error = 'circuit_open',
        updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', false, 'status', 'circuit_open', 'recent_count', recent_count);
  end if;

  begin
    insert into public.automation_executions (
      automation_id, flow_version_id, trigger_event_id, lead_id,
      conversation_id, organization_id, current_node_key, status,
      started_at, execution_data
    ) values (
      p_automation_id, p_flow_version_id, p_event_id, p_lead_id,
      p_conversation_id, event_row.organization_id, p_first_node_key, 'queued',
      now(), coalesce(p_execution_data, '{}'::jsonb)
    ) returning id into execution_id;
  exception when unique_violation then
    update public.automation_event_outbox
    set payload = jsonb_set(
          coalesce(payload, '{}'::jsonb),
          '{runtime_decisions}',
          coalesce(payload->'runtime_decisions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
            'type', 'duplicate_or_already_active',
            'automation_id', p_automation_id,
            'flow_version_id', p_flow_version_id,
            'recorded_at', now()
          )),
          true
        ),
        last_error = 'duplicate_or_already_active',
        updated_at = now()
    where id = p_event_id;
    return jsonb_build_object('ok', true, 'status', 'duplicate_or_already_active');
  end;

  insert into public.automation_circuit_breakers (
    organization_id, automation_id, lead_id, window_started_at,
    execution_count, open_until, reason, updated_at
  ) values (
    event_row.organization_id, p_automation_id, p_lead_id, now(),
    1, null, null, now()
  ) on conflict (automation_id, lead_id) do update
    set window_started_at = case
          when automation_circuit_breakers.window_started_at < now() - interval '1 hour' then now()
          else automation_circuit_breakers.window_started_at
        end,
        execution_count = recent_count + 1,
        open_until = null,
        reason = null,
        updated_at = now();

  return jsonb_build_object('ok', true, 'status', 'queued', 'execution_id', execution_id);
end;
$$;

revoke all on function public.start_automation_execution_from_event(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.start_automation_execution_from_event(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) to service_role;
comment on function public.start_automation_execution_from_event(
  uuid, uuid, uuid, uuid, uuid, text, jsonb
) is 'recorded_inbound_reply_only_v1: recorded WhatsApp messages may resume waiting follow-ups but cannot start new automation executions.';

commit;
