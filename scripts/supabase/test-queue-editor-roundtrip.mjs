import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { assertQueueEditorResponse, assertQueueEditorListResponse } from './queue-editor-contract.mjs';
import { createFullSchemaContext, closeFullSchemaContext, requireStatus } from './queue-full-schema-support.mjs';

const output = path.join(RUNTIME_ROOT, 'editor-settings-null-roundtrip-report.json');
const report = { kind: 'vimob-queue-editor-settings-null-roundtrip-v1', attemptId: crypto.randomUUID(),
  startedAt: new Date().toISOString(), passed: false, phase: 'initializing', tests: [] };
const save = () => fs.writeFile(output, JSON.stringify(report, null, 2));
await save();
let context;
try {
  context = await createFullSchemaContext(process.argv[2], { authRoles: ['admin'] });
  Object.assign(report, { runId: context.manifest.runId, fullSchema: context.fullSchema,
    observations: context.observations, created: context.created, phase: 'running' });
  const org = context.fixture.organizations[0];
  for (const queueId of ['705934de-7e3f-4ada-878b-2b80cacd59d2', '00c38ee2-e8e4-472f-bfe4-a477e9c567e2']) {
    const stored = (await context.db.query('select settings from public.round_robins where organization_id=$1 and id=$2', [org.id, queueId])).rows[0].settings;
    const response = requireStatus(await context.request(org, 'admin', 'GET', `/v1/round-robins/${queueId}`), 200, 'real editor queue GET');
    const item = assertQueueEditorResponse(response);
    assert.deepEqual(item.settings.operating_schedule, stored.operating_schedule);
    report.tests.push({ name: 'existing queue calendar survives real GET and unchanged frontend schema', queueId, passed: true });
  }
  const list = requireStatus(await context.request(org, 'admin', 'GET', '/v1/round-robins'), 200, 'real editor queue LIST');
  assertQueueEditorListResponse(list);
  report.tests.push({ name: 'all local queue calendars pass unchanged frontend schemas', queues: list.data.length, passed: true });
  const closed = await context.createQueue(org, 'editor-null-roundtrip', { open: false });
  const createdResponse = requireStatus(await context.request(org, 'admin', 'GET', `/v1/round-robins/${closed.id}`), 200, 'new synthetic queue GET');
  const created = assertQueueEditorResponse(createdResponse);
  const original = structuredClone(created.settings.operating_schedule);
  assert.equal(original.days.filter(day => day.is_active).length, 0);
  for (const day of original.days) { assert.equal(day.start_time, null); assert.equal(day.end_time, null); }
  const updated = requireStatus(await context.request(org, 'admin', 'PATCH', `/v1/round-robins/${closed.id}`, {
    expectedRevision: created.revision, name: `${created.name} verificada`,
  }), 200, 'name-only edit preserving the existing settings').data;
  assertQueueEditorResponse({ data: updated });
  assert.deepEqual(updated.settings.operating_schedule, original);
  const persisted = (await context.db.query('select settings from public.round_robins where organization_id=$1 and id=$2', [org.id, closed.id])).rows[0].settings;
  assert.deepEqual(persisted.operating_schedule, original);
  report.tests.push({ name: 'closed calendar with explicit null clocks survives name-only PATCH and persisted readback', queueId: closed.id, passed: true });
  report.phase = 'verifying_cleanup'; await save();
} catch (error) {
  report.phase = 'failed'; report.error = { message: error.message, code: error.code }; process.exitCode = 1;
} finally {
  if (context) try { await closeFullSchemaContext(context); } catch (error) {
    report.phase = 'cleanup_failed'; report.cleanupError = error.message; process.exitCode = 1;
  }
}
if (report.phase === 'verifying_cleanup') { report.phase = 'completed'; report.passed = true; }
report.completedAt = new Date().toISOString(); await save();
console.log(JSON.stringify({ report: output, passed: report.passed, tests: report.tests.length, phase: report.phase, error: report.error }));
