-- Bind $1 to the confirmed test organization UUID and use a READ ONLY transaction.
-- Aggregates only. No claim, cleanup, worker call, provider ID or payload output.
with context as (
  select job.id, job.organization_id, job.action, job.status, job.created_at, job.next_run_at,
    job.organization_id = $1::uuid as is_target_organization,
    coalesce(job.payload->>'event_id', job.schedule_event_id::text) as event_key,
    job.attempts < job.max_attempts as attempts_available,
    job.next_run_at <= now() as is_due,
    job.locked_at is not null as has_lock,
    case when job.connection_id is null and job.action in ('push_upsert', 'push_delete')
      and job.status in ('queued', 'failed', 'running', 'dead') then (
        select count(*) from public.google_calendar_tokens candidate
        where candidate.organization_id = job.organization_id
          and candidate.user_id::text = job.payload->>'owner_user_id'
          and candidate.disconnected_at is null
      ) else 0 end as migration_binding_candidates,
    connection.id is not null as connection_exists,
    connection.organization_id = job.organization_id as same_organization,
    connection.user_id::text = job.payload->>'owner_user_id' as owner_matches,
    connection.token_secret_ref is not null as has_credential_reference,
    connection.disconnected_at is null as connection_not_disconnected,
    (to_jsonb(connection)->>'disconnecting_at') is null as connection_not_disconnecting,
    (
      (job.status in ('queued', 'failed') and job.next_run_at <= now())
      or (job.status = 'running' and job.locked_at < now() - interval '2 minutes')
    ) as claimable_window,
    exists (
      select 1 from public.google_calendar_sync_jobs active
      where active.organization_id = job.organization_id and active.id <> job.id
        and coalesce(active.payload->>'event_id', active.schedule_event_id::text)
          = coalesce(job.payload->>'event_id', job.schedule_event_id::text)
        and active.status = 'running'
        and active.locked_at >= now() - interval '2 minutes'
    ) as has_active_sibling,
    (
      job.action = 'push_upsert'
      and (job.status in ('queued', 'failed', 'dead')
        or (job.status = 'running' and job.locked_at < now() - interval '2 minutes'))
      and job.payload->>'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and connection.organization_id = job.organization_id
      and connection.user_id::text = job.payload->>'owner_user_id'
      and not exists (
        select 1 from public.schedule_events event
        where event.id::text = coalesce(job.schedule_event_id::text, job.payload->>'event_id')
          and event.organization_id = job.organization_id
          and event.user_id::text = job.payload->>'owner_user_id'
      )
    ) as obsolete_upsert
  from public.google_calendar_sync_jobs job
  left join public.google_calendar_tokens connection on connection.id = job.connection_id
), eligible as (
  select context.*,
    action in ('push_upsert', 'push_delete') and attempts_available
      and claimable_window and connection_exists and same_organization
      and owner_matches and has_credential_reference
      and connection_not_disconnected and connection_not_disconnecting
      and not has_active_sibling and not coalesce(obsolete_upsert, false)
      as eligible_before_event_order,
    case when created_at > now() then 'future'
         when created_at >= now() - interval '1 hour' then 'under_1_hour'
         when created_at >= now() - interval '1 day' then '1_to_24_hours'
         when created_at >= now() - interval '7 days' then '1_to_7_days'
         else 'over_7_days' end as age_bucket
  from context
), ordered as (
  select id, row_number() over (
    partition by organization_id, event_key order by next_run_at, created_at, id
  ) as event_ordinal
  from eligible
  where eligible_before_event_order
)
select job.is_target_organization, job.action, job.status, job.age_bucket,
  count(*) as jobs,
  count(*) filter (where job.is_due) as due_jobs,
  count(*) filter (where job.has_lock) as with_lock,
  count(*) filter (where job.eligible_before_event_order) as eligible_before_event_order,
  count(*) filter (where ordered.event_ordinal = 1) as eligible_event_heads,
  count(*) filter (where job.obsolete_upsert) as obsolete_upserts,
  count(*) filter (where job.migration_binding_candidates > 0) as would_bind_during_hardening,
  count(*) filter (where job.migration_binding_candidates > 1) as ambiguous_hardening_binding,
  count(*) filter (where not job.connection_exists) as missing_connection,
  count(*) filter (where job.connection_exists and not job.same_organization) as different_connection_tenant,
  count(*) filter (where job.connection_exists and not coalesce(job.owner_matches, false)) as owner_mismatch,
  count(*) filter (where not job.has_credential_reference) as missing_credential_reference,
  count(*) filter (where not job.connection_not_disconnected) as disconnected,
  count(*) filter (where not job.connection_not_disconnecting) as disconnecting,
  count(*) filter (where job.has_active_sibling) as active_sibling
from eligible job
left join ordered on ordered.id = job.id
group by job.is_target_organization, job.action, job.status, job.age_bucket
order by job.is_target_organization desc, job.action, job.status, job.age_bucket;
