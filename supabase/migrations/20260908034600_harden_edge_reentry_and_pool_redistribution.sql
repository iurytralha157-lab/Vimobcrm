-- Make legacy Edge ingress reentries auditable/idempotent and keep pool
-- redistribution inside the canonical database transaction.
--
-- The original register_lead_reentry RPC returns void and accepts arbitrary
-- entry_type values even though lead_entry_events only permits the canonical
-- value `reentry`. Keep that compatibility RPC untouched and expose a new,
-- backend-only contract that returns the immutable entry event identity.

create or replace function public.register_lead_reentry_from_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_provider text,
  p_provider_event_id text default null,
  p_source text default null,
  p_entry_subtype text default 'reentry',
  p_property_id uuid default null,
  p_valor_interesse numeric default null,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_provider text;
  v_provider_event_id text;
  v_event_id uuid;
  v_existing_lead_id uuid;
  v_inserted boolean := false;
  v_metadata jsonb;
begin
  p_occurred_at := coalesce(p_occurred_at, clock_timestamp());
  v_provider := regexp_replace(
    lower(btrim(coalesce(p_provider, ''))),
    '[^a-z0-9_-]+',
    '_',
    'g'
  );
  v_provider_event_id := nullif(btrim(coalesce(p_provider_event_id, '')), '');

  if p_organization_id is null
     or p_lead_id is null
     or length(v_provider) not between 1 and 64
     or (
       v_provider_event_id is not null
       and length(v_provider_event_id) > 200
     ) then
    raise exception using
      errcode = '22023',
      message = 'invalid_lead_reentry_request';
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'lead_reentry_target_not_found';
  end if;

  v_metadata := coalesce(p_metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'entry_subtype', coalesce(nullif(btrim(p_entry_subtype), ''), 'reentry'),
      'provider_event_id', v_provider_event_id
    ));

  if v_provider_event_id is null then
    insert into public.lead_entry_events (
      lead_id,
      organization_id,
      entry_type,
      source,
      provider,
      occurred_at,
      pipeline_id,
      stage_id,
      campaign_id,
      campaign_name,
      adset_id,
      adset_name,
      ad_id,
      ad_name,
      form_id,
      form_name,
      page_id,
      page_name,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      property_id,
      valor_interesse,
      metadata
    )
    values (
      p_lead_id,
      p_organization_id,
      'reentry',
      p_source,
      v_provider,
      p_occurred_at,
      v_lead.pipeline_id,
      v_lead.stage_id,
      nullif(v_metadata->>'campaign_id', ''),
      nullif(v_metadata->>'campaign_name', ''),
      nullif(v_metadata->>'adset_id', ''),
      nullif(v_metadata->>'adset_name', ''),
      nullif(v_metadata->>'ad_id', ''),
      nullif(v_metadata->>'ad_name', ''),
      nullif(v_metadata->>'form_id', ''),
      nullif(v_metadata->>'form_name', ''),
      nullif(v_metadata->>'page_id', ''),
      nullif(v_metadata->>'page_name', ''),
      nullif(v_metadata->>'utm_source', ''),
      nullif(v_metadata->>'utm_medium', ''),
      nullif(v_metadata->>'utm_campaign', ''),
      nullif(v_metadata->>'utm_content', ''),
      nullif(v_metadata->>'utm_term', ''),
      p_property_id,
      p_valor_interesse,
      v_metadata
    )
    returning id into v_event_id;

    v_inserted := true;
  else
    insert into public.lead_entry_events (
      lead_id,
      organization_id,
      entry_type,
      source,
      provider,
      provider_event_id,
      occurred_at,
      pipeline_id,
      stage_id,
      campaign_id,
      campaign_name,
      adset_id,
      adset_name,
      ad_id,
      ad_name,
      form_id,
      form_name,
      page_id,
      page_name,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      property_id,
      valor_interesse,
      metadata
    )
    values (
      p_lead_id,
      p_organization_id,
      'reentry',
      p_source,
      v_provider,
      v_provider_event_id,
      p_occurred_at,
      v_lead.pipeline_id,
      v_lead.stage_id,
      nullif(v_metadata->>'campaign_id', ''),
      nullif(v_metadata->>'campaign_name', ''),
      nullif(v_metadata->>'adset_id', ''),
      nullif(v_metadata->>'adset_name', ''),
      nullif(v_metadata->>'ad_id', ''),
      nullif(v_metadata->>'ad_name', ''),
      nullif(v_metadata->>'form_id', ''),
      nullif(v_metadata->>'form_name', ''),
      nullif(v_metadata->>'page_id', ''),
      nullif(v_metadata->>'page_name', ''),
      nullif(v_metadata->>'utm_source', ''),
      nullif(v_metadata->>'utm_medium', ''),
      nullif(v_metadata->>'utm_campaign', ''),
      nullif(v_metadata->>'utm_content', ''),
      nullif(v_metadata->>'utm_term', ''),
      p_property_id,
      p_valor_interesse,
      v_metadata
    )
    on conflict (organization_id, provider, provider_event_id)
      where provider_event_id is not null and is_countable = true
    do nothing
    returning id into v_event_id;

    if v_event_id is null then
      select event.id, event.lead_id
      into v_event_id, v_existing_lead_id
      from public.lead_entry_events as event
      where event.organization_id = p_organization_id
        and event.provider = v_provider
        and event.provider_event_id = v_provider_event_id
        and event.is_countable = true;

      if v_event_id is null then
        raise exception using
          errcode = '40001',
          message = 'lead_reentry_idempotency_lookup_failed';
      end if;

      if v_existing_lead_id <> p_lead_id then
        raise exception using
          errcode = '23505',
          message = 'lead_reentry_idempotency_conflict';
      end if;
    else
      v_inserted := true;
    end if;
  end if;

  if v_inserted then
    update public.leads as lead
    set reentry_count = coalesce(lead.reentry_count, 0) + 1,
        last_entry_at = p_occurred_at,
        source = coalesce(lead.source, p_source),
        interest_property_id = coalesce(p_property_id, lead.interest_property_id),
        valor_interesse = coalesce(p_valor_interesse, lead.valor_interesse),
        updated_at = clock_timestamp()
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'event_id', v_event_id,
    'inserted', v_inserted,
    'replayed', not v_inserted
  );
end;
$$;

comment on function public.register_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb,
  timestamptz
) is
  'Backend-only lead reentry registrar. It returns the immutable entry-event ID and replays provider-key retries without incrementing reentry_count twice.';

revoke all on function public.register_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.register_lead_reentry_from_backend(
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  uuid,
  numeric,
  jsonb,
  timestamptz
) to service_role;

-- A pool redistribution is one aggregate mutation. The canonical assignment,
-- pool counter, history and former-owner notification must commit together.
-- This wrapper remains backend-only and delegates candidate selection and the
-- durable distribution ledger to private.distribute_lead.
create or replace function public.redistribute_lead_from_pool_backend(
  p_organization_id uuid,
  p_lead_id uuid,
  p_idempotency_key text,
  p_round_robin_id uuid,
  p_expected_assigned_user_id uuid,
  p_expected_assigned_at timestamptz,
  p_expected_redistribution_count integer,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_pipeline public.pipelines%rowtype;
  v_assignment record;
  v_existing_event private.lead_distribution_events%rowtype;
  v_result jsonb;
  v_event_id uuid;
  v_assigned_user_id uuid;
  v_assignment_at timestamptz;
  v_has_blocking_activity boolean := false;
  v_recover_existing boolean := false;
  v_counter_applied boolean := false;
  v_counter_rows integer := 0;
begin
  p_now := coalesce(p_now, clock_timestamp());

  if p_organization_id is null
     or p_lead_id is null
     or p_round_robin_id is null
     or p_expected_assigned_user_id is null
     or p_expected_assigned_at is null
     or p_expected_redistribution_count is null
     or p_expected_redistribution_count < 0
     or p_idempotency_key is null
     or length(btrim(p_idempotency_key)) not between 1 and 200
     or p_idempotency_key <> btrim(p_idempotency_key) then
    raise exception using
      errcode = '22023',
      message = 'invalid_pool_redistribution_request';
  end if;

  select event.*
  into v_existing_event
  from private.lead_distribution_events as event
  where event.organization_id = p_organization_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.lead_id <> p_lead_id then
      return jsonb_build_object(
        'success', false,
        'reason', 'idempotency_key_conflict',
        'lead_id', p_lead_id
      );
    end if;

    if coalesce((v_existing_event.result->>'pool_finalized')::boolean, false)
       or coalesce((v_existing_event.result->>'success')::boolean, false) = false then
      return v_existing_event.result || jsonb_build_object('replayed', true);
    end if;

    v_result := v_existing_event.result;
    v_recover_existing := true;
  end if;

  select lead.*
  into v_lead
  from public.leads as lead
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
  for update;

  if not found then
    return jsonb_build_object(
      'success', false,
      'skipped', true,
      'reason', 'lead_not_found',
      'lead_id', p_lead_id
    );
  end if;

  -- A concurrent request may have committed while this transaction waited for
  -- the lead lock. Always re-read the durable event, including recovery calls
  -- that already observed an unfinished event before waiting. Otherwise two
  -- recoveries can both finalize the same ledger row and the loser can replace
  -- the successful result with a stale `pool_counter_applied = false` value.
  select event.*
  into v_existing_event
  from private.lead_distribution_events as event
  where event.organization_id = p_organization_id
    and event.idempotency_key = p_idempotency_key;

  if found then
    if v_existing_event.lead_id <> p_lead_id then
      return jsonb_build_object(
        'success', false,
        'reason', 'idempotency_key_conflict',
        'lead_id', p_lead_id
      );
    end if;

    if coalesce((v_existing_event.result->>'pool_finalized')::boolean, false)
       or coalesce((v_existing_event.result->>'success')::boolean, false) = false then
      return v_existing_event.result || jsonb_build_object('replayed', true);
    end if;

    v_result := v_existing_event.result;
    v_recover_existing := true;
  else
    v_result := null;
    v_recover_existing := false;
  end if;

  if not v_recover_existing then
    if v_lead.assigned_user_id is distinct from p_expected_assigned_user_id
       or v_lead.assigned_at is distinct from p_expected_assigned_at
       or coalesce(v_lead.redistribution_count, 0) <> p_expected_redistribution_count then
      return jsonb_build_object(
        'success', false,
        'skipped', true,
        'reason', 'stale_pool_candidate',
        'lead_id', p_lead_id
      );
    end if;

    if lower(coalesce(v_lead.deal_status, 'open')) in (
      'won', 'ganho', 'lost', 'perdido', 'closed', 'fechado'
    ) then
      return jsonb_build_object(
        'success', false,
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
        'success', false,
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
        'success', false,
        'skipped', true,
        'reason', 'pool_disabled_for_pipeline',
        'lead_id', p_lead_id
      );
    end if;

    select assignment.*
    into v_assignment
    from public.assignments_log as assignment
    where assignment.organization_id = p_organization_id
      and assignment.lead_id = p_lead_id
      and assignment.assigned_user_id = p_expected_assigned_user_id
      and assignment.round_robin_id = p_round_robin_id
      and coalesce(assignment.reason, '') in (
        'round_robin_auto',
        'round_robin',
        'canonical_round_robin'
      )
    order by
      coalesce(assignment.assigned_at, assignment.created_at) desc,
      assignment.created_at desc,
      assignment.id desc
    limit 1;

    if not found then
      return jsonb_build_object(
        'success', false,
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

    if v_pipeline.pool_enabled_at is not null
       and v_assignment_at < v_pipeline.pool_enabled_at then
      return jsonb_build_object(
        'success', false,
        'skipped', true,
        'reason', 'lead_assigned_before_pool_enabled',
        'lead_id', p_lead_id
      );
    end if;

    if coalesce(v_pipeline.pool_max_redistributions, 3) > 0
       and p_expected_redistribution_count >= v_pipeline.pool_max_redistributions then
      return jsonb_build_object(
        'success', false,
        'skipped', true,
        'reason', 'pool_redistribution_limit_reached',
        'lead_id', p_lead_id
      );
    end if;

    if v_assignment_at >= p_now
      - make_interval(mins => greatest(coalesce(v_pipeline.pool_timeout_minutes, 10), 1)) then
      return jsonb_build_object(
        'success', false,
        'skipped', true,
        'reason', 'pool_timeout_not_reached',
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
      )
      into v_has_blocking_activity;
    end if;

    if not v_has_blocking_activity then
      select exists (
        select 1
        from public.whatsapp_messages as message
        where message.organization_id = p_organization_id
          and message.lead_id = p_lead_id
          and message.created_at >= v_assignment_at - interval '5 seconds'
          and (coalesce(message.from_me, false) = true or message.sender_user_id is not null)
      )
      into v_has_blocking_activity;
    end if;

    if v_has_blocking_activity then
      return jsonb_build_object(
        'success', false,
        'skipped', true,
        'reason', 'lead_has_activity_after_distribution',
        'lead_id', p_lead_id
      );
    end if;

    v_result := private.distribute_lead(
      p_organization_id,
      p_lead_id,
      p_idempotency_key,
      p_round_robin_id,
      false,
      'pool',
      p_now
    );

    if coalesce((v_result->>'success')::boolean, false) = false then
      return v_result;
    end if;
  end if;

  v_event_id := nullif(v_result->>'distribution_event_id', '')::uuid;
  v_assigned_user_id := nullif(v_result->>'assigned_user_id', '')::uuid;

  if v_event_id is null or v_assigned_user_id is null then
    raise exception using
      errcode = '55000',
      message = 'canonical_pool_distribution_result_incomplete';
  end if;

  if v_recover_existing then
    update public.leads as lead
    set redistribution_count = p_expected_redistribution_count + 1,
        last_redistributed_at = case
          when lead.last_redistributed_at is null
            or lead.last_redistributed_at < coalesce(v_existing_event.completed_at, p_now)
          then coalesce(v_existing_event.completed_at, p_now)
          else lead.last_redistributed_at
        end,
        redistribution_warning_sent_at = case
          when lead.assigned_user_id = v_assigned_user_id then null
          else lead.redistribution_warning_sent_at
        end,
        updated_at = clock_timestamp()
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id
      and coalesce(lead.redistribution_count, 0) = p_expected_redistribution_count;

    get diagnostics v_counter_rows = row_count;
    v_counter_applied := v_counter_rows > 0;

    if not v_counter_applied then
      select coalesce(lead.redistribution_count, 0) >=
        p_expected_redistribution_count + 1
      into v_counter_applied
      from public.leads as lead
      where lead.id = p_lead_id
        and lead.organization_id = p_organization_id;
    end if;

    if not coalesce(v_counter_applied, false) then
      raise exception using
        errcode = '40001',
        message = 'legacy_pool_counter_reconciliation_failed';
    end if;
  else
    update public.leads as lead
    set redistribution_count = coalesce(lead.redistribution_count, 0) + 1,
        last_redistributed_at = p_now,
        redistribution_warning_sent_at = null,
        updated_at = p_now
    where lead.id = p_lead_id
      and lead.organization_id = p_organization_id;

    v_counter_applied := true;
  end if;

  insert into public.lead_pool_history (
    id,
    lead_id,
    organization_id,
    from_user_id,
    to_user_id,
    reason,
    redistributed_at
  )
  values (
    v_event_id,
    p_lead_id,
    p_organization_id,
    p_expected_assigned_user_id,
    v_assigned_user_id,
    'timeout',
    coalesce(v_existing_event.completed_at, p_now)
  )
  on conflict (id) do nothing;

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
    v_event_id,
    p_organization_id,
    p_expected_assigned_user_id,
    p_lead_id,
    'lead_redistributed',
    'Lead redistribuído',
    'O lead "' || coalesce(nullif(v_lead.name, ''), 'sem nome')
      || '" foi redistribuído por inatividade.',
    false,
    jsonb_build_object(
      'event_key', 'lead_redistributed',
      'dedupe_key', 'lead_redistributed:' || v_event_id::text,
      'distribution_event_id', v_event_id,
      'from_user_id', p_expected_assigned_user_id,
      'to_user_id', v_assigned_user_id
    ),
    'in_app',
    '/crm/pipelines?lead=' || p_lead_id::text,
    coalesce(v_existing_event.completed_at, p_now)
  )
  on conflict do nothing;

  v_result := v_result || jsonb_build_object(
    'pool_finalized', true,
    'pool_counter_applied', v_counter_applied,
    'replayed', v_recover_existing,
    'from_user_id', p_expected_assigned_user_id,
    'to_user_id', v_assigned_user_id,
    'redistribution_count', p_expected_redistribution_count + 1
  );

  update private.lead_distribution_events as event
  set result = v_result
  where event.id = v_event_id
    and event.organization_id = p_organization_id
    and event.lead_id = p_lead_id;

  if not found then
    raise exception using
      errcode = '55000',
      message = 'canonical_pool_distribution_event_not_found';
  end if;

  return v_result;
end;
$$;

comment on function public.redistribute_lead_from_pool_backend(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  timestamptz,
  integer,
  timestamptz
) is
  'Backend-only atomic pool redistribution through private.distribute_lead, including counter, history and former-owner notification.';

revoke all on function public.redistribute_lead_from_pool_backend(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  timestamptz,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.redistribute_lead_from_pool_backend(
  uuid,
  uuid,
  text,
  uuid,
  uuid,
  timestamptz,
  integer,
  timestamptz
) to service_role;
