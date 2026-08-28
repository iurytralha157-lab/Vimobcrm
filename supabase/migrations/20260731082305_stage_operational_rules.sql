-- Canonical operational rules for pipeline stages.
--
-- Safe rollout principles:
--   * cadence is opt-in per stage;
--   * only explicit template tasks create obligations;
--   * task timing is stored in minutes;
--   * stage exits preserve an auditable task outcome;
--   * terminal deals close obligations and reopening starts fresh cycles.

alter table public.stage_operational_configs
  add column if not exists cadence_enabled boolean not null default false,
  add column if not exists revision bigint not null default 0,
  add column if not exists attention_mode text not null default 'disabled',
  add column if not exists first_outreach_minutes integer,
  add column if not exists first_effective_contact_minutes integer,
  add column if not exists stage_inactivity_minutes integer,
  add column if not exists stage_max_age_minutes integer,
  add column if not exists warning_minutes integer not null default 0,
  add column if not exists escalation_minutes integer,
  add column if not exists business_hours_only boolean not null default false;

alter table public.stage_operational_configs
  drop constraint if exists stage_operational_configs_attention_mode_check,
  drop constraint if exists stage_operational_configs_first_outreach_check,
  drop constraint if exists stage_operational_configs_first_effective_contact_check,
  drop constraint if exists stage_operational_configs_stage_inactivity_check,
  drop constraint if exists stage_operational_configs_stage_max_age_check,
  drop constraint if exists stage_operational_configs_warning_check,
  drop constraint if exists stage_operational_configs_escalation_check,
  drop constraint if exists stage_operational_configs_warning_coherence_check;

alter table public.stage_operational_configs
  add constraint stage_operational_configs_attention_mode_check
    check (attention_mode in ('disabled', 'shadow', 'enabled')),
  add constraint stage_operational_configs_first_outreach_check
    check (first_outreach_minutes is null or first_outreach_minutes > 0),
  add constraint stage_operational_configs_first_effective_contact_check
    check (first_effective_contact_minutes is null or first_effective_contact_minutes > 0),
  add constraint stage_operational_configs_stage_inactivity_check
    check (stage_inactivity_minutes is null or stage_inactivity_minutes > 0),
  add constraint stage_operational_configs_stage_max_age_check
    check (stage_max_age_minutes is null or stage_max_age_minutes > 0),
  add constraint stage_operational_configs_warning_check
    check (warning_minutes >= 0),
  add constraint stage_operational_configs_escalation_check
    check (escalation_minutes is null or escalation_minutes > 0),
  add constraint stage_operational_configs_warning_coherence_check
    check (
      warning_minutes = 0
      or (
        (first_outreach_minutes is null or warning_minutes < first_outreach_minutes)
        and (
          first_effective_contact_minutes is null
          or warning_minutes < first_effective_contact_minutes
        )
        and (
          stage_inactivity_minutes is null
          or warning_minutes < stage_inactivity_minutes
        )
        and (stage_max_age_minutes is null or warning_minutes < stage_max_age_minutes)
      )
    );

comment on column public.stage_operational_configs.cadence_enabled is
  'Explicit opt-in. A stage without this flag never materializes cadence obligations.';
comment on column public.stage_operational_configs.revision is
  'Monotonic optimistic-concurrency token for manager edits.';
comment on column public.stage_operational_configs.attention_mode is
  'Operational attention rollout mode: disabled, shadow, or enabled.';

-- Legacy leads keep their immutable attention enrollment marker, but a fresh
-- stage cycle governed by the new operational rules must still record human
-- work. Otherwise a call/message could never satisfy first-contact or reset
-- inactivity for those leads.
create or replace function private.record_lead_action_fact(
  p_organization_id uuid,
  p_lead_id uuid,
  p_actor_user_id uuid,
  p_action_type text,
  p_channel text,
  p_occurred_at timestamptz,
  p_is_automated boolean,
  p_is_inbound boolean,
  p_qualifies_first_outreach boolean,
  p_qualifies_stage_inactivity boolean,
  p_is_effective_contact boolean,
  p_source_type text,
  p_source_id text,
  p_metadata jsonb
)
returns void
language plpgsql
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  current_assignment_cycle_id uuid;
  current_stage_cycle_id uuid;
begin
  -- Hold a compatible lock until the fact is recorded. A concurrent stage
  -- move/reassignment must not let the activity read one cycle and be stored
  -- against another.
  perform 1
  from public.leads lead
  left join public.stage_operational_configs rule
    on rule.organization_id = lead.organization_id
   and rule.stage_id = lead.stage_id
  where lead.id = p_lead_id
    and lead.organization_id = p_organization_id
    and (
      lead.attention_eligible = true
      or (
        lead.deal_status = 'open'
        and coalesce(rule.config->>'operational_rules_version', '') = '1'
        and (
          coalesce(rule.cadence_enabled, false)
          or (
            coalesce(
              nullif(rule.config->>'attention_source_mode', ''),
              case
                when rule.attention_mode = 'disabled' then 'inherit'
                else 'local'
              end
            ) = 'local'
            and rule.attention_mode in ('shadow', 'enabled')
          )
        )
      )
    )
  for share of lead;

  if not found then
    return;
  end if;

  select id into current_assignment_cycle_id
  from public.lead_assignment_cycles
  where organization_id = p_organization_id
    and lead_id = p_lead_id
    and ended_at is null
  order by assigned_at desc, id desc
  limit 1;

  select id into current_stage_cycle_id
  from public.lead_stage_cycles
  where organization_id = p_organization_id
    and lead_id = p_lead_id
    and exited_at is null
  order by entered_at desc, id desc
  limit 1;

  insert into public.lead_action_facts (
    organization_id, lead_id, actor_user_id, assignment_cycle_id, stage_cycle_id,
    action_type, channel, occurred_at, is_automated, is_inbound,
    qualifies_first_outreach, qualifies_stage_inactivity, is_effective_contact,
    source_type, source_id, metadata
  ) values (
    p_organization_id, p_lead_id, p_actor_user_id, current_assignment_cycle_id, current_stage_cycle_id,
    btrim(p_action_type), nullif(btrim(coalesce(p_channel, '')), ''), coalesce(p_occurred_at, now()),
    coalesce(p_is_automated, false), coalesce(p_is_inbound, false),
    coalesce(p_qualifies_first_outreach, false), coalesce(p_qualifies_stage_inactivity, false),
    coalesce(p_is_effective_contact, false), btrim(p_source_type), nullif(btrim(coalesce(p_source_id, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (organization_id, source_type, source_id)
    where source_id is not null
  do nothing;
end;
$$;

alter function private.record_lead_action_fact(
  uuid, uuid, uuid, text, text, timestamptz, boolean, boolean,
  boolean, boolean, boolean, text, text, jsonb
) owner to postgres;
revoke all on function private.record_lead_action_fact(
  uuid, uuid, uuid, text, text, timestamptz, boolean, boolean,
  boolean, boolean, boolean, text, text, jsonb
) from public, anon, authenticated;
grant execute on function private.record_lead_action_fact(
  uuid, uuid, uuid, text, text, timestamptz, boolean, boolean,
  boolean, boolean, boolean, text, text, jsonb
) to service_role;

alter table public.cadence_tasks_template
  add column if not exists due_minutes integer,
  add column if not exists warning_minutes integer not null default 0,
  add column if not exists is_required boolean not null default true,
  add column if not exists outcome_required boolean not null default false;

update public.cadence_tasks_template
set due_minutes = greatest(0, coalesce(delay_days, 0)) * 1440
where due_minutes is null;

alter table public.cadence_tasks_template
  alter column due_minutes set default 0,
  alter column due_minutes set not null;

alter table public.cadence_tasks_template
  drop constraint if exists cadence_tasks_template_due_minutes_check,
  drop constraint if exists cadence_tasks_template_warning_minutes_check,
  drop constraint if exists cadence_tasks_template_warning_coherence_check;

alter table public.cadence_tasks_template
  add constraint cadence_tasks_template_due_minutes_check
    check (due_minutes >= 0),
  add constraint cadence_tasks_template_warning_minutes_check
    check (warning_minutes >= 0),
  add constraint cadence_tasks_template_warning_coherence_check
    check (warning_minutes = 0 or warning_minutes < due_minutes);

comment on column public.cadence_tasks_template.due_minutes is
  'Canonical deadline offset, in minutes from stage-cycle enrollment.';
comment on column public.cadence_tasks_template.is_required is
  'Required pending tasks are preserved as skipped when the lead leaves the stage.';
comment on column public.cadence_tasks_template.outcome_required is
  'Whether completion must capture an operational outcome.';

-- Empty templates must remain empty. Retire the compatibility trigger that
-- manufactured one artificial call task after an empty enrollment completed.
drop trigger if exists trg_ensure_completed_cadence_has_obligation
  on public.cadence_enrollments;

comment on function private.ensure_cadence_default_task(uuid) is
  'Deprecated compatibility function. Stage operational rules never create artificial default tasks.';

-- Preserve completed history but retire outstanding artificial obligations.
update public.lead_tasks
set status = 'cancelled',
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'cancel_reason', 'default_obligation_retired',
      'lifecycle_outcome', 'artificial_task_cancelled',
      'cancelled_at', now()
    )
where status = 'pending'
  and coalesce(is_done, false) = false
  and metadata->>'source' = 'cadence_default';

update public.cadence_enrollments ce
set status = 'completed',
    completed_at = coalesce(ce.completed_at, now()),
    updated_at = now(),
    metadata = coalesce(ce.metadata, '{}'::jsonb) || jsonb_build_object(
      'empty_template', true,
      'default_obligation_retired_at', now()
    )
where ce.status in ('active', 'paused')
  and not exists (
    select 1
    from public.lead_tasks lt
    where lt.cadence_enrollment_id = ce.id
      and lt.cadence_template_task_id is not null
  );

-- A legacy template is not proof that every compatible stage opted into
-- automatic obligations. Keep legacy configs disabled until a manager saves
-- the new stage rule explicitly. Reapplying this migration remains safe because
-- configs already saved by the new flow carry operational_rules_version=1.
update public.stage_operational_configs
set cadence_enabled = false,
    updated_at = now()
where coalesce(config->>'operational_rules_version', '') <> '1'
  and cadence_enabled is distinct from false;

-- The legacy operational trigger shares this table. A cadence/attention-only
-- config has no operational requests, so it must not manufacture a generic
-- "Gatilho Ativado" timeline entry every time a lead changes stage.
create or replace function public.execute_stage_operational_actions()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public', 'private', 'extensions', 'pg_temp'
as $$
declare
  v_config public.stage_operational_configs%rowtype;
  v_request_item jsonb;
begin
  select *
  into v_config
  from public.stage_operational_configs
  where stage_id = new.stage_id
    and organization_id = new.organization_id;

  if v_config.id is null
     or jsonb_typeof(coalesce(v_config.automatic_operational_requests, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(v_config.automatic_operational_requests, '[]'::jsonb)) = 0 then
    return new;
  end if;

  for v_request_item in
    select *
    from jsonb_array_elements(v_config.automatic_operational_requests)
  loop
    insert into public.operational_requests (
      organization_id,
      lead_id,
      type,
      title,
      description,
      priority,
      due_date
    )
    values (
      new.organization_id,
      new.id,
      coalesce(v_request_item->>'type', v_config.operation_context),
      v_request_item->>'title',
      v_request_item->>'description',
      coalesce(v_request_item->>'priority', 'medium'),
      now() + (
        coalesce((v_request_item->>'due_days')::integer, 1)
        * interval '1 day'
      )
    );
  end loop;

  insert into public.operational_timelines (
    organization_id,
    lead_id,
    event_type,
    title,
    description
  )
  values (
    new.organization_id,
    new.id,
    'stage_operational_entry',
    'Gatilho Ativado: ' || v_config.operation_context,
    'Lead movido para ' || (
      select name
      from public.stages
      where id = new.stage_id
    )
  );

  return new;
end;
$$;

alter function public.execute_stage_operational_actions()
  owner to postgres;

create or replace function private.materialize_cadence_for_stage_cycle(
  p_stage_cycle_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cycle record;
  target_template record;
  enrollment_id uuid;
  task_snapshot jsonb;
begin
  select
    sc.id as stage_cycle_id,
    sc.organization_id,
    sc.lead_id,
    sc.pipeline_id,
    sc.stage_id,
    sc.entered_at,
    sc.metadata as stage_cycle_metadata,
    l.assigned_user_id,
    l.deal_status,
    stage.stage_key,
    stage.name as stage_name,
    rule.id as operational_rule_id,
    rule.config as operational_rule_config,
    rule.attention_mode,
    rule.first_outreach_minutes,
    rule.first_effective_contact_minutes,
    rule.stage_inactivity_minutes,
    rule.stage_max_age_minutes,
    rule.warning_minutes as stage_warning_minutes,
    rule.escalation_minutes,
    rule.business_hours_only
  into target_cycle
  from public.lead_stage_cycles sc
  join public.leads l
    on l.id = sc.lead_id
   and l.organization_id = sc.organization_id
  join public.stages stage
    on stage.id = sc.stage_id
   and stage.organization_id = sc.organization_id
  join public.stage_operational_configs rule
    on rule.organization_id = sc.organization_id
   and rule.stage_id = sc.stage_id
   and rule.cadence_enabled = true
  where sc.id = p_stage_cycle_id
    and sc.exited_at is null
    and l.deal_status = 'open'
  for share of stage, rule;

  if not found then
    return null;
  end if;

  -- A reconstructed historical baseline exists to make the timeline coherent,
  -- not to create a backlog of retroactive broker obligations.
  if coalesce(
    case lower(nullif(target_cycle.stage_cycle_metadata->>'historical_backfill', ''))
      when 'true' then true
      when 'false' then false
      else null
    end,
    false
  ) then
    return null;
  end if;

  select enrollment.id
  into enrollment_id
  from public.cadence_enrollments enrollment
  where enrollment.organization_id = target_cycle.organization_id
    and enrollment.lead_id = target_cycle.lead_id
    and enrollment.stage_cycle_id = target_cycle.stage_cycle_id
    and (
      enrollment.status = 'active'
      or (
        enrollment.status = 'completed'
        and (
          case
            when jsonb_typeof(enrollment.template_snapshot->'tasks') = 'array'
              then jsonb_array_length(enrollment.template_snapshot->'tasks') > 0
            else false
          end
          or coalesce(
            enrollment.metadata->>'has_materialized_obligations',
            'false'
          ) = 'true'
          or exists (
            select 1
            from public.lead_tasks completed_task
            where completed_task.cadence_enrollment_id = enrollment.id
              and (
                completed_task.metadata ? 'template_task_snapshot'
                or completed_task.metadata->>'source' = 'cadence'
              )
          )
        )
      )
    )
  order by
    case enrollment.status when 'active' then 0 else 1 end,
    enrollment.started_at desc,
    enrollment.id desc
  limit 1;

  if found then
    return enrollment_id;
  end if;

  select template.*
  into target_template
  from public.cadence_templates template
  where template.organization_id = target_cycle.organization_id
    and template.is_active = true
    and (
      (
        coalesce(target_cycle.operational_rule_config->>'operational_rules_version', '') = '1'
        and template.id = case
          when coalesce(target_cycle.operational_rule_config->>'cadence_template_id', '') ~*
            '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
            then (target_cycle.operational_rule_config->>'cadence_template_id')::uuid
          else null
        end
        and template.stage_id = target_cycle.stage_id
      )
      or (
        coalesce(target_cycle.operational_rule_config->>'operational_rules_version', '') <> '1'
        and (
          template.stage_id = target_cycle.stage_id
          or (
            template.stage_id is null
            and template.pipeline_id = target_cycle.pipeline_id
            and template.stage_key = target_cycle.stage_key
          )
          or (
            template.pipeline_id is null
            and template.stage_id is null
            and template.stage_key = target_cycle.stage_key
          )
        )
      )
    )
    and exists (
      select 1
      from public.cadence_tasks_template task
      where task.organization_id = target_cycle.organization_id
        and task.cadence_template_id = template.id
    )
  order by
    (
      template.id::text =
      nullif(target_cycle.operational_rule_config->>'cadence_template_id', '')
    ) desc,
    case
      when template.stage_id = target_cycle.stage_id then 3
      when template.pipeline_id = target_cycle.pipeline_id then 2
      else 1
    end desc,
    template.updated_at desc,
    template.id
  limit 1;

  if not found then
    return null;
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', task.id,
      'position', task.position,
      'title', task.title,
      'description', task.description,
      'type', task.type,
      'observation', task.observation,
      'recommended_message', task.recommended_message,
      'message_template', task.message_template,
      'due_minutes', task.due_minutes,
      'warning_minutes', task.warning_minutes,
      'is_required', task.is_required,
      'outcome_required', task.outcome_required,
      'metadata', task.metadata
    )
    order by task.position, task.id
  )
  into task_snapshot
  from public.cadence_tasks_template task
  where task.organization_id = target_cycle.organization_id
    and task.cadence_template_id = target_template.id;

  update public.cadence_enrollments
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'cadence_replaced',
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'cadence_replaced',
        'cancelled_at', now()
      )
  where lead_id = target_cycle.lead_id
    and status = 'active';

  insert into public.cadence_enrollments (
    organization_id,
    lead_id,
    cadence_template_id,
    stage_cycle_id,
    assigned_user_id,
    started_at,
    template_snapshot,
    metadata
  ) values (
    target_cycle.organization_id,
    target_cycle.lead_id,
    target_template.id,
    target_cycle.stage_cycle_id,
    target_cycle.assigned_user_id,
    target_cycle.entered_at,
    jsonb_build_object(
      'schema_version', 2,
      'captured_at', now(),
      'template', jsonb_build_object(
        'id', target_template.id,
        'name', target_template.name,
        'description', target_template.description,
        'pipeline_id', target_template.pipeline_id,
        'stage_id', target_template.stage_id,
        'stage_key', target_template.stage_key,
        'is_active', target_template.is_active
      ),
      'operational_rule', jsonb_build_object(
        'id', target_cycle.operational_rule_id,
        'stage_id', target_cycle.stage_id,
        'cadence_enabled', true,
        'attention_mode', target_cycle.attention_mode,
        'first_outreach_minutes', target_cycle.first_outreach_minutes,
        'first_effective_contact_minutes', target_cycle.first_effective_contact_minutes,
        'stage_inactivity_minutes', target_cycle.stage_inactivity_minutes,
        'stage_max_age_minutes', target_cycle.stage_max_age_minutes,
        'warning_minutes', target_cycle.stage_warning_minutes,
        'escalation_minutes', target_cycle.escalation_minutes,
        'business_hours_only', target_cycle.business_hours_only
      ),
      'tasks', task_snapshot
    ),
    jsonb_build_object(
      'source', 'stage_cycle',
      'stage_name', target_cycle.stage_name,
      'operational_rule_id', target_cycle.operational_rule_id,
      'historical_backfill', coalesce(
        target_cycle.stage_cycle_metadata->'historical_backfill',
        'false'::jsonb
      ),
      'has_materialized_obligations', true,
      'materialized_task_count', jsonb_array_length(task_snapshot)
    )
  )
  on conflict (stage_cycle_id)
    where stage_cycle_id is not null and status = 'active'
  do update
    set assigned_user_id = excluded.assigned_user_id,
        updated_at = now()
  returning id into enrollment_id;

  insert into public.lead_tasks (
    organization_id,
    lead_id,
    assigned_user_id,
    title,
    description,
    type,
    day_offset,
    due_at,
    due_date,
    is_done,
    status,
    sequence,
    cadence_enrollment_id,
    cadence_template_task_id,
    metadata
  )
  select
    target_cycle.organization_id,
    target_cycle.lead_id,
    target_cycle.assigned_user_id,
    task.title,
    coalesce(nullif(task.description, ''), nullif(task.metadata->>'description', '')),
    coalesce(nullif(task.type, ''), 'call'),
    task.due_minutes / 1440,
    target_cycle.entered_at + make_interval(mins => task.due_minutes),
    (target_cycle.entered_at + make_interval(mins => task.due_minutes))::date,
    false,
    'pending',
    task.position,
    enrollment_id,
    task.id,
    coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'cadence',
      'cadence_template_id', target_template.id,
      'due_minutes', task.due_minutes,
      'warning_minutes', task.warning_minutes,
      'is_required', task.is_required,
      'outcome_required', task.outcome_required,
      'warning_at', case
        when task.warning_minutes > 0
          then target_cycle.entered_at
            + make_interval(mins => task.due_minutes - task.warning_minutes)
        else null
      end,
      'message_template', coalesce(task.message_template, task.recommended_message),
      'template_task_snapshot', jsonb_build_object(
        'id', task.id,
        'position', task.position,
        'title', task.title,
        'description', task.description,
        'type', task.type,
        'observation', task.observation,
        'recommended_message', task.recommended_message,
        'message_template', task.message_template,
        'due_minutes', task.due_minutes,
        'warning_minutes', task.warning_minutes,
        'is_required', task.is_required,
        'outcome_required', task.outcome_required
      )
    )
  from public.cadence_tasks_template task
  where task.organization_id = target_cycle.organization_id
    and task.cadence_template_id = target_template.id
  on conflict (cadence_enrollment_id, cadence_template_task_id)
    where cadence_enrollment_id is not null
      and cadence_template_task_id is not null
  do nothing;

  return enrollment_id;
end;
$$;

alter function private.materialize_cadence_for_stage_cycle(uuid)
  owner to postgres;
revoke all on function private.materialize_cadence_for_stage_cycle(uuid)
  from public, anon, authenticated;

-- Serialize final-task checks on the enrollment. Without this lock, two
-- different tasks completed concurrently can both observe the sibling as
-- pending and leave the enrollment active forever.
create or replace function private.finish_cadence_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_enrollment_id uuid;
begin
  if new.cadence_enrollment_id is not null and new.status = 'completed' then
    select enrollment.id
    into locked_enrollment_id
    from public.cadence_enrollments enrollment
    where enrollment.id = new.cadence_enrollment_id
    for update;

    if found then
      update public.cadence_enrollments enrollment
      set status = 'completed',
          completed_at = coalesce(enrollment.completed_at, now()),
          updated_at = now()
      where enrollment.id = locked_enrollment_id
        and enrollment.status = 'active'
        and not exists (
          select 1
          from public.lead_tasks task
          where task.cadence_enrollment_id = enrollment.id
            and task.id <> new.id
            and task.status = 'pending'
            and task.is_done = false
        );
    end if;
  end if;
  return new;
end;
$$;

alter function private.finish_cadence_enrollment()
  owner to postgres;
revoke all on function private.finish_cadence_enrollment()
  from public, anon, authenticated;

create or replace function private.sync_cadence_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  exit_reason text;
  terminal_exit boolean;
begin
  if tg_op = 'INSERT' then
    perform private.materialize_cadence_for_stage_cycle(new.id);
    return new;
  end if;

  if new.exited_at is null or old.exited_at is not null then
    return new;
  end if;

  exit_reason := coalesce(new.exited_reason, 'stage_changed');
  terminal_exit := exit_reason in ('won', 'lost');

  update public.lead_tasks task
  set status = case
        when terminal_exit then 'cancelled'
        when lower(coalesce(task.metadata->>'is_required', 'true'))
          not in ('false', 'f', '0', 'no', 'off') then 'skipped'
        else 'cancelled'
      end,
      updated_at = now(),
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', exit_reason,
        'stage_cycle_id', new.id,
        'stage_exited_at', new.exited_at,
        'lifecycle_outcome', case
          when terminal_exit then 'terminal_deal_cancelled'
          when lower(coalesce(task.metadata->>'is_required', 'true'))
            not in ('false', 'f', '0', 'no', 'off')
            then 'required_task_skipped'
          else 'optional_task_cancelled'
        end
      )
  where task.cadence_enrollment_id in (
      select enrollment.id
      from public.cadence_enrollments enrollment
      where enrollment.stage_cycle_id = new.id
    )
    and task.status = 'pending'
    and task.is_done = false;

  update public.cadence_enrollments enrollment
  set status = 'cancelled',
      cancelled_at = new.exited_at,
      cancel_reason = exit_reason,
      updated_at = now(),
      metadata = coalesce(enrollment.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', exit_reason,
        'stage_cycle_id', new.id,
        'stage_exited_at', new.exited_at,
        'has_skipped_required_tasks', exists (
          select 1
          from public.lead_tasks task
          where task.cadence_enrollment_id = enrollment.id
            and task.status = 'skipped'
        )
      )
  where enrollment.stage_cycle_id = new.id
    and enrollment.status in ('active', 'paused');

  return new;
end;
$$;

alter function private.sync_cadence_lifecycle()
  owner to postgres;
revoke all on function private.sync_cadence_lifecycle()
  from public, anon, authenticated;

create or replace function private.capture_activity_attention_fact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_type text := lower(btrim(coalesce(new.type, '')));
  normalized_task_type text := lower(btrim(coalesce(new.metadata->>'task_type', '')));
  automated boolean := private.attention_metadata_is_automated(new.metadata);
  outcome text := lower(btrim(coalesce(new.metadata->>'outcome', '')));
  qualifies_outreach boolean;
  qualifies_inactivity boolean;
  effective boolean;
  action_channel text;
begin
  qualifies_outreach := not automated and (
    normalized_type in ('call', 'email', 'email_sent', 'message', 'whatsapp')
    or (
      normalized_type = 'task_completed'
      and normalized_task_type in ('call', 'message', 'email')
    )
  );
  qualifies_inactivity := not automated and normalized_type in (
    'call',
    'email',
    'email_sent',
    'message',
    'whatsapp',
    'task_completed',
    'feedback',
    'feedback_added',
    'note'
  );
  effective := outcome in (
    'efetivo',
    'contato efetivo',
    'connected',
    'answered',
    'atendeu',
    'respondeu',
    'replied',
    'scheduled'
  );
  action_channel := coalesce(
    nullif(new.metadata->>'channel', ''),
    case
      when normalized_type like 'email%' then 'email'
      when normalized_type = 'call' then 'phone'
      when normalized_type in ('message', 'whatsapp') then normalized_type
      when normalized_type = 'task_completed' and normalized_task_type = 'call' then 'phone'
      when normalized_type = 'task_completed' then nullif(normalized_task_type, '')
      else null
    end
  );

  perform private.record_lead_action_fact(
    new.organization_id,
    new.lead_id,
    new.user_id,
    normalized_type,
    action_channel,
    new.created_at,
    automated,
    false,
    qualifies_outreach,
    qualifies_inactivity,
    effective,
    'activity',
    new.id::text,
    new.metadata || jsonb_build_object('content', new.content)
  );
  return null;
end;
$$;

alter function private.capture_activity_attention_fact()
  owner to postgres;
revoke all on function private.capture_activity_attention_fact()
  from public, anon, authenticated;

create or replace function private.sync_lead_cadence_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_user_id is distinct from old.assigned_user_id then
    update public.lead_tasks task
    set assigned_user_id = new.assigned_user_id,
        updated_at = now(),
        metadata = jsonb_set(
          coalesce(task.metadata, '{}'::jsonb),
          '{assignment_transfers}',
          (
            case
              when jsonb_typeof(task.metadata->'assignment_transfers') = 'array'
                then task.metadata->'assignment_transfers'
              else '[]'::jsonb
            end
          ) || jsonb_build_array(jsonb_build_object(
            'from', task.assigned_user_id,
            'to', new.assigned_user_id,
            'at', now(),
            'source', 'lead_reassignment'
          )),
          true
        )
    where task.organization_id = new.organization_id
      and task.lead_id = new.id
      and coalesce(
        task.status,
        case when coalesce(task.is_done, false) then 'completed' else 'pending' end
      ) = 'pending'
      and coalesce(task.is_done, false) = false;

    update public.cadence_enrollments enrollment
    set assigned_user_id = new.assigned_user_id,
        updated_at = now(),
        metadata = jsonb_set(
          coalesce(enrollment.metadata, '{}'::jsonb),
          '{assignment_transfers}',
          (
            case
              when jsonb_typeof(enrollment.metadata->'assignment_transfers') = 'array'
                then enrollment.metadata->'assignment_transfers'
              else '[]'::jsonb
            end
          ) || jsonb_build_array(jsonb_build_object(
            'from', old.assigned_user_id,
            'to', new.assigned_user_id,
            'at', now(),
            'source', 'lead_reassignment'
          )),
          true
        )
    where enrollment.organization_id = new.organization_id
      and enrollment.lead_id = new.id
      and enrollment.status = 'active';
  end if;

  return new;
end;
$$;

alter function private.sync_lead_cadence_assignee()
  owner to postgres;
revoke all on function private.sync_lead_cadence_assignee()
  from public, anon, authenticated;

create or replace function private.capture_lead_cycles()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_cycle integer;
  old_assignment_cycle_id uuid;
  old_stage_cycle_id uuid;
  reopened boolean := false;
  terminal_transition boolean := false;
  assignment_cycle_needed boolean;
  stage_cycle_needed boolean;
begin
  if tg_op = 'INSERT' then
    assignment_cycle_needed := true;
    stage_cycle_needed := true;
  else
    reopened := old.deal_status in ('won', 'lost')
      and new.deal_status = 'open';
    terminal_transition := new.deal_status in ('won', 'lost')
      and new.deal_status is distinct from old.deal_status;
    assignment_cycle_needed := reopened
      or new.assigned_user_id is distinct from old.assigned_user_id
      or (
        new.deal_status = 'open'
        and new.assigned_user_id is not null
        and (
          new.stage_id is distinct from old.stage_id
          or new.pipeline_id is distinct from old.pipeline_id
        )
        and not exists (
          select 1
          from public.lead_assignment_cycles current_assignment
          where current_assignment.organization_id = new.organization_id
            and current_assignment.lead_id = new.id
            and current_assignment.ended_at is null
        )
      );
    stage_cycle_needed := reopened
      or new.stage_id is distinct from old.stage_id
      or new.pipeline_id is distinct from old.pipeline_id;
  end if;

  if assignment_cycle_needed then
    if tg_op = 'UPDATE' then
      update public.lead_assignment_cycles
      set ended_at = now(),
          ended_reason = case
            when terminal_transition then new.deal_status
            when reopened then 'deal_reopened'
            when new.assigned_user_id is null then 'unassigned'
            else 'reassigned'
          end
      where lead_id = new.id
        and ended_at is null
      returning id into old_assignment_cycle_id;

      if old_assignment_cycle_id is not null then
        with redistributed as (
          update public.lead_attention_instances instance
          set status = 'redistributed',
              redistributed_at = now(),
              resolved_at = now(),
              resolved_reason = 'auto_redistributed',
              next_evaluation_at = now()
          where instance.assignment_cycle_id = old_assignment_cycle_id
            and instance.status not in ('resolved', 'redistributed', 'cancelled')
            and exists (
              select 1
              from public.lead_redistribution_jobs job
              where job.organization_id = new.organization_id
                and job.lead_id = new.id
                and job.status in ('pending', 'warning_sent')
                and job.metadata->>'attention_instance_id' = instance.id::text
            )
          returning instance.organization_id, instance.id, instance.lead_id
        )
        insert into public.lead_attention_events (
          organization_id,
          instance_id,
          lead_id,
          event_type,
          metadata
        )
        select
          organization_id,
          id,
          lead_id,
          'redistributed',
          jsonb_build_object('source', 'assignment_cycle_trigger')
        from redistributed;

        update public.lead_attention_instances
        set status = 'cancelled',
            resolved_at = now(),
            resolved_reason = case
              when terminal_transition then new.deal_status
              when reopened then 'deal_reopened'
              when new.assigned_user_id is null then 'unassigned'
              else 'reassigned'
            end,
            next_evaluation_at = now()
        where assignment_cycle_id = old_assignment_cycle_id
          and status not in ('resolved', 'redistributed', 'cancelled');
      end if;
    end if;

    if new.deal_status = 'open' and new.assigned_user_id is not null then
      select coalesce(max(cycle_number), 0) + 1
      into next_cycle
      from public.lead_assignment_cycles
      where lead_id = new.id;

      insert into public.lead_assignment_cycles (
        organization_id,
        lead_id,
        assigned_user_id,
        cycle_number,
        assigned_at,
        metadata
      ) values (
        new.organization_id,
        new.id,
        new.assigned_user_id,
        next_cycle,
        case
          when reopened then now()
          else coalesce(new.assigned_at, now())
        end,
        jsonb_build_object(
          'source',
          case when reopened then 'deal_reopened' else 'lead_change' end
        )
      );
    end if;

  end if;

  if stage_cycle_needed then
    if tg_op = 'UPDATE' then
      update public.lead_stage_cycles
      set exited_at = now(),
          exited_reason = case
            when terminal_transition then new.deal_status
            when reopened then 'deal_reopened'
            else 'stage_changed'
          end
      where lead_id = new.id
        and exited_at is null
      returning id into old_stage_cycle_id;

      if old_stage_cycle_id is not null then
        update public.lead_attention_instances
        set status = 'resolved',
            resolved_at = now(),
            resolved_reason = case
              when terminal_transition then new.deal_status
              when reopened then 'deal_reopened'
              else 'stage_changed'
            end,
            next_evaluation_at = now()
        where stage_cycle_id = old_stage_cycle_id
          and status not in ('resolved', 'redistributed', 'cancelled');
      end if;
    end if;

    if new.deal_status = 'open'
       and new.pipeline_id is not null
       and new.stage_id is not null then
      select coalesce(max(cycle_number), 0) + 1
      into next_cycle
      from public.lead_stage_cycles
      where lead_id = new.id;

      insert into public.lead_stage_cycles (
        organization_id,
        lead_id,
        pipeline_id,
        stage_id,
        cycle_number,
        entered_at,
        baseline_confidence,
        metadata
      ) values (
        new.organization_id,
        new.id,
        new.pipeline_id,
        new.stage_id,
        next_cycle,
        case
          when reopened then now()
          else coalesce(new.stage_entered_at, now())
        end,
        'observed',
        jsonb_build_object(
          'source',
          case when reopened then 'deal_reopened' else 'lead_change' end
        )
      );
    end if;
  end if;

  if new.deal_status in ('won', 'lost')
     and (tg_op = 'INSERT' or terminal_transition) then
    update public.lead_assignment_cycles
    set ended_at = coalesce(ended_at, now()),
        ended_reason = new.deal_status
    where lead_id = new.id
      and ended_at is null;

    update public.lead_stage_cycles
    set exited_at = coalesce(exited_at, now()),
        exited_reason = new.deal_status
    where lead_id = new.id
      and exited_at is null;

    update public.lead_attention_instances
    set status = 'resolved',
        resolved_at = now(),
        resolved_reason = new.deal_status,
        next_evaluation_at = now()
    where lead_id = new.id
      and status not in ('resolved', 'redistributed', 'cancelled');
  end if;

  return null;
end;
$$;

alter function private.capture_lead_cycles()
  owner to postgres;
revoke all on function private.capture_lead_cycles()
  from public, anon, authenticated;

create or replace function private.switch_lead_cadence(
  p_organization_id uuid,
  p_lead_id uuid,
  p_cadence_template_id uuid,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_lead record;
  current_stage record;
  target_rule record;
  target_template record;
  enrollment_id uuid;
  task_snapshot jsonb;
  cadence_started_at timestamptz := now();
begin
  select lead.*
  into target_lead
  from public.leads lead
  where lead.organization_id = p_organization_id
    and lead.id = p_lead_id
  for update;

  if not found then
    raise exception 'cadence_lead_not_found';
  end if;

  if target_lead.deal_status <> 'open' then
    raise exception 'cadence_lead_not_open';
  end if;

  select
    cycle.id as stage_cycle_id,
    cycle.pipeline_id,
    cycle.stage_id,
    cycle.entered_at,
    cycle.metadata as stage_cycle_metadata,
    stage.stage_key,
    stage.name as stage_name
  into current_stage
  from public.lead_stage_cycles cycle
  join public.stages stage
    on stage.id = cycle.stage_id
   and stage.organization_id = cycle.organization_id
  where cycle.organization_id = p_organization_id
    and cycle.lead_id = p_lead_id
    and cycle.exited_at is null
    and cycle.pipeline_id = target_lead.pipeline_id
    and cycle.stage_id = target_lead.stage_id
  order by cycle.entered_at desc, cycle.id desc
  limit 1
  for share of stage;

  if not found then
    raise exception 'cadence_stage_cycle_not_found';
  end if;

  if coalesce(
    case lower(nullif(current_stage.stage_cycle_metadata->>'historical_backfill', ''))
      when 'true' then true
      when 'false' then false
      else null
    end,
    false
  ) then
    raise exception 'cadence_historical_cycle';
  end if;

  select rule.*
  into target_rule
  from public.stage_operational_configs rule
  where rule.organization_id = p_organization_id
    and rule.stage_id = current_stage.stage_id
  for share;

  if not found then
    raise exception 'cadence_stage_rule_disabled';
  end if;

  if target_rule.cadence_enabled is not true then
    raise exception 'cadence_stage_rule_disabled';
  end if;

  select template.*
  into target_template
  from public.cadence_templates template
  where template.organization_id = p_organization_id
    and template.id = p_cadence_template_id
    and template.is_active = true;

  if not found then
    raise exception 'cadence_template_not_found';
  end if;

  if not coalesce(
    target_template.stage_id = current_stage.stage_id
    or (
      target_template.stage_id is null
      and target_template.pipeline_id = current_stage.pipeline_id
      and target_template.stage_key = current_stage.stage_key
    )
    or (
      target_template.pipeline_id is null
      and target_template.stage_id is null
      and target_template.stage_key = current_stage.stage_key
    ),
    false
  ) then
    raise exception 'cadence_template_incompatible';
  end if;

  if not exists (
    select 1
    from public.cadence_tasks_template task
    where task.organization_id = p_organization_id
      and task.cadence_template_id = target_template.id
  ) then
    raise exception 'cadence_template_empty';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'id', task.id,
      'position', task.position,
      'title', task.title,
      'description', task.description,
      'type', task.type,
      'observation', task.observation,
      'recommended_message', task.recommended_message,
      'message_template', task.message_template,
      'due_minutes', task.due_minutes,
      'warning_minutes', task.warning_minutes,
      'is_required', task.is_required,
      'outcome_required', task.outcome_required,
      'metadata', task.metadata
    )
    order by task.position, task.id
  )
  into task_snapshot
  from public.cadence_tasks_template task
  where task.organization_id = p_organization_id
    and task.cadence_template_id = target_template.id;

  update public.lead_tasks task
  set status = 'cancelled',
      updated_at = now(),
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'cadence_switched',
        'lifecycle_outcome', 'cadence_switched',
        'cancelled_at', now(),
        'replacement_template_id', target_template.id
      )
  where task.lead_id = p_lead_id
    and task.status = 'pending'
    and task.is_done = false
    and task.cadence_enrollment_id in (
      select enrollment.id
      from public.cadence_enrollments enrollment
      where enrollment.lead_id = p_lead_id
        and enrollment.status = 'active'
    );

  update public.cadence_enrollments enrollment
  set status = 'cancelled',
      cancelled_at = now(),
      cancel_reason = 'cadence_switched',
      updated_at = now(),
      metadata = coalesce(enrollment.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancel_reason', 'cadence_switched',
        'cancelled_at', now(),
        'replacement_template_id', target_template.id,
        'actor_user_id', p_actor_user_id
      )
  where enrollment.lead_id = p_lead_id
    and enrollment.status = 'active';

  insert into public.cadence_enrollments (
    organization_id,
    lead_id,
    cadence_template_id,
    stage_cycle_id,
    assigned_user_id,
    started_at,
    template_snapshot,
    metadata
  ) values (
    p_organization_id,
    p_lead_id,
    target_template.id,
    current_stage.stage_cycle_id,
    target_lead.assigned_user_id,
    cadence_started_at,
    jsonb_build_object(
      'schema_version', 2,
      'captured_at', cadence_started_at,
      'template', jsonb_build_object(
        'id', target_template.id,
        'name', target_template.name,
        'description', target_template.description,
        'pipeline_id', target_template.pipeline_id,
        'stage_id', target_template.stage_id,
        'stage_key', target_template.stage_key,
        'is_active', target_template.is_active
      ),
      'operational_rule', jsonb_build_object(
        'id', target_rule.id,
        'stage_id', current_stage.stage_id,
        'cadence_enabled', target_rule.cadence_enabled,
        'attention_mode', target_rule.attention_mode,
        'first_outreach_minutes', target_rule.first_outreach_minutes,
        'first_effective_contact_minutes', target_rule.first_effective_contact_minutes,
        'stage_inactivity_minutes', target_rule.stage_inactivity_minutes,
        'stage_max_age_minutes', target_rule.stage_max_age_minutes,
        'warning_minutes', target_rule.warning_minutes,
        'escalation_minutes', target_rule.escalation_minutes,
        'business_hours_only', target_rule.business_hours_only
      ),
      'tasks', task_snapshot
    ),
    jsonb_build_object(
      'source', 'manual_switch',
      'actor_user_id', p_actor_user_id,
      'stage_name', current_stage.stage_name,
      'operational_rule_id', target_rule.id,
      'historical_backfill', coalesce(
        current_stage.stage_cycle_metadata->'historical_backfill',
        'false'::jsonb
      ),
      'has_materialized_obligations', true,
      'materialized_task_count', jsonb_array_length(task_snapshot)
    )
  )
  returning id into enrollment_id;

  insert into public.lead_tasks (
    organization_id,
    lead_id,
    assigned_user_id,
    title,
    description,
    type,
    day_offset,
    due_at,
    due_date,
    is_done,
    status,
    sequence,
    cadence_enrollment_id,
    cadence_template_task_id,
    metadata,
    created_by
  )
  select
    p_organization_id,
    p_lead_id,
    target_lead.assigned_user_id,
    task.title,
    coalesce(nullif(task.description, ''), nullif(task.metadata->>'description', '')),
    coalesce(nullif(task.type, ''), 'call'),
    task.due_minutes / 1440,
    cadence_started_at + make_interval(mins => task.due_minutes),
    (cadence_started_at + make_interval(mins => task.due_minutes))::date,
    false,
    'pending',
    task.position,
    enrollment_id,
    task.id,
    coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'cadence',
      'cadence_template_id', target_template.id,
      'due_minutes', task.due_minutes,
      'warning_minutes', task.warning_minutes,
      'is_required', task.is_required,
      'outcome_required', task.outcome_required,
      'warning_at', case
        when task.warning_minutes > 0
          then cadence_started_at
            + make_interval(mins => task.due_minutes - task.warning_minutes)
        else null
      end,
      'message_template', coalesce(task.message_template, task.recommended_message),
      'template_task_snapshot', jsonb_build_object(
        'id', task.id,
        'position', task.position,
        'title', task.title,
        'description', task.description,
        'type', task.type,
        'observation', task.observation,
        'recommended_message', task.recommended_message,
        'message_template', task.message_template,
        'due_minutes', task.due_minutes,
        'warning_minutes', task.warning_minutes,
        'is_required', task.is_required,
        'outcome_required', task.outcome_required
      )
    ),
    p_actor_user_id
  from public.cadence_tasks_template task
  where task.organization_id = p_organization_id
    and task.cadence_template_id = target_template.id;

  insert into public.activities (
    organization_id,
    lead_id,
    user_id,
    type,
    content,
    metadata
  ) values (
    p_organization_id,
    p_lead_id,
    p_actor_user_id,
    'cadence_switched',
    'Cadencia alterada para: ' || target_template.name,
    jsonb_build_object(
      'cadence_enrollment_id', enrollment_id,
      'cadence_template_id', target_template.id,
      'stage_cycle_id', current_stage.stage_cycle_id
    )
  );

  return enrollment_id;
end;
$$;

alter function private.switch_lead_cadence(uuid, uuid, uuid, uuid)
  owner to postgres;
revoke all on function private.switch_lead_cadence(uuid, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function private.switch_lead_cadence(uuid, uuid, uuid, uuid)
  to service_role;

alter table public.lead_attention_policies
  drop constraint if exists lead_attention_policies_type_check;

alter table public.lead_attention_policies
  add constraint lead_attention_policies_type_check
  check (
    policy_type in (
      'unassigned',
      'first_contact',
      'first_effective_contact',
      'stage_inactivity',
      'stage_age',
      'cadence_task'
    )
  );

-- Operational cadence state is backend-only. The public Data API keeps read
-- access, but authenticated clients cannot bypass validation, audit logging,
-- outcome requirements, lifecycle handling, or optimistic concurrency.
drop policy if exists "Pipeline managers can delete stage operational configs"
  on public.stage_operational_configs;
drop policy if exists "Pipeline managers can insert stage operational configs"
  on public.stage_operational_configs;
drop policy if exists "Pipeline managers can update stage operational configs"
  on public.stage_operational_configs;

drop policy if exists "vimob_canonical_8e8c0134351e57caa86628d4"
  on public.cadence_tasks_template;
drop policy if exists "vimob_canonical_a243a91f6d8c2b3d51720090"
  on public.cadence_tasks_template;
drop policy if exists "vimob_canonical_cfeb85b547fdf7c87400e7e1"
  on public.cadence_tasks_template;

drop policy if exists "vimob_operational_cadence_tasks_insert_guard"
  on public.lead_tasks;
create policy "vimob_operational_cadence_tasks_insert_guard"
  on public.lead_tasks
  as restrictive
  for insert
  to authenticated
  with check (cadence_enrollment_id is null);

drop policy if exists "vimob_operational_cadence_tasks_update_guard"
  on public.lead_tasks;
create policy "vimob_operational_cadence_tasks_update_guard"
  on public.lead_tasks
  as restrictive
  for update
  to authenticated
  using (cadence_enrollment_id is null)
  with check (cadence_enrollment_id is null);

drop policy if exists "vimob_operational_cadence_tasks_delete_guard"
  on public.lead_tasks;
create policy "vimob_operational_cadence_tasks_delete_guard"
  on public.lead_tasks
  as restrictive
  for delete
  to authenticated
  using (cadence_enrollment_id is null);
