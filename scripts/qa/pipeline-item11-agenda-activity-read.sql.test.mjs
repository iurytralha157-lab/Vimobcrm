import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Literal local migrations, fixed PGlite memory only. Application environment,
// database URLs, API credentials, network services and real data are not used.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const file='supabase/migrations/20261019230804_restrict_agenda_activity_browser_reads_to_canonical_api.sql';
const predecessor='supabase/migrations/20261018222847_restrict_activity_sensitive_columns_to_canonical_api.sql';
const sessionPolicyFile='supabase/migrations/20261018210058_restrict_activity_reads_to_visible_leads_and_active_session.sql';
const modulePath=process.env.VIMOB_PGLITE_MODULE||resolve(root,'../../outputs/auditoria-agenda-2026-10-12/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const output=process.env.PIPELINE_AGENDA_ACTIVITY_SQL_ARTIFACT_DIR;
const sourceBefore=process.env.PIPELINE_AGENDA_ACTIVITY_SQL_BEFORE==='1';
const org='10000000-0000-4000-8000-000000000001',foreignOrg='10000000-0000-4000-8000-000000000002';
const lead='20000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000001';
const results=[];let pg,PGliteConstructor,migration,sensitiveMigration,sessionMigration,engine,beforeCatalog,afterCatalog,counter=0;
const sha=value=>createHash('sha256').update(value).digest('hex');
const id=()=>`40000000-0000-4000-8000-${String(++counter).padStart(12,'0')}`;
const fixture=`create schema private;create role anon nologin;create role authenticated nologin;
  create role service_role nologin bypassrls;create role item11_internal nologin;
  grant usage on schema public to anon,authenticated,service_role,item11_internal;
  grant usage on schema private to authenticated;
  create function private.has_active_lead_read_session() returns boolean language sql stable as
    $session$select current_setting('item11.session_active',true) is distinct from 'false'$session$;
  revoke all on function private.has_active_lead_read_session() from public;
  grant execute on function private.has_active_lead_read_session() to authenticated;
  create table public.leads(id uuid primary key,organization_id uuid);
  alter table public.leads enable row level security;
  grant select on public.leads to authenticated;
  create policy leads_select_active_broker_team on public.leads for select to public using(organization_id='${org}'::uuid);
  create policy leads_select_requires_active_session on public.leads as restrictive for select to authenticated
    using((select private.has_active_lead_read_session()));
  create table public.activities(id uuid primary key,organization_id uuid,lead_id uuid,user_id uuid,type text,
    content text,metadata jsonb,created_at timestamptz default now());
  alter table public.activities enable row level security;
  create policy vimob_canonical_ad7468a679b0911da5b9a704 on public.activities for select to public
    using(organization_id='${org}'::uuid);
  grant select on public.activities to anon,authenticated,service_role,item11_internal;
  insert into public.leads values('${lead}','${org}');`;
async function catalog(database=pg){return (await database.query(`select c.relowner,c.relacl::text as acl,c.relrowsecurity,c.relforcerowsecurity,
  (select jsonb_agg(jsonb_build_object('column',a.attname,'acl',a.attacl::text) order by a.attnum)
   from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped) as columns,
  (select jsonb_agg(jsonb_build_object('name',p.polname,'roles',p.polroles::text,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid),'cmd',p.polcmd,'permissive',p.polpermissive) order by p.polname)
   from pg_policy p where p.polrelid=c.oid and p.polname<>'activities_select_agenda_requires_canonical_api') as old_policies
  from pg_class c where c.oid='public.activities'::regclass`)).rows[0];}
async function initialize(database){await database.exec(fixture);await database.exec(sessionMigration);await database.exec(sensitiveMigration);}
before(async()=>{
  [migration,sensitiveMigration,sessionMigration]=await Promise.all([file,predecessor,sessionPolicyFile].map(p=>readFile(join(root,p),'utf8')));
  ({PGlite:PGliteConstructor}=await import(pathToFileURL(modulePath).href));
  pg=new PGliteConstructor('memory://');engine=(await pg.query('select version() engine')).rows[0].engine;
  await initialize(pg);beforeCatalog=await catalog();if(!sourceBefore)await pg.exec(migration);afterCatalog=await catalog();
});
after(async()=>{
  if(output){await mkdir(output,{recursive:true});await writeFile(join(output,sourceBefore?'agenda-activity-read-sql-before-receipt.json':'agenda-activity-read-sql-receipt.json'),JSON.stringify({
    scope:'Literal migrations in isolated process-local memory PostgreSQL; no app .env/API/real DB/network/services',engine,
    mode:sourceBefore?'before (existing session and column protections only)':'after (new Agenda row policy)',
    sourceHashes:Object.fromEntries([[file,migration],[predecessor,sensitiveMigration],[sessionPolicyFile,sessionMigration]].map(([p,s])=>[p,sha(s)])),
    beforeCatalog,afterCatalog,results,total:results.length,passed:results.filter(x=>x.status==='pass').length,
    limitations:['Synthetic organization/session fixture, not real Supabase JWT/RLS deployment proof.',
      'New policy deliberately hides direct browser Agenda rows; canonical API generic facts are tested separately.',
      'PostgreSQL18/PGlite is not proof of concurrent server behavior, actual PostgREST or Realtime authorization.'],
  },null,2)+'\n');}await pg?.close();
});
async function asRole(role,run,database=pg){await database.exec(`set role ${role}`);try{return await run()}finally{await database.exec('reset role')}}
async function insert(type,metadata,organization=org){const row=id();await pg.query(`insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata)
  values($1,$2,$3,$4,$5,'PRIVATE_COPY_SYNTHETIC',$6::jsonb)`,[row,organization,lead,actor,type,metadata===undefined?null:JSON.stringify(metadata)]);return row;}
async function read(row,role='authenticated'){return asRole(role,()=>pg.query('select id,user_id,type from public.activities where id=$1',[row]));}
function rowCase(name,type,metadata,visible){test(name,async()=>{await pg.exec('begin');try{const row=await insert(type,metadata);const found=(await read(row)).rows;
  assert.equal(found.length,visible?1:0);results.push({name,status:'pass',type,metadata,visible});}catch(error){results.push({name,status:'fail',error:error.message});throw error;}finally{await pg.exec('rollback')}})}

for(const type of ['agenda_created','agenda_rescheduled','agenda_completed','agenda_cancelled','agenda_no_show','agenda_commented','agenda_updated',
  'visit_scheduled','visit_confirmed','visit_made','meeting_scheduled','meeting_held','meeting_made','agenda_future_action',' AGENDA_CREATED ',' VISIT_SCHEDULED ']){
  rowCase(`browser cannot read Agenda invalidation actor for ${type}`,type,{},false);
}
for(const value of [null,{},[],true,false,0,'malformed',actor])rowCase(`schedule_event_id presence cannot bypass with ${JSON.stringify(value)}`,'legacy_custom',{schedule_event_id:value},false);
rowCase('metadata array containing reserved identity is also hidden','note',['schedule_event_id'],false);
rowCase('metadata scalar containing reserved identity is also hidden','note','schedule_event_id',false);
for(const type of ['note','call','call_initiated','email','message','status_change','task_completed','property_selected','agendax_created']){
  rowCase(`non-Agenda ${type} keeps existing direct safe-column reads`,type,{notes:'legitimate text'},true);
}
rowCase('plain feedback mentioning Agenda is not classified from its text','note',{kind:'feedback',notes:'Agenda privada e visita amanhã'},true);
rowCase('null type and metadata preserve legacy non-Agenda row',null,undefined,true);

test('existing column ACL continues rejecting direct content and metadata',async()=>{
  for(const column of ['content','metadata'])await assert.rejects(asRole('authenticated',()=>pg.query(`select ${column} from public.activities`)),e=>e.code==='42501');
  await assert.rejects(asRole('anon',()=>pg.query('select id,user_id,type from public.activities')),e=>e.code==='42501');
  results.push({name:'content/metadata/anon ACL unchanged',status:'pass'});
});
test('service_role, non-browser internal role and owner retain all Agenda projection input',async()=>{
  await pg.exec('begin');try{const row=await insert('agenda_cancelled',{schedule_event_id:actor});
    for(const role of ['service_role','item11_internal']){const found=await asRole(role,()=>pg.query('select content,metadata,user_id from public.activities where id=$1',[row]));
      assert.equal(found.rows.length,1);assert.equal(found.rows[0].content,'PRIVATE_COPY_SYNTHETIC');assert.equal(found.rows[0].user_id,actor);}
    assert.equal((await pg.query('select id from public.activities where id=$1',[row])).rows.length,1);
    results.push({name:'internal projection input preserved',status:'pass'});
  }finally{await pg.exec('rollback')}
});
test('safe non-Agenda reads still require current parent organization and live session',async()=>{
  await pg.exec('begin');try{const own=await insert('note',{}),foreign=await insert('note',{},foreignOrg);
    assert.equal((await read(own)).rows.length,1);assert.equal((await read(foreign)).rows.length,0);
    await pg.exec("set local item11.session_active='false'");assert.equal((await read(own)).rows.length,0);
    results.push({name:'existing organization/lead/session ceilings preserved',status:'pass'});
  }finally{await pg.exec('rollback')}
});
test('literal migration changes only its new restrictive policy, preserving owner/RLS/ACL and old policies', {skip:sourceBefore},async()=>{
  assert.deepEqual(afterCatalog,beforeCatalog);
  const policy=(await pg.query("select cmd,permissive,roles from pg_policies where schemaname='public' and tablename='activities' and policyname='activities_select_agenda_requires_canonical_api'")).rows[0];
  assert.equal(policy.cmd,'SELECT');assert.equal(policy.permissive,'RESTRICTIVE');assert.deepEqual([...policy.roles].sort(),['anon','authenticated']);
  results.push({name:'catalog and old policies unchanged',status:'pass',policy});
});
for(const[name,mutate]of[
  ['RLS disabled',database=>database.exec('alter table public.activities disable row level security')],
  ['missing existing permissive policy',database=>database.exec('drop policy vimob_canonical_ad7468a679b0911da5b9a704 on public.activities')],
  ['missing existing session policy',database=>database.exec('drop policy activities_select_requires_visible_lead_and_session on public.activities')],
  ['browser table SELECT drift',database=>database.exec('grant select on public.activities to authenticated')],
  ['browser BYPASSRLS drift',database=>database.exec('alter role authenticated bypassrls')],
  ['non-bypass service inheriting browser policy audience',database=>database.exec('alter role service_role nobypassrls;grant authenticated to service_role')],
])test(`preflight rejects ${name} atomically`,{skip:sourceBefore},async()=>{
  const database=new PGliteConstructor('memory://');try{await initialize(database);await mutate(database);const saved=await catalog(database);let error;
    try{await database.exec(migration)}catch(caught){error=caught;await database.exec('rollback')}
    assert.equal(error?.code,'55000');assert.equal(error?.message,'agenda_activity_browser_read_preflight_failed');assert.deepEqual(await catalog(database),saved);
    assert.equal((await database.query("select count(*)::int as n from pg_policies where schemaname='public' and tablename='activities' and policyname='activities_select_agenda_requires_canonical_api'")).rows[0].n,0);
    results.push({name:`preflight ${name}`,status:'pass'});
  }finally{await database.close()}
});
