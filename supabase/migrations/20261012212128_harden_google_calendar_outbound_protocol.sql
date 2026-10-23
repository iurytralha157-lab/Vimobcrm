-- Forward-only, migration-first. Stop/drain old Edge workers before the cut;
-- old Go producers remain compatible. This does not enable OAuth or Cron.
alter table public.google_calendar_tokens add column if not exists disconnecting_at timestamptz;
alter table public.google_calendar_sync_jobs add column if not exists terminal_reason text;
create index if not exists google_calendar_jobs_event_running_idx
  on public.google_calendar_sync_jobs(organization_id, (payload->>'event_id'), locked_at)
  where status = 'running' and action in ('push_upsert', 'push_delete');
revoke all on public.google_calendar_tokens, public.google_calendar_event_links,
  public.google_calendar_channels, public.google_calendar_sync_jobs, public.google_calendar_oauth_states
  from public, anon, authenticated;
grant select, insert, update, delete on public.google_calendar_tokens, public.google_calendar_event_links,
  public.google_calendar_channels, public.google_calendar_sync_jobs, public.google_calendar_oauth_states to service_role;
alter table public.google_calendar_tokens enable row level security;
alter table public.google_calendar_event_links enable row level security;
alter table public.google_calendar_channels enable row level security;
alter table public.google_calendar_sync_jobs enable row level security;
alter table public.google_calendar_oauth_states enable row level security;

create or replace function private.google_calendar_require_backend()
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
begin
  if session_user not in ('postgres', 'supabase_admin')
    and coalesce(current_setting('role', true), '') <> 'service_role' then
    raise exception 'Google Calendar backend role required' using errcode = '42501';
  end if;
end
$function$;
revoke all on function private.google_calendar_require_backend() from public, anon, authenticated;

create or replace function public.google_calendar_get_token_secret(p_secret_ref uuid)
returns text language plpgsql stable security definer set search_path = pg_catalog
as $function$
begin
  perform private.google_calendar_require_backend();
  return (select decrypted_secret from vault.decrypted_secrets where id = p_secret_ref);
end
$function$;

create or replace function public.google_calendar_save_token_secret(
  p_existing_secret_ref uuid, p_secret text, p_name text, p_description text
) returns uuid language plpgsql security definer set search_path = pg_catalog
as $function$
declare secret_id uuid := p_existing_secret_ref;
begin
  perform private.google_calendar_require_backend();
  if nullif(btrim(p_secret), '') is null then raise exception 'Google token required'; end if;
  if secret_id is null then
    secret_id := vault.create_secret(p_secret, p_name, p_description);
  else
    perform vault.update_secret(secret_id, p_secret, p_name, p_description);
  end if;
  return secret_id;
end
$function$;

create or replace function public.google_calendar_verify_cron_secret(p_secret text)
returns boolean language plpgsql stable security definer set search_path = pg_catalog
as $function$
begin
  perform private.google_calendar_require_backend();
  return coalesce(p_secret = (select decrypted_secret from vault.decrypted_secrets
    where name = 'google_calendar_cron_secret' limit 1), false);
end
$function$;

-- A known removed/transferred event is terminal, not a permanently queued job.
-- In-flight jobs are left alone until their bounded lease expires.
create or replace function private.google_calendar_cancel_obsolete_jobs()
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
begin
  update public.google_calendar_sync_jobs job
  set status = 'succeeded', terminal_reason = 'CANONICAL_EVENT_REMOVED_OR_TRANSFERRED',
      last_error = null, locked_at = null, locked_by = null
  where job.action = 'push_upsert'
    and (job.status in ('queued', 'failed', 'dead')
      or (job.status = 'running' and job.locked_at < now() - interval '2 minutes'))
    and job.payload->>'event_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.google_calendar_tokens token
      where token.id = job.connection_id and token.organization_id = job.organization_id
        and token.user_id::text = job.payload->>'owner_user_id')
    and not exists (select 1 from public.schedule_events event
      where event.id::text = coalesce(job.schedule_event_id::text, job.payload->>'event_id')
        and event.organization_id = job.organization_id
        and event.user_id::text = job.payload->>'owner_user_id');
end
$function$;
revoke all on function private.google_calendar_cancel_obsolete_jobs() from public, anon, authenticated, service_role;

-- Inserts and disconnect preparation take the same short connection row lock.
-- No transaction stays open while talking to Google. An old Go producer that
-- races a disconnect must roll back the CRM command instead of losing its
-- outbound intent if provider revocation later fails.
create or replace function private.google_calendar_guard_outbound_insert()
returns trigger language plpgsql security definer set search_path = pg_catalog
as $function$
declare connection public.google_calendar_tokens;
begin
  if new.action not in ('push_upsert', 'push_delete') then return new; end if;
  select token.* into connection from public.google_calendar_tokens token
  where token.organization_id = new.organization_id
    and token.user_id::text = new.payload->>'owner_user_id'
    and token.disconnected_at is null
    and (new.payload->>'connection_id' is null or token.id::text = new.payload->>'connection_id')
  order by token.created_at desc limit 1 for update;
  if connection.disconnecting_at is not null then
    raise exception 'google_calendar_connection_disconnecting' using errcode = '55P03';
  end if;
  if connection.id is null or connection.token_secret_ref is null then
    return null;
  end if;
  new.connection_id := connection.id;
  return new;
end
$function$;
revoke all on function private.google_calendar_guard_outbound_insert() from public, anon, authenticated, service_role;
drop trigger if exists google_calendar_guard_outbound_insert on public.google_calendar_sync_jobs;
create trigger google_calendar_guard_outbound_insert before insert on public.google_calendar_sync_jobs
for each row execute function private.google_calendar_guard_outbound_insert();

create or replace function public.google_calendar_claim_outbound_sync_jobs_v2(p_limit integer, p_worker text)
returns setof public.google_calendar_sync_jobs
language plpgsql security definer set search_path = pg_catalog
as $function$
begin
  perform private.google_calendar_require_backend();
  if nullif(btrim(p_worker), '') is null then raise exception 'Worker required'; end if;
  -- Serialize only claim transactions, not network calls, across replicas.
  perform pg_advisory_xact_lock(hashtextextended('google-calendar-outbound-claim-v2', 0));
  perform private.google_calendar_cancel_obsolete_jobs();
  return query
  with due as (
    select job.id, job.organization_id, coalesce(job.payload->>'event_id', job.schedule_event_id::text) event_key,
      row_number() over (partition by job.organization_id,
        coalesce(job.payload->>'event_id', job.schedule_event_id::text)
        order by job.next_run_at, job.created_at, job.id) ordinal
    from public.google_calendar_sync_jobs job
    join public.google_calendar_tokens token on token.id = job.connection_id
      and token.organization_id = job.organization_id and token.user_id::text = job.payload->>'owner_user_id'
      and token.disconnected_at is null and token.disconnecting_at is null and token.token_secret_ref is not null
    where job.action in ('push_upsert', 'push_delete') and job.attempts < job.max_attempts
      and ((job.status in ('queued', 'failed') and job.next_run_at <= now())
        or (job.status = 'running' and job.locked_at < now() - interval '2 minutes'))
      and not exists (select 1 from public.google_calendar_sync_jobs active
        where active.organization_id = job.organization_id and active.id <> job.id
          and coalesce(active.payload->>'event_id', active.schedule_event_id::text)
            = coalesce(job.payload->>'event_id', job.schedule_event_id::text)
          and active.status = 'running' and active.locked_at >= now() - interval '2 minutes')
  ), candidates as (
    select job.id from public.google_calendar_sync_jobs job join due on due.id = job.id
    where due.ordinal = 1 order by job.next_run_at, job.created_at, job.id
    for update of job skip locked limit greatest(1, least(coalesce(p_limit, 10), 20))
  )
  update public.google_calendar_sync_jobs job set status = 'running', locked_at = now(),
    locked_by = btrim(p_worker), last_error = null, terminal_reason = null
  from candidates where job.id = candidates.id returning job.*;
end
$function$;

-- Reconcile only the binding of known outbound legacy jobs. Unknown identities
-- remain for review; no provider write occurs in this migration.
update public.google_calendar_sync_jobs job set connection_id = token.id
from public.google_calendar_tokens token
where job.connection_id is null and job.action in ('push_upsert', 'push_delete')
  and job.status in ('queued', 'failed', 'running', 'dead')
  and token.organization_id = job.organization_id and token.user_id::text = job.payload->>'owner_user_id'
  and token.disconnected_at is null;

create or replace function public.google_calendar_job_heartbeat(p_job_id uuid, p_worker text)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $function$
declare changed integer;
begin
  perform private.google_calendar_require_backend();
  update public.google_calendar_sync_jobs job set locked_at = now()
  where job.id = p_job_id and job.status = 'running' and job.locked_by = p_worker
    and job.locked_at >= now() - interval '2 minutes'
    and exists (select 1 from public.google_calendar_tokens token
      where token.id = job.connection_id and token.disconnected_at is null and token.disconnecting_at is null);
  get diagnostics changed = row_count;
  return changed = 1;
end
$function$;

create or replace function public.google_calendar_finish_outbound_job(
  p_job_id uuid, p_worker text, p_status text, p_error text default null,
  p_delay_seconds integer default 0, p_consume_attempt boolean default false,
  p_is_conflict boolean default false
) returns boolean language plpgsql security definer set search_path = pg_catalog
as $function$
declare finished public.google_calendar_sync_jobs;
begin
  perform private.google_calendar_require_backend();
  if p_status not in ('queued', 'succeeded', 'failed', 'dead') then raise exception 'Invalid job outcome'; end if;
  update public.google_calendar_sync_jobs job
  set status = p_status, locked_at = null, locked_by = null,
      attempts = attempts + case when p_consume_attempt then 1 else 0 end,
      next_run_at = now() + make_interval(secs => greatest(0, least(p_delay_seconds, 86400))),
      last_error = left(p_error, 2000)
  where job.id = p_job_id and job.status = 'running' and job.locked_by = p_worker
    and job.locked_at >= now() - interval '2 minutes'
  returning job.* into finished;
  if not found then return false; end if;
  -- Job outcome and visible errors share the same fenced transaction. A late
  -- worker cannot repaint an event/account after another worker's retry has
  -- completed. No network call occurs under these locks.
  if p_status in ('failed', 'dead') then
    if finished.action = 'push_upsert' then
      update public.schedule_events event
      set google_sync_status = case when p_is_conflict then 'conflict' else 'error' end,
          google_sync_error = left(p_error, 2000)
      where event.id::text = coalesce(finished.schedule_event_id::text, finished.payload->>'event_id')
        and event.organization_id = finished.organization_id
        and event.user_id::text = finished.payload->>'owner_user_id';
    elsif finished.action = 'push_delete' then
      update public.google_calendar_event_links link
      set last_error = left(p_error, 2000)
      where link.organization_id = finished.organization_id
        and link.connection_id = finished.connection_id and link.deleted_at is null
        and link.id::text in (select jsonb_array_elements_text(case
          when jsonb_typeof(finished.payload->'link_ids') = 'array' then finished.payload->'link_ids'
          else '[]'::jsonb end));
    end if;
    update public.google_calendar_tokens token
    set sync_status = 'error', last_error = left(p_error, 2000)
    where token.id = finished.connection_id and token.organization_id = finished.organization_id
      and token.user_id::text = finished.payload->>'owner_user_id'
      and token.disconnected_at is null;
  end if;
  return true;
end
$function$;

create or replace function public.google_calendar_begin_disconnect(p_connection_id uuid)
returns boolean language plpgsql security definer set search_path = pg_catalog
as $function$
declare connection public.google_calendar_tokens;
begin
  perform private.google_calendar_require_backend();
  select * into connection from public.google_calendar_tokens where id = p_connection_id for update;
  if connection.id is null or connection.disconnected_at is not null or connection.disconnecting_at is not null then return false; end if;
  perform private.google_calendar_cancel_obsolete_jobs();
  if exists (select 1 from public.google_calendar_sync_jobs job
    where job.organization_id = connection.organization_id
      and job.payload->>'owner_user_id' = connection.user_id::text
      and job.action in ('push_upsert', 'push_delete') and job.status in ('queued', 'running', 'failed', 'dead')) then
    return false;
  end if;
  update public.google_calendar_tokens set disconnecting_at = now() where id = p_connection_id;
  return true;
end
$function$;

create or replace function public.google_calendar_abort_disconnect(p_connection_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
begin
  perform private.google_calendar_require_backend();
  update public.google_calendar_tokens set disconnecting_at = null, sync_status = 'error',
    last_error = 'Nao foi possivel confirmar a revogacao Google. Tente desconectar novamente.'
  where id = p_connection_id and disconnected_at is null;
end
$function$;

create or replace function public.google_calendar_disconnect_connection(p_connection_id uuid)
returns void language plpgsql security definer set search_path = pg_catalog
as $function$
declare connection public.google_calendar_tokens;
begin
  perform private.google_calendar_require_backend();
  select * into connection from public.google_calendar_tokens where id = p_connection_id for update;
  if connection.id is null or connection.disconnected_at is not null then return; end if;
  -- Existing Go organization cleanup calls this helper after provider cleanup.
  -- Preserve that caller, but atomically reject any outbound work that appeared
  -- after its earlier check. New Edge callers prepare before touching Google.
  perform private.google_calendar_cancel_obsolete_jobs();
  if exists (select 1 from public.google_calendar_sync_jobs job
    where job.organization_id = connection.organization_id
      and job.payload->>'owner_user_id' = connection.user_id::text
      and job.action in ('push_upsert', 'push_delete') and job.status in ('queued', 'running', 'failed', 'dead')) then
    raise exception 'Pending Google outbound work';
  end if;
  update public.google_calendar_tokens set token_secret_ref = null, sync_enabled = false,
    sync_status = 'disconnected', disconnected_at = now(), disconnecting_at = null,
    sync_token = null, watch_expires_at = null, last_error = null where id = p_connection_id;
  delete from vault.secrets where id = connection.token_secret_ref;
end
$function$;

-- SECURITY DEFINER is a privileged API. Revoke both inherited PUBLIC and
-- explicit client grants; the role guard is independent defense in depth.
do $grants$
declare signature text;
begin
  foreach signature in array array[
    'google_calendar_get_token_secret(uuid)', 'google_calendar_save_token_secret(uuid,text,text,text)',
    'google_calendar_verify_cron_secret(text)', 'google_calendar_disconnect_connection(uuid)',
    'google_calendar_claim_outbound_sync_jobs_v2(integer,text)', 'google_calendar_job_heartbeat(uuid,text)',
    'google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)',
    'google_calendar_begin_disconnect(uuid)', 'google_calendar_abort_disconnect(uuid)'
  ] loop
    execute 'revoke all on function public.' || signature || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || signature || ' to service_role';
  end loop;
  -- Drain/stop old workers before applying this migration. They cannot claim
  -- jobs via the unfenced interfaces after the cut.
  revoke execute on function public.google_calendar_claim_outbound_sync_jobs(integer,text)
    from public, anon, authenticated, service_role;
  if to_regprocedure('public.google_calendar_claim_sync_jobs(integer,text)') is not null then
    revoke execute on function public.google_calendar_claim_sync_jobs(integer,text)
      from public, anon, authenticated, service_role;
  end if;
end
$grants$;
