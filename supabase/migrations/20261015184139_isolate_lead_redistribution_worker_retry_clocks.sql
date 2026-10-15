-- Keep technical worker retries independent from the lead's business clocks.
-- NULL retains the existing schedule. A warning failure must never postpone
-- the due transfer, and a failed transfer must not consume a business attempt.
-- No lead, job, history, notification or counter is backfilled here.
alter table public.lead_redistribution_jobs
  add column warning_retry_at timestamptz,
  add column redistribution_retry_at timestamptz;

comment on column public.lead_redistribution_jobs.warning_retry_at is
  'Backend technical retry eligibility for warnings only. NULL adds no delay; the warning_due_at and due_at business clocks remain authoritative.';
comment on column public.lead_redistribution_jobs.redistribution_retry_at is
  'Backend technical retry eligibility for a transfer only. NULL adds no delay; does not count as an assignment attempt or change due_at/enrolled_at.';

-- Discovery and its stable order use these exact effective clocks. Ordering
-- only by due_at would let expired failures retake the first 50 slots forever.
-- Existing business-clock indexes remain installed for other callers.
create index idx_lead_redistribution_jobs_retry_due
  on public.lead_redistribution_jobs
    ((greatest(due_at, coalesce(redistribution_retry_at, '-infinity'::timestamptz))), id)
  where status in ('pending', 'warning_sent');

create index idx_lead_redistribution_jobs_retry_warning
  on public.lead_redistribution_jobs
    ((greatest(warning_due_at, coalesce(warning_retry_at, '-infinity'::timestamptz))), id)
  where status = 'pending'
    and warning_due_at is not null
    and warning_sent_at is null;

-- A legitimate enrollment/reschedule starts fresh technical eligibility even
-- when an older SQL writer reuses the same job row. Keep this at the row
-- boundary so callers cannot accidentally inherit another assignment's wait.
-- The helper reads no tables and needs no elevated identity or public API.
create function private.reset_lead_redistribution_worker_retry_clocks()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  new.warning_retry_at := null;
  new.redistribution_retry_at := null;
  return new;
end;
$$;
revoke all on function private.reset_lead_redistribution_worker_retry_clocks()
from public,anon,authenticated,service_role;

create trigger trg_reset_lead_redistribution_worker_retry_clocks
before update of current_assigned_user_id,enrolled_at,due_at,warning_due_at,
  attempt_count,round_robin_id,status on public.lead_redistribution_jobs
for each row
when (
  old.current_assigned_user_id is distinct from new.current_assigned_user_id
  or old.enrolled_at is distinct from new.enrolled_at
  or old.due_at is distinct from new.due_at
  or old.warning_due_at is distinct from new.warning_due_at
  or old.attempt_count is distinct from new.attempt_count
  or old.round_robin_id is distinct from new.round_robin_id
  or (old.status not in ('pending','warning_sent') and new.status in ('pending','warning_sent'))
)
execute function private.reset_lead_redistribution_worker_retry_clocks();

-- RLS, table/column ACLs, policies and the one-active-job uniqueness boundary
-- are deliberately inherited unchanged from the production job table.
