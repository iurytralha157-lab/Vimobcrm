import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryObserver } from '@tanstack/react-query';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from '../../../hooks/leads/lead-request-runtime-fixture.mjs';
import {
  applyPendingPipelineMoves, clearPendingPipelineMove, clearPendingPipelineMoves,
  findPipelineLeadLocation, getPendingPipelineMoves, getPipelineLeadQueryScopeMatch, protectConfirmedPipelineMoves,
  reconcilePipelineBoardSnapshot, registerPendingPipelineMove, rememberConfirmedPipelineMove,
  restorePipelineLeadSnapshot,
} from '../../../lib/pipeline-board-cache.ts';
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

function fixture({ holdFirst = true, serverCAS = false, destinationLost = false, fromStatus = 'open', savedStatus = fromStatus, financialReviewRequired = false, capabilities = {}, additionalLeads = 0, controlledReplies = false, filterUserId, scopedVisibleUserIds } = {}) {
  const runtime = leadHookRuntime(), requests = [], events = [], notices = [], pendingFirst = deferred();
  const scope = runtime.scope(), queryClient = runtime.client();
  const queryKey = ['stages-with-leads', 'org-a', 'pipeline-a', ...(filterUserId ? [filterUserId] : [])];
  const lead = { id: 'lead-a', stage_id: 'stage-a', assigned_user_id: 'actor-a', can_operate: true, deal_status: fromStatus, tags: [], updated_at: '2026-10-16T10:00:00.000001Z', ...capabilities };
  const initialLeads = [lead, ...Array.from({ length: additionalLeads }, (_, index) => ({
    ...lead,
    id: `lead-${index + 1}`,
  }))].map((item, index) => ({ ...item, board_order_at: `2026-10-16T10:00:00.${String(999999 - index).padStart(6, '0')}Z` }));
  const stages = [{ id: 'stage-a', leads: initialLeads }, { id: 'stage-b', is_lost: destinationLost, leads: [] }, { id: 'stage-c', leads: [] }];
  const serverLeads = new Map(initialLeads.map(item => [item.id, { ...item }]));
  const replies = new Map();
  let visual = new Map(), reply, lostMove, lostLead, acceptedWrites = 0;
  function persist(id, body) {
    const serverLead = serverLeads.get(id);
    if (body.expectedStageId !== serverLead.stage_id) throw new VimobAPIError('Changed stage', { status: 409, code: 'lead_stage_changed' });
    if (body.expectedUpdatedAt !== serverLead.updated_at) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
    acceptedWrites++;
    const saved = { ...serverLead, stage_id: body.stageId, board_order_at: body.boardOrderAt,
      updated_at: `2026-10-16T10:01:00.${String(acceptedWrites).padStart(6, '0')}Z` };
    serverLeads.set(id, saved);
    return { data: { ...saved }, error: null };
  }
  const refs = Object.fromEntries(['movePersistenceByLeadRef', 'moveRollbackSnapshotByLeadRef', 'latestMoveVersionByLeadRef', 'moveRevisionReceiptByLeadRef'].map(name => [name, { current: new Map() }]));
  const common = { ...refs, useCallback: fn => fn, nextMovePersistenceStartAtRef: { current: 0 }, PIPELINE_MOVE_PERSISTENCE_INTERVAL_MS: 135,
    waitForPipelineMove: async () => undefined };
  const enqueue = evaluateProduction('const ' + productionDeclaration('components/features/pipelines/PipelinesScreen.tsx',
    node => ts.isVariableDeclaration(node) && node.name.getText() === 'enqueueLeadMovePersistence'), common, 'enqueueLeadMovePersistence');
  const dependencies = {
    moveContract: { getCurrent: () => ({ contract: 'revision-v1' }), ensureCompatible: async () => ({ contract: 'revision-v1' }) },
    ...common, leadMoveRequestScope: scope, canOperateLeads: true, isMobile: false, isDraggingRef: { current: false }, dragMoveSnapshotRef: { current: null },
    stages, stagesWithLeads: stages, stageAutomations: [], filterDealStatus: undefined, scopedVisibleUserIds, pipelineBoardQueryKey: queryKey, pipelineBoardQueryKeyId: 'query-a',
    queryClient, getOptimisticDealStatusForStage, getOptimisticAutomationDealStatusForStage, getOptimisticPipelineMoveOutcome,
    getVisualPendingMoveKey, shouldKeepLeadForDealStatusFilter, createPipelineStageSnapshot, getPipelineBoardOrderAtForIndex, leadProgressCapability,
    applyPendingPipelineMoves, clearPendingPipelineMove, registerPendingPipelineMove, rememberConfirmedPipelineMove, findPipelineLeadLocation, getPipelineLeadQueryScopeMatch, restorePipelineLeadSnapshot,
    mergeMovedLeadResponse, isPipelineDealStatus, isUnsafePartialStageDrop, shouldApplyVisualPendingMove, enqueueLeadMovePersistence: enqueue, realtimeOrganizationId: 'org-a',
    capturePipelineMoveRevision, resolvePipelineMoveRevision, PipelineMoveRevisionConflict, getLeadStatusFinancialReviewMessage,
    window: { setTimeout() {} }, preserveOptimisticPipelineBoard() {},
    setVisualPendingMoves: update => { visual = update(visual); },
    leadsAPI: { moveLeadStage: async (...args) => {
      requests.push(args); if (reply) return reply.promise;
      const [id, body] = args;
      if (controlledReplies) {
        const pending = deferred();
        replies.set(id, { ...pending, body });
        return pending.promise;
      }
      if (serverCAS) return persist(id, body);
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
  const serverBoard = () => stages.map(stage => {
    const leads = [...serverLeads.values()].filter(item => item.stage_id === stage.id &&
      (!filterUserId || item.assigned_user_id === filterUserId) && (!scopedVisibleUserIds || scopedVisibleUserIds.includes(item.assigned_user_id)))
      .sort((a, b) => b.board_order_at.localeCompare(a.board_order_at)).map(item => ({ ...item }));
    return { ...stage, leads, total_lead_count: leads.length, has_more: false };
  });
  let snapshotToRead;
  const observer = new QueryObserver(queryClient, {
    queryKey, staleTime: Infinity,
    queryFn: async () => protectConfirmedPipelineMoves(queryClient, queryKey, snapshotToRead || serverBoard()),
    structuralSharing: (oldData, newData) => reconcilePipelineBoardSnapshot(oldData, newData, getPendingPipelineMoves(queryKey)),
  });
  const unsubscribe = serverCAS ? observer.subscribe(() => undefined) : () => undefined;
  const first = holdFirst ? enqueue('lead-a', () => pendingFirst.promise) : Promise.resolve();
  return { runtime, requests, events, notices, refs, first, pendingFirst, visual: () => visual,
    invoke: () => execute({ draggableId: 'lead-a', source: { droppableId: 'stage-a', index: 0 }, destination: { droppableId: 'stage-b', index: 0 } },
      { lead, revision: capturePipelineMoveRevision(lead, 'stage-a'), operation: scope.capture(), queryKeyId: 'query-a' }),
    start: (source = 'stage-a', id = 'lead-a') => handler('handleDragStart')({ draggableId: id, source: { droppableId: source, index: 0 } }),
    drop: (source = 'stage-a', destination = 'stage-b', index = 0, id = 'lead-a', sourceIndex = 0) => handler('handleDragEnd')({ draggableId: id, source: { droppableId: source, index: sourceIndex }, destination: { droppableId: destination, index } }),
    confirm: reason => handler('handleLostReasonConfirm')(reason), lost: () => lostMove,
    patchServer: (patch, id = 'lead-a') => serverLeads.set(id, { ...serverLeads.get(id), ...patch }),
    server: (id = 'lead-a') => serverLeads.get(id), writes: () => acceptedWrites, serverBoard,
    settle: id => {
      const pending = replies.get(id);
      assert.ok(pending, id);
      try { pending.resolve(persist(id, pending.body)); } catch (error) { pending.reject(error); }
      replies.delete(id);
    },
    refetch: async (snapshot) => {
      snapshotToRead = snapshot;
      try { await observer.refetch({ throwOnError: true }); } finally { snapshotToRead = undefined; }
    },
    refresh: () => queryClient.setQueryData(queryKey, serverBoard()), board: () => queryClient.getQueryData(queryKey),
    deferReply: () => reply = deferred(), clearReply: () => { reply = undefined; },
    close: () => { unsubscribe(); clearPendingPipelineMoves(queryKey); runtime.close(); } };
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

test('rapid moves of 30 leads survive late reads and out-of-order confirmations, with one isolated conflict', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true, additionalLeads: 29, controlledReplies: true });
  try {
    const oldBoard = f.serverBoard();
    const attempts = oldBoard[0].leads.map(({ id }, index) => ({ id, destination: index % 2 ? 'stage-b' : 'stage-c' }));
    const expectedPlacement = [
      [], attempts.filter(({ destination }) => destination === 'stage-b').map(({ id }) => id).reverse(),
      attempts.filter(({ destination }) => destination === 'stage-c').map(({ id }) => id).reverse(),
    ];
    const moves = attempts.map(({ id, destination }) => {
      f.start('stage-a', id);
      return f.drop('stage-a', destination, 0, id);
    });
    await turn();
    assert.equal(f.requests.length, 30);

    for (let index = 28; index >= 24; index--) {
      f.settle(attempts[index].id);
      await moves[index];
    }
    await f.refetch(oldBoard);
    assert.deepEqual(f.board().map(stage => stage.leads.map(lead => lead.id)), expectedPlacement);

    f.patchServer({ stage_id: 'stage-c', updated_at: '2026-10-16T10:00:00.000002Z' }, attempts[29].id);
    for (let index = 23; index >= 0; index--) {
      f.settle(attempts[index].id);
      await moves[index];
    }
    await f.refetch(oldBoard);
    assert.deepEqual(f.board().map(stage => stage.leads.map(lead => lead.id)), expectedPlacement);

    f.settle(attempts[29].id);
    await moves[29];
    await turn();
    assert.equal(f.writes(), 29);
    assert.equal(f.events.length, 29);
    assert.equal(f.notices.length, 1);
    assert.match(f.notices[0], /atualizado em outra sessão/);
    assert.deepEqual(f.board().map(stage => stage.leads.map(lead => lead.id)),
      f.serverBoard().map(stage => stage.leads.map(lead => lead.id)));
    assert.equal([...f.visual().values()].some(({ move }) => move.leadId === attempts[29].id), false);
  } finally { f.close(); }
});

test('a same-column reorder retains the accepted microsecond position during a late read', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true, additionalLeads: 2 });
  try {
    const oldBoard = f.serverBoard();
    f.start();
    await f.drop('stage-a', 'stage-a', 2);
    await f.refetch(oldBoard);
    const current = f.board()[0].leads;
    assert.deepEqual(current.map(lead => lead.id), ['lead-1', 'lead-2', 'lead-a']);
    assert.equal(current[2].board_order_at, f.server().board_order_at);
    assert.equal(current[2].updated_at, f.server().updated_at);

    f.patchServer({ updated_at: '2026-10-16T10:01:00.000002Z', board_order_at: oldBoard[0].leads[0].board_order_at });
    await f.refetch();
    assert.deepEqual(f.board()[0].leads.map(lead => lead.id), ['lead-a', 'lead-1', 'lead-2']);
  } finally { f.close(); }
});

test('a confirmed move never restores a card omitted from the authorized board snapshot', async () => {
  const f = fixture({ holdFirst: false, serverCAS: true });
  try {
    const oldBoard = f.serverBoard();
    f.start();
    await f.drop();
    await f.refetch(oldBoard.map(stage => ({ ...stage, leads: [], total_lead_count: 0 })));

    assert.equal(findPipelineLeadLocation(f.board(), 'lead-a'), null);
    assert.equal([...f.visual().values()].some(entry => shouldApplyVisualPendingMove(f.board(), entry)), false);
  } finally { f.close(); }
});

for (const [scope, options] of [
  ['selected owner filter', { filterUserId: 'actor-a' }],
  ['unfiltered own-only visibility', { scopedVisibleUserIds: ['actor-a'] }],
]) test(`a confirmed reassignment respects ${scope} even on a late read`, async () => {
  const f = fixture({ holdFirst: false, serverCAS: true, ...options });
  try {
    const oldBoard = f.serverBoard();
    const reply = f.deferReply();
    f.start();
    const drop = f.drop();
    await turn();
    f.patchServer({ stage_id: 'stage-b', assigned_user_id: 'actor-b', updated_at: '2026-10-16T10:00:00.000002Z' });
    reply.resolve({ data: f.server(), error: null });
    await drop;

    assert.equal(findPipelineLeadLocation(f.board(), 'lead-a'), null);
    await f.refetch(oldBoard);
    assert.equal(findPipelineLeadLocation(f.board(), 'lead-a'), null);
    await f.refetch();
    assert.equal(findPipelineLeadLocation(f.board(), 'lead-a'), null);
  } finally { f.close(); }
});
