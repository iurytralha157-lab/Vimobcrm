set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- ---------------------------------------------------------------------------
-- Round-robin: one canonical configuration and one enrollment path.
-- ---------------------------------------------------------------------------

alter table public.lead_redistribution_jobs
  drop constraint if exists lead_redistribution_jobs_max_attempts_check;
alter table public.lead_redistribution_jobs
  add constraint lead_redistribution_jobs_max_attempts_check check (max_attempts >= 0);

update public.round_robins rr
set target_pipeline_id = coalesce(rr.target_pipeline_id, rr.pipeline_id),
    pipeline_id = coalesce(rr.target_pipeline_id, rr.pipeline_id),
    target_stage_id = coalesce(
      rr.target_stage_id,
      case
        when coalesce(rr.rules->>'target_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          then (rr.rules->>'target_stage_id')::uuid
        else null
      end
    ),
    settings = case
      when coalesce(rr.settings, '{}'::jsonb) = '{}'::jsonb
        then coalesce(rr.rules->'settings', '{}'::jsonb)
      else rr.settings
    end,
    strategy = coalesce(nullif(rr.strategy, ''), nullif(rr.rules->>'strategy', ''), 'simple'),
    reentry_behavior = coalesce(nullif(rr.reentry_behavior, ''), nullif(rr.rules->>'reentry_behavior', ''), 'redistribute')
where rr.target_pipeline_id is null
   or rr.pipeline_id is null
   or rr.target_stage_id is null
   or coalesce(rr.settings, '{}'::jsonb) = '{}'::jsonb
   or nullif(rr.strategy, '') is null
   or nullif(rr.reentry_behavior, '') is null;

create or replace function private.sync_round_robin_contract()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rules_stage_id uuid;
begin
  new.rules := coalesce(new.rules, '{}'::jsonb);

  if coalesce(new.rules->>'target_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    rules_stage_id := (new.rules->>'target_stage_id')::uuid;
  end if;

  if tg_op = 'INSERT' then
    new.target_pipeline_id := coalesce(new.target_pipeline_id, new.pipeline_id);
    new.pipeline_id := coalesce(new.pipeline_id, new.target_pipeline_id);
    new.target_stage_id := coalesce(new.target_stage_id, rules_stage_id);
    new.settings := coalesce(nullif(new.settings, '{}'::jsonb), new.rules->'settings', '{}'::jsonb);
    new.strategy := coalesce(nullif(new.strategy, ''), nullif(new.rules->>'strategy', ''), 'simple');
    new.reentry_behavior := coalesce(nullif(new.reentry_behavior, ''), nullif(new.rules->>'reentry_behavior', ''), 'redistribute');
  else
    if new.rules is distinct from old.rules then
      if new.target_stage_id is not distinct from old.target_stage_id then
        new.target_stage_id := rules_stage_id;
      end if;
      if new.settings is not distinct from old.settings then
        new.settings := coalesce(new.rules->'settings', '{}'::jsonb);
      end if;
      if new.strategy is not distinct from old.strategy then
        new.strategy := coalesce(nullif(new.rules->>'strategy', ''), 'simple');
      end if;
      if new.reentry_behavior is not distinct from old.reentry_behavior then
        new.reentry_behavior := coalesce(nullif(new.rules->>'reentry_behavior', ''), 'redistribute');
      end if;
    end if;
    new.target_pipeline_id := coalesce(new.target_pipeline_id, new.pipeline_id);
    new.pipeline_id := coalesce(new.pipeline_id, new.target_pipeline_id);
    new.settings := coalesce(new.settings, '{}'::jsonb);
    new.strategy := coalesce(nullif(new.strategy, ''), 'simple');
    new.reentry_behavior := coalesce(nullif(new.reentry_behavior, ''), 'redistribute');
  end if;

  new.rules := jsonb_set(new.rules, '{strategy}', to_jsonb(new.strategy), true);
  new.rules := jsonb_set(new.rules, '{settings}', new.settings, true);
  new.rules := jsonb_set(new.rules, '{reentry_behavior}', to_jsonb(new.reentry_behavior), true);
  if new.target_stage_id is null then
    new.rules := new.rules - 'target_stage_id';
  else
    new.rules := jsonb_set(new.rules, '{target_stage_id}', to_jsonb(new.target_stage_id::text), true);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_round_robin_contract on public.round_robins;
create trigger trg_sync_round_robin_contract
before insert or update of pipeline_id, target_pipeline_id, target_stage_id, settings, strategy, reentry_behavior, rules
on public.round_robins
for each row execute function private.sync_round_robin_contract();

-- Rewrites existing JSON metadata after canonical columns have been recovered.
update public.round_robins
set rules = rules;

create or replace function private.enroll_round_robin_redistribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  queue_settings jsonb;
  queue_enabled boolean;
  timeout_minutes integer;
  warning_minutes integer;
  max_attempts integer;
  eligible_users integer;
  current_user_id uuid;
begin
  if new.round_robin_id is null
     or new.lead_id is null
     or new.assigned_user_id is null
     or coalesce(new.reason, '') = 'auto_redistribution' then
    return new;
  end if;

  select coalesce(rr.settings, '{}'::jsonb), coalesce(rr.is_active, true)
  into queue_settings, queue_enabled
  from public.round_robins rr
  where rr.id = new.round_robin_id
    and rr.organization_id = new.organization_id;

  if not found or not queue_enabled
     or lower(coalesce(queue_settings->>'enable_redistribution', 'false')) not in ('true', '1', 'yes') then
    return new;
  end if;

  timeout_minutes := least(10080, greatest(1, coalesce(
    case when coalesce(queue_settings->>'redistribution_timeout_minutes', '') ~ '^[0-9]+$'
      then (queue_settings->>'redistribution_timeout_minutes')::integer end,
    20
  )));
  warning_minutes := greatest(0, coalesce(
    case when coalesce(queue_settings->>'redistribution_warning_minutes', '') ~ '^[0-9]+$'
      then (queue_settings->>'redistribution_warning_minutes')::integer end,
    5
  ));
  warning_minutes := least(warning_minutes, timeout_minutes - 1);
  max_attempts := least(1000, greatest(0, coalesce(
    case when coalesce(queue_settings->>'redistribution_max_attempts', '') ~ '^[0-9]+$'
      then (queue_settings->>'redistribution_max_attempts')::integer end,
    10
  )));

  with entries as (
    select rrm.organization_id, rrm.user_id, rrm.team_id
    from public.round_robin_members rrm
    where rrm.organization_id = new.organization_id
      and rrm.round_robin_id = new.round_robin_id
      and coalesce(rrm.is_active, true) = true
  ), candidate_users as (
    select e.organization_id, e.user_id from entries e where e.user_id is not null
    union
    select e.organization_id, tm.user_id
    from entries e
    join public.teams t
      on t.id = e.team_id and t.organization_id = e.organization_id and coalesce(t.is_active, true) = true
    join public.team_members tm
      on tm.team_id = e.team_id and tm.organization_id = e.organization_id and coalesce(tm.is_active, true) = true
    where e.team_id is not null
  )
  select count(distinct c.user_id)::integer
  into eligible_users
  from candidate_users c
  join public.organization_members om
    on om.organization_id = c.organization_id and om.user_id = c.user_id and coalesce(om.is_active, true) = true
  join public.users u on u.id = c.user_id and coalesce(u.is_active, true) = true;

  -- A queue with no alternative assignee can never redistribute safely.
  if coalesce(eligible_users, 0) < 2 then
    return new;
  end if;

  select l.assigned_user_id
  into current_user_id
  from public.leads l
  where l.id = new.lead_id
    and l.organization_id = new.organization_id;
  if current_user_id is distinct from new.assigned_user_id then
    return new;
  end if;

  insert into public.lead_redistribution_jobs (
    organization_id, lead_id, round_robin_id,
    original_assigned_user_id, current_assigned_user_id,
    max_attempts, timeout_minutes, warning_minutes,
    enrolled_at, due_at, warning_due_at, metadata
  ) values (
    new.organization_id, new.lead_id, new.round_robin_id,
    new.assigned_user_id, new.assigned_user_id,
    max_attempts, timeout_minutes, warning_minutes,
    new.created_at,
    new.created_at + make_interval(mins => timeout_minutes),
    case when warning_minutes > 0
      then new.created_at + make_interval(mins => timeout_minutes - warning_minutes)
      else null end,
    jsonb_build_object(
      'source', coalesce(nullif(new.reason, ''), 'round_robin'),
      'round_robin_log_id', new.id,
      'member_id', new.metadata->>'member_id'
    )
  ) on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists trg_enroll_round_robin_redistribution on public.round_robin_logs;
create trigger trg_enroll_round_robin_redistribution
after insert on public.round_robin_logs
for each row execute function private.enroll_round_robin_redistribution();

-- ---------------------------------------------------------------------------
-- Cadence: materialized obligations tied to the real stage lifecycle.
-- ---------------------------------------------------------------------------

create table if not exists public.cadence_enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  cadence_template_id uuid not null references public.cadence_templates(id) on delete restrict,
  stage_cycle_id uuid references public.lead_stage_cycles(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled', 'paused')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  template_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(template_snapshot) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cadence_enrollments_one_active
  on public.cadence_enrollments (lead_id)
  where status = 'active';
create unique index if not exists cadence_enrollments_stage_cycle_unique
  on public.cadence_enrollments (stage_cycle_id)
  where stage_cycle_id is not null and status = 'active';
create index if not exists idx_cadence_enrollments_org_status
  on public.cadence_enrollments (organization_id, status, started_at desc);

create index if not exists idx_cadence_templates_org_stage_active
  on public.cadence_templates (organization_id, stage_id, pipeline_id, stage_key)
  where is_active = true;

create index if not exists idx_cadence_tasks_template_materialization
  on public.cadence_tasks_template (organization_id, cadence_template_id, delay_days, position);

alter table public.lead_tasks
  add column if not exists cadence_enrollment_id uuid references public.cadence_enrollments(id) on delete set null,
  add column if not exists cadence_template_task_id uuid references public.cadence_tasks_template(id) on delete set null,
  add column if not exists status text not null default 'pending',
  add column if not exists sequence integer;

update public.lead_tasks
set status = case when coalesce(is_done, false) then 'completed' else 'pending' end;

alter table public.lead_tasks drop constraint if exists lead_tasks_status_check;
alter table public.lead_tasks
  add constraint lead_tasks_status_check check (status in ('pending', 'completed', 'cancelled', 'skipped'));

create unique index if not exists lead_tasks_cadence_task_unique
  on public.lead_tasks (cadence_enrollment_id, cadence_template_task_id)
  where cadence_enrollment_id is not null and cadence_template_task_id is not null;
create index if not exists idx_lead_tasks_cadence_due
  on public.lead_tasks (organization_id, status, due_at, assigned_user_id)
  where status = 'pending' and is_done = false;

create or replace function private.materialize_cadence_for_stage_cycle(p_stage_cycle_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_cycle record;
  target_template record;
  enrollment_id uuid;
begin
  select sc.*, l.assigned_user_id, s.stage_key, s.name as stage_name
  into target_cycle
  from public.lead_stage_cycles sc
  join public.leads l on l.id = sc.lead_id and l.organization_id = sc.organization_id
  join public.stages s on s.id = sc.stage_id and s.organization_id = sc.organization_id
  where sc.id = p_stage_cycle_id and sc.exited_at is null;
  if not found then return null; end if;

  select ct.*
  into target_template
  from public.cadence_templates ct
  where ct.organization_id = target_cycle.organization_id
    and coalesce(ct.is_active, true) = true
    and (
      ct.stage_id = target_cycle.stage_id
      or (ct.pipeline_id = target_cycle.pipeline_id and ct.stage_key = target_cycle.stage_key)
      or (ct.pipeline_id is null and ct.stage_key = target_cycle.stage_key)
    )
  order by
    case when ct.stage_id = target_cycle.stage_id then 3
         when ct.pipeline_id = target_cycle.pipeline_id then 2 else 1 end desc,
    ct.updated_at desc,
    ct.id
  limit 1;
  if not found then return null; end if;

  update public.cadence_enrollments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cadence_replaced', updated_at = now()
  where lead_id = target_cycle.lead_id and status = 'active';

  insert into public.cadence_enrollments (
    organization_id, lead_id, cadence_template_id, stage_cycle_id,
    assigned_user_id, started_at, template_snapshot, metadata
  ) values (
    target_cycle.organization_id, target_cycle.lead_id, target_template.id, target_cycle.id,
    target_cycle.assigned_user_id, target_cycle.entered_at,
    jsonb_build_object(
      'id', target_template.id,
      'name', target_template.name,
      'pipeline_id', target_template.pipeline_id,
      'stage_id', target_template.stage_id,
      'stage_key', target_template.stage_key
    ),
    jsonb_build_object(
      'source', 'stage_cycle',
      'stage_name', target_cycle.stage_name,
      'stage_cycle_source', target_cycle.metadata->>'source',
      'historical_backfill', coalesce(target_cycle.metadata->>'source', '') = 'operational_backfill'
    )
  )
  on conflict (stage_cycle_id) where stage_cycle_id is not null and status = 'active' do update
    set assigned_user_id = excluded.assigned_user_id,
        updated_at = now()
  returning id into enrollment_id;

  insert into public.lead_tasks (
    organization_id, lead_id, assigned_user_id, title, description, type,
    day_offset, due_at, due_date, is_done, status, sequence,
    cadence_enrollment_id, cadence_template_task_id, metadata
  )
  select
    target_cycle.organization_id,
    target_cycle.lead_id,
    target_cycle.assigned_user_id,
    task.title,
    nullif(task.metadata->>'description', ''),
    coalesce(nullif(task.type, ''), 'call'),
    greatest(0, task.delay_days),
    target_cycle.entered_at + make_interval(days => greatest(0, task.delay_days)),
    target_cycle.entered_at + make_interval(days => greatest(0, task.delay_days)),
    false,
    'pending',
    task.position,
    enrollment_id,
    task.id,
    coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'cadence',
      'cadence_template_id', target_template.id,
      'message_template', task.message_template
    )
  from public.cadence_tasks_template task
  where task.organization_id = target_cycle.organization_id
    and task.cadence_template_id = target_template.id
  on conflict (cadence_enrollment_id, cadence_template_task_id)
    where cadence_enrollment_id is not null and cadence_template_task_id is not null
  do nothing;

  if not exists (
    select 1 from public.lead_tasks where cadence_enrollment_id = enrollment_id and status = 'pending'
  ) then
    update public.cadence_enrollments
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = enrollment_id;
  end if;

  return enrollment_id;
end;
$$;

create or replace function private.sync_cadence_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform private.materialize_cadence_for_stage_cycle(new.id);
  elsif new.exited_at is not null and old.exited_at is null then
    update public.cadence_enrollments
    set status = 'cancelled', cancelled_at = new.exited_at,
        cancel_reason = coalesce(new.exited_reason, 'stage_changed'), updated_at = now()
    where stage_cycle_id = new.id and status in ('active', 'paused');

    update public.lead_tasks
    set status = 'cancelled', updated_at = now(),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', coalesce(new.exited_reason, 'stage_changed'))
    where cadence_enrollment_id in (
      select id from public.cadence_enrollments where stage_cycle_id = new.id
    ) and status = 'pending' and is_done = false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_cadence_lifecycle on public.lead_stage_cycles;
create trigger trg_sync_cadence_lifecycle
after insert or update of exited_at on public.lead_stage_cycles
for each row execute function private.sync_cadence_lifecycle();

create or replace function private.sync_cadence_task_state()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_done then
    new.status := 'completed';
    new.done_at := coalesce(new.done_at, new.completed_at, now());
    new.completed_at := coalesce(new.completed_at, new.done_at, now());
  elsif new.status = 'completed' then
    new.status := 'pending';
    new.done_at := null;
    new.completed_at := null;
    new.done_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_sync_cadence_task_state on public.lead_tasks;
create trigger trg_sync_cadence_task_state
before insert or update of is_done, status, done_at, completed_at on public.lead_tasks
for each row execute function private.sync_cadence_task_state();

create or replace function private.finish_cadence_enrollment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cadence_enrollment_id is not null and new.status = 'completed' then
    update public.cadence_enrollments ce
    set status = 'completed', completed_at = now(), updated_at = now()
    where ce.id = new.cadence_enrollment_id
      and ce.status = 'active'
      and not exists (
        select 1 from public.lead_tasks lt
        where lt.cadence_enrollment_id = ce.id
          and lt.id <> new.id
          and lt.status = 'pending'
          and lt.is_done = false
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_finish_cadence_enrollment on public.lead_tasks;
create trigger trg_finish_cadence_enrollment
after insert or update of status, is_done on public.lead_tasks
for each row execute function private.finish_cadence_enrollment();

create or replace function private.sync_lead_cadence_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_user_id is distinct from old.assigned_user_id then
    update public.cadence_enrollments
    set assigned_user_id = new.assigned_user_id, updated_at = now()
    where lead_id = new.id and status = 'active';
    update public.lead_tasks
    set assigned_user_id = new.assigned_user_id, updated_at = now()
    where lead_id = new.id and status = 'pending' and is_done = false;
  end if;
  return new;
end;
$$;

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
  target_template record;
  current_stage_cycle_id uuid;
  enrollment_id uuid;
begin
  select l.* into target_lead
  from public.leads l
  where l.organization_id = p_organization_id and l.id = p_lead_id
  for update;
  if not found then raise exception 'cadence_lead_not_found'; end if;

  select ct.* into target_template
  from public.cadence_templates ct
  where ct.organization_id = p_organization_id
    and ct.id = p_cadence_template_id
    and coalesce(ct.is_active, true) = true;
  if not found then raise exception 'cadence_template_not_found'; end if;

  select sc.id into current_stage_cycle_id
  from public.lead_stage_cycles sc
  where sc.organization_id = p_organization_id
    and sc.lead_id = p_lead_id and sc.exited_at is null
  order by sc.entered_at desc, sc.id desc limit 1;

  update public.lead_tasks
  set status = 'cancelled', updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('cancel_reason', 'cadence_switched')
  where lead_id = p_lead_id and status = 'pending' and is_done = false
    and cadence_enrollment_id in (
      select id from public.cadence_enrollments where lead_id = p_lead_id and status = 'active'
    );

  update public.cadence_enrollments
  set status = 'cancelled', cancelled_at = now(), cancel_reason = 'cadence_switched', updated_at = now()
  where lead_id = p_lead_id and status = 'active';

  insert into public.cadence_enrollments (
    organization_id, lead_id, cadence_template_id, stage_cycle_id,
    assigned_user_id, started_at, template_snapshot, metadata
  ) values (
    p_organization_id, p_lead_id, target_template.id, current_stage_cycle_id,
    target_lead.assigned_user_id, now(),
    jsonb_build_object(
      'id', target_template.id, 'name', target_template.name,
      'pipeline_id', target_template.pipeline_id, 'stage_id', target_template.stage_id,
      'stage_key', target_template.stage_key
    ),
    jsonb_build_object('source', 'manual_switch', 'actor_user_id', p_actor_user_id)
  ) returning id into enrollment_id;

  insert into public.lead_tasks (
    organization_id, lead_id, assigned_user_id, title, description, type,
    day_offset, due_at, due_date, is_done, status, sequence,
    cadence_enrollment_id, cadence_template_task_id, metadata, created_by
  )
  select p_organization_id, p_lead_id, target_lead.assigned_user_id,
         task.title, nullif(task.metadata->>'description', ''), coalesce(nullif(task.type, ''), 'call'),
         greatest(0, task.delay_days), now() + make_interval(days => greatest(0, task.delay_days)),
         now() + make_interval(days => greatest(0, task.delay_days)), false, 'pending', task.position,
         enrollment_id, task.id,
         coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
           'source', 'cadence', 'cadence_template_id', target_template.id,
           'message_template', task.message_template
         ),
         p_actor_user_id
  from public.cadence_tasks_template task
  where task.organization_id = p_organization_id
    and task.cadence_template_id = target_template.id;

  insert into public.activities (
    organization_id, lead_id, user_id, type, content, metadata
  ) values (
    p_organization_id, p_lead_id, p_actor_user_id, 'cadence_switched',
    'Cadencia alterada para: ' || target_template.name,
    jsonb_build_object('cadence_enrollment_id', enrollment_id, 'cadence_template_id', target_template.id)
  );

  if not exists (select 1 from public.lead_tasks where cadence_enrollment_id = enrollment_id) then
    update public.cadence_enrollments
    set status = 'completed', completed_at = now(), updated_at = now()
    where id = enrollment_id;
  end if;
  return enrollment_id;
end;
$$;

drop trigger if exists trg_sync_lead_cadence_assignee on public.leads;
create trigger trg_sync_lead_cadence_assignee
after update of assigned_user_id on public.leads
for each row execute function private.sync_lead_cadence_assignee();

-- All CRM leads now participate in operational attention. Existing engines stay
-- in shadow mode, so the backfill is observable before an admin enables alerts.
create or replace function private.guard_lead_clocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.attention_eligible := true;
    new.attention_enrolled_at := coalesce(new.attention_enrolled_at, now());
    if new.stage_id is not null then
      new.stage_entered_at := coalesce(new.stage_entered_at, new.created_at, now());
    end if;
    if new.assigned_user_id is not null then
      new.assigned_at := coalesce(new.assigned_at, new.created_at, now());
    end if;
    new.board_order_at := coalesce(new.board_order_at, new.last_entry_at, new.stage_entered_at, new.created_at, now());
    return new;
  end if;

  new.attention_eligible := old.attention_eligible;
  new.attention_enrolled_at := old.attention_enrolled_at;
  if new.stage_id is not distinct from old.stage_id and new.pipeline_id is not distinct from old.pipeline_id then
    new.stage_entered_at := old.stage_entered_at;
  elsif new.stage_id is null then
    new.stage_entered_at := null;
    new.board_order_at := null;
  else
    new.stage_entered_at := now();
    if new.board_order_at is not distinct from old.board_order_at then new.board_order_at := new.stage_entered_at; end if;
  end if;
  if new.assigned_user_id is distinct from old.assigned_user_id then
    new.assigned_at := case when new.assigned_user_id is null then null else now() end;
  end if;
  new.board_order_at := coalesce(new.board_order_at, old.board_order_at, new.stage_entered_at, new.created_at, now());
  return new;
end;
$$;

alter table public.leads disable trigger trg_guard_lead_clocks;
update public.leads
set attention_eligible = true,
    attention_enrolled_at = coalesce(attention_enrolled_at, now())
where coalesce(attention_eligible, false) = false
  and coalesce(deal_status, 'open') not in ('won', 'lost');
alter table public.leads enable trigger trg_guard_lead_clocks;

insert into public.lead_assignment_cycles (
  organization_id, lead_id, assigned_user_id, cycle_number, assigned_at, metadata
)
select l.organization_id, l.id, l.assigned_user_id, 1,
       coalesce(l.assigned_at, l.created_at, now()),
       jsonb_build_object('source', 'operational_backfill')
from public.leads l
where l.attention_eligible = true and l.assigned_user_id is not null
  and coalesce(l.deal_status, 'open') not in ('won', 'lost')
  and not exists (select 1 from public.lead_assignment_cycles c where c.lead_id = l.id);

insert into public.lead_stage_cycles (
  organization_id, lead_id, pipeline_id, stage_id, cycle_number,
  entered_at, baseline_confidence, metadata
)
select l.organization_id, l.id, l.pipeline_id, l.stage_id, 1,
       coalesce(l.stage_entered_at, l.created_at, now()), 'legacy',
       jsonb_build_object('source', 'operational_backfill')
from public.leads l
where l.attention_eligible = true and l.pipeline_id is not null and l.stage_id is not null
  and coalesce(l.deal_status, 'open') not in ('won', 'lost')
  and not exists (select 1 from public.lead_stage_cycles c where c.lead_id = l.id);

alter table public.lead_attention_policies
  drop constraint if exists lead_attention_policies_type_check;
alter table public.lead_attention_policies
  add constraint lead_attention_policies_type_check
  check (policy_type in ('unassigned', 'first_contact', 'stage_inactivity', 'stage_age', 'cadence_task'));

insert into public.lead_attention_policies (
  organization_id, name, policy_type, status,
  threshold_minutes, warning_minutes, repeat_minutes,
  escalation_minutes, redistribution_minutes,
  notify_assignee, notify_leaders, notify_admins, config
)
select o.id, 'Tarefas de cadencia vencidas', 'cadence_task', 'enabled',
       1, 0, 1440, 60, null, true, true, true,
       jsonb_build_object('seeded', true, 'source', 'operational_excellence')
from public.organizations o
where not exists (
  select 1 from public.lead_attention_policies p
  where p.organization_id = o.id and p.policy_type = 'cadence_task' and p.status <> 'archived'
);

alter table public.cadence_enrollments enable row level security;
revoke all on table public.cadence_enrollments from public, anon, authenticated;
grant select, insert, update, delete on table public.cadence_enrollments to service_role;

drop policy if exists "backend manages cadence enrollments" on public.cadence_enrollments;
create policy "backend manages cadence enrollments"
on public.cadence_enrollments for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- Push observability: per-device health instead of an aggregate black box.
-- ---------------------------------------------------------------------------

alter table public.push_tokens
  add column if not exists last_success_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_failure_reason text,
  add column if not exists failure_count integer not null default 0;

create table if not exists public.push_delivery_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid references public.notifications(id) on delete set null,
  push_token_id uuid references public.push_tokens(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  platform text,
  provider text,
  attempted boolean not null default false,
  succeeded boolean not null default false,
  permanent_failure boolean not null default false,
  status_code integer,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_push_delivery_events_user_created
  on public.push_delivery_events (organization_id, user_id, created_at desc);
create index if not exists idx_push_delivery_events_notification
  on public.push_delivery_events (notification_id, created_at desc)
  where notification_id is not null;

alter table public.push_delivery_events enable row level security;
revoke all on table public.push_delivery_events from public, anon, authenticated;
grant select, insert on table public.push_delivery_events to service_role;
drop policy if exists "backend manages push delivery events" on public.push_delivery_events;
create policy "backend manages push delivery events"
on public.push_delivery_events for all to service_role using (true) with check (true);

revoke execute on function private.sync_round_robin_contract() from public, anon, authenticated;
revoke execute on function private.enroll_round_robin_redistribution() from public, anon, authenticated;
revoke execute on function private.materialize_cadence_for_stage_cycle(uuid) from public, anon, authenticated;
revoke execute on function private.sync_cadence_lifecycle() from public, anon, authenticated;
revoke execute on function private.sync_cadence_task_state() from public, anon, authenticated;
revoke execute on function private.finish_cadence_enrollment() from public, anon, authenticated;
revoke execute on function private.sync_lead_cadence_assignee() from public, anon, authenticated;
revoke execute on function private.switch_lead_cadence(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.switch_lead_cadence(uuid, uuid, uuid, uuid) to service_role;

comment on table public.cadence_enrollments is
  'Immutable cadence enrollment snapshot for one lead stage cycle.';
comment on table public.push_delivery_events is
  'Backend-only per-device push delivery ledger used for diagnostics and token health.';
