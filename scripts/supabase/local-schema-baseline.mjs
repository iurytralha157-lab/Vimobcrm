import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { readVerifiedManifest } from './queue-local-homologation-target.mjs';
import { readBaseline, validateTarget, digestJSON } from './local-schema-baseline-contract.mjs';
import { catalogFingerprint, referenceDataFingerprint } from './local-schema-baseline-catalog.mjs';
import { readBaselineHistory, transactionalMigration } from './local-schema-baseline-history.mjs';
import { assertSQLArtifact } from './local-schema-baseline-artifacts.mjs';
export { assertSQLArtifact } from './local-schema-baseline-artifacts.mjs';

export async function connectLocalBaseline(targetFilename, baselineId) {
  assert.ok(path.isAbsolute(targetFilename));
  const target = validateTarget(JSON.parse(await fs.readFile(targetFilename, 'utf8')));
  const runtime = await readVerifiedManifest(target.runManifest);
  assert.equal(runtime.runId, target.runId);
  const url = new URL(runtime.databaseURL);
  url.pathname = `/${target.databaseName}`;
  const db = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 10_000,
    statement_timeout: 120_000, query_timeout: 130_000, application_name: 'vimob-local-schema-baseline' });
  await db.connect();
  try {
    const row = (await db.query(`select current_database() database,run_id::text,project_id,baseline_id,
      pg_catalog.current_setting('server_version_num')::integer server_version
      from vimob_local_bootstrap.sentinel where singleton=true`)).rows[0];
    assert.equal(row?.database, target.databaseName);
    assert.equal(row?.run_id, target.runId);
    assert.equal(row?.project_id, runtime.projectId);
    assert.equal(row?.baseline_id, baselineId);
    assert.ok(row.server_version >= 170000, 'Local baseline restore requires PostgreSQL 17+ transaction_timeout.');
    return { db, target, runtime };
  } catch (error) { await db.end(); throw error; }
}

export async function assertEmptyBootstrap(db) {
  const existing = (await db.query(`select n.nspname,c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace where n.nspname not in
      ('pg_catalog','information_schema','vimob_local_bootstrap') and n.nspname not like 'pg_toast%'
      and n.nspname not like 'pg_temp_%' and c.relkind in ('r','p','S','v','m','f')
      and not exists(select 1 from pg_depend d where d.classid='pg_class'::regclass and d.objid=c.oid and d.deptype='e')`)).rows;
  assert.deepEqual(existing, [], 'Bootstrap requires an empty database; domain/platform relations already exist.');
  const custom = (await db.query(`
    with objects as (
      select 'function' kind,n.nspname schema,p.proname name,'pg_proc'::regclass classid,p.oid
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      union all select 'type',n.nspname,t.typname,'pg_type'::regclass,t.oid
        from pg_type t join pg_namespace n on n.oid=t.typnamespace
      union all select 'collation',n.nspname,c.collname,'pg_collation'::regclass,c.oid
        from pg_collation c join pg_namespace n on n.oid=c.collnamespace
      union all select 'schema',n.nspname,n.nspname,'pg_namespace'::regclass,n.oid from pg_namespace n
        where n.nspname<>'public'
    ) select kind,schema,name from objects o where schema not in ('pg_catalog','information_schema','vimob_local_bootstrap')
      and schema not like 'pg_toast%' and schema not like 'pg_temp_%'
      and not exists(select 1 from pg_depend d where d.classid=o.classid and d.objid=o.oid and d.deptype='e')
    union all select 'default privileges',coalesce(n.nspname,'global'),pg_get_userbyid(d.defaclrole)
      from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace
      where coalesce(n.nspname,'')<>'vimob_local_bootstrap'`)).rows;
  assert.deepEqual(custom, [], 'Bootstrap requires an empty database; custom functions/types/collations/schemas/default privileges already exist.');
  const history = (await db.query("select to_regclass('vimob_local_bootstrap.history') relation")).rows[0];
  assert.equal(history.relation, null, 'Existing baseline history cannot be overwritten.');
}

const literal = value => `'${String(value).replaceAll("'", "''")}'`;
export function localRestoreArguments(runtime, target) {
  validateTarget(target);
  return ['exec', '-i', '--env', 'PGPASSWORD', '--env', 'PGCONNECT_TIMEOUT', '--env', 'PGAPPNAME', runtime.databaseContainer, 'psql', '-X', '--no-password', '--username', 'supabase_admin',
    '--dbname', target.databaseName, '--set', 'ON_ERROR_STOP=1'];
}
async function restoreSQL(local, artifacts) {
  const { target, runtime } = local;
  const guard = `do $guard$ begin
    if current_user<>'supabase_admin' or not exists(select 1 from pg_roles where rolname=current_user and rolsuper and rolcanlogin)
      then raise exception 'local_bootstrap_restore_admin_required'; end if;
    if current_database()<>${literal(target.databaseName)} or not exists(select 1 from vimob_local_bootstrap.sentinel
      where singleton and run_id=${literal(target.runId)}::uuid and project_id=${literal(runtime.projectId)}
      and baseline_id=${literal(local.baselineId)}) then raise exception 'local_bootstrap_identity_mismatch'; end if;
    perform pg_advisory_xact_lock(hashtextextended('vimob-local-schema-baseline',0));
  end $guard$;`;
  for (const artifact of artifacts) assertSQLArtifact(artifact.source);
  const input = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='5min';\nset local transaction_timeout='180s';\n${guard}\n${artifacts.map(row => row.source).join('\n')}\ncommit;\n`;
  await new Promise((resolve, reject) => {
    const child = spawn(process.env.QUEUE_HOMOLOGATION_DOCKER_BIN || 'docker', localRestoreArguments(runtime, target),
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'],
      env: { ...process.env, PGPASSWORD: decodeURIComponent(new URL(runtime.databaseURL).password),
        PGCONNECT_TIMEOUT: '10', PGAPPNAME: 'vimob-local-baseline-restore' } });
    const deadline = setTimeout(() => {
      child.stdin.destroy();
      child.kill();
      reject(new Error('Owned baseline restore process exceeded 190s; PostgreSQL transaction_timeout is 180s. Verify the disposable database before retrying.'));
    }, 190_000);
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-12000); });
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.once('exit', code => {
      clearTimeout(deadline);
      if (code === 0) resolve();
      else reject(new Error(`Disposable baseline restore failed (${code}); database must be discarded or diagnosed. ${stderr}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function registerBaseline(db, manifest, catalog) {
  await db.query('begin');
  try {
    await db.query(`create table vimob_local_bootstrap.attestation(
      singleton boolean primary key default true check(singleton),baseline_id text not null,
      classification text not null check(classification='local-schema-baseline'), historical_execution boolean not null check(not historical_execution),
      source_chain_sha256 text not null,baseline_catalog_sha256 text not null,baseline_data_sha256 text not null,
      artifacts_sha256 text not null,created_at timestamptz not null default clock_timestamp());
      create table vimob_local_bootstrap.history(file text primary key,sha256 text not null,
      classification text not null check(classification in ('baseline-equivalent','forward-executed')),
      catalog_sha256 text not null,data_sha256 text not null,created_at timestamptz not null default clock_timestamp());
      revoke all on schema vimob_local_bootstrap from public,anon,authenticated,service_role;
      revoke all on all tables in schema vimob_local_bootstrap from public,anon,authenticated,service_role;`);
    await db.query(`insert into vimob_local_bootstrap.attestation(baseline_id,classification,historical_execution,source_chain_sha256,baseline_catalog_sha256,baseline_data_sha256,artifacts_sha256)
      values($1,'local-schema-baseline',false,$2,$3,$4,$5)`, [manifest.baselineId, manifest.sourceChainSHA256, catalog.sha256, manifest.expectedDataSHA256, digestJSON(manifest.artifacts)]);
    for (const row of manifest.sourceChain) await db.query(`insert into vimob_local_bootstrap.history(file,sha256,classification,catalog_sha256,data_sha256)
      values($1,$2,'baseline-equivalent',$3,$4)`, [row.file, row.sha256, catalog.sha256, manifest.expectedDataSHA256]);
    await db.query('commit');
  } catch (error) { await db.query('rollback'); throw error; }
}

export async function applyForwards(db, baseline) {
  let history = await readBaselineHistory(db, baseline, { requireAllForwards: false });
  for (const row of baseline.forwards.slice(history.executedForwardMigrations)) {
    const source = transactionalMigration(row.source);
    await db.query('begin');
    try {
      await db.query("set local lock_timeout='5s'");
      await db.query("select pg_advisory_xact_lock(hashtextextended('vimob-local-schema-baseline',0))");
      // Recheck inside the transaction: another runner may have progressed.
      history = await readBaselineHistory(db, baseline, { requireAllForwards: false });
      assert.equal(baseline.forwards[history.executedForwardMigrations]?.file, row.file, 'Concurrent forward runner changed the expected next migration.');
      await db.query(source);
      const catalog = await catalogFingerprint(db, baseline.manifest.catalogOptions);
      const data = await referenceDataFingerprint(db, baseline.manifest.referenceDataTables);
      await db.query(`insert into vimob_local_bootstrap.history(file,sha256,classification,catalog_sha256,data_sha256)
        values($1,$2,'forward-executed',$3,$4)`, [row.file, row.sha256, catalog.sha256, data.sha256]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback').catch(() => {});
      // A lost COMMIT acknowledgement is not retried. Next invocation verifies
      // the durable ledger and exact catalog before selecting a pending file.
      throw error;
    }
  }
  return readBaselineHistory(db, baseline);
}

async function main() {
  const arguments_ = process.argv.slice(2);
  const option = name => arguments_[arguments_.indexOf(name) + 1];
  for (const flag of ['--manifest','--target','--mode']) assert.ok(arguments_.includes(flag), `Missing ${flag}`);
  const mode = option('--mode');
  assert.ok(['preflight','apply','verify','forward','catalog'].includes(mode));
  const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const baseline = await readBaseline(repositoryRoot, option('--manifest'));
  const local = await connectLocalBaseline(option('--target'), baseline.manifest.baselineId);
  local.baselineId = baseline.manifest.baselineId;
  let result;
  try {
    if (mode === 'preflight') { await assertEmptyBootstrap(local.db); result = { empty: true }; }
    if (mode === 'catalog') result = await catalogFingerprint(local.db, baseline.manifest.catalogOptions);
    if (mode === 'apply') {
      await assertEmptyBootstrap(local.db);
      await restoreSQL(local, baseline.artifacts);
      const catalog = await catalogFingerprint(local.db, baseline.manifest.catalogOptions);
      assert.equal(catalog.sha256, baseline.manifest.expectedCatalogSHA256, 'Restore catalog differs; no history will be certified.');
      const data = await referenceDataFingerprint(local.db, baseline.manifest.referenceDataTables);
      assert.equal(data.sha256, baseline.manifest.expectedDataSHA256, 'Restored static reference data differs; no history will be certified.');
      await registerBaseline(local.db, baseline.manifest, catalog);
      result = await readBaselineHistory(local.db, baseline, { requireAllForwards: false });
    }
    if (mode === 'verify') result = await readBaselineHistory(local.db, baseline);
    if (mode === 'forward') result = await applyForwards(local.db, baseline);
    const report = { at: new Date().toISOString(), database: local.target.databaseName, mode,
      baselineId: baseline.manifest.baselineId, originalHistoryExecuted: false, ...result };
    if (arguments_.includes('--output')) await fs.writeFile(option('--output'), `${JSON.stringify(report,null,2)}\n`);
    process.stdout.write(`${JSON.stringify(mode === 'catalog' ? { ...report, catalog: undefined } : report)}\n`);
  } finally { await local.db.end(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
