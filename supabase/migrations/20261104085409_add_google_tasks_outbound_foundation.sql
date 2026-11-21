-- Additive, opt-in outbound routing. Existing Calendar links and IDs keep their
-- meaning. Deploy the v3 worker before enabling routing or the new Go producer.
-- Rollback disables new opt-ins; retain the v3 worker until v2 intents drain.
set lock_timeout = '5s';

alter table public.google_calendar_tokens
  add column tasks_authorized boolean not null default false,
  add column tasks_list_id text,
  add column routing_v2 boolean not null default false,
  add column tasks_list_creation_attempt uuid not null default gen_random_uuid(),
  add column tasks_list_creation_state text not null default 'reserved'
    check(tasks_list_creation_state in ('reserved','started','linked','review'));
alter table public.google_calendar_oauth_states add column enable_tasks boolean not null default false;
alter table public.schedule_events
  add column google_sync_target text check(google_sync_target in ('calendar','tasks')),
  add column google_task_id text;

create table public.google_tasks_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.google_calendar_tokens(id) on delete cascade,
  vimob_event_id uuid not null,
  schedule_event_id uuid references public.schedule_events(id) on delete set null,
  tasklist_id text not null,
  task_id text,
  source_updated_at timestamptz,
  creation_attempt uuid not null default gen_random_uuid(),
  creation_state text not null default 'reserved'
    check(creation_state in ('reserved','started','linked','deleted','review')),
  google_etag text,
  google_status text,
  last_synced_at timestamptz,
  last_error text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check((creation_state='linked' and task_id is not null) or creation_state<>'linked'),
  unique(connection_id,tasklist_id,task_id)
);
create unique index google_tasks_links_active_event_idx
  on public.google_tasks_links(organization_id,connection_id,vimob_event_id) where deleted_at is null;
create index google_tasks_links_schedule_idx on public.google_tasks_links(organization_id,schedule_event_id)
  where schedule_event_id is not null;
alter table public.google_tasks_links enable row level security;
revoke all on public.google_tasks_links from public,anon,authenticated;
grant select,insert,update,delete on public.google_tasks_links to service_role;

-- Both old and new Go producers are covered. Only this server-side trigger
-- chooses the destination; a caller-supplied target cannot override the type.
create or replace function private.google_calendar_guard_outbound_insert()
returns trigger language plpgsql security definer set search_path=pg_catalog as $function$
declare connection public.google_calendar_tokens; canonical public.schedule_events; event_id uuid;
begin
  if new.action not in ('push_upsert','push_delete') then return new; end if;
  select token.* into connection from public.google_calendar_tokens token
    where token.organization_id=new.organization_id and token.user_id::text=new.payload->>'owner_user_id'
      and token.disconnected_at is null
      and (new.payload->>'connection_id' is null or token.id::text=new.payload->>'connection_id')
    order by token.created_at desc limit 1 for update;
  if connection.disconnecting_at is not null then
    raise exception 'google_calendar_connection_disconnecting' using errcode='55P03';
  end if;
  if connection.id is null or connection.token_secret_ref is null then return null; end if;
  new.connection_id:=connection.id;
  if coalesce(new.payload->>'protocol_version','1')='2' or connection.routing_v2 then
    event_id:=coalesce(new.schedule_event_id,(new.payload->>'event_id')::uuid);
    select * into canonical from public.schedule_events event
      where event.id=event_id and event.organization_id=new.organization_id;
    if new.action='push_upsert' and (canonical.id is null or canonical.user_id<>connection.user_id) then return null; end if;
    new.payload:=new.payload||jsonb_build_object(
      'protocol_version',2,'event_id',event_id,'connection_id',connection.id,
      'source_updated_at',canonical.updated_at,
      'target',case when new.action='push_delete' then coalesce(new.payload->>'target',canonical.google_sync_target,'calendar')
        when connection.routing_v2 and canonical.event_type in ('task','message','email','call') then 'tasks' else 'calendar' end,
      'task_link_ids',coalesce((select jsonb_agg(link.id::text order by link.id)
        from public.google_tasks_links link where link.organization_id=new.organization_id
          and link.connection_id=connection.id and link.vimob_event_id=event_id and link.deleted_at is null),'[]'::jsonb));
  end if;
  return new;
end
$function$;

-- Keep the v2 API callable by old workers, but never give them Tasks intents.
-- Both claims use the same advisory lock and the same per-event lease fence.
create or replace function private.google_calendar_claim_outbound_protocol(p_limit integer,p_worker text,p_allow_v2 boolean)
returns setof public.google_calendar_sync_jobs language plpgsql security definer set search_path=pg_catalog as $function$
begin
  perform private.google_calendar_require_backend();
  if nullif(btrim(p_worker),'') is null then raise exception 'Worker required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('google-calendar-outbound-claim-v2',0));
  perform private.google_calendar_cancel_obsolete_jobs();
  return query with due as (
    select job.id,token.credential_revision,
      row_number() over(partition by job.organization_id,coalesce(job.payload->>'event_id',job.schedule_event_id::text)
        order by job.next_run_at,job.created_at,job.id) ordinal
    from public.google_calendar_sync_jobs job join public.google_calendar_tokens token
      on token.id=job.connection_id and token.organization_id=job.organization_id
        and token.user_id::text=job.payload->>'owner_user_id' and token.disconnected_at is null
        and token.disconnecting_at is null and token.token_secret_ref is not null
    where job.action in ('push_upsert','push_delete') and job.attempts<job.max_attempts
      and (p_allow_v2 or (coalesce(job.payload->>'protocol_version','1')='1' and not token.routing_v2))
      and ((job.status in ('queued','failed') and job.next_run_at<=now())
        or (job.status='running' and job.locked_at<now()-interval '2 minutes'))
      and not exists(select 1 from public.google_calendar_sync_jobs active where active.organization_id=job.organization_id
        and active.id<>job.id and coalesce(active.payload->>'event_id',active.schedule_event_id::text)
          =coalesce(job.payload->>'event_id',job.schedule_event_id::text)
        and active.status='running' and active.locked_at>=now()-interval '2 minutes')
  ), candidates as (
    select job.id,due.credential_revision from public.google_calendar_sync_jobs job join due on due.id=job.id
      where due.ordinal=1 order by job.next_run_at,job.created_at,job.id
      for update of job skip locked limit greatest(1,least(coalesce(p_limit,10),20))
  ) update public.google_calendar_sync_jobs job set status='running',locked_at=now(),locked_by=btrim(p_worker),
      last_error=null,terminal_reason=null,
      payload=job.payload||jsonb_build_object('claimed_credential_revision',candidates.credential_revision)
    from candidates where job.id=candidates.id returning job.*;
end
$function$;
revoke all on function private.google_calendar_claim_outbound_protocol(integer,text,boolean) from public,anon,authenticated,service_role;
create or replace function public.google_calendar_claim_outbound_sync_jobs_v2(p_limit integer,p_worker text)
returns setof public.google_calendar_sync_jobs language sql security definer set search_path=pg_catalog as $function$
  select * from private.google_calendar_claim_outbound_protocol(p_limit,p_worker,false)
$function$;
create function public.google_calendar_claim_outbound_sync_jobs_v3(p_limit integer,p_worker text)
returns setof public.google_calendar_sync_jobs language sql security definer set search_path=pg_catalog as $function$
  select * from private.google_calendar_claim_outbound_protocol(p_limit,p_worker,true)
$function$;
revoke all on function public.google_calendar_claim_outbound_sync_jobs_v2(integer,text),
  public.google_calendar_claim_outbound_sync_jobs_v3(integer,text) from public,anon,authenticated;
grant execute on function public.google_calendar_claim_outbound_sync_jobs_v2(integer,text),
  public.google_calendar_claim_outbound_sync_jobs_v3(integer,text) to service_role;

-- A lease alone is insufficient after OAuth reconnects. Every provider HTTP
-- call must also belong to the credential revision captured by its claim.
create or replace function public.google_calendar_job_heartbeat(p_job_id uuid,p_worker text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare changed integer;
begin
  perform private.google_calendar_require_backend();
  update public.google_calendar_sync_jobs job set locked_at=now()
    from public.google_calendar_tokens token
    where job.id=p_job_id and job.status='running' and job.locked_by=p_worker
      and job.locked_at>=now()-interval '2 minutes'
      and token.id=job.connection_id and token.organization_id=job.organization_id
      and token.user_id::text=job.payload->>'owner_user_id'
      and token.disconnected_at is null and token.disconnecting_at is null
      and job.payload->'claimed_credential_revision'=to_jsonb(token.credential_revision);
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

-- Server callback enables routing only after a complete Tasks offline grant.
create function public.google_calendar_enable_tasks(p_connection_id uuid,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare connection public.google_calendar_tokens; token jsonb;
begin
  perform private.google_calendar_require_backend();
  select * into connection from public.google_calendar_tokens where id=p_connection_id for update;
  if connection.id is null or connection.credential_revision<>p_expected_revision
    or connection.disconnected_at is not null or connection.disconnecting_at is not null then
    raise exception 'Google credential changed' using errcode='40001';
  end if;
  select decrypted_secret::jsonb into token from vault.decrypted_secrets where id=connection.token_secret_ref;
  perform private.google_calendar_validate_oauth_token(token);
  if not ('https://www.googleapis.com/auth/tasks'=any(regexp_split_to_array(coalesce(token->>'scope',''),'\s+'))) then
    raise exception 'Google Tasks scope required' using errcode='22023';
  end if;
  update public.google_calendar_tokens set tasks_authorized=true,routing_v2=true,
    credential_revision=credential_revision+1,updated_at=now() where id=connection.id returning * into connection;
  return to_jsonb(connection);
end
$function$;
revoke all on function public.google_calendar_enable_tasks(uuid,bigint) from public,anon,authenticated;
grant execute on function public.google_calendar_enable_tasks(uuid,bigint) to service_role;

-- Include Tasks links in the same lock order/error transaction. The two
-- providers share actions, so disconnect and account aggregates remain valid.
create or replace function public.google_calendar_finish_outbound_job(
  p_job_id uuid,p_worker text,p_status text,p_error text default null,
  p_delay_seconds integer default 0,p_consume_attempt boolean default false,p_is_conflict boolean default false
) returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare finished public.google_calendar_sync_jobs; candidate public.google_calendar_sync_jobs;
  locked_connection public.google_calendar_tokens; requeued integer;
begin
  perform private.google_calendar_require_backend();
  if p_status not in ('queued','succeeded','failed','dead') then raise exception 'Invalid job outcome'; end if;
  select * into candidate from public.google_calendar_sync_jobs where id=p_job_id;
  if candidate.id is null then return false; end if;
  perform 1 from public.schedule_events event where event.organization_id=candidate.organization_id
    and event.id::text=coalesce(candidate.schedule_event_id::text,candidate.payload->>'event_id') for update;
  if candidate.action='push_delete' then
    perform 1 from public.google_calendar_event_links link where link.organization_id=candidate.organization_id
      and link.connection_id=candidate.connection_id and link.deleted_at is null and link.id::text in(
        select jsonb_array_elements_text(case when jsonb_typeof(candidate.payload->'link_ids')='array'
          then candidate.payload->'link_ids' else '[]'::jsonb end)) order by link.id for update;
  end if;
  perform 1 from public.google_tasks_links link where link.organization_id=candidate.organization_id
    and link.connection_id=candidate.connection_id and link.vimob_event_id::text=candidate.payload->>'event_id'
    order by link.id for update;
  select token.* into locked_connection from public.google_calendar_sync_jobs job
    join public.google_calendar_tokens token on token.id=job.connection_id
      and token.organization_id=job.organization_id and token.user_id::text=job.payload->>'owner_user_id'
    where job.id=p_job_id and job.organization_id=candidate.organization_id
      and job.connection_id is not distinct from candidate.connection_id and job.action=candidate.action
      and job.schedule_event_id is not distinct from candidate.schedule_event_id
      and job.payload-'claimed_credential_revision'=candidate.payload-'claimed_credential_revision' for update of token;
  if locked_connection.id is null or locked_connection.disconnected_at is not null or locked_connection.disconnecting_at is not null then return false; end if;
  update public.google_calendar_sync_jobs job set status='queued',locked_at=null,locked_by=null,
    next_run_at=now()+interval '10 seconds',last_error=null
    where job.id=p_job_id and job.status='running' and job.locked_by=p_worker
      and job.locked_at>=now()-interval '2 minutes' and job.connection_id=locked_connection.id
      and job.organization_id=locked_connection.organization_id and job.payload->>'owner_user_id'=locked_connection.user_id::text
      and jsonb_typeof(job.payload->'claimed_credential_revision')='number'
      and job.payload->'claimed_credential_revision'<>to_jsonb(locked_connection.credential_revision);
  get diagnostics requeued=row_count;
  if requeued=1 then return false; end if;
  update public.google_calendar_sync_jobs job set status=p_status,locked_at=null,locked_by=null,
    attempts=attempts+case when p_consume_attempt then 1 else 0 end,
    next_run_at=now()+make_interval(secs=>greatest(0,least(p_delay_seconds,86400))),last_error=left(p_error,2000)
    where job.id=p_job_id and job.status='running' and job.locked_by=p_worker
      and job.locked_at>=now()-interval '2 minutes' and job.connection_id=locked_connection.id
      and job.organization_id=locked_connection.organization_id and job.payload->>'owner_user_id'=locked_connection.user_id::text
      and (job.payload->'claimed_credential_revision' is null
        or job.payload->'claimed_credential_revision'=to_jsonb(locked_connection.credential_revision)) returning job.* into finished;
  if not found then return false; end if;
  if p_status in ('failed','dead') then
    if finished.action='push_upsert' then
      update public.schedule_events event set google_sync_status=case when p_is_conflict then 'conflict' else 'error' end,
        google_sync_error=left(p_error,2000)
        where event.id::text=coalesce(finished.schedule_event_id::text,finished.payload->>'event_id')
          and event.organization_id=finished.organization_id and event.user_id::text=finished.payload->>'owner_user_id'
          and (finished.payload->>'source_updated_at' is null or event.updated_at=(finished.payload->>'source_updated_at')::timestamptz);
    elsif finished.action='push_delete' then
      update public.google_calendar_event_links link set last_error=left(p_error,2000)
        where link.organization_id=finished.organization_id and link.connection_id=finished.connection_id
          and link.deleted_at is null and link.id::text in(select jsonb_array_elements_text(
            case when jsonb_typeof(finished.payload->'link_ids')='array' then finished.payload->'link_ids' else '[]'::jsonb end));
    end if;
    update public.google_tasks_links link set last_error=left(p_error,2000),updated_at=now()
      where link.organization_id=finished.organization_id and link.connection_id=finished.connection_id
        and link.vimob_event_id::text=finished.payload->>'event_id' and link.deleted_at is null;
  end if;
  perform private.google_calendar_refresh_connection_status(token.id,token.organization_id,token.user_id)
    from public.google_calendar_tokens token where token.id=finished.connection_id
      and token.organization_id=finished.organization_id and token.user_id::text=finished.payload->>'owner_user_id';
  return true;
end
$function$;
reset lock_timeout;
