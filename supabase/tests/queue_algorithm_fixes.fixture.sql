-- Source-only fixture, composed by queue-algorithm-regression.mjs. Execute only
-- on a verified disposable migrated database, inside its BEGIN/ROLLBACK wrapper.
do $$begin
  if current_database() not like 'vimob\_%' escape '\' then
    raise exception 'requires disposable local vimob_ database';end if;
end$$;
create function pg_temp.qid(kind integer,n integer) returns uuid language sql immutable as $$
  select ('d161'||lpad(kind::text,4,'0')||'-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.queue_assert(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'QUEUE REGRESSION: %',label;end if;end$$;
insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,
  raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
select pg_temp.qid(2,n),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'queue-fixes-'||n||'@example.test','',now(),'{}','{}',now(),now(),'','','','' from generate_series(1,8)n;
insert into public.organizations(id,name,slug,is_active) values
  (pg_temp.qid(1,1),'Queue fixes synthetic A','queue-fixes-synthetic-a',true),
  (pg_temp.qid(1,2),'Queue fixes synthetic B','queue-fixes-synthetic-b',true);
insert into public.users(id,organization_id,name,email,role,is_active)
select pg_temp.qid(2,n),pg_temp.qid(1,case when n=8 then 2 else 1 end),
  'Synthetic broker '||n,'queue-fixes-'||n||'@example.test',case when n=6 then 'admin' else 'user' end,true
from generate_series(1,8)n on conflict(id) do update set organization_id=excluded.organization_id,
  name=excluded.name,email=excluded.email,role=excluded.role,is_active=true;
insert into public.organization_members(organization_id,user_id,role,is_active)
select organization_id,id,case when id=pg_temp.qid(2,6) then 'admin' else 'user' end,true
from public.users where id in(select pg_temp.qid(2,n) from generate_series(1,8)n)
on conflict(organization_id,user_id) do update set role=excluded.role,is_active=true,deleted_at=null;
insert into auth.sessions(id,user_id,created_at,updated_at)
select pg_temp.qid(7,n),pg_temp.qid(2,n),now(),now() from generate_series(1,8)n;
insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed)
select pg_temp.qid(1,1),pg_temp.qid(2,n),permission,true from generate_series(1,7)n
cross join unnest(array['lead_view_own','lead_view_all','lead_operate'])permission
on conflict(organization_id,user_id,permission_key) do update set allowed=true;
insert into public.pipelines(id,organization_id,name,is_active)
values(pg_temp.qid(3,1),pg_temp.qid(1,1),'Queue fixes pipeline',true);
insert into public.stages(id,organization_id,pipeline_id,name,stage_key,position,is_active)
select pg_temp.qid(4,n),pg_temp.qid(1,1),pg_temp.qid(3,1),'Synthetic stage '||n,'queue-fixes-'||n,n,true
from generate_series(1,4)n;
insert into public.round_robins(id,organization_id,name,strategy,pipeline_id,target_pipeline_id,target_stage_id,settings)
select pg_temp.qid(6,q),pg_temp.qid(1,1),'Synthetic queue '||q,'simple',pg_temp.qid(3,1),pg_temp.qid(3,1),pg_temp.qid(4,1),
  jsonb_build_object('enable_redistribution',true,'redistribution_timeout_minutes',1,'redistribution_warning_minutes',0,
    'redistribution_max_attempts',0,'pool_notifications',jsonb_build_object('enabled',false),
    'operating_schedule',jsonb_build_object('version',1,'timezone','UTC','days',
      (select jsonb_agg(jsonb_build_object('day_of_week',n,'is_active',q=1,'is_all_day',q=1,
        'start_time',null,'end_time',null) order by n) from generate_series(0,6)n))) from generate_series(1,2)q;
insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,is_active)
select pg_temp.qid(10,q*10+n),pg_temp.qid(1,1),pg_temp.qid(6,q),pg_temp.qid(2,n),n,true
from generate_series(1,2)q cross join generate_series(1,5)n;

create function pg_temp.queue_new_lead(n integer,q integer default 1,manual_owner integer default null,
  initial_stage integer default 1,origin_nullable boolean default false) returns uuid language plpgsql as $$
declare lead_id uuid:=pg_temp.qid(5,n); result jsonb;
begin
  insert into public.leads(id,organization_id,name,source,pipeline_id,stage_id,origin_round_robin_id,
    metadata,assigned_user_id,assigned_at)
  values(lead_id,pg_temp.qid(1,1),'Synthetic queue lead '||n,'manual',pg_temp.qid(3,1),pg_temp.qid(4,initial_stage),
    case when not origin_nullable then pg_temp.qid(6,q) end,'{"distribution_deferred":true}',case when manual_owner is not null then pg_temp.qid(2,manual_owner) end,
    case when manual_owner is not null then clock_timestamp() end);
  if manual_owner is null then
    result:=private.distribute_lead(pg_temp.qid(1,1),lead_id,'queue-fixes-'||n,pg_temp.qid(6,q),false,'meta');
    perform pg_temp.queue_assert(result->>'reason'=case when q=1 then 'assigned' else 'queue_closed' end,
      'canonical fixture intake '||n||': '||result::text);
  end if;
  return lead_id;
end$$;
create function pg_temp.queue_set_rule(stage integer,target uuid,slot integer default 1) returns void language sql as $$
  insert into public.stage_automations(id,organization_id,stage_id,trigger_type,action_type,automation_type,action_config,is_active,created_at)
  values(pg_temp.qid(8,stage*10+slot),pg_temp.qid(1,1),pg_temp.qid(4,stage),'on_enter','change_assignee',
    'change_assignee_on_enter',jsonb_build_object('target_user_id',target),true,now()+make_interval(secs=>slot))
  on conflict(id) do update set action_config=excluded.action_config,is_active=true
$$;
create function pg_temp.queue_digest(id uuid) returns text language sql stable as $$
  select jsonb_build_object('lead',to_jsonb(l),'runtime',to_jsonb(r),
    'visits',(select count(*) from private.queue_round_visits where lead_id=l.id),
    'events',(select count(*) from private.queue_runtime_events where lead_id=l.id),
    'logs',(select count(*) from public.round_robin_logs where lead_id=l.id),
    'assignments',(select count(*) from public.assignments_log where lead_id=l.id),
    'activities',(select count(*) from public.activities where lead_id=l.id),
    'facts',(select count(*) from public.lead_action_facts where lead_id=l.id))::text
  from public.leads l left join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id where l.id=$1
$$;
create function pg_temp.queue_actor(n integer) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub',pg_temp.qid(2,n)::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.qid(2,n),'role','authenticated',
    'session_id',pg_temp.qid(7,n),'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
-- Only fixture construction changes the legacy immutable attention enrollment.
-- Re-enable and attest the single clock trigger BEFORE any tested operation.
create function pg_temp.queue_legacy_attention(id uuid) returns void language plpgsql as $$
begin
  perform pg_temp.queue_assert((select tgenabled='O' from pg_trigger
    where tgrelid='public.leads'::regclass and tgname='trg_guard_lead_clocks'),'clock guard initially enabled');
  set constraints all immediate;
  alter table public.leads disable trigger trg_guard_lead_clocks;
  update public.leads set attention_eligible=false,attention_enrolled_at=null where leads.id=$1;
  alter table public.leads enable trigger trg_guard_lead_clocks;
  perform pg_temp.queue_assert((select tgenabled='O' from pg_trigger
    where tgrelid='public.leads'::regclass and tgname='trg_guard_lead_clocks'),'clock guard restored before test');
  set constraints all deferred;
  perform pg_temp.queue_assert(not exists(select 1 from public.stage_operational_configs c join public.leads l on l.stage_id=c.stage_id
    where l.id=$1 and (c.cadence_enabled or c.attention_mode<>'disabled')),'optional attention/cadence remain disabled');
  perform pg_temp.queue_assert(not exists(select 1 from private.stage_inactivity_policies p join public.leads l on l.stage_id=p.stage_id
    where l.id=$1),'no optional inactivity policy');
end$$;
