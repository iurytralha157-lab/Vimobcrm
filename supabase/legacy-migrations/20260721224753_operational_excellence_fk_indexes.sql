set local lock_timeout = '5s';
set local statement_timeout = '120s';

create index if not exists idx_cadence_enrollments_assigned_user
  on public.cadence_enrollments (assigned_user_id)
  where assigned_user_id is not null;

create index if not exists idx_cadence_enrollments_template
  on public.cadence_enrollments (cadence_template_id);

create index if not exists idx_lead_tasks_cadence_template_task
  on public.lead_tasks (cadence_template_task_id)
  where cadence_template_task_id is not null;

create index if not exists idx_push_delivery_events_push_token
  on public.push_delivery_events (push_token_id)
  where push_token_id is not null;

create index if not exists idx_push_delivery_events_user
  on public.push_delivery_events (user_id);

create index if not exists idx_round_robins_target_stage
  on public.round_robins (target_stage_id)
  where target_stage_id is not null;
