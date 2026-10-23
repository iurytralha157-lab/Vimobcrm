import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryObserver } from '@tanstack/react-query';
import { deferred, evaluateProduction, leadHookRuntime, productionDeclaration, turn } from '../../../../hooks/leads/lead-request-runtime-fixture.mjs';
import { captureLeadRequestIntent } from '../../../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../../../lib/auth/global-sign-out.ts';
import { capturePipelineMoveRevision } from '../../../../lib/pipeline-move-revision.ts';
import { getPipelineStageOutcome } from '../../../../lib/pipeline-stage-outcome.ts';
import { mergeLeadServerResponse } from '../../../../lib/merge-lead-server-response.ts';
import { mergeLeadDetailMutation } from './hydrate-lead-detail.ts';
import { VimobAPIError } from '../../../../lib/api/vimob-error.ts';
import { getLeadStatusFinancialReviewMessage } from '../../../../lib/lead-financial-review.ts';
import { leadFieldOptimismRuntime } from '../../../../hooks/leads/lead-field-optimism-runtime-fixture.mjs';

// Execute the real popup handlers; the synthetic API enforces the server CAS.
function fixture({ lost = false, fromStatus = 'open', savedStatus = fromStatus, financialReviewRequired = false } = {}) {
  const runtime = leadHookRuntime(), queryClient = runtime.client();
  const lead = { ...runtime.authorizedLead, deal_status: fromStatus, stage_id: 'stage-a', updated_at: '2026-10-16T10:00:00.000001Z' };
  const stages = [{ id: 'stage-a' }, { id: 'stage-b', is_lost: lost }];
  let localLead = { ...lead }, serverLead = { ...lead }, pendingLostStageMove = null, open = false, closed = false, writes = 0, reply, readReply;
  const requests = [], notices = [], events = [];
  const key = ['lead', 'org-a', lead.id]; queryClient.setQueryData(key, localLead);
  const observer = new QueryObserver(queryClient, { queryKey: key, queryFn: async () => readReply ? readReply.promise : ({ ...serverLead }), staleTime: Infinity });
  const unsubscribe = observer.subscribe(() => undefined);
  const { request: requestScope, captureResource: captureDetailOperation } = runtime.distributionScope();
  const fields = leadFieldOptimismRuntime({ client: queryClient, lead, getLead: () => localLead,
    setLead: value => { localLead = typeof value === 'function' ? value(localLead) : value; } });
  const dependencies = {
    moveContract: { getCurrent: () => ({ contract: 'revision-v1' }), ensureCompatible: async () => ({ contract: 'revision-v1' }) },
    statusConfirmation: { clear: () => true, restart: () => true, isCurrent: () => true },
    canOperateLead: true, lead, stages, stageAutomations: [], queryClient, captureDetailOperation, requestScope,
    activeOrganization: runtime.auth.activeOrganization, user: runtime.auth.user, session: runtime.auth.session,
    stageMovePendingRef: { current: false }, statusSubmittingRef: { current: false }, stageMovePending: false,
    capturePipelineMoveRevision, captureLeadRequestIntent, getGlobalSignOutSessionId, getPipelineStageOutcome,
    mergeLeadDetailMutation, mergeLeadServerResponse, VimobAPIError, getLeadStatusFinancialReviewMessage, getErrorMessage: error => error.message,
    fieldOptimism: fields.render(),
    setStageMovePending() {}, setLocalLead: value => { localLead = typeof value === 'function' ? value(localLead) : value; },
    setPendingLostStageMove: value => { pendingLostStageMove = value; }, setLostReasonDialogOpen: value => { open = value; }, setLostReasonLocal() {},
    toast: { success: value => notices.push(value), error: value => notices.push(value), warning: value => notices.push(value) },
    updatePipelineLeadCache() {}, refreshPipelineInBackground: (...args) => events.push(args),
    handleCloseLeadDetail: () => { closed = true; }, dealStatusChange: { isPending: false, mutateAsync() { throw Error('Unexpected status write'); } },
    leadsAPI: { moveLeadStage: async (id, body, organizationId, intent) => {
      requests.push({ id, body, organizationId, intent });
      if (reply) return reply.promise;
      if (body.expectedStageId !== serverLead.stage_id) throw new VimobAPIError('Changed stage', { status: 409, code: 'lead_stage_changed' });
      if (body.expectedUpdatedAt !== serverLead.updated_at) throw new VimobAPIError('Changed lead', { status: 409, code: 'lead_changed' });
      writes++; serverLead = { ...serverLead, stage_id: body.stageId, deal_status: savedStatus, financial_review_required: financialReviewRequired, updated_at: '2026-10-16T10:01:00.000001Z' };
      return { data: { ...serverLead }, error: null };
    } },
  };
  const handler = name => {
    const bindings = { ...dependencies, localLead, pendingLostStageMove,
      captureStageMove: (...args) => handler('captureStageMove')(...args), persistMoveToStage: (...args) => handler('persistMoveToStage')(...args) };
    delete bindings[name];
    return evaluateProduction('const ' + productionDeclaration(process.env.PIPELINE_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx',
      node => ts.isVariableDeclaration(node) && node.name.getText() === name), bindings, name);
  };
  return {
    requests, notices, events, move: () => handler('handleMoveToStage')('stage-b'), confirm: () => handler('handleConfirmLostReason')('Synthetic reason'),
    state: () => ({ localLead, serverLead, pendingLostStageMove, open, closed, writes }),
    patch: patch => { serverLead = { ...serverLead, ...patch }; localLead = { ...serverLead }; queryClient.setQueryData(key, localLead); },
    patchLocal: patch => { localLead = { ...localLead, ...patch }; }, canonical: () => fields.canonical(),
    deferReply: () => reply = deferred(), holdReads: () => readReply = deferred(),
    replaceScope: () => { runtime.switchTo('org-b', 'actor-b', 'sid-b'); runtime.distributionScope();
      dependencies.fieldOptimism = fields.render({ organizationId: 'org-b', actorId: 'actor-b', sessionId: 'sid-b' }); },
    close: () => { readReply?.resolve(serverLead); fields.close(); unsubscribe(); runtime.close(); },
  };
}

for (const [fromStatus, savedStatus, financialReviewRequired, shouldWarn] of [
  ['won', 'open', false, true], ['won', 'lost', false, true],
  ['open', 'won', true, true], ['lost', 'won', true, true],
  ['open', 'won', false, false], ['lost', 'won', false, false],
  ['open', 'lost', false, false], ['lost', 'open', false, false],
]) test(`confirmed popup stage ${fromStatus} -> ${savedStatus} financial signal ${financialReviewRequired}`, async () => {
  const f = fixture({ fromStatus, savedStatus, financialReviewRequired });
  try {
    assert.equal(await f.move(), undefined);
    assert.equal(f.state().writes, 1);
    assert.equal(f.notices.some(value => /revisão financeira/.test(value)), shouldWarn);
    assert.equal(f.notices.some(value => /não foi possível|not defined/i.test(value)), false);
  } finally { f.close(); }
});

test('popup stage selection sends the exact original microsecond revision', async () => {
  const f = fixture();
  try {
    await f.move();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.requests[0].body.expectedStageId, 'stage-a'); assert.equal(f.requests[0].intent.expectedSessionId, 'sid-a');
    assert.equal(f.state().writes, 1); assert.equal(f.state().localLead.updated_at, '2026-10-16T10:01:00.000001Z');
  } finally { f.close(); }
});

for (const deal_status of ['won', 'lost']) test(`popup reason dialog never rebases after an external ${deal_status} update`, async () => {
  const f = fixture({ lost: true });
  try {
    await f.move(); assert.equal(f.requests.length, 0); assert.ok(f.state().open);
    f.patch({ deal_status, updated_at: '2026-10-16T10:00:00.000002Z' }); await f.confirm(); await turn();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].body.expectedUpdatedAt, '2026-10-16T10:00:00.000001Z');
    assert.equal(f.state().writes, 0); assert.equal(f.state().serverLead.deal_status, deal_status);
    assert.equal(f.state().open, false); assert.equal(f.state().closed, true); assert.equal(f.state().pendingLostStageMove, null);
    assert.deepEqual(f.events, []); assert.match(f.notices[0], /atualizado em outra sessão/);
  } finally { f.close(); }
});

test('popup pending reason cannot dispatch after organization/session replacement', async () => {
  const f = fixture({ lost: true });
  try {
    await f.move(); f.replaceScope(); await f.confirm(); assert.equal(f.requests.length, 0); assert.equal(f.state().writes, 0);
  } finally { f.close(); }
});

test('popup move rejection restores only stage and preserves concurrent tag/name/status/assignee changes', async () => {
  const f = fixture();
  try {
    f.holdReads(); const reply = f.deferReply(), pending = f.move(); await turn();
    assert.equal(f.state().localLead.stage_id, 'stage-b');
    f.patchLocal({ tags: [{ id: 'restored-tag' }], name: 'Fresh', deal_status: 'won', assigned_user_id: 'owner-c', whatsapp_avatar_url: 'fresh', valor_interesse: 42 });
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    const lead = f.state().localLead; assert.equal(lead.stage_id, 'stage-a');
    assert.deepEqual(lead.tags, [{ id: 'restored-tag' }]); assert.equal(lead.name, 'Fresh'); assert.equal(lead.deal_status, 'won');
    assert.equal(lead.assigned_user_id, 'owner-c'); assert.equal(lead.whatsapp_avatar_url, 'fresh'); assert.equal(lead.valor_interesse, 42);
  } finally { f.close(); }
});

for (const status of [undefined, 408, 500]) test(`popup move uncertain ${status} failure preserves provisional stage until canonical read`, async () => {
  const f = fixture();
  try {
    f.holdReads(); const reply = f.deferReply(), pending = f.move(); await turn(); const before = f.state().localLead;
    reply.reject(status ? new VimobAPIError('Unknown outcome', { status }) : new TypeError('Connection lost')); await pending;
    assert.equal(f.state().localLead, before); assert.equal(f.state().closed, false);
  } finally { f.close(); }
});

test('popup move identical canonical read retires local rollback', async () => {
  const f = fixture();
  try {
    const reply = f.deferReply(), pending = f.move(); await turn();
    assert.equal(await f.canonical(), true); const before = f.state().localLead; f.holdReads();
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending; assert.equal(f.state().localLead, before);
  } finally { f.close(); }
});

test('popup move late rejection cannot change replacement organization state', async () => {
  const f = fixture();
  try {
    const reply = f.deferReply(), pending = f.move(); await turn(); f.replaceScope();
    f.patchLocal({ name: 'Replacement', tags: [{ id: 'replacement' }] }); const before = f.state().localLead;
    reply.reject(new VimobAPIError('Denied', { status: 403 })); await pending;
    assert.equal(f.state().localLead, before); assert.deepEqual(f.notices, []);
  } finally { f.close(); }
});
