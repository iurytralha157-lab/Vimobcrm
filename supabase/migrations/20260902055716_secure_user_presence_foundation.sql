begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- This capability is consumed by the backend user-presence endpoint. It must
-- never be used to expose raw activity rows, which also contain navigation and
-- user-agent telemetry.
insert into public.available_permissions (
  key,
  name,
  description,
  category,
  label,
  domain
)
values (
  'users_presence_view',
  'Ver presença da equipe',
  'Visualizar presença no escopo da organização, da concessão administrativa ou das equipes lideradas.',
  'settings',
  'Ver presença da equipe',
  'settings'
)
on conflict (key) do update
set name = excluded.name,
    description = excluded.description,
    category = excluded.category,
    label = excluded.label,
    domain = excluded.domain;

alter table public.user_activity_sessions enable row level security;

-- Policies are permissive by default and combine with OR. Reconcile every
-- historical SELECT policy before installing the one safe browser contract.
do $drop_user_activity_select_policies$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'user_activity_sessions'
      and cmd = 'SELECT'
  loop
    execute format(
      'drop policy %I on public.user_activity_sessions',
      policy_row.policyname
    );
  end loop;
end
$drop_user_activity_select_policies$;

create policy "users read own activity sessions"
on public.user_activity_sessions
for select
to authenticated
using (
  user_id = (select auth.uid())
  and (select private.is_org_member(organization_id))
);

-- Equality predicates come first and recency last. The id is a deterministic
-- tie-breaker for DISTINCT ON/latest-session scans and bounded pruning.
create index if not exists idx_user_activity_sessions_org_user_last_seen
  on public.user_activity_sessions (
    organization_id,
    user_id,
    last_seen_at desc,
    id desc
  );

comment on index public.idx_user_activity_sessions_org_user_last_seen is
  'Supports per-organization latest-presence aggregation and retention scans.';

-- Keep the newest row for each organization/user so a long-inactive account
-- retains its last-access timestamp. Older rows are removed in bounded batches;
-- stale retained rows lose navigation/user-agent telemetry and become offline.
create or replace function private.prune_user_activity_sessions(
  p_organization_id uuid default null,
  p_retention interval default interval '30 days',
  p_batch_size integer default 10000,
  p_now timestamptz default pg_catalog.clock_timestamp()
)
returns integer
language plpgsql
volatile
security invoker
set search_path = ''
as $function$
declare
  v_deleted integer := 0;
begin
  if p_now is null then
    raise exception using
      errcode = '22004',
      message = 'user_activity_prune_now_required';
  end if;

  if p_retention is null
     or p_retention < interval '1 day'
     or p_retention > interval '365 days' then
    raise exception using
      errcode = '22023',
      message = 'user_activity_prune_retention_out_of_range';
  end if;

  if p_batch_size is null
     or p_batch_size < 1
     or p_batch_size > 50000 then
    raise exception using
      errcode = '22023',
      message = 'user_activity_prune_batch_size_out_of_range';
  end if;

  with candidates as materialized (
    select stale.id
    from public.user_activity_sessions as stale
    where (p_organization_id is null
           or stale.organization_id = p_organization_id)
      and stale.last_seen_at < p_now - p_retention
      and exists (
        select 1
        from public.user_activity_sessions as newer
        where newer.organization_id = stale.organization_id
          and newer.user_id = stale.user_id
          and (
            newer.last_seen_at > stale.last_seen_at
            or (
              newer.last_seen_at = stale.last_seen_at
              and newer.id > stale.id
            )
          )
      )
    order by
      stale.organization_id,
      stale.user_id,
      stale.last_seen_at,
      stale.id
    for update of stale skip locked
    limit p_batch_size
  )
  delete from public.user_activity_sessions as stale
  using candidates
  where stale.id = candidates.id;

  get diagnostics v_deleted = row_count;

  with candidates as materialized (
    select stale.id
    from public.user_activity_sessions as stale
    where (p_organization_id is null
           or stale.organization_id = p_organization_id)
      and stale.last_seen_at < p_now - p_retention
      and not exists (
        select 1
        from public.user_activity_sessions as newer
        where newer.organization_id = stale.organization_id
          and newer.user_id = stale.user_id
          and (
            newer.last_seen_at > stale.last_seen_at
            or (
              newer.last_seen_at = stale.last_seen_at
              and newer.id > stale.id
            )
          )
      )
      and (
        stale.status <> 'offline'
        or stale.disconnected_at is null
        or stale.current_path is not null
        or stale.current_page_title is not null
        or stale.user_agent is not null
        or stale.metadata <> '{}'::jsonb
      )
    order by
      stale.organization_id,
      stale.user_id,
      stale.last_seen_at,
      stale.id
    for update of stale skip locked
    limit p_batch_size
  )
  update public.user_activity_sessions as stale
  set status = 'offline',
      disconnected_at = coalesce(stale.disconnected_at, stale.last_seen_at),
      current_path = null,
      current_page_title = null,
      user_agent = null,
      metadata = '{}'::jsonb,
      updated_at = p_now
  from candidates
  where stale.id = candidates.id;

  return v_deleted;
end;
$function$;

comment on function private.prune_user_activity_sessions(
  uuid,
  interval,
  integer,
  timestamptz
) is
  'Deletes stale superseded activity sessions in bounded batches and sanitizes each inactive user latest retained row.';

revoke all on function private.prune_user_activity_sessions(
  uuid,
  interval,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

grant execute on function private.prune_user_activity_sessions(
  uuid,
  interval,
  integer,
  timestamptz
) to service_role;

-- pg_cron is optional across deployments. Install the maintenance function in
-- every environment, but only register the hourly job when Cron is available.
do $schedule_user_activity_pruning$
declare
  existing_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise notice
      'pg_cron unavailable; user activity pruning can be invoked by service_role';
  else
    for existing_job_id in
      select job.jobid
      from cron.job as job
      where job.jobname = 'prune-user-activity-sessions'
    loop
      perform cron.unschedule(existing_job_id);
    end loop;

    perform cron.schedule(
      'prune-user-activity-sessions',
      '17 * * * *',
      'select private.prune_user_activity_sessions();'
    );
  end if;
end
$schedule_user_activity_pruning$;

commit;
