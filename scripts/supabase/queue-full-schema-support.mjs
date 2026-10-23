import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { connectVerifiedDatabase, localAuthFetch, readVerifiedManifest, RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { isolatedProcessEnvironment } from './launch-queue-local-homologation.mjs';
import { queueSchedule } from './seed-queue-local-homologation.mjs';
import { assertQueueEditorResponse } from './queue-editor-contract.mjs';
import { inspectOwnedBrowserWorker, recordBrowserDrain } from './queue-browser-cleanup.mjs';

const runFile = promisify(execFile);
export const API_ORIGIN = 'http://127.0.0.1:58081';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const queueCandidateVersions = ['20261015033816', '20261015034140', '20261015035224'];

export async function requireFullSchema(db, manifest, { baseline = false } = {}) {
  const files = (await fs.readdir(path.join(repositoryRoot, 'supabase/migrations'))).filter(file => /^\d+_.*\.sql$/.test(file)).sort();
  assert.ok(files.length >= 228, 'Full migration chain is required; a partial fixture is forbidden.');
  const { rows } = await db.query('select version from supabase_migrations.schema_migrations');
  const applied = new Set(rows.map(row => row.version));
  const requiredFiles = baseline ? files.filter(file => !queueCandidateVersions.includes(file.split('_')[0])) : files;
  if (baseline) for (const version of queueCandidateVersions) assert.equal(applied.has(version), false, 'Baseline must precede all three queue candidates.');
  const missing = requiredFiles.filter(file => !applied.has(file.split('_')[0]));
  assert.deepEqual(missing, [], `Full chain is missing ${missing.length} local migrations.`);
  const domains = ['auth.sessions', 'storage.buckets', 'public.whatsapp_messages', 'public.cadence_enrollments', 'public.organization_members', 'private.queue_lead_runtime'];
  for (const relation of domains) assert.ok((await db.query('select to_regclass($1) relation', [relation])).rows[0].relation, `Full Supabase relation is missing: ${relation}`);
  const evidencePath = path.join(RUNTIME_ROOT, 'empty-bootstrap-adapter.json');
  const bootstrap = JSON.parse(await fs.readFile(evidencePath, 'utf8'));
  assert.equal(bootstrap.kind, 'vimob-queue-empty-bootstrap-adapter-v1');
  if (bootstrap.runId !== undefined) assert.equal(bootstrap.runId, manifest.runId);
  assert.equal(bootstrap.originalReplayStatus, 'blocked', 'This run must retain the known original bootstrap failure.');
  assert.equal(bootstrap.preconditionAdjustment?.triggers?.length, 3);
  assert.equal(bootstrap.preconditionAdjustment.restoredAfterHistoricalReadback, true);
  assert.ok(bootstrap.preconditionAdjustment.restorationReason?.length > 0);
  assert.equal(bootstrap.adaptedMigrations?.length, 3);
  const adapters = new Map(bootstrap.adaptedMigrations.map(adapter => [adapter.file, adapter]));
  assert.deepEqual(Array.from(adapters.keys()).sort(), ['20260921132800_guard_historical_stage_clock.sql',
    '20261012144339_whatsapp_selected_route_explicit_pn_barrier.sql', '20261012223733_whatsapp_stored_lid_contact_identity_barrier.sql']);
  for (const [file, adapter] of adapters) {
    const original = await fs.readFile(path.join(repositoryRoot, 'supabase/migrations', file));
    const adapted = await fs.readFile(path.join(manifest.workdir, 'supabase/migrations', file));
    const originalHash = crypto.createHash('sha256').update(original).digest('hex');
    const adaptedHash = crypto.createHash('sha256').update(adapted).digest('hex');
    assert.equal(adapter.originalSha256.toLowerCase(), originalHash);
    assert.equal(adapter.adaptedSha256.toLowerCase(), adaptedHash);
    assert.notEqual(adaptedHash, originalHash);
    if (file.startsWith('20260921132800_')) assert.match(adapter.omittedBlock, /historical_stage_clock_reconcile/);
    else {
      assert.equal(adapter.changedGuardOnly, true);
      assert.equal(adapter.patchKind, 'canonical-pre-cutover-source-variant-md5-allowlist');
      const from = file.startsWith('20261012144339_') ? "if md5(v_body) <> 'f0ac62447672f723fac16f8b3acf982e'" : "if md5(v_body)<>'3a2da8da0a39e6d55bb0a66c659719c2'";
      const to = file.startsWith('20261012144339_') ? "if md5(v_body) not in ('f0ac62447672f723fac16f8b3acf982e', '46b114c521da8970937a17c90f9656a6')" : "if md5(v_body) not in ('3a2da8da0a39e6d55bb0a66c659719c2', 'f29adb9117edee20dd32530b40db82a9')";
      assert.equal(original.toString().split(from).length - 1, 1);
      assert.equal(adapted.toString(), original.toString().replace(from, to));
    }
  }
  assert.equal(bootstrap.functionSourceProof?.canonicalMigrationExactPredecessor, true);
  assert.equal(bootstrap.functionSourceProof.previousReversedMD5, 'c83cd66e37361bfa2188d6317cedfbd8');
  return { classification: 'full_domain_schema_with_disposable_bootstrap_adapter', originalChainReplayPassed: false,
    baselineBeforeQueueCandidates: baseline, localMigrations: requiredFiles.length, appliedMigrations: applied.size, finalMigration: requiredFiles.at(-1), domains, bootstrapEvidence: bootstrap };
}

export async function createFullSchemaContext(filename, options = {}) {
  const manifest = await readVerifiedManifest(filename);
  const db = await connectVerifiedDatabase(manifest);
  try {
    const fullSchema = await requireFullSchema(db, manifest, options);
    const fixture = JSON.parse(await fs.readFile(path.join(RUNTIME_ROOT, 'synthetic-fixture.json'), 'utf8'));
    assert.equal(fixture.kind, 'vimob-queue-homologation-fixture-v1');
    assert.equal(fixture.runId, manifest.runId);
    assert.equal(fixture.supabaseURL, manifest.supabaseURL);
    assert.equal(fixture.organizations.length, 2);
    for (const org of fixture.organizations) {
      for (const value of [org.id, org.pipelineId, org.stageId, ...Object.values(org.users).map(user => user.id)]) assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    assert.equal((await db.query("select count(*)::int unexpected from public.organizations where email is null or email not like '%@queue.local.test'")).rows[0].unexpected, 0);
    const context = { manifest, filename, fixture, db, fullSchema, authClients: [], tokens: new Map(), observations: [], created: [] };
    for (const org of fixture.organizations) {
      const userRoles = org === fixture.organizations[0] ? (options.authRoles || Object.keys(org.users)) : ['admin'];
      for (const role of userRoles) {
        const user = org.users[role];
        assert.ok(user.email.endsWith('@queue.local.test'));
        const client = createClient(manifest.supabaseURL, manifest.anonKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localAuthFetch(manifest) } });
        const { data, error } = await client.auth.signInWithPassword({ email: user.email, password: fixture.syntheticPassword });
        assert.ok(!error && data.session, `Real local GoTrue login failed for ${role}: ${error?.code || error?.status || 'no_session'}`);
        const claims = JSON.parse(Buffer.from(data.session.access_token.split('.')[1], 'base64url').toString());
        assert.equal(claims.sub, user.id);
        assert.equal(claims.iss, `${manifest.supabaseURL}/auth/v1`);
        assert.equal((await db.query('select count(*)::int n from auth.sessions where id=$1::uuid and user_id=$2::uuid', [claims.session_id, user.id])).rows[0].n, 1);
        context.tokens.set(user.id, data.session.access_token);
        context.authClients.push(client);
      }
    }
    context.request = (org, role, method, route, body, extra = {}) => apiRequest(context, org, role, method, route, body, extra);
    context.dataAPI = (org, role, method, route, body) => dataAPIRequest(context, org, role, method, route, body);
    context.createQueue = (org, label, options) => createQueue(context, org, label, options);
    context.createLead = (org, queue, label, options) => createLead(context, org, queue, label, options);
    context.runtimeOnce = () => runtimeOnce(context);
    return context;
  } catch (error) { await db.end(); throw error; }
}

async function parseResponse(response) {
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { nonJSON: true }; }
  return { status: response.status, body };
}

async function apiRequest(context, org, role, method, route, body, extra) {
  const target = new URL(route, API_ORIGIN);
  assert.equal(target.origin, API_ORIGIN);
  assert.ok(target.pathname.startsWith('/v1/') || target.pathname === '/readyz');
  const token = context.tokens.get(org.users[role].id);
  assert.ok(token, 'A real local Auth session is required.');
  return parseResponse(await fetch(target, { method, redirect: 'error', signal: AbortSignal.timeout(25_000),
    headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': org.id, 'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body) }));
}

async function dataAPIRequest(context, org, role, method, route, body) {
  assert.ok(route.startsWith('/rest/v1/'));
  return parseResponse(await localAuthFetch(context.manifest)(`${context.manifest.supabaseURL}${route}`, {
    method, headers: { apikey: context.manifest.anonKey, Authorization: `Bearer ${context.tokens.get(org.users[role].id)}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
}

export function requireStatus(result, status, label) {
  assert.equal(result.status, status, `${label}: HTTP ${result.status}, code=${result.body?.error?.code || result.body?.code || 'unknown'}`);
  return result.body;
}

async function createQueue(context, org, label, { open = true, weighted = false, timeout = false, members } = {}) {
  const source = `qh-${context.manifest.runId.slice(0, 8)}-${label}-${crypto.randomBytes(3).toString('hex')}`;
  const settings = { operating_schedule: queueSchedule(open), enable_redistribution: timeout, redistribution_timeout_minutes: 1,
    redistribution_warning_minutes: 0, redistribution_max_attempts: 0, ignore_availability: false, pool_notifications: { enabled: false } };
  const payload = { name: `Homologação ${label} ${source}`, strategy: weighted ? 'weighted' : 'simple', targetPipelineId: org.pipelineId,
    targetStageId: org.stageId, reentryBehavior: 'redistribute', settings, conditions: [{ type: 'source', values: [source] }],
    members: members || Array.from({ length: 5 }, (_, index) => ({ userId: org.users[`broker${index + 1}`].id, weight: weighted && index === 0 ? 4 : 1, isActive: true })) };
  const created = requireStatus(await context.request(org, 'admin', 'POST', '/v1/round-robins', payload, { 'Idempotency-Key': crypto.randomUUID() }), 201, `create queue ${label}`).data;
  assert.ok(created?.id);
  context.created.push({ kind: 'queue', organizationId: org.id, id: created.id, label, source });
  assertQueueEditorResponse({ data: created });
  return { id: created.id, source, settings, label };
}

async function createLead(context, org, queue, label, { assignedUserId, autoDistribute = true, explicitQueue = false } = {}) {
  const payload = { name: `Sintético ${label} ${crypto.randomBytes(4).toString('hex')}`, source: queue.source,
    pipelineId: org.pipelineId, stageId: org.stageId, autoDistribute };
  if (explicitQueue && autoDistribute) payload.roundRobinId = queue.id;
  if (assignedUserId) payload.assignedUserId = assignedUserId;
  const created = requireStatus(await context.request(org, 'admin', 'POST', '/v1/leads', payload), 201, `create lead ${label}`);
  assert.ok(created.leadId);
  context.created.push({ kind: 'lead', organizationId: org.id, id: created.leadId, label });
  return { id: created.leadId, response: created };
}

export async function queueState(context, org, queue) {
  return requireStatus(await context.request(org, 'admin', 'GET', `/v1/round-robins/${queue.id}`), 200, 'read queue').data;
}

export async function setSchedule(context, org, queue, open) {
  const current = await queueState(context, org, queue);
  const response = await context.request(org, 'admin', 'PATCH', `/v1/round-robins/${queue.id}`, { expectedRevision: current.revision,
    settings: { ...current.settings, operating_schedule: queueSchedule(open) } });
  requireStatus(response, 200, `set queue ${open ? 'open' : 'closed'}`);
}

export async function snapshot(context, org, lead) {
  return (await context.db.query(`select jsonb_build_object('owner',l.assigned_user_id,'runtime',to_jsonb(r),
    'visits',(select count(*) from private.queue_round_visits where organization_id=$1 and lead_id=$2),
    'assignments',(select count(*) from public.assignments_log where organization_id=$1 and lead_id=$2),
    'events',(select count(*) from private.queue_runtime_events where organization_id=$1 and lead_id=$2),
    'claims',(select count(*) from private.queue_pool_claim_receipts where organization_id=$1 and lead_id=$2),
    'notifications',(select count(*) from public.notifications where organization_id=$1 and lead_id=$2)) result
    from public.leads l left join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
    where l.organization_id=$1 and l.id=$2`, [org.id, lead.id])).rows[0].result;
}

export async function expireSyntheticLead(context, org, lead) {
  assert.ok(context.created.some(item => item.kind === 'lead' && item.id === lead.id && item.organizationId === org.id));
  await context.db.query("update private.queue_lead_runtime set due_at=clock_timestamp()-interval '1 second',next_action_at=clock_timestamp()-interval '1 second' where organization_id=$1 and lead_id=$2", [org.id, lead.id]);
}

export async function wakeSyntheticLead(context, org, lead) {
  assert.ok(context.created.some(item => item.kind === 'lead' && item.id === lead.id && item.organizationId === org.id));
  await context.db.query("update private.queue_lead_runtime set next_action_at=clock_timestamp()-interval '1 second' where organization_id=$1 and lead_id=$2", [org.id, lead.id]);
}

async function runtimeOnce(context) {
  const executable = path.join(RUNTIME_ROOT, 'bin/queue-homologation-runtime.exe');
  try {
    const result = await runFile(executable, ['-manifest', context.filename, '-once'], { cwd: path.join(RUNTIME_ROOT, 'process-cwd'),
      env: isolatedProcessEnvironment(context.manifest, context.manifest.jwtSecret ? 'legacy' : 'jwks'), timeout: 45_000, windowsHide: true });
    const cycle = String(result.stderr || '').match(/cycle=(\d+) failed=(true|false) durationMillis=(\d+)/);
    context.observations.push({ test: 'real-go-runtime-cycle', successful: true, cycle: cycle ? Number(cycle[1]) : null,
      durationMilliseconds: cycle ? Number(cycle[3]) : null });
  } catch (error) {
    const diagnostic = String(error.stderr || '').split(/\r?\n/).find(line => line.startsWith('real redistribution cycle failed:'));
    context.observations.push({ test: 'real-go-runtime-failure', exit: error.code || 'timeout', diagnostic: diagnostic || 'no_safe_driver_diagnostic' });
    throw new Error(`Real Go runtime cycle failed: exit=${error.code || 'timeout'}; ${diagnostic || 'no_safe_driver_diagnostic'}`);
  }
}

export async function assertInvariants(context) {
  const orgs = context.fixture.organizations.map(org => org.id);
  const { rows: [values] } = await context.db.query(`select
    (select count(*)::int from private.queue_lead_runtime r join public.leads l on l.id=r.lead_id and l.organization_id=r.organization_id
      where r.organization_id=any($1::uuid[]) and r.state in ('pool_ready','pool_waiting','limit_exhausted') and l.assigned_user_id is not null) pool_owned,
    (select count(*)::int from private.queue_lead_runtime r join public.round_robins q on q.id=r.round_robin_id where r.organization_id=any($1::uuid[]) and q.organization_id<>r.organization_id) crossed_tenants,
    (select count(*)::int from private.queue_runtime_commands where organization_id=any($1::uuid[])) leaked_commands,
    (select count(*)::int from (select v.organization_id,v.lead_id,v.episode_id,v.round_number,v.user_id,count(*) from private.queue_round_visits v
      where v.organization_id=any($1::uuid[]) group by 1,2,3,4,5 having count(*)>1) duplicates) repeated_round_visit`, [orgs]);
  for (const [name, value] of Object.entries(values)) assert.equal(value, 0, name);
  return values;
}

export async function closeFullSchemaContext(context) {
  for (const client of context.authClients) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
  try {
    // Auth/PostgREST can finish an in-flight COMMIT just after its HTTP reply.
    // Require two zero snapshots within a bounded drain; do not terminate,
    // roll back, retry cases, or ignore an idle transaction to manufacture PASS.
    const samples = [];
    let consecutiveZero = 0;
    const end = Date.now() + 2_000;
    while (Date.now() < end && consecutiveZero < 2) {
      const { rows } = await context.db.query(`select a.pid,a.application_name,a.state,
        a.xact_start is not null open_transaction,
        (select count(*)::int from pg_locks l where l.pid=a.pid and not l.granted) waiting_locks
        from pg_stat_activity a where a.datname=current_database() and a.backend_type='client backend'
          and a.pid<>pg_backend_pid() and (a.xact_start is not null or exists(select 1 from pg_locks l where l.pid=a.pid and not l.granted))`);
      samples.push({ at: new Date().toISOString(), activity: rows });
      consecutiveZero = rows.length === 0 ? consecutiveZero + 1 : 0;
      if (consecutiveZero < 2) await new Promise(resolve => setTimeout(resolve, 100));
    }
    context.observations.push({ test: 'final-session-cleanup', maximumDrainMilliseconds: 2_000,
      consecutiveZeroSnapshots: consecutiveZero, samples });
    assert.equal(consecutiveZero, 2, 'Client transactions or lock waits remained after the bounded local cleanup drain.');
  } finally { await context.db.end(); }
}

// Browser observation deliberately runs beside the attested real worker. Its
// terminal global drain is an explicit outstanding obligation, never a PASS.
// Automated API/team suites continue to call strict closeFullSchemaContext.
export async function closeBrowserSchemaContext(context, command) {
  assert.ok(['prepare', 'create-timeout', 'create-timeout-attempt', 'snapshot', 'snapshot-timeout-attempt', 'runtime-once', 'global-cleanup'].includes(command));
  let worker;
  const workerStopVerification = [];
  try { worker = await inspectOwnedBrowserWorker(context.manifest, { audit: workerStopVerification }); }
  catch (error) {
    for (const client of context.authClients) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    await context.db.end();
    throw error;
  }
  if (!worker) {
    await closeFullSchemaContext(context);
    const drain = context.observations.findLast(value => value.test === 'final-session-cleanup');
    return recordBrowserDrain(context.manifest, command, 'PASSED', { drain, workerStopVerification });
  }
  try {
    for (const client of context.authClients) await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    const reason = 'The attested production worker is alive; terminal global quiescence must be checked after stopping this owned loop.';
    context.observations.push({ test: 'browser-session-cleanup', status: 'DEFERRED', reason, worker });
    const receipt = await recordBrowserDrain(context.manifest, command, 'DEFERRED', { reason, worker });
    assert.notEqual(command, 'global-cleanup', 'Stop the attested owned worker before requesting the required final global drain.');
    return receipt;
  } finally { await context.db.end(); }
}
