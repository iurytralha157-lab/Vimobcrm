-- Serialize the pool warning marker with its in-app notification. The Edge
-- worker only discovers candidates; this backend-only aggregate revalidates
-- the assignment and activity snapshot under the lead lock before committing.

create or replace function public.send_pool_redistribution_warning_from_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_round_robin_id uuid,
  p_expected_assigned_user_id uuid,
  p_expected_lead_assigned_at timestamptz,
  p_expected_distribution_assignment_at timestamptz,
  p_expected_redistribution_count integer,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_pipeline public.pipelines%rowtype;
  v_assignment record;
  v_assignment_at timestamptz;
  v_timeout_minutes integer;
  v_warning_minutes integer;
  v_has_blocking_activity boolean := false;
  v_notification_id uuid := gen_random_uuid();
begin
  p_now := coalesce(p_now, clock_timestamp());

  if p_organization_id is null
     or p_lead_id is null
     or p_round_robin_id is null
     or p_expected_assigned_user_id is null
     or p_expected_lead_assigned_at is null
     or p_expected_distribution_assignment_at is null
     or p_expected_redistribution_count is null
     or p_expected_redistribution_count < 0 then
    raise exception using
      errcode = '22023',
      message = 'invalid_pool_warning_request';
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'lead_not_found',
      'lead_id', p_lead_id
    );
  end if;

  if v_lead.assigned_user_id is distinct from p_expected_assigned_user_id
     or v_lead.assigned_at is distinct from p_expected_lead_assigned_at
     or coalesce(v_lead.redistribution_count, 0) <>
       p_expected_redistribution_count then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'stale_pool_candidate',
      'lead_id', p_lead_id
    );
  end if;

  if v_lead.redistribution_warning_sent_at is not null then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'replayed', true,
      'reason', 'warning_already_sent',
      'lead_id', p_lead_id
    );
  end if;

  if lower(coalesce(v_lead.deal_status, 'open')) in (
    'won', 'ganho', 'lost', 'perdido', 'closed', 'fechado'
  ) then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'closed_deal_status',
      'lead_id', p_lead_id
    );
  end if;

  if exists (
    select 1
    from public.stages as stage
    where stage.id = v_lead.stage_id
      and stage.organization_id = p_organization_id
      and (coalesce(stage.is_won, false) or coalesce(stage.is_lost, false))
  ) then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'closed_stage',
      'lead_id', p_lead_id
    );
  end if;

  select pipeline.*
  into v_pipeline
  from public.pipelines as pipeline
  where pipeline.id = v_lead.pipeline_id
    and pipeline.organization_id = p_organization_id
    and coalesce(pipeline.pool_enabled, false) = true;

  if not found then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'pool_disabled_for_pipeline',
      'lead_id', p_lead_id
    );
  end if;

  v_timeout_minutes := greatest(coalesce(v_pipeline.pool_timeout_minutes, 10), 1);
  v_warning_minutes := greatest(
    0,
    least(coalesce(v_pipeline.pool_warning_minutes, 2), v_timeout_minutes - 1)
  );

  if v_warning_minutes = 0 then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'pool_warning_disabled',
      'lead_id', p_lead_id
    );
  end if;

  select assignment.*
  into v_assignment
  from public.assignments_log as assignment
  where assignment.organization_id = p_organization_id
    and assignment.lead_id = p_lead_id
    and assignment.assigned_user_id = p_expected_assigned_user_id
    and coalesce(assignment.reason, '') in (
      'round_robin_auto',
      'round_robin',
      'canonical_round_robin'
    )
    and assignment.round_robin_id is not null
  order by
    coalesce(assignment.assigned_at, assignment.created_at) desc,
    assignment.created_at desc,
    assignment.id desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'lead_not_assigned_by_distribution_queue',
      'lead_id', p_lead_id
    );
  end if;

  v_assignment_at := coalesce(
    v_assignment.assigned_at,
    v_assignment.created_at,
    v_lead.assigned_at,
    v_lead.created_at
  );

  if v_assignment.round_robin_id is distinct from p_round_robin_id
     or v_assignment_at is distinct from
       p_expected_distribution_assignment_at then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'stale_distribution_assignment',
      'lead_id', p_lead_id
    );
  end if;

  if v_pipeline.pool_enabled_at is not null
     and v_assignment_at < v_pipeline.pool_enabled_at then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'lead_assigned_before_pool_enabled',
      'lead_id', p_lead_id
    );
  end if;

  if coalesce(v_pipeline.pool_max_redistributions, 3) > 0
     and p_expected_redistribution_count >=
       v_pipeline.pool_max_redistributions then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'pool_redistribution_limit_reached',
      'lead_id', p_lead_id
    );
  end if;

  if v_assignment_at >= p_now - make_interval(
       mins => v_timeout_minutes - v_warning_minutes
     ) then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'pool_warning_not_due',
      'lead_id', p_lead_id
    );
  end if;

  if v_assignment_at <= p_now - make_interval(mins => v_timeout_minutes) then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'pool_timeout_already_due',
      'lead_id', p_lead_id
    );
  end if;

  v_has_blocking_activity :=
    (v_lead.first_response_at is not null and v_lead.first_response_at >= v_assignment_at - interval '5 seconds')
    or (v_lead.first_touch_at is not null and v_lead.first_touch_at >= v_assignment_at - interval '5 seconds')
    or (v_lead.owner_last_activity_at is not null and v_lead.owner_last_activity_at >= v_assignment_at - interval '5 seconds')
    or (v_lead.last_contact_at is not null and v_lead.last_contact_at >= v_assignment_at - interval '5 seconds')
    or (v_lead.stage_entered_at is not null and v_lead.stage_entered_at > v_assignment_at + interval '10 seconds');

  if not v_has_blocking_activity then
    select exists (
      select 1
      from public.lead_timeline_events as timeline
      where timeline.organization_id = p_organization_id
        and timeline.lead_id = p_lead_id
        and timeline.created_at >= v_assignment_at - interval '5 seconds'
        and timeline.event_type = any (array[
          'whatsapp_message_sent',
          'first_response',
          'call_initiated',
          'call_completed',
          'note_created',
          'stage_changed',
          'agenda_created',
          'agenda_rescheduled',
          'agenda_completed',
          'agenda_cancelled',
          'schedule_comment'
        ]::text[])
    ) into v_has_blocking_activity;
  end if;

  if not v_has_blocking_activity then
    select exists (
      select 1
      from public.whatsapp_messages as message
      where message.organization_id = p_organization_id
        and message.lead_id = p_lead_id
        and message.created_at >= v_assignment_at - interval '5 seconds'
        and (coalesce(message.from_me, false) = true or message.sender_user_id is not null)
    ) into v_has_blocking_activity;
  end if;

  if v_has_blocking_activity then
    return jsonb_build_object(
      'success', true,
      'warning_sent', false,
      'skipped', true,
      'reason', 'lead_has_activity_after_distribution',
      'lead_id', p_lead_id
    );
  end if;

  insert into public.notifications (
    id,
    organization_id,
    user_id,
    lead_id,
    type,
    title,
    content,
    is_read,
    metadata,
    channel,
    target_url,
    created_at
  )
  values (
    v_notification_id,
    p_organization_id,
    p_expected_assigned_user_id,
    p_lead_id,
    'lead_redistribution_warning',
    'Lead aguardando atendimento',
    'O lead "' || coalesce(nullif(v_lead.name, ''), 'sem nome')
      || '" ainda não teve contato nem movimentação sua. Ele será redistribuído em aproximadamente '
      || v_warning_minutes::text || ' min se continuar parado.',
    false,
    jsonb_build_object(
      'event_key', 'lead_redistribution_warning',
      'dedupe_key', 'lead_redistribution_warning:' || p_lead_id::text
        || ':' || extract(epoch from v_assignment_at)::bigint::text,
      'round_robin_id', p_round_robin_id,
      'assignment_at', v_assignment_at
    ),
    'in_app',
    '/crm/pipelines?lead=' || p_lead_id::text,
    p_now
  );

  update public.leads as lead
  set redistribution_warning_sent_at = p_now,
      updated_at = p_now
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
    and lead.assigned_user_id = p_expected_assigned_user_id
    and lead.assigned_at = p_expected_lead_assigned_at
    and lead.redistribution_warning_sent_at is null;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'pool_warning_marker_not_recorded';
  end if;

  return jsonb_build_object(
    'success', true,
    'warning_sent', true,
    'skipped', false,
    'lead_id', p_lead_id,
    'notification_id', v_notification_id,
    'warning_sent_at', p_now
  );
end;
$$;

comment on function public.send_pool_redistribution_warning_from_backend(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer,
  timestamptz
) is
  'Backend-only pool warning aggregate. It revalidates the assignment and commits the notification and warning marker atomically.';

revoke all on function public.send_pool_redistribution_warning_from_backend(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.send_pool_redistribution_warning_from_backend(
  uuid,
  uuid,
  uuid,
  uuid,
  timestamptz,
  timestamptz,
  integer,
  timestamptz
) to service_role;
