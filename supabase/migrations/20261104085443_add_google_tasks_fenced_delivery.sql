-- All provider calls happen outside transactions. Persist an intent before
-- POST and retain started/review after unknown outcomes; never blindly retry.
set lock_timeout='5s';

create function private.google_tasks_lock_job(p_job_id uuid,p_worker text)
returns public.google_calendar_sync_jobs language plpgsql security definer set search_path=pg_catalog as $function$
declare candidate public.google_calendar_sync_jobs; locked_job public.google_calendar_sync_jobs;
  connection public.google_calendar_tokens;
begin
  perform private.google_calendar_require_backend();
  select * into candidate from public.google_calendar_sync_jobs where id=p_job_id;
  if candidate.id is null then return null; end if;
  -- Match Go's event -> links -> connection -> job order. Candidate is an
  -- unlocked hint only; every binding is checked again after acquiring locks.
  perform 1 from public.schedule_events event where event.organization_id=candidate.organization_id
    and event.id::text=coalesce(candidate.payload->>'event_id',candidate.schedule_event_id::text) for update;
  perform 1 from public.google_tasks_links link where link.organization_id=candidate.organization_id
    and link.connection_id=candidate.connection_id
    and link.vimob_event_id::text=coalesce(candidate.payload->>'event_id',candidate.schedule_event_id::text)
    order by link.id for update;
  select * into connection from public.google_calendar_tokens token
    where token.id=candidate.connection_id and token.organization_id=candidate.organization_id
      and token.user_id::text=candidate.payload->>'owner_user_id' for update;
  if connection.id is null or connection.disconnected_at is not null or connection.disconnecting_at is not null then return null; end if;
  select * into locked_job from public.google_calendar_sync_jobs job
    where job.id=p_job_id and job.organization_id=candidate.organization_id
      and job.connection_id=candidate.connection_id and job.action=candidate.action
      and job.schedule_event_id is not distinct from candidate.schedule_event_id and job.payload=candidate.payload
      and job.status='running' and job.locked_by=p_worker and job.locked_at>=now()-interval '2 minutes'
      and job.payload->'claimed_credential_revision'=to_jsonb(connection.credential_revision)
    for update;
  return locked_job;
end
$function$;
revoke all on function private.google_tasks_lock_job(uuid,text) from public,anon,authenticated,service_role;

create function public.google_tasks_begin_list_creation(p_job_id uuid,p_worker text)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; connection public.google_calendar_tokens; can_create boolean:=false;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null then return null; end if;
  select * into connection from public.google_calendar_tokens where id=job.connection_id;
  if not connection.tasks_authorized then raise exception 'Google Tasks authorization required' using errcode='22023'; end if;
  if connection.tasks_list_id is null and connection.tasks_list_creation_state='reserved' then
    update public.google_calendar_tokens set tasks_list_creation_state='started',updated_at=now()
      where id=connection.id returning * into connection;
    can_create:=true;
  end if;
  return jsonb_build_object('state',connection.tasks_list_creation_state,'creation_attempt',connection.tasks_list_creation_attempt,
    'list_id',connection.tasks_list_id,'organization_name',(select name from public.organizations where id=job.organization_id),
    'can_create',can_create);
end
$function$;

create function public.google_tasks_commit_list(p_job_id uuid,p_worker text,p_list_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; changed integer;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or nullif(btrim(p_list_id),'') is null then return false; end if;
  update public.google_calendar_tokens set tasks_list_id=p_list_id,tasks_list_creation_state='linked',updated_at=now()
    where id=job.connection_id and tasks_authorized
      and (tasks_list_id is null or tasks_list_id=p_list_id);
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

create function public.google_tasks_reserve_link(p_job_id uuid,p_worker text,p_expected_updated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; canonical public.schedule_events;
  connection public.google_calendar_tokens; link public.google_tasks_links;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or job.action<>'push_upsert' or job.payload->>'target'<>'tasks' then return null; end if;
  select * into canonical from public.schedule_events event where event.organization_id=job.organization_id
    and event.id::text=job.payload->>'event_id' and event.user_id::text=job.payload->>'owner_user_id'
    and event.updated_at=p_expected_updated_at and event.event_type in ('task','message','email','call')
    and event.status not in ('cancelled','canceled');
  select * into connection from public.google_calendar_tokens where id=job.connection_id;
  if canonical.id is null or not connection.tasks_authorized or not connection.routing_v2 or connection.tasks_list_id is null then return null; end if;
  select * into link from public.google_tasks_links where organization_id=job.organization_id
    and connection_id=job.connection_id and vimob_event_id=canonical.id and deleted_at is null;
  if link.id is null then
    insert into public.google_tasks_links(organization_id,connection_id,vimob_event_id,schedule_event_id,tasklist_id,source_updated_at)
      values(job.organization_id,job.connection_id,canonical.id,canonical.id,connection.tasks_list_id,canonical.updated_at) returning * into link;
  else
    update public.google_tasks_links set source_updated_at=canonical.updated_at,updated_at=now()
      where id=link.id returning * into link;
  end if;
  return to_jsonb(link);
end
$function$;

create function public.google_tasks_mark_create_started(p_job_id uuid,p_worker text,p_link_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; link public.google_tasks_links; can_create boolean:=false;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or job.action<>'push_upsert' or job.payload->>'target'<>'tasks' then return null; end if;
  select * into link from public.google_tasks_links where id=p_link_id and organization_id=job.organization_id
    and connection_id=job.connection_id and vimob_event_id::text=job.payload->>'event_id' and deleted_at is null;
  if link.id is null or not exists(select 1 from public.schedule_events event
    where event.id=link.schedule_event_id and event.organization_id=job.organization_id
      and event.user_id::text=job.payload->>'owner_user_id' and event.updated_at=link.source_updated_at
      and event.event_type in ('task','message','email','call') and event.status not in ('cancelled','canceled')) then return null; end if;
  if link.creation_state='reserved' and link.task_id is null then
    update public.google_tasks_links set creation_state='started',updated_at=now() where id=link.id returning * into link;
    can_create:=true;
  end if;
  return to_jsonb(link)||jsonb_build_object('can_create',can_create);
end
$function$;

-- Only after a definitive rejected HTTP response, never timeout/5xx. Keeping
-- the attempt marker unchanged also makes an incorrect caller fail visibly.
create function public.google_tasks_reset_create(p_job_id uuid,p_worker text,p_link_id uuid)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; changed integer;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or job.action<>'push_upsert' or job.payload->>'target'<>'tasks' then return false; end if;
  update public.google_tasks_links set creation_state='reserved',updated_at=now()
    where id=p_link_id and organization_id=job.organization_id and connection_id=job.connection_id
      and vimob_event_id::text=job.payload->>'event_id' and task_id is null and creation_state='started' and deleted_at is null;
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

create function public.google_tasks_commit_link(p_job_id uuid,p_worker text,p_link_id uuid,
  p_task_id text,p_etag text default null,p_remote_status text default null)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; changed integer;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or nullif(btrim(p_task_id),'') is null then return false; end if;
  -- Persist a known provider ID even if the canonical event changed/deleted
  -- during HTTP. Its delete/transfer intent can then clean up this exact ID.
  update public.google_tasks_links set task_id=p_task_id,google_etag=p_etag,google_status=p_remote_status,
    creation_state='linked',last_synced_at=now(),last_error=null,updated_at=now()
    where id=p_link_id and organization_id=job.organization_id and connection_id=job.connection_id
      and vimob_event_id::text=job.payload->>'event_id' and deleted_at is null
      and (task_id is null or task_id=p_task_id);
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

create function public.google_tasks_finalize_link(p_job_id uuid,p_worker text,p_link_id uuid,p_error text default null)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; changed integer;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null then return false; end if;
  update public.google_tasks_links set creation_state=case when p_error is null then 'deleted' else 'review' end,
    deleted_at=case when p_error is null then now() else deleted_at end,last_error=left(p_error,2000),updated_at=now()
    where id=p_link_id and organization_id=job.organization_id and connection_id=job.connection_id
      and vimob_event_id::text=job.payload->>'event_id' and deleted_at is null;
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

create function public.google_schedule_commit_sync(p_job_id uuid,p_worker text,p_expected_updated_at timestamptz,
  p_target text,p_remote_id text)
returns boolean language plpgsql security definer set search_path=pg_catalog as $function$
declare job public.google_calendar_sync_jobs; changed integer; canonical public.schedule_events;
  connection public.google_calendar_tokens; desired_target text;
begin
  job:=private.google_tasks_lock_job(p_job_id,p_worker);
  if job.id is null or job.action<>'push_upsert' or p_target not in ('calendar','tasks')
    or job.payload->>'target'<>p_target then return false; end if;
  select * into connection from public.google_calendar_tokens where id=job.connection_id;
  select * into canonical from public.schedule_events event where event.organization_id=job.organization_id
    and event.id::text=job.payload->>'event_id' and event.user_id::text=job.payload->>'owner_user_id'
    and event.updated_at=p_expected_updated_at;
  if canonical.id is null then return false; end if;
  desired_target:=case when connection.routing_v2 and canonical.event_type in ('task','message','email','call')
    then 'tasks' else 'calendar' end;
  if p_target<>desired_target then return false; end if;
  if p_target='tasks' then
    if not connection.tasks_authorized or exists(select 1 from public.google_calendar_event_links link
      where link.organization_id=job.organization_id and link.connection_id=job.connection_id
        and link.schedule_event_id=canonical.id and link.deleted_at is null) then return false; end if;
    if p_remote_id is null then
      if canonical.status not in ('cancelled','canceled') or exists(select 1 from public.google_tasks_links link
        where link.organization_id=job.organization_id and link.connection_id=job.connection_id
          and link.vimob_event_id=canonical.id and link.deleted_at is null) then return false; end if;
    elsif not exists(select 1 from public.google_tasks_links link where link.organization_id=job.organization_id
      and link.connection_id=job.connection_id and link.vimob_event_id=canonical.id
      and link.task_id=p_remote_id and link.tasklist_id=connection.tasks_list_id and link.deleted_at is null
      and link.creation_state='linked') then return false; end if;
  else
    if p_remote_id is null or exists(select 1 from public.google_tasks_links link where link.organization_id=job.organization_id
      and link.connection_id=job.connection_id and link.vimob_event_id=canonical.id and link.deleted_at is null)
      or not exists(select 1 from public.google_calendar_event_links link where link.organization_id=job.organization_id
        and link.connection_id=job.connection_id and link.schedule_event_id=canonical.id
        and link.google_event_id=p_remote_id and link.google_calendar_id=connection.calendar_id
        and (link.deleted_at is null or (canonical.status in ('cancelled','canceled') and link.google_status='cancelled'))) then return false; end if;
  end if;
  update public.schedule_events event set google_sync_target=p_target,
    google_task_id=case when p_target='tasks' then p_remote_id else null end,
    google_event_id=case when p_target='calendar' then p_remote_id else null end,
    google_calendar_id=case when p_target='calendar' then connection.calendar_id else null end,
    google_calendar_connection_id=case when p_target='calendar' then connection.id else null end,
    google_sync_status='synced',google_last_synced_at=now(),google_sync_error=null
    where event.organization_id=job.organization_id and event.id::text=job.payload->>'event_id'
      and event.user_id::text=job.payload->>'owner_user_id' and event.updated_at=p_expected_updated_at;
  get diagnostics changed=row_count;
  return changed=1;
end
$function$;

do $permissions$
declare signature regprocedure;
begin
  foreach signature in array array[
    'public.google_tasks_begin_list_creation(uuid,text)'::regprocedure,
    'public.google_tasks_commit_list(uuid,text,text)'::regprocedure,
    'public.google_tasks_reserve_link(uuid,text,timestamptz)'::regprocedure,
    'public.google_tasks_mark_create_started(uuid,text,uuid)'::regprocedure,
    'public.google_tasks_reset_create(uuid,text,uuid)'::regprocedure,
    'public.google_tasks_commit_link(uuid,text,uuid,text,text,text)'::regprocedure,
    'public.google_tasks_finalize_link(uuid,text,uuid,text)'::regprocedure,
    'public.google_schedule_commit_sync(uuid,text,timestamptz,text,text)'::regprocedure
  ] loop
    execute format('revoke all on function %s from public,anon,authenticated',signature);
    execute format('grant execute on function %s to service_role',signature);
  end loop;
end
$permissions$;
reset lock_timeout;
