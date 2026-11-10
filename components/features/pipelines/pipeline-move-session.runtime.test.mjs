import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryObserver } from '@tanstack/react-query';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { applyPendingPipelineMoves, clearPendingPipelineMove, findPipelineLeadLocation, registerPendingPipelineMove, restorePipelineLeadSnapshot } from '../../../lib/pipeline-board-cache.ts';
import { getOptimisticPipelineMoveOutcome } from '../../../lib/pipeline-stage-outcome.ts';
import { getLeadStatusFinancialReviewMessage } from '../../../lib/lead-financial-review.ts';
import { createPipelineStageSnapshot } from '../../../lib/pipeline-stage-snapshot.ts';
import { getPipelineBoardOrderAtForIndex } from '../../../lib/pipeline-board-order.ts';
import { capturePipelineMoveRevision, resolvePipelineMoveRevision, PipelineMoveRevisionConflict } from '../../../lib/pipeline-move-revision.ts';
import { VimobAPIError } from '../../../lib/api/vimob-error.ts';
import { shouldApplyVisualPendingMove } from './pipeline-screen/pending-moves.ts';
import { getOptimisticDealStatusForStage, getOptimisticAutomationDealStatusForStage, getVisualPendingMoveKey, isPipelineDealStatus, isUnsafePartialStageDrop, mergeMovedLeadResponse, shouldKeepLeadForDealStatusFilter } from './pipeline-screen/model.ts';

const leadProgressCapability = evaluateProduction(
  productionDeclaration('lib/lead-operation-capability.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'leadProgressCapability'),
  {}, 'leadProgressCapability',
);

function fixture({ holdFirst = true, serverCAS = false, destinationLost = false, fromStatus = 'open', savedStatus = fromStatus, financialReviewRequired = false, capabilities = {} } = {}) {
  const runtime = leadHookRuntime(), requests = [], events = [], notices = [], pendingFirst = deferred();
  const scope = runtime.scope(), queryClient = runtime.client();
  const queryKey = ['stages-with-leads', 'org-a', 'pipeline-a'];
  const lead = { id: 'lead-a', stage_id: 'stage-a', assigned_user_id: 'actor-a', can_operate: true, deal_status: fromStatus, tags: [], updated_at: '2026-10-16T10:00:00.000001Z', ...capabilities };
  const stages = [{ id: 'stage-a', leads: [lead] }, { id: 'stage-b', is_lost: destinationLost, leads: [] }, { id: 'stage-c', leads: [] }];
  let visual = new Map(), reply, lostMove, lostLead, serverLead = { ...lead }, acceptedWrites = 0;
  const refs = Object.fromEntries(['movePersistenceByLeadRef', 'moveRollbackSnapshotByLeadRef', 'latestMoveVersionByLeadRef', 'moveRevisionReceiptByLeadRef'].map(name => [name, { current: new Map() }]));
  const common = { ...refs, useCallback: fn => fn, nextMovePersistenceStartAtRef: { current: 0 }, PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS: 135,
    waitForPipelineMove: async () => undefined };
  const enqueue = evaluateProduction('const ' + productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'enqueueLeadMovePersistence'), common, 'enqueueLeadMovePersistence');
  const dependencies = {
    moveContract: { getCurrent: () => ({ contract: 'revision-v1' }), ensureCompatible: async () => ({ contract: 'revision-v1' }) },
    ...common, leadMoveRequestScope: scope, canOperateLeads: true, isMobile: false, isDraggingRef: { current: false }, dragMoveSnapshotRef: { current: null },
    stages, stagesWithLeads: stages, stageAutomations: [], filterDealStatus: undefined, pipelineBoardQueryKey: queryKey, pipelineBoardQueryKeyId: 'query-a',
    queryClient, getOptimisticDealStatusForStage, getOptimisticAutomationDealStatusForStage, getOptimisticPipelineMoveOutcome,
    getVisualPendingMoveKey, shouldKeepLeadForDealStatusFilter, createPipelineStageSnapshot, getPipelineBoardOrderAtForIndex, leadProgressCapability,
    applyPendingPipelineMoves, clearPendingPipelineMove, registerPendingPipelineMove, findPipelineLeadLocation, restorePipelineLeadSnapshot,
    mergeMovedLeadResponse, isPipelineDealStatus, isUnsafePartialStageDrop, shouldApplyVisualPendingMove, enqueueLeadMovePersistence: enqueue, realtimeOrganizationId: 'org-a',
    capturePipelineMoveRevision, resolvePipelineMoveRevision, PipelineMoveRevisionConflict, getLeadStatusFinancialReviewMessage,
    window: { setTimeout() {} }, preserveOptimisticPipelineBoard() {},
    setVisualPendingMoves: update => { visual = update(visual); },
    leadsAPI: { moveLeadStage: async (...args) => {
      requests.push(args); if (reply) return reply.promise;
      const body = args[1];
      if (serverCAS) {
        if (body.expectedStageId !== serverLead.stage_id) throw new VimobAPIError('Changed stage', { status: 409, code: 'lead_stage_changed' });
        if (body.expectedUpdatedAt !== serverLead.updated_at) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
        acceptedWrites++;
        serverLead = { ...serverLead, stage_id: body.stageId, board_order_at: body.boardOrderAt, updated_at: `2026-10-16T10:01:00.00000${acceptedWrites}Z` };
        return { data: { ...serverLead }, error: null };
      }
      return { data: { ...lead, stage_id: 'stage-b', deal_status: savedStatus, financial_review_required: financialReviewRequired }, error: null };
    } },
    notifyLeadRealtimeChange: event => events.push(event), toast: { error: value => notices.push(value), warning: value => notices.push(value) },
    getClientRateLimitMessage: () => null, getPipelineErrorMessage: error => error.message, VimobAPIError,
    setPendingLostMove: value => { lostMove = value; }, setLostReasonLead: value => { lostLead = value; }, setLostReasonPending() {},
  };
  const handler = name => evaluateProduction('const ' + productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === name), {
    ...dependencies, stages: queryClient.getQueryData(queryKey) || stages,
    ...(name === 'executeLeadMove' ? {} : { executeLeadMove: (...args) => handler('executeLeadMove')(...args) }),
    lostReasonLead: lostLead, pendingLostMove: lostMove, lostReasonPending: false,
  }, name);
  const execute = (...args) => handler('executeLeadMove')(...args);
  queryClient.setQueryData(queryKey, stages);
  const serverBoard = () => stages.map(stage => ({ ...stage, leads: stage.id === serverLead.stage_id ? [{ ...serverLead }] : [] }));
  const observer = new QueryObserver(queryClient, { queryKey, queryFn: async () => serverBoard(), staleTime: Infinity });
  const unsubscribe = serverCAS ? observer.subscribe(() => undefined) : () => undefined;
  const first = holdFirst ? enqueue('lead-a', () => pendingFirst.promise) : Promise.resolve();
  return { runtime, requests, events, notices, refs, first, pendingFirst, visual: () => visual,
    invoke: () => execute({ draggableId: 'lead-a', source: { droppableId: 'stage-a', index: 0 }, destination: { droppableId: 'stage-b', index: 0 } },
      { lead, revision: capturePipelineMoveRevision(lead, 'stage-a'), operation: scope.capture(), queryKeyId: 'query-a' }),
    start: source => handler('handleDragStart')({ draggableId: 'lead-a', source: { droppableId: source || 'stage-a', index: 0 } }),
    drop: (source = 'stage-a', destination = 'stage-b', index = 0) => handler('handleDragEnd')({ draggableId: 'lead-a', source: { droppableId: source, index: 0 }, destination: { droppableId: destination, index } }),
    confirm: reason => handler('handleLostReasonConfirm')(reason), lost: () => lostMove,
    patchServer: patch => { serverLead = { ...serverLead, ...patch }; }, server: () => serverLead, writes: () => acceptedWrites,
    refresh: () => queryClient.setQueryData(queryKey, serverBoard()), board: () => queryClient.getQueryData(queryKey),
    deferReply: () => reply = deferred(), clearReply: () => { reply = undefined; },
    close: () => { unsubscribe(); clearPendingPipelineMove(queryKey, 'lead-a'); runtime.close(); } };
}

test('progress capability lets the leader archive a broker lead through the usual loss confirmation', async () => {
  const f = fixture({
    holdFirst: false, destinationLost: true, savedStatus: 'lost',
    capabilities: { can_operate: false, can_progress: true },
  });
  try {
    f.start();
    await f.drop();
    assert.equal(f.requests.length, 0);
    assert.ok(f.lost());
    await f.confirm('Synthetic reason');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0][1].stageId, 'stage-b');
    assert.equal(f.requests[0][1].lostReason, 'Synthetic reason');
  } finally { f.close(); }
});

test('the board does not dispatch when progress permission is revoked during a drag', async () => {
  const f = fixture({ holdFirst: false, capabilities: { can_progress: true } });
  try {
    f.start();
    f.patchServer({ can_progress: false });
    f.refresh();
    await f.drop();
    assert.equal(f.requests.length, 0);
    assert.equal(f.board()[0].leads[0].stage_id, 'stage-a');
  } finally { f.close(); }
});

for (const [fromStatus, savedStatus, financialReviewRequired, shouldWarn] of [
  ['won', 'open', false, true], ['won', 'lost', false, true],
  ['open', 'won', true, true], ['lost', 'won', true, true],
  ['open', 'won', false, false], ['lost', 'won', false, false],
  ['open', 'lost', false, false], ['lost', 'open', false, false],
]) test(`confirmed board move ${fromStatus} -> ${savedStatus} financial signal ${financialReviewRequired}`, async () => {
  const f = fixture({ holdFirst: false, fromStatus, savedStatus, financialReviewRequired });
  try {
    await f.invoke();
    assert.equal(f.requests.length, 1);
    assert.equal(f.notices.some(value => /revisão financeira/.test(value)), shouldWarn);
    assert.equal(f.notices.some(value => /not defined/.test(value)), false);
  } finally { f.close(); }
});

for (const next of [['org-b', 'actor-b', 'sid-b'], ['org-a', 'actor-a', 'sid-b']]) test(`real move producer/queue does not dispatch the waiting gesture after switching to ${next.join('/')}`, async () => {
  const f = fixture({ capabilities: { can_operate: false, can_progress: true } });
  try {
    const queued = f.invoke(); await turn(); assert.equal(f.requests.length, 0);
    f.runtime.switchTo(...next); f.runtime.scope(); f.pendingFirst.resolve(); await f.first; await queued;
    assert.equal(f.requests.length, 0); assert.deepEqual(f.events, []); assert.deepEqual(f.notices, []);
    assert.equal(f.visual().size, 0); assert.equal(f.refs.moveRollbackSnapshotByLeadRef.current.size, 0);
    assert.equal(f.refs.movePersistenceByLeadRef.current.size, 0);
  } finally { f.close(); }
});

test('real move producer/queue survives same-SID refresh and retains stage/order persistence', async () => {
  const f = fixture();
  try {
    const queued = f.invoke(); await turn(); f.runtime.switchTo('org-a', 'actor-a', 'sid-a', 2); f.runtime.scope();
    f.pendingFirst.resolve(); await f.first; await queued;
    assert.equal(f.requests.length, 1); const [id, body, organizationId, intent] = f.requests[0];
    assert.equal(id, 'lead-a'); assert.equal(body.stageId, 'stage-b'); assert.equal(body.expectedStageId, 'stage-a');
    assert.equal(body.expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.ok(Number.isFinite(Date.parse(body.boardOrderAt))); assert.equal(organizationId, 'org-a');
    assert.equal(intent.expectedUserId, 'actor-a'); assert.equal(intent.expectedSessionId, 'sid-a');
    assert.equal(f.events[0].reason, 'pipeline.stage'); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('real move response after session replacement only reconciles its owned pending version', async () => {
  const f = fixture();
  try {
    const response = f.deferReply(); const queued = f.invoke(); f.pendingFirst.resolve(); await turn();
    assert.equal(f.requests.length, 1); f.runtime.switchTo('org-a', 'actor-a', 'sid-b'); f.runtime.scope();
    response.resolve({ data: { id: 'lead-a', stage_id: 'stage-b' }, error: null }); await queued;
    assert.equal(f.requests[0][3].signal.aborted, true); assert.deepEqual(f.events, []); assert.deepEqual(f.notices, []);
    assert.equal(f.visual().size, 0); assert.equal(f.refs.moveRollbackSnapshotByLeadRef.current.size, 0);
  } finally { f.close(); }
});

for (const status of ['won', 'lost']) test(`drag captures microsecond revision before another client marks ${status}; 409 reconciles without stage writes`, async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    f.start(); f.patchServer({ deal_status: status, updated_at: '2026-10-16T10:00:00.000002Z' }); f.refresh();
    await f.drop(); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0][1].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.writes(), 0); assert.equal(f.server().deal_status, status);
    assert.equal(f.board()[0].leads[0].deal_status, status); assert.deepEqual(f.events, []);
    assert.match(f.notices[0], /atualizado em outra sessão/); assert.equal(f.lost(), null);
  } finally { f.close(); }
});

test('reordering in the same column carries the captured revision and rejects an external won update', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    f.start(); f.patchServer({ deal_status: 'won', updated_at: '2026-10-16T10:00:00.000002Z' }); f.refresh();
    await f.drop('stage-a', 'stage-a', 1); await turn();
    assert.equal(f.requests[0][1].stageId, 'stage-a'); assert.equal(f.requests[0][1].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.writes(), 0); assert.equal(f.board()[0].leads[0].deal_status, 'won');
  } finally { f.close(); }
});

test('lost-reason confirmation keeps the drag revision even after a refresh during the modal', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true, destinationLost: true });
  try {
    f.start(); await f.drop(); assert.equal(f.requests.length, 0); assert.ok(f.lost());
    f.patchServer({ deal_status: 'won', updated_at: '2026-10-16T10:00:00.000002Z' }); f.refresh();
    await f.confirm('Synthetic reason'); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0][1].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.writes(), 0); assert.equal(f.lost(), null); assert.equal(f.board()[0].leads[0].deal_status, 'won');
  } finally { f.close(); }
});

test('a queued successor uses only its own predecessor response, never a newer board revision', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    const reply = f.deferReply(); f.start(); const first = f.drop(); await turn();
    f.start('stage-b'); const second = f.drop('stage-b', 'stage-c'); await turn();
    f.patchServer({ stage_id: 'stage-b', updated_at: '2026-10-16T10:00:00.000002Z' });
    f.clearReply(); reply.resolve({ data: { ...f.server() }, error: null }); await first; await second;
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1][1].expectedUpdatedAt, '2026-10-16T10:00:00.000002Z');
    assert.equal(f.requests[1][1].expectedStageId, 'stage-b'); assert.equal(f.server().stage_id, 'stage-c');
  } finally { f.close(); }
});

test('a failed predecessor prevents its queued successor from dispatching or reopening a won lead', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    const reply = f.deferReply(); f.start(); const first = f.drop(); await turn();
    f.start('stage-b'); const second = f.drop('stage-b', 'stage-c'); await turn();
    f.patchServer({ deal_status: 'won', updated_at: '2026-10-16T10:00:00.000002Z' }); f.clearReply();
    reply.reject(new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' })); await first; await second; await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.writes(), 0); assert.equal(f.board()[0].leads[0].deal_status, 'won');
    assert.equal(f.refs.moveRevisionReceiptByLeadRef.current.size, 0); assert.deepEqual(f.events, []);
  } finally { f.close(); }
});

test('a queued successor rejects an external update after its predecessor committed, without rebasing to the external revision', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    const reply = f.deferReply(); f.start(); const first = f.drop(); await turn();
    f.start('stage-b'); const second = f.drop('stage-b', 'stage-c'); await turn();
    const confirmed = { ...f.server(), stage_id: 'stage-b', updated_at: '2026-10-16T10:00:00.000002Z' };
    f.patchServer({ ...confirmed, deal_status: 'won', updated_at: '2026-10-16T10:00:00.000003Z' }); f.clearReply();
    reply.resolve({ data: confirmed, error: null }); await first; await second; await turn();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1][1].expectedUpdatedAt, confirmed.updated_at);
    assert.equal(f.writes(), 0); assert.equal(f.board()[1].leads[0].deal_status, 'won'); assert.deepEqual(f.events, []);
  } finally { f.close(); }
});

test('a lead without a server revision cannot dispatch an unguarded move', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    f.patchServer({ updated_at: undefined }); f.refresh(); f.start(); await f.drop();
    assert.equal(f.requests.length, 0); assert.match(f.notices[0], /Atualize a Pipeline/);
  } finally { f.close(); }
});

test('a drag captured before session replacement is discarded before any API call', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    f.start(); f.runtime.switchTo('org-b', 'actor-b', 'sid-b'); f.runtime.scope(); await f.drop();
    assert.equal(f.requests.length, 0); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});

test('server-requested loss reason preserves the first drag revision on confirmation', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    const reply = f.deferReply(); f.start(); const drop = f.drop(); await turn();
    f.clearReply(); reply.reject(new VimobAPIError('Reason required', { status: 400, code: 'lead_lost_reason_required' })); await drop;
    assert.ok(f.lost()); f.patchServer({ deal_status: 'won', updated_at: '2026-10-16T10:00:00.000002Z' }); f.refresh();
    await f.confirm('Synthetic reason'); await turn();
    assert.equal(f.requests.length, 2); assert.equal(f.requests[1][1].expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.writes(), 0); assert.equal(f.board()[0].leads[0].deal_status, 'won'); assert.equal(f.lost(), null);
  } finally { f.close(); }
});
