import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { getPipelineBoardOrderAtForIndex } from '../../../../lib/pipeline-board-order.ts';
import { evaluateProduction, productionDeclaration } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';

test('the production drop handler refuses a one-microsecond gap before any optimistic state or request', async () => {
  const source = productionDeclaration('components/features/pipelines/PipelinesScreen.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'executeLeadMove');
  const leadProgressCapability = evaluateProduction(
    productionDeclaration('lib/lead-operation-capability.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'leadProgressCapability'),
    {}, 'leadProgressCapability',
  );
  const moved = { id: 'lead-moved', can_operate: true, deal_status: 'open' };
  const stages = [{ id: 'from', leads: [moved] }, { id: 'to', leads: [
    { id: 'above', board_order_at: '2026-10-16T12:00:00.001800Z' },
    { id: 'below', board_order_at: '2026-10-16T12:00:00.001799Z' },
  ] }];
  const invalidations = [], warnings = [], writes = [];
  const key = ['stages-with-leads', 'org-a', 'pipeline-a'];
  const drag = { current: false };
  const dependencies = {
    moveContract: { getCurrent: () => ({ contract: 'revision-v1' }) },
    useCallback: fn => fn, stages, stagesWithLeads: stages, stageAutomations: [], filterDealStatus: 'all',
    pipelineBoardQueryKey: key, pipelineBoardQueryKeyId: 'key', canOperateLeads: true, isMobile: false,
    realtimeOrganizationId: 'org-a', isDraggingRef: drag, leadProgressCapability,
    getOptimisticDealStatusForStage: () => null, getOptimisticAutomationDealStatusForStage: () => null,
    getOptimisticPipelineMoveOutcome: () => 'open', getPipelineBoardOrderAtForIndex,
    queryClient: { getQueryData: () => stages, invalidateQueries: (...args) => { invalidations.push(args); return Promise.resolve(); }, setQueryData: (...args) => writes.push(args) },
    enqueueLeadMovePersistence: (...args) => writes.push(args),
    toast: { warning: value => warnings.push(value) },
  };
  const handler = evaluateProduction(`const ${source}`, dependencies, 'executeLeadMove');
  const result = await handler({ draggableId: moved.id, source: { droppableId: 'from', index: 0 }, destination: { droppableId: 'to', index: 1 } },
    { lead: moved, revision: { leadId: moved.id, sourceStageId: 'from' }, queryKeyId: 'key', operation: { isCurrent: () => true } });
  assert.equal(result, undefined); assert.equal(drag.current, false);
  assert.deepEqual(writes, []); assert.equal(invalidations.length, 1);
  assert.deepEqual(invalidations[0][0], { queryKey: key, exact: true });
  assert.match(warnings[0], /posição não foi confirmada/);
});

test('the production page API forwards a captured actor/session and the snapshot abort signal', async () => {
  const source = productionDeclaration('lib/api/pipeline-board.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'getPipelineStageLeads');
  const calls = [];
  const request = evaluateProduction(source, {
    vimobAPIRequest: async (...args) => { calls.push(args); return { stageId: 'stage-a', leads: [] }; },
    buildPipelineBoardQuery: () => ({ stageId: 'stage-a' }), PIPELINE_READ_TIMEOUT_MS: 12000,
    validateDomainResponse() {}, pipelineStageLeadsResponseSchema: {}, normalizeQueuePoolLead: value => value,
  }, 'getPipelineStageLeads');
  const access = new AbortController(), snapshot = new AbortController();
  await request({ organizationId: 'org-a', pipelineId: 'pipeline-a', stageId: 'stage-a', offset: 12,
    intent: { expectedUserId: 'actor-a', expectedSessionId: 'sid-a', signal: access.signal }, signal: snapshot.signal });
  assert.equal(calls[0][1].organizationId, 'org-a'); assert.equal(calls[0][1].expectedUserId, 'actor-a');
  assert.equal(calls[0][1].expectedSessionId, 'sid-a'); assert.equal(calls[0][1].signal, snapshot.signal);
  assert.equal(calls[0][1].retry, false);
});
