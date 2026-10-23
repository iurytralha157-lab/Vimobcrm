import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import ts from 'typescript';
import { QueryClient } from '@tanstack/query-core';
import { activateQueryClientAccess, captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { evaluateProduction, productionDeclaration, turn } from './lead-request-runtime-fixture.mjs';
import { firstResponseFeedbackRuntime } from './first-response-feedback-runtime-fixture.mjs';

// Real navigation/chat handlers and request/detail scopes, with deterministic
// React lifecycle, deferred microtasks and inert chat/transport boundaries.
// No browser, environment credentials, CRM API, provider or database.
const source = process.env.CADENCE_MESSAGE_DETAIL_SOURCE || 'components/features/leads/LeadDetailDialog.tsx';
const variable = name => `const ${productionDeclaration(source, node => ts.isVariableDeclaration(node) && node.name.getText() === name)}`;
const declaration = (path, name) => productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
const getCadenceTaskType = evaluateProduction(declaration('components/features/leads/lead-detail/utils.ts', 'getCadenceTaskType'), {}, 'getCadenceTaskType');
const token = (actor, sid) => `header.${Buffer.from(JSON.stringify({ sub: actor, session_id: sid })).toString('base64url')}.synthetic`;
const open = new Set(); afterEach(() => { for (const r of open) r.close(); open.clear(); });
const task = Object.freeze({ id: 'task-a', template_task_id: 'template-a', type: 'message', title: 'Synthetic message',
  status: 'pending', is_done: false, observation: '', recommended_message: 'Olá {nome}; {empresa}; {email}',
  is_required: true, outcome_required: true });
function runtime(initial = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const retire = activateQueryClientAccess(client), slots = [], microtasks = [], effects = [], notices = [];
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  let cursor = 0, mounted = true, allowed = true, viewWhatsApp = true, operateWhatsApp = true, poolReadOnly = false, complete = true;
  let lead = { id: 'lead-a', name: 'Synthetic lead', empresa: 'Synthetic company', email: 'synthetic@example.invalid', phone: '5511000000000' };
  const state = { selectedTask: null, taskInspectOnly: false, roteiroOpen: false, outcomeOpen: false, taskForOutcome: null,
    cadence: { lead_id: 'lead-a', deal_status: 'open', tasks: [task] }, pending: { current: false } };
  const changed = (before, next) => !before || next.some((value, index) => !Object.is(value, before[index]));
  const deps = {
    captureQueryClientAccess, captureLeadRequestIntent, getGlobalSignOutSessionId,
    useAuth: () => auth, useQueryClient: () => client,
    getVimobAPIAccessTokenUserId: () => auth.user?.id ?? null,
    getVimobAPIAccessTokenSessionId: () => getGlobalSignOutSessionId(auth.session),
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) slots[index] = { keys, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, keys) => { const index = cursor++; if (changed(slots[index]?.keys, keys)) { slots[index]?.cleanup?.(); slots[index] = { keys, cleanup: setup() }; } },
  };
  const requestHook = evaluateProduction(declaration('hooks/leads/use-lead-request-scope.ts', 'useLeadRequestScope'), deps, 'useLeadRequestScope');
  const detailHook = evaluateProduction(declaration('hooks/leads/use-lead-detail-operation-scope.ts', 'useLeadDetailOperationScope'), deps, 'useLeadDetailOperationScope');
  const r = { client, state, effects, notices, retire,
    frame(patch = {}) {
      if ('org' in patch) auth.activeOrganization = { organizationId: patch.org };
      if ('actor' in patch) auth.user = patch.actor ? { id: patch.actor } : null;
      if ('sid' in patch || 'actor' in patch) auth.session = auth.user ? { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session)) } : null;
      if ('leadId' in patch) { lead = { ...lead, id: patch.leadId }; if (state.cadence) state.cadence.lead_id = lead.id; }
      if ('phone' in patch) lead = { ...lead, phone: patch.phone };
      if ('allowed' in patch) allowed = patch.allowed;
      if ('viewWhatsApp' in patch) viewWhatsApp = patch.viewWhatsApp;
      if ('operateWhatsApp' in patch) operateWhatsApp = patch.operateWhatsApp;
      if ('poolReadOnly' in patch) poolReadOnly = patch.poolReadOnly;
      if ('complete' in patch) complete = patch.complete;
      if ('dealStatus' in patch) state.cadence = patch.dealStatus === undefined ? undefined
        : { ...(state.cadence ?? { lead_id: lead.id, tasks: [task] }), deal_status: patch.dealStatus };
      if ('pending' in patch) state.pending.current = patch.pending;
      if ('inspectOnly' in patch) state.taskInspectOnly = patch.inspectOnly;
      cursor = 0;
      const requestScope = requestHook(), captureCadenceFeedbackOperation = detailHook(lead.id, auth.activeOrganization.organizationId,
        auth.user?.id ?? null, client, allowed && !poolReadOnly, getGlobalSignOutSessionId(auth.session));
      const dependencies = { requestScope, captureCadenceFeedbackOperation, canOperateLead: allowed && !poolReadOnly,
        taskInspectOnly: state.taskInspectOnly, cadenceActionPendingRef: state.pending,
        leadCadenceState: state.cadence, selectedTask: state.selectedTask, lead, localLead: lead,
        canOperateLeadWhatsApp: operateWhatsApp, canViewLeadWhatsApp: viewWhatsApp, poolReadOnly,
        getCadenceTaskType, OUTCOME_CADENCE_TASK_TYPES: ['call', 'message', 'email'],
        setTaskInspectOnly: value => { state.taskInspectOnly = value; },
        setSelectedTask: value => { state.selectedTask = value; }, setRoteiroDialogOpen: value => { state.roteiroOpen = value; },
        setTaskForOutcome: value => { state.taskForOutcome = value; }, setOutcomeDialogOpen: value => { state.outcomeOpen = value; },
        handleToggleCadenceTask: async value => { effects.push({ kind: 'complete', task: value }); return complete; },
        handleCloseLeadDetail: () => { effects.push({ kind: 'close' }); r.unmount(); },
        queueMicrotask: callback => microtasks.push(callback),
        openNewChatWithMessage: (...args) => effects.push({ kind: 'chat-message', args }),
        openNewChat: (...args) => effects.push({ kind: 'chat', args }),
        toast: Object.fromEntries(['info', 'error', 'warning'].map(kind => [kind, message => notices.push({ kind, message })])),
      };
      dependencies.openLeadWhatsApp = evaluateProduction(variable('openLeadWhatsApp'), dependencies, 'openLeadWhatsApp');
      r.click = evaluateProduction(variable('handleCadenceTaskClick'), dependencies, 'handleCadenceTaskClick');
      r.action = evaluateProduction(variable('handleRoteiroAction'), dependencies, 'handleRoteiroAction');
      r.openWhatsApp = dependencies.openLeadWhatsApp; return r;
    },
    flush() { while (microtasks.length) microtasks.shift()(); },
    unmount() { mounted = false; slots.forEach(slot => slot?.cleanup?.()); },
    close() { if (mounted) r.unmount(); retire(); client.clear(); },
  };
  r.frame(initial); open.add(r); return r;
}
const select = (r, selected = task) => { if (r.state.cadence) r.state.cadence.tasks = [selected]; r.click(selected); r.frame(); return r; };

for (const required of [true, false]) test(`message with recommended text offers separate actions when result ${required ? 'required' : 'optional'}`, () => {
  const r = select(runtime(), { ...task, outcome_required: required });
  assert.equal(r.state.roteiroOpen, true); assert.equal(r.state.selectedTask?.id, task.id);
  assert.equal(r.state.outcomeOpen, false); assert.deepEqual(r.effects, [], 'click must not open chat or complete the task');
});

for (const observation of ['', 'Read this synthetic script']) for (const required of [true, false]) {
  test(`message complete is explicit: script=${Boolean(observation)} required=${required}`, async () => {
    const selected = { ...task, observation, outcome_required: required }, r = select(runtime(), selected);
    await r.action('complete');
    assert.equal(r.state.roteiroOpen, false); assert.equal(r.state.selectedTask, null);
    assert.equal(r.state.outcomeOpen, required); assert.equal(r.state.taskForOutcome, required ? selected : null);
    assert.deepEqual(r.effects.map(value => value.kind), required ? [] : ['complete']);
  });
  test(`message prepare neither completes nor records result: script=${Boolean(observation)} required=${required}`, async () => {
    const selected = { ...task, observation, outcome_required: required }, r = select(runtime(), selected);
    await r.action('message');
    assert.deepEqual(r.effects.map(value => value.kind), ['close']); assert.equal(r.state.outcomeOpen, false);
    r.flush(); assert.deepEqual(r.effects.map(value => value.kind), ['close', 'chat-message']);
    assert.deepEqual(r.effects[1].args, ['5511000000000', 'Olá Synthetic lead; Synthetic company; synthetic@example.invalid', 'lead-a', 'Synthetic lead']);
  });
}

test('returning from chat without sending still exposes required result on a fresh opening', async () => {
  const r = select(runtime()); await r.action('message'); r.flush();
  const reopened = select(runtime()); await reopened.action('complete');
  assert.equal(reopened.state.outcomeOpen, true); assert.deepEqual(reopened.effects, []);
});
for (const patch of [{ phone: '' }, { operateWhatsApp: false }]) {
  test(`failed preparation ${JSON.stringify(patch)} keeps result action available`, async () => {
    const r = select(runtime(patch)); await r.action('message'); r.flush();
    assert.deepEqual(r.effects, []); assert.equal(r.state.roteiroOpen, true); assert.equal(r.state.selectedTask?.id, task.id);
    assert.equal(r.notices.length, 1); await r.action('complete'); assert.equal(r.state.outcomeOpen, true);
  });
}
for (const patch of [{ allowed: false }, { poolReadOnly: true }, { pending: true }, { dealStatus: 'won' }, { dealStatus: 'lost' }, { dealStatus: undefined }]) {
  test(`task click ${JSON.stringify(patch)} performs no action`, () => {
    const r = runtime(patch); r.click(task); assert.equal(r.state.roteiroOpen, false);
    assert.equal(r.state.outcomeOpen, false); assert.deepEqual(r.effects, []);
  });
}
for (const patch of [{ is_done: true }, { status: 'completed' }, { status: 'cancelled' }, { status: 'skipped' }]) {
  test(`inactive task ${JSON.stringify(patch)} cannot prepare or complete`, async () => {
    const r = runtime(); r.state.selectedTask = { ...task, ...patch }; r.state.cadence.tasks = [r.state.selectedTask]; r.frame();
    await r.action('message'); await r.action('complete');
    assert.deepEqual(r.effects, []); assert.equal(r.state.outcomeOpen, false);
  });
}
for (const patch of [{ allowed: false }, { pending: true }, { inspectOnly: true }, { dealStatus: 'won' }, { dealStatus: 'lost' }, { dealStatus: undefined }]) {
  test(`opened script revalidates ${JSON.stringify(patch)} before both actions`, async () => {
    const r = select(runtime()); r.frame(patch); await r.action('message'); await r.action('complete');
    assert.deepEqual(r.effects, []); assert.equal(r.state.outcomeOpen, false);
  });
}
for (const patch of [{ org: 'org-b' }, { actor: 'actor-b' }, { sid: 'sid-b' }, { leadId: 'lead-b' }, { allowed: false }]) {
  test(`retained script callbacks cannot act after ${JSON.stringify(patch)} or ABA`, async () => {
    const r = select(runtime()), old = r.action; r.frame(patch); r.frame({ org: 'org-a', actor: 'actor-a', sid: 'sid-a', leadId: 'lead-a', allowed: true });
    await old('message'); await old('complete'); r.flush();
    assert.deepEqual(r.effects, []); assert.equal(r.state.outcomeOpen, false);
  });
}
for (const patch of [{ org: 'org-b' }, { actor: 'actor-b' }, { sid: 'sid-b' }]) {
  test(`queued chat preparation cannot cross access after close: ${JSON.stringify(patch)}`, async () => {
    const r = select(runtime()); await r.action('message'); assert.deepEqual(r.effects.map(value => value.kind), ['close']);
    r.frame(patch); r.flush(); assert.deepEqual(r.effects.map(value => value.kind), ['close']);
  });
}
test('queued preparation cannot survive provider lease retirement even when identity returns', async () => {
  const r = select(runtime()); await r.action('message'); r.retire(); const retireNext = activateQueryClientAccess(r.client);
  r.flush(); assert.deepEqual(r.effects.map(value => value.kind), ['close']); retireNext();
});
test('ordinary close retains captured access until the prepared chat opens', async () => {
  const r = select(runtime()); await r.action('message'); r.flush();
  assert.deepEqual(r.effects.map(value => value.kind), ['close', 'chat-message']);
});
test('a completion rejected by canonical handler keeps the script and task selected', async () => {
  const r = select(runtime({ complete: false }), { ...task, outcome_required: false }); await r.action('complete');
  assert.equal(r.state.roteiroOpen, true); assert.equal(r.state.selectedTask?.id, task.id); assert.equal(r.state.outcomeOpen, false);
});
for (const mode of ['missing-task', 'wrong-lead', 'completed-task']) {
  test(`opened script refuses stale cadence resource: ${mode}`, async () => {
    const r = select(runtime());
    if (mode === 'missing-task') r.state.cadence.tasks = [];
    else if (mode === 'wrong-lead') r.state.cadence.lead_id = 'lead-b';
    else r.state.cadence.tasks = [{ ...task, is_done: true, status: 'completed' }];
    r.frame(); await r.action('message'); await r.action('complete');
    assert.deepEqual(r.effects, []); assert.equal(r.state.outcomeOpen, false);
  });
}
test('updated required-result rule uses current cadence task rather than selected snapshot', async () => {
  const r = select(runtime(), { ...task, outcome_required: false });
  const current = { ...task, title: 'Current rule', outcome_required: true };
  r.state.cadence.tasks = [current]; r.frame(); await r.action('complete');
  assert.equal(r.state.outcomeOpen, true); assert.equal(r.state.taskForOutcome, current); assert.deepEqual(r.effects, []);
});
test('updated recommended text uses current task without mutating selected snapshot', async () => {
  const original = { ...task }, r = select(runtime(), original);
  r.state.cadence.tasks = [{ ...task, recommended_message: 'Current text for {nome}' }]; r.frame();
  await r.action('message'); r.flush();
  assert.equal(r.effects.find(value => value.kind === 'chat-message').args[1], 'Current text for Synthetic lead');
  assert.equal(original.recommended_message, task.recommended_message);
});
test('optional captured-access guard refuses stale WhatsApp handoff before closing', () => {
  const r = runtime(); assert.equal(r.openWhatsApp('Synthetic prepared text', () => false), false);
  r.flush(); assert.deepEqual(r.effects, []);
});
test('existing view-only WhatsApp opening without prepared text keeps its original behavior', () => {
  const r = runtime({ viewWhatsApp: true, operateWhatsApp: false }); r.openWhatsApp(); r.flush();
  assert.deepEqual(r.effects.map(value => value.kind), ['close', 'chat']);
});
for (const [type, required] of [['call', true], ['email', true], ['note', false], ['message', true], ['message', false]]) {
  test(`no suggested text preserves ${type} required=${required} behavior`, async () => {
    const selected = { ...task, type, recommended_message: '', outcome_required: required }, r = runtime(); r.click(selected); await turn();
    assert.equal(r.state.roteiroOpen, false); assert.equal(r.state.outcomeOpen, required);
    assert.deepEqual(r.effects.map(value => value.kind), required ? [] : ['complete']);
  });
}

for (const outcome of ['replied', 'seen_no_reply', 'not_seen', 'no_whatsapp', 'scheduled']) {
  test(`message result ${outcome} uses canonical cadence completion without first-response fabrication`, async t => {
    const r = firstResponseFeedbackRuntime('popup'); t.after(() => r.close());
    const pending = r.confirmOutcome(outcome, 'Synthetic result notes', task);
    await r.until(() => r.byKind('complete').length === 1); const request = r.byKind('complete')[0];
    assert.equal(request.args[0].taskId, task.id); assert.equal(request.args[0].outcome, outcome);
    r.resolve(request); assert.equal((await pending).value, true);
    assert.equal(r.byKind('first-response').length, 0); assert.equal(r.byKind('activity').length, 0);
    assert.equal(r.state().scheduleOpen, outcome === 'scheduled');
  });
}
for (const failure of ['unknown', 'canonical-mismatch']) {
  test(`message ${failure} ACK retains task/result draft and never records first response`, async t => {
    const r = firstResponseFeedbackRuntime('popup'); t.after(() => r.close());
    const pending = r.confirmOutcome('replied', 'Synthetic message draft', task);
    await r.until(() => r.byKind('complete').length === 1); const request = r.byKind('complete')[0];
    if (failure === 'unknown') r.reject(request, 503);
    else r.resolve(request, { id: task.id, lead_id: 'lead-a', is_done: true, outcome: 'not_seen', outcome_notes: 'Different result' });
    const result = await pending; assert.ok(failure === 'unknown' ? result.error : result.value === false);
    assert.equal(r.state().outcomeOpen, true); assert.equal(r.state().taskForOutcome, task);
    assert.deepEqual(r.state().draft, { outcome: 'replied', notes: 'Synthetic message draft' });
    assert.equal(r.byKind('first-response').length, 0); assert.equal(r.state().scheduleOpen, false);
    if (failure === 'unknown') {
      const retry = r.confirmOutcome('replied', 'Synthetic message draft', task);
      await r.until(() => r.byKind('complete').length === 2); const repeated = r.byKind('complete')[1];
      assert.deepEqual(repeated.args[0], request.args[0], 'uncertain task completion retries the same task/result');
      r.resolve(repeated); assert.equal((await retry).value, true);
      assert.equal(r.byKind('activity').length, 0); assert.equal(r.byKind('first-response').length, 0);
      assert.equal(r.state().outcomeOpen, false);
    }
  });
}
for (const patch of [{ sid: 'sid-b' }, { lead: 'lead-b' }, { allowed: false }]) {
  test(`message ACK after visit retirement ${JSON.stringify(patch)} preserves old result and publishes no UI success`, async t => {
    const r = firstResponseFeedbackRuntime('popup'); t.after(() => r.close());
    const pending = r.confirmOutcome('replied', 'Synthetic retained draft', task);
    await r.until(() => r.byKind('complete').length === 1); const request = r.byKind('complete')[0];
    r.render(patch); r.stateWrites.length = 0; r.resolve(request);
    assert.equal((await pending).value, false); assert.equal(r.state().outcomeOpen, true);
    assert.deepEqual(r.state().draft, { outcome: 'replied', notes: 'Synthetic retained draft' });
    assert.equal(r.byKind('first-response').length, 0); assert.deepEqual(r.notices, []);
    assert.ok(r.stateWrites.every(write => write.field === 'cadence' && write.value === false));
  });
}
