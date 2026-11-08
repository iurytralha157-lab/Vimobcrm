-- Stage rule "move the lead to another stage after X days without interaction".
-- It reuses the explicit stage inactivity runtime: the policy now says which
-- action its due episodes perform. Existing policies keep the notify action.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table private.stage_inactivity_policies
  add column action_kind text not null default 'notify',
  add column target_stage_id uuid references public.stages(id) on delete cascade,
  -- The manager who saved the rule. Moves run with this user's permissions and
  -- stop (the job fails) once that user can no longer operate leads.
  add column acting_user_id uuid references public.users(id) on delete set null,
  add constraint stage_inactivity_policies_action_kind_check
    check (action_kind in ('notify', 'move_stage')),
  add constraint stage_inactivity_policies_move_target_check
    check ((action_kind = 'move_stage') = (target_stage_id is not null)),
  add constraint stage_inactivity_policies_move_target_distinct_check
    check (target_stage_id is null or target_stage_id <> stage_id),
  add constraint stage_inactivity_policies_move_actor_check
    check (action_kind <> 'move_stage' or not is_enabled or acting_user_id is not null);

-- Archive guards and cycle validation look up rules by their destination.
create index stage_inactivity_policy_move_target
  on private.stage_inactivity_policies(organization_id, target_stage_id)
  where target_stage_id is not null;

alter table private.stage_inactivity_jobs
  drop constraint stage_inactivity_jobs_status_check,
  add constraint stage_inactivity_jobs_status_check
    check (status in ('pending', 'notified', 'moved', 'cancelled', 'dead')),
  add column moved_to_stage_id uuid,
  add column moved_at timestamptz;

comment on column private.stage_inactivity_policies.action_kind is
  'notify: in-app alert to the assignee. move_stage: canonical stage move to target_stage_id.';
comment on column private.stage_inactivity_policies.acting_user_id is
  'Manager whose permissions authorize automatic moves; recorded in the audit log.';

commit;
