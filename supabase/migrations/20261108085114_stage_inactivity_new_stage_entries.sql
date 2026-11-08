-- Opt in to considering only leads that enter the stage after activation.
-- Existing policies retain their scope and activation dates.
begin;
set local lock_timeout = '2s';
set local statement_timeout = '30s';

alter table private.stage_inactivity_policies
  drop constraint stage_inactivity_policies_start_mode_check,
  add constraint stage_inactivity_policies_entry_scope_check
    check (start_mode in ('activation', 'include_overdue', 'new_stage_entries'));

comment on column private.stage_inactivity_policies.start_mode is
  'activation: include current leads with a full deadline from activation; new_stage_entries: only leads entering the stage after activation; include_overdue: legacy historical mode.';

commit;
