import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import * as pipelineValidation from '../../lib/validation/pipelines.ts';
import * as commonValidation from '../../lib/validation/common.ts';
import { shouldRetryPipelineQuery, PIPELINE_READ_TIMEOUT_MS } from '../../lib/pipeline-reliability.ts';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { productionDeclaration, evaluateProduction, deferred, turn } from '../leads/lead-request-runtime-fixture.mjs';

const catalogHook = productionDeclaration('hooks/use-stages.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'usePipelines');
const apiAst = ts.createSourceFile('pipelines.ts', readFileSync('lib/api/pipelines.ts', 'utf8'), ts.ScriptTarget.Latest, true);
const apiSource = apiAst.statements.filter(n => !ts.isImportDeclaration(n) && !ts.isExportDeclaration(n)).map(n => n.getText(apiAst)).join('\n');
const org = '11111111-1111-4111-8111-111111111111';
const a = '22222222-2222-4222-8222-222222222222';
const b = '33333333-3333-4333-8333-333333333333';
const row = (id, isDefault = false) => ({ id, organizationId: org, name: id === a ? 'A' : 'B', isDefault,
  isActive: true, position: isDefault ? 0 : 1, createdAt: '2026-10-20T00:00:00Z', updatedAt: '2026-10-20T00:00:00Z' });
const unavailable = () => Object.assign(new Error('Synthetic catalog unavailable'), { status: 503, code: 'service_unavailable' });
const screenPath = 'components/features/pipelines/PipelinesScreen.tsx';
const screenAst = ts.createSourceFile(screenPath, readFileSync(screenPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function screenNode(predicate) {
  let found;
  const visit = node => { if (predicate(node)) found = node; ts.forEachChild(node, visit); };
  visit(screenAst); return found;
}
const screenRecoveryCall = screenNode(node => ts.isCallExpression(node) && node.expression.getText(screenAst) === 'usePipelineCriticalLoadRetry').getText(screenAst);
const oldBoardRefresh = screenNode(node => ts.isVariableDeclaration(node) && node.name.getText(screenAst) === 'handlePipelineBoardRefresh')?.getText(screenAst);
const screenRetryProp = name => {
  const attribute = screenNode(node => ts.isJsxAttribute(node) && node.name.getText(screenAst) === name);
  assert.ok(attribute?.initializer && ts.isJsxExpression(attribute.initializer) && attribute.initializer.expression, name);
  return attribute.initializer.expression.getText(screenAst);
};

async function runtime({ cached = true, screen = false, snapshotError } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  const events = [], notices = [];
  let catalog = [row(a, true), row(b)], catalogError = cached ? null : unavailable();
  let catalogGate = null, catalogCalls = 0, stagesCalls = 0, boardCalls = 0;
  let selectedPipelineId = b, resourceKey = 'board-b', accessClient = client;
  let boardError = { status: 400, code: 'invalid_lead_reference' }, readsOverride, refetchOverride;
  let boardFailure = snapshotError ?? boardError, boardGate = null;
  const auth = { activeOrganization: { organizationId: org }, user: { id: 'actor-a' }, session: { sid: 'sid-a' } };
  const slots = []; let cursor = 0;
  const changed = (before, after) => !before || after.some((value, index) => value !== before[index]);
  const dependencies = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useState: initial => { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, value => { slots[index].value = typeof value === 'function' ? value(slots[index].value) : value; }]; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useQueryClient: () => accessClient, useAuth: () => auth, captureLeadRequestIntent, captureQueryClientAccess,
    getGlobalSignOutSessionId: session => session?.sid,
    getVimobAPIAccessTokenUserId: () => auth.user?.id, getVimobAPIAccessTokenSessionId: () => auth.session?.sid,
  };
  dependencies.useCallback = (fn, deps) => dependencies.useMemo(() => fn, deps);
  dependencies.useLeadRequestScope = evaluateProduction(productionDeclaration('hooks/leads/use-lead-request-scope.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'useLeadRequestScope'), dependencies, 'useLeadRequestScope');
  dependencies.usePipelineEditorVisit = evaluateProduction(productionDeclaration('hooks/pipelines/use-pipeline-editor-visit.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'usePipelineEditorVisit'), dependencies, 'usePipelineEditorVisit');
  const api = evaluateProduction(apiSource, {
    ...pipelineValidation, ...commonValidation, PIPELINE_READ_TIMEOUT_MS,
    vimobAPIRequest: async (url, options) => {
      assert.equal(options.organizationId, org);
      assert.equal(url, '/v1/pipelines');
      catalogCalls++; events.push('catalog:start');
      const rows = catalog, error = catalogError;
      if (catalogGate) await catalogGate.promise;
      if (error) { events.push('catalog:error'); throw error; }
      events.push('catalog:success'); return { data: rows };
    },
  }, 'pipelinesAPI');
  const options = evaluateProduction(catalogHook, {
    useOrganizationId: () => org, useQuery: value => value, pipelinesAPI: api,
    PIPELINE_REFERENCE_STALE_TIME_MS: 600000, PIPELINE_CACHE_TIME_MS: Infinity, shouldRetryPipelineQuery,
  }, 'usePipelines')();
  const observer = new QueryObserver(client, { ...options, retryDelay: 0 });
  const unsubscribe = observer.subscribe(() => {});
  await observer.refetch();
  if (cached) {
    catalogError = unavailable(); await observer.refetch();
    assert.equal(observer.getCurrentResult().isRefetchError, true);
    assert.equal(observer.getCurrentResult().isLoadingError, false);
  } else assert.equal(observer.getCurrentResult().isLoadingError, true);
  const board = new QueryObserver(client, {
    queryKey: ['synthetic-catalog-recovery-board', org, b], enabled: false, retry: false,
    initialData: screen ? [{ id: 'stage-b', leads: [{ id: 'lead-b' }] }] : undefined,
    queryFn: async () => {
      boardCalls++; events.push('board');
      const failure = boardFailure;
      if (boardGate) await boardGate.promise;
      if (failure) throw Object.assign(new Error('Synthetic board failure'), failure);
      return [{ id: 'stage-b', leads: [{ id: 'fresh-lead-b' }] }];
    },
  });
  const stopBoard = board.subscribe(() => {});
  if (screen) {
    await board.refetch(); boardCalls = 0;
    assert.equal(board.getCurrentResult().isRefetchError, true, 'retained board snapshot must use the real refetch-error state');
    assert.equal(board.getCurrentResult().isLoadingError, false);
  }
  const hookSource = productionDeclaration('hooks/pipelines/use-pipeline-critical-load-retry.ts', n => ts.isFunctionDeclaration(n) && n.name?.text === 'usePipelineCriticalLoadRetry');
  const recoveryHook = evaluateProduction(hookSource, dependencies, 'usePipelineCriticalLoadRetry');
  const refreshHook = evaluateProduction(productionDeclaration('hooks/pipelines/use-pipeline-refresh.ts',
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'usePipelineRefresh'), dependencies, 'usePipelineRefresh');
  const render = () => {
    cursor = 0;
    const result = observer.getCurrentResult();
    if (screen) {
      const refresh = refreshHook(resourceKey), boardResult = board.getCurrentResult();
      const bindings = {
        ...dependencies, usePipelineCriticalLoadRetry: recoveryHook,
        activeOrganizationId: auth.activeOrganization.organizationId, pipelineBoardQueryKeyId: resourceKey,
        selectedPipelineId, pipelinesError: result.isError, leadsError: boardResult.error,
        refetchPipelines: refetchOverride ?? (options => observer.refetch(options)),
        leadVisibilityError: false, teamScopeError: false, baseStages: [{}],
        shouldLoadPipelineLeads: true, leadsLoadingError: boardResult.isLoadingError,
        leadsRefetchError: boardResult.isRefetchError, boardAccessRevoked: false,
        refetchLeadVisibility: () => assert.fail('Unexpected visibility read'),
        refetchTeams: () => assert.fail('Unexpected team read'),
        refetchBaseStages: async () => { stagesCalls++; events.push('stages'); return { isError: false }; },
        refetch: () => board.refetch(), runPipelineRefresh: refresh.run,
        toast: { error: message => notices.push(message), success: message => notices.push(message) },
        getPipelineErrorMessage: error => error.message,
      };
      const recovery = evaluateProduction('const recovery = ' + screenRecoveryCall, bindings, 'recovery');
      const handlePipelineBoardRefresh = oldBoardRefresh
        ? evaluateProduction('const ' + oldBoardRefresh, bindings, 'handlePipelineBoardRefresh') : undefined;
      const callbacks = Object.fromEntries(['onBoardRefresh', 'onCriticalLoadRetry'].map(name => [name, async () => {
        let pending;
        const callback = evaluateProduction('const callback = ' + screenRetryProp(name), {
          handlePipelineBoardRefresh: () => { pending = handlePipelineBoardRefresh(); },
          handleCriticalLoadRetry: () => { pending = recovery.retry(); },
        }, 'callback');
        callback(); await pending;
      }]));
      return { ...recovery, snapshotRetry: callbacks.onBoardRefresh, criticalRetry: callbacks.onCriticalLoadRetry,
        isRetrying: recovery.isRetrying || refresh.isRefreshing };
    }
    return recoveryHook({ organizationId: auth.activeOrganization.organizationId, resourceKey, selectedPipelineId, catalogHasError: result.isError,
      boardError, refetchPipelines: refetchOverride ?? (options => observer.refetch(options)),
      reads: readsOverride ?? [async () => { stagesCalls++; events.push('stages'); return { isError: false, data: [] }; }, () => board.refetch()],
      onError: error => notices.push(error.message),
    });
  };
  render();
  return {
    client, observer, board, retry: () => render().retry, snapshotRetry: () => render().snapshotRetry,
    criticalRetry: () => render().criticalRetry, events, notices, render,
    result: () => observer.getCurrentResult(),
    counts: () => ({ catalog: catalogCalls, stages: stagesCalls, board: boardCalls, busy: render().isRetrying }),
    respond: (rows, error = null) => { catalog = rows; catalogError = error; },
    respondBoard: (error = null) => { boardFailure = error; },
    pauseBoard: () => { boardGate = deferred(); return boardGate; },
    pause: () => { catalogGate = deferred(); return catalogGate; },
    configure: options => { if ('boardError' in options) boardError = options.boardError; readsOverride = options.reads; refetchOverride = options.refetch; },
    select: (id, key = id) => { selectedPipelineId = id; resourceKey = key; render(); },
    switchTo: (organizationId = org, actor = 'actor-a', sid = 'sid-a') => {
      auth.activeOrganization.organizationId = organizationId; auth.user = actor ? { id: actor } : null;
      auth.session = actor ? { sid } : null; render();
    },
    replaceClient: () => { accessClient = new QueryClient(); render(); },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    close: () => { slots.forEach(slot => slot?.cleanup?.()); unsubscribe(); stopBoard(); client.clear(); accessClient.clear(); },
  };
}

test('critical retry refreshes a failed cached catalog and stops requests for a removed selection', async () => {
  const h = await runtime(); try {
    const before = h.counts().catalog;
    h.respond([row(a, true)]);
    await h.retry()();
    assert.equal(h.counts().catalog, before + 1, 'explicit retry must refresh cached refetch error');
    assert.deepEqual(h.result().data.map(item => item.id), [a]);
    assert.equal(h.counts().stages, 0, 'removed B must not fetch stages');
    assert.equal(h.counts().board, 0, 'removed B must not refetch board');
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('a catalog retry that remains unavailable does not start dependent requests', async () => {
  const h = await runtime(); try {
    const before = h.counts().catalog;
    h.respond([row(a, true), row(b)], unavailable());
    await h.retry()();
    assert.ok(h.counts().catalog > before);
    assert.equal(h.result().isRefetchError, true);
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.equal(h.notices.length, 1); assert.match(h.notices[0], /catalog unavailable/);
    assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('initial catalog recovery does not race stages and board for a removed pipeline', async () => {
  const h = await runtime({ cached: false }); try {
    const before = h.counts().catalog;
    h.respond([row(a, true)]);
    await h.retry()();
    assert.equal(h.counts().catalog, before + 1);
    assert.deepEqual(h.result().data.map(item => item.id), [a]);
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('a valid selected pipeline is retried only after its catalog has recovered', async () => {
  const h = await runtime({ cached: false }); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]); h.events.length = 0;
    const pending = h.retry()(); await turn();
    assert.equal(h.counts().stages, 0, 'wait for slow catalog before stages');
    assert.equal(h.counts().board, 0, 'wait for slow catalog before board');
    gate.resolve(); await pending;
    assert.equal(h.counts().stages, 1); assert.equal(h.counts().board, 1);
    assert.ok(h.events.indexOf('catalog:success') < h.events.indexOf('stages'), h.events.join(','));
    assert.ok(h.events.indexOf('catalog:success') < h.events.indexOf('board'), h.events.join(','));
    assert.equal(h.counts().busy, false);
  } finally { gate.resolve(); h.close(); }
});

test('catalog transport deduplicates simultaneous observer refreshes', async () => {
  const h = await runtime(); try {
    h.respond([row(a, true)]); const gate = h.pause();
    const before = h.counts().catalog;
    const one = h.observer.refetch({ cancelRefetch: false });
    await turn(); const two = h.observer.refetch({ cancelRefetch: false });
    gate.resolve(); await Promise.all([one, two]);
    assert.equal(h.counts().catalog, before + 1);
    assert.deepEqual(h.result().data.map(item => item.id), [a]);
  } finally { h.close(); }
});

test('repeated retry clicks share one attempt and do not duplicate dependent reads', async () => {
  const h = await runtime(); const gate = h.pause(); try {
    h.respond([row(a, true)]); const before = h.counts().catalog;
    const retry = h.retry(); const one = retry(); const two = retry();
    await turn(); assert.equal(h.counts().catalog, before + 1);
    assert.equal(h.counts().busy, true); assert.equal(h.counts().stages, 0);
    gate.resolve(); await Promise.all([one, two]);
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { gate.resolve(); h.close(); }
});

for (const [name, change] of [
  ['different session', h => h.switchTo(org, 'actor-a', 'sid-b')],
  ['different actor', h => h.switchTo(org, 'actor-b', 'sid-b')],
  ['different organization', h => h.switchTo('44444444-4444-4444-8444-444444444444')],
  ['logout', h => h.switchTo(org, null, null)],
  ['QueryClient replacement', h => h.replaceClient()],
  ['resource B to A to B', h => { h.select(a, 'board-a'); h.select(b, 'board-b'); }],
  ['session A to B to A', h => { h.switchTo(org, 'actor-a', 'sid-b'); h.switchTo(org, 'actor-a', 'sid-a'); }],
  ['unmount', h => h.unmount()],
]) {
  test(`a pending catalog recovery cannot continue after ${name}`, async () => {
    const h = await runtime(); const gate = h.pause(); try {
      h.respond([row(a, true), row(b)]);
      const pending = h.retry()(); await turn(); change(h);
      gate.resolve(); await pending;
      assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
      assert.deepEqual(h.notices, []);
    } finally { gate.resolve(); h.close(); }
  });
}

test('same-session token refresh preserves a valid in-progress retry', async () => {
  const h = await runtime(); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]);
    const pending = h.retry()(); await turn(); h.switchTo(org, 'actor-a', 'sid-a');
    gate.resolve(); await pending;
    assert.equal(h.counts().stages, 1); assert.equal(h.counts().board, 1);
    assert.equal(h.counts().busy, false);
  } finally { gate.resolve(); h.close(); }
});

test('cancelled catalog refetch cannot authorize old cached success for an invalid board', async () => {
  const h = await runtime(); let gate; try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    assert.equal(h.result().isSuccess, true);
    gate = h.pause(); const pending = h.retry()(); await turn();
    assert.equal(h.counts().stages, 0);
    await h.client.cancelQueries({ queryKey: ['pipelines', org], exact: true });
    assert.equal(h.result().isSuccess, true, 'React Query exposes the old successful cache on cancellation');
    gate.resolve(); await pending;
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.equal(h.counts().busy, false);
  } finally { gate?.resolve(); h.close(); }
});

for (const status of [401, 403]) {
  test(`catalog denial ${status} stops retries before dependent data and preserves one error`, async () => {
    const h = await runtime(); try {
      const before = h.counts().catalog;
      h.respond([], Object.assign(new Error('Synthetic access denied'), { status, code: status === 401 ? 'unauthorized' : 'forbidden' }));
      await h.retry()();
      assert.equal(h.counts().catalog, before + 1, 'authorization error is not a transient retry');
      assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
      assert.equal(h.notices.length, 1); assert.match(h.notices[0], /access denied/);
      assert.equal(h.counts().busy, false);
    } finally { h.close(); }
  });
}

test('the Pipeline screen wires the full catalog error flag into the recovery hook', () => {
  const ast = ts.createSourceFile('PipelinesScreen.tsx', readFileSync('components/features/pipelines/PipelinesScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let catalogErrorName, recovery;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast) === 'usePipelines') {
      catalogErrorName = node.name.elements.find(item => item.propertyName?.getText(ast) === 'isError')?.name.getText(ast);
    }
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'usePipelineCriticalLoadRetry') recovery = node.arguments[0];
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(catalogErrorName, 'usePipelines must expose isError, including refetch failures');
  assert.ok(recovery && ts.isObjectLiteralExpression(recovery));
  const catalogOption = recovery.properties.find(item => ts.isPropertyAssignment(item) && item.name.getText(ast) === 'catalogHasError');
  assert.equal(catalogOption?.initializer.getText(ast), catalogErrorName);
  const refreshProps = [];
  const findRefresh = node => { if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'isRefreshing') refreshProps.push(node.initializer?.getText(ast)); ts.forEachChild(node, findRefresh); };
  findRefresh(ast);
  assert.equal(refreshProps.length, 2);
  assert.ok(refreshProps.every(value => value.includes('isCriticalLoadRetrying')), 'toolbar and board both expose critical retry busy state');
});

test('an empty recovered catalog ends the retry without requests for the old selection', async () => {
  const h = await runtime(); try {
    h.respond([]); await h.retry()();
    assert.deepEqual(h.result().data, []); assert.equal(h.result().isSuccess, true);
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('an invalid reference refreshes even a healthy cached catalog before retrying', async () => {
  const h = await runtime(); try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    const before = h.counts().catalog; assert.equal(h.result().isSuccess, true);
    h.respond([row(a, true)]); await h.retry()();
    assert.equal(h.counts().catalog, before + 1);
    assert.deepEqual(h.result().data.map(item => item.id), [a]);
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
  } finally { h.close(); }
});

test('a healthy catalog and unrelated board error do not make an unnecessary catalog call', async () => {
  const h = await runtime(); try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    const before = h.counts().catalog; h.configure({ boardError: { status: 503, code: 'service_unavailable' } });
    await h.retry()();
    assert.equal(h.counts().catalog, before); assert.equal(h.counts().stages, 1); assert.equal(h.counts().board, 1);
    assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

for (const healthy of [false, true]) test(`a replaced catalog query cannot authorize an old ${healthy ? 'successful' : 'failed'} cache result`, async () => {
  const h = await runtime(); let gate; try {
    h.respond([row(a, true), row(b)]); if (healthy) await h.observer.refetch();
    gate = h.pause(); const pending = h.retry()(); await turn();
    h.client.removeQueries({ queryKey: ['pipelines', org], exact: true });
    h.client.setQueryData(['pipelines', org], [{ id: a }, { id: b }]);
    gate.resolve(); await pending;
    assert.equal(h.counts().stages, 0); assert.equal(h.counts().board, 0);
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { gate?.resolve(); h.close(); }
});

test('an old attempt finishing cannot clear the busy state of a newer visit', async () => {
  const h = await runtime(); const gate = h.pause(), readGate = deferred(); try {
    h.respond([row(a, true), row(b)]); const old = h.retry()(); await turn();
    h.select(a, 'board-a'); h.configure({ reads: [async () => { await readGate.promise; return { isError: false, error: null }; }] });
    const newer = h.retry()(); await turn(); gate.resolve(); await old; await turn();
    assert.equal(h.counts().busy, true, 'only the newer visit owns the busy indicator');
    readGate.resolve(); await newer; assert.equal(h.counts().busy, false);
    assert.deepEqual(h.notices, []);
  } finally { gate.resolve(); readGate.resolve(); h.close(); }
});

for (const phase of ['catalog', 'dependent read']) {
  test(`a thrown ${phase} error is reported once and releases its busy state`, async () => {
    const h = await runtime(); try {
      h.respond([row(a, true), row(b)]);
      const fail = async () => { throw new Error('Synthetic rejected promise'); };
      h.configure(phase === 'catalog' ? { refetch: fail } : { reads: [fail] });
      await h.retry()();
      assert.deepEqual(h.notices, ['Synthetic rejected promise']); assert.equal(h.counts().busy, false);
    } finally { h.close(); }
  });
}

test('selection fallback waits for successful catalog recovery and preserves global all', async () => {
  const ast = ts.createSourceFile('PipelinesScreen.tsx', readFileSync('components/features/pipelines/PipelinesScreen.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effectSource;
  const find = node => { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('selectedStillExists')) effectSource = node.arguments[0].getText(ast); ts.forEachChild(node, find); };
  find(ast); assert.ok(effectSource);
  for (const [catalog, error, global, expected] of [
    [[{ id: a, is_default: true }], true, b, []],
    [[{ id: a, is_default: true }], false, null, [['local', a]]],
    [[{ id: a, is_default: true }], false, b, [['local', a], ['global', null]]],
    [[], false, b, [['local', null], ['global', null]]],
  ]) {
    const changes = [];
    const effect = evaluateProduction('const effect = ' + effectSource, {
      isFiltersHydrated: true, pipelinesLoading: false, pipelinesFetching: false, pipelinesError: error,
      pipelines: catalog, selectedPipelineId: b, globalPipelineId: global, queueMicrotask,
      setLocalPipelineId: value => changes.push(['local', value]), setGlobalPipelineId: value => changes.push(['global', value]),
    }, 'effect');
    const cleanup = effect(); await turn(); assert.deepEqual(changes, expected); cleanup?.();
  }
});

// The refetch-error banner and critical overlay are different rendered paths.
// Extract both JSX callbacks and Screen's real hook options: testing only the
// recovery hook could pass while the visible snapshot button bypassed it.
test('snapshot retry dispatches the real Screen callback and reconciles a removed cached selection', async () => {
  const h = await runtime({ screen: true }); try {
    const before = h.counts().catalog, snapshot = h.board.getCurrentResult().data;
    h.respond([row(a, true)]);
    await h.snapshotRetry()();
    assert.equal(h.counts().catalog, before + 1, 'visible snapshot retry must recover its failed catalog');
    assert.deepEqual(h.result().data.map(item => item.id), [a]);
    assert.equal(h.counts().board, 0, 'removed cached B must not issue another board read');
    assert.equal(h.counts().stages, 0); assert.deepEqual(h.notices, []);
    assert.equal(h.board.getCurrentResult().data, snapshot, 'recovery never mutates the captured snapshot');
    assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('snapshot retry refreshes a still-valid board after the real Screen catalog recovery', async () => {
  const h = await runtime({ screen: true, snapshotError: unavailable() }); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]); h.respondBoard(); h.events.length = 0;
    const before = h.counts().catalog, pending = h.snapshotRetry()(); await turn();
    assert.equal(h.counts().catalog, before + 1); assert.equal(h.counts().board, 0);
    gate.resolve(); await pending;
    assert.equal(h.counts().board, 1, 'leadsRefetchError must participate in Screen recovery reads');
    assert.ok(h.events.indexOf('catalog:success') < h.events.indexOf('board'), h.events.join(','));
    assert.equal(h.board.getCurrentResult().isSuccess, true); assert.deepEqual(h.notices, []);
    assert.equal(h.counts().busy, false);
  } finally { gate.resolve(); h.close(); }
});

test('snapshot retry does not reread an invalid board while its catalog remains unavailable', async () => {
  const h = await runtime({ screen: true }); try {
    h.respond([row(a, true)], unavailable()); const before = h.counts().catalog;
    await h.snapshotRetry()();
    assert.ok(h.counts().catalog > before); assert.equal(h.counts().board, 0);
    assert.equal(h.result().isRefetchError, true); assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /catalog unavailable/); assert.equal(h.counts().busy, false);
  } finally { h.close(); }
});

test('snapshot and critical error buttons dispatch the same recovery action in the real Screen', () => {
  assert.equal(screenRetryProp('onBoardRefresh'), screenRetryProp('onCriticalLoadRetry'));
  assert.equal(oldBoardRefresh, undefined, 'there must be no independent board-only recovery path');
});

test('snapshot retry with a healthy catalog and unrelated board failure refetches only the board', async () => {
  const h = await runtime({ screen: true, snapshotError: unavailable() }); try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch(); h.respondBoard();
    const before = h.counts().catalog;
    await h.snapshotRetry()();
    assert.equal(h.counts().catalog, before); assert.equal(h.counts().board, 1);
    assert.equal(h.board.getCurrentResult().isSuccess, true); assert.deepEqual(h.notices, []);
  } finally { h.close(); }
});

test('repeated snapshot and critical button clicks share one recovery and one dependent read', async () => {
  const h = await runtime({ screen: true }); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]); h.respondBoard(); const before = h.counts().catalog;
    const one = h.snapshotRetry()(), two = h.snapshotRetry()(), three = h.criticalRetry()(); await turn();
    assert.equal(h.counts().catalog, before + 1); assert.equal(h.counts().board, 0);
    assert.equal(h.counts().busy, true);
    gate.resolve(); await Promise.all([one, two, three]);
    assert.equal(h.counts().board, 1); assert.equal(h.counts().busy, false); assert.deepEqual(h.notices, []);
  } finally { gate.resolve(); h.close(); }
});

for (const [label, retire] of [
  ['SID replacement', h => h.switchTo(org, 'actor-a', 'sid-b')],
  ['actor replacement', h => h.switchTo(org, 'actor-b', 'sid-b')],
  ['organization replacement', h => h.switchTo('44444444-4444-4444-8444-444444444444')],
  ['logout', h => h.switchTo(org, null, null)],
  ['QueryClient replacement', h => h.replaceClient()],
  ['visit ABA', h => { h.select(a, 'board-a'); h.select(b, 'board-b'); }],
  ['SID ABA', h => { h.switchTo(org, 'actor-a', 'sid-b'); h.switchTo(org, 'actor-a', 'sid-a'); }],
  ['unmount', h => h.unmount()],
]) {
  test(`real snapshot retry cannot continue a recovered catalog after ${label}`, async () => {
    const h = await runtime({ screen: true }); const gate = h.pause(); try {
      h.respond([row(a, true), row(b)]); h.respondBoard();
      const pending = h.snapshotRetry()(); await turn(); retire(h);
      gate.resolve(); await pending;
      assert.equal(h.counts().board, 0); assert.equal(h.counts().stages, 0); assert.deepEqual(h.notices, []);
    } finally { gate.resolve(); h.close(); }
  });
}

for (const failure of [false, true]) test(`old snapshot board ${failure ? 'failure' : 'success'} cannot deliver after SID replacement`, async () => {
  const h = await runtime({ screen: true, snapshotError: unavailable() }); let gate; try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    if (!failure) h.respondBoard();
    gate = h.pauseBoard(); const pending = h.snapshotRetry()(); await turn();
    assert.equal(h.counts().board, 1); h.switchTo(org, 'actor-a', 'sid-b');
    gate.resolve(); await pending; assert.deepEqual(h.notices, []);
  } finally { gate?.resolve(); h.close(); }
});

test('same-SID token renewal preserves a real snapshot recovery and its fresh board', async () => {
  const h = await runtime({ screen: true }); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]); h.respondBoard();
    const pending = h.snapshotRetry()(); await turn(); h.switchTo(org, 'actor-a', 'sid-a');
    gate.resolve(); await pending;
    assert.equal(h.counts().board, 1); assert.equal(h.board.getCurrentResult().isSuccess, true);
    assert.deepEqual(h.notices, []); assert.equal(h.counts().busy, false);
  } finally { gate.resolve(); h.close(); }
});

test('cancelled catalog recovery cannot treat an old successful cache as authorization for snapshot retry', async () => {
  const h = await runtime({ screen: true }); let gate; try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    const snapshot = h.board.getCurrentResult().data;
    gate = h.pause(); const pending = h.snapshotRetry()(); await turn();
    await h.client.cancelQueries({ queryKey: ['pipelines', org], exact: true });
    assert.equal(h.result().isSuccess, true, 'cancelled refetch exposes the cached successful result');
    gate.resolve(); await pending;
    assert.equal(h.counts().board, 0); assert.deepEqual(h.notices, []);
    assert.equal(h.board.getCurrentResult().data, snapshot);
  } finally { gate?.resolve(); h.close(); }
});

test('a snapshot recovery cannot consume a replaced catalog query with the same cache key', async () => {
  const h = await runtime({ screen: true }); const gate = h.pause(); try {
    h.respond([row(a, true), row(b)]); const pending = h.snapshotRetry()(); await turn();
    h.client.removeQueries({ queryKey: ['pipelines', org], exact: true });
    h.client.setQueryData(['pipelines', org], [row(a, true), row(b)]);
    gate.resolve(); await pending;
    assert.equal(h.counts().board, 0); assert.deepEqual(h.notices, []);
  } finally { gate.resolve(); h.close(); }
});

test('a current failed snapshot retry reports once, releases busy, and keeps its old snapshot', async () => {
  const h = await runtime({ screen: true, snapshotError: unavailable() }); try {
    h.respond([row(a, true), row(b)]); await h.observer.refetch();
    const snapshot = h.board.getCurrentResult().data;
    await h.snapshotRetry()();
    assert.equal(h.counts().board, 1); assert.equal(h.notices.length, 1);
    assert.match(h.notices[0], /board failure/); assert.equal(h.counts().busy, false);
    assert.equal(h.board.getCurrentResult().data, snapshot);
  } finally { h.close(); }
});

test('an obsolete snapshot callback cannot release the busy state of a newer retry visit', async () => {
  const h = await runtime({ screen: true }); const catalogGate = h.pause(); let boardGate; try {
    h.respond([row(a, true), row(b)]); h.respondBoard();
    const old = h.snapshotRetry()(); await turn();
    h.select(a, 'board-a'); boardGate = h.pauseBoard();
    const newer = h.snapshotRetry()(); await turn();
    catalogGate.resolve(); await old; await turn();
    assert.equal(h.counts().board, 1); assert.equal(h.counts().busy, true);
    assert.deepEqual(h.notices, [], 'the retired callback cannot publish an old result');
    boardGate.resolve(); await newer;
    assert.equal(h.counts().busy, false); assert.equal(h.board.getCurrentResult().isSuccess, true);
  } finally { catalogGate.resolve(); boardGate?.resolve(); h.close(); }
});
