import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export function definition(source, marker, delimiter) {
  const start = source.indexOf(marker);
  const body = source.indexOf(delimiter, start);
  const end = source.indexOf(delimiter, body + delimiter.length);
  assert.ok(start >= 0 && body >= 0 && end >= 0, `Missing exact SQL prerequisite ${marker}`);
  return source.slice(start, end + delimiter.length) + ';';
}

export async function installProductionSubstrate(db, root) {
  const installed = [];
  const file = relative => readFile(path.join(root, relative), 'utf8');
  await db.query(await file('supabase/tests/production_distribution_hotfix.fixture.sql'));
  const unified = await file('supabase/migrations/20260728183851_unify_lead_distribution.sql');
  const forward = await file('supabase/migrations/20260729011728_forward_distribution_ticket_upgrade.sql');
  // Retain the production indexes used by historical selector reproduction;
  // extracting only function bodies otherwise creates an unrealistic scan.
  const baseline = await file('supabase/migrations/20260722000000_production_public_private_baseline.sql');
  installed.push(await installWorkerJobSchema(db, baseline));
  for (const line of baseline.split(/\r?\n/).filter(line => line.startsWith('CREATE INDEX ') &&
    (line.includes('ON "public"."round_robin_logs"') || line.includes('ON "public"."assignments_log"')))) {
    await db.query(line);
  }
  const notificationDedupeIndex = baseline.split(/\r?\n/).find(line =>
    line.startsWith('CREATE UNIQUE INDEX "notifications_unique_dedupe_key" '));
  assert.ok(notificationDedupeIndex, 'Production notification dedupe index must remain part of the fixture');
  await db.query(notificationDedupeIndex);
  installed.push({ provenance: '20260722000000', marker: 'notifications_unique_dedupe_key',
    sha256: createHash('sha256').update(notificationDedupeIndex).digest('hex') });
  for (const [source, marker, delimiter, provenance] of [
    [unified, 'create or replace function private.round_robin_ticket_sequence_name(', '$$', '20260728183851'],
    [unified, 'create or replace function private.next_round_robin_ticket(', '$$', '20260728183851'],
    [unified, 'create or replace function private.normalize_lead_distribution_source(', '$$', '20260728183851'],
    [forward, 'create or replace function private.distribute_lead(', '$body$', '20260729011728'],
    [unified, 'create or replace function public.distribute_lead_from_backend(', '$$', '20260728183851'],
  ]) {
    const sql = definition(source, marker, delimiter);
    await db.query(sql);
    installed.push({ marker, provenance, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  for (const filename of [
    '20260729021500_remove_ticket_sequence_runtime_acl_ddl.sql',
    '20260922120632_keep_direct_queue_members_outside_team_schedules.sql',
  ]) {
    // The picker migration asserts its predecessor exists. Install the exact
    // predecessor once, then execute the complete production migration.
    if (filename.includes('keep_direct')) {
      await db.query(definition(unified, 'create or replace function private.pick_round_robin_ticket_candidate(', '$$'));
    }
    const sql = await file(`supabase/migrations/${filename}`);
    await db.query(sql);
    installed.push({ filename, sha256: createHash('sha256').update(sql).digest('hex') });
  }
  // This guarded migration accepts the historical helper or its ACL-only
  // predecessor and installs the same warm/cold ticket path used in rollout.
  const sequenceUpgrade = '20261015193322_guard_lead_distribution_ticket_sequence_acl_hotpath.sql';
  const sequenceSQL = await file(`supabase/migrations/${sequenceUpgrade}`);
  await db.query(sequenceSQL);
  installed.push({ filename: sequenceUpgrade, sha256: createHash('sha256').update(sequenceSQL).digest('hex') });
  const pool = await file('supabase/migrations/20260908034600_harden_edge_reentry_and_pool_redistribution.sql');
  const poolSQL = definition(pool, 'create or replace function public.redistribute_lead_from_pool_backend(', '$$');
  await db.query(poolSQL);
  installed.push({ marker: 'public.redistribute_lead_from_pool_backend', provenance: '20260908034600',
    sha256: createHash('sha256').update(poolSQL).digest('hex') });
  // Rule matching is outside these explicit-queue tests. Keep it an explicit
  // fail-closed stub, never silently substitute a queue-matching algorithm.
  await db.query(`create function public.pick_round_robin_for_lead(uuid) returns uuid language sql stable as $$select null::uuid$$`);
  // Extraction of definitions alone leaves PostgreSQL's default PUBLIC EXECUTE.
  // Preserve the exact backend-only predecessor boundaries as well.
  await db.query(`
    revoke all on function private.round_robin_ticket_sequence_name(uuid) from public,anon,authenticated,service_role;
    revoke all on function private.next_round_robin_ticket(uuid) from public,anon,authenticated,service_role;
    revoke all on function private.normalize_lead_distribution_source(text) from public,anon,authenticated,service_role;
    revoke all on function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated;
    grant execute on function private.distribute_lead(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
    revoke all on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) from public,anon,authenticated;
    grant execute on function public.distribute_lead_from_backend(uuid,uuid,text,uuid,boolean,text,timestamptz) to service_role;
    revoke all on function public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,integer,timestamptz) from public,anon,authenticated;
    grant execute on function public.redistribute_lead_from_pool_backend(uuid,uuid,text,uuid,uuid,timestamptz,integer,timestamptz) to service_role;
  `);
  installed.push({ provenance: '20260728183851 + 20260908034600',
    boundary: 'Original backend-only EXECUTE ACLs retained alongside extracted definitions' });
  return installed;
}

// Preflight inspects the existing production job table before either hotfix.
// Install only its real schema/security here; enrollment stays in the separate
// worker substrate so SQL rotation cases do not acquire incidental jobs.
async function installWorkerJobSchema(db, source) {
  const marker = 'CREATE TABLE IF NOT EXISTS "public"."lead_redistribution_jobs" (';
  const start = source.indexOf(marker), end = source.indexOf('\n);', start);
  assert.ok(start >= 0 && end > start);
  const sql = source.slice(start, end + 3);
  await db.query(sql);
  const primaryKey = source.match(/ALTER TABLE ONLY "public"\."lead_redistribution_jobs"\s+ADD CONSTRAINT "lead_redistribution_jobs_pkey" PRIMARY KEY \("id"\);/)?.[0];
  assert.ok(primaryKey); await db.query(primaryKey);
  const prefixes = [
    'CREATE UNIQUE INDEX "idx_lead_redistribution_jobs_one_active" ',
    'CREATE POLICY "backend manages lead redistribution jobs" ',
    'ALTER TABLE "public"."lead_redistribution_jobs" ENABLE ROW LEVEL SECURITY;',
    'GRANT ALL ON TABLE "public"."lead_redistribution_jobs" TO "service_role";',
  ];
  for (const prefix of prefixes) {
    const statement = source.split(/\r?\n/).find(line => line.startsWith(prefix));
    assert.ok(statement, `Missing literal production job prerequisite ${prefix}`);
    await db.query(statement);
  }
  return { provenance: '20260722000000', marker: 'lead_redistribution_jobs real schema, RLS, ACL, primary key and active uniqueness',
    sha256: createHash('sha256').update(sql).digest('hex') };
}

export async function reproduceProductionSelectors(db, root) {
  const run = promisify(execFile), base = 'ef1cefca6faa59a78fd2aecbbecbf31ed1030c4b';
  const readBase = async file => (await run('git', ['show', `${base}:${file}`], { cwd: root, maxBuffer: 4 * 1024 * 1024 })).stdout;
  const availabilitySource = await readBase('apps/api/internal/distribution/availability.go');
  const availability = availabilitySource.split('const RoundRobinAvailabilityPredicateSQL = `')[1].split('`')[0];
  const results = [];
  for (const [file, method, automatic] of [
    ['apps/api/internal/leads/redistribution_worker.go', 'selectRoundRobinMemberForRedistribution(', true],
    ['apps/api/internal/leads/repository.go', 'selectRoundRobinMember(', false],
  ]) {
    const source = await readBase(file);
    const methodStart = source.indexOf(`func (repo Repository) ${method}`);
    assert.ok(methodStart >= 0, `Original selector absent ${method}`);
    const start = source.indexOf('with entries as (', methodStart);
    const end = source.indexOf('\n\t`, organizationID, roundRobinID', start);
    assert.ok(start > methodStart && end > start);
    let sql = source.slice(start, end);
    sql = automatic ? sql.replace('`+strings.ReplaceAll(distribution.RoundRobinAvailabilityPredicateSQL, "\'America/Sao_Paulo\'", "candidates.timezone")+`',
      availability.replaceAll("'America/Sao_Paulo'", 'candidates.timezone')) :
      sql.replace('`+distribution.RoundRobinAvailabilityPredicateSQL+`', availability);
    assert.ok(!sql.includes('`'), 'Unexpanded Go SQL fragment');
    const q = await makeQueue(db), totals = [25, 311, 692, 693, 694];
    for (let n = 0; n < totals.length; n++) await db.query(`insert into public.round_robin_logs
      (organization_id,round_robin_id,assigned_user_id,member_id,reason,metadata)
      select $1,$2,$3,$4,'historical_baseline',jsonb_build_object('member_id',$4::uuid::text) from generate_series(1,$5::int)`,
    [q.org, q.queue, q.users[n], q.members[n], totals[n]]);
    await db.query('analyze');
    let current = q.users[0];
    const recipients = [];
    for (let n = 0; n < 10; n++) {
      const parameters = automatic ? [q.org, q.queue, current, ''] : [q.org, q.queue, ''];
      const { rows: [selection] } = await db.query(sql, parameters);
      assert.ok(selection?.user_id);
      recipients.push(q.users.indexOf(selection.user_id));
      current = selection.user_id;
      await db.query(`insert into public.round_robin_logs(organization_id,round_robin_id,assigned_user_id,member_id,reason)
        values($1,$2,$3,$4,'baseline_confirmed')`, [q.org, q.queue, current, selection.id]);
    }
    assert.deepEqual(recipients, automatic ? [1, 0, 1, 0, 1, 0, 1, 0, 1, 0] : Array(10).fill(0));
    results.push({ file, method, originalCommit: base, accumulatedEvents: totals, recipientsByIndex: recipients,
      sqlSha256: createHash('sha256').update(sql).digest('hex'), realPostgresExecution: true });
  }
  return results;
}

export async function makeQueue(db, options = {}) {
  const org = randomUUID(), queue = randomUUID(), pipeline = randomUUID(), stage = randomUUID();
  const users = Array.from({ length: options.count ?? 5 }, () => randomUUID());
  const members = users.map(() => randomUUID());
  await db.query('insert into public.organizations(id) values($1)', [org]);
  await db.query(`insert into public.pipelines(id,organization_id) values($1,$2)`, [pipeline, org]);
  await db.query(`insert into public.stages(id,organization_id,pipeline_id,position) values($1,$2,$3,0)`, [stage, org, pipeline]);
  await db.query(`insert into public.round_robins(id,organization_id,strategy,settings,target_pipeline_id,target_stage_id)
    values($1,$2,$3,$4,$5,$6)`, [queue, org, options.weighted ? 'weighted' : 'simple',
    { timezone: 'UTC', enable_redistribution: true }, pipeline, stage]);
  for (let n = 0; n < users.length; n++) {
    await db.query('insert into public.users(id,organization_id,name) values($1,$2,$3)', [users[n], org, `Synthetic ${n + 1}`]);
    await db.query('insert into public.organization_members(organization_id,user_id) values($1,$2)', [org, users[n]]);
    await db.query(`insert into public.round_robin_members(id,organization_id,round_robin_id,user_id,position,weight)
      values($1,$2,$3,$4,$5,$6)`, [members[n], org, queue, users[n], n, n === 0 && options.weighted ? 4 : 1]);
  }
  // Actual production create-queue path eagerly creates its sequence. Tests
  // isolate rotation from unrelated missing-sequence bootstrap behavior.
  await db.query('select private.ensure_round_robin_ticket_sequence($1)', [queue]);
  return { org, queue, pipeline, stage, users, members };
}

export async function makeLead(db, q, owner = null, assignedAt = '2026-01-01T00:00:00Z') {
  const id = randomUUID();
  await db.query(`insert into public.leads(id,organization_id,origin_round_robin_id,pipeline_id,stage_id,assigned_user_id,assigned_at)
    values($1,$2,$3,$4,$5,$6,$7)`, [id, q.org, q.queue, q.pipeline, q.stage, owner, owner ? assignedAt : null]);
  if (owner) await db.query(`insert into public.assignments_log(organization_id,lead_id,round_robin_id,assigned_user_id,
    reason,assigned_at) values($1,$2,$3,$4,'canonical_round_robin',$5)`, [q.org, id, q.queue, owner, assignedAt]);
  return id;
}

export const canonical = async (db, q, lead, key = randomUUID(), preserve = false, now = new Date().toISOString()) =>
  (await db.query(`select private.distribute_lead($1,$2,$3,$4,$5,'test-hotfix',$6) result`,
    [q.org, lead, key, q.queue, preserve, now])).rows[0].result;

export const preview = async (db, q, lead, excluded = null, team = null) =>
  (await db.query(`select * from private.preview_round_robin_redistribution_candidate($1,$2,$3,$4,$5,$6)`,
    [q.org, lead, q.queue, excluded, team, new Date().toISOString()])).rows[0];

export const poolRedistribute = async (db, q, lead, key = randomUUID(), now = new Date().toISOString()) => {
  const { rows: [owner] } = await db.query('select assigned_user_id,assigned_at,redistribution_count from public.leads where id=$1', [lead]);
  return (await db.query(`select public.redistribute_lead_from_pool_backend($1,$2,$3,$4,$5,$6,$7,$8) result`,
    [q.org, lead, key, q.queue, owner.assigned_user_id, owner.assigned_at, owner.redistribution_count, now])).rows[0].result;
};

export async function observeWait(db, pids, report, action) {
  const deadline = Date.now() + 4500;
  while (Date.now() < deadline) {
    const { rows } = await db.query(`select pid,wait_event_type,wait_event from pg_stat_activity
      where pid=any($1::int[]) and wait_event_type='Lock'`, [pids]);
    if (rows.length) { report.lockWaits.push({ action, observedAt: new Date().toISOString(), rows }); return; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`Real PostgreSQL lock wait not observed: ${action}`);
}
