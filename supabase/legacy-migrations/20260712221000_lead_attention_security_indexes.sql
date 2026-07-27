-- Explicit backend-only RLS policies and covering indexes for the lead
-- attention engine. Browser roles retain no table privileges.

drop policy if exists "backend manages organization attention settings"
  on public.organization_attention_settings;
create policy "backend manages organization attention settings"
on public.organization_attention_settings
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead attention policies"
  on public.lead_attention_policies;
create policy "backend manages lead attention policies"
on public.lead_attention_policies
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead assignment cycles"
  on public.lead_assignment_cycles;
create policy "backend manages lead assignment cycles"
on public.lead_assignment_cycles
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead stage cycles"
  on public.lead_stage_cycles;
create policy "backend manages lead stage cycles"
on public.lead_stage_cycles
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead action facts"
  on public.lead_action_facts;
create policy "backend manages lead action facts"
on public.lead_action_facts
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead attention instances"
  on public.lead_attention_instances;
create policy "backend manages lead attention instances"
on public.lead_attention_instances
for all to service_role
using (true)
with check (true);

drop policy if exists "backend manages lead attention events"
  on public.lead_attention_events;
create policy "backend manages lead attention events"
on public.lead_attention_events
for all to service_role
using (true)
with check (true);

create index if not exists idx_organization_attention_settings_created_by
  on public.organization_attention_settings (created_by)
  where created_by is not null;

create index if not exists idx_lead_attention_policies_created_by
  on public.lead_attention_policies (created_by)
  where created_by is not null;

create index if not exists idx_lead_action_facts_lead_fk
  on public.lead_action_facts (lead_id);

create index if not exists idx_lead_action_facts_actor_fk
  on public.lead_action_facts (actor_user_id)
  where actor_user_id is not null;

create index if not exists idx_lead_attention_instances_lead_fk
  on public.lead_attention_instances (lead_id);

create index if not exists idx_lead_attention_instances_assigned_user_fk
  on public.lead_attention_instances (assigned_user_id)
  where assigned_user_id is not null;

create index if not exists idx_lead_attention_instances_pipeline_fk
  on public.lead_attention_instances (pipeline_id)
  where pipeline_id is not null;

create index if not exists idx_lead_attention_instances_stage_fk
  on public.lead_attention_instances (stage_id)
  where stage_id is not null;

create index if not exists idx_lead_attention_instances_acknowledged_by_fk
  on public.lead_attention_instances (acknowledged_by)
  where acknowledged_by is not null;

create index if not exists idx_lead_attention_instances_resolved_by_fk
  on public.lead_attention_instances (resolved_by)
  where resolved_by is not null;

create index if not exists idx_lead_attention_events_lead_fk
  on public.lead_attention_events (lead_id);

create index if not exists idx_lead_attention_events_actor_fk
  on public.lead_attention_events (actor_user_id)
  where actor_user_id is not null;

create index if not exists idx_lead_redistribution_jobs_round_robin_fk
  on public.lead_redistribution_jobs (round_robin_id);

create index if not exists idx_lead_redistribution_jobs_original_assignee_fk
  on public.lead_redistribution_jobs (original_assigned_user_id)
  where original_assigned_user_id is not null;

create index if not exists idx_lead_redistribution_jobs_current_assignee_fk
  on public.lead_redistribution_jobs (current_assigned_user_id)
  where current_assigned_user_id is not null;

create index if not exists idx_round_robin_members_team_fk
  on public.round_robin_members (team_id)
  where team_id is not null;
