import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { assertInvariants, closeFullSchemaContext, createFullSchemaContext, requireStatus } from './queue-full-schema-support.mjs';
import { runFullSchemaCases } from './queue-full-schema-cases.mjs';
import { runFullSchemaRaces } from './queue-full-schema-races.mjs';

export async function runFullSchemaAPI(filename) {
  const output = path.join(RUNTIME_ROOT, 'full-schema-api-report.json');
  const report = { kind: 'vimob-queue-full-schema-api-report-v1', attemptId: crypto.randomUUID(), runId: null,
    startedAt: new Date().toISOString(), phase: 'initializing', passed: false, tests: [],
    limitations: ['Automated deadline cases advance only synthetic due_at/next_action_at; real elapsed 60-second timeout is a separate browser scenario.',
      'Automatic runtime changes are checked through API refresh; cross-process realtime SSE is not enabled by this harness.',
      'Race hooks only pause after real production ownership guards; no production SQL function or RLS policy is substituted.',
      'Claim HTTP replay must preserve ownership ledgers, notifications and the original single assignment invalidation.',
      'This full-schema run validates the current forward migrations. A separate full-schema baseline records behavior before the three concurrency and permission fixes.'] };
  const save = () => fs.writeFile(output, JSON.stringify(report, null, 2), { mode: 0o600 });
  // Invalidate any older PASS before schema loading, login or readiness can
  // fail. Every invocation owns a new attempt even for the same cluster runId.
  await save();
  let context;
  const test = async (name, operation) => {
    const started = Date.now();
    try { await operation(); report.tests.push({ name, passed: true, elapsedMilliseconds: Date.now() - started }); }
    catch (error) { report.tests.push({ name, passed: false, elapsedMilliseconds: Date.now() - started, error: error.message, sqlstate: error.code }); }
    await save();
  };
  try {
    context = await createFullSchemaContext(filename);
    Object.assign(report, { runId: context.manifest.runId, phase: 'schema_and_auth_verified', environment: 'disposable_loopback_full_supabase',
      fullSchema: context.fullSchema, realGoHTTP: true, realGoTrueSessions: context.tokens.size, noPartialSQLFixture: true,
      originalMigrationChainReplayPassed: false, productionUntouched: true, observations: context.observations, created: context.created });
    await save();
    const org = context.fixture.organizations[0];
    requireStatus(await context.request(org, 'admin', 'GET', '/readyz'), 200, 'real Go API readiness');
    report.phase = 'running_cases';
    await save();
    await runFullSchemaCases(context, test);
    await runFullSchemaRaces(context, test);
    await test('final durable queue invariants in both synthetic tenants', async () => { report.invariants = await assertInvariants(context); });
    const casesPassed = report.tests.every(result => result.passed);
    report.phase = 'verifying_cleanup';
    await save();
    assert.ok(casesPassed, `${report.tests.filter(result => !result.passed).length} full-schema cases failed; inspect the local report.`);
  } catch (error) {
    report.passed = false;
    report.failedPhase = report.phase;
    report.phase = 'failed';
    report.completedAt = new Date().toISOString();
    report.fatalError = { message: error.message, code: error.code };
    await save();
    throw error;
  } finally {
    if (context) {
      try { await closeFullSchemaContext(context); await save(); }
      catch (error) {
        report.passed = false;
        report.phase = 'cleanup_failed';
        report.completedAt = new Date().toISOString();
        report.cleanupError = { message: error.message, code: error.code };
        await save();
        throw error;
      }
    }
  }
  report.passed = true;
  report.phase = 'completed';
  report.completedAt = new Date().toISOString();
  await save();
  return { report: output, tests: report.tests.length, passed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runFullSchemaAPI(process.argv[2]).then(result => process.stdout.write(`${JSON.stringify(result)}\n`)).catch(error => {
    process.stderr.write(`Full-schema local API homologation failed: ${error.message}\n`); process.exitCode = 1;
  });
}
