import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { promisify } from 'node:util';

// Native PostgreSQL is a fallback when Docker is unavailable. It always creates
// its own cluster and database, binds literal loopback, and never loads .env.
// Keep its random password/target receipt outside the repository and Git.
const run = promisify(execFile), flags = process.argv.slice(2);
const option = name => flags[flags.indexOf(name) + 1];
const command = async (bin, name, args) => (await run(path.join(bin, `${name}.exe`), args,
  { timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true })).stdout.trim();
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const assertPortFree = async () => new Promise((resolve, reject) => {
  const server = createServer(); server.once('error', reject);
  server.listen({ host: '127.0.0.1', port: 57533, exclusive: true }, () => server.close(resolve));
});
// On Windows postgres can inherit execFile pipes after pg_ctl exits, leaving
// Node waiting until its timeout although PostgreSQL is already accepting
// connections. PostgreSQL writes to the owned log; startup needs no pipes.
const startCluster = async (bin, args) => new Promise((resolve, reject) => {
  const child = spawn(path.join(bin, 'pg_ctl.exe'), args, { windowsHide: true, stdio: 'ignore' });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Owned pg_ctl startup timed out; inspect saved target receipt')); }, 120000);
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(new Error(`Owned pg_ctl startup failed (${code})`)); });
});
const pgClient = async (target, database = target.database) => {
  const pg = createRequire(path.join(target.dependencyRoot, 'package.json'))('pg');
  const db = new pg.Client({ host: '127.0.0.1', port: 57533, user: target.user, password: target.password,
    database, ssl: false, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await db.connect(); return db;
};

if (flags.includes('--new-database-config')) {
  const configFile = option('--new-database-config'), outputConfig = option('--output-config');
  assert.ok(path.isAbsolute(configFile) && path.isAbsolute(outputConfig));
  assert.equal(path.dirname(path.resolve(configFile)).toLowerCase(), path.dirname(path.resolve(outputConfig)).toLowerCase());
  const target = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(target.kind, 'vimob-production-distribution-hotfix-postgres-v1');
  assert.equal(target.engine, 'native'); assert.equal(target.host, '127.0.0.1'); assert.equal(target.port, 57533);
  assert.match(target.database, /^vimob_distribution_hotfix_[a-f0-9]{12}$/);
  assert.equal(await digest(path.join(target.nativeBin, 'postgres.exe')), target.postgresSha256);
  const db = await pgClient(target);
  assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(target.datadir).toLowerCase());
  assert.equal(Number((await db.query('select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1', [target.runId])).rows[0].count), 1);
  const database = 'vimob_distribution_hotfix_' + randomBytes(6).toString('hex');
  await db.query(`create database ${database}`); await db.end();
  const created = await pgClient(target, database);
  await created.query('create table public.production_distribution_hotfix_sentinel(run_id uuid primary key)');
  await created.query('insert into public.production_distribution_hotfix_sentinel values($1)', [target.runId]); await created.end();
  await writeFile(outputConfig, JSON.stringify({ ...target, database }, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ createdDatabase: true, database, config: outputConfig }));
} else if (flags.includes('--stop-config')) {
  const configFile = option('--stop-config');
  assert.ok(path.isAbsolute(configFile));
  const target = JSON.parse(await readFile(configFile, 'utf8'));
  assert.equal(target.kind, 'vimob-production-distribution-hotfix-postgres-v1');
  assert.equal(target.engine, 'native'); assert.equal(target.host, '127.0.0.1'); assert.equal(target.port, 57533);
  assert.match(target.database, /^vimob_distribution_hotfix_[a-f0-9]{12}$/);
  assert.match(path.basename(target.datadir), /^pgdata-[a-f0-9]{12}$/);
  assert.equal(path.dirname(path.resolve(target.datadir)).toLowerCase(), path.dirname(path.resolve(configFile)).toLowerCase());
  assert.equal(await digest(path.join(target.nativeBin, 'postgres.exe')), target.postgresSha256);
  const status = await command(target.nativeBin, 'pg_ctl', ['status', '-D', target.datadir]);
  const pid = Number((await readFile(path.join(target.datadir, 'postmaster.pid'), 'utf8')).split(/\r?\n/)[0]);
  assert.ok(Number.isInteger(pid) && pid > 0);
  const db = await pgClient(target);
  try {
    assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(target.datadir).toLowerCase());
    assert.equal(Number((await db.query('select count(*) from public.production_distribution_hotfix_sentinel where run_id=$1', [target.runId])).rows[0].count), 1);
    const { rows: activity } = await db.query(`select pid,datname,application_name,state,xact_start,wait_event_type from pg_stat_activity
      where pid<>pg_backend_pid() and backend_type='client backend'`);
    assert.equal(activity.length, 0, 'Refusing stop while another client remains connected');
  } finally { await db.end(); }
  await command(target.nativeBin, 'pg_ctl', ['-D', target.datadir, '-m', 'fast', '-w', 'stop']);
  const receipt = { stoppedAt: new Date().toISOString(), ownCluster: true, pid, database: target.database,
    dataDirectory: target.datadir, dataPreserved: true, sentinelVerified: true, statusBeforeStop: status };
  await writeFile(path.join(path.dirname(configFile), `native-stop-${target.runId}.json`), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ stopped: true, database: target.database, dataPreserved: true }));
} else {
  const bin = option('--postgres-bin'), output = option('--output-dir'), dependencyRoot = option('--dependencies-root');
  for (const input of [bin, output, dependencyRoot]) assert.ok(path.isAbsolute(input ?? ''),
    'Usage: --postgres-bin ABS_BIN --output-dir ABS_SCRATCH --dependencies-root ABS_NODE_PROJECT');
  await assertPortFree();
  const runId = randomUUID(), suffix = runId.replaceAll('-', '').slice(0, 12);
  const directory = path.join(output, `production-distribution-${suffix}`);
  await mkdir(directory, { recursive: true });
  const datadir = path.join(directory, `pgdata-${suffix}`), pwfile = path.join(directory, 'postgres.password');
  await mkdir(datadir, { recursive: false });
  const password = randomBytes(36).toString('base64url');
  await writeFile(pwfile, password + '\n', { flag: 'wx' });
  const target = { kind: 'vimob-production-distribution-hotfix-postgres-v1', engine: 'native', runId,
    container: `vimob-distribution-hotfix-${suffix}`, datadir, nativeBin: bin,
    postgresSha256: await digest(path.join(bin, 'postgres.exe')), host: '127.0.0.1', port: 57533,
    database: `vimob_distribution_hotfix_${suffix}`, user: 'postgres', password, dependencyRoot,
    createdAt: new Date().toISOString() };
  await command(bin, 'initdb', ['-D', datadir, '-U', 'postgres', '--auth-host=scram-sha-256', '--auth-local=trust',
    '--pwfile', pwfile, '--encoding=UTF8', '--locale=C']);
  // Save the receipt before starting: partial startup remains identifiable.
  const config = path.join(directory, 'target.json');
  await writeFile(config, JSON.stringify(target, null, 2) + '\n', { flag: 'wx' });
  await startCluster(bin, ['-D', datadir, '-l', path.join(directory, 'postgres.log'), '-o',
    '-h 127.0.0.1 -p 57533 -c max_connections=40 -c shared_buffers=64MB -c statement_timeout=10000', '-w', 'start']);
  const admin = await pgClient(target, 'postgres');
  await admin.query(`create database ${target.database}`); await admin.end();
  const db = await pgClient(target);
  await db.query('create table public.production_distribution_hotfix_sentinel(run_id uuid primary key)');
  await db.query('insert into public.production_distribution_hotfix_sentinel values($1)', [runId]);
  const version = (await db.query('show server_version')).rows[0].server_version;
  assert.equal(path.resolve((await db.query('show data_directory')).rows[0].data_directory).toLowerCase(), path.resolve(datadir).toLowerCase());
  await db.end();
  console.log(JSON.stringify({ created: true, database: target.database, version, config, port: 57533 }));
}
