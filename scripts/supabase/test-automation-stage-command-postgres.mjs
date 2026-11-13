import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// Explicit disposable server only. Never reads application env/config/DSNs.
const port=Number(process.argv[2]);
assert.ok(Number.isInteger(port)&&port>=20000&&port<=65535,'Pass the owned loopback fixture port');
const database=`vimob_pipeline_stage_command_${randomBytes(6).toString('hex')}`;
const settings={host:'127.0.0.1',port,user:'postgres',database:'postgres',connectionTimeoutMillis:5000};
const admin=new pg.Client(settings);
const clients=[];
let created=false;
let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
try {
  await admin.connect();
  await admin.query(`create database "${database}"`);created=true;
  const db=new pg.Client({...settings,database});clients.push(db);await db.connect();
  await db.query(`
    create schema private;
    create table public.organization_modules(organization_id uuid,module_name text,is_enabled boolean);
    create table public.automation_flow_versions(id uuid primary key,organization_id uuid,requires_review boolean default false,graph jsonb);
    create table public.automation_executions(
      id uuid primary key,organization_id uuid,flow_version_id uuid,lead_id uuid,
      current_node_key text,status text,locked_by text,locked_at timestamptz,
      cancellation_requested_at timestamptz,attempt_count integer default 1,
      execution_data jsonb default '{}',started_at timestamptz default now(),
      completed_at timestamptz,error_message text,updated_at timestamptz default now(),next_execution_at timestamptz);
    create table public.automation_execution_steps(id uuid primary key,organization_id uuid,
      execution_id uuid,node_key text,status text,attempt integer,completed_at timestamptz,error_message text);
  `);
  await db.query(await readFile(new URL('../../supabase/migrations/20261016041918_automation_canonical_stage_command_guard.sql',import.meta.url),'utf8'));
  const distributionDeferral = await readFile(new URL('../../supabase/migrations/20261113153247_allow_automation_distribution_deferral.sql',import.meta.url),'utf8');
  await db.query(distributionDeferral);
  await db.query(distributionDeferral);
  const org='10000000-0000-4000-8000-000000000001',foreign='10000000-0000-4000-8000-000000000002';
  const version='20000000-0000-4000-8000-000000000001',execution='30000000-0000-4000-8000-000000000001';
  const step='40000000-0000-4000-8000-000000000001';
  await db.query('insert into public.organization_modules values($1,\'automations\',true)',[org]);
  await db.query('insert into public.automation_flow_versions(id,organization_id,graph) values($1,$2,$3)',[version,org,{nodes:[{id:'move-a',type:'action',action_type:'move_lead'},{id:'tag-a',type:'action',action_type:'add_tag'},{id:'queue-a',type:'action',action_type:'distribute_lead'}]}]);
  const reset=async(node='move-a')=>{
    await db.query('delete from public.automation_execution_steps');
    await db.query('delete from public.automation_executions');
    await db.query('insert into public.automation_executions(id,organization_id,flow_version_id,current_node_key,status,locked_by,locked_at) values($1,$2,$3,$4,\'running\',\'lease-a\',now())',[execution,org,version,node]);
    await db.query('insert into public.automation_execution_steps values($1,$2,$3,$4,\'running\',1,null,null)',[step,org,execution,node]);
  };
  const defer=async(args=[org,execution,step,'move-a','lease-a'])=>(await db.query('select public.defer_automation_stage_command($1,$2,$3,$4,$5) as result',args)).rows[0].result;
  await reset();
  for(const args of [[foreign,execution,step,'move-a','lease-a'],[org,execution,step,'move-a','stale'],[org,execution,step,'tag-a','lease-a']]) {
    check((await defer(args)).ok===false,'foreign org, stale lease or node cannot defer');
  }
  await db.query('update public.automation_executions set cancellation_requested_at=now()');
  check((await defer()).ok===false,'cancelled execution cannot defer');
  await reset('tag-a');check((await defer([org,execution,step,'tag-a','lease-a'])).ok===false,'other action cannot defer');
  await reset('queue-a');
  check((await defer([foreign,execution,step,'queue-a','lease-a'])).ok===false,'foreign distribution cannot defer');
  const queueDeferral = await defer([org,execution,step,'queue-a','lease-a']);
  check(queueDeferral.ok && queueDeferral.status === 'queued' && queueDeferral.attempts === 1,'distribution can defer on its original node and lease');
  await reset();
  await db.query('update public.organization_modules set is_enabled=false');
  check((await defer()).ok===false,'disabled module cannot defer');
  await db.query('update public.organization_modules set is_enabled=true');
  await db.query('update public.automation_flow_versions set requires_review=true');
  check((await defer()).ok===false,'unreviewed graph cannot defer');
  await db.query('update public.automation_flow_versions set requires_review=false');
  for(const data of [[], 'invalid', {stage_command_retries:[]}, {stage_command_retries:'invalid'}]) {
    await db.query('update public.automation_executions set execution_data=$1',[JSON.stringify(data)]);
    check((await defer()).status==='retry_state_invalid','corrupted retry state cannot reset the bounded retry counter');
  }
  await db.query("update public.automation_executions set execution_data='{}'");
  for(let attempt=0;attempt<3;attempt++) {
    const result=await defer();
    check(result.ok&&result.status==='queued'&&result.attempts===attempt+1,'retry stays on original node and is bounded');
    const {rows:[row]}=await db.query('select current_node_key,status,locked_by,next_execution_at>now() as delayed,extract(epoch from next_execution_at-now()) as seconds from public.automation_executions');
    check(row.current_node_key==='move-a'&&row.status==='queued'&&row.locked_by===null&&row.delayed,'deferral releases lease without advancing node');
    check(Number(row.seconds)>30*(2**attempt)-5&&Number(row.seconds)<=30*(2**attempt),'30/60/120 second backoff');
    check((await db.query("select * from public.claim_automation_executions('worker-b',5)")).rowCount===0,'future deferred work cannot be claimed early');
    check((await db.query('select * from public.claim_specific_automation_execution($1,$2,$3)',[org,execution,'direct-worker'])).rowCount===0,'direct starter cannot bypass the database backoff clock');
    await db.query("update public.automation_executions set next_execution_at=now()-interval '1 second'");
    check((await db.query("select * from public.claim_automation_executions('lease-a',5)")).rowCount===1,'due work can be reclaimed once');
    await db.query('update public.automation_execution_steps set status=\'running\',attempt=$1,error_message=null,completed_at=null',[attempt+2]);
  }
  check((await defer()).status==='failed','fourth unavailable outcome terminates explicitly');
  check((await db.query('select status,error_message from public.automation_executions')).rows[0].error_message==='automation_command_retry_exhausted','exhaustion has a stable visible error');
  await reset();
  await db.query("update public.automation_executions set status='queued',locked_by=null,locked_at=null");
  const rival=new pg.Client({...settings,database});clients.push(rival);await rival.connect();
  await db.query('begin');await db.query('select id from public.automation_executions for update');
  check((await rival.query("select * from public.claim_automation_executions('rival',5)")).rowCount===0,'concurrent claim skips locked execution');
  await db.query('commit');
  check((await rival.query("select * from public.claim_automation_executions('rival',5)")).rowCount===1,'claim proceeds after competing transaction releases');
  await assert.rejects(db.query('select private.automation_move_lead_stage($1,$2,$3,$4)',[org,execution,step,null]),error=>error.code==='55000'&&error.message==='canonical_lead_command_required');checks++;
  for(const role of ['anon','authenticated','service_role']) {
    const {rows:[grants]}=await db.query("select has_function_privilege($1,'public.defer_automation_stage_command(uuid,uuid,uuid,text,text)','execute') as defer,has_function_privilege($1,'public.claim_specific_automation_execution(uuid,uuid,text)','execute') as direct,has_function_privilege($1,'private.automation_move_lead_stage(uuid,uuid,uuid,uuid)','execute') as legacy",[role]);
    check(grants.defer===(role==='service_role')&&grants.direct===(role==='service_role')&&!grants.legacy,'least privilege for internal RPCs and retired bypass');
  }
  await reset();await db.query("update public.automation_executions set status='queued',locked_by=null,locked_at=null");
  check((await db.query('select * from public.claim_specific_automation_execution($1,$2,$3)',[foreign,execution,'direct-worker'])).rowCount===0,'direct starter is tenant scoped');
  check((await db.query('select * from public.claim_specific_automation_execution($1,$2,$3)',[org,execution,'direct-worker'])).rowCount===1,'direct starter claims due work once');
  check((await db.query('select * from public.claim_specific_automation_execution($1,$2,$3)',[org,execution,'rival-worker'])).rowCount===0,'direct starter cannot claim an existing lease');
  await db.query(`
    create table public.users(id uuid primary key,is_active boolean default true);
    create table public.organization_members(organization_id uuid,user_id uuid,is_active boolean default true,deleted_at timestamptz,membership_generation bigint default 1);
    create table public.team_members(organization_id uuid,team_id uuid,user_id uuid,is_active boolean default true,membership_generation bigint default 1);
    create table public.stage_automations(id uuid default gen_random_uuid(),organization_id uuid,stage_id uuid,is_active boolean default true,
      trigger_type text default 'on_enter',created_at timestamptz default now(),automation_type text,action_config jsonb default '{}');
    create table public.leads(id uuid primary key,organization_id uuid,stage_id uuid,team_id uuid,assigned_user_id uuid,
      deal_status text default 'open',won_at timestamptz,lost_at timestamptz,lost_reason text);
  `);
  await db.query(await readFile(new URL('../../supabase/migrations/20261016043851_pipeline_stage_assignee_team_consistency.sql',import.meta.url),'utf8'));
  await db.query('create trigger synthetic_stage_entry before insert or update on public.leads for each row execute function public.execute_stage_automations()');
  const user='50000000-0000-4000-8000-000000000001',previous='50000000-0000-4000-8000-000000000002',team='60000000-0000-4000-8000-000000000001';
  await db.query('insert into public.users(id) values($1),($2)',[user,previous]);
  await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)',[org,user]);
  await db.query('insert into public.stage_automations(organization_id,stage_id,automation_type,action_config) values($1,$2,\'change_assignee_on_enter\',$3)',[org,step,{target_user_id:user}]);
  const enter=async(linkedTeam=team)=>{
    await db.query('delete from public.leads');
    return (await db.query('insert into public.leads(id,organization_id,stage_id,team_id,assigned_user_id) values($1,$2,$3,$4,$5) returning assigned_user_id,deal_status',[execution,org,step,linkedTeam,previous])).rows[0];
  };
  check((await enter()).assigned_user_id===previous,'on-enter cannot assign a non-member of the lead team');
  await db.query('insert into public.team_members(organization_id,team_id,user_id) values($1,$2,$3)',[org,team,user]);
  check((await enter()).assigned_user_id===user,'on-enter accepts active team member of the same generation');
  await db.query('update public.team_members set is_active=false');
  check((await enter()).assigned_user_id===previous,'inactive team member is ignored');
  await db.query('update public.team_members set is_active=true,membership_generation=0');
  check((await enter()).assigned_user_id===previous,'old membership generation cannot regain assignment');
  await db.query('update public.team_members set membership_generation=1,organization_id=$1',[foreign]);
  check((await enter()).assigned_user_id===previous,'foreign organization membership cannot assign');
  check((await enter(null)).assigned_user_id===user,'lead without team retains ordinary active-org-member behavior');
  await db.query('update public.team_members set organization_id=$1',[org]);
  await db.query('update public.organization_members set deleted_at=now()');
  check((await enter()).assigned_user_id===previous,'removed org member cannot be assigned by legacy rule');
  await db.query('update public.organization_members set deleted_at=null');
  await db.query('insert into public.stage_automations(organization_id,stage_id,automation_type,action_config) values($1,$2,\'change_deal_status_on_enter\',\'{"deal_status":"won"}\')',[org,step]);
  check((await enter()).deal_status==='won','team guard preserves ordinary stage outcome behavior');
  await db.query('begin');
  await db.query("select set_config('vimob.lead_creation_status_scope',$1,true),set_config('vimob.lead_creation_status_phase','defer',true)",[`${org}/${execution}`]);
  const deferredCreation=await enter();await db.query('commit');
  check(deferredCreation.deal_status==='open'&&deferredCreation.assigned_user_id===user,'creation status deferral still preserves valid assignee rules');
  console.log(`PASS ${checks} PostgreSQL behavioral checks; synthetic owned database, no operational data. Migrations applied only in fixture.`);
} finally {
  for(const client of clients) await client.end().catch(()=>{});
  if(created) await admin.query(`drop database "${database}"`);
  await admin.end();
}
