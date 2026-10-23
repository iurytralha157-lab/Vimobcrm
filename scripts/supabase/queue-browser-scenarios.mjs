import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchQueueLocalHomologation } from './launch-queue-local-homologation.mjs';
import { RUNTIME_ROOT } from './queue-local-homologation-target.mjs';
import { closeBrowserSchemaContext, createFullSchemaContext, requireStatus, snapshot } from './queue-full-schema-support.mjs';
import { createTimeoutAttempt, readTimeoutAttempt } from './queue-browser-timeout-attempt.mjs';

export async function browserScenario(command, filename, attemptId) {
  assert.ok(['prepare', 'create-timeout', 'create-timeout-attempt', 'snapshot', 'snapshot-timeout-attempt', 'runtime-loop', 'runtime-once', 'global-cleanup'].includes(command));
  if (command === 'runtime-loop') {
    // Starting continuous time is a separate explicit CLI command. Preparing
    // or inspecting browser fixtures never starts this process implicitly.
    assert.equal(await fs.access(path.join(RUNTIME_ROOT, 'runtime-process.json')).then(() => true, () => false), false,
      'An earlier runtime record exists; verify that process before starting another.');
    return launchQueueLocalHomologation('runtime', filename);
  }
  const context = await createFullSchemaContext(filename, { authRoles: ['admin'] });
  const output = path.join(RUNTIME_ROOT, 'browser-scenarios.json');
  const org = context.fixture.organizations[0];
  try {
    let state = await fs.readFile(output, 'utf8').then(JSON.parse, error => { if (error.code === 'ENOENT') return null; throw error; });
    if (state) {
      assert.equal(state.kind, 'vimob-queue-browser-scenarios-v1');
      assert.equal(state.runId, context.manifest.runId);
      assert.equal(state.organizationId, org.id);
    }
    if (command === 'prepare' && !state) {
      const timeoutQueue = await context.createQueue(org, 'browser-real-timeout', { timeout: true });
      const reopeningQueue = await context.createQueue(org, 'browser-close-reopen', { open: false, timeout: true });
      const claimable = await context.createLead(org, reopeningQueue, 'browser-pool-claim');
      const backlog = await context.createLead(org, reopeningQueue, 'browser-pool-backlog');
      state = { kind: 'vimob-queue-browser-scenarios-v1', runId: context.manifest.runId, organizationId: org.id,
        preparedAt: new Date().toISOString(), timeoutQueue, reopeningQueue, pooledLeads: { claimable: claimable.id, backlog: backlog.id },
        automaticTimeoutLeadCreated: false, runtimeStartedByPrepare: false };
      await fs.writeFile(output, JSON.stringify(state, null, 2), { mode: 0o600 });
    }
    assert.ok(state, 'Run prepare before using browser scenarios.');
    if (command === 'create-timeout-attempt') return await createTimeoutAttempt(context, state, attemptId);
    if (command === 'snapshot-timeout-attempt') {
      const attempt = await readTimeoutAttempt(context, attemptId);
      assert.ok(attempt.timeoutLeadId, 'The reserved attempt has not returned a lead ID; inspect before retrying.');
      const shown = requireStatus(await context.request(org, 'admin', 'GET', `/v1/leads/${attempt.timeoutLeadId}`), 200, 'browser attempt API read').data;
      const current = { runId: state.runId, attemptId, observedAt: new Date().toISOString(), attempt,
        api: shown, runtime: await snapshot(context, org, { id: attempt.timeoutLeadId }) };
      await fs.writeFile(path.join(RUNTIME_ROOT, `browser-timeout-attempt-${attemptId}-snapshot.json`), JSON.stringify(current, null, 2));
      return current;
    }
    if (command === 'create-timeout' && !state.timeoutLeadId) {
      assert.equal(state.timeoutCreationRequestedAt, undefined,
        'An earlier timer creation has an unresolved outcome. Inspect this queue before retrying; automatic duplicate creation is blocked.');
      state.timeoutCreationRequestedAt = new Date().toISOString();
      await fs.writeFile(output, JSON.stringify(state, null, 2), { mode: 0o600 });
      const lead = await context.createLead(org, state.timeoutQueue, 'browser-real-60-second-timeout');
      const current = await snapshot(context, org, lead);
      assert.ok(current.owner && current.runtime?.due_at);
      state.timeoutLeadId = lead.id;
      state.automaticTimeoutLeadCreated = true;
      state.timeoutCreatedAt = new Date().toISOString();
      state.timeoutInitialOwner = current.owner;
      state.timeoutAssignedAt = current.runtime.assigned_at;
      state.timeoutDueAt = current.runtime.due_at;
      await fs.writeFile(output, JSON.stringify(state, null, 2), { mode: 0o600 });
    }
    if (command === 'runtime-once') await context.runtimeOnce();
    if (command === 'snapshot') {
      const leads = [];
      for (const id of [state.timeoutLeadId, ...Object.values(state.pooledLeads)].filter(Boolean)) {
        const shown = requireStatus(await context.request(org, 'admin', 'GET', `/v1/leads/${id}`), 200, 'browser fixture API read').data;
        leads.push({ id, api: shown, runtime: await snapshot(context, org, { id }) });
      }
      const current = { runId: state.runId, observedAt: new Date().toISOString(), leads };
      await fs.writeFile(path.join(RUNTIME_ROOT, 'browser-scenarios-snapshot.json'), JSON.stringify(current, null, 2));
      return current;
    }
    return { fixture: output, ...state };
  } finally {
    const cleanup = await closeBrowserSchemaContext(context, command);
    if (cleanup.finalGlobalDrainRequired) console.error(`Browser global cleanup DEFERRED; stop the attested owned worker and run global-cleanup. Evidence: ${cleanup.report}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  browserScenario(process.argv[2], process.argv[3], process.argv[4]).then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(`Guarded browser fixture failed: ${error.message}`); process.exitCode = 1;
  });
}
