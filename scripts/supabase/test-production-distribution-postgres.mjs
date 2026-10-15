import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { installProductionSubstrate, reproduceProductionSelectors } from './production-distribution-postgres-fixture.mjs';
import { runSequentialCases, runConcurrencyCases } from './production-distribution-postgres-cases.mjs';
import { prepareRegressionCases, runRegressionCases } from './production-distribution-postgres-regressions.mjs';
import { installWorkerRetryMigration } from './production-distribution-postgres-worker-fixture.mjs';

// Never imports application configuration, environment files or DB URL variables.
// The target is created by a separate local-only provisioning step.
const [configPath, reportPath] = process.argv.slice(2);
assert.ok(path.isAbsolute(configPath ?? '') && path.isAbsolute(reportPath ?? ''), 'Absolute config and report paths required');
const config = JSON.parse(await readFile(configPath, 'utf8'));
assert.equal(config.kind, 'vimob-production-distribution-hotfix-postgres-v1');
assert.equal(config.host, '127.0.0.1');
assert.equal(config.port, 57533);
assert.match(config.database, /^vimob_distribution_hotfix_[a-f0-9]{12}$/);
assert.match(config.container, /^vimob-distribution-hotfix-[a-f0-9]{12}$/);
assert.match(config.runId, /^[a-f0-9-]{36}$/);
assert.ok(typeof config.password === 'string' && config.password.length >= 24);
assert.ok(path.isAbsolute(config.dependencyRoot));
const require = createRequire(path.join(config.dependencyRoot, 'package.json'));
const pg = require('pg');
const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const migration = '20261015162230_harden_lead_queue_redistribution_rotation.sql';
const report = { startedAt: new Date().toISOString(), scope: 'Isolated production-base distribution hotfix; real PostgreSQL synthetic substrate',
  baselineCommit: 'ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b',
  target: { host: config.host, port: config.port, database: config.database, container: config.container },
  fullMigrationReplay: false, applicationOrProviderStarted: false, cases: [], regressionEvidence: [], lockWaits: [], skipped: [
    'Full Supabase historical schema replay', 'API and browser integration', 'WhatsApp and external notification delivery',
  ] };
const clients = [];
const connect = async name => {
  const db = new pg.Client({ host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password, ssl: false, application_name: `vimob-hotfix-${name}`,
    connectionTimeoutMillis: 5000, statement_timeout: 10000, lock_timeout: 5000,
    idle_in_transaction_session_timeout: 15000 });
  await db.connect(); clients.push(db);
  const { rows: [identity] } = await db.query(`select current_database() as database,
    (select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1) as matches`, [config.runId]);
  assert.equal(identity.database, config.database);
  assert.equal(Number(identity.matches), 1, 'Sentinel mismatch: refusing mutation');
  return db;
};

try {
  if (config.engine === 'native') {
    assert.equal(path.resolve(config.nativeBin).toLowerCase(), path.resolve('D:/Vimob/tmp/whatsapp-db-validation-20261013/runtime/pgsql/bin').toLowerCase());
    assert.equal(path.dirname(path.resolve(config.datadir)).toLowerCase(), path.resolve(path.dirname(configPath)).toLowerCase());
    assert.match(path.basename(config.datadir), /^pgdata-[a-f0-9]{12}$/);
    assert.equal(createHash('sha256').update(await readFile(path.join(config.nativeBin, 'postgres.exe'))).digest('hex'), config.postgresSha256);
    await run(path.join(config.nativeBin, 'pg_ctl.exe'), ['status', '-D', config.datadir], { timeout: 10000, windowsHide: true });
  } else {
    const { stdout } = await run('docker', ['inspect', config.container], { timeout: 10000 });
    const [container] = JSON.parse(stdout);
    assert.equal(container.Config.Labels['vimob.scope'], 'production-distribution-hotfix');
    assert.equal(container.Config.Labels['vimob.run-id'], config.runId);
    assert.ok(Object.values(container.NetworkSettings.Networks).length >= 1);
    assert.equal(container.Config.Image, config.imageId);
    assert.equal(container.Image, config.imageId);
    assert.equal(container.HostConfig.RestartPolicy.Name, 'no');
  }
  const db = await connect('observer');
  if (config.engine === 'native') assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(config.datadir).toLowerCase());
  report.serverVersion = (await db.query('show server_version')).rows[0].server_version;
  const { rows: [empty] } = await db.query(`select count(*) as tables from pg_tables
    where schemaname in ('public','private','auth') and tablename <> 'production_distribution_hotfix_sentinel'`);
  assert.equal(Number(empty.tables), 0, 'A fresh, empty, disposable target is required for every execution');
  report.prerequisites = await installProductionSubstrate(db, root);
  report.baselineReproduction = await reproduceProductionSelectors(db, root);
  const preparedRegressions = await prepareRegressionCases(db);
  const preflightSQL = await readFile(path.join(root, 'supabase/cutovers/lead-queue-rotation-preflight.sql'), 'utf8');
  const preflight = async () => (await db.query(preflightSQL)).filter(result => result.command === 'SELECT').map(result => result.rows);
  report.preflightBefore = await preflight();
  const sql = await readFile(path.join(root, 'supabase/migrations', migration), 'utf8');
  report.migration = { filename: migration, sha256: createHash('sha256').update(sql).digest('hex') };
  const canonicalDefinition = (await db.query(`select pg_get_functiondef('private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz)'::regprocedure) definition`)).rows[0].definition;
  const changedDefinition = canonicalDefinition.replace("'already_assigned'", "'unexpected_harness_body'");
  assert.notEqual(changedDefinition, canonicalDefinition);
  await db.query('begin');
  await db.query(changedDefinition);
  await assert.rejects(db.query(sql), error => error.code === '55000');
  await db.query('rollback');
  assert.equal((await db.query("select to_regclass('private.round_robin_rotation_state') as table_name")).rows[0].table_name, null);
  report.cases.push({ name: 'Unknown predecessor body rejects migration atomically with SQLSTATE 55000', status: 'passed' });
  await db.query(sql);
  report.workerRetryMigrations = await installWorkerRetryMigration(db, root);
  report.preflightAfter = await preflight();
  const pgtap = (await db.query("select name,installed_version from pg_available_extensions where name='pgtap'")).rows;
  report.pgTap = { available: pgtap.length > 0, executed: false,
    reason: pgtap.length > 0 ? 'Actual pgTAP extension SQL functions; no compatibility shim' : 'Extension unavailable; pgTAP files not executed', files: [] };
  if (report.pgTap.available) {
    for (const [filename, count] of [
      ['lead_queue_rotation_hotfix.test.sql', 32],
      ['lead_redistribution_worker_retry.test.sql', 22],
      ['lead_distribution_ticket_sequence_hotpath.test.sql', 8],
      ['lead_redistribution_job_mutation_boundary.test.sql', 6],
    ]) {
      const results = await db.query(await readFile(path.join(root, 'supabase/tests', filename), 'utf8'));
      const assertions = results.filter(result => result.command === 'SELECT')
        .flatMap(result => result.rows.flatMap(row => Object.values(row)))
        .filter(value => typeof value === 'string' && /^(not )?ok \d+\b/.test(value));
      assert.equal(assertions.length, count, `Unexpected assertion count in ${filename}`);
      assert.ok(assertions.every(value => value.startsWith('ok ')), JSON.stringify(assertions));
      report.pgTap.files.push({ filename, assertions, success: true });
    }
    report.pgTap.executed = true;
    report.pgTap.totalAssertions = report.pgTap.files.reduce((total, file) => total + file.assertions.length, 0);
  }
  const sessions = await Promise.all(Array.from({ length: 8 }, (_, n) => connect(String(n))));
  const pids = await Promise.all(sessions.map(async session => (await session.query('select pg_backend_pid() pid')).rows[0].pid));
  assert.equal(new Set(pids).size, 8);
  report.independentBackends = pids.length;
  report.backendPids = pids;
  const test = async (name, operation) => {
    const start = Date.now();
    try {
      await operation();
      report.cases.push({ name, status: 'passed', milliseconds: Date.now() - start });
      console.log(`PASS ${name}`);
    } catch (error) {
      await Promise.allSettled([db, ...sessions].map(client => client.query('rollback')));
      report.cases.push({ name, status: 'failed', milliseconds: Date.now() - start,
        error: { code: error.code, message: error.message, detail: error.detail, where: error.where } });
      console.error(`FAIL ${name}: ${error.code ?? ''} ${error.message}`);
    }
  };
  await runSequentialCases({ db, sessions, pids, test, report });
  await runConcurrencyCases({ db, sessions, pids, test, report });
  await runRegressionCases({ db, prepared: preparedRegressions, test, report });
  const { rows: activity } = await db.query(`select pid,state,wait_event_type,xact_start from pg_stat_activity
    where datname=current_database() and application_name like 'vimob-hotfix-%' and pid<>pg_backend_pid()`);
  assert.ok(activity.every(row => row.state === 'idle' && row.xact_start === null && row.wait_event_type !== 'Lock'));
  report.finalBackendState = activity;
} catch (error) {
  report.fatal = { message: error.message, code: error.code, detail: error.detail, where: error.where };
  console.error(JSON.stringify(report.fatal));
} finally {
  await Promise.allSettled(clients.map(async client => { await client.query('rollback'); await client.end(); }));
  report.passed = report.cases.filter(item => item.status === 'passed').length;
  report.failed = report.cases.filter(item => item.status === 'failed').length;
  report.completedAt = new Date().toISOString();
  report.success = !report.fatal && report.failed === 0 && report.passed > 0;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Result: ${report.passed} passed, ${report.failed} failed; ${reportPath}`);
  if (!report.success) process.exitCode = 1;
}
