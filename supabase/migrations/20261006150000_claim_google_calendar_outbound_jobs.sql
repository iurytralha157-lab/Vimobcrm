-- Vimob is the source of schedule events. The pilot claims outbound jobs only
-- for explicitly enabled users and never claims Google -> Vimob jobs.
-- Old jobs without a verifiable owner (and delete jobs without a connection)
-- remain queued for audit instead of being routed to a different owner.
create or replace function public.google_calendar_claim_outbound_sync_jobs(
  p_limit integer,
  p_worker text,
  p_user_ids uuid[]
)
returns setof public.google_calendar_sync_jobs
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if nullif(btrim(p_worker), '') is null then
    raise exception 'Google Agenda worker name is required';
  end if;
  if p_user_ids is null then
    raise exception 'Google Agenda allowed users are required';
  end if;
  return query
  with candidates as (
    select jobs.id
    from public.google_calendar_sync_jobs jobs
    where (
        (
          jobs.action = 'push_upsert'
          and exists (
            select 1
            from public.schedule_events event
            where event.id = jobs.schedule_event_id
              and event.organization_id = jobs.organization_id
              and event.user_id = any(p_user_ids)
              and event.user_id::text = jobs.payload->>'owner_user_id'
          )
        )
        or (
          jobs.action = 'push_delete'
          and exists (
            select 1
            from public.google_calendar_tokens connection
            where connection.organization_id = jobs.organization_id
              and connection.id::text = jobs.payload->>'connection_id'
              and connection.user_id::text = jobs.payload->>'owner_user_id'
              and connection.user_id = any(p_user_ids)
              and connection.disconnected_at is null
          )
        )
      )
      and jobs.attempts < jobs.max_attempts
      and (
        (
          jobs.status in ('queued', 'failed')
          and jobs.next_run_at <= now()
        )
        or (
          jobs.status = 'running'
          and jobs.locked_at < now() - interval '5 minutes'
        )
      )
    order by jobs.next_run_at, jobs.created_at, jobs.id
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 10), 100))
  )
  update public.google_calendar_sync_jobs claimed
  set status = 'running',
      locked_at = now(),
      locked_by = btrim(p_worker),
      last_error = null
  from candidates
  where claimed.id = candidates.id
  returning claimed.*;
end
$function$;

revoke all on function public.google_calendar_claim_outbound_sync_jobs(integer, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.google_calendar_claim_outbound_sync_jobs(integer, text, uuid[])
  to service_role;

-- An older deployed worker must not bypass the per-user gate by calling the
-- generic claim RPC. Retire its service-role entry point during the one-way cut.
do $block$
begin
  if to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)') is not null then
    revoke execute on function public.google_calendar_claim_sync_jobs(integer, text)
      from service_role;
  end if;
end
$block$;
