-- Run after the fixture + new migration in a disposable database only.
-- Synthetic UUIDs and tokens; transaction rolls all fixture data back.
begin;
do $test$
declare sig text; relation text;
begin
  foreach sig in array array['google_calendar_get_token_secret(uuid)',
    'google_calendar_save_token_secret(uuid,text,text,text)', 'google_calendar_verify_cron_secret(text)',
    'google_calendar_disconnect_connection(uuid)', 'google_calendar_begin_disconnect(uuid)',
    'google_calendar_abort_disconnect(uuid)', 'google_calendar_claim_outbound_sync_jobs_v2(integer,text)',
    'google_calendar_job_heartbeat(uuid,text)', 'google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)'] loop
    assert not has_function_privilege('anon','public.'||sig,'execute'), 'anon helper access';
    assert not has_function_privilege('authenticated','public.'||sig,'execute'), 'authenticated helper access';
    assert has_function_privilege('service_role','public.'||sig,'execute'), 'backend helper denied';
  end loop;
  assert not has_function_privilege('service_role','public.google_calendar_claim_outbound_sync_jobs(integer,text)','execute');
  foreach relation in array array['google_calendar_tokens', 'google_calendar_event_links',
    'google_calendar_channels', 'google_calendar_sync_jobs', 'google_calendar_oauth_states'] loop
    assert not has_table_privilege('anon','public.'||relation,'select'), 'anon integration table access';
    assert not has_table_privilege('authenticated','public.'||relation,'select'), 'authenticated integration table access';
    assert not has_table_privilege('authenticated','public.'||relation,'insert,update,delete'), 'authenticated integration table write';
    assert has_table_privilege('service_role','public.'||relation,'select,insert,update,delete'), 'backend integration table denied';
  end loop;
end $test$;
set local role anon;
do $negative$ begin
  begin
    perform public.google_calendar_get_token_secret('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'anon unexpectedly read Vault';
  exception when insufficient_privilege then null; end;
  begin
    perform public.google_calendar_save_token_secret(null,'synthetic','synthetic','synthetic');
    raise exception 'anon unexpectedly wrote Vault';
  exception when insufficient_privilege then null; end;
end $negative$;
reset role;
-- Exercise the independent guard even if an ACL is accidentally broadened.
-- A PostgREST-like authenticator session must not pass as a backend merely
-- because the helper is SECURITY DEFINER and owned by postgres.
grant execute on function public.google_calendar_get_token_secret(uuid) to authenticated;
set session authorization authenticator;
set local role authenticated;
do $guard$ begin
  begin
    perform public.google_calendar_get_token_secret('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    raise exception 'authenticated bypassed the backend guard';
  exception when insufficient_privilege then null; end;
end $guard$;
reset role;
set session authorization postgres;
revoke execute on function public.google_calendar_get_token_secret(uuid) from authenticated;

insert into public.organizations values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
insert into public.users values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','member',true),
 ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','member',true),
 ('99999999-9999-4999-8999-999999999996','22222222-2222-4222-8222-222222222222','member',true);
insert into public.organization_members values
 ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',true,null),
 ('22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',true,null),
 ('22222222-2222-4222-8222-222222222222','99999999-9999-4999-8999-999999999996',true,null);
insert into public.schedule_events(id,organization_id,user_id) values
 ('55555555-5555-4555-8555-555555555555','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333'),
 ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444');
insert into public.google_calendar_tokens(id,organization_id,user_id,token_secret_ref) values
 ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333',gen_random_uuid()),
 ('88888888-8888-4888-8888-888888888888','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444',gen_random_uuid());
insert into public.google_calendar_sync_jobs(organization_id,schedule_event_id,action,payload)
select event.organization_id,event.id,'push_upsert',jsonb_build_object('event_id',event.id,'owner_user_id',event.user_id)
from public.schedule_events event cross join generate_series(1,2);

set session authorization authenticator;
set local role service_role;

do $queue$
declare job public.google_calendar_sync_jobs; n integer; secret uuid;
begin
  insert into public.google_calendar_sync_jobs(organization_id,action,payload) values
    ('22222222-2222-4222-8222-222222222222','push_upsert',jsonb_build_object(
      'event_id','55555555-5555-4555-8555-555555555555',
      'owner_user_id','33333333-3333-4333-8333-333333333333'));
  get diagnostics n=row_count;
  assert n=0, 'an owner from another organization cannot append outbound work';
  select count(*) into n from public.google_calendar_claim_outbound_sync_jobs_v2(20,'worker-a');
  assert n = 2, 'must claim one event per organization, not both versions';
  select count(*) into n from public.google_calendar_claim_outbound_sync_jobs_v2(20,'worker-b');
  assert n = 0, 'a second worker must not concurrently claim the same event';
  select * into job from public.google_calendar_sync_jobs where status='running' order by id limit 1;
  assert not public.google_calendar_job_heartbeat(job.id,'wrong-worker');
  assert not public.google_calendar_finish_outbound_job(job.id,'wrong-worker','succeeded');
  assert public.google_calendar_job_heartbeat(job.id,'worker-a');
  begin
    perform public.google_calendar_finish_outbound_job(job.id,'worker-a','failed','synthetic-atomic-reject',0,true);
    raise exception 'error metadata rejection unexpectedly succeeded';
  exception when check_violation then null; end;
  assert (select status='running' and locked_by='worker-a' and attempts=0
    from public.google_calendar_sync_jobs where id=job.id),
    'rejected metadata must roll back the job outcome and consumed attempt';
  assert (select sync_status='connected' and last_error is null
    from public.google_calendar_tokens where id=job.connection_id);
  assert public.google_calendar_finish_outbound_job(job.id,'worker-a','failed','synthetic-conflict',0,true,true);
  assert (select google_sync_status='conflict' and google_sync_error='synthetic-conflict'
    from public.schedule_events where id=job.schedule_event_id), 'error metadata must commit with the fenced outcome';
  assert (select sync_status='error' and last_error='synthetic-conflict'
    from public.google_calendar_tokens where id=job.connection_id), 'account error must commit in the same outcome';
  -- Restrict this retry to the same job, keeping its duplicate intent queued.
  update public.google_calendar_sync_jobs set next_run_at=now()+interval '1 hour'
    where schedule_event_id=job.schedule_event_id and id<>job.id;
  select count(*) into n from public.google_calendar_claim_outbound_sync_jobs_v2(20,'worker-retry');
  assert n=1;
  update public.schedule_events set google_sync_status='synced',google_sync_error=null where id=job.schedule_event_id;
  update public.google_calendar_tokens set sync_status='connected',last_error=null where id=job.connection_id;
  assert public.google_calendar_finish_outbound_job(job.id,'worker-retry','succeeded');
  assert not public.google_calendar_finish_outbound_job(job.id,'worker-a','failed','late-error',0,true),
    'a late failure must not repaint a completed same-job retry';
  assert (select google_sync_status='synced' and google_sync_error is null
    from public.schedule_events where id=job.schedule_event_id);
  assert (select sync_status='connected' and last_error is null
    from public.google_calendar_tokens where id=job.connection_id);

  -- Exercise reclaim on the remaining running event, independently of status.
  select * into job from public.google_calendar_sync_jobs where status='running' order by id limit 1;
  update public.google_calendar_sync_jobs set locked_at=now()-interval '3 minutes' where id=job.id;
  select count(*) into n from public.google_calendar_claim_outbound_sync_jobs_v2(20,'worker-b');
  assert n = 1, 'expired event lease must be reclaimed once';
  assert not public.google_calendar_finish_outbound_job(job.id,'worker-a','succeeded'), 'stale completion must be fenced';
  assert public.google_calendar_finish_outbound_job(job.id,'worker-b','succeeded');

  -- A dead version owned by the former owner must also become terminal even
  -- though the canonical event still exists under another owner in the tenant.
  insert into public.schedule_events(id,organization_id,user_id) values
    ('99999999-9999-4999-8999-999999999998','22222222-2222-4222-8222-222222222222','44444444-4444-4444-8444-444444444444');
  insert into public.google_calendar_sync_jobs(id,organization_id,schedule_event_id,action,status,payload) values
    ('99999999-9999-4999-8999-999999999997','22222222-2222-4222-8222-222222222222',
      '99999999-9999-4999-8999-999999999998','push_upsert','dead',jsonb_build_object(
        'event_id','99999999-9999-4999-8999-999999999998','owner_user_id','44444444-4444-4444-8444-444444444444'));
  update public.schedule_events set user_id='99999999-9999-4999-8999-999999999996'
    where id='99999999-9999-4999-8999-999999999998';

  -- Known obsolete versions cannot strand disconnect forever.
  delete from public.schedule_events where id='55555555-5555-4555-8555-555555555555';
  update public.google_calendar_sync_jobs set locked_at=now()-interval '3 minutes' where status='running';
  perform public.google_calendar_claim_outbound_sync_jobs_v2(20,'worker-c');
  assert (select status='succeeded' and terminal_reason='CANONICAL_EVENT_REMOVED_OR_TRANSFERRED'
    from public.google_calendar_sync_jobs where id='99999999-9999-4999-8999-999999999997'),
    'transferred dead upsert must terminalize without touching the replacement owner';
  assert not exists(select 1 from public.google_calendar_sync_jobs where organization_id='11111111-1111-4111-8111-111111111111'
    and payload->>'owner_user_id'='33333333-3333-4333-8333-333333333333' and status in ('queued','failed','dead','running')),
    'deleted event upserts must terminalize';
  assert (select status='queued' from public.google_calendar_sync_jobs where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    'unverifiable legacy intent must stay for review';
  assert public.google_calendar_begin_disconnect('77777777-7777-4777-8777-777777777777');
  assert not public.google_calendar_begin_disconnect('77777777-7777-4777-8777-777777777777'),
    'another disconnect must not share or abort the active operation';
  begin
    -- Simulate a CRM mutation followed by its transactional outbox insert.
    insert into public.schedule_events(id,organization_id,user_id) values
      ('99999999-9999-4999-8999-999999999999','11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
    insert into public.google_calendar_sync_jobs(organization_id,action,payload) values
      ('11111111-1111-4111-8111-111111111111','push_upsert',jsonb_build_object('event_id','99999999-9999-4999-8999-999999999999','owner_user_id','33333333-3333-4333-8333-333333333333'));
    raise exception 'disconnect race unexpectedly committed';
  exception when lock_not_available then
    assert sqlerrm='google_calendar_connection_disconnecting';
  end;
  assert not exists(select 1 from public.schedule_events where id='99999999-9999-4999-8999-999999999999'),
    'the CRM command must roll back with its rejected outbox insert';
  perform public.google_calendar_abort_disconnect('77777777-7777-4777-8777-777777777777');
  assert (select disconnecting_at is null from public.google_calendar_tokens where id='77777777-7777-4777-8777-777777777777');
  assert public.google_calendar_begin_disconnect('77777777-7777-4777-8777-777777777777');
  perform public.google_calendar_disconnect_connection('77777777-7777-4777-8777-777777777777');
  assert (select disconnected_at is not null and token_secret_ref is null from public.google_calendar_tokens where id='77777777-7777-4777-8777-777777777777');
  assert not public.google_calendar_begin_disconnect('88888888-8888-4888-8888-888888888888'), 'live jobs must block disconnect';

  -- Service-only helper round-trip uses a synthetic disposable Vault secret.
  secret := public.google_calendar_save_token_secret(null,'synthetic-token','synthetic-test','test');
  assert public.google_calendar_get_token_secret(secret)='synthetic-token';
end $queue$;
do $delete_error$
declare job public.google_calendar_sync_jobs;
begin
  insert into public.google_calendar_event_links(id,organization_id,connection_id) values
    ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','22222222-2222-4222-8222-222222222222','88888888-8888-4888-8888-888888888888'),
    ('dddddddd-dddd-4ddd-8ddd-ddddddddddd2','11111111-1111-4111-8111-111111111111','77777777-7777-4777-8777-777777777777');
  insert into public.google_calendar_sync_jobs(id,organization_id,action,payload) values
    ('dddddddd-dddd-4ddd-8ddd-ddddddddddd3','22222222-2222-4222-8222-222222222222','push_delete',
      jsonb_build_object('event_id','dddddddd-dddd-4ddd-8ddd-ddddddddddd4',
        'owner_user_id','44444444-4444-4444-8444-444444444444',
        'link_ids',jsonb_build_array('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','dddddddd-dddd-4ddd-8ddd-ddddddddddd2')));
  perform public.google_calendar_claim_outbound_sync_jobs_v2(20,'delete-worker');
  select * into job from public.google_calendar_sync_jobs where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd3';
  assert job.status='running' and job.locked_by='delete-worker';
  assert not public.google_calendar_finish_outbound_job(job.id,'stale-worker','dead','delete-failed',0,true);
  assert (select last_error is null from public.google_calendar_event_links where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
  assert public.google_calendar_finish_outbound_job(job.id,'delete-worker','dead','delete-failed',0,true);
  assert (select last_error='delete-failed' from public.google_calendar_event_links where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd1');
  assert (select last_error is null from public.google_calendar_event_links where id='dddddddd-dddd-4ddd-8ddd-ddddddddddd2'),
    'fenced delete errors cannot modify a link from another tenant/connection';
end $delete_error$;
reset role;
set session authorization postgres;
rollback;
