-- Real PostgreSQL semantics, synthetic data, two tenants, no provider calls.
begin;
do $fk_index$
begin
  if not exists(select 1 from pg_index idx
    where idx.indexrelid='public.google_tasks_links_schedule_event_fk_idx'::regclass
      and idx.indrelid='public.google_tasks_links'::regclass
      and idx.indisvalid and idx.indisready and idx.indnkeyatts=1
      and pg_get_indexdef(idx.indexrelid,1,true)='schedule_event_id'
      and pg_get_expr(idx.indpred,idx.indrelid)='(schedule_event_id IS NOT NULL)') then
    raise exception 'Tasks schedule FK lacks the exact leading partial index';
  end if;
end
$fk_index$;
insert into public.organizations(id) values
 ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.users values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','user',true),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','user',true);
insert into public.organization_members(organization_id,user_id,is_active,role,membership_generation) values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',true,'user',1),
 ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',true,'user',1);

do $tasks$
declare org uuid:='11111111-1111-4111-8111-111111111111'; owner uuid:='33333333-3333-4333-8333-333333333333';
  other_org uuid:='22222222-2222-4222-8222-222222222222'; other_owner uuid:='44444444-4444-4444-8444-444444444444';
  event_id uuid:=gen_random_uuid(); other_event uuid:=gen_random_uuid();
  connection jsonb; other_connection jsonb; job public.google_calendar_sync_jobs; legacy_job public.google_calendar_sync_jobs;
  link jsonb; first_try jsonb; second_try jsonb; before_version timestamptz; updated_version timestamptz;
  token jsonb:='{"access_token":"synthetic-access","refresh_token":"synthetic-refresh","scope":"https://www.googleapis.com/auth/calendar.events.owned https://www.googleapis.com/auth/tasks"}';
  signature regprocedure;
begin
  connection:=public.google_calendar_activate_oauth_connection(null,org,owner,null,'synthetic-a@example.test',null,token);
  other_connection:=public.google_calendar_activate_oauth_connection(null,other_org,other_owner,null,'synthetic-b@example.test',null,
    jsonb_set(token,'{scope}','"https://www.googleapis.com/auth/calendar.events.owned"'));
  begin
    perform public.google_calendar_enable_tasks((other_connection->>'id')::uuid,(other_connection->>'credential_revision')::bigint);
    raise exception 'partial Tasks consent accepted';
  exception when invalid_parameter_value then null; end;
  if (select routing_v2 from public.google_calendar_tokens where id=(other_connection->>'id')::uuid) then raise exception 'partial consent enabled routing'; end if;
  connection:=public.google_calendar_enable_tasks((connection->>'id')::uuid,(connection->>'credential_revision')::bigint);
  begin
    perform public.google_calendar_enable_tasks((connection->>'id')::uuid,(connection->>'credential_revision')::bigint-1);
    raise exception 'stale credential enabled routing';
  exception when serialization_failure then null; end;
  insert into public.schedule_events(id,organization_id,user_id,event_type) values(event_id,org,owner,'task'),(other_event,other_org,other_owner,'meeting');
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(other_org,other_event,'push_upsert',jsonb_build_object('event_id',other_event,'owner_user_id',other_owner));
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(org,event_id,'push_upsert',jsonb_build_object('event_id',event_id,'owner_user_id',owner,'target','calendar'));
  -- New route upgrades even an old producer, and ignores its supplied target.
  if not exists(select 1 from public.google_calendar_sync_jobs where schedule_event_id=event_id
    and payload->>'protocol_version'='2' and payload->>'target'='tasks') then raise exception 'server routing not authoritative'; end if;
  select * into legacy_job from public.google_calendar_claim_outbound_sync_jobs_v2(20,'legacy-worker');
  if legacy_job.schedule_event_id is distinct from other_event then raise exception 'legacy worker got Tasks intent'; end if;
  select * into job from public.google_calendar_claim_outbound_sync_jobs_v3(20,'tasks-worker');
  if job.schedule_event_id is distinct from event_id then raise exception 'v3 failed Tasks claim'; end if;
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(org,event_id,'push_upsert',jsonb_build_object('protocol_version',2,'event_id',event_id,'owner_user_id',owner));
  if exists(select 1 from public.google_calendar_claim_outbound_sync_jobs_v3(20,'duplicate-worker')) then raise exception 'duplicate canonical event lease'; end if;
  if public.google_tasks_begin_list_creation(job.id,'wrong-worker') is not null then raise exception 'wrong worker wrote list intent'; end if;
  first_try:=public.google_tasks_begin_list_creation(job.id,'tasks-worker');
  second_try:=public.google_tasks_begin_list_creation(job.id,'tasks-worker');
  if first_try->>'can_create'<>'true' or second_try->>'can_create'<>'false'
    or first_try->>'creation_attempt'<>second_try->>'creation_attempt' then raise exception 'list POST repeated'; end if;
  if not public.google_tasks_commit_list(job.id,'tasks-worker','synthetic-list') then raise exception 'list commit failed'; end if;
  if public.google_tasks_commit_list(job.id,'tasks-worker','unrelated-list') then raise exception 'list ID replaced'; end if;
  select updated_at into before_version from public.schedule_events where id=event_id;
  if public.google_tasks_reserve_link(job.id,'tasks-worker',before_version-interval '1 second') is not null then raise exception 'stale event reserved'; end if;
  link:=public.google_tasks_reserve_link(job.id,'tasks-worker',before_version);
  if link->>'creation_state'<>'reserved' or link->>'tasklist_id'<>'synthetic-list' then raise exception 'missing durable reservation'; end if;
  first_try:=public.google_tasks_mark_create_started(job.id,'tasks-worker',(link->>'id')::uuid);
  second_try:=public.google_tasks_mark_create_started(job.id,'tasks-worker',(link->>'id')::uuid);
  if first_try->>'can_create'<>'true' or second_try->>'can_create'<>'false' then raise exception 'ambiguous POST retried'; end if;
  if not public.google_tasks_reset_create(job.id,'tasks-worker',(link->>'id')::uuid) then raise exception 'definitive rejection cannot reset'; end if;
  perform public.google_tasks_mark_create_started(job.id,'tasks-worker',(link->>'id')::uuid);
  if not public.google_tasks_finalize_link(job.id,'tasks-worker',(link->>'id')::uuid,'synthetic-ambiguous') then raise exception 'review transition failed'; end if;
  if not exists(select 1 from public.google_tasks_links where id=(link->>'id')::uuid and deleted_at is null and creation_state='review') then raise exception 'review destroyed cleanup evidence'; end if;
  if not public.google_tasks_commit_link(job.id,'tasks-worker',(link->>'id')::uuid,'synthetic-task','synthetic-etag','needsAction') then raise exception 'reconciled task ID not persisted'; end if;
  if public.google_tasks_commit_link(legacy_job.id,'legacy-worker',(link->>'id')::uuid,'foreign-task') then raise exception 'cross-tenant link commit'; end if;
  if public.google_tasks_finalize_link(legacy_job.id,'legacy-worker',(link->>'id')::uuid) then raise exception 'cross-tenant link delete'; end if;
  if public.google_tasks_reset_create(job.id,'tasks-worker',(link->>'id')::uuid) then raise exception 'known task reset for another POST'; end if;
  if not public.google_schedule_commit_sync(job.id,'tasks-worker',before_version,'tasks','synthetic-task') then raise exception 'target sync failed'; end if;
  if public.google_schedule_commit_sync(job.id,'tasks-worker',before_version,'tasks','unrelated-task') then raise exception 'unbound remote ID synced'; end if;
  if public.google_schedule_commit_sync(job.id,'tasks-worker',before_version,'tasks',null) then raise exception 'open task synced without task ID'; end if;
  if not exists(select 1 from public.schedule_events where id=event_id and google_task_id='synthetic-task'
    and google_event_id is null and google_sync_target='tasks') then raise exception 'task ID polluted Calendar'; end if;
  update public.schedule_events set updated_at=updated_at+interval '1 second' where id=event_id returning updated_at into updated_version;
  if public.google_schedule_commit_sync(job.id,'tasks-worker',before_version,'tasks','stale-task') then raise exception 'stale success repainted event'; end if;
  perform public.google_calendar_finish_outbound_job(job.id,'tasks-worker','failed','synthetic-error',0,true);
  if (select google_sync_status from public.schedule_events where id=event_id)<>'synced' then raise exception 'stale error repainted event'; end if;
  if (select last_error from public.google_tasks_links where id=(link->>'id')::uuid)<>'synthetic-error' then raise exception 'Tasks link failure omitted'; end if;
  if public.google_calendar_begin_disconnect((connection->>'id')::uuid) then raise exception 'pending Tasks did not block disconnect'; end if;
  -- Reclaim, then a re-consent must fence late provider writes.
  select * into job from public.google_calendar_claim_outbound_sync_jobs_v3(20,'retry-worker');
  connection:=public.google_calendar_activate_oauth_connection((connection->>'id')::uuid,org,owner,
    (select credential_revision from public.google_calendar_tokens where id=(connection->>'id')::uuid),'synthetic-a@example.test',null,token);
  if public.google_calendar_job_heartbeat(job.id,'retry-worker') then raise exception 'prior credentials heartbeat accepted'; end if;
  if public.google_tasks_commit_link(job.id,'retry-worker',(link->>'id')::uuid,'synthetic-task') then raise exception 'prior credentials committed'; end if;
  perform public.google_calendar_finish_outbound_job(job.id,'retry-worker','queued');
  update public.google_calendar_sync_jobs set next_run_at=now() where id=job.id;
  select * into job from public.google_calendar_claim_outbound_sync_jobs_v3(20,'delete-worker');
  -- Hard delete retains remote identity even without its CRM FK.
  delete from public.schedule_events where id=event_id;
  if not exists(select 1 from public.google_tasks_links where id=(link->>'id')::uuid and schedule_event_id is null and vimob_event_id=event_id) then raise exception 'delete lost cleanup identity'; end if;
  if not public.google_tasks_finalize_link(job.id,'delete-worker',(link->>'id')::uuid) then raise exception 'durable cleanup failed'; end if;
  if public.google_schedule_commit_sync(job.id,'delete-worker',updated_version,'tasks','synthetic-task') then raise exception 'removed CRM event revived'; end if;
  foreach signature in array array[
    'public.google_calendar_claim_outbound_sync_jobs_v3(integer,text)'::regprocedure,
    'public.google_calendar_enable_tasks(uuid,bigint)'::regprocedure,
    'public.google_tasks_begin_list_creation(uuid,text)'::regprocedure,
    'public.google_tasks_commit_list(uuid,text,text)'::regprocedure,
    'public.google_tasks_reserve_link(uuid,text,timestamptz)'::regprocedure,
    'public.google_tasks_mark_create_started(uuid,text,uuid)'::regprocedure,
    'public.google_tasks_reset_create(uuid,text,uuid)'::regprocedure,
    'public.google_tasks_commit_link(uuid,text,uuid,text,text,text)'::regprocedure,
    'public.google_tasks_finalize_link(uuid,text,uuid,text)'::regprocedure,
    'public.google_schedule_commit_sync(uuid,text,timestamptz,text,text)'::regprocedure
  ] loop
    if has_function_privilege('anon',signature,'execute') or has_function_privilege('authenticated',signature,'execute')
      or not has_function_privilege('service_role',signature,'execute') then raise exception 'unsafe RPC grants: %',signature; end if;
  end loop;
  if has_table_privilege('anon','public.google_tasks_links','select') or has_table_privilege('authenticated','public.google_tasks_links','insert')
    or not (select relrowsecurity from pg_class where oid='public.google_tasks_links'::regclass) then raise exception 'unsafe Tasks table'; end if;
end
$tasks$;

do $conversion$
declare org uuid:='11111111-1111-4111-8111-111111111111'; owner uuid:='33333333-3333-4333-8333-333333333333';
  event_id uuid:=gen_random_uuid(); job public.google_calendar_sync_jobs; connection public.google_calendar_tokens;
  version timestamptz; link jsonb;
begin
  select * into connection from public.google_calendar_tokens where organization_id=org and user_id=owner;
  insert into public.schedule_events(id,organization_id,user_id,event_type) values(event_id,org,owner,'task') returning updated_at into version;
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(org,event_id,'push_upsert',jsonb_build_object('protocol_version',2,'event_id',event_id,'owner_user_id',owner));
  select * into job from public.google_calendar_claim_outbound_sync_jobs_v3(20,'conversion-worker');
  link:=public.google_tasks_reserve_link(job.id,'conversion-worker',version);
  perform public.google_tasks_mark_create_started(job.id,'conversion-worker',(link->>'id')::uuid);
  perform public.google_tasks_commit_link(job.id,'conversion-worker',(link->>'id')::uuid,'synthetic-conversion-task');
  if not public.google_schedule_commit_sync(job.id,'conversion-worker',version,'tasks','synthetic-conversion-task') then raise exception 'initial conversion Tasks sync failed'; end if;
  update public.schedule_events set event_type='meeting',updated_at=updated_at+interval '1 second'
    where id=event_id returning updated_at into version;
  if public.google_schedule_commit_sync(job.id,'conversion-worker',version,'tasks','synthetic-conversion-task') then raise exception 'current type ignored'; end if;
  perform public.google_tasks_finalize_link(job.id,'conversion-worker',(link->>'id')::uuid);
  perform public.google_calendar_finish_outbound_job(job.id,'conversion-worker','succeeded');
  insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
    values(org,event_id,'push_upsert',jsonb_build_object('protocol_version',2,'event_id',event_id,'owner_user_id',owner,'target','tasks'));
  select * into job from public.google_calendar_claim_outbound_sync_jobs_v3(20,'calendar-conversion-worker');
  insert into public.google_calendar_event_links(organization_id,connection_id,schedule_event_id,google_calendar_id,google_event_id)
    values(org,connection.id,event_id,connection.calendar_id,'synthetic-conversion-event');
  if public.google_schedule_commit_sync(job.id,'calendar-conversion-worker',version,'calendar','unrelated-event') then raise exception 'unbound Calendar ID accepted'; end if;
  if not public.google_schedule_commit_sync(job.id,'calendar-conversion-worker',version,'calendar','synthetic-conversion-event') then raise exception 'Tasks to Calendar conversion failed'; end if;
  if not exists(select 1 from public.schedule_events where id=event_id and google_task_id is null
    and google_event_id='synthetic-conversion-event' and google_calendar_connection_id=connection.id
    and google_calendar_id=connection.calendar_id and google_sync_target='calendar') then raise exception 'Calendar metadata not committed'; end if;
end
$conversion$;
rollback;
