-- Internal backend queue for automatic lead redistribution.
-- Important safety rule: no backfill is performed. Only leads explicitly enrolled
-- by the backend at creation time can be redistributed by the worker.

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
  'Internal backend queue for automatic lead redistribution. Rows are created only for new queue-assigned leads.';

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
