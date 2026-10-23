import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { closeFullSchemaContext, createFullSchemaContext, requireStatus, snapshot } from './queue-full-schema-support.mjs';
import { runFullSchemaRaces } from './queue-full-schema-races.mjs';

export async function runBeforeFixes(filename) {
  // The exception for exactly three pending queue candidates exists only in
  // this named baseline runner. The final runner never sets this option.
  const output = path.join(RUNTIME_ROOT, 'full-schema-before-fixes.json');
  const report = { kind: 'vimob-queue-full-schema-before-fixes-v1', attemptId: crypto.randomUUID(), runId: null,
    startedAt: new Date().toISOString(), phase: 'initializing', baselinePermissionReproduced: false, tests: [] };
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  await save();
  let context;
  const test = async (name, operation) => {
    const started = Date.now();
    try { await operation(); report.tests.push({ name, passed: true, elapsedMilliseconds: Date.now() - started }); }
    catch (error) { report.tests.push({ name, passed: false, elapsedMilliseconds: Date.now() - started, error: error.message, sqlstate: error.code }); }
    await save();
  };
  try {
    context = await createFullSchemaContext(filename, { baseline: true });
    Object.assign(report, { runId: context.manifest.runId, phase: 'schema_and_auth_verified', fullSchema: context.fullSchema,
      originalMigrationChainReplayPassed: false, queueCandidatesApplied: false, realGoHTTP: true, realGoTrueSessions: context.tokens.size,
      noPartialSQLFixture: true, observations: context.observations, created: context.created });
    await save();
    const org = context.fixture.organizations[0];
    requireStatus(await context.request(org, 'admin', 'GET', '/readyz'), 200, 'real Go API readiness');
    report.phase = 'running_cases';
    await save();
    await test('baseline broker without explicit roles sees canClaim=false and its real HTTP claim is forbidden', async () => {
      const broker = org.users.broker1;
      const roles = (await context.db.query(`select
        (select count(*)::int from public.user_organization_roles where user_id=$1) assigned_roles,
        (select count(*)::int from public.user_permission_overrides where organization_id=$2 and user_id=$1) permission_overrides`, [broker.id, org.id])).rows[0];
      assert.deepEqual(roles, { assigned_roles: 0, permission_overrides: 0 });
      const queue = await context.createQueue(org, 'baseline-broker-permission', { open: false });
      const lead = await context.createLead(org, queue, 'baseline-broker-pool');
      const before = await snapshot(context, org, lead);
      const shown = requireStatus(await context.request(org, 'broker1', 'GET', `/v1/leads/${lead.id}`), 200, 'baseline private pool read').data;
      assert.equal(shown.queuePool?.canClaim, false);
      const claimed = await context.request(org, 'broker1', 'POST', `/v1/leads/${lead.id}/claim-queue-pool`, {
        roundRobinId: queue.id, episodeId: before.runtime.episode_id, expectedRevision: Number(before.runtime.revision),
      }, { 'Idempotency-Key': crypto.randomUUID() });
      assert.ok([403, 404].includes(claimed.status), `Baseline broker claim unexpectedly returned HTTP ${claimed.status}`);
      assert.deepEqual(await snapshot(context, org, lead), before);
      report.brokerPermission = { userId: broker.id, leadId: lead.id, assignedRoles: roles.assigned_roles, permissionOverrides: roles.permission_overrides,
        getStatus: 200, canClaim: shown.queuePool.canClaim, claimStatus: claimed.status, claimErrorCode: claimed.body?.error?.code || claimed.body?.code,
        ownershipUnchanged: true };
    });
    await runFullSchemaRaces(context, test);
    report.completedAt = new Date().toISOString();
    report.phase = 'completed';
    report.baselinePermissionReproduced = Boolean(report.brokerPermission);
    report.racesPassing = report.tests.slice(1).filter(result => result.passed).length;
    report.racesFailing = report.tests.slice(1).filter(result => !result.passed).length;
    report.interpretation = 'Before-fix evidence; failing safety races are findings, not waived gates. Existing full-schema triggers may already serialize some races. No candidate fix was applied by this runner.';
    await save();
    return { report: output, baselinePermissionReproduced: report.baselinePermissionReproduced, racesPassing: report.racesPassing, racesFailing: report.racesFailing };
  } catch (error) {
    report.failedPhase = report.phase;
    report.phase = 'failed';
    report.completedAt = new Date().toISOString();
    report.fatalError = { message: error.message, code: error.code };
    await save();
    throw error;
  } finally {
    if (context) {
      try { await closeFullSchemaContext(context); }
      catch (error) {
        report.phase = 'cleanup_failed';
        report.completedAt = new Date().toISOString();
        report.cleanupError = { message: error.message, code: error.code };
        await save();
        throw error;
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runBeforeFixes(process.argv[2]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`Full-schema baseline failed: ${error.message}\n`); process.exitCode = 1;
  });
}
