import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';

function fixture(mode = 'automatic') {
  const runtime = leadHookRuntime();
  const notices = [], effects = [], requests = [], update = deferred(); let response;
  const { request: operationScope, captureResource: resourceCapture } = runtime.distributionScope();
  const captureDistribution = evaluateProduction('const ' + productionDeclaration('components/features/leads/SdrDistributionButton.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'captureDistribution'), {
    requestScope: operationScope, captureLeadOperation: resourceCapture,
  }, 'captureDistribution');
  const name = mode === 'automatic' ? 'handleAutomaticDistribute' : 'handleManualAssign';
  const action = evaluateProduction('const ' + productionDeclaration('components/features/leads/SdrDistributionButton.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === name), {
    selectedPipelineId: 'pipeline-a', isProcessing: false, accessScope: { isAdmin: true }, allowedPipelineIds: null,
    availableUsers: [{ id: 'actor-a', name: 'Synthetic assignee' }], lead: { id: 'lead-a' }, stages: [{ id: 'stage-a', position: 1 }],
    selectedPipeline: { name: 'Synthetic pipeline' }, captureDistribution,
    updateLead: { mutateAsync: async () => update.promise },
    leadsAPI: { redistributeLeadRoundRobin: async (...args) => { requests.push(args); return response ? response.promise : { success: true }; } },
    toast: { success: message => notices.push(message), error: message => notices.push(message) },
    setIsProcessing: value => effects.push(['processing', value]), setOpen: value => effects.push(['open', value]),
    refetchStages: () => effects.push(['refetch']), getErrorMessage: error => error.message,
  }, name);
  return { runtime, requests, notices, effects, update, invoke: () => action('actor-a'), deferResponse: () => response = deferred() };
}

test('automatic SDR distribution never starts its second write after SID replacement during the first write', async () => {
  const f = fixture();
  try {
    const result = f.invoke(); await turn(); f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.runtime.scope();
    f.update.resolve({ id: 'lead-a' }); await result;
    assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []); assert.deepEqual(f.effects, [['processing', true]]);
  } finally { f.runtime.close(); }
});

test('automatic SDR distribution retains initiating identity across refresh and preserves successful behavior', async () => {
  const f = fixture();
  try {
    const result = f.invoke(); f.runtime.switchTo('org-a', 'actor-a', 'sid-a', 2); f.runtime.scope();
    f.update.resolve({ id: 'lead-a' }); await result;
    assert.equal(f.requests.length, 1); const args = f.requests[0]; assert.equal(args[1], 'org-a');
    assert.equal(args[3].expectedUserId, 'actor-a'); assert.equal(args[3].expectedSessionId, 'sid-a');
    assert.equal(args[3].signal.aborted, false); assert.equal(f.notices.length, 1);
    assert.deepEqual(f.effects, [['processing', true], ['open', false], ['refetch'], ['processing', false]]);
  } finally { f.runtime.close(); }
});

test('automatic SDR response after unmount cannot show assignee notices or close another view', async () => {
  const f = fixture();
  try {
    const pending = f.deferResponse(); const result = f.invoke(); f.update.resolve({ id: 'lead-a' }); await turn();
    assert.equal(f.requests.length, 1); f.runtime.unmount(); pending.resolve({ success: true }); await result;
    assert.equal(f.requests[0][3].signal.aborted, true); assert.deepEqual(f.notices, []);
    assert.deepEqual(f.effects, [['processing', true]]);
  } finally { f.runtime.close(); }
});

test('manual SDR response after unmount does not expose the selected assignee name', async () => {
  const f = fixture('manual');
  try {
    const result = f.invoke(); f.runtime.unmount(); f.update.resolve({ id: 'lead-a' }); await result;
    assert.deepEqual(f.notices, []); assert.deepEqual(f.effects, [['processing', true]]); assert.equal(f.requests.length, 0);
  } finally { f.runtime.close(); }
});
