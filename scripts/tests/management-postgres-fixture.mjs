import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// No app dependency, credentials, network, services, disk DB or external schema.
// Caller supplies a separately installed PGlite module; missing means failure.
const modulePath=process.env.VIMOB_MANAGEMENT_PGLITE_MODULE;
assert.ok(modulePath && path.isAbsolute(modulePath),'VIMOB_MANAGEMENT_PGLITE_MODULE must name a local absolute module file');
const {PGlite}=await import(pathToFileURL(modulePath).href);
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const migration=name=>path.join(root,'supabase/migrations',name);
const cache=new Map();
async function source(name){if(!cache.has(name))cache.set(name,await readFile(migration(name),'utf8'));return cache.get(name);}
function extractFunction(text,schema,name){
  assert.match(schema,/^[a-z_][a-z0-9_]*$/i);
  assert.match(name,/^[a-z_][a-z0-9_]*$/i);
  const declaration=new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+"?${schema}"?\\s*\\.\\s*"?${name}"?\\s*\\(`,'i').exec(text);
  assert.ok(declaration,`canonical function missing: ${schema}.${name}`);
  const remainder=text.slice(declaration.index);
  const body=/\bas\s+(\$(?:[a-zA-Z0-9_]+)?\$)/i.exec(remainder);
  assert.ok(body,`dollar body missing: ${schema}.${name}`);
  const end=remainder.indexOf(body[1],body.index+body[0].length);
  assert.ok(end>=0,`unterminated body: ${schema}.${name}`);
  const tail=remainder.slice(end+body[1].length).match(/^\s*;/);
  assert.ok(tail,`function terminator missing: ${schema}.${name}`);
  return remainder.slice(0,end+body[1].length+tail[0].length);
}
const baseline='20260722000000_production_public_private_baseline.sql';
const generation='20261009030225_membership_access_generation.sql';
const tagIntegrity='20261012212837_management_tag_reference_integrity.sql';
const tagSemantic='20261013003930_management_tag_semantic_references.sql';
const testedMigrations=[
  '20261013033722_management_distribution_read_authorization.sql',
  '20261013033953_management_tag_reparent_and_automation_events.sql',
  '20261013034403_management_all_day_overnight_eligibility.sql',
];
const pg=await PGlite.create('memory://');
const uid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const A=uid(1),B=uid(2),broker=uid(10),manager=uid(11),leader=uid(12),admin=uid(13),owner=uid(14);
const foreign=uid(15),coworker=uid(16),outside=uid(17),team=uid(500),pipeline=uid(600),teamMember=uid(801);
const queues=[400,401,402,403].map(uid),foreignQueue=uid(404),role=uid(200),permission=uid(210);
const tag=uid(300),foreignTag=uid(301),lead=uid(900),otherLead=uid(901),execution=uid(920),version=uid(710),automation=uid(700);
let count=0,effectNumber=0;
async function check(name,fn){await fn();count+=1;console.log(`PASS ${name}`);}
async function runFunction(file,schema,name){await pg.exec(extractFunction(await source(file),schema,name));}
async function scalar(sql,args=[]){return (await pg.query(sql,args)).rows[0].value;}
async function eventCount(){return Number(await scalar('select count(*)::integer value from private.realtime_events'));}
async function grantActor(actor,key='distribution_manage'){
  await pg.exec('delete from public.user_organization_roles;delete from public.organization_role_permissions;delete from public.user_permission_overrides;');
  await pg.query('update public.organization_roles set is_active=true where id=$1',[role]);
  await pg.query('update public.available_permissions set key=$2 where id=$1',[permission,key]);
  await pg.query('insert into public.user_organization_roles values($1,$2,$3,true)',[actor,A,role]);
  await pg.query('insert into public.organization_role_permissions values($1,$2,$3,$4)',[A,role,permission,key]);
}
async function overrideActor(actor,allowed,key='distribution_manage'){
  await pg.query('insert into public.user_permission_overrides(organization_id,user_id,permission_key,allowed) values($1,$2,$3,$4)',[A,actor,key,allowed]);
}
async function visible(actor,expected,claims={}){
  await pg.transaction(async tx=>{
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:actor,session_id:uid(Number(actor.slice(-12))+100),amr:[{method:'password'}],...claims})]);
    for(const [table,field] of [['round_robins','id'],['round_robin_rules','round_robin_id'],['round_robin_members','round_robin_id']]){
      const rows=(await tx.query(`select ${field}::text id from public.${table} order by ${field}`)).rows;
      assert.deepEqual(rows.map(row=>row.id),[...expected].sort(),`${table} scoped rows`);
    }
  });
}
async function effect(type,tagId=tag,key=`fixture-effect-${++effectNumber}`,organization=A){
  return pg.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query('select public.apply_automation_internal_effect($1::uuid,$2::uuid,$3,$4,$5,$6,$7::jsonb) value',
      [organization,execution,'node-tag','fixture-lease',key,type,JSON.stringify({tag_id:tagId})])).rows[0].value;
  });
}
async function picker(queue,day,time,ignore=false){return (await pg.query('select * from private.pick_round_robin_ticket_candidate($1::uuid,$2::uuid,$3,$4,$5,$6::time,$7::bigint)',[A,queue,'weighted',ignore,day,time,1])).rows;}

try{
  console.log(`PostgreSQL ${await scalar('show server_version') ?? (await pg.query('show server_version')).rows[0].server_version}; memory-only fixture`);
  await pg.exec(await readFile(new URL('./management-postgres-fixture.sql',import.meta.url),'utf8'));
  await runFunction(baseline,'private','safe_uuid');
  await runFunction('20260827000000_distinguish_disabled_and_deleted_organization_members.sql','private','get_user_organization_id');
  await runFunction('20261012201751_restrict_lead_data_api_reads_to_active_session.sql','private','has_active_lead_read_session');
  for(const name of ['set_membership_generation','bind_participant_membership_generation','pick_round_robin_ticket_candidate'])await runFunction(generation,'private',name);
  await runFunction(baseline,'public','apply_automation_internal_effect');
  await pg.exec(`
    grant execute on function private.get_user_organization_id(),private.has_active_lead_read_session() to authenticated;
    revoke all on function public.apply_automation_internal_effect(uuid,uuid,text,text,text,text,jsonb) from public,anon,authenticated;
    grant execute on function public.apply_automation_internal_effect(uuid,uuid,text,text,text,text,jsonb) to service_role;
    create trigger fixture_membership_generation before insert or update on public.organization_members for each row execute function private.set_membership_generation();
    create trigger fixture_team_generation before insert or update of user_id,organization_id,is_active on public.team_members for each row execute function private.bind_participant_membership_generation();
    create trigger fixture_queue_generation before insert or update of user_id,organization_id,is_active on public.round_robin_members for each row execute function private.bind_participant_membership_generation();
  `);
  for(const table of ['round_robins','round_robin_rules','round_robin_members'])await pg.exec(`create policy fixture_tenant_boundary on public.${table} for select to authenticated using(organization_id=private.get_user_organization_id())`);
  for(const file of [tagIntegrity,tagSemantic,...testedMigrations])await pg.exec(await source(file));
  await check('three current migrations and canonical helpers parse and execute',async()=>{
    for(const name of ['can_read_management_distribution','publish_automation_tag_association'])assert.equal(await scalar("select has_function_privilege('anon',(select oid from pg_proc where proname=$1),'execute') value",[name]),false);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.apply_automation_internal_effect(uuid,uuid,text,text,text,text,jsonb)','execute') value"),false);
  });
  await pg.query('insert into public.organizations(id) values($1),($2)',[A,B]);
  for(const [actor,memberRole,org] of [[broker,'broker',A],[manager,'manager',A],[leader,'broker',A],[admin,'admin',A],[owner,'owner',A],[foreign,'broker',B],[coworker,'broker',A],[outside,'broker',A]]){
    await pg.query('insert into public.users(id,organization_id,name) values($1,$2,$3)',[actor,org,memberRole]);
    await pg.query('insert into public.organization_members(organization_id,user_id,role) values($1,$2,$3)',[org,actor,memberRole]);
    await pg.query('insert into auth.sessions values($1,$2)',[uid(Number(actor.slice(-12))+100),actor]);
  }
  await pg.query('insert into public.organization_roles values($1,$2,true)',[role,A]);
  await pg.query('insert into public.available_permissions values($1,$2)',[permission,'distribution_manage']);
  await pg.query('insert into public.pipelines values($1,$2,true)',[pipeline,A]);
  await pg.query('insert into public.teams values($1,$2,true)',[team,A]);
  await pg.query('insert into public.team_members(id,organization_id,team_id,user_id,is_leader) values($1,$2,$3,$4,true),($5,$2,$3,$6,false)',[uid(800),A,team,leader,teamMember,coworker]);
  await pg.query('insert into public.team_pipelines(organization_id,team_id,pipeline_id) values($1,$2,$3)',[A,team,pipeline]);
  for(const [index,queue] of [...queues,foreignQueue].entries()){
    const org=index===4?B:A;
    await pg.query('insert into public.round_robins(id,organization_id,created_by,pipeline_id) values($1,$2,$3,$4)',[queue,org,index===0?leader:null,index===1?pipeline:null]);
    await pg.query("insert into public.round_robin_rules(organization_id,round_robin_id,match_type) values($1,$2,'source')",[org,queue]);
    await pg.query('insert into public.round_robin_members(organization_id,round_robin_id,user_id) values($1,$2,$3)',[org,queue,index===4?foreign:index===2?coworker:outside]);
  }
  await check('broker and manager lack distribution access by default',async()=>{await visible(broker,[]);await visible(manager,[]);});
  await check('owner/admin read three tables only in selected tenant',async()=>{await visible(admin,queues);await visible(owner,queues);});
  await check('permission helper itself rejects cross-tenant IDs independently of permissive fixture policy',async()=>{
    await pg.transaction(async tx=>{
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:owner,session_id:uid(114),amr:[{method:'password'}]})]);
      assert.equal((await tx.query('select private.can_read_management_distribution($1::uuid,$2::uuid) value',[B,foreignQueue])).rows[0].value,false);
    });
  });
  await check('active custom grant allows reads; inactive role or assignment blocks',async()=>{
    await grantActor(broker);await visible(broker,queues);
    await pg.query('update public.organization_roles set is_active=false where id=$1',[role]);await visible(broker,[]);
    await pg.query('update public.organization_roles set is_active=true where id=$1',[role]);
    await pg.exec('update public.user_organization_roles set is_active=false');await visible(broker,[]);
  });
  await check('permission ID/key is authoritative, not stale grant permission_key text',async()=>{await grantActor(broker,'team_manage');await pg.exec("update public.organization_role_permissions set permission_key='distribution_manage'");await visible(broker,[]);});
  await check('simple allow/deny overrides and contradictory normalized keys',async()=>{
    await grantActor(broker,'team_manage');await overrideActor(broker,true);await visible(broker,queues);
    await pg.exec('update public.user_permission_overrides set allowed=false');await visible(broker,[]);
    await overrideActor(broker,true,' Distribution_Manage ');await visible(broker,[]);
  });
  await check('wildcard survives simple deny as in gateway resolver',async()=>{await grantActor(broker,'*');await overrideActor(broker,false);await visible(broker,queues);});
  await check('JWT role and user metadata cannot forge management permission',async()=>{await grantActor(broker,'team_manage');await visible(broker,[],{role:'super_admin',user_metadata:{role:'owner',organization_id:B}});});
  await check('selected organization follows authoritative user/membership, not JWT metadata',async()=>{
    await pg.query("insert into public.organization_members(organization_id,user_id,role) values($1,$2,'owner')",[B,broker]);
    await pg.query('update public.users set organization_id=$1 where id=$2',[B,broker]);await visible(broker,[foreignQueue],{user_metadata:{organization_id:A}});
    await pg.query('update public.users set organization_id=$1 where id=$2',[A,broker]);await pg.query('delete from public.organization_members where organization_id=$1 and user_id=$2',[B,broker]);
  });
  await check('leader sees creator, led pipeline, led coworker queues, excluding unrelated queue',async()=>{await grantActor(leader);await visible(leader,queues.slice(0,3));});
  await check('manager who is also a leader retains distribution queue scope',async()=>{
    await pg.query("update public.organization_members set role='manager' where organization_id=$1 and user_id=$2",[A,leader]);await visible(leader,queues.slice(0,3));
    await pg.query("update public.organization_members set role='broker' where organization_id=$1 and user_id=$2",[A,leader]);
  });
  await check('stale coworker generation cannot expand leader user scope',async()=>{
    await pg.query('update public.team_members set membership_generation=0 where id=$1',[teamMember]);await visible(leader,queues.slice(0,2));
    await pg.query('update public.team_members set membership_generation=1 where id=$1',[teamMember]);
  });
  await check('revoked, missing and recovery sessions cannot read despite grant',async()=>{
    await grantActor(broker);await visible(broker,[],{session_id:uid(999)});await visible(broker,[],{amr:[{method:'recovery'}]});await visible(broker,[],{amr:'password'});
    await pg.query('delete from auth.sessions where user_id=$1',[broker]);await visible(broker,[]);
    await pg.query('insert into auth.sessions values($1,$2)',[uid(110),broker]);
  });
  await check('disabled account, membership and organization fail closed',async()=>{
    await pg.query('update public.users set is_active=false where id=$1',[broker]);await visible(broker,[]);await pg.query('update public.users set is_active=true where id=$1',[broker]);
    await pg.query('update public.organization_members set is_active=false where user_id=$1',[broker]);await visible(broker,[]);await pg.query('update public.organization_members set is_active=true where user_id=$1',[broker]);
    await pg.query('update public.organizations set is_active=false where id=$1',[A]);await visible(broker,[]);await pg.query('update public.organizations set is_active=true where id=$1',[A]);
  });
  await check('inactive queue remains manageable; removed queue is invisible',async()=>{
    await pg.query('update public.round_robins set is_active=false where id=$1',[queues[3]]);await visible(broker,queues);
    await pg.query('update public.round_robins set deleted_at=now() where id=$1',[queues[3]]);await visible(broker,queues.slice(0,3));
    await pg.query('update public.round_robins set deleted_at=null,is_active=true where id=$1',[queues[3]]);
  });
  await pg.query('insert into public.tags(id,organization_id,name) values($1,$2,$3),($4,$5,$6)',[tag,A,'Fixture tag',foreignTag,B,'Foreign tag']);
  await pg.query('insert into public.leads values($1,$2,$3),($4,$5,$6)',[lead,A,'Fixture lead',otherLead,B,'Foreign lead']);
  await pg.query("insert into public.automations(id,organization_id,trigger_type) values($1,$2,'manual')",[automation,A]);
  await pg.query("insert into public.automation_flow_versions(id,organization_id,automation_id,created_by) values($1,$2,$3,$4)",[version,A,automation,leader]);
  await pg.query("insert into public.automation_executions values($1,$2,$3,$4,$5,'running','node-tag','fixture-lease',null)",[execution,A,automation,lead,version]);
  await pg.query("insert into public.organization_modules values($1,'automations',true)",[A]);
  await check('actual canonical RPC adds tag and stores only scoped ID hint after confirmation',async()=>{
    assert.equal((await effect('add_tag',tag,'first-add')).ok,true);
    const row=(await pg.query('select organization_id,event_type,data,user_id,audience_user_id from private.realtime_events')).rows[0];
    assert.deepEqual(row,{organization_id:A,event_type:'lead.tagged',data:{leadId:lead,tagId:tag},user_id:null,audience_user_id:null});
  });
  await check('idempotent replay and no-op add produce no extra event',async()=>{const before=await eventCount();assert.equal((await effect('add_tag',tag,'first-add')).ok,true);assert.equal((await effect('add_tag')).ok,true);assert.equal(await eventCount(),before);});
  await check('actual remove publishes once; absent association is a no-op',async()=>{const before=await eventCount();assert.equal((await effect('remove_tag')).ok,true);assert.equal(await eventCount(),before+1);assert.equal((await effect('remove_tag')).ok,true);assert.equal(await eventCount(),before+1);});
  await check('foreign tag or organization does not produce a success/event',async()=>{const before=await eventCount();assert.equal((await effect('add_tag',foreignTag)).ok,false);assert.equal((await effect('add_tag',tag,undefined,B)).status,'execution_not_running');assert.equal(await eventCount(),before);});
  await check('RPC rollback removes association, effect ledger and event together',async()=>{
    const before=await eventCount();await assert.rejects(pg.transaction(async tx=>{await tx.query("select public.apply_automation_internal_effect($1::uuid,$2::uuid,'node-tag','fixture-lease','rolled-back','add_tag',$3::jsonb)",[A,execution,JSON.stringify({tag_id:tag})]);throw new Error('fixture rollback');}),/fixture rollback/);
    assert.equal(await eventCount(),before);assert.equal(Number(await scalar('select count(*)::integer value from public.lead_tags')),0);assert.equal(Number(await scalar("select count(*)::integer value from public.automation_effect_dispatches where effect_key='rolled-back'")),0);
  });
  await check('failure after tag mutation rolls back its event before RPC reports failed',async()=>{
    const before=await eventCount();
    await pg.exec("create function pg_temp.fixture_activity_failure() returns trigger language plpgsql as $$begin raise exception 'fixture post-tag failure';end;$$;create trigger fixture_activity_failure before insert on public.activities for each row execute function pg_temp.fixture_activity_failure()");
    assert.equal((await effect('add_tag',tag,'post-tag-failure')).status,'failed');
    assert.equal(await eventCount(),before);assert.equal(Number(await scalar('select count(*)::integer value from public.lead_tags')),0);
    await pg.exec('drop trigger fixture_activity_failure on public.activities');
  });
  await check('cancelled/queued execution cannot apply effect',async()=>{
    const before=await eventCount();await pg.query('update public.automation_executions set cancellation_requested_at=now() where id=$1',[execution]);assert.equal((await effect('add_tag')).ok,false);
    await pg.query("update public.automation_executions set cancellation_requested_at=null,status='queued' where id=$1",[execution]);assert.equal((await effect('add_tag')).ok,false);
    await pg.query("update public.automation_executions set status='running' where id=$1",[execution]);assert.equal(await eventCount(),before);
  });
  await check('wrong GUC, dispatch node/tag/status or association scope emits no automation event',async()=>{
    for(const mode of ['wrong-guc','wrong-node','wrong-tag','wrong-status','wrong-scope','cancelled']){
      const before=await eventCount();await pg.transaction(async tx=>{
        await tx.query("select set_config('vimob.automation_execution_id',$1,true)",[mode==='wrong-guc'?uid(999):execution]);
        await tx.query("insert into public.automation_effect_dispatches(organization_id,execution_id,node_key,effect_key,effect_type,status,request) values($1,$2,$3,$4,'add_tag',$5,$6::jsonb)",[A,execution,mode==='wrong-node'?'other':'node-tag',`negative-${mode}`,mode==='wrong-status'?'succeeded':'sending',JSON.stringify({tag_id:mode==='wrong-tag'?foreignTag:tag})]);
        if(mode==='cancelled')await tx.query('update public.automation_executions set cancellation_requested_at=now() where id=$1',[execution]);
        await tx.query('insert into public.lead_tags(organization_id,lead_id,tag_id) values($1,$2,$3)',mode==='wrong-scope'?[B,otherLead,foreignTag]:[A,lead,tag]);
        assert.equal(Number((await tx.query('select count(*)::integer value from private.realtime_events')).rows[0].value),before);
        await tx.query('delete from public.lead_tags');await tx.query('delete from public.automation_effect_dispatches where effect_key=$1',[`negative-${mode}`]);
        await tx.query('update public.automation_executions set cancellation_requested_at=null where id=$1',[execution]);
      });assert.equal(await eventCount(),before);
    }
  });
  await check('same-tenant reparent cannot revive orphaned automation node or distribution rule',async()=>{
    const dormant=uid(702),orphanTag=uid(302),orphanRuleTag=uid(303),dormantQueue=uid(430);
    await pg.query('insert into public.tags(id,organization_id) values($1,$3),($2,$3)',[orphanTag,orphanRuleTag,A]);
    await pg.query('insert into public.automations(id,organization_id,deleted_at) values($1,$2,now())',[dormant,A]);
    await pg.query("insert into public.automation_nodes(id,automation_id,node_type,action_type,node_config) values($1,$2,'action','add_tag',$3::jsonb)",[uid(720),dormant,JSON.stringify({tag_id:orphanTag})]);
    await pg.query('insert into public.round_robins(id,organization_id,deleted_at) values($1,$2,now())',[dormantQueue,A]);
    await pg.query("insert into public.round_robin_rules(id,organization_id,round_robin_id,match_type,match_value) values($1,$2,$3,'tag',$4)",[uid(730),A,dormantQueue,orphanRuleTag]);
    await pg.query('delete from public.tags where id in ($1,$2)',[orphanTag,orphanRuleTag]);
    for(const [sql,args] of [['update public.automation_nodes set automation_id=$1 where id=$2',[automation,uid(720)]],['update public.round_robin_rules set round_robin_id=$1 where id=$2',[queues[0],uid(730)]]])await assert.rejects(pg.query(sql,args),error=>error.code==='23503' && error.constraint==='tags_management_reference_guard');
  });
  const scheduledQueue=uid(410),directQueue=uid(411),scheduledMember=uid(1410),directMember=uid(1411);
  await pg.query('insert into public.round_robins(id,organization_id) values($1,$3),($2,$3)',[scheduledQueue,directQueue,A]);
  await pg.query('insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,team_id,weight) values($1,$2,$3,$4,$5,2),($6,$2,$7,$4,null,2)',[scheduledMember,A,scheduledQueue,coworker,team,directMember,directQueue]);
  await pg.query("insert into public.member_availability(organization_id,team_member_id,day_of_week,start_time,end_time,is_all_day) values($1,$2,1,'22:00','06:00',true)",[A,teamMember]);
  await check('all-day legacy clocks apply only on configured day',async()=>{assert.equal((await picker(scheduledQueue,1,'05:00')).length,1);assert.equal((await picker(scheduledQueue,2,'05:00')).length,0);});
  await check('normal overnight still crosses midnight without opening daytime',async()=>{
    await pg.exec('update public.member_availability set is_all_day=false');assert.equal((await picker(scheduledQueue,1,'23:00')).length,1);assert.equal((await picker(scheduledQueue,2,'05:00')).length,1);assert.equal((await picker(scheduledQueue,1,'12:00')).length,0);assert.equal((await picker(scheduledQueue,2,'07:00')).length,0);
  });
  await check('direct member bypasses unrelated team schedule; explicit ignore remains valid',async()=>{assert.equal((await picker(directQueue,1,'12:00'))[0].availability_reason,'no_team_schedule');assert.equal((await picker(scheduledQueue,1,'12:00',true))[0].availability_reason,'queue_ignores_availability');});
  await check('configured but disabled schedule never becomes implicitly all-day',async()=>{await pg.exec('update public.member_availability set is_active=false');assert.equal((await picker(scheduledQueue,1,'23:00')).length,0);assert.equal((await picker(directQueue,1,'23:00')).length,1);await pg.exec('update public.member_availability set is_active=true');});
  await check('canonical generation trigger: weight edits keep stale membership; explicit activation rebinds',async()=>{
    await pg.query('update public.organization_members set deleted_at=now(),is_active=false where organization_id=$1 and user_id=$2',[A,coworker]);
    await pg.query('update public.organization_members set deleted_at=null,is_active=true where organization_id=$1 and user_id=$2',[A,coworker]);
    assert.equal(Number(await scalar('select membership_generation value from public.organization_members where organization_id=$1 and user_id=$2',[A,coworker])),2);
    await pg.query('update public.round_robin_members set weight=5 where id=$1',[directMember]);assert.equal((await picker(directQueue,1,'12:00')).length,0);
    await pg.query('update public.round_robin_members set is_active=true where id=$1',[directMember]);assert.equal((await picker(directQueue,1,'12:00')).length,1);
    await pg.query('update public.round_robin_members set is_active=true where id=$1',[scheduledMember]);assert.equal((await picker(scheduledQueue,1,'23:00')).length,0);
    await pg.query('update public.team_members set is_active=true where id=$1',[teamMember]);assert.equal((await picker(scheduledQueue,1,'23:00')).length,1);
  });
  console.log(`PASS ${count} SQL scenario groups; isolated minimum schema, no full migration-chain/pgTAP/concurrency claim.`);
}catch(error){
  console.error('FAIL isolated management SQL',JSON.stringify({message:error.message,code:error.code,constraint:error.constraint,where:error.where}));
  process.exitCode=1;
}finally{await pg.close();}
