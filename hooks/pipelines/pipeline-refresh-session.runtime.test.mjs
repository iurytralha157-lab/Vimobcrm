import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { productionDeclaration, evaluateProduction, deferred, turn } from '../leads/lead-request-runtime-fixture.mjs';

const screen = 'components/features/pipelines/PipelinesScreen.tsx';
// Error-banner recovery now shares the critical recovery action; its actual JSX
// callbacks, retry mutex and lifecycle are covered in pipeline-catalog-recovery.
// The toolbar keeps the independent manual refresh/success notification path.
const handlers = ['handleManualRefresh'];

async function runtime(handlerName) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  const identity = { org: 'org-a', actor: 'actor-a', sid: 'sid-a', pipeline: 'pipeline-a', search: '' };
  const requests = [], notices = [], busy = [], references = [], gates = [];
  let slow = false, error, accessClient = client, mounted = true, referenceGate;
  const slots = []; let cursor = 0;
  const changed = (previous, next) => !previous || next.some((value, index) => !Object.is(value, previous[index]));
  const dependencies = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useState: initial => { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, value => { slots[index].value = value; busy.push(value !== null); }]; },
    useQueryClient: () => accessClient,
    useAuth: () => ({ activeOrganization: { organizationId: identity.org }, user: identity.actor ? { id: identity.actor } : null,
      session: identity.actor ? { sid: identity.sid, tokenVersion: identity.tokenVersion } : null }),
    captureLeadRequestIntent, captureQueryClientAccess,
    getGlobalSignOutSessionId: session => session?.sid,
    getVimobAPIAccessTokenUserId: () => identity.actor,
    getVimobAPIAccessTokenSessionId: () => identity.actor ? identity.sid : null,
  };
  dependencies.useCallback = (fn, deps) => dependencies.useMemo(() => fn, deps);
  for (const [path, name] of [
    ['hooks/leads/use-lead-request-scope.ts', 'useLeadRequestScope'],
    ['hooks/pipelines/use-pipeline-editor-visit.ts', 'usePipelineEditorVisit'],
  ]) dependencies[name] = evaluateProduction(productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === name), dependencies, name);
  const refreshHook = evaluateProduction(productionDeclaration('hooks/pipelines/use-pipeline-refresh.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePipelineRefresh'), dependencies, 'usePipelineRefresh');
  const key = () => ['synthetic-refresh-board', identity.org, identity.actor, identity.sid, identity.pipeline, identity.search];
  client.setQueryData(key(), { data: 'initial' });
  const options = () => ({ queryKey: key(), enabled: Boolean(identity.org && identity.actor), refetchOnMount: false, queryFn: async ({ signal }) => {
    const request = { key: key(), signal, gate: slow ? deferred() : null };
    requests.push(request); if (request.gate) await request.gate.promise;
    if (error) throw error;
    return { data: request.key.join(':') };
  } });
  const observer = new QueryObserver(client, options());
  const unsubscribe = observer.subscribe(() => {});
  const reference = name => async () => { references.push(name); if (referenceGate) await referenceGate.promise; return { isError: false, error: null }; };
  const render = () => {
    observer.setOptions(options());
    cursor = 0;
    const refresh = refreshHook(JSON.stringify(key()));
    const actions = Object.fromEntries(handlers.map(name => {
      const declaration = productionDeclaration(screen, node => ts.isVariableDeclaration(node) && node.name.getText() === name);
      return [name, evaluateProduction('const ' + declaration, {
      useCallback: fn => fn, setIsRefreshing: value => busy.push(value),
      runPipelineRefresh: refresh.run,
      refetchPipelines: reference('pipelines'), refetchLeadVisibility: reference('visibility'), refetchTeams: reference('teams'),
      refetchLeadMetaFilters: reference('meta'), refetchTags: reference('tags'), refetchBaseStages: reference('stages'),
      refetchStageAutomations: reference('automations'), canRefreshStageAutomations: true,
      sharedFilters: { teamId: 'team-a' }, shouldLoadFilterOptions: true,
      selectedPipelineId: identity.pipeline, shouldLoadPipelineLeads: true,
      refetch: () => observer.refetch(),
      toast: Object.fromEntries(['success', 'error'].map(kind => [kind, message => notices.push({ kind, message })])),
      getPipelineErrorMessage: value => value.message,
      }, name)];
    }));
    return { actions, isRefreshing: refresh.isRefreshing };
  };
  render();
  return {
    client, observer, identity, requests, notices, busy, references, render,
    start: (name = handlerName) => render().actions[name](), slow: () => { slow = true; }, fail: value => { error = value; },
    isBusy: () => mounted && render().isRefreshing,
    pauseReferences: () => { referenceGate = deferred(); gates.push(referenceGate); return referenceGate; },
    clearReferencePause: () => { referenceGate = null; },
    replaceClient: () => { accessClient = new QueryClient(); render(); },
    unmount: () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); unsubscribe(); },
    async change(patch) { Object.assign(identity, patch); render(); await turn(); },
    close: async () => { mounted = false; slots.forEach(slot => slot?.cleanup?.()); unsubscribe(); for (const gate of gates) gate.resolve(); for (const request of requests) request.gate?.resolve(); await turn(); client.clear(); accessClient.clear(); },
  };
}

for (const name of handlers) {
  for (const [label, patches] of [
    ['actor', [{ actor: 'actor-b' }]], ['organization', [{ org: 'org-b' }]],
    ['pipeline', [{ pipeline: 'pipeline-b' }]], ['logout', [{ actor: null, sid: null }]],
    ['session ABA', [{ sid: 'sid-b' }, { sid: 'sid-a' }]],
    ['resource ABA', [{ pipeline: 'pipeline-b' }, { pipeline: 'pipeline-a' }]],
  ]) test(`${name}: obsolete ${label} visit cannot publish`, async () => {
    const h = await runtime(name); try {
      h.slow(); const pending = h.start(); await turn();
      for (const patch of patches) await h.change(patch);
      for (const request of h.requests) request.gate?.resolve();
      await pending; assert.deepEqual(h.notices, []);
    } finally { await h.close(); }
  });
  test(`${name}: QueryClient replacement retires the old operation`, async () => {
    const h = await runtime(name); try {
      h.slow(); const pending = h.start(); await turn(); h.replaceClient();
      for (const request of h.requests) request.gate?.resolve();
      await pending; assert.deepEqual(h.notices, []);
    } finally { await h.close(); }
  });
  test(`${name}: unmount retires notices and state delivery`, async () => {
    const h = await runtime(name); try {
      h.slow(); const pending = h.start(); await turn(); h.unmount();
      const before = h.busy.length; await pending;
      assert.deepEqual(h.notices, []); assert.equal(h.busy.length, before);
    } finally { await h.close(); }
  });
  test(`${name}: token renewal in the same SID preserves success`, async () => {
    const h = await runtime(name); try {
      h.slow(); const pending = h.start(); await turn(); await h.change({ tokenVersion: 2 });
      assert.equal(h.requests.length, 1); h.requests[0].gate.resolve(); await pending;
      assert.equal(h.notices.length, 1); assert.equal(h.notices[0].kind, 'success');
      assert.equal(h.isBusy(), false);
    } finally { await h.close(); }
  });
  test(`${name}: current query failure reports once and releases its busy`, async () => {
    const h = await runtime(name); try {
      h.fail(new Error('Synthetic refresh failure')); await h.start();
      assert.equal(h.notices.length, 1); assert.equal(h.notices[0].kind, 'error');
      assert.match(h.notices[0].message, /Synthetic refresh failure/); assert.equal(h.isBusy(), false);
    } finally { await h.close(); }
  });
}

test('repeated toolbar refresh clicks share one mutex in the same visit', async () => {
  const h = await runtime('handleManualRefresh'); try {
    h.slow(); const one = h.start(); await turn();
    const references = h.references.length;
    const two = h.start(); const three = h.start(); await turn();
    assert.equal(h.requests.length, 1); assert.equal(h.references.length, references);
    assert.equal(h.isBusy(), true); h.requests[0].gate.resolve(); await Promise.all([one, two, three]);
    assert.equal(h.notices.length, 1); assert.deepEqual(h.busy, [true, false]);
  } finally { await h.close(); }
});

for (const result of ['resolve', 'reject']) test(`old ${result} cannot release a new visit's busy`, async () => {
  const h = await runtime('handleManualRefresh'); try {
    h.slow(); const oldReferences = h.pauseReferences();
    const one = h.start(); await turn(); await h.change({ sid: 'sid-b' });
    h.clearReferencePause(); const two = h.start(); await turn();
    assert.equal(h.isBusy(), true); const before = h.busy.length;
    if (result === 'resolve') oldReferences.resolve(); else oldReferences.reject(new Error('Synthetic stale reference failure'));
    await one; assert.deepEqual(h.notices, []); assert.equal(h.busy.length, before); assert.equal(h.isBusy(), true);
    for (const request of h.requests) request.gate?.resolve(); await two;
    assert.equal(h.notices.length, 1); assert.equal(h.notices[0].kind, 'success'); assert.equal(h.isBusy(), false);
  } finally { await h.close(); }
});

for (const name of handlers) {
  for (const [label, patch] of [['session replacement', { sid: 'sid-b' }], ['search replacement', { search: 'new' }]]) {
    test(`${name}: no delivery from cancelled old refresh after ${label}`, async () => {
      const h = await runtime(name); try {
        h.slow(); const pending = h.start(); await turn();
        const old = h.requests[0]; assert.ok(old?.gate);
        await h.change(patch); await pending;
        assert.equal(old.signal.aborted, true, 'the real QueryObserver must cancel A');
        assert.equal(h.observer.getCurrentResult().fetchStatus, 'fetching', 'automatic query B is still pending');
        assert.deepEqual(h.notices, [], 'cancelled old work cannot announce B as complete');
      } finally { await h.close(); }
    });
  }
  test(`${name}: current successful refresh still reports once`, async () => {
    const h = await runtime(name); try {
      await h.start();
      assert.equal(h.notices.length, 1); assert.equal(h.notices[0].kind, 'success');
      assert.deepEqual(h.busy, [true, false]);
    } finally { await h.close(); }
  });
}
