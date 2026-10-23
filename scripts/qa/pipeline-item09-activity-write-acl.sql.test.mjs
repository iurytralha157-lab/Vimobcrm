import assert from 'node:assert/strict';
import {after,before,beforeEach,test} from 'node:test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

// Fixed memory-only database: no application credentials, connection URL,
// services or full Supabase migration chain are loaded by this focused test.
const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migrationFile='supabase/migrations/20261019222441_restrict_activity_browser_writes_to_canonical_api.sql';
const moduleFile=process.env.VIMOB_PGLITE_MODULE||resolve(repository,'../../outputs/auditoria-agenda-2026-10-12/sql-runtime/node_modules/@electric-sql/pglite/dist/index.js');
const artifacts=process.env.PIPELINE_ACTIVITY_ACL_ARTIFACT_DIR;
assert.ok(isAbsolute(moduleFile),'PGlite module must be an absolute local path');
const writePrivileges=['INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'];
const columnPrivileges=['INSERT','UPDATE','REFERENCES'];
const roles=['anon','authenticated','service_role'];
const orgA='10000000-0000-4000-8000-000000000001',orgB='10000000-0000-4000-8000-000000000002';
const lead='20000000-0000-4000-8000-000000000001',actor='30000000-0000-4000-8000-000000000001';
const idA='40000000-0000-4000-8000-000000000001',idB='40000000-0000-4000-8000-000000000002';
const results=[];let pg,migration,migrationSHA256,engine;

before(async()=>{
  migration=await readFile(join(repository,migrationFile),'utf8');
  migrationSHA256=createHash('sha256').update(migration).digest('hex');
  const {PGlite}=await import(pathToFileURL(moduleFile).href);
  pg=new PGlite('memory://');
  engine=(await pg.query('select version() engine')).rows[0].engine;
  await pg.exec(`create schema private;create role anon nologin;create role authenticated nologin;
    create role service_role nologin bypassrls;create role item09_browser_parent nologin inherit;
    grant usage on schema public,private to anon,authenticated,service_role,item09_browser_parent;`);
});

beforeEach(async()=>{
  await pg.exec(`alter role anon nosuperuser nobypassrls inherit;alter role authenticated nosuperuser nobypassrls inherit;
    revoke item09_browser_parent from anon,authenticated;
    drop table if exists public.activities cascade;
    create table public.activities(id uuid primary key default gen_random_uuid(),organization_id uuid not null,
      lead_id uuid not null,user_id uuid not null,type text not null,content text,metadata jsonb not null default '{}',
      created_at timestamptz not null default now());
    alter table public.activities enable row level security;
    create policy item09_legacy_mutation_policy on public.activities for all to anon,authenticated using(true) with check(true);
    create policy item09_visible_org on public.activities as restrictive for select to authenticated
      using(organization_id::text=current_setting('item09.organization',true));
    grant insert,update,delete,truncate,references,trigger on public.activities to public,anon,authenticated;
    grant all on public.activities to service_role;
    grant select(id,organization_id,lead_id,user_id,type,created_at) on public.activities to authenticated;
    grant insert(content),update(metadata),references(id) on public.activities to public;
    grant insert(type),update(content),references(lead_id) on public.activities to anon,authenticated;
    create or replace function private.item09_canonical_activity(p_type text) returns uuid
      language plpgsql security definer set search_path='' as $producer$
      declare result uuid;begin
        insert into public.activities(organization_id,lead_id,user_id,type,content,metadata)
        values('${orgA}','${lead}','${actor}',p_type,'Synthetic canonical activity','{"producer":"synthetic_internal"}')
        returning id into result;return result;
      end $producer$;
    revoke all on function private.item09_canonical_activity(text) from public,anon,authenticated;
    grant execute on function private.item09_canonical_activity(text) to service_role;
    create or replace function private.item09_noop_trigger() returns trigger
      language plpgsql as $trigger$begin return new;end$trigger$;
    insert into public.activities(id,organization_id,lead_id,user_id,type,content,metadata,created_at) values
      ('${idA}','${orgA}','${lead}','${actor}','note','Synthetic canonical feedback','{"kind":"feedback"}','2026-10-19T12:00:00Z'),
      ('${idB}','${orgB}','${lead}','${actor}','task_completed','Synthetic second organization','{}','2026-10-19T12:01:00Z');`);
});

after(async()=>{
  await pg?.close();
  if(artifacts){await mkdir(artifacts,{recursive:true});await writeFile(join(artifacts,'activity-write-acl-sql-receipt.json'),JSON.stringify({
    engine,moduleFile,migrationFile,migrationSHA256,results,passed:results.filter(r=>r.ok).length,failed:results.filter(r=>!r.ok).length,
    limits:'Literal migration in memory-only PGlite with synthetic ACL/RLS prerequisites and two organizations. No Supabase/Data API, deployed roles, full migration chain, JWT/session or real multi-connection concurrency was exercised.'},null,2));}
});

function scenario(name,run){test(name,async()=>{try{await run();results.push({name,ok:true})}catch(error){results.push({name,ok:false,error:{message:error.message,code:error.code}});throw error}})}
async function asRole(role,run){assert.ok(roles.includes(role));return pg.transaction(async tx=>{await tx.exec(`set local role ${role}`);await tx.query("select set_config('item09.organization',$1,true)",[orgA]);return run(tx)})}
const rows=async()=> (await pg.query('select * from public.activities order by id')).rows;
const tableAllowed=async(role,privilege)=>(await pg.query('select has_table_privilege($1,$2,$3) allowed',[role,'public.activities',privilege])).rows[0].allowed;
const columnAllowed=async(role,privilege)=>(await pg.query('select has_any_column_privilege($1,$2,$3) allowed',[role,'public.activities',privilege])).rows[0].allowed;
const mutationSQL=`insert into public.activities(organization_id,lead_id,user_id,type,content,metadata)
  values('${orgA}','${lead}','${actor}','status_change','Synthetic forged status','{"to_status":"won"}')`;
async function catalog(){return{
  table:(await pg.query("select relowner,relacl,relrowsecurity,relforcerowsecurity from pg_class where oid='public.activities'::regclass")).rows,
  columns:(await pg.query("select attname,attacl from pg_attribute where attrelid='public.activities'::regclass and attnum>0 and not attisdropped order by attnum")).rows,
  policies:(await pg.query("select policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname='public' and tablename='activities' order by policyname")).rows,
};}
async function projection(){const output=[];for(const role of roles){output.push({role,table:await tableAllowed(role,'SELECT'),columns:(await pg.query("select attname,has_column_privilege($1,attrelid,attnum,'SELECT') allowed from pg_attribute where attrelid='public.activities'::regclass and attnum>0 and not attisdropped order by attnum",[role])).rows})}return output}
async function servicePrivileges(){return(await pg.query("select p.privilege_type,has_table_privilege('service_role',c.oid,p.privilege_type) allowed from pg_class c,lateral aclexplode(acldefault('r',c.relowner)) p where c.oid='public.activities'::regclass order by p.privilege_type")).rows}
async function applyFailure(expected){await assert.rejects(()=>pg.exec(migration),error=>error.code==='P0001'&&error.message.includes(expected));await pg.exec('rollback')}
async function deny(role,sql){const before=await rows();await assert.rejects(()=>asRole(role,tx=>tx.exec(sql)),error=>error.code==='42501'&&/activities/.test(error.message));assert.deepEqual(await rows(),before)}

scenario('baseline permissive RLS and browser ACL allow a reserved activity before hardening',async()=>{
  await asRole('authenticated',tx=>tx.exec(mutationSQL));
  assert.equal((await rows()).filter(row=>row.type==='status_change').length,1);
  for(const role of ['anon','authenticated'])for(const privilege of writePrivileges)assert.equal(await tableAllowed(role,privilege),true);
});

scenario('literal migration removes table, column and PUBLIC write ACL without changing journal, SELECT, RLS, owner or service',async()=>{
  const before={data:await rows(),projection:await projection(),catalog:await catalog(),service:await servicePrivileges()};
  await pg.exec(migration);
  for(const role of ['anon','authenticated']){
    for(const privilege of writePrivileges)assert.equal(await tableAllowed(role,privilege),false,role+' '+privilege);
    for(const privilege of columnPrivileges)assert.equal(await columnAllowed(role,privilege),false,role+' column '+privilege);
  }
  assert.equal((await pg.query("select count(*)::int n from pg_class c,lateral aclexplode(c.relacl) a where c.oid='public.activities'::regclass and a.grantee=0 and a.privilege_type<>'SELECT'")).rows[0].n,0);
  assert.equal((await pg.query("select count(*)::int n from pg_attribute c,lateral aclexplode(c.attacl) a where c.attrelid='public.activities'::regclass and a.grantee=0 and a.privilege_type in('INSERT','UPDATE','REFERENCES')")).rows[0].n,0);
  assert.deepEqual(await rows(),before.data);assert.deepEqual(await projection(),before.projection);assert.deepEqual(await servicePrivileges(),before.service);
  const after=await catalog();assert.deepEqual(after.policies,before.catalog.policies);assert.equal(after.table[0].relowner,before.catalog.table[0].relowner);assert.equal(after.table[0].relrowsecurity,true);assert.equal(after.table[0].relforcerowsecurity,before.catalog.table[0].relforcerowsecurity);
  assert.equal((await pg.query("select to_regclass('pg_temp.activity_write_acl_before') name")).rows[0].name,null);
});

scenario('safe authenticated SELECT remains tenant-filtered and sensitive columns/anon reads remain denied',async()=>{
  await pg.exec(migration);
  assert.deepEqual((await asRole('authenticated',tx=>tx.query('select id,organization_id,lead_id,user_id,type,created_at from public.activities'))).rows.map(row=>row.id),[idA]);
  await deny('authenticated','select content,metadata from public.activities');await deny('anon','select id from public.activities');
});

scenario('an existing explicit anon identifier SELECT grant is preserved rather than broadened or removed',async()=>{
  await pg.exec('grant select(id) on public.activities to anon');const before=await projection();await pg.exec(migration);assert.deepEqual(await projection(),before);
  assert.equal((await asRole('anon',tx=>tx.query('select id from public.activities'))).rows.length,2);await deny('anon','select content from public.activities');
});

for(const role of ['anon','authenticated'])for(const [operation,sql]of Object.entries({
  INSERT:mutationSQL,UPDATE:"update public.activities set content='Synthetic poisoned note'",DELETE:'delete from public.activities',TRUNCATE:'truncate public.activities',
  REFERENCES:'create table public.item09_reference(id uuid references public.activities(id))',
  TRIGGER:'create trigger item09_fake_activity_trigger before insert on public.activities for each row execute function private.item09_noop_trigger()',
}))scenario(`${role} direct ${operation} fails after migration despite permissive mutation RLS`,async()=>{if(operation==='REFERENCES')await pg.exec('grant create on schema public to '+role);await pg.exec(migration);await deny(role,sql)});

for(const publicGrant of [false,true])scenario(`${publicGrant?'PUBLIC':'direct browser'} independent column grants are removed even without table write ACL`,async()=>{
  await pg.exec('revoke insert,update,delete,truncate,references,trigger on public.activities from public,anon,authenticated');
  await pg.exec('grant insert(type),update(content),references(lead_id) on public.activities to '+(publicGrant?'public':'anon,authenticated'));
  for(const role of ['anon','authenticated']){assert.equal(await tableAllowed(role,'INSERT'),false);assert.equal(await columnAllowed(role,'INSERT'),true)}
  await pg.exec(migration);for(const role of ['anon','authenticated'])for(const privilege of columnPrivileges)assert.equal(await columnAllowed(role,privilege),false);
});

for(const [role,grant]of [['authenticated','grant insert on public.activities to item09_browser_parent'],['anon','grant update(content) on public.activities to item09_browser_parent']])scenario(`${role} inherited ${grant.includes('update')?'column':'table'} mutation privilege aborts and rolls back all revocations`,async()=>{
  await pg.exec(grant+`;grant item09_browser_parent to ${role}`);const before=await catalog();
  await applyFailure('activity_write_postflight_failed');assert.deepEqual(await catalog(),before);
});

scenario('browser table ownership is detected as an effective write bypass and fails atomically',async()=>{
  await pg.exec('alter table public.activities owner to authenticated');const before=await catalog();await applyFailure('activity_write_postflight_failed');assert.deepEqual(await catalog(),before);
});

scenario('NOINHERIT membership in the table owner still fails rather than leaving a SET ROLE ownership path',async()=>{
  await pg.exec('alter table public.activities owner to item09_browser_parent;alter role authenticated noinherit;grant item09_browser_parent to authenticated with inherit false');
  assert.equal((await pg.query("select pg_has_role('authenticated','item09_browser_parent','USAGE') allowed")).rows[0].allowed,false);
  const before=await catalog();await applyFailure('activity_write_postflight_failed');assert.deepEqual(await catalog(),before);
});

scenario('browser superuser configuration cannot silently bypass the postflight',async()=>{
  await pg.exec('alter role anon superuser');const before=await catalog();await applyFailure('activity_write_postflight_failed');assert.deepEqual(await catalog(),before);
});

scenario('service INSERT received only from PUBLIC causes rollback instead of breaking the internal producer',async()=>{
  await pg.exec('revoke insert on public.activities from service_role');assert.equal(await tableAllowed('service_role','INSERT'),true);
  const before=await catalog();await applyFailure('activity_producer_or_projection_acl_changed');assert.deepEqual(await catalog(),before);assert.equal(await tableAllowed('service_role','INSERT'),true);
});

scenario('service column-only producer privilege received from PUBLIC is also preserved by refusing the migration',async()=>{
  await pg.exec('revoke update on public.activities from service_role,public,anon,authenticated;grant update(content) on public.activities to public');
  assert.equal(await tableAllowed('service_role','UPDATE'),false);assert.equal(await columnAllowed('service_role','UPDATE'),true);
  const before=await catalog();await applyFailure('activity_producer_or_projection_acl_changed');assert.deepEqual(await catalog(),before);
});

for(const [label,sql]of [['disabled RLS','alter table public.activities disable row level security'],['missing service INSERT','revoke insert on public.activities from public,anon,authenticated,service_role']])scenario(`${label} fails preflight without a partial ACL change`,async()=>{
  await pg.exec(sql);const before=await catalog();await applyFailure('activity_write_preflight_failed');assert.deepEqual(await catalog(),before);
});

scenario('injected failure after the actual ACL statements rolls back grants and temporary guard state',async()=>{
  const before=await catalog();const failing=migration.replace(/commit;\s*$/i,"do $failure$begin raise exception 'item09_synthetic_failure';end$failure$;commit;");assert.notEqual(failing,migration);
  await assert.rejects(()=>pg.exec(failing),error=>error.code==='P0001'&&error.message==='item09_synthetic_failure');await pg.exec('rollback');assert.deepEqual(await catalog(),before);
  assert.equal((await pg.query("select to_regclass('pg_temp.activity_write_acl_before') name")).rows[0].name,null);
});

scenario('owner, service role and private SECURITY DEFINER canonical producer keep reserved journal writes',async()=>{
  await pg.exec(migration);for(const role of ['anon','authenticated'])await assert.rejects(()=>asRole(role,tx=>tx.query("select private.item09_canonical_activity('status_change')")),error=>error.code==='42501');
  await pg.exec(mutationSQL);await asRole('service_role',tx=>tx.exec(mutationSQL));
  const result=await asRole('service_role',tx=>tx.query("select private.item09_canonical_activity('task_completed') id"));assert.ok(result.rows[0].id);
  assert.equal((await rows()).length,5);for(const privilege of writePrivileges)assert.equal(await tableAllowed('service_role',privilege),true);
});

scenario('reapplying the literal migration is idempotent and the migration source remains unchanged',async()=>{
  await pg.exec(migration);const before=await catalog();await pg.exec(migration);assert.deepEqual(await catalog(),before);
  assert.equal(createHash('sha256').update(await readFile(join(repository,migrationFile),'utf8')).digest('hex'),migrationSHA256);
});
