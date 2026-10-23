import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { pipelineFixturePlan } from './pipeline-preview-seed.mjs';
import { connectVerifiedDatabase, readVerifiedManifest } from '../supabase/queue-local-homologation-target.mjs';

const OUTPUT_ROOT = 'D:/Vimob/outputs';
const FIXTURE_KIND = 'vimob-pipeline-preview-fixture-v1';
const BASELINE_KIND = 'vimob-pipeline-preview-preexisting-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Fixed identifiers only. Whole-row SHA-256 digests never expose row contents.
const TABLES = Object.freeze({
  organizations: 'id', users: 'id', leads: 'organization_id',
  pipelines: 'organization_id', stages: 'organization_id',
  organization_members: 'organization_id', activities: 'organization_id',
  audit_logs: 'organization_id', notifications: 'organization_id',
});

async function evidencePath(filename, mustExist = true) {
  assert.ok(filename && path.isAbsolute(filename), 'Use an absolute evidence path.');
  const root = await fs.realpath(OUTPUT_ROOT);
  const actual = mustExist ? await fs.realpath(filename)
    : path.join(await fs.realpath(path.dirname(filename)), path.basename(filename));
  const relative = path.relative(root, actual);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative),
    'Evidence must remain below the dedicated output root.');
  return actual;
}

async function readEvidence(filename) {
  const actual = await evidencePath(filename);
  const stat = await fs.stat(actual);
  assert.ok(stat.isFile() && stat.size < 1_048_576, 'Evidence must be a bounded JSON file.');
  return JSON.parse(await fs.readFile(actual, 'utf8'));
}

export async function readPipelineFixture(manifest, filename) {
  assert.equal(path.basename(filename), 'pipeline-synthetic-fixture.private.json');
  const fixture = await readEvidence(filename);
  assert.equal(fixture.kind, FIXTURE_KIND);
  assert.match(fixture.runId, UUID);
  assert.equal(fixture.stackRunId, manifest.runId);
  assert.equal(fixture.supabaseURL, manifest.supabaseURL);
  assert.equal(fixture.status, 'verified', 'Only a fully seeded and authenticated fixture may be verified.');
  const plan = pipelineFixturePlan(fixture.runId);
  assert.equal(fixture.organizations?.length, plan.length);
  const userIds = [];
  for (const [index, organization] of fixture.organizations.entries()) {
    const expected = plan[index];
    assert.equal(organization.id, expected.id);
    assert.equal(organization.pipelineId, expected.pipelineId);
    assert.deepEqual(organization.stages.map(stage => stage.id), expected.stages.map(stage => stage.id));
    assert.deepEqual(organization.leads.map(lead => lead.id), expected.leads.map(lead => lead.id));
    assert.deepEqual(Object.keys(organization.users).sort(), ['admin', 'broker']);
    for (const [role, user] of Object.entries(organization.users)) {
      assert.match(user.id, UUID);
      assert.equal(user.email, expected.users[role].email);
      userIds.push(user.id);
    }
  }
  assert.equal(new Set(userIds).size, 4);
  return {
    runId: fixture.runId,
    organizationIds: plan.map(organization => organization.id),
    pipelineIds: plan.map(organization => organization.pipelineId),
    stageIds: plan.flatMap(organization => organization.stages.map(stage => stage.id)),
    leadIds: plan.flatMap(organization => organization.leads.map(lead => lead.id)),
    userIds,
  };
}

async function snapshotTables(db, owned) {
  const result = {};
  for (const [table, scopeColumn] of Object.entries(TABLES)) {
    const ids = table === 'users' ? owned?.userIds : owned?.organizationIds;
    const ownLegacyActivities = table === 'activities' && owned;
    const filter = ids ? `where (${scopeColumn} is null or not (${scopeColumn}=any($1::uuid[])))
      ${ownLegacyActivities ? 'and not (organization_id is null and lead_id is not null and lead_id=any($2::uuid[]))' : ''}` : '';
    const parameters = ids ? ownLegacyActivities ? [ids, owned.leadIds] : [ids] : [];
    const rows = await db.query(`select to_jsonb(t)::text as row from public.${table} t
      ${filter} order by (to_jsonb(t)::text) collate "C"`, parameters);
    const hash = crypto.createHash('sha256');
    for (const { row } of rows.rows) {
      // Length-prefix each canonical JSON row to make boundaries unambiguous.
      hash.update(String(Buffer.byteLength(row))).update(':').update(row).update('\n');
    }
    result[table] = { count: rows.rowCount, sha256: hash.digest('hex') };
  }
  return result;
}

async function withVerifiedRead(manifestFilename, action) {
  const manifest = await readVerifiedManifest(manifestFilename);
  const db = await connectVerifiedDatabase(manifest);
  try {
    await db.query('begin isolation level repeatable read read only');
    const result = await action(db, manifest);
    await db.query('commit');
    return result;
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally { await db.end(); }
}

export async function capturePipelineBaseline(manifestFilename, outputDirectory) {
  const directory = await evidencePath(outputDirectory);
  assert.ok((await fs.stat(directory)).isDirectory());
  const filename = await evidencePath(path.join(directory, 'pipeline-preexisting-baseline.json'), false);
  return withVerifiedRead(manifestFilename, async (db, manifest) => {
    const baseline = {
      kind: BASELINE_KIND, stackRunId: manifest.runId, createdAt: new Date().toISOString(),
      scope: 'nine_named_public_tables_whole_rows', tables: await snapshotTables(db),
    };
    await fs.writeFile(filename, JSON.stringify(baseline, null, 2), { mode: 0o600, flag: 'wx' });
    return { baseline: filename, stackRunId: manifest.runId, tables: baseline.tables, readOnly: true };
  });
}

async function ownCounts(db, owned) {
  const result = {};
  for (const [table, column] of Object.entries(TABLES)) {
    const ids = table === 'users' ? owned.userIds : owned.organizationIds;
    const rows = await db.query(`select count(*)::int as count from public.${table}
      where ${column}=any($1::uuid[])`, [ids]);
    result[table] = rows.rows[0].count;
  }
  return result;
}

export async function verifyPipelineBaseline(manifestFilename, fixtureFilename, baselineFilename) {
  return withVerifiedRead(manifestFilename, async (db, manifest) => {
    const owned = await readPipelineFixture(manifest, fixtureFilename);
    const baseline = await readEvidence(baselineFilename);
    assert.equal(baseline.kind, BASELINE_KIND);
    assert.equal(baseline.stackRunId, manifest.runId);
    assert.deepEqual(Object.keys(baseline.tables).sort(), Object.keys(TABLES).sort());
    const beforeSeed = new Date(baseline.createdAt).getTime();
    assert.ok(Number.isFinite(beforeSeed) && beforeSeed <= Date.now());
    const current = await snapshotTables(db, owned);
    for (const table of Object.keys(TABLES)) {
      assert.deepEqual(current[table], baseline.tables[table], `Preexisting ${table} changed.`);
    }
    const counts = await ownCounts(db, owned);
    const unscoped = await db.query(`select id::text, lead_id::text, type,
      to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
      from public.activities where organization_id is null and lead_id=any($1::uuid[]) order by id`, [owned.leadIds]);
    for (const [table, expected] of Object.entries({
      organizations: 2, users: 4, leads: 12, pipelines: 2, stages: 10, organization_members: 4,
    })) assert.equal(counts[table], expected, `Unexpected owned ${table} count.`);
    return {
      runId: owned.runId, stackRunId: manifest.runId, preexistingRowsUnchanged: true,
      verifiedTables: current, ownedRows: counts, readOnly: true,
      ownedLegacyUnscopedActivities: { count: unscoped.rowCount, activities: unscoped.rows,
        finding: 'Existing local activity trigger omits organization_id. Attributed only by this fixture\'s deterministic lead IDs; trigger/schema were not changed.' },
      limitation: 'Only the nine named public tables are compared; owned null-organization activities are explicit above. This is not an all-schema write audit.',
    };
  });
}

export async function capturePipelineLeadProof(manifestFilename, fixtureFilename, selectedLeadId) {
  return withVerifiedRead(manifestFilename, async (db, manifest) => {
    const owned = await readPipelineFixture(manifest, fixtureFilename);
    const ids = selectedLeadId ? [selectedLeadId] : owned.leadIds;
    for (const id of ids) assert.ok(owned.leadIds.includes(id), 'Lead must belong to this exact synthetic fixture.');
    const result = await db.query(`select l.id::text as id, l.organization_id::text as organization_id,
      l.pipeline_id::text as pipeline_id, l.stage_id::text as stage_id, l.deal_status,
      to_char(l.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
      to_char(l.board_order_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as board_order_at,
      to_char(l.stage_entered_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as stage_entered_at,
      (select count(*)::int from public.audit_logs a
        where a.organization_id=l.organization_id and a.entity_id::text=l.id::text and a.entity_type='lead') as audit_count,
      (select count(*)::int from public.audit_logs a
        where a.organization_id=l.organization_id and a.entity_id::text=l.id::text and a.entity_type='lead'
          and a.action='move_stage') as move_audit_count,
      (select count(*)::int from public.audit_logs a
        where a.organization_id=l.organization_id and a.entity_id::text=l.id::text and a.entity_type='lead'
          and a.action='reorder_lead') as reorder_audit_count,
      (select count(*)::int from public.activities a
        where a.organization_id=l.organization_id and a.lead_id=l.id) as activity_count,
      (select count(*)::int from public.activities a
        where a.organization_id=l.organization_id and a.lead_id=l.id and a.type='stage_change') as stage_history_count,
      (select count(*)::int from public.activities a
        where a.organization_id=l.organization_id and a.lead_id=l.id and a.type='status_change') as status_history_count
      from public.leads l where l.organization_id=any($1::uuid[]) and l.id=any($2::uuid[])
      order by l.organization_id,l.id`, [owned.organizationIds, ids]);
    assert.equal(result.rowCount, ids.length, 'Every selected synthetic lead must exist.');
    for (const lead of result.rows) {
      assert.ok(owned.pipelineIds.includes(lead.pipeline_id), 'Lead left its owned pipelines.');
      assert.ok(owned.stageIds.includes(lead.stage_id), 'Lead left its owned stages.');
    }
    return { runId: owned.runId, stackRunId: manifest.runId, capturedAt: new Date().toISOString(),
      timestampPrecision: 'postgresql_microseconds', leads: result.rows, ownedRows: await ownCounts(db, owned), readOnly: true };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [command, manifestFilename, first, second] = process.argv.slice(2);
  const action = command === 'baseline' ? () => capturePipelineBaseline(manifestFilename, first)
    : command === 'verify' ? () => verifyPipelineBaseline(manifestFilename, first, second)
      : command === 'leads' ? () => capturePipelineLeadProof(manifestFilename, first, second)
        : async () => { throw new Error('Expected baseline, verify, or leads.'); };
  action().then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)).catch(() => {
    // Never print database/SDK assertion objects, connection strings or private fixtures.
    process.stderr.write('Pipeline local verification failed. Check target identity, fixture scope and evidence.\n');
    process.exitCode = 1;
  });
}
