begin;
insert into public.organizations(id,is_active) values('10000000-0000-4000-8000-000000000001',true),('10000000-0000-4000-8000-000000000002',true);
insert into public.users(id,name) select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||n from generate_series(1,8)n;
insert into public.organization_members(organization_id,user_id,role)
  select '10000000-0000-4000-8000-000000000001',id,case when name='Synthetic 6' then 'admin' else 'user' end from public.users;
insert into public.round_robins(id,organization_id,settings)
values('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',
  jsonb_build_object('enable_redistribution',true,'redistribution_timeout_minutes',1,'redistribution_warning_minutes',0,'redistribution_max_attempts',30,
    'operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',(select jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',true,
      'is_all_day',true,'start_time',null,'end_time',null)) from generate_series(0,6)n)))),
('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','{}');
insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position)
select ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'10000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,n from generate_series(1,5)n;
insert into public.leads(id,organization_id,origin_round_robin_id)
values('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001');
select private.fixture_assert(private.queue_schedule_valid((select settings->'operating_schedule' from public.round_robins limit 1)),'calendar valid');
select private.fixture_assert(not private.queue_schedule_valid('{"version":1,"timezone":"Invalid/Zone","days":[]}'),'invalid calendar closed');
select private.fixture_assert((private.queue_window('10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002')->>'managed')::boolean=false,'legacy no calendar');

-- Real canonical allocator source + actual newest picker, not a model copy.
select private.fixture_assert((private.distribute_lead('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','initial-1',
  '30000000-0000-4000-8000-000000000001',false,'meta',clock_timestamp()-interval '5 days')->>'reason')='assigned','initial allocated');
select private.fixture_assert((select assigned_at>clock_timestamp()-interval '1 minute' from public.leads limit 1),'provider timestamp cannot backdate managed assignment');
select private.fixture_assert((select count(*)=1 from private.queue_round_visits),'initial visit recorded');
select private.fixture_assert((private.distribute_lead('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','initial-1',
  '30000000-0000-4000-8000-000000000001',false,'meta')->>'reason')='assigned','replay cached');
select private.fixture_assert((select count(*)=1 from public.assignments_log),'replay no assignment duplicate');

do $rounds$
declare k integer; r jsonb;
begin
  for k in 1..9 loop
    r:=private.queue_runtime_step('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',clock_timestamp(),true);
    perform private.fixture_assert(r->>'reason'='assigned','successive round assignment '||k);
  end loop;
end;
$rounds$;
select private.fixture_assert((select count(*)=10 and count(distinct round_number)=2 from private.queue_round_visits),'five recipients in each of two rounds');
select private.fixture_assert(not exists(select round_number from private.queue_round_visits group by round_number having count(*)<>5),'no A B short round with C D E eligible');

-- Unknown legacy and client-side GUC writers cannot move a managed card.
do $guard$
begin
  perform set_config('app.queue_runtime_bypass','true',true);
  begin
    update public.leads set assigned_user_id='20000000-0000-4000-8000-000000000007';
    raise exception 'ASSERTION FAILED: unmanaged writer accepted';
  exception when insufficient_privilege then null; end;
end;
$guard$;

-- Pool is owner-null; private visibility overrides an intentionally broad old policy.
select private.queue_runtime_pool('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','queue_closed',clock_timestamp(),'{"open":false}');
select private.fixture_assert((select assigned_user_id is null from public.leads),'pool removes actual owner');
select private.fixture_assert(private.queue_pool_read_access('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001'),'participant reads private pool');
select private.fixture_assert(private.queue_pool_read_access('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000006'),'admin reads private pool');
select private.fixture_assert(not private.queue_pool_read_access('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000007'),'other org member cannot read pool');
insert into public.lead_notes(organization_id,lead_id,body) values('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','private');
insert into public.lead_attachments(lead_id,body) values('50000000-0000-4000-8000-000000000001','private without organization column');
select set_config('request.jwt.claim.sub','20000000-0000-4000-8000-000000000007',true);
set local role authenticated;
select private.fixture_assert((select count(*)=0 from public.leads),'RLS ceiling despite broad legacy policy');
select private.fixture_assert((select count(*)=0 from public.lead_notes),'RLS related resource ceiling');
select private.fixture_assert((select count(*)=0 from public.lead_attachments),'RLS attachment without org column ceiling');
reset role;

do $claim$
declare r private.queue_lead_runtime%rowtype; response jsonb; count_before integer;
begin
  select * into r from private.queue_lead_runtime;
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000007',r.round_robin_id,r.episode_id,r.revision,'forbidden');
  perform private.fixture_assert(response->>'reason'='forbidden','outsider claim denied');
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',r.round_robin_id,r.episode_id,r.revision+1,'stale');
  perform private.fixture_assert(response->>'reason'='revision_conflict','CAS stale rejected');
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',r.round_robin_id,r.episode_id,r.revision,'claim-1');
  perform private.fixture_assert(response->>'reason'='claimed','claim succeeds');
  select count(*) into count_before from public.assignments_log;
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',r.round_robin_id,r.episode_id,r.revision,'claim-1');
  perform private.fixture_assert(response->>'reason'='already_claimed','claim replay');
  perform private.fixture_assert((select count(*)=count_before from public.assignments_log),'claim replay did not write');
  response:=private.queue_runtime_step(r.organization_id,r.lead_id,clock_timestamp()+interval '1 day',true);
  perform private.fixture_assert(response->>'reason'='queue_protected','claim survives next opening');
end;
$claim$;
do $claim_replay_after_transfer$
declare r private.queue_lead_runtime%rowtype; revision_before bigint; response jsonb;
begin
  select * into r from private.queue_lead_runtime;
  revision_before:=r.revision;
  perform private.fixture_assert(not private.prepare_queue_manual_transfer(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',null),'manual NULL rejected');
  perform private.fixture_assert((select revision=revision_before from private.queue_lead_runtime),'rejected NULL does not protect/mutate');
  perform private.fixture_assert(private.prepare_queue_manual_transfer(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002'),'authorized manual transfer');
  update public.leads set assigned_user_id='20000000-0000-4000-8000-000000000002',assigned_at=clock_timestamp();
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',r.round_robin_id,r.episode_id,r.revision-1,'claim-1');
  perform private.fixture_assert(response->>'reason'='revision_conflict','old claim receipt cannot hydrate another current owner');
  update public.organization_members set is_active=false where user_id='20000000-0000-4000-8000-000000000001';
  response:=private.claim_queue_pool(r.organization_id,r.lead_id,'20000000-0000-4000-8000-000000000001',r.round_robin_id,r.episode_id,r.revision-1,'claim-1');
  perform private.fixture_assert(response->>'reason'='forbidden','old receipt never restores removed membership');
end;
$claim_replay_after_transfer$;
select private.fixture_assert(not has_function_privilege('authenticated','private.claim_queue_pool(uuid,uuid,uuid,uuid,uuid,bigint,text)','execute'),'claim never callable from client with forged actor');
select private.fixture_assert(not has_table_privilege('authenticated','private.queue_runtime_commands','insert'),'cannot forge command table');
select private.fixture_assert(not has_function_privilege('service_role','private.distribute_lead_legacy_before_queue_runtime(uuid,uuid,text,uuid,boolean,text,timestamptz)','execute'),'legacy cannot bypass canonical boundary');
set constraints all immediate;
rollback;
