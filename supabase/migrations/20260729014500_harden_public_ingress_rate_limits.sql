-- Shared, database-backed rate limits for unauthenticated ingress.
--
-- The subject is hashed by the API before it reaches Postgres. Keeping the
-- counter in Postgres makes the limit consistent across API replicas without
-- retaining a raw client IP address.

create unlogged table private.public_ingress_rate_limits (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  request_count integer not null default 1,
  updated_at timestamptz not null default clock_timestamp(),
  constraint public_ingress_rate_limits_pkey
    primary key (scope, subject_hash, window_started_at),
  constraint public_ingress_rate_limits_scope_check
    check (
      scope = btrim(scope)
      and length(scope) between 1 and 100
    ),
  constraint public_ingress_rate_limits_subject_hash_check
    check (subject_hash ~ '^[0-9a-f]{64}$'),
  constraint public_ingress_rate_limits_request_count_check
    check (request_count > 0)
);

create index public_ingress_rate_limits_updated_idx
  on private.public_ingress_rate_limits (updated_at);

revoke all on table private.public_ingress_rate_limits
  from public, anon, authenticated, service_role;

create function private.check_public_ingress_rate_limit(
  p_scope text,
  p_subject_hash text,
  p_limit integer,
  p_window_seconds integer,
  p_now timestamptz default clock_timestamp()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_window_started_at timestamptz;
  v_request_count integer;
begin
  p_scope := btrim(coalesce(p_scope, ''));
  p_subject_hash := lower(btrim(coalesce(p_subject_hash, '')));
  p_now := coalesce(p_now, clock_timestamp());

  if length(p_scope) not between 1 and 100
     or p_subject_hash !~ '^[0-9a-f]{64}$'
     or p_limit not between 1 and 100000
     or p_window_seconds not between 1 and 86400 then
    raise exception using
      errcode = '22023',
      message = 'invalid_public_ingress_rate_limit';
  end if;

  v_window_started_at := pg_catalog.to_timestamp(
    pg_catalog.floor(
      extract(epoch from p_now) / p_window_seconds
    ) * p_window_seconds
  );

  insert into private.public_ingress_rate_limits (
    scope,
    subject_hash,
    window_started_at,
    request_count,
    updated_at
  )
  values (
    p_scope,
    p_subject_hash,
    v_window_started_at,
    1,
    p_now
  )
  on conflict (scope, subject_hash, window_started_at)
  do update
  set request_count = least(
        private.public_ingress_rate_limits.request_count + 1,
        p_limit + 1
      ),
      updated_at = excluded.updated_at
  returning request_count
  into v_request_count;

  return v_request_count <= p_limit;
end
$function$;

comment on function private.check_public_ingress_rate_limit(
  text,
  text,
  integer,
  integer,
  timestamptz
) is
  'Replica-safe fixed-window limiter for server-derived, SHA-256 ingress identities.';

revoke all on function private.check_public_ingress_rate_limit(
  text,
  text,
  integer,
  integer,
  timestamptz
) from public, anon, authenticated, service_role;

create function private.cleanup_public_ingress_rate_limits()
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  v_removed integer;
begin
  with removed as (
    delete from private.public_ingress_rate_limits
    where updated_at < clock_timestamp() - interval '2 days'
    returning 1
  )
  select count(*)::integer
  into v_removed
  from removed;

  return v_removed;
end
$function$;

revoke all on function private.cleanup_public_ingress_rate_limits()
  from public, anon, authenticated, service_role;

do $schedule_public_ingress_cleanup$
declare
  v_job_id bigint;
begin
  if pg_catalog.to_regclass('cron.job') is null
     or pg_catalog.to_regprocedure('cron.schedule(text,text,text)') is null
     or pg_catalog.to_regprocedure('cron.unschedule(bigint)') is null then
    raise exception using
      errcode = '55000',
      message = 'public_ingress_rate_limit_cron_unavailable';
  end if;

  for v_job_id in
    select job.jobid
    from cron.job as job
    where job.jobname = 'cleanup-public-ingress-rate-limits'
  loop
    perform cron.unschedule(v_job_id);
  end loop;

  perform cron.schedule(
    'cleanup-public-ingress-rate-limits',
    '17 * * * *',
    'select private.cleanup_public_ingress_rate_limits();'
  );
end
$schedule_public_ingress_cleanup$;
