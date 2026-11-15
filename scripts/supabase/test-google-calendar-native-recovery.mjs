import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const runtimeRoot = process.argv[2];
if (!runtimeRoot || !path.isAbsolute(runtimeRoot)) {
  throw new Error('Pass the absolute root of the authorized loopback vimob-whatsapp-ci-v1 runtime.');
}
const runtime = JSON.parse(await readFile(path.join(runtimeRoot, 'runtime.json'), 'utf8'));
assert.equal(runtime.kind, 'vimob-whatsapp-ci-v1');
assert.equal(path.resolve(runtime.root), path.resolve(runtimeRoot));
assert.equal(runtime.actual.serverAddress, '127.0.0.1');
assert.equal(runtime.actual.port, '57924');
const password = (await readFile(path.join(runtimeRoot, 'password.txt'), 'utf8')).trim();
const executable = path.join(runtime.bin, process.platform === 'win32' ? 'psql.exe' : 'psql');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databaseName = `vimob_google_recovery_${randomUUID().replaceAll('-', '')}`;
assert.match(databaseName, /^vimob_google_recovery_[0-9a-f]{32}$/);
const directory = await mkdtemp(path.join(tmpdir(), 'vimob-google-native-'));
let databaseOwned = false;

function psql(database, args, expectFailure = false) {
  const result = spawnSync(executable, [
    '-X', '-h', '127.0.0.1', '-p', '57924', '-U', 'postgres',
    '-v', 'ON_ERROR_STOP=1', '-d', database, ...args,
  ], { encoding: 'utf8', windowsHide: true, env: { ...process.env, PGPASSWORD: password }, timeout: 120000 });
  if (result.error) throw result.error;
  if (expectFailure) assert.notEqual(result.status, 0, 'failure injection must abort its transaction');
  else if (result.status !== 0) throw new Error(`Disposable PostgreSQL check failed: ${result.stderr.slice(0, 2000)}`);
  return result.stdout.trim();
}

async function expand(file) {
  const source = await readFile(file, 'utf8');
  const lines = [];
  for (const line of source.split('\n')) {
    const include = /^\\ir\s+(.+)\s*$/.exec(line);
    lines.push(include ? await expand(path.resolve(path.dirname(file), include[1].trim())) : line);
  }
  return lines.join('\n');
}

async function runSQL(name, source, expectFailure = false) {
  const file = path.join(directory, name);
  await writeFile(file, source);
  return psql(databaseName, ['-f', file], expectFailure);
}

try {
  const actual = JSON.parse(psql('postgres', ['-At', '-c', `select json_build_object(
    'database',current_database(),'address',host(inet_server_addr()),
    'port',current_setting('port'),'data_directory',current_setting('data_directory'),
    'system_identifier',(select system_identifier::text from pg_control_system()))` ]));
  assert.equal(actual.database, 'postgres');
  assert.equal(actual.address, '127.0.0.1');
  assert.equal(actual.port, '57924');
  assert.equal(path.resolve(actual.data_directory), path.resolve(runtime.actual.dataDirectory));
  assert.equal(actual.system_identifier, runtime.actual.systemIdentifier);
  psql('postgres', ['-c', `create database "${databaseName}"`]);
  databaseOwned = true;

  const fixturePath = path.join(root, 'supabase/tests/google_calendar_activation_status_export.fixture.sql');
  const fixture = await readFile(fixturePath, 'utf8');
  const split = fixture.indexOf('\\ir ../migrations/20261012212128_');
  assert.ok(split > 0);
  const preambleFile = path.join(directory, 'preamble.sql');
  const baseFixture = await expand(path.join(root, 'supabase/tests/google_calendar_outbound_protocol.fixture.sql'));
  const preamble = fixture.slice(0, split).replace(
    '\\ir google_calendar_outbound_protocol.fixture.sql',
    () => baseFixture,
  );
  await writeFile(preambleFile, preamble);
  psql(databaseName, ['-f', preambleFile]);
  const hardening = await readFile(path.join(root, 'supabase/migrations/20261012212128_harden_google_calendar_outbound_protocol.sql'), 'utf8');
  const transaction = `begin;\nset local lock_timeout='5s';\nset local statement_timeout='5min';\n${hardening}\n`;
  await runSQL('rollback-proof.sql', `${transaction}\nselect 1/0;\ncommit;`, true);
  assert.equal(psql(databaseName, ['-At', '-c', `select count(*) from information_schema.columns
    where table_schema='public' and table_name='google_calendar_tokens' and column_name='disconnecting_at'`]), '0');
  assert.equal(psql(databaseName, ['-At', '-c', `select to_regprocedure('public.google_calendar_claim_outbound_sync_jobs_v2(integer,text)') is null`]), 't');
  console.log('PASS injected failure rolled back the entire 12 October schema/RPC transaction.');

  await runSQL('protocol.sql', `${transaction}\ncommit;`);
  psql(databaseName, ['-f', path.join(root, 'supabase/migrations/20261013000127_harden_google_calendar_activation_status_and_export.sql')]);
  console.log('PASS both canonical Google migrations applied in order to the owned disposable database.');
  for (const file of [
    'supabase/tests/google_calendar_activation_status_export.test.sql',
    'supabase/tests/google_calendar_outbound_protocol.test.sql',
  ]) {
    await runSQL(path.basename(file), await expand(path.join(root, file)));
    console.log(`PASS ${file}`);
  }
  psql(databaseName, ['-f', path.join(root, 'scripts/maintenance/google-calendar-runtime-contracts.sql')]);
  console.log('PASS read-only runtime contract report parses on the reconciled native schema.');
  const summary = JSON.parse(psql(databaseName, ['-At', '-c', `select json_build_object(
    'server_version',current_setting('server_version'),
    'claim_v2',to_regprocedure('public.google_calendar_claim_outbound_sync_jobs_v2(integer,text)') is not null,
    'heartbeat',to_regprocedure('public.google_calendar_job_heartbeat(uuid,text)') is not null,
    'finish',to_regprocedure('public.google_calendar_finish_outbound_job(uuid,text,text,text,integer,boolean,boolean)') is not null)`]));
  assert.ok(summary.claim_v2 && summary.heartbeat && summary.finish);
  console.log(JSON.stringify({ ...summary, provider_calls: 0, production_changes: 0 }));
} finally {
  if (databaseOwned) psql('postgres', ['-c', `drop database "${databaseName}"`]);
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
  assert.match(path.basename(directory), /^vimob-google-native-/);
  await rm(directory, { recursive: true, force: true });
}
