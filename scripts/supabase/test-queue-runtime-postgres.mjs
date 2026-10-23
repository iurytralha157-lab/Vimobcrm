import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { installTestHooks, invariants, lockWaitObservations } from './queue-postgres-fixture.mjs';
import { runConcurrencyCases } from './queue-postgres-cases.mjs';
import { runRaceCases } from './queue-postgres-races.mjs';
import { runPermissionCases } from './queue-postgres-permissions.mjs';
import { runTimezoneCases } from './queue-postgres-timezone.mjs';

// Explicit disposable target only. Never imports app config, .env or DB URL variables.
const [configPath, reportPath] = process.argv.slice(2);
if (!configPath || !path.isAbsolute(configPath) || !reportPath || !path.isAbsolute(reportPath)) {
  throw new Error('Usage: node scripts/supabase/test-queue-runtime-postgres.mjs ABSOLUTE_LOCAL_CONFIG_JSON ABSOLUTE_REPORT_JSON');
}
const config = JSON.parse(await readFile(configPath, 'utf8'));
assert.ok(['127.0.0.1', '::1'].includes(config.host), 'Only literal loopback endpoints accepted');
assert.ok(Number.isInteger(config.port) && config.port >= 20000 && config.port <= 65535, 'Explicit isolated port required');
assert.match(config.database, /^vimob_queue_[a-z0-9_]+$/, 'Disposable database name required');
assert.ok(typeof config.user === 'string' && config.user.length > 0, 'Explicit user required');
assert.ok(typeof config.password === 'string', 'Explicit disposable password required');
assert.ok(typeof config.sentinel === 'string' && config.sentinel.length >= 16, 'Disposable sentinel required');
assert.ok(['bootstrap-fixture', 'existing-fixture'].includes(config.mode), 'Explicit fixture mode required');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const migrations = [
  '20261015022236_queue_operating_schedule_contract.sql', '20261015022536_queue_runtime_state_and_audience.sql',
  '20261015022817_queue_runtime_transition_engine.sql', '20261015023126_queue_runtime_claim_and_guards.sql',
  '20261015023712_queue_runtime_canonical_and_batch.sql', '20261015024500_queue_notification_delivery_authorization.sql',
];
function definition(source, marker, delimiter) {
  const start = source.indexOf(marker), body = source.indexOf(delimiter, start), end = source.indexOf(delimiter, body + delimiter.length);
  assert.ok(start >= 0 && body >= 0 && end >= 0, `Missing SQL prerequisite ${marker}`);
  return source.slice(start, end + delimiter.length) + ';';
}
function trigger(source, name) {
  const start = source.indexOf(`create trigger ${name}`);
  assert.ok(start >= 0, `Missing prerequisite trigger ${name}`);
  return source.slice(start, source.indexOf(';', start) + 1).replace('create trigger', 'create or replace trigger');
}
const connections = [];
const report = { startedAt: new Date().toISOString(), engine: 'PostgreSQL', scope: 'Real multi-connection PostgreSQL; minimal synthetic prerequisites, not complete Supabase schema',
  target: { host: config.host, port: config.port, database: config.database }, attestedConnections: 0,
  existingFixtureProvenance: config.existingFixtureProvenance,
  cases: [], skipped: ['Full historical migration chain', 'Browser/API paths (separate root validation)', 'Network-provider delivery'], migrations };
const connect = async name => {
  const db = new pg.Client({ host: config.host, port: config.port, database: config.database, user: config.user,
    password: config.password, ssl: false, application_name: `vimob-queue-homologation-${name}`,
    connectionTimeoutMillis: 5000, statement_timeout: 15000, lock_timeout: 7000, idle_in_transaction_session_timeout: 20000 });
  await db.connect(); connections.push(db);
  const { rows: [identity] } = await db.query(`select current_database() as database,version() as version,
    (select count(*) from public.queue_homologation_sentinel where marker=$1) as matches`, [config.sentinel]);
  assert.equal(identity.database, config.database); assert.equal(Number(identity.matches), 1, 'Disposable sentinel mismatch; refusing writes');
  report.attestedConnections += 1; report.sentinelVerified = true;
  return db;
};
try {
  const observer = await connect('observer');
  report.serverVersion = (await observer.query('show server_version')).rows[0].server_version;
  if (config.mode === 'bootstrap-fixture') {
    const { rows: [state] } = await observer.query(`select count(*) as tables from pg_tables where schemaname in ('public','private','auth')
      and not(schemaname='public' and tablename='queue_homologation_sentinel')`);
    assert.equal(Number(state.tables), 0, 'Bootstrap only permitted in otherwise empty disposable DB');
    let fixture = await read('supabase/tests/queue_runtime.fixture.sql');
    const { rows: roles } = await observer.query("select rolname from pg_roles where rolname in ('anon','authenticated','service_role')");
    for (const { rolname } of roles) fixture = fixture.replace(`create role ${rolname};`, '');
    await observer.query(fixture);
    // Exercise real advisory/sequence initialization under PostgreSQL too;
    // PGlite's smaller fixture intentionally replaces this prerequisite.
    await observer.query('alter table public.round_robin_members add column leads_count integer default 0');
    const forward = await read('supabase/migrations/20260729011728_forward_distribution_ticket_upgrade.sql');
    for (const name of ['round_robin_ticket_sequence_name', 'ensure_round_robin_ticket_sequence', 'next_round_robin_ticket']) {
      await observer.query(definition(forward, `create function private.${name}(`, '$body$').replace('create function', 'create or replace function'));
    }
    await observer.query(await read('supabase/migrations/20260729021500_remove_ticket_sequence_runtime_acl_ddl.sql'));
    for (const [file, marker, delimiter] of [
      ['20261013034403_management_all_day_overnight_eligibility.sql', 'create or replace function private.pick_round_robin_ticket_candidate(', '$body$'],
      ['20260729011728_forward_distribution_ticket_upgrade.sql', 'create or replace function private.distribute_lead(', '$body$'],
      ['20260905093544_normalize_notification_delivery_outbox.sql', 'create or replace function private.notification_dispatch_required(', '$function$'],
    ]) await observer.query(definition(await read(`supabase/migrations/${file}`), marker, delimiter));
    for (const file of migrations) await observer.query(await read(`supabase/migrations/${file}`));
    await installTestHooks(observer);
  }
  // Include the latest pre-existing behavior that participates in these races.
  // Omitting the child revision trigger incorrectly makes member removal race.
  // An existing attested fixture already has its final allocator. Replaying
  // this predecessor would silently undo the catalog-recheck forward fix.
  if (config.mode === 'bootstrap-fixture') await observer.query(await read('supabase/migrations/20260729021500_remove_ticket_sequence_runtime_acl_ddl.sql'));
  await observer.query('alter table public.round_robins add column if not exists revision bigint not null default 1');
  const revisions = await read('supabase/migrations/20261012212832_management_revisions_and_create_intents.sql');
  for (const name of ['advance_management_queue_revision', 'advance_management_queue_child_revision']) {
    await observer.query(definition(revisions, `create or replace function private.${name}(`, '$function$'));
  }
  for (const name of ['zz_advance_management_queue_revision', 'advance_management_queue_member_revision']) await observer.query(trigger(revisions, name));
  const generations = await read('supabase/migrations/20261009030225_membership_access_generation.sql');
  const reinvite = await read('supabase/migrations/20261009140731_fence_membership_grants_after_reinvite.sql');
  await observer.query(definition(reinvite, 'create or replace function private.set_membership_generation(', '$body$'));
  await observer.query(definition(generations, 'create function private.bind_participant_membership_generation(', '$body$').replace('create function', 'create or replace function'));
  await observer.query(trigger(generations, 'set_membership_generation'));
  for (const name of ['z_bind_team_member_membership_generation', 'z_bind_round_robin_member_membership_generation']) await observer.query(trigger(generations, name));
  report.prerequisites = ['20260729021500: allocator ACL hot path', '20261012212832: queue revision and member revision triggers',
    '20261009030225 + 20261009140731: latest membership generation and participant binding'];
  report.transactionIsolation = (await observer.query('show transaction_isolation')).rows[0].transaction_isolation;
  report.allocatorDefinition = (await observer.query("select pg_get_functiondef('private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure) definition")).rows[0].definition;
  await observer.query('create table if not exists public.organization_role_permissions(organization_id uuid,role_id uuid,permission_key text)');
  await observer.query('alter table public.organization_role_permissions add column if not exists organization_role_id uuid');
  await observer.query('alter table public.organization_role_permissions add column if not exists permission_id uuid');
  await observer.query("alter table public.users add column if not exists role text default 'user'");
  await observer.query('create table if not exists public.available_permissions(id uuid primary key default gen_random_uuid(),key text unique)');
  await observer.query("insert into public.available_permissions(key) values('lead_operate'),('lead_view_own'),('lead_view_team'),('lead_view_all'),('*') on conflict(key) do nothing");
  await observer.query('alter table public.user_permission_overrides add column if not exists id uuid default gen_random_uuid()');
  await observer.query('alter table public.user_permission_overrides add column if not exists updated_at timestamptz default clock_timestamp()');
  await observer.query('create or replace function private.is_super_admin() returns boolean language sql stable as $$select false$$');
  const permissions = await read('supabase/migrations/20261009034132_scope_legacy_permission_helper_to_active_membership.sql');
  await observer.query(definition(permissions, 'create or replace function private.user_has_permission_in_organization(', '$function$'));
  report.prerequisites.push('20261009034132: actual active-membership role permission resolver; super-admin explicitly false');
  if (config.forwardMigrations) {
    for (const file of config.forwardMigrations) {
      assert.match(file, /^2026\d{10}_[a-z0-9_]+\.sql$/);
      await observer.query(await read(`supabase/migrations/${file}`));
    }
    report.forwardMigrations = config.forwardMigrations;
    report.allocatorDefinitionAfterForward = (await observer.query("select pg_get_functiondef('private.ensure_round_robin_ticket_sequence(uuid)'::regprocedure) definition")).rows[0].definition;
  }
  const sessions = await Promise.all(Array.from({ length: 8 }, (_, n) => connect(String(n))));
  const pids = await Promise.all(sessions.map(async db => (await db.query('select pg_backend_pid() pid')).rows[0].pid));
  assert.equal(new Set(pids).size, sessions.length, 'Must use independent PostgreSQL backends');
  report.independentBackendCount = pids.length;
  report.backendPids = pids;
  const test = async (name, fn) => {
    if (config.caseFilter && !new RegExp(config.caseFilter).test(name)) {
      report.cases.push({ name, status: 'skipped', reason: 'Explicit caseFilter in disposable target config' }); return;
    }
    const started = Date.now();
    try {
      await fn(); await invariants(observer);
      report.cases.push({ name, status: 'passed', milliseconds: Date.now() - started }); console.log(`PASS ${name}`);
    } catch (error) {
      await observer.query('select pg_advisory_unlock_all()');
      await Promise.allSettled(sessions.map(db => db.query('rollback')));
      report.cases.push({ name, status: 'failed', code: error.code, message: error.message, detail: error.detail, where: error.where, milliseconds: Date.now() - started });
      console.error(`FAIL ${name}: ${error.code || ''} ${error.message}`);
    } finally {
      await Promise.allSettled(sessions.map(db => db.query("select set_config('queue_homologation.pause','',false),set_config('queue_homologation.fail_notification','',false)")));
    }
  };
  await runConcurrencyCases({ observer, sessions, pids, test });
  await runRaceCases({ observer, sessions, pids, test });
  await runPermissionCases({ observer, sessions, pids, test });
  if (config.timezoneCases) await runTimezoneCases({ observer, sessions, pids, test });
  if (report.cases.some(c => c.status === 'failed')) process.exitCode = 1;
} catch (error) {
  report.fatal = { message: error.message, code: error.code, detail: error.detail, where: error.where }; process.exitCode = 1;
  console.error(JSON.stringify(report.fatal));
} finally {
  await Promise.allSettled(connections.map(async db => { await db.query('rollback'); await db.end(); }));
  report.completedAt = new Date().toISOString();
  report.lockWaitObservations = lockWaitObservations;
  report.passed = report.cases.filter(c => c.status === 'passed').length;
  report.failed = report.cases.filter(c => c.status === 'failed').length;
  report.filteredCases = report.cases.filter(c => c.status === 'skipped').length;
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(`Results ${report.passed} passed, ${report.failed} failed; report ${reportPath}`);
}
