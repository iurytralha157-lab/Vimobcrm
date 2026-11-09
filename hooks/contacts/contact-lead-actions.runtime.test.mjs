import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CONTACT_PAGE_SIZE_OPTIONS } from '../../config/contacts.ts';
import { deferred, evaluateProduction, leadHookRuntime, turn } from '../leads/lead-request-runtime-fixture.mjs';
import { getNonBlankErrorMessageOrFallback, VimobAPIError } from '../../lib/api/vimob-error.ts';
import { getLeadStatusFinancialReviewMessage } from '../../lib/lead-financial-review.ts';
import { uuidSchema } from '../../lib/validation/common.ts';
import { lostReasonSchema } from '../../lib/validation/schemas.ts';

const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [first, second, third, fourth, pipeline, stage, nextStage, assignee] = Array.from({ length: 8 }, (_, i) => uuid(i + 1));
const revision = '2026-11-09T10:00:00.123456Z';
const moved = { kind: 'move-stage', pipelineId: pipeline, stageId: nextStage };
const assigned = { kind: 'assign', assignedUserId: assignee };
const lead = (id, extra = {}) => ({
  id, organization_id: 'org-a', name: 'Contato sintético', can_operate: true, queue_pool: null,
  updated_at: revision, pipeline_id: pipeline, stage_id: stage, assigned_user_id: null, deal_status: 'open', ...extra,
});
const error = (status, code) => new VimobAPIError(code, { status, code });
const source = readFileSync(new URL('./use-contact-lead-actions.ts', import.meta.url), 'utf8').replace(/^import .*;$/gm, '');

function harness(t, { read = id => lead(id), write = id => lead(id) } = {}) {
  const request = leadHookRuntime();
  t.after(request.close);
  let permission = true;
  let cursor = 0;
  let layout = { deps: [], cleanup: null };
  const slots = [];
  const reads = [];
  const writes = [];
  const events = [];
  const capabilities = [];
  const invoke = kind => async (id, body, organizationId, intent, expectedUpdatedAt) => {
    intent.onRequestStart();
    writes.push({ kind, id, body, organizationId, intent, expectedUpdatedAt, at: Date.now() });
    return { data: await write(id, kind) };
  };
  const renderActions = evaluateProduction(source, {
    useRef: value => slots[cursor++] ??= { current: value },
    useLayoutEffect: (setup, deps) => {
      if (!layout.deps.length || deps[0] !== layout.deps[0]) {
        layout.cleanup?.();
        layout = { deps, cleanup: setup() };
      }
    },
    useLeadRequestScope: request.scope,
    useQueryClient: request.client,
    useUserPermissions: () => ({ hasPermission: key => permission && key === 'lead_operate' }),
    CONTACT_PAGE_SIZE_OPTIONS, getNonBlankErrorMessageOrFallback, VimobAPIError, getLeadStatusFinancialReviewMessage, uuidSchema, lostReasonSchema,
    notifyLeadRealtimeChange: event => events.push(event),
    getLeadMoveStageContract: async (_org, intent) => { intent.onRequestStart(); capabilities.push({}); return capabilities.at(-1); },
    isLeadMoveStageContractCurrent: contract => !!contract && capabilities.includes(contract),
    leadsAPI: {
      getLead: async (id, organizationId, signal, intent) => {
        intent.onRequestStart();
        reads.push({ id, organizationId, signal, intent });
        return { data: await read(id) };
      },
      moveLeadStage: invoke('move-stage'),
      assignLead: invoke('assign'),
      updateLead: invoke('deal-status'),
    },
  }, 'useContactLeadActions');
  const render = () => { cursor = 0; return renderActions(); };
  return { render, request, reads, writes, events, capabilities, setPermission: value => { permission = value; } };
}

test('review pins canonical microseconds and tenant, writes only approved targets and skips no-op assignment', async t => {
  const fixture = harness(t, { read: id => lead(id, id === second ? { organization_id: 'org-b' } :
    id === third ? { assigned_user_id: assignee } : id === fourth ? { can_operate: false } : {}) });
  const actions = fixture.render();
  const review = await actions.prepare([first, second, third, first, fourth]);
  assert.deepEqual(review.targets.map(({ id }) => id), [first, third]);
  assert.deepEqual(review.failures.map(({ id }) => id), [second, fourth]);
  assert.equal(fixture.reads[0].intent.expectedSessionId, 'sid-a');
  assert.equal(fixture.reads[0].intent.retry, false);
  const result = await actions.run({ review, action: assigned });
  assert.deepEqual(result.succeededIds, [first]);
  assert.deepEqual(result.unchangedIds, [third]);
  assert.deepEqual(fixture.writes.map(({ kind, id, organizationId, expectedUpdatedAt }) => ({
    kind, id, organizationId, expectedUpdatedAt,
  })), [{ kind: 'assign', id: first, organizationId: 'org-a', expectedUpdatedAt: revision }]);
  assert.deepEqual(fixture.events, [{ organizationId: 'org-a', leadId: first, reason: 'lead.assigned' }]);
  await assert.rejects(() => actions.run({ review, action: assigned }), /Abra a ação novamente/);
});

test('old reviews cannot start writes after a tenant round trip or permission replacement', async t => {
  const fixture = harness(t);
  const firstReview = await fixture.render().prepare([first]);
  fixture.request.switchTo('org-b', 'actor-b', 'sid-b');
  fixture.render();
  fixture.request.switchTo('org-a', 'actor-a', 'sid-a');
  const actions = fixture.render();
  await assert.rejects(() => actions.run({ review: firstReview, action: assigned }), /Abra a ação novamente/);
  const next = await actions.prepare([first]);
  fixture.setPermission(false);
  fixture.render();
  fixture.setPermission(true);
  await assert.rejects(() => fixture.render().run({ review: next, action: assigned }), /Abra a ação novamente/);
  assert.equal(fixture.writes.length, 0);
});

test('a revoked session stops preparing further contacts and discards the partial review', async t => {
  const fixture = harness(t, { read: id => {
    if (id === first) throw error(401, 'session_revoked');
    return lead(id);
  } });
  const actions = fixture.render();
  await assert.rejects(() => actions.prepare([first, second, third, fourth]), /Abra a ação novamente/);
  assert.equal(fixture.reads.some(({ id }) => id === fourth), false);
  assert.equal(fixture.writes.length, 0);
});

test('stage uses versioned command with exact source and paces requests, returning 429 and unstarted separately', async t => {
  const fixture = harness(t, { write: id => {
    if (id === second) throw error(429, 'lead_move_rate_limited');
    return lead(id, { stage_id: nextStage });
  } });
  const actions = fixture.render();
  const review = await actions.prepare([first, second, third]);
  const progress = [];
  const result = await actions.run({ review, action: moved, onProgress: (...counts) => progress.push(counts) });
  assert.deepEqual(result.succeededIds, [first]);
  assert.deepEqual(result.failures, [{ id: second, message: 'lead_move_rate_limited', code: 'lead_move_rate_limited' }]);
  assert.deepEqual(result.unstartedIds, [third]);
  assert.deepEqual(progress, [[1, 3], [2, 3]]);
  assert.deepEqual(fixture.writes[0].body, { stageId: nextStage, expectedStageId: stage, expectedUpdatedAt: revision, lostReason: undefined });
  assert.equal(fixture.capabilities.length, 1);
  assert.ok(fixture.writes[1].at - fixture.writes[0].at >= 140);
});

test('one whole Contacts page fits the action limit and an oversized batch stops before reading', async t => {
  const fixture = harness(t);
  const actions = fixture.render();
  const ids = Array.from({ length: 101 }, (_, index) => uuid(100 + index));
  await assert.rejects(() => actions.prepare(ids), /1 a 100 contatos/);
  assert.equal(fixture.reads.length, 0);
  const review = await actions.prepare(ids.slice(0, 100));
  assert.equal(review.targets.length, 100);
});

test('bulk status requires a loss reason and reports an uncertain write without retrying it', async t => {
  const fixture = harness(t, { read: id => lead(id, id === first ? { deal_status: 'won' } : {}),
    write: id => {
      if (id === second) throw error(503, 'backend_unavailable');
      if (id === third) throw error(409, 'lead_changed');
      return lead(id, { deal_status: 'lost' });
    },
  });
  const client = fixture.request.client();
  const affected = [
    ['properties', 'org-a'], ['property-publications', 'org-a', 'signature'], ['public-property', 'org-a'],
    ['lead-cadence-state', 'org-a', first, stage], ['notifications', 'actor-a', 'org-a'],
  ];
  const unrelated = [
    ['properties', 'org-b'], ['property-publications', 'org-b'], ['lead-cadence-state', 'org-b', first, stage],
    ['notifications', 'actor-b', 'org-a'],
  ];
  for (const key of [...affected, ...unrelated]) client.setQueryData(key, 'cached');
  const actions = fixture.render();
  const review = await actions.prepare([first, second, third]);
  await assert.rejects(() => actions.run({ review, action: { kind: 'deal-status', status: 'lost' } }), /Informe o motivo/);
  const result = await actions.run({ review, action: { kind: 'deal-status', status: 'lost', lostReason: 'Sem interesse' } });
  assert.deepEqual(result.succeededIds, [first]);
  assert.deepEqual(result.financialReviewIds, [first]);
  assert.deepEqual(result.unconfirmedIds, [second]);
  assert.deepEqual(result.failures, [{ id: third, message: 'lead_changed', code: 'lead_changed' }]);
  assert.equal(fixture.writes.length, 3);
  for (const { body } of fixture.writes) {
    assert.deepEqual(body, { deal_status: 'lost', expectedUpdatedAt: revision, lost_reason: 'Sem interesse' });
  }
  for (const key of affected) assert.equal(client.getQueryState(key).isInvalidated, true);
  for (const key of unrelated) assert.equal(client.getQueryState(key).isInvalidated, false);
});

test('filter changes stop unsent actions without changing the outcome of an already-started write', async t => {
  const wait = deferred();
  const fixture = harness(t, { write: () => wait.promise });
  const actions = fixture.render();
  const review = await actions.prepare([first, second]);
  let current = true;
  const operation = actions.run({ review, action: moved, isCurrent: () => current });
  await turn();
  assert.equal(fixture.writes.length, 1);
  current = false;
  wait.resolve(lead(first, { stage_id: nextStage }));
  const result = await operation;
  assert.deepEqual(result.succeededIds, [first]);
  assert.deepEqual(result.unstartedIds, [second]);
});

test('an already-dispatched status update reconciles the original tenant cache after navigation', async t => {
  const wait = deferred();
  const fixture = harness(t, { read: id => lead(id, { deal_status: 'won' }), write: () => wait.promise });
  const client = fixture.request.client();
  const property = ['property', 'org-a', uuid(9)];
  client.setQueryData(property, 'reserved');
  const actions = fixture.render();
  const review = await actions.prepare([first]);
  const run = actions.run({ review, action: { kind: 'deal-status', status: 'open' } });
  await turn();
  fixture.request.unmount();
  wait.resolve(lead(first));
  const result = await run;
  assert.deepEqual(result.succeededIds, [first]);
  assert.equal(client.getQueryState(property).isInvalidated, true);
  assert.deepEqual(fixture.events, []);
});
