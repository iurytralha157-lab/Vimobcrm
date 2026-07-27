begin;

set local lock_timeout = '5s';
set local statement_timeout = '300s';

-- A real stage/pipeline move means the lead is being actively handled. Stop
-- the automatic redistribution in the same transaction as the lead move so
-- no worker can transfer it afterwards using stale enrollment state.
create or replace function private.stop_active_redistribution_on_stage_move()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage_id is not distinct from old.stage_id
     and new.pipeline_id is not distinct from old.pipeline_id then
    return null;
  end if;

  update public.lead_redistribution_jobs
  set status = 'stopped',
      stopped_reason = 'stage_changed',
      stopped_at = now(),
      updated_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'stopped_by', 'lead_stage_change',
        'from_pipeline_id', old.pipeline_id,
        'to_pipeline_id', new.pipeline_id,
        'from_stage_id', old.stage_id,
        'to_stage_id', new.stage_id
      )
  where organization_id = new.organization_id
    and lead_id = new.id
    and status in ('pending', 'warning_sent');

  return null;
end;
$$;

revoke execute on function private.stop_active_redistribution_on_stage_move()
from public, anon, authenticated;

drop trigger if exists trg_stop_redistribution_on_stage_move on public.leads;
create trigger trg_stop_redistribution_on_stage_move
after update of stage_id, pipeline_id on public.leads
for each row
when (
  old.stage_id is distinct from new.stage_id
  or old.pipeline_id is distinct from new.pipeline_id
)
execute function private.stop_active_redistribution_on_stage_move();

-- Repair any active job left behind by a stage move that happened before this
-- invariant existed. This is intentionally limited to a stage clock newer than
-- the redistribution enrollment.
update public.lead_redistribution_jobs j
set status = 'stopped',
    stopped_reason = 'stage_changed',
    stopped_at = now(),
    updated_at = now(),
    metadata = coalesce(j.metadata, '{}'::jsonb) || jsonb_build_object(
      'stopped_by', 'stage_change_backfill'
    )
from public.leads l
where l.organization_id = j.organization_id
  and l.id = j.lead_id
  and j.status in ('pending', 'warning_sent')
  and l.stage_entered_at > j.enrolled_at;

commit;
