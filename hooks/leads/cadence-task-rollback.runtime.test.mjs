import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { MutationObserver, QueryClient, QueryObserver } from '@tanstack/query-core';
import { leadHookRuntime, deferred, turn } from './lead-request-runtime-fixture.mjs';
import * as history from '../use-optimistic-lead-history.ts';

const cadenceKey = (lead = 'lead-a', org = 'org-a') => ['lead-cadence-state', org, lead, 'stage-a'];
const taskKey = (lead = 'lead-a') => ['lead-tasks', lead];
const historyKey = (lead = 'lead-a') => ['lead-history-v2', lead];
const rejected = message => Object.assign(new Error(message), { status: 400 });
const task = (id, lead = 'lead-a', patch = {}) => ({ id, lead_id: lead, title: id, type: 'call', day_offset: 0,
  is_done: false, done_at: null, done_by: null, outcome: null, outcome_notes: null,
  due_date: '2099-01-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', ...patch });
function cadence(lead = 'lead-a', tasks = [task('task-a'), task('task-b')]) {
  const rows = tasks.map(row => ({ ...row, status: row.is_done ? 'completed' : 'pending', due_at: row.due_date }));
  const pending = rows.filter(row => !row.is_done);
  return { lead_id: lead, stage_id: 'stage-a', stage_name: 'Synthetic', deal_status: 'open', cadence_enabled: true,
    tasks: rows, summary: { total: rows.length, completed: rows.length - pending.length, pending: pending.length,
      overdue: 0, next_task_id: pending[0]?.id ?? null } };
}
function fixture() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, refetchOnMount: false }, mutations: { retry: false } } });
  const requests = [], reads = [], notices = [], invalidations = [], scopes = [];
  let currentScope, response = async input => task(input.taskId || 'created', input.leadId, { is_done: true });
  const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = filters => { invalidations.push(filters); return invalidate(filters); };
  const source = readFileSync(process.env.CADENCE_ROLLBACK_SOURCE || 'hooks/use-lead-tasks.ts', 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const loaded = { exports: {} };
  const dependencies = {
    '@tanstack/react-query': { useQueryClient: () => client, useMutation: options => options, useQuery: options => options },
    '@/hooks/leads/use-lead-request-scope': { useLeadRequestScope: () => currentScope.scope() },
    '@/hooks/use-optimistic-lead-history': history,
    '@/lib/api/lead-tasks': { leadTasksAPI: { list: async lead => {
      reads.push({ family: 'tasks', lead }); return [task('task-a', lead), task('task-b', lead)];
    }, completeCadence: async (input, intent) => {
      requests.push({ input, intent }); return response(input, intent);
    } } },
    sonner: { toast: { error: text => notices.push(text), success: text => notices.push(text) } },
  };
  vm.runInNewContext(`(function(require,module,exports){${output.outputText}\n})`, { Symbol, WeakMap, Map, Set, Date })(
    name => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; }, loaded, loaded.exports);
  const cadenceModule = { exports: {} }, cadenceOutput = ts.transpileModule(readFileSync('hooks/leads/use-lead-cadence-state.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(`(function(require,module,exports){${cadenceOutput.outputText}\n})`)(name => {
    if (name === '@tanstack/react-query') return dependencies[name];
    assert.equal(name, '@/lib/api/lead-cadence-state');
    return { leadCadenceStateAPI: { get: async (lead, org) => { reads.push({ family: 'cadence', lead, org }); return cadence(lead); } } };
  }, cadenceModule, cadenceModule.exports);
  const render = scope => { currentScope = scope; return loaded.exports.useCompleteCadenceTask(); };
  return {
    client, requests, reads, notices, invalidations,
    taskQuery: lead => loaded.exports.useLeadTasks(lead),
    cadenceQuery: (lead, org, stage) => cadenceModule.exports.useLeadCadenceState(lead, org, stage),
    respond: next => { response = next; },
    seed(lead = 'lead-a', org = 'org-a', tasks = [task('task-a', lead), task('task-b', lead)]) {
      client.setQueryData(taskKey(lead), tasks);
      client.setQueryData(cadenceKey(lead, org), cadence(lead, tasks));
      client.setQueryData(historyKey(lead), [{ id: `server-${lead}`, timestamp: '2026-10-01T00:00:00Z' }]);
    },
    hook() {
      const scope = leadHookRuntime(client); scopes.push(scope);
      const observer = new MutationObserver(client, render(scope));
      return { observer, scope, render: () => observer.setOptions(render(scope)),
        mutate: input => observer.mutate(input).then(data => ({ data }), error => ({ error })) };
    },
    close() { for (const scope of scopes) scope.unmount(); client.clear(); },
  };
}
const done = (f, id, lead = 'lead-a') => f.client.getQueryData(taskKey(lead)).find(row => row.id === id).is_done;
const cadenceDone = (f, id, lead = 'lead-a') => f.client.getQueryData(cadenceKey(lead)).tasks.find(row => row.id === id).is_done;
const optimisticEvents = (f, lead = 'lead-a') => f.client.getQueryData(historyKey(lead)).filter(row => row.id.startsWith('optimistic-cadence-'));
async function started(f, count = 1) { for (let i = 0; i < 20 && f.requests.length < count; i++) await turn(); assert.equal(f.requests.length, count); }

test('clean failure reverses only its task and leaves another lead and tenant untouched', async () => {
  const f = fixture(); try {
    f.seed(); f.seed('lead-b'); f.seed('lead-a', 'org-b');
    const foreign = f.client.getQueryData(cadenceKey('lead-a', 'org-b'));
    const waiting = deferred(); f.respond(() => waiting.promise); const hook = f.hook();
    const pending = hook.mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const newerB = { ...f.client.getQueryData(cadenceKey('lead-b')), server_marker: 'newer-b' };
    f.client.setQueryData(cadenceKey('lead-b'), newerB);
    assert.equal(done(f, 'task-a'), true); assert.equal(cadenceDone(f, 'task-a'), true);
    waiting.reject(rejected('Synthetic rejected completion')); assert.ok((await pending).error);
    assert.equal(done(f, 'task-a'), false); assert.equal(cadenceDone(f, 'task-a'), false);
    assert.deepEqual(f.client.getQueryData(cadenceKey('lead-b')), newerB);
    assert.equal(f.client.getQueryData(cadenceKey('lead-a', 'org-b')), foreign);
    assert.equal(f.client.getQueryState(cadenceKey('lead-b')).isInvalidated, false);
    assert.equal(f.client.getQueryState(cadenceKey('lead-a', 'org-b')).isInvalidated, false);
    assert.equal(optimisticEvents(f).length, 0);
    assert.equal(f.requests[0].input.organizationId, 'org-a');
    assert.equal(f.requests[0].intent.expectedUserId, 'actor-a'); assert.equal(f.requests[0].intent.expectedSessionId, 'sid-a');
  } finally { f.close(); }
});

for (const sameLead of [false, true]) test(`two pending completions preserve the other ${sameLead ? 'item of the same lead' : 'lead'}`, async () => {
  const f = fixture(); try {
    f.seed(); if (!sameLead) f.seed('lead-b');
    const a = deferred(), b = deferred(); f.respond(input => input.taskId === 'task-a' && input.leadId === 'lead-a' ? a.promise : b.promise);
    const first = f.hook(), second = f.hook();
    const pendingA = first.mutate({ leadId: 'lead-a', taskId: 'task-a', outcome: 'a' }); await started(f);
    const leadB = sameLead ? 'lead-a' : 'lead-b', taskB = sameLead ? 'task-b' : 'task-a';
    const pendingB = second.mutate({ leadId: leadB, taskId: taskB, outcome: 'b' }); await started(f, 2);
    a.reject(rejected('A failed')); await pendingA;
    assert.equal(done(f, 'task-a'), false); assert.equal(cadenceDone(f, 'task-a'), false);
    assert.equal(done(f, taskB, leadB), true); assert.equal(cadenceDone(f, taskB, leadB), true);
    if (sameLead) {
      const summary = f.client.getQueryData(cadenceKey()).summary;
      assert.equal(summary.completed, 1); assert.equal(summary.pending, 1); assert.equal(summary.next_task_id, 'task-a');
    }
    assert.equal(optimisticEvents(f, leadB).length, 1);
    b.resolve(task(taskB, leadB, { is_done: true })); assert.ok((await pendingB).data);
  } finally { f.close(); }
});

test('a manual update of another item survives rollback in both projections and their summary', async () => {
  const f = fixture(); try {
    f.seed(); const wait = deferred(); f.respond(() => wait.promise);
    const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const update = rows => rows.map(row => row.id === 'task-b' ? { ...row, title: 'Newer B', is_done: true, status: 'completed' } : row);
    f.client.setQueryData(taskKey(), update);
    f.client.setQueryData(cadenceKey(), state => ({ ...state, tasks: update(state.tasks),
      summary: { ...state.summary, completed: 2, pending: 0, overdue: 0, next_task_id: null }, server_marker: 'keep' }));
    wait.reject(rejected('A failed')); await pending;
    assert.equal(done(f, 'task-a'), false); assert.equal(done(f, 'task-b'), true);
    const state = f.client.getQueryData(cadenceKey()); assert.equal(state.server_marker, 'keep');
    assert.equal(state.tasks.find(row => row.id === 'task-b').title, 'Newer B');
    assert.equal(state.summary.completed, 1); assert.equal(state.summary.pending, 1);
  } finally { f.close(); }
});

for (const failFirst of [true, false]) test(`overlapping same-item failures do not restore another optimistic baseline (${failFirst ? 'A first' : 'B first'})`, async () => {
  const f = fixture(); try {
    f.seed(); const a = deferred(), b = deferred(); let calls = 0; f.respond(() => ++calls === 1 ? a.promise : b.promise);
    const first = f.hook(), second = f.hook();
    const pendingA = first.mutate({ leadId: 'lead-a', taskId: 'task-a', outcome: 'a' }); await started(f);
    const pendingB = second.mutate({ leadId: 'lead-a', taskId: 'task-a', outcome: 'b' }); await started(f, 2);
    const beforeFailure = f.client.getQueryData(cadenceKey());
    (failFirst ? a : b).reject(rejected('First failure')); await (failFirst ? pendingA : pendingB);
    assert.equal(f.client.getQueryData(cadenceKey()), beforeFailure); assert.equal(optimisticEvents(f).length, 1);
    (failFirst ? b : a).reject(rejected('Second failure')); await (failFirst ? pendingB : pendingA);
    assert.equal(f.client.getQueryData(cadenceKey()), beforeFailure); assert.equal(optimisticEvents(f).length, 0);
    assert.equal(f.client.getQueryState(cadenceKey()).isInvalidated, true);
    assert.equal(f.client.getQueryState(taskKey()).isInvalidated, true);
    await f.client.fetchQuery({ queryKey: cadenceKey(), queryFn: async () => cadence(), staleTime: 0 });
    assert.equal(cadenceDone(f, 'task-a'), false);
  } finally { f.close(); }
});

for (const identical of [false, true]) test(`a completed server read supersedes rollback even when ${identical ? 'structural sharing retains identical task objects' : 'the server changed the task'}`, async () => {
  const f = fixture(); try {
    f.seed(); const waiting = deferred(); f.respond(() => waiting.promise);
    const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const list = structuredClone(f.client.getQueryData(taskKey())), state = structuredClone(f.client.getQueryData(cadenceKey()));
    if (!identical) { list[0].title = 'Canonical newer'; state.tasks[0].title = 'Canonical newer'; }
    await f.client.fetchQuery({ queryKey: taskKey(), queryFn: async () => list, staleTime: 0 });
    await f.client.fetchQuery({ queryKey: cadenceKey(), queryFn: async () => state, staleTime: 0 });
    const canonicalList = f.client.getQueryData(taskKey()), canonicalState = f.client.getQueryData(cadenceKey());
    waiting.reject(rejected('Older request failed')); await pending;
    assert.equal(f.client.getQueryData(taskKey()), canonicalList); assert.equal(f.client.getQueryData(cadenceKey()), canonicalState);
    assert.equal(done(f, 'task-a'), true); assert.equal(cadenceDone(f, 'task-a'), true);
  } finally { f.close(); }
});

for (const replacement of ['organization', 'session', 'unmount']) test(`retired ${replacement} uses captured caches without refetch or late notices`, async () => {
  const f = fixture(); try {
    f.seed(); const waiting = deferred(); f.respond(() => waiting.promise); const hook = f.hook();
    const pending = hook.mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    if (replacement === 'unmount') hook.scope.unmount();
    else { hook.scope.switchTo(replacement === 'organization' ? 'org-b' : 'org-a', 'actor-a', replacement === 'session' ? 'sid-b' : 'sid-a'); hook.render(); }
    const newest = { ...f.client.getQueryData(cadenceKey()), server_marker: 'new-context' };
    if (replacement !== 'unmount') f.client.setQueryData(cadenceKey(), newest);
    waiting.reject(rejected('Late failure')); await pending;
    if (replacement === 'unmount') assert.equal(cadenceDone(f, 'task-a'), false);
    else assert.equal(f.client.getQueryData(cadenceKey()), newest);
    assert.deepEqual(f.notices, []); assert.equal(optimisticEvents(f).length, 0);
    assert.ok(f.invalidations.length > 0); assert.ok(f.invalidations.every(filters => filters.refetchType === 'none'));
    assert.equal(f.requests[0].intent.signal.aborted, true);
  } finally { f.close(); }
});

test('uncached and template tasks do not create an empty list; a foreign explicit org never reaches transport', async () => {
  const f = fixture(); try {
    const hook = f.hook(); const result = await hook.mutate({ leadId: 'lead-a', templateTaskId: 'template-a' });
    assert.ok(result.data); assert.equal(f.client.getQueryData(taskKey()), undefined);
    const rejected = await hook.mutate({ leadId: 'lead-a', taskId: 'task-a', organizationId: 'org-b' });
    assert.ok(rejected.error); assert.equal(f.requests.length, 1);
  } finally { f.close(); }
});

test('the later item can fail first without reverting the first pending completion', async () => {
  const f = fixture(); try {
    f.seed(); const a = deferred(), b = deferred(); f.respond(input => input.taskId === 'task-a' ? a.promise : b.promise);
    const pendingA = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const pendingB = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-b' }); await started(f, 2);
    b.reject(rejected('B rejected')); await pendingB;
    assert.equal(done(f, 'task-a'), true); assert.equal(cadenceDone(f, 'task-a'), true);
    assert.equal(done(f, 'task-b'), false); assert.equal(cadenceDone(f, 'task-b'), false);
    const summary = f.client.getQueryData(cadenceKey()).summary;
    assert.equal(summary.completed, 1); assert.equal(summary.pending, 1); assert.equal(summary.next_task_id, 'task-b');
    a.resolve(task('task-a', 'lead-a', { is_done: true })); assert.ok((await pendingA).data);
  } finally { f.close(); }
});

for (const winner of ['first', 'second']) test(`a same-item ${winner} success cannot be undone by its overlapping failure`, async () => {
  const f = fixture(); try {
    f.seed(); const a = deferred(), b = deferred(); let calls = 0; f.respond(() => ++calls === 1 ? a.promise : b.promise);
    const pendingA = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a', outcome: 'same' }); await started(f);
    const pendingB = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a', outcome: 'same' }); await started(f, 2);
    const success = winner === 'first' ? a : b, failure = winner === 'first' ? b : a;
    success.resolve(task('task-a', 'lead-a', { is_done: true })); await (winner === 'first' ? pendingA : pendingB);
    failure.reject(rejected('Other request rejected')); await (winner === 'first' ? pendingB : pendingA);
    assert.equal(done(f, 'task-a'), true); assert.equal(cadenceDone(f, 'task-a'), true);
    assert.equal(optimisticEvents(f).length, 1); assert.equal(f.client.getQueryState(cadenceKey()).isInvalidated, true);
  } finally { f.close(); }
});

test('an already invalidated baseline is reconciled instead of restored', async () => {
  const f = fixture(); try {
    f.seed(); await f.client.invalidateQueries({ queryKey: taskKey(), refetchType: 'none' });
    await f.client.invalidateQueries({ queryKey: cadenceKey(), refetchType: 'none' });
    const waiting = deferred(); f.respond(() => waiting.promise);
    const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const before = f.client.getQueryData(cadenceKey()); waiting.reject(rejected('Rejected')); await pending;
    assert.equal(f.client.getQueryData(cadenceKey()), before); assert.equal(done(f, 'task-a'), true);
    assert.equal(f.client.getQueryState(cadenceKey()).isInvalidated, true); assert.equal(optimisticEvents(f).length, 0);
  } finally { f.close(); }
});

for (const error of [new Error('Response lost after commit'), Object.assign(new Error('Gateway timeout'), { status: 504 }), Object.assign(new Error('Request timeout'), { status: 408 })]) {
  test(`uncertain ${error.message} does not undo a possibly accepted completion`, async () => {
    const f = fixture(); try {
      f.seed(); const waiting = deferred(); f.respond(() => waiting.promise);
      const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
      const before = f.client.getQueryData(cadenceKey()); waiting.reject(error); await pending;
      assert.equal(f.client.getQueryData(cadenceKey()), before); assert.equal(done(f, 'task-a'), true);
      assert.equal(f.client.getQueryState(cadenceKey()).isInvalidated, true); assert.equal(optimisticEvents(f).length, 0);
    } finally { f.close(); }
  });
}

test('removed and recreated query identities cannot be restored by an older failure', async () => {
  const f = fixture(); try {
    f.seed(); const waiting = deferred(); f.respond(() => waiting.promise);
    const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    f.client.removeQueries({ queryKey: taskKey(), exact: true }); f.client.removeQueries({ queryKey: cadenceKey(), exact: true });
    f.seed('lead-a', 'org-a', [task('task-a', 'lead-a', { title: 'Replacement query', is_done: true })]);
    const newest = f.client.getQueryData(cadenceKey()); waiting.reject(rejected('Older rejected')); await pending;
    assert.equal(f.client.getQueryData(cadenceKey()), newest); assert.equal(done(f, 'task-a'), true);
  } finally { f.close(); }
});

test('task, lead and outcome are captured before cancellation waits and used by transport and invalidation', async () => {
  const f = fixture(); try {
    f.seed(); const gate = deferred(), entered = deferred(), cancel = f.client.cancelQueries.bind(f.client);
    f.client.cancelQueries = filters => { entered.resolve(); return cancel(filters).then(() => gate.promise); };
    const hook = f.hook(), input = { leadId: 'lead-a', taskId: 'task-a', outcome: 'captured' };
    const pending = hook.mutate(input); await entered.promise;
    Object.assign(input, { leadId: 'lead-b', taskId: 'task-b', outcome: 'replacement' }); gate.resolve();
    assert.ok((await pending).data); assert.equal(f.requests[0].input.leadId, 'lead-a');
    assert.equal(f.requests[0].input.taskId, 'task-a'); assert.equal(f.requests[0].input.outcome, 'captured');
    assert.ok(f.invalidations.some(filters => filters.queryKey?.[0] === 'lead-tasks' && filters.queryKey[1] === 'lead-a'));
    assert.equal(f.invalidations.some(filters => filters.queryKey?.[1] === 'lead-b'), false);
  } finally { f.close(); }
});

test('a confirmed POST finishes without waiting for the following GET and a failed GET never rolls it back', async () => {
  const f = fixture(); let unsubscribe; try {
    f.seed(); const read = deferred(), reading = deferred();
    const query = new QueryObserver(f.client, { queryKey: cadenceKey(), staleTime: Infinity,
      queryFn: () => { reading.resolve(); return read.promise; } });
    unsubscribe = query.subscribe(() => {});
    const hook = f.hook(), pending = hook.mutate({ leadId: 'lead-a', taskId: 'task-a' });
    await reading.promise;
    const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('write still waiting'), 1000))]);
    assert.notEqual(result, 'write still waiting'); assert.ok(result.data); assert.equal(hook.observer.getCurrentResult().status, 'success');
    read.reject(new Error('GET unavailable after accepted POST')); await turn(); await turn();
    assert.equal(hook.observer.getCurrentResult().status, 'success'); assert.equal(cadenceDone(f, 'task-a'), true);
    assert.equal(f.client.getQueryState(cadenceKey()).status, 'error'); assert.equal(f.notices.length, 0);
  } finally { unsubscribe?.(); f.close(); }
});

for (const family of ['tasks', 'cadence']) test(`a new canonical ${family} read also retires rollback in the sibling projection`, async () => {
  const f = fixture(); try {
    f.seed(); const waiting = deferred(); f.respond(() => waiting.promise);
    const pending = f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    const key = family === 'tasks' ? taskKey() : cadenceKey();
    const result = structuredClone(f.client.getQueryData(key));
    await f.client.fetchQuery({ queryKey: key, queryFn: async () => result, staleTime: 0 });
    const siblingKey = family === 'tasks' ? cadenceKey() : taskKey(), sibling = f.client.getQueryData(siblingKey);
    waiting.reject(rejected('Older completion rejected')); await pending;
    assert.equal(f.client.getQueryData(siblingKey), sibling); assert.equal(done(f, 'task-a'), true);
    assert.equal(cadenceDone(f, 'task-a'), true); assert.equal(f.client.getQueryState(siblingKey).isInvalidated, true);
  } finally { f.close(); }
});

test('a current 403 cannot bypass server authorization and rolls back only the owned optimistic item', async () => {
  const f = fixture(); try {
    f.seed(); f.respond(async () => { throw Object.assign(new Error('Operation forbidden'), { status: 403 }); });
    const result = await f.hook().mutate({ leadId: 'lead-a', taskId: 'task-a' });
    assert.equal(result.error.status, 403); assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].input.organizationId, 'org-a'); assert.equal(f.requests[0].intent.expectedSessionId, 'sid-a');
    assert.equal(done(f, 'task-a'), false); assert.equal(cadenceDone(f, 'task-a'), false);
    assert.equal(done(f, 'task-b'), false); assert.equal(optimisticEvents(f).length, 0);
  } finally { f.close(); }
});

test('closing after an uncertain completion and reopening refetches both stale projections with real default mount-refetch disabled', async () => {
  const f = fixture(), subscriptions = []; try {
    f.seed(); const waiting = deferred(); f.respond(() => waiting.promise); const hook = f.hook();
    const pending = hook.mutate({ leadId: 'lead-a', taskId: 'task-a' }); await started(f);
    hook.scope.unmount(); waiting.reject(new Error('Response lost; write outcome unknown')); await pending;
    assert.equal(done(f, 'task-a'), true); assert.equal(cadenceDone(f, 'task-a'), true);
    assert.equal(f.reads.length, 0); assert.ok(f.invalidations.every(filters => filters.refetchType === 'none'));
    assert.equal(f.client.getDefaultOptions().queries.refetchOnMount, false);
    const taskQuery = new QueryObserver(f.client, f.taskQuery('lead-a'));
    const cadenceQuery = new QueryObserver(f.client, f.cadenceQuery('lead-a', 'org-a', 'stage-a'));
    subscriptions.push(taskQuery.subscribe(() => {}), cadenceQuery.subscribe(() => {}));
    for (let attempt = 0; attempt < 20 && f.reads.length < 2; attempt++) await turn();
    assert.deepEqual(f.reads, [{ family: 'tasks', lead: 'lead-a' }, { family: 'cadence', lead: 'lead-a', org: 'org-a' }]);
    await turn(); assert.equal(done(f, 'task-a'), false); assert.equal(cadenceDone(f, 'task-a'), false);
    assert.equal(optimisticEvents(f).length, 0);
  } finally { for (const unsubscribe of subscriptions) unsubscribe(); f.close(); }
});
