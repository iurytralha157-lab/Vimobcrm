-- Vimob is the source of schedule events. Claim only outbound jobs for an
-- active connection belonging to the event owner in the same organization.
-- Old jobs without a verifiable owner or connection remain queued for audit.
-- No Google -> Vimob action can be claimed by this worker.
drop function if exists public.google_calendar_claim_outbound_sync_jobs(integer, text, uuid[]);

create or replace function public.google_calendar_claim_outbound_sync_jobs(
  p_limit integer,
  p_worker text
)
returns setof public.google_calendar_sync_jobs
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if nullif(btrim(p_worker), '') is null then
    raise exception 'Google Agenda worker name is required';
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
            join public.users owner
              on owner.id = event.user_id
             and owner.is_active is true
            join public.google_calendar_tokens connection
              on connection.organization_id = event.organization_id
             and connection.user_id = event.user_id
             and connection.disconnected_at is null
             and connection.token_secret_ref is not null
            where event.id = jobs.schedule_event_id
              and event.organization_id = jobs.organization_id
              and event.user_id::text = jobs.payload->>'owner_user_id'
              and (jobs.connection_id is null or jobs.connection_id = connection.id)
              and (
                (owner.role = 'super_admin' and owner.organization_id = jobs.organization_id)
                or exists (
                  select 1
                  from public.organization_members membership
                  where membership.organization_id = jobs.organization_id
                    and membership.user_id = owner.id
                    and membership.is_active is true
                    and membership.deleted_at is null
                )
              )
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
              and connection.disconnected_at is null
              and connection.token_secret_ref is not null
              and (jobs.connection_id is null or jobs.connection_id = connection.id)
              and nullif(jobs.payload->>'event_id', '') is not null
              and (
                jobs.schedule_event_id is null
                or jobs.schedule_event_id::text = jobs.payload->>'event_id'
              )
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

revoke all on function public.google_calendar_claim_outbound_sync_jobs(integer, text)
  from public, anon, authenticated;
grant execute on function public.google_calendar_claim_outbound_sync_jobs(integer, text)
  to service_role;

-- An older deployed worker must not claim inbound jobs through the generic
-- entry point during the one-way cut.
do $block$
begin
  if to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)') is not null then
    revoke execute on function public.google_calendar_claim_sync_jobs(integer, text)
      from public, anon, authenticated, service_role;
  end if;
end
$block$;
