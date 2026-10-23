-- Candidate only: no policy is inserted, enabled or backfilled by this migration.
-- The API worker is not registered until explicit product choices and rollout.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

create table private.stage_inactivity_policies (
  automation_id uuid primary key references public.stage_automations(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  activation_epoch uuid not null,
  revision bigint not null check (revision > 0),
  clock text not null check (clock in ('stage_entry', 'last_interaction')),
  start_mode text not null check (start_mode in ('activation', 'include_overdue')),
  activated_at timestamptz not null,
  automation_updated_at timestamptz not null,
  interaction_coverage_from timestamptz,
  duration_days integer not null check (duration_days between 1 and 3650),
  alert_message text not null default '' check (char_length(alert_message) <= 1000),
  is_enabled boolean not null default false,
  scan_after_lead_id uuid,
  next_scan_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (clock <> 'last_interaction' or interaction_coverage_from is not null)
);

create index stage_inactivity_policy_due on private.stage_inactivity_policies(next_scan_at, automation_id)
  where is_enabled = true;
create index stage_inactivity_policy_scope on private.stage_inactivity_policies(organization_id, stage_id)
  where is_enabled = true;

create table private.stage_inactivity_lead_scopes (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  stage_id uuid not null references public.stages(id) on delete cascade,
  stage_entered_at timestamptz not null,
  cycle_id uuid not null default gen_random_uuid(),
  started_at timestamptz not null,
  is_open boolean not null,
  primary key (organization_id, lead_id)
);

create table private.stage_inactivity_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  automation_id uuid not null references private.stage_inactivity_policies(automation_id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  activation_epoch uuid not null,
  policy_revision bigint not null check (policy_revision > 0),
  lead_cycle_id uuid not null,
  episode_key text not null check (length(episode_key) = 64),
  baseline_at timestamptz not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'notified', 'cancelled', 'dead')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(),
  error_code text,
  notified_user_id uuid,
  notified_membership_generation bigint,
  notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, automation_id, activation_epoch, episode_key)
);

create index stage_inactivity_job_due on private.stage_inactivity_jobs(next_attempt_at, due_at, id)
  where status = 'pending';
create index stage_inactivity_job_scope on private.stage_inactivity_jobs(organization_id, lead_id, created_at desc);
-- The public/hot leads index is a separate concurrent cutover. Never build it
-- under this transaction: worker readiness checks its exact valid definition.

alter table private.stage_inactivity_policies enable row level security;
alter table private.stage_inactivity_lead_scopes enable row level security;
alter table private.stage_inactivity_jobs enable row level security;
revoke all on private.stage_inactivity_policies, private.stage_inactivity_lead_scopes, private.stage_inactivity_jobs from public, anon, authenticated;
grant select, insert, update, delete on private.stage_inactivity_policies, private.stage_inactivity_lead_scopes, private.stage_inactivity_jobs to service_role;

comment on table private.stage_inactivity_policies is 'Explicit candidate policy for simple stage inactivity. Empty by migration; old automations are not activated.';
comment on column private.stage_inactivity_policies.automation_updated_at is 'CAS fence against legacy automation edits, never an activity or activation clock.';
comment on column private.stage_inactivity_policies.activation_epoch is 'Fresh server-generated identity for each explicit activation/reactivation.';
comment on column private.stage_inactivity_policies.interaction_coverage_from is 'Server-verified beginning of complete interaction coverage. Missing older facts never prove inactivity.';
comment on table private.stage_inactivity_jobs is 'Durable idempotent in-app notification episodes. No external delivery intent is created.';

-- A reopen in the same stage must not reuse the old episode. Unrelated lead
-- edits and assignment changes preserve the scope and its original clock.
create function private.capture_simple_stage_inactivity_scope() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if private.historical_import_effects_suppressed()
     or coalesce(new.operational_effects_suppressed, false) then
    return null;
  end if;
  if tg_op = 'UPDATE'
     and new.stage_id is not distinct from old.stage_id
     and new.pipeline_id is not distinct from old.pipeline_id
     and new.stage_entered_at is not distinct from old.stage_entered_at
     and new.deal_status is not distinct from old.deal_status then
    return null;
  end if;

  if new.stage_id is null or new.deal_status is distinct from 'open' then
    update private.stage_inactivity_lead_scopes
    set is_open = false
    where organization_id = new.organization_id and lead_id = new.id;
    return null;
  end if;

  if not exists (
    select 1 from private.stage_inactivity_policies policy
    join public.stage_automations automation
      on automation.id = policy.automation_id
     and automation.organization_id = policy.organization_id
     and automation.stage_id = policy.stage_id
     and automation.updated_at = policy.automation_updated_at
     and automation.trigger_type = 'inactivity'
     and automation.is_active = true
    where policy.organization_id = new.organization_id
      and policy.stage_id = new.stage_id and policy.is_enabled = true
  ) and not exists (
    select 1 from private.stage_inactivity_lead_scopes existing_scope
    where existing_scope.organization_id = new.organization_id
      and existing_scope.lead_id = new.id
  ) then
    return null;
  end if;

  insert into private.stage_inactivity_lead_scopes (
    organization_id, lead_id, stage_id, stage_entered_at, cycle_id, started_at, is_open
  ) values (
    new.organization_id, new.id, new.stage_id,
    coalesce(new.stage_entered_at, new.created_at, now()), gen_random_uuid(),
    case when tg_op = 'UPDATE' and old.deal_status is distinct from 'open' then now()
         else coalesce(new.stage_entered_at, new.created_at, now()) end,
    true
  ) on conflict (organization_id, lead_id) do update set
    stage_id = excluded.stage_id, stage_entered_at = excluded.stage_entered_at,
    cycle_id = excluded.cycle_id, started_at = excluded.started_at, is_open = true;
  return null;
end;
$$;

revoke all on function private.capture_simple_stage_inactivity_scope() from public, anon, authenticated;
grant execute on function private.capture_simple_stage_inactivity_scope() to service_role;
create trigger zz_capture_simple_stage_inactivity_scope after insert or update of stage_id, pipeline_id, stage_entered_at, deal_status
  on public.leads for each row execute function private.capture_simple_stage_inactivity_scope();

-- Preserve existing attention/cadence eligibility and classification. Expand
-- future durable facts for an explicitly configured last_interaction policy,
-- including paused rules. The writer first commits a disabled policy, then
-- activates it in a later transaction, so facts already have complete coverage
-- during activation commit. Legacy rules with no policy remain untouched;
-- no old messages/actions are fabricated or imported. Qualifying inbound human
-- replies remain interactions; automated actions do not reset the worker clock.
create or replace function private.record_lead_action_fact(
  p_organization_id uuid, p_lead_id uuid, p_actor_user_id uuid,
  p_action_type text, p_channel text, p_occurred_at timestamptz,
  p_is_automated boolean, p_is_inbound boolean,
  p_qualifies_first_outreach boolean, p_qualifies_stage_inactivity boolean,
  p_is_effective_contact boolean, p_source_type text, p_source_id text, p_metadata jsonb
) returns void language plpgsql set search_path = 'public', 'private', 'pg_temp' as $$
declare
  current_assignment_cycle_id uuid;
  current_stage_cycle_id uuid;
begin
  if private.historical_import_effects_suppressed() then return; end if;
  perform 1 from public.leads lead
  left join public.stage_operational_configs rule
    on rule.organization_id = lead.organization_id and rule.stage_id = lead.stage_id
  where lead.id = p_lead_id and lead.organization_id = p_organization_id
    and lead.operational_effects_suppressed = false
    and (
      lead.attention_eligible = true
      or (lead.deal_status = 'open'
        and coalesce(rule.config->>'operational_rules_version', '') = '1'
        and (coalesce(rule.cadence_enabled, false)
          or (coalesce(nullif(rule.config->>'attention_source_mode', ''),
                case when rule.attention_mode = 'disabled' then 'inherit' else 'local' end) = 'local'
            and rule.attention_mode in ('shadow', 'enabled'))))
      or (lead.deal_status = 'open' and exists (
        select 1 from private.stage_inactivity_policies policy
        where policy.organization_id = lead.organization_id and policy.stage_id = lead.stage_id
          and policy.clock = 'last_interaction'
      ))
    ) for share of lead;
  if not found then return; end if;

  select id into current_assignment_cycle_id from public.lead_assignment_cycles
    where organization_id = p_organization_id and lead_id = p_lead_id and ended_at is null
    order by assigned_at desc, id desc limit 1;
  select id into current_stage_cycle_id from public.lead_stage_cycles
    where organization_id = p_organization_id and lead_id = p_lead_id and exited_at is null
    order by entered_at desc, id desc limit 1;

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
  ) on conflict (organization_id, source_type, source_id) where source_id is not null do nothing;
end;
$$;

alter function private.record_lead_action_fact(uuid, uuid, uuid, text, text, timestamptz, boolean, boolean, boolean, boolean, boolean, text, text, jsonb) owner to postgres;
revoke all on function private.record_lead_action_fact(uuid, uuid, uuid, text, text, timestamptz, boolean, boolean, boolean, boolean, boolean, text, text, jsonb) from public, anon, authenticated;
grant execute on function private.record_lead_action_fact(uuid, uuid, uuid, text, text, timestamptz, boolean, boolean, boolean, boolean, boolean, text, text, jsonb) to service_role;
commit;
