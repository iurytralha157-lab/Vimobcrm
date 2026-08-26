create or replace function public.handle_managed_whatsapp_message_lead(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_rule_id_text text;
  v_rule_id uuid;
  v_marker boolean := false;
  v_queue_id uuid;
  v_queue_name text;
  v_target_pipeline_id uuid;
  v_target_stage_id uuid;
  v_keyword text;
  v_config_valid boolean := false;
  v_member record;
begin
  select lead.*
    into v_lead
    from public.leads lead
   where lead.id = p_lead_id
   for update;

  if not found then
    return jsonb_build_object('handled', false, 'reason', 'lead_not_found');
  end if;

  v_marker := lower(btrim(coalesce(v_lead.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes');
  v_rule_id_text := btrim(coalesce(v_lead.metadata->>'matched_rule_id', ''));

  if v_marker then
    insert into public.lead_timeline_events (
      lead_id, organization_id, user_id, event_type, title, description, metadata
    )
    select
      v_lead.id,
      v_lead.organization_id,
      null,
      'lead_created',
      'Lead criado',
      'Lead recebido no sistema',
      jsonb_build_object(
        'source', v_lead.source,
        'source_label', 'WhatsApp',
        'source_session_id', v_lead.source_session_id,
        'matched_rule_id', nullif(v_rule_id_text, '')
      )
    where not exists (
      select 1
        from public.lead_timeline_events timeline
       where timeline.lead_id = v_lead.id
         and timeline.event_type = 'lead_created'
    );
  end if;

  if v_rule_id_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    if v_marker then
      return jsonb_build_object('handled', true, 'success', false, 'reason', 'managed_rule_id_invalid');
    end if;
    return jsonb_build_object('handled', false, 'reason', 'not_managed');
  end if;
  v_rule_id := v_rule_id_text::uuid;

  select
    queue.id,
    queue.name,
    coalesce(queue.target_pipeline_id, queue.pipeline_id),
    queue.target_stage_id,
    normalized.keyword,
    (
      lower(btrim(coalesce(v_lead.source, ''))) = 'whatsapp'
      and coalesce(queue.is_active, true) = true
      and coalesce(round_robin_rule.is_active, true) = true
      and coalesce(inbound_rule.is_active, true) = true
      and lower(btrim(coalesce(inbound_rule.match_type, ''))) = 'contains'
      and lower(btrim(coalesce(inbound_rule.match_field, 'message'))) = 'message'
      and normalized.keyword <> ''
      and lower(btrim(coalesce(inbound_rule.match_value, ''))) = lower(normalized.keyword)
      and (inbound_rule.session_id is null or inbound_rule.session_id = v_lead.source_session_id)
      and position(
        lower(normalized.keyword)
        in lower(coalesce(nullif(v_lead.initial_message, ''), v_lead.message, ''))
      ) > 0
      and lower(btrim(coalesce(nullif(queue.strategy, ''), 'simple'))) = 'simple'
      and lower(btrim(coalesce(queue.settings->>'enable_redistribution', 'false'))) not in ('true', '1', 'yes')
      and lower(btrim(coalesce(queue.settings->>'require_checkin', 'false'))) not in ('true', '1', 'yes')
      and lower(btrim(coalesce(queue.settings->>'ignore_availability', 'false'))) = 'true'
      and not exists (
        select 1
          from public.round_robin_rules other_rule
         where other_rule.organization_id = queue.organization_id
           and other_rule.round_robin_id = queue.id
           and coalesce(other_rule.is_active, true) = true
           and coalesce(
             nullif(other_rule.match_type, ''),
             other_rule.conditions->>'match_type',
             other_rule.name,
             ''
           ) <> 'whatsapp_message_contains'
      )
      and not exists (
        select 1
          from public.round_robin_members team_member
         where team_member.organization_id = queue.organization_id
           and team_member.round_robin_id = queue.id
           and coalesce(team_member.is_active, true) = true
           and team_member.team_id is not null
      )
    )
    into
      v_queue_id,
      v_queue_name,
      v_target_pipeline_id,
      v_target_stage_id,
      v_keyword,
      v_config_valid
    from public.round_robin_rules round_robin_rule
    join public.whatsapp_inbound_rules inbound_rule
      on inbound_rule.organization_id = round_robin_rule.organization_id
     and inbound_rule.id = round_robin_rule.id
     and inbound_rule.target_round_robin_id = round_robin_rule.round_robin_id
    join public.round_robins queue
      on queue.organization_id = round_robin_rule.organization_id
     and queue.id = round_robin_rule.round_robin_id
    cross join lateral (
      select btrim(coalesce(
        nullif(round_robin_rule.match_value, ''),
        round_robin_rule.conditions->>'match_value',
        ''
      )) as keyword
    ) normalized
   where round_robin_rule.organization_id = v_lead.organization_id
     and round_robin_rule.id = v_rule_id
     and coalesce(
       nullif(round_robin_rule.match_type, ''),
       round_robin_rule.conditions->>'match_type',
       round_robin_rule.name,
       ''
     ) = 'whatsapp_message_contains'
   limit 1
   for update of queue, round_robin_rule, inbound_rule;

  if not found then
    if v_marker then
      insert into public.round_robin_logs (organization_id, lead_id, reason, metadata)
      values (
        v_lead.organization_id,
        v_lead.id,
        'managed_whatsapp_rule_unavailable',
        jsonb_build_object(
          'managed_whatsapp_message_distribution', true,
          'matched_rule_id', v_rule_id
        )
      );
      return jsonb_build_object('handled', true, 'success', false, 'reason', 'managed_rule_unavailable');
    end if;
    return jsonb_build_object('handled', false, 'reason', 'not_managed');
  end if;

  insert into public.lead_timeline_events (
    lead_id, organization_id, user_id, event_type, title, description, metadata
  )
  select
    v_lead.id,
    v_lead.organization_id,
    null,
    'lead_created',
    'Lead criado',
    'Lead recebido no sistema',
    jsonb_build_object(
      'source', v_lead.source,
      'source_label', 'WhatsApp',
      'source_session_id', v_lead.source_session_id,
      'matched_rule_id', v_rule_id
    )
  where not exists (
    select 1
      from public.lead_timeline_events timeline
     where timeline.lead_id = v_lead.id
       and timeline.event_type = 'lead_created'
  );

  if not coalesce(v_config_valid, false) then
    insert into public.round_robin_logs (
      organization_id, round_robin_id, lead_id, rule_matched, reason, metadata
    ) values (
      v_lead.organization_id,
      v_queue_id,
      v_lead.id,
      v_rule_id,
      'managed_whatsapp_rule_invalid',
      jsonb_build_object('keyword', v_keyword, 'managed_whatsapp_message_distribution', true)
    );

    insert into public.lead_timeline_events (
      lead_id, organization_id, user_id, event_type, title, description, metadata
    ) values (
      v_lead.id,
      v_lead.organization_id,
      null,
      'lead_assigned',
      'Aguardando distribuição',
      'A fila da campanha do WhatsApp está indisponível ou incompatível.',
      jsonb_build_object(
        'destination', 'pool',
        'queue_id', v_queue_id,
        'distribution_queue_id', v_queue_id,
        'reason', 'managed_whatsapp_rule_invalid'
      )
    );

    return jsonb_build_object(
      'handled', true,
      'success', false,
      'reason', 'managed_whatsapp_rule_invalid',
      'round_robin_id', v_queue_id
    );
  end if;

  select
    member.id as id,
    member.user_id as user_id,
    user_account.name as user_name
    into v_member
    from public.round_robin_members member
    join public.users user_account
      on user_account.id = member.user_id
     and coalesce(user_account.is_active, false) = true
    join public.organization_members organization_member
      on organization_member.organization_id = member.organization_id
     and organization_member.user_id = member.user_id
     and coalesce(organization_member.is_active, false) = true
   where member.organization_id = v_lead.organization_id
     and member.round_robin_id = v_queue_id
     and coalesce(member.is_active, true) = true
     and member.user_id is not null
     and member.team_id is null
   order by
     coalesce(member.leads_count, 0) asc,
     member.position asc,
     member.created_at asc,
     member.id asc
   limit 1
   for update of member, user_account, organization_member;

  if not found then
    insert into public.round_robin_logs (
      organization_id, round_robin_id, lead_id, rule_matched, reason, metadata
    ) values (
      v_lead.organization_id,
      v_queue_id,
      v_lead.id,
      v_rule_id,
      'no_available_members',
      jsonb_build_object('managed_whatsapp_message_distribution', true)
    );

    insert into public.lead_timeline_events (
      lead_id, organization_id, user_id, event_type, title, description, metadata
    ) values (
      v_lead.id,
      v_lead.organization_id,
      null,
      'lead_assigned',
      'Aguardando distribuição',
      'Fila "' || v_queue_name || '" sem corretores ativos no momento.',
      jsonb_build_object(
        'destination', 'pool',
        'queue_name', v_queue_name,
        'distribution_queue_name', v_queue_name,
        'queue_id', v_queue_id,
        'distribution_queue_id', v_queue_id,
        'reason', 'no_available_members'
      )
    );

    return jsonb_build_object(
      'handled', true,
      'success', false,
      'reason', 'no_available_members',
      'round_robin_id', v_queue_id
    );
  end if;

  update public.leads lead
     set assigned_user_id = v_member.user_id,
         pipeline_id = coalesce(v_target_pipeline_id, lead.pipeline_id),
         stage_id = coalesce(v_target_stage_id, lead.stage_id),
         assigned_at = now(),
         metadata = coalesce(lead.metadata, '{}'::jsonb) || jsonb_build_object(
           'managed_whatsapp_message_distribution', true,
           'target_round_robin_id', v_queue_id,
           'matched_rule_id', v_rule_id
         ),
         updated_at = now()
   where lead.id = v_lead.id
     and lead.organization_id = v_lead.organization_id
     and lead.assigned_user_id is null;

  if not found then
    return jsonb_build_object('handled', true, 'success', true, 'reason', 'already_assigned');
  end if;

  update public.round_robin_members member
     set leads_count = coalesce(member.leads_count, 0) + 1,
         updated_at = now()
   where member.id = v_member.id
     and member.organization_id = v_lead.organization_id;

  update public.round_robins queue
     set current_position = coalesce(queue.current_position, 0) + 1,
         leads_distributed = coalesce(queue.leads_distributed, 0) + 1,
         updated_at = now()
   where queue.id = v_queue_id
     and queue.organization_id = v_lead.organization_id;

  insert into public.assignments_log (
    lead_id, organization_id, round_robin_id, assigned_user_id, user_id, reason
  ) values (
    v_lead.id,
    v_lead.organization_id,
    v_queue_id,
    v_member.user_id,
    v_member.user_id,
    'round_robin_whatsapp_message'
  );

  insert into public.round_robin_logs (
    organization_id, round_robin_id, lead_id, assigned_user_id, member_id,
    rule_matched, reason, metadata
  ) values (
    v_lead.organization_id,
    v_queue_id,
    v_lead.id,
    v_member.user_id,
    v_member.id,
    v_rule_id,
    'round_robin_whatsapp_message',
    jsonb_build_object(
      'type', 'direct',
      'availability_check', 'queue_ignores_availability',
      'queue_name', v_queue_name,
      'keyword', v_keyword,
      'managed_whatsapp_message_distribution', true
    )
  );

  insert into public.lead_timeline_events (
    lead_id, organization_id, user_id, event_type, title, description, metadata
  ) values (
    v_lead.id,
    v_lead.organization_id,
    v_member.user_id,
    'lead_assigned',
    'Distribuído via "' || v_queue_name || '"',
    'Atribuído a ' || coalesce(v_member.user_name, 'usuário') || ' pela fila "' || v_queue_name || '"',
    jsonb_build_object(
      'source', v_lead.source,
      'source_label', 'WhatsApp',
      'queue_name', v_queue_name,
      'distribution_queue_name', v_queue_name,
      'queue_id', v_queue_id,
      'distribution_queue_id', v_queue_id,
      'assigned_user_id', v_member.user_id,
      'assigned_user_name', v_member.user_name,
      'to_user_id', v_member.user_id,
      'to_user_name', v_member.user_name,
      'is_initial_distribution', true,
      'distribution_type', 'round_robin_whatsapp_message'
    )
  );

  if to_regprocedure('public.notify_whatsapp_on_lead(text, uuid, text, uuid)') is not null then
    execute (
      'select ' || quote_ident('public') || '.' || quote_ident('notify_whatsapp_on_lead') ||
      '($1::text, $2::uuid, $3::text, $4::uuid)'
    )
    using v_lead.name, v_lead.organization_id, v_lead.source, v_member.user_id;
  end if;

  return jsonb_build_object(
    'handled', true,
    'success', true,
    'assigned_user_id', v_member.user_id,
    'assigned_user_name', v_member.user_name,
    'round_robin_id', v_queue_id,
    'round_robin_name', v_queue_name,
    'member_id', v_member.id
  );
end;
$$;

revoke all on function public.handle_managed_whatsapp_message_lead(uuid)
from public, anon, authenticated;
grant execute on function public.handle_managed_whatsapp_message_lead(uuid)
to service_role;

create or replace function public.handle_routed_lead_intake(p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_lead public.leads%rowtype;
  v_managed_result jsonb;
begin
  select lead.*
    into v_lead
    from public.leads lead
   where lead.id = p_lead_id;

  if not found then
    return jsonb_build_object('handled', false, 'success', false, 'reason', 'lead_not_found');
  end if;

  if lower(btrim(coalesce(v_lead.source, ''))) = 'whatsapp'
     and (
       lower(btrim(coalesce(v_lead.metadata->>'managed_whatsapp_message_distribution', 'false'))) in ('true', '1', 'yes')
       or btrim(coalesce(v_lead.metadata->>'matched_rule_id', '')) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     ) then
    v_managed_result := public.handle_managed_whatsapp_message_lead(p_lead_id);
    if lower(coalesce(v_managed_result->>'handled', 'false')) = 'true' then
      return v_managed_result;
    end if;
  end if;

  return public.handle_lead_intake(p_lead_id);
end;
$$;

revoke all on function public.handle_routed_lead_intake(uuid)
from public, anon, authenticated;
grant execute on function public.handle_routed_lead_intake(uuid)
to service_role;

create or replace function public.trigger_handle_lead_intake()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if new.assigned_user_id is null then
    perform public.handle_routed_lead_intake(new.id);
  end if;
  return new;
end;
$$;
