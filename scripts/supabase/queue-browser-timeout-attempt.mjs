import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { snapshot } from './queue-full-schema-support.mjs';
import { inspectOwnedBrowserWorker } from './queue-browser-cleanup.mjs';

export function timeoutAttemptPath(attemptId) {
  assert.match(attemptId || '', /^[a-z0-9][a-z0-9-]{0,47}$/, 'Pass an explicit stable attempt ID containing only lowercase letters, digits and hyphens.');
  return path.join(RUNTIME_ROOT, `browser-timeout-attempt-${attemptId}.json`);
}

export async function writeExclusiveTimeoutIntent(filename, intent) {
  await fs.writeFile(filename, JSON.stringify(intent, null, 2), { flag: 'wx', mode: 0o600 });
}

export async function readTimeoutAttempt(context, attemptId) {
  const state = JSON.parse(await fs.readFile(timeoutAttemptPath(attemptId), 'utf8'));
  assert.equal(state.kind, 'vimob-queue-browser-timeout-attempt-v1');
  assert.equal(state.runId, context.manifest.runId);
  assert.equal(state.attemptId, attemptId);
  assert.equal(state.organizationId, context.fixture.organizations[0].id);
  return state;
}

export async function createTimeoutAttempt(context, scenario, attemptId) {
  const filename = timeoutAttemptPath(attemptId);
  const exists = await fs.access(filename).then(() => true, () => false);
  if (exists) {
    const previous = await readTimeoutAttempt(context, attemptId);
    assert.equal(previous.queueId, scenario.timeoutQueue.id);
    assert.equal(previous.status, 'CREATED', 'An earlier intent is unresolved. Inspect this attempt; automatic POST retry is blocked.');
    return previous;
  }
  const worker = await inspectOwnedBrowserWorker(context.manifest);
  assert.ok(worker, 'Start and attest the real production worker before reserving a new elapsed-time attempt.');
  const org = context.fixture.organizations[0];
  const intent = { kind: 'vimob-queue-browser-timeout-attempt-v1', runId: context.manifest.runId, organizationId: org.id,
    attemptId, intentId: crypto.randomUUID(), status: 'PENDING', creationRequestedAt: new Date().toISOString(),
    queueId: scenario.timeoutQueue.id, runtimeMode: 'production_worker', worker,
    previousAttempt: scenario.timeoutLeadId ? { leadId: scenario.timeoutLeadId, assignedAt: scenario.timeoutAssignedAt,
      dueAt: scenario.timeoutDueAt, status: 'INTERRUPTED', reason: 'The earlier QA fail-fast loop exited before its deadline. This separate attempt never reuses that lead or deadline.' } : undefined };
  // Exclusive creation is the concurrency barrier. Even ambiguous HTTP failure
  // leaves this intent pending, preventing a second automatic creation.
  await writeExclusiveTimeoutIntent(filename, intent);
  const lead = await context.createLead(org, scenario.timeoutQueue, `browser-worker-${attemptId}`);
  intent.timeoutLeadId = lead.id;
  intent.status = 'PENDING_CAPTURE';
  await fs.writeFile(filename, JSON.stringify(intent, null, 2), { mode: 0o600 });
  const current = await snapshot(context, org, lead);
  assert.ok(current.owner && current.runtime?.due_at);
  assert.equal(current.runtime.assignment_count, 0, 'Initial ownership must be captured before any redistribution; inspect the created lead if delayed.');
  Object.assign(intent, { status: 'CREATED', capturedAt: new Date().toISOString(), timeoutInitialOwner: current.owner,
    timeoutAssignedAt: current.runtime.assigned_at, timeoutDueAt: current.runtime.due_at,
    timeoutSeconds: (Date.parse(current.runtime.due_at) - Date.parse(current.runtime.assigned_at)) / 1000 });
  assert.equal(intent.timeoutSeconds, 60, 'The reserved elapsed-time scenario requires the actual configured one-minute deadline.');
  await fs.writeFile(filename, JSON.stringify(intent, null, 2), { mode: 0o600 });
  return intent;
}
