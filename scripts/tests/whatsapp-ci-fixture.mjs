import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat, realpath, access } from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { CI_MARKER, CI_PORT, CI_DATABASE, SQL_TESTS, fixtureRoot, validateManifest, assertCluster, childEnvironment, sqlModeOptions } from './whatsapp-ci-contract.mjs';
import { MIGRATIONS } from './whatsapp-ci-schema.mjs';
import { materializeSQL, ADDITIONAL_SOURCES } from './whatsapp-ci-sql-source.mjs';

const exec = promisify(execFile);
export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const executable = (bin, name) => path.join(bin, name + (process.platform === 'win32' ? '.exe' : ''));
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
export async function command(file, args, options = {}) {
  const pending = exec(file, args, { cwd: repository, env: childEnvironment(), encoding: 'utf8', windowsHide: true,
    timeout: 5 * 60_000, maxBuffer: 16 * 1024 * 1024, ...options });
  // Every command here is noninteractive (--pwfile / -w -f / test arguments).
  // Explicit EOF also prevents Windows descendants from inheriting an open
  // stdin writer and waiting indefinitely after a child has completed.
  pending.child.stdin?.end();
  return pending;
}
async function startPostgres(file, args) {
  // pg_ctl's Windows child may retain inherited stdout even with -l. Waiting
  // on process exit with closed stdio avoids waiting for the server's lifetime.
  await new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: repository, env: childEnvironment(), stdio: 'ignore', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('owned pg_ctl start failed: ' + code)));
  });
}
async function safeRoot(root) {
  fixtureRoot(root);
  assert.ok(samePath(await realpath(path.dirname(root)), path.dirname(root)), 'fixture parent cannot redirect through a symlink');
  try { const stat = await lstat(root); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
export async function readRuntime(root) {
  root = fixtureRoot(root); await safeRoot(root);
  const file = path.join(root, 'runtime.json');
  assert.ok(!(await lstat(file)).isSymbolicLink(), 'runtime must be an owned regular file');
  return validateManifest(JSON.parse(await readFile(file, 'utf8')), root);
}
async function connect(root, database) {
  const password = await readFile(path.join(root, 'password.txt'), 'utf8');
  assert.match(password, /^[a-f0-9]{64}$/);
  const client = new pg.Client({ host: '127.0.0.1', port: CI_PORT, user: 'postgres', database, password,
    ssl: false, connectionTimeoutMillis: 5000, options: '-c search_path=public,extensions -c statement_timeout=300000',
    application_name: CI_MARKER, client_encoding: 'UTF8' });
  await client.connect(); return client;
}
async function actualCluster(client, sentinel) {
  const row = (await client.query(`select system_identifier::text as "systemIdentifier",
    current_setting('data_directory') as "dataDirectory", inet_server_port()::text as port,
    host(inet_server_addr()) as "serverAddress", current_setting('listen_addresses') as "listenAddresses",
    current_setting('fsync') as fsync, current_setting('synchronous_commit') as "synchronousCommit",
    current_database() as database from pg_control_system()`)).rows[0];
  if (sentinel) row.nonce = (await client.query('select nonce from vimob_ci_fixture.identity where marker=$1', [CI_MARKER])).rows[0]?.nonce;
  return row;
}
export async function verifiedClient(root) {
  const runtime = await readRuntime(root); const client = await connect(root, CI_DATABASE);
  try { assertCluster(runtime, await actualCluster(client, true)); return { client, runtime }; }
  catch (error) { await client.end(); throw error; }
}
export async function preflight(root, bin) {
  root = fixtureRoot(root); bin = path.resolve(bin); await safeRoot(root);
  try { await access(root); throw new Error('refusing to initialize any existing fixture directory'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const versions = {};
  for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_controldata']) {
    versions[name] = (await command(executable(bin, name), ['--version'])).stdout.trim();
    assert.match(versions[name], /\b17\./, 'PostgreSQL 17 is required');
  }
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: CI_PORT });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new Error('refusing an occupied CI port')); });
    socket.once('timeout', () => { socket.destroy(); reject(new Error('cannot prove the CI port is unused')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(error));
  });
  return { root, bin, port: CI_PORT, database: CI_DATABASE, versions, startsService: false };
}
export async function initialize(root, bin) {
  const plan = await preflight(root, bin); root = plan.root; bin = plan.bin;
  await mkdir(root); await mkdir(path.join(root, 'results'));
  try {
  await writeFile(path.join(root, 'password.txt'), randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 });
  await command(executable(bin, 'initdb'), ['-D', path.join(root, 'data'), '-U', 'postgres',
    '--auth-host=scram-sha-256', '--auth-local=scram-sha-256', '--encoding=UTF8', '--locale=C',
    ...(process.platform === 'win32' ? ['--no-sync'] : []), '--pwfile=' + path.join(root, 'password.txt')]);
  const control = (await command(executable(bin, 'pg_controldata'), [path.join(root, 'data')])).stdout;
  const systemIdentifier = control.match(/Database system identifier:\s+([0-9]{16,20})/)?.[1];
  assert.ok(systemIdentifier, 'offline cluster identity is required before startup');
  const runtime = { kind: CI_MARKER, marker: CI_MARKER, root, database: CI_DATABASE,
    nonce: randomBytes(32).toString('hex'), createdAt: new Date().toISOString(), bin,
    initialization: { platform: process.platform, initialSyncSkipped: process.platform === 'win32' },
    actual: { systemIdentifier, dataDirectory: path.join(root, 'data'), port: String(CI_PORT),
      listenAddresses: '127.0.0.1', serverAddress: '127.0.0.1', fsync: 'on', synchronousCommit: 'on' } };
  validateManifest(runtime, root);
  await writeFile(path.join(root, 'runtime.json'), JSON.stringify(runtime, null, 2), { flag: 'wx', mode: 0o600 });
  await startPostgres(executable(bin, 'pg_ctl'), ['-D', runtime.actual.dataDirectory, '-l', path.join(root, 'postgres.log'),
    '-o', `-h 127.0.0.1 -p ${CI_PORT} -c fsync=on -c synchronous_commit=on`, '-w', '-t', '30', 'start']);
  const admin = await connect(root, 'postgres');
  try {
    assertCluster(runtime, await actualCluster(admin, false), false);
    assert.equal((await admin.query('select count(*)::int as count from pg_database where datname=$1', [CI_DATABASE])).rows[0].count, 0);
    await admin.query('create database vimob_whatsapp_clone template template0');
  } finally { await admin.end(); }
  const client = await connect(root, CI_DATABASE);
  try {
    assertCluster(runtime, await actualCluster(client, false), false, CI_DATABASE);
    await client.query(`create schema vimob_ci_fixture; revoke all on schema vimob_ci_fixture from public;
      create table vimob_ci_fixture.identity(marker text primary key,nonce text not null,
        system_identifier text not null,data_directory text not null,created_at timestamptz not null);
      revoke all on vimob_ci_fixture.identity from public;`);
    await client.query('insert into vimob_ci_fixture.identity values($1,$2,$3,$4,$5)',
      [CI_MARKER, runtime.nonce, runtime.actual.systemIdentifier, runtime.actual.dataDirectory, runtime.createdAt]);
  } finally { await client.end(); }
  return runtime;
  } catch (error) {
    try {
      await access(path.join(root, 'runtime.json'));
      await stop(root);
      await writeFile(path.join(root, 'results', 'initialization-cleanup.json'), JSON.stringify({ stopped: true }));
    } catch (cleanupError) {
      if (cleanupError.code !== 'ENOENT') throw new AggregateError([error, cleanupError], 'owned initialization and cleanup failed');
    }
    throw error;
  }
}
export async function sqlFile(root, relative, options = {}, expectedSourceSha256) {
  const { mode, args } = sqlModeOptions(options);
  const allowed = ['scripts/tests/whatsapp-ci-infrastructure.sql', ...ADDITIONAL_SOURCES, ...MIGRATIONS.map(name => 'supabase/migrations/' + name), ...SQL_TESTS.map(name => 'supabase/tests/' + name)];
  assert.ok(allowed.includes(relative), 'SQL source is outside the explicit CI allowlist');
  const checkBodies = mode !== 'baseline';
  const { client } = await verifiedClient(root); await client.end();
  const runtime = await readRuntime(root);
  const sourcePath = path.resolve(repository, relative);
  assert.ok(sourcePath.startsWith(repository + path.sep), 'SQL must be versioned fixture/canonical source');
  const source = await readFile(sourcePath);
  assert.ok(source.length && !source.includes(0), 'empty/NUL SQL is forbidden');
  const materialized = materializeSQL(relative, source);
  if (expectedSourceSha256 !== undefined) {
    assert.match(expectedSourceSha256, /^[a-f0-9]{64}$/);
    assert.equal(materialized.sourceSha256, expectedSourceSha256, 'SQL source changed after preflight');
  }
  const snapshot = path.join(root, 'results', materialized.executedSha256 + '.sql');
  try { await writeFile(snapshot, materialized.bytes, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code !== 'EEXIST') throw error; assert.deepEqual(await readFile(snapshot), materialized.bytes); }
  if (!checkBodies) assert.equal(relative, 'supabase/migrations/20260722000000_production_public_private_baseline.sql', 'only the canonical dump baseline requires deferred function body checks');
  const password = await readFile(path.join(root, 'password.txt'), 'utf8');
  const result = await command(executable(runtime.bin, 'psql'), ['-h', '127.0.0.1', '-p', String(CI_PORT), '-U', 'postgres',
    '-d', CI_DATABASE, '-X', '-w', '-v', 'ON_ERROR_STOP=1', ...args, '-f', snapshot], {
    env: { ...childEnvironment(), PGPASSWORD: password, PGCLIENTENCODING: 'UTF8',
      PGOPTIONS: `-c search_path=public,extensions -c check_function_bodies=${checkBodies ? 'on' : 'off'} -c vimob.whatsapp_ci_nonce=${runtime.nonce}` } });
  return { ...result, sha256: materialized.sourceSha256, executedSha256: materialized.executedSha256, operationalOmission: materialized.operationalOmission };
}
export async function stop(root) {
  const runtime = await readRuntime(root);
  const control = (await command(executable(runtime.bin, 'pg_controldata'), [runtime.actual.dataDirectory])).stdout;
  assert.equal(control.match(/Database system identifier:\s+([0-9]{16,20})/)?.[1], runtime.actual.systemIdentifier, 'offline identity changed');
  try {
    const { client } = await verifiedClient(root); await client.end();
  } catch (error) {
    const status = await command(executable(runtime.bin, 'pg_ctl'), ['-D', runtime.actual.dataDirectory, 'status']).catch(e => e);
    if (status.code === 3) return { stopped: true, alreadyStopped: true };
    // Bootstrap can fail before the application DB or nonce table exists. The
    // offline ID plus live postgres metadata must still match our fresh root;
    // a missing sentinel never authorizes stopping a different cluster.
    const admin = await connect(root, 'postgres').catch(() => { throw error; });
    try { assertCluster(runtime, await actualCluster(admin, false), false); }
    finally { await admin.end(); }
  }
  await command(executable(runtime.bin, 'pg_ctl'), ['-D', runtime.actual.dataDirectory, '-m', 'fast', '-w', '-t', '180', 'stop']);
  return { stopped: true };
}
async function main() {
  const [action, rootValue, binValue] = process.argv.slice(2);
  assert.ok(['preflight', 'init', 'verify', 'stop'].includes(action), 'expected preflight/init/verify/stop');
  const root = fixtureRoot(rootValue);
  if (action === 'preflight') console.log(JSON.stringify(await preflight(root, binValue), null, 2));
  if (action === 'init') { await initialize(root, binValue); console.log('Owned synthetic CI cluster initialized at 127.0.0.1:57924.'); }
  if (action === 'verify') { const { client, runtime } = await verifiedClient(root); await client.end(); console.log(JSON.stringify({ verified: true, systemIdentifier: runtime.actual.systemIdentifier })); }
  if (action === 'stop') console.log(JSON.stringify(await stop(root)));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
