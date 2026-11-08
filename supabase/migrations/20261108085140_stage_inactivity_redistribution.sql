-- Add a separately configurable redistribution action to the existing worker.
-- Apply before the new API. Activate this action only after all replicas
-- understand it. The previous worker rejects unknown policy actions.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table private.stage_inactivity_policies
  add column target_round_robin_id uuid,
  drop constraint stage_inactivity_policies_action_kind_check,
  add constraint stage_inactivity_policies_action_kind_check
    check (action_kind in ('notify', 'move_stage', 'redistribute')),
  add constraint stage_inactivity_policies_redistribution_target_check
    check ((action_kind = 'redistribute') = (target_round_robin_id is not null)),
  add constraint stage_inactivity_policies_redistribution_actor_check
    check (action_kind <> 'redistribute' or not is_enabled or acting_user_id is not null);

create unique index stage_inactivity_one_enabled_redistribution
  on private.stage_inactivity_policies(organization_id, stage_id)
  where is_enabled and action_kind = 'redistribute';

alter table private.stage_inactivity_jobs
  drop constraint stage_inactivity_jobs_status_check,
  add constraint stage_inactivity_jobs_status_check
    -- Existing statuses are a subset of this check. Avoid scanning the job
    -- ledger while holding the table lock.
    check (status in ('pending', 'notified', 'moved', 'redistributed', 'cancelled', 'dead')) not valid,
  add column redistributed_at timestamptz;

comment on column private.stage_inactivity_policies.target_round_robin_id is
  'Selected queue; validated in the tenant at save and execution. Kept as a reference when the queue is removed.';

commit;
