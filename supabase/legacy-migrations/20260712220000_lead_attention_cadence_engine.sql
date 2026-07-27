-- Vimob CRM lead attention and cadence engine.
--
-- Safety defaults:
--   * every organization starts in shadow mode;
--   * legacy cycles are marked as low-confidence and never notify by themselves;
--   * redistribution is protected by an organization-level kill switch;
--   * external delivery remains owned by the Go notification dispatcher.

alter table public.leads
  add column if not exists board_order_at timestamptz,
  add column if not exists attention_eligible boolean not null default false,
  add column if not exists attention_enrolled_at timestamptz;

-- Runtime compatibility required by the attention redistribution path. These
-- columns exist in current installations, but older remote schemas may not have
-- recorded the corresponding historical migrations.
alter table public.pipelines
  add column if not exists default_round_robin_id uuid;

alter table public.round_robin_members
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.round_robin_members
  alter column user_id drop not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'round_robin_members_user_or_team_check'
      and conrelid = 'public.round_robin_members'::regclass
  ) then
    alter table public.round_robin_members
      add constraint round_robin_members_user_or_team_check
      check (user_id is not null or team_id is not null);
  end if;
end $$;

create unique index if not exists round_robin_members_unique_team_entry
  on public.round_robin_members (round_robin_id, team_id)
  where user_id is null and team_id is not null;

-- Some installations predate the dedicated redistribution queue migration.
-- Keep this rollout self-contained so the cadence engine can be installed
-- safely without applying unrelated or divergent historical migrations.
create table if not exists public.lead_redistribution_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  round_robin_id uuid not null references public.round_robins(id) on delete cascade,
  original_assigned_user_id uuid references public.users(id) on delete set null,
  current_assigned_user_id uuid references public.users(id) on delete set null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 1 check (max_attempts > 0),
  timeout_minutes integer not null check (timeout_minutes > 0),
  warning_minutes integer not null default 5 check (warning_minutes >= 0),
  enrolled_at timestamptz not null default now(),
  due_at timestamptz not null,
  warning_due_at timestamptz,
  warning_sent_at timestamptz,
  last_redistributed_at timestamptz,
  stopped_at timestamptz,
  stopped_reason text,
  status text not null default 'pending' check (
    status in (
      'pending',
      'warning_sent',
      'redistributed',
      'stopped',
      'max_attempts_reached',
      'no_next_member'
    )
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_lead_redistribution_jobs_one_active
  on public.lead_redistribution_jobs (lead_id)
  where status in ('pending', 'warning_sent');

create index if not exists idx_lead_redistribution_jobs_due
  on public.lead_redistribution_jobs (status, due_at)
  where status in ('pending', 'warning_sent');

create index if not exists idx_lead_redistribution_jobs_warning_due
  on public.lead_redistribution_jobs (warning_due_at)
  where status = 'pending' and warning_sent_at is null;

create index if not exists idx_lead_redistribution_jobs_org_round_robin
  on public.lead_redistribution_jobs (organization_id, round_robin_id, created_at desc);

comment on table public.lead_redistribution_jobs is
  'Internal backend queue for automatic lead redistribution. Rows are created only for explicitly eligible leads.';

alter table public.lead_redistribution_jobs enable row level security;

revoke all on public.lead_redistribution_jobs from anon, authenticated;
grant all on public.lead_redistribution_jobs to service_role;

drop policy if exists "backend manages lead redistribution jobs" on public.lead_redistribution_jobs;
create policy "backend manages lead redistribution jobs"
on public.lead_redistribution_jobs
for all
to service_role
using (true)
with check (true);

-- The round-robin editor documents zero as unlimited. Align the persisted
-- contract without changing any existing positive limit.
alter table public.lead_redistribution_jobs
  drop constraint if exists lead_redistribution_jobs_max_attempts_check;
alter table public.lead_redistribution_jobs
  add constraint lead_redistribution_jobs_max_attempts_check check (max_attempts >= 0);

update public.leads
set board_order_at = coalesce(last_entry_at, stage_entered_at, updated_at, created_at)
where board_order_at is null;

create index if not exists idx_leads_board_order
  on public.leads (organization_id, pipeline_id, stage_id, board_order_at desc, id desc);

create index if not exists idx_leads_attention_eligible_scope
  on public.leads (
    organization_id, deal_status, pipeline_id, stage_id,
    assigned_user_id, attention_enrolled_at, id
  )
  where attention_eligible = true;

comment on column public.leads.board_order_at is
  'Independent Kanban ordering clock. It must never be used as the real stage entry timestamp.';
comment on column public.leads.attention_eligible is
  'Immutable enrollment marker. Only non-manual leads created after this engine migration are eligible.';
comment on column public.leads.attention_enrolled_at is
  'Creation-time enrollment timestamp. Existing and manually-created leads remain null.';
comment on column public.lead_redistribution_jobs.max_attempts is
  'Maximum automatic transfers. Zero means unlimited.';

create table if not exists public.organization_attention_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  engine_mode text not null default 'shadow',
  notifications_enabled boolean not null default true,
  redistribution_enabled boolean not null default false,
  timezone text not null default 'America/Sao_Paulo',
  business_hours jsonb not null default '{"days":[1,2,3,4,5],"start":"08:00","end":"18:00"}'::jsonb,
  default_repeat_minutes integer not null default 1440,
  max_reminders integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_attention_settings_mode_check
    check (engine_mode in ('disabled', 'shadow', 'enabled')),
  constraint organization_attention_settings_repeat_check
    check (default_repeat_minutes > 0),
  constraint organization_attention_settings_max_reminders_check
    check (max_reminders >= 0),
  constraint organization_attention_settings_business_hours_check
    check (jsonb_typeof(business_hours) = 'object')
);

create table if not exists public.lead_attention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  policy_key uuid not null default gen_random_uuid(),
  version integer not null default 1,
  name text not null,
  policy_type text not null,
  status text not null default 'shadow',
  pipeline_id uuid references public.pipelines(id) on delete cascade,
  stage_id uuid references public.stages(id) on delete cascade,
  threshold_minutes integer not null,
  warning_minutes integer not null default 0,
  repeat_minutes integer,
  escalation_minutes integer,
  redistribution_minutes integer,
  business_hours_only boolean not null default false,
  redistribute_before_contact_only boolean not null default true,
  notify_assignee boolean not null default true,
  notify_leaders boolean not null default true,
  notify_admins boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_attention_policies_key_version_unique unique (policy_key, version),
  constraint lead_attention_policies_type_check
    check (policy_type in ('unassigned', 'first_contact', 'stage_inactivity', 'stage_age')),
  constraint lead_attention_policies_status_check
    check (status in ('shadow', 'enabled', 'paused', 'archived')),
  constraint lead_attention_policies_version_check check (version > 0),
  constraint lead_attention_policies_threshold_check check (threshold_minutes > 0),
  constraint lead_attention_policies_warning_check
    check (warning_minutes >= 0 and warning_minutes < threshold_minutes),
  constraint lead_attention_policies_repeat_check
    check (repeat_minutes is null or repeat_minutes > 0),
  constraint lead_attention_policies_escalation_check
    check (escalation_minutes is null or escalation_minutes >= 0),
  constraint lead_attention_policies_redistribution_check
    check (redistribution_minutes is null or redistribution_minutes >= 0),
  constraint lead_attention_policies_config_check check (jsonb_typeof(config) = 'object'),
  constraint lead_attention_policies_stage_pipeline_check
    check (stage_id is null or pipeline_id is not null)
);

create unique index if not exists lead_attention_policies_one_current_scope
  on public.lead_attention_policies (
    organization_id,
    policy_type,
    coalesce(pipeline_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(stage_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status <> 'archived';

create index if not exists idx_lead_attention_policies_org_status
  on public.lead_attention_policies (organization_id, status, policy_type, created_at desc);

create index if not exists idx_lead_attention_policies_pipeline
  on public.lead_attention_policies (pipeline_id)
  where pipeline_id is not null;

create index if not exists idx_lead_attention_policies_stage
  on public.lead_attention_policies (stage_id)
  where stage_id is not null;

create table if not exists public.lead_assignment_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  assigned_user_id uuid references public.users(id) on delete set null,
  cycle_number integer not null,
  assigned_at timestamptz not null,
  ended_at timestamptz,
  ended_reason text,
  first_human_outreach_at timestamptz,
  first_effective_contact_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_assignment_cycles_number_check check (cycle_number > 0),
  constraint lead_assignment_cycles_time_check check (ended_at is null or ended_at >= assigned_at),
  constraint lead_assignment_cycles_lead_number_unique unique (lead_id, cycle_number),
  constraint lead_assignment_cycles_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists lead_assignment_cycles_one_active
  on public.lead_assignment_cycles (lead_id)
  where ended_at is null;

create index if not exists idx_lead_assignment_cycles_org_assignee
  on public.lead_assignment_cycles (organization_id, assigned_user_id, assigned_at desc);

create index if not exists idx_lead_assignment_cycles_assignee
  on public.lead_assignment_cycles (assigned_user_id);

create table if not exists public.lead_stage_cycles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  cycle_number integer not null,
  entered_at timestamptz not null,
  exited_at timestamptz,
  exited_reason text,
  baseline_confidence text not null default 'observed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_stage_cycles_number_check check (cycle_number > 0),
  constraint lead_stage_cycles_time_check check (exited_at is null or exited_at >= entered_at),
  constraint lead_stage_cycles_confidence_check check (baseline_confidence in ('observed', 'legacy')),
  constraint lead_stage_cycles_lead_number_unique unique (lead_id, cycle_number),
  constraint lead_stage_cycles_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists lead_stage_cycles_one_active
  on public.lead_stage_cycles (lead_id)
  where exited_at is null;

create index if not exists idx_lead_stage_cycles_org_stage
  on public.lead_stage_cycles (organization_id, pipeline_id, stage_id, entered_at desc);

create index if not exists idx_lead_stage_cycles_pipeline
  on public.lead_stage_cycles (pipeline_id);

create index if not exists idx_lead_stage_cycles_stage
  on public.lead_stage_cycles (stage_id);

create table if not exists public.lead_action_facts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  assignment_cycle_id uuid references public.lead_assignment_cycles(id) on delete set null,
  stage_cycle_id uuid references public.lead_stage_cycles(id) on delete set null,
  action_type text not null,
  channel text,
  occurred_at timestamptz not null,
  is_automated boolean not null default false,
  is_inbound boolean not null default false,
  qualifies_first_outreach boolean not null default false,
  qualifies_stage_inactivity boolean not null default false,
  is_effective_contact boolean not null default false,
  source_type text not null,
  source_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint lead_action_facts_action_type_check check (length(btrim(action_type)) > 0),
  constraint lead_action_facts_source_type_check check (length(btrim(source_type)) > 0),
  constraint lead_action_facts_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists lead_action_facts_source_unique
  on public.lead_action_facts (organization_id, source_type, source_id)
  where source_id is not null;

create index if not exists idx_lead_action_facts_lead_occurred
  on public.lead_action_facts (organization_id, lead_id, occurred_at desc, id desc);

create index if not exists idx_lead_action_facts_assignment_cycle
  on public.lead_action_facts (assignment_cycle_id, occurred_at desc)
  where assignment_cycle_id is not null;

create index if not exists idx_lead_action_facts_stage_cycle_qualifying
  on public.lead_action_facts (stage_cycle_id, occurred_at desc)
  where stage_cycle_id is not null and qualifies_stage_inactivity = true;

create table if not exists public.lead_attention_instances (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  policy_id uuid not null references public.lead_attention_policies(id) on delete cascade,
  policy_version integer not null,
  cycle_key text not null,
  assignment_cycle_id uuid references public.lead_assignment_cycles(id) on delete set null,
  stage_cycle_id uuid references public.lead_stage_cycles(id) on delete set null,
  assigned_user_id uuid references public.users(id) on delete set null,
  pipeline_id uuid references public.pipelines(id) on delete set null,
  stage_id uuid references public.stages(id) on delete set null,
  baseline_at timestamptz not null,
  last_qualifying_action_at timestamptz,
  warning_at timestamptz,
  due_at timestamptz not null,
  next_evaluation_at timestamptz not null,
  status text not null default 'monitoring',
  shadow boolean not null default true,
  warning_sent_at timestamptz,
  breach_sent_at timestamptz,
  escalated_at timestamptz,
  redistributed_at timestamptz,
  last_reminder_at timestamptz,
  reminder_count integer not null default 0,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id) on delete set null,
  snoozed_until timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.users(id) on delete set null,
  resolved_reason text,
  redistribution_attempts integer not null default 0,
  attempts integer not null default 0,
  locked_at timestamptz,
  locked_by text,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lead_attention_instances_cycle_unique unique (policy_id, lead_id, cycle_key),
  constraint lead_attention_instances_status_check
    check (status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'resolved', 'redistributed', 'cancelled', 'exception')),
  constraint lead_attention_instances_reminder_count_check check (reminder_count >= 0),
  constraint lead_attention_instances_redistribution_attempts_check check (redistribution_attempts >= 0),
  constraint lead_attention_instances_attempts_check check (attempts >= 0),
  constraint lead_attention_instances_due_check check (due_at >= baseline_at),
  constraint lead_attention_instances_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_lead_attention_instances_due
  on public.lead_attention_instances (next_evaluation_at, id)
  where status in ('monitoring', 'warning', 'breached', 'escalated', 'acknowledged', 'exception');

create index if not exists idx_lead_attention_instances_org_status
  on public.lead_attention_instances (organization_id, status, due_at, id);

create index if not exists idx_lead_attention_instances_assignee
  on public.lead_attention_instances (organization_id, assigned_user_id, status, due_at)
  where assigned_user_id is not null;

create index if not exists idx_lead_attention_instances_policy
  on public.lead_attention_instances (policy_id);

create index if not exists idx_lead_attention_instances_assignment_cycle
  on public.lead_attention_instances (assignment_cycle_id)
  where assignment_cycle_id is not null;

create index if not exists idx_lead_attention_instances_stage_cycle
  on public.lead_attention_instances (stage_cycle_id)
  where stage_cycle_id is not null;

create table if not exists public.lead_attention_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  instance_id uuid not null references public.lead_attention_instances(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  actor_user_id uuid references public.users(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint lead_attention_events_type_check check (length(btrim(event_type)) > 0),
  constraint lead_attention_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists idx_lead_attention_events_instance
  on public.lead_attention_events (instance_id, occurred_at desc, id desc);

create index if not exists idx_lead_attention_events_lead
  on public.lead_attention_events (organization_id, lead_id, occurred_at desc, id desc);

create or replace function private.set_attention_updated_at()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_organization_attention_settings_updated_at on public.organization_attention_settings;
create trigger trg_organization_attention_settings_updated_at
before update on public.organization_attention_settings
for each row execute function private.set_attention_updated_at();

drop trigger if exists trg_lead_attention_policies_updated_at on public.lead_attention_policies;
create trigger trg_lead_attention_policies_updated_at
before update on public.lead_attention_policies
for each row execute function private.set_attention_updated_at();

drop trigger if exists trg_lead_assignment_cycles_updated_at on public.lead_assignment_cycles;
create trigger trg_lead_assignment_cycles_updated_at
before update on public.lead_assignment_cycles
for each row execute function private.set_attention_updated_at();

drop trigger if exists trg_lead_stage_cycles_updated_at on public.lead_stage_cycles;
create trigger trg_lead_stage_cycles_updated_at
before update on public.lead_stage_cycles
for each row execute function private.set_attention_updated_at();

drop trigger if exists trg_lead_attention_instances_updated_at on public.lead_attention_instances;
create trigger trg_lead_attention_instances_updated_at
before update on public.lead_attention_instances
for each row execute function private.set_attention_updated_at();

create or replace function private.guard_lead_clocks()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    -- Commercial source is user-editable and cannot prove how the lead was
    -- created. Enrollment therefore requires a backend-owned ingestion marker.
    -- A manually-created lead remains ineligible even if the user labels its
    -- source as WhatsApp, Meta or another integration.
    new.attention_eligible := current_user in ('postgres', 'service_role') and (
      new.meta_lead_id is not null
      or new.source_webhook_id is not null
      or (
        new.source_session_id is not null
        and lower(btrim(coalesce(new.source, ''))) in ('whatsapp', 'site')
      )
      or (
        new.visitor_session_id is not null
        and lower(btrim(coalesce(new.source, ''))) = 'site'
      )
    );
    new.attention_enrolled_at := case when new.attention_eligible then now() else null end;

    if new.stage_id is not null then
      new.stage_entered_at := coalesce(new.stage_entered_at, new.created_at, now());
    end if;
    if new.assigned_user_id is not null then
      new.assigned_at := coalesce(new.assigned_at, new.created_at, now());
    end if;
    new.board_order_at := coalesce(new.board_order_at, new.last_entry_at, new.stage_entered_at, new.created_at, now());
    return new;
  end if;

  -- Enrollment is decided once, at creation. A legacy/manual lead cannot become
  -- eligible later by changing source, assignee or stage.
  new.attention_eligible := old.attention_eligible;
  new.attention_enrolled_at := old.attention_enrolled_at;

  if new.stage_id is not distinct from old.stage_id
     and new.pipeline_id is not distinct from old.pipeline_id then
    -- Reordering a card must never rewrite its true stage clock.
    new.stage_entered_at := old.stage_entered_at;
  elsif new.stage_id is null then
    new.stage_entered_at := null;
    new.board_order_at := null;
  else
    new.stage_entered_at := now();
    if new.board_order_at is not distinct from old.board_order_at then
      new.board_order_at := new.stage_entered_at;
    end if;
  end if;

  if new.assigned_user_id is distinct from old.assigned_user_id then
    if new.assigned_user_id is null then
      new.assigned_at := null;
    else
      new.assigned_at := now();
    end if;
  end if;

  new.board_order_at := coalesce(new.board_order_at, old.board_order_at, new.stage_entered_at, new.created_at, now());
  return new;
end;
$$;

drop trigger if exists trg_guard_lead_clocks on public.leads;
create trigger trg_guard_lead_clocks
before insert or update of stage_id, pipeline_id, stage_entered_at, board_order_at,
  assigned_user_id, assigned_at, source, attention_eligible, attention_enrolled_at
on public.leads
for each row execute function private.guard_lead_clocks();

create or replace function private.capture_lead_cycles()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  next_cycle integer;
  old_assignment_cycle_id uuid;
  old_stage_cycle_id uuid;
begin
  if not coalesce(new.attention_eligible, false) then
    return null;
  end if;

  if tg_op = 'INSERT' or new.assigned_user_id is distinct from old.assigned_user_id then
    if tg_op = 'UPDATE' then
      update public.lead_assignment_cycles
      set ended_at = now(),
          ended_reason = case when new.assigned_user_id is null then 'unassigned' else 'reassigned' end
      where lead_id = new.id and ended_at is null
      returning id into old_assignment_cycle_id;

      if old_assignment_cycle_id is not null then
        -- If the assignment change is the transfer produced by an attention
        -- redistribution job, preserve that terminal outcome instead of
        -- flattening it into a generic reassignment cancellation.
        with redistributed as (
          update public.lead_attention_instances i
          set status = 'redistributed',
              redistributed_at = now(),
              resolved_at = now(),
              resolved_reason = 'auto_redistributed',
              next_evaluation_at = now()
          where i.assignment_cycle_id = old_assignment_cycle_id
            and i.status not in ('resolved', 'redistributed', 'cancelled')
            and exists (
              select 1
              from public.lead_redistribution_jobs j
              where j.organization_id = new.organization_id
                and j.lead_id = new.id
                and j.status in ('pending', 'warning_sent')
                and j.metadata->>'attention_instance_id' = i.id::text
            )
          returning i.organization_id, i.id, i.lead_id
        )
        insert into public.lead_attention_events (
          organization_id, instance_id, lead_id, event_type, metadata
        )
        select organization_id, id, lead_id, 'redistributed',
               jsonb_build_object('source', 'assignment_cycle_trigger')
        from redistributed;

        update public.lead_attention_instances
        set status = 'cancelled',
            resolved_at = now(),
            resolved_reason = case when new.assigned_user_id is null then 'unassigned' else 'reassigned' end,
            next_evaluation_at = now()
        where assignment_cycle_id = old_assignment_cycle_id
          and status not in ('resolved', 'redistributed', 'cancelled');
      end if;
    end if;

    if new.assigned_user_id is not null then
      select coalesce(max(cycle_number), 0) + 1
      into next_cycle
      from public.lead_assignment_cycles
      where lead_id = new.id;

      insert into public.lead_assignment_cycles (
        organization_id, lead_id, assigned_user_id, cycle_number, assigned_at, metadata
      ) values (
        new.organization_id,
        new.id,
        new.assigned_user_id,
        next_cycle,
        coalesce(new.assigned_at, now()),
        jsonb_build_object('source', 'lead_change')
      );
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.stage_id is distinct from old.stage_id
     or new.pipeline_id is distinct from old.pipeline_id then
    if tg_op = 'UPDATE' then
      update public.lead_stage_cycles
      set exited_at = now(), exited_reason = 'stage_changed'
      where lead_id = new.id and exited_at is null
      returning id into old_stage_cycle_id;

      if old_stage_cycle_id is not null then
        update public.lead_attention_instances
        set status = 'resolved',
            resolved_at = now(),
            resolved_reason = 'stage_changed',
            next_evaluation_at = now()
        where stage_cycle_id = old_stage_cycle_id
          and status not in ('resolved', 'redistributed', 'cancelled');
      end if;
    end if;

    if new.pipeline_id is not null and new.stage_id is not null then
      select coalesce(max(cycle_number), 0) + 1
      into next_cycle
      from public.lead_stage_cycles
      where lead_id = new.id;

      insert into public.lead_stage_cycles (
        organization_id, lead_id, pipeline_id, stage_id, cycle_number,
        entered_at, baseline_confidence, metadata
      ) values (
        new.organization_id,
        new.id,
        new.pipeline_id,
        new.stage_id,
        next_cycle,
        coalesce(new.stage_entered_at, now()),
        'observed',
        jsonb_build_object('source', 'lead_change')
      );
    end if;
  end if;

  if new.deal_status in ('won', 'lost')
     and (tg_op = 'INSERT' or new.deal_status is distinct from old.deal_status) then
    update public.lead_assignment_cycles
    set ended_at = coalesce(ended_at, now()), ended_reason = new.deal_status
    where lead_id = new.id and ended_at is null;

    update public.lead_stage_cycles
    set exited_at = coalesce(exited_at, now()), exited_reason = new.deal_status
    where lead_id = new.id and exited_at is null;

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

drop trigger if exists trg_capture_lead_cycles on public.leads;
create trigger trg_capture_lead_cycles
after insert or update of assigned_user_id, stage_id, pipeline_id, deal_status
on public.leads
for each row execute function private.capture_lead_cycles();

create or replace function private.attention_metadata_is_automated(value jsonb)
returns boolean
language sql
immutable
set search_path = public, private, pg_temp
as $$
  select
    lower(coalesce(value->>'is_automation', value->>'is_automated', value->>'automated', 'false')) in ('true', '1', 'yes')
    or lower(btrim(coalesce(value->>'origin', ''))) in (
      'ai', 'openai', 'automation', 'bot', 'ai_autoreply', 'ai_followup'
    )
    or lower(btrim(coalesce(value->>'origin', ''))) ~ '^(ai|automation)[_.]'
    or lower(coalesce(value->>'sender_type', '')) in ('ai', 'automation', 'bot');
$$;

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
set search_path = public, private, pg_temp
as $$
declare
  current_assignment_cycle_id uuid;
  current_stage_cycle_id uuid;
begin
  if not exists (
    select 1
    from public.leads
    where id = p_lead_id
      and organization_id = p_organization_id
      and attention_eligible = true
  ) then
    return;
  end if;

  select id into current_assignment_cycle_id
  from public.lead_assignment_cycles
  where lead_id = p_lead_id and ended_at is null
  order by assigned_at desc, id desc
  limit 1;

  select id into current_stage_cycle_id
  from public.lead_stage_cycles
  where lead_id = p_lead_id and exited_at is null
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

create or replace function private.apply_lead_action_fact()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  cycle_assigned_at timestamptz;
begin
  if new.qualifies_first_outreach and not new.is_automated and new.assignment_cycle_id is not null then
    update public.lead_assignment_cycles
    set first_human_outreach_at = coalesce(first_human_outreach_at, new.occurred_at)
    where id = new.assignment_cycle_id
    returning assigned_at into cycle_assigned_at;

    update public.leads
    set first_response_at = new.occurred_at,
        first_response_seconds = greatest(0, extract(epoch from (new.occurred_at - coalesce(cycle_assigned_at, created_at)))::integer),
        first_response_channel = new.channel,
        first_response_is_automation = false,
        first_response_actor_user_id = new.actor_user_id,
        last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at),
        updated_at = now()
    where id = new.lead_id
      and organization_id = new.organization_id
      and first_response_at is null;
  elsif new.qualifies_stage_inactivity then
    update public.leads
    set last_contact_at = greatest(coalesce(last_contact_at, new.occurred_at), new.occurred_at),
        updated_at = now()
    where id = new.lead_id and organization_id = new.organization_id;
  end if;

  if new.is_effective_contact and new.assignment_cycle_id is not null then
    update public.lead_assignment_cycles
    set first_effective_contact_at = coalesce(first_effective_contact_at, new.occurred_at)
    where id = new.assignment_cycle_id;
  end if;

  return null;
end;
$$;

drop trigger if exists trg_apply_lead_action_fact on public.lead_action_facts;
create trigger trg_apply_lead_action_fact
after insert on public.lead_action_facts
for each row execute function private.apply_lead_action_fact();

create or replace function private.capture_activity_attention_fact()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  normalized_type text := lower(btrim(coalesce(new.type, '')));
  automated boolean := private.attention_metadata_is_automated(new.metadata);
  outcome text := lower(btrim(coalesce(new.metadata->>'outcome', '')));
  qualifies_outreach boolean;
  qualifies_inactivity boolean;
  effective boolean;
begin
  qualifies_outreach := not automated and normalized_type in (
    'call', 'email', 'email_sent', 'message', 'whatsapp'
  );
  qualifies_inactivity := not automated and normalized_type in (
    'call', 'email', 'email_sent', 'message', 'whatsapp',
    'task_completed', 'feedback', 'feedback_added', 'note'
  );
  effective := outcome in (
    'efetivo', 'contato efetivo', 'connected', 'answered', 'atendeu', 'respondeu'
  );

  perform private.record_lead_action_fact(
    new.organization_id,
    new.lead_id,
    new.user_id,
    normalized_type,
    coalesce(new.metadata->>'channel', case when normalized_type like 'email%' then 'email' when normalized_type = 'call' then 'phone' else null end),
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

drop trigger if exists trg_capture_activity_attention_fact on public.activities;
create trigger trg_capture_activity_attention_fact
after insert on public.activities
for each row execute function private.capture_activity_attention_fact();

create or replace function private.capture_whatsapp_attention_fact()
returns trigger
language plpgsql
set search_path = public, private, pg_temp
as $$
declare
  outgoing boolean := coalesce(new.from_me, lower(coalesce(new.direction, '')) = 'outgoing');
  automated boolean;
  happened_at timestamptz;
begin
  if new.lead_id is null then
    return null;
  end if;

  automated := private.attention_metadata_is_automated(new.metadata)
    or lower(coalesce(new.client_message_id, '')) like 'ai-%';
  happened_at := coalesce(new.sent_at, new.received_at, new.created_at, now());

  perform private.record_lead_action_fact(
    new.organization_id,
    new.lead_id,
    new.sender_user_id,
    case when outgoing then 'whatsapp_outbound' else 'whatsapp_inbound' end,
    'whatsapp',
    happened_at,
    case when outgoing then automated else false end,
    not outgoing,
    outgoing and not automated,
    (not outgoing) or (outgoing and not automated),
    not outgoing,
    'whatsapp_message',
    new.id::text,
    coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'message_id', coalesce(new.message_id, new.client_message_id),
      'message_type', new.message_type,
      'direction', case when outgoing then 'outgoing' else 'incoming' end
    )
  );
  return null;
end;
$$;

drop trigger if exists trg_capture_whatsapp_attention_fact on public.whatsapp_messages;
create trigger trg_capture_whatsapp_attention_fact
after insert on public.whatsapp_messages
for each row execute function private.capture_whatsapp_attention_fact();

insert into public.organization_attention_settings (organization_id)
select id from public.organizations
on conflict (organization_id) do nothing;

-- Safe starter policies. They are intentionally shadow policies.
insert into public.lead_attention_policies (
  organization_id, name, policy_type, status, threshold_minutes,
  warning_minutes, repeat_minutes, escalation_minutes,
  redistribute_before_contact_only, config
)
select
  o.id,
  'Primeiro contato em ate 1 hora',
  'first_contact',
  'shadow',
  60,
  15,
  1440,
  1440,
  true,
  jsonb_build_object('seeded', true, 'baseline', 'assignment_cycle')
from public.organizations o
where not exists (
  select 1 from public.lead_attention_policies p
  where p.organization_id = o.id and p.policy_type = 'first_contact'
    and p.pipeline_id is null and p.stage_id is null and p.status <> 'archived'
);

insert into public.lead_attention_policies (
  organization_id, name, policy_type, status, threshold_minutes,
  warning_minutes, repeat_minutes, escalation_minutes,
  notify_assignee, notify_leaders, notify_admins, config
)
select
  o.id,
  'Lead sem responsavel',
  'unassigned',
  'shadow',
  15,
  5,
  1440,
  60,
  false,
  true,
  true,
  jsonb_build_object('seeded', true, 'baseline', 'lead_created_at')
from public.organizations o
where not exists (
  select 1 from public.lead_attention_policies p
  where p.organization_id = o.id and p.policy_type = 'unassigned'
    and p.pipeline_id is null and p.stage_id is null and p.status <> 'archived'
);

insert into public.lead_attention_policies (
  organization_id, name, policy_type, status, pipeline_id, stage_id,
  threshold_minutes, warning_minutes, repeat_minutes, escalation_minutes, config
)
select
  s.organization_id,
  'Tempo maximo - ' || s.name,
  'stage_age',
  'shadow',
  s.pipeline_id,
  s.id,
  resolved.sla_hours * 60,
  least(60, greatest(0, (resolved.sla_hours * 60) / 4)),
  1440,
  1440,
  jsonb_build_object('seeded', true, 'source', resolved.source)
from public.stages s
left join public.stage_operational_configs soc
  on soc.organization_id = s.organization_id and soc.stage_id = s.id
cross join lateral (
  select
    coalesce(
      case when coalesce(soc.config->>'sla_hours', '') ~ '^[0-9]+$'
        then (soc.config->>'sla_hours')::integer end,
      s.sla_hours
    ) as sla_hours,
    case when coalesce(soc.config->>'sla_hours', '') ~ '^[0-9]+$'
      then 'stage_operational_config' else 'stage_sla_hours' end as source
) resolved
where s.is_active = true
  and resolved.sla_hours > 0
  and not exists (
    select 1 from public.lead_attention_policies p
    where p.organization_id = s.organization_id
      and p.policy_type = 'stage_age'
      and p.stage_id = s.id
      and p.status <> 'archived'
  );

insert into public.lead_attention_policies (
  organization_id, name, policy_type, status, pipeline_id, stage_id,
  threshold_minutes, warning_minutes, repeat_minutes, escalation_minutes, config
)
select
  sa.organization_id,
  'Inatividade - ' || s.name,
  'stage_inactivity',
  'shadow',
  s.pipeline_id,
  s.id,
  (sa.config->>'trigger_days')::integer * 1440,
  least(1440, greatest(0, ((sa.config->>'trigger_days')::integer * 1440) / 4)),
  1440,
  1440,
  jsonb_build_object('seeded', true, 'source', 'stage_automation', 'legacy_automation_id', sa.id)
from public.stage_automations sa
join public.stages s on s.id = sa.stage_id and s.organization_id = sa.organization_id
where sa.is_active = true
  and sa.trigger_type = 'inactivity'
  and coalesce(sa.config->>'trigger_days', '') ~ '^[1-9][0-9]*$'
  and not exists (
    select 1 from public.lead_attention_policies p
    where p.organization_id = sa.organization_id
      and p.policy_type = 'stage_inactivity'
      and p.stage_id = sa.stage_id
      and p.status <> 'archived'
  );

alter table public.organization_attention_settings enable row level security;
alter table public.lead_attention_policies enable row level security;
alter table public.lead_assignment_cycles enable row level security;
alter table public.lead_stage_cycles enable row level security;
alter table public.lead_action_facts enable row level security;
alter table public.lead_attention_instances enable row level security;
alter table public.lead_attention_events enable row level security;

revoke all on table public.organization_attention_settings from public, anon, authenticated;
revoke all on table public.lead_attention_policies from public, anon, authenticated;
revoke all on table public.lead_assignment_cycles from public, anon, authenticated;
revoke all on table public.lead_stage_cycles from public, anon, authenticated;
revoke all on table public.lead_action_facts from public, anon, authenticated;
revoke all on table public.lead_attention_instances from public, anon, authenticated;
revoke all on table public.lead_attention_events from public, anon, authenticated;

grant select, insert, update, delete on table public.organization_attention_settings to service_role;
grant select, insert, update, delete on table public.lead_attention_policies to service_role;
grant select, insert, update, delete on table public.lead_assignment_cycles to service_role;
grant select, insert, update, delete on table public.lead_stage_cycles to service_role;
grant select, insert, update, delete on table public.lead_action_facts to service_role;
grant select, insert, update, delete on table public.lead_attention_instances to service_role;
grant select, insert on table public.lead_attention_events to service_role;

revoke execute on function private.set_attention_updated_at() from public, anon, authenticated;
revoke execute on function private.guard_lead_clocks() from public, anon, authenticated;
revoke execute on function private.capture_lead_cycles() from public, anon, authenticated;
revoke execute on function private.attention_metadata_is_automated(jsonb) from public, anon, authenticated;
revoke execute on function private.record_lead_action_fact(uuid, uuid, uuid, text, text, timestamptz, boolean, boolean, boolean, boolean, boolean, text, text, jsonb) from public, anon, authenticated;
revoke execute on function private.apply_lead_action_fact() from public, anon, authenticated;
revoke execute on function private.capture_activity_attention_fact() from public, anon, authenticated;
revoke execute on function private.capture_whatsapp_attention_fact() from public, anon, authenticated;

grant execute on function private.attention_metadata_is_automated(jsonb) to service_role;
grant execute on function private.record_lead_action_fact(uuid, uuid, uuid, text, text, timestamptz, boolean, boolean, boolean, boolean, boolean, text, text, jsonb) to service_role;

comment on table public.organization_attention_settings is
  'Organization-level kill switches and scheduling defaults for the backend-owned attention engine.';
comment on table public.lead_attention_policies is
  'Versioned cadence/SLA policies. Existing instances retain their policy version.';
comment on table public.lead_action_facts is
  'Canonical classification of human, automated, inbound and operational lead actions.';
comment on table public.lead_attention_instances is
  'Persistent Attention Center work items evaluated and notified by the Go backend.';
comment on column public.organization_attention_settings.max_reminders is
  'Maximum recurring reminders per instance. Zero means unlimited.';
