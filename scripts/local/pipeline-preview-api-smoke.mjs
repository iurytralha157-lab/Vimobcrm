import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { connectVerifiedDatabase, localAuthFetch, readVerifiedManifest } from '../supabase/queue-local-homologation-target.mjs';
import { readPipelineFixture, verifyPipelineBaseline } from './pipeline-preview-verify.mjs';

const API = 'http://127.0.0.1:58082';
const CHECKED_TABLES = {
  organizations: 'id', users: 'id', leads: 'organization_id', pipelines: 'organization_id',
  stages: 'organization_id', organization_members: 'organization_id', activities: 'organization_id',
  audit_logs: 'organization_id', notifications: 'organization_id',
};
const checks = [];
const sessions = [];
let phase = 'guard';

function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

async function request(token, organizationId, method, pathname, body) {
  assert.ok(pathname.startsWith('/v1/'));
  const requestId = crypto.randomUUID();
  const startedAt = Date.now();
  const response = await fetch(`${API}${pathname}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'X-Organization-ID': organizationId,
      'X-Request-ID': requestId, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json();
  return { status: response.status, data: json.data,
    durationMs: Date.now() - startedAt,
    requestId: response.headers.get('x-request-id') || json.error?.requestId || requestId,
    code: json.error?.code || null };
}

async function assertHealthy() {
  const response = await fetch(`${API}/healthz`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.runtime.notificationDispatch.backgroundWorkersEnabled, false);
  assert.equal(body.runtime.whatsapp.backgroundWorkersEnabled, false);
  assert.equal(body.runtime.whatsapp.stats.provider.configured, false);
  return { status: response.status, release: body.release, backgroundWorkersEnabled: false,
    providerConfigured: false, providerRequests: body.runtime.whatsapp.stats.provider.requests };
}

async function login(manifest, db, user, password) {
  const client = createClient(manifest.supabaseURL, manifest.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: localAuthFetch(manifest) },
  });
  const response = await client.auth.signInWithPassword({ email: user.email, password });
  assert.ok(!response.error && response.data.session, 'Real local password login failed.');
  sessions.push(client);
  const token = response.data.session.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(claims.iss, `${manifest.supabaseURL.replace(/\/$/, '')}/auth/v1`);
  assert.equal(claims.sub, user.id);
  assert.ok(claims.session_id);
  const active = await db.query('select count(*)::int as count from auth.sessions where user_id=$1::uuid and id=$2::uuid',
    [user.id, claims.session_id]);
  assert.equal(active.rows[0].count, 1);
  return { token, sessionId: claims.session_id };
}

async function leadProof(db, organizationId, leadId) {
  const result = await db.query(`select l.id::text, l.stage_id::text, l.pipeline_id::text,
    to_char(l.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
    to_char(l.board_order_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as board_order_at,
    to_char(l.stage_entered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stage_entered_at,
    to_jsonb(l)::text as full_row,
    (select count(*)::int from public.audit_logs a where a.organization_id=l.organization_id
      and a.entity_id::text=l.id::text and a.entity_type='lead') as audit_count,
    (select count(*)::int from public.activities a where a.organization_id=l.organization_id
      and a.lead_id=l.id) as activity_count,
    (select count(*)::int from public.activities a where a.organization_id=l.organization_id
      and a.lead_id=l.id and a.type='stage_change') as stage_history_count
    from public.leads l where l.organization_id=$1::uuid and l.id=$2::uuid`, [organizationId, leadId]);
  assert.equal(result.rowCount, 1);
  const { full_row: row, ...proof } = result.rows[0];
  return { ...proof, row_sha256: crypto.createHash('sha256').update(row).digest('hex') };
}

async function organizationSnapshot(db, organization) {
  const result = {};
  await db.query('begin isolation level repeatable read read only');
  try {
    for (const [table, column] of Object.entries(CHECKED_TABLES)) {
      const ids = table === 'users' ? Object.values(organization.users).map(user => user.id) : [organization.id];
      const rows = await db.query(`select to_jsonb(t)::text as row from public.${table} t
        where ${column}=any($1::uuid[]) order by (to_jsonb(t)::text) collate "C"`, [ids]);
      const hash = crypto.createHash('sha256');
      for (const { row } of rows.rows) hash.update(String(Buffer.byteLength(row))).update(':').update(row).update('\n');
      result[table] = { count: rows.rowCount, sha256: hash.digest('hex') };
    }
    await db.query('commit');
    return result;
  } catch (error) { await db.query('rollback'); throw error; }
}

function moveBody(lead, stageId, boardOrderAt = new Date().toISOString()) {
  return { stageId, expectedStageId: lead.stageId, expectedUpdatedAt: lead.updatedAt, boardOrderAt };
}

function responseEvidence(response) {
  return { status: response.status, code: response.code, requestId: response.requestId, durationMs: response.durationMs };
}

function canonicalTimestamp(value) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/.exec(value);
  assert.ok(match, 'API must preserve PostgreSQL microsecond timestamp precision.');
  return `${match[1]}.${(match[2] || '').padEnd(6, '0')}Z`;
}

async function writeReceipt(handle, evidence) {
  const bytes = Buffer.from(JSON.stringify(evidence, null, 2));
  let written = 0;
  while (written < bytes.length) {
    const result = await handle.write(bytes, written, bytes.length - written, written);
    assert.ok(result.bytesWritten > 0, 'Evidence write must make progress.');
    written += result.bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
}

export async function smokePipelineLocalAPI(manifestFilename, fixtureFilename, baselineFilename, outputFilename) {
  const manifest = await readVerifiedManifest(manifestFilename);
  await readPipelineFixture(manifest, fixtureFilename);
  const fixture = JSON.parse(await fs.readFile(fixtureFilename, 'utf8'));
  const [neighbor, organization] = fixture.organizations;
  const writable = new Set(organization.leads.slice(0, 3).map(lead => lead.id));
  const stages = Object.fromEntries(organization.stages.map(stage => [stage.stageKey, stage.id]));
  const output = path.join(path.dirname(await fs.realpath(fixtureFilename)), 'pipeline-api-smoke.json');
  assert.equal(path.resolve(outputFilename), path.resolve(output), 'Use the dedicated fixed evidence filename.');
  // This durable exclusive claim precedes all logins and lead writes. A failed
  // or interrupted run remains reserved; rerunning requires a new fixture.
  const receipt = await fs.open(output, 'wx', 0o600);
  const evidence = { kind: 'vimob-pipeline-local-api-smoke-v1', runId: fixture.runId, stackRunId: manifest.runId,
    api: API, status: 'reserved', reservedAt: new Date().toISOString(),
    mutationScope: 'organization_b_leads_1_2_3_only', checks, responses: {}, proofs: {} };
  let db;
  let failure;
  const read = async (actor, id) => {
    const response = await request(actor.token, organization.id, 'GET', `/v1/leads/${id}`);
    assert.equal(response.status, 200, 'Authorized synthetic lead GET failed.');
    return response.data;
  };
  const move = (actor, id, body, organizationId = organization.id) => {
    assert.ok(writable.has(id), 'POST target must be one of the three explicitly owned B leads.');
    assert.ok(Object.values(stages).includes(body.stageId) || body.stageId === neighbor.stages[1].id,
      'Destination must belong to the exact synthetic fixture.');
    assert.ok([organization.id, neighbor.id].includes(organizationId));
    return request(actor.token, organizationId, 'POST', `/v1/leads/${id}/move-stage`, body);
  };
  try {
    await writeReceipt(receipt, evidence);
    db = await connectVerifiedDatabase(manifest);
    evidence.healthBefore = await assertHealthy();
    phase = 'real_local_auth';
    const first = await login(manifest, db, organization.users.admin, fixture.syntheticPassword);
    const second = await login(manifest, db, organization.users.admin, fixture.syntheticPassword);
    const broker = await login(manifest, db, organization.users.broker, fixture.syntheticPassword);
    check(first.sessionId !== second.sessionId, 'two_distinct_real_admin_sessions');
    for (const [index, actor] of [first, second].entries()) {
      const capability = await request(actor.token, organization.id, 'GET', '/v1/leads/capabilities/move-stage');
      evidence.responses[`capabilities_${index + 1}`] = responseEvidence(capability);
      check(capability.status === 200 && capability.data?.contract === 'revision-v1', `session_${index + 1}_revision_v1_capability`);
    }
    const lead1 = organization.leads[0].id;
    const lead2 = organization.leads[1].id;
    const lead3 = organization.leads[2].id;
    phase = 'move_b1';
    const before = await read(first, lead1);
    const proofBefore = await leadProof(db, organization.id, lead1);
    const moved = await move(first, lead1, moveBody(before, stages.contacted));
    evidence.responses.move = responseEvidence(moved);
    check(moved.status === 200, 'move_b1_http_200');
    const persisted = await leadProof(db, organization.id, lead1);
    const fresh = await read(first, lead1);
    check(persisted.stage_id === stages.contacted && persisted.pipeline_id === organization.pipelineId,
      'move_b1_sql_destination_durable');
    check(fresh.stageId === moved.data.stageId && fresh.updatedAt === moved.data.updatedAt,
      'move_b1_independent_get_matches_response');
    check(persisted.updated_at === canonicalTimestamp(moved.data.updatedAt)
      && persisted.board_order_at === canonicalTimestamp(moved.data.boardOrderAt), 'move_b1_sql_timestamps_match_http_exactly');
    check(persisted.updated_at !== proofBefore.updated_at, 'move_b1_exact_sql_revision_changed');
    check(persisted.audit_count === proofBefore.audit_count + 1
      && persisted.stage_history_count === proofBefore.stage_history_count + 1,
    'move_b1_one_audit_and_stage_history');
    evidence.proofs.move = { before: proofBefore, after: persisted };
    phase = 'reorder_b1';
    const reordered = await move(first, lead1, moveBody(fresh, stages.contacted, new Date(Date.now() - 1000).toISOString()));
    evidence.responses.reorder = responseEvidence(reordered);
    check(reordered.status === 200, 'reorder_b1_http_200');
    const reorderProof = await leadProof(db, organization.id, lead1);
    check(reorderProof.updated_at !== persisted.updated_at, 'same_stage_reorder_trigger_changes_exact_revision');
    check(reorderProof.updated_at === canonicalTimestamp(reordered.data.updatedAt), 'reorder_sql_revision_matches_http_exactly');
    check(reorderProof.stage_entered_at === persisted.stage_entered_at
      && reorderProof.stage_history_count === persisted.stage_history_count
      && reorderProof.audit_count === persisted.audit_count + 1, 'reorder_preserves_stage_clock_and_stage_history');
    evidence.proofs.reorder = reorderProof;
    phase = 'stale_revision';
    const stale = await move(first, lead1, moveBody(fresh, stages.qualified));
    evidence.responses.stale = responseEvidence(stale);
    check(stale.status === 409 && stale.code === 'lead_changed', 'stale_revision_returns_409');
    assert.deepEqual(await leadProof(db, organization.id, lead1), reorderProof);
    check(true, 'stale_revision_no_lead_audit_or_history_write');
    phase = 'two_session_race_b2';
    const raceBefore = await read(first, lead2);
    const raceProofBefore = await leadProof(db, organization.id, lead2);
    const raced = await Promise.all([
      move(first, lead2, moveBody(raceBefore, stages.contacted)),
      move(second, lead2, moveBody(raceBefore, stages.qualified)),
    ]);
    evidence.responses.race = raced.map(responseEvidence);
    check(raced.filter(response => response.status === 200).length === 1
      && raced.filter(response => response.status === 409).length === 1, 'two_session_race_one_success_one_conflict');
    const raceAfter = await leadProof(db, organization.id, lead2);
    check(raceAfter.stage_id === raced.find(response => response.status === 200).data.stageId
      && raceAfter.audit_count === raceProofBefore.audit_count + 1
      && raceAfter.stage_history_count === raceProofBefore.stage_history_count + 1,
    'two_session_race_only_one_durable_transition');
    check(raceAfter.updated_at === canonicalTimestamp(raced.find(response => response.status === 200).data.updatedAt),
      'race_winner_sql_revision_matches_http_exactly');
    evidence.proofs.race = { before: raceProofBefore, after: raceAfter };
    phase = 'negative_tenant_and_owner';
    const neighborBefore = await organizationSnapshot(db, neighbor);
    const negativeBefore = await leadProof(db, organization.id, lead3);
    const negativeLead = await read(first, lead3);
    const foreign = await move(first, lead3, moveBody(negativeLead, neighbor.stages[1].id));
    evidence.responses.foreignDestination = responseEvidence(foreign);
    check(foreign.status === 400 && foreign.code === 'lead_move_destination_unavailable', 'foreign_stage_rejected');
    assert.deepEqual(await leadProof(db, organization.id, lead3), negativeBefore);
    check(true, 'foreign_stage_no_lead_audit_or_history_write');
    const wrongOwner = await move(broker, lead3, moveBody(negativeLead, stages.contacted));
    evidence.responses.wrongOwner = responseEvidence(wrongOwner);
    check([403, 404].includes(wrongOwner.status), 'broker_cannot_move_admin_owned_lead');
    assert.deepEqual(await leadProof(db, organization.id, lead3), negativeBefore);
    check(true, 'wrong_owner_no_lead_audit_or_history_write');
    const wrongTenant = await move(first, lead3, moveBody(negativeLead, stages.contacted), neighbor.id);
    evidence.responses.wrongTenant = responseEvidence(wrongTenant);
    check(wrongTenant.status === 403, 'token_b_with_organization_a_header_denied');
    assert.deepEqual(await leadProof(db, organization.id, lead3), negativeBefore);
    check(true, 'wrong_tenant_no_lead_audit_or_history_write');
    assert.deepEqual(await organizationSnapshot(db, neighbor), neighborBefore);
    check(true, 'organization_a_nine_tables_unchanged_during_all_negative_requests');
    evidence.neighborNegativeProof = neighborBefore;
    evidence.healthAfter = await assertHealthy();
    check(evidence.healthAfter.providerRequests === evidence.healthBefore.providerRequests, 'no_external_provider_requests');
    phase = 'preexisting_baseline';
    evidence.preexisting = await verifyPipelineBaseline(manifestFilename, fixtureFilename, baselineFilename);
    evidence.success = true;
    evidence.completedAt = new Date().toISOString();
  } catch (error) {
    failure = error;
    evidence.failure = { phase, errorName: ['AssertionError', 'TimeoutError', 'AbortError', 'TypeError'].includes(error?.name)
      ? error.name : 'Error', completedAt: new Date().toISOString() };
  } finally {
    for (const client of sessions) {
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        assert.equal(result.error, null, 'Synthetic local verification session sign-out failed.');
      } catch (error) {
        failure ||= error;
        evidence.cleanupFailed = true;
      }
    }
    try { if (db) await db.end(); } catch (error) {
      failure ||= error;
      evidence.cleanupFailed = true;
    }
    evidence.status = failure ? 'failed' : 'passed';
    evidence.success = !failure;
    try { await writeReceipt(receipt, evidence); } finally { await receipt.close(); }
  }
  if (failure) throw failure;
  return { success: true, checks: checks.length, evidence: output, mutationScope: evidence.mutationScope,
    preexistingNineTablesUnchanged: true, organizationANegativeRequestsUnchanged: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  smokePipelineLocalAPI(...process.argv.slice(2)).then(result => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch(error => {
      // These bounded classes omit SDK errors, SQL details, credentials and tokens.
      const code = typeof error?.code === 'string' && /^[A-Z0-9_]{1,48}$/.test(error.code) ? error.code : 'CHECK_FAILED';
      process.stderr.write(`Pipeline API smoke failed: phase=${phase} code=${code} passedChecks=${checks.length}\n`);
      process.exitCode = 1;
    });
}
