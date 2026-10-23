import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { getGlobalSignOutSessionId } from '../../lib/auth/global-sign-out.ts';
import { activateQueryClientAccess, captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { shouldRetryPipelineQuery } from '../../lib/pipeline-reliability.ts';
import { stageWithLeadsQueryKey } from '../../lib/pipeline-query-key.ts';
import { getPipelineBoardQueryKeyId } from '../../lib/pipeline-board-cache.ts';
import { productionDeclaration, evaluateProduction, deferred, turn } from '../leads/lead-request-runtime-fixture.mjs';

const screen = 'components/features/pipelines/PipelinesScreen.tsx';
const unavailable = () => Object.assign(new Error('Synthetic filter catalog unavailable'), { status: 503 });
const token = (user, sid, version = 1) => `synthetic.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, version })).toString('base64url')}.synthetic`;
const fn = (path, name) => productionDeclaration(path, n => ts.isFunctionDeclaration(n) && n.name?.text === name && n.body);
const variable = (path, name) => productionDeclaration(path, n => ts.isVariableDeclaration(n) && n.name.getText() === name);

// Production token setter/getters, request/visit guards and QueryObserver run
// unchanged. Only React lifecycle, Auth values and HTTP replies are synthetic.
async function runtime(kind = 'teams') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  let accessClient = client, deactivate = activateQueryClientAccess(client), mounted = true, resourceKey = 'board-a';
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, session: { access_token: token('actor-a', 'sid-a') } };
  const identityAPI = evaluateProduction([
    ...['activeAccessTokenIdentity', 'accessTokenCache', 'accessTokenPromise', 'accessTokenGeneration'].map(name => 'let ' + variable('lib/api/vimob-client.ts', name) + ';'),
    ...['replaceAccessTokenSession', 'setVimobAPIAccessToken', 'getVimobAPIAccessTokenUserId', 'getVimobAPIAccessTokenSessionId'].map(name => fn('lib/api/vimob-client.ts', name)),
  ].join('\n'), { getGlobalSignOutSessionId, API_ACCESS_TOKEN_CACHE_TTL_MS: 60_000 },
  '{setVimobAPIAccessToken,getVimobAPIAccessTokenUserId,getVimobAPIAccessTokenSessionId}');
  const syncToken = () => identityAPI.setVimobAPIAccessToken(auth.session?.access_token, auth.user?.id);
  syncToken();
  const slots = [], requests = [], notices = [], stateDeliveries = [], observers = [], pending = [];
  let cursor = 0, phase = 'failure', shouldLoad = true, hasError = true, throwOnError = false;
  const changed = (old, next) => !old || next.some((value, index) => !Object.is(value, old[index]));
  const dependencies = {
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useState: initial => { const index = cursor++; slots[index] ??= { value: initial }; return [slots[index].value, value => { slots[index].value = value; stateDeliveries.push(value); }]; },
    useQueryClient: () => accessClient, useAuth: () => auth, getGlobalSignOutSessionId,
    captureLeadRequestIntent, captureQueryClientAccess, ...identityAPI,
  };
  dependencies.useCallback = (callback, deps) => dependencies.useMemo(() => callback, deps);
  for (const [path, name] of [['hooks/leads/use-lead-request-scope.ts', 'useLeadRequestScope'],
    ['hooks/pipelines/use-pipeline-editor-visit.ts', 'usePipelineEditorVisit'], ['hooks/pipelines/use-pipeline-refresh.ts', 'usePipelineRefresh']]) {
    dependencies[name] = evaluateProduction(fn(path, name), dependencies, name);
  }
  const transport = options => {
    if (phase === 'failure') return Promise.reject(unavailable());
    const reply = deferred(); requests.push({ ...options, reply }); return reply.promise;
  };
  const catalogOptions = () => {
    const common = { useAuth: () => auth, useQuery: value => value,
      useQueryWithDataTrust: (value, scope) => { assert.equal(scope, undefined); return value; },
      getGlobalSignOutSessionId, shouldRetryPipelineQuery };
    if (kind !== 'metadata') return evaluateProduction(fn(`hooks/use-${kind}.ts`, kind === 'teams' ? 'useTeams' : 'useTags'), {
      ...common, teamsAPI: { catalog: (_org, options) => transport(options) }, tagsAPI: { catalog: (_org, options) => transport(options) },
    }, kind === 'teams' ? 'useTeams' : 'useTags')({ catalog: true });
    return evaluateProduction('const ' + variable('hooks/use-shared-filters.ts', 'leadMetaFiltersQuery'), {
      ...common, options: {}, leadMetaFilterQueryKey: ['shared-meta', auth.activeOrganization.organizationId, auth.user?.id],
      isFiltersHydrated: true, periodError: null, shouldLoadDynamicOptions: true, organizationId: auth.activeOrganization.organizationId,
      entryMode: false, currentTenantContext: null, effectiveDateRange: null, dateMode: 'origin', pipelineId: 'pipeline-a', pageId: null,
      scopeMetaOptionsToBoard: true, teamId: null, userId: null, dealStatus: null, tagIds: [], metaSearchQuery: '',
      getLeadMetaFilters: transport, EMPTY_LEAD_META_FILTERS: {},
    }, 'leadMetaFiltersQuery');
  };
  const observe = async () => {
    const options = catalogOptions(); client.setQueryData(options.queryKey, [{ id: 'old-option' }]);
    const observer = new QueryObserver(client, { ...options, retry: false, refetchOnMount: false });
    const entry = { observer, stop: observer.subscribe(() => {}) }; observers.push(entry);
    await observer.refetch(); assert.equal(observer.getCurrentResult().isRefetchError, true);
    return entry;
  };
  let observed = await observe();
  const refetch = () => {
    const promise = observed.observer.refetch({ throwOnError });
    pending.push(promise.catch(() => {})); return promise;
  };
  const handlerSource = 'const ' + variable(screen, 'handleEnableFilterOptions');
  const source = ts.createSourceFile(screen, readFileSync(screen, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let retryDeclaration;
  const find = node => { if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name)
    && node.name.elements.some(element => element.name.getText(source) === 'runFilterOptionsRetry')) retryDeclaration = node.getText(source);
    ts.forEachChild(node, find); };
  find(source);
  const currentResourceKey = () => {
    const bindings = { useMemo: build => build(), getGlobalSignOutSessionId, stageWithLeadsQueryKey, getPipelineBoardQueryKeyId,
      activeOrganizationId: auth.activeOrganization.organizationId, selectedPipelineId: 'pipeline-a', effectivePipelineFilterUser: undefined,
      profile: auth.user, user: auth.user, selectedLeadSessionId: getGlobalSignOutSessionId(auth.session),
      leadVisibility: { canViewAll: false }, scopedVisibleUserIds: auth.user ? [auth.user.id] : [], tenantContext: { ledTeamIds: [] },
      pipelineDateRange: null, filterTags: [], filterDealStatus: null, deferredSearchQuery: resourceKey, filterPage: null,
      filterCampaign: null, filterCampaigns: [], filterAdSet: null, filterAd: null, filterSource: null, isUnassignedFilter: false, sharedFilters: { teamId: null },
    };
    for (const name of ['visibilityScopeKey', 'pipelineBoardFilters', 'pipelineBoardQueryKey', 'pipelineBoardQueryKeyId']) {
      bindings[name] = evaluateProduction('const ' + variable(screen, name), bindings, name);
    }
    return bindings.pipelineBoardQueryKeyId;
  };
  const render = () => {
    assert.equal(mounted, true); cursor = 0;
    const scope = dependencies.useLeadRequestScope();
    const pipelineBoardQueryKeyId = currentResourceKey();
    const toolbar = dependencies.usePipelineRefresh(pipelineBoardQueryKeyId);
    const retry = retryDeclaration ? evaluateProduction('const ' + retryDeclaration, {
      ...dependencies, pipelineBoardQueryKeyId, user: auth.user, session: auth.session,
    }, 'runFilterOptionsRetry') : dependencies.usePipelineRefresh(pipelineBoardQueryKeyId).run;
    const callback = evaluateProduction(handlerSource, {
      useCallback: callback => callback, shouldLoadFilterOptions: shouldLoad,
      setShouldLoadFilterOptions: value => { shouldLoad = value; },
      hasTeamOptionsError: kind === 'teams' && hasError, hasLeadMetaFiltersError: kind === 'metadata' && hasError, hasTagsError: kind === 'tags' && hasError,
      refetchTeams: refetch, refetchLeadMetaFilters: refetch, refetchTags: refetch,
      runFilterOptionsRetry: options => { const promise = retry(options); pending.push(promise); return promise; },
      toast: { error: message => notices.push(message) },
    }, 'handleEnableFilterOptions');
    return { callback, toolbar, scope };
  };
  render();
  const change = patch => {
    if ('org' in patch) auth.activeOrganization.organizationId = patch.org;
    if ('user' in patch) auth.user = patch.user ? { id: patch.user } : null;
    if ('sid' in patch || 'version' in patch || 'user' in patch) auth.session = auth.user
      ? { access_token: token(auth.user.id, patch.sid ?? getGlobalSignOutSessionId(auth.session), patch.version) } : null;
    if ('resource' in patch) resourceKey = patch.resource;
    syncToken(); render();
  };
  const settle = async () => { await Promise.all(pending); await turn(); };
  return { notices, requests, stateDeliveries, change, render, settle, client,
    capture: () => render().scope.capture(),
    start: () => { phase = 'pending'; return render().callback(); },
    success: request => request.reply.resolve([{ id: 'new-option' }]), fail: request => request.reply.reject(unavailable()),
    setLazy: () => { shouldLoad = false; }, clearError: () => { hasError = false; },
    throwOnError: () => { throwOnError = true; },
    cancel: () => client.cancelQueries({ queryKey: observed.observer.options.queryKey, exact: true }),
    stopObserver: () => { observed.stop?.(); observed.stop = null; },
    async newObserver() { phase = 'failure'; observed = await observe(); phase = 'pending'; },
    replaceClient: () => { deactivate(); accessClient = new QueryClient(); deactivate = activateQueryClientAccess(accessClient); render(); },
    retireAccess: () => { deactivate(); deactivate = activateQueryClientAccess(accessClient); },
    unmount: () => { mounted = false; slots.forEach(slot => slot.cleanup?.()); },
    async close() { mounted = false; slots.forEach(slot => slot.cleanup?.()); for (const entry of observers) { entry.stop?.(); entry.observer.destroy(); }
      for (const request of requests) request.reply.resolve([]); await settle(); deactivate(); client.clear(); accessClient.clear(); },
  };
}

for (const kind of ['teams', 'metadata', 'tags']) {
  for (const [label, patches] of [
    ['UID', [{ user: 'actor-b', sid: 'sid-b' }]], ['SID', [{ sid: 'sid-b' }]], ['organization', [{ org: 'org-b' }]],
    ['logout', [{ user: null }]], ['UID ABA', [{ user: 'actor-b', sid: 'sid-b' }, { user: 'actor-a', sid: 'sid-a' }]],
    ['SID ABA', [{ sid: 'sid-b' }, { sid: 'sid-a' }]], ['organization ABA', [{ org: 'org-b' }, { org: 'org-a' }]],
    ['filter ABA', [{ resource: 'board-b' }, { resource: 'board-a' }]],
  ]) test(`filter options ${kind}: retired ${label} cannot notify`, async () => {
    const h = await runtime(kind); try {
      const captured = h.capture(); h.start(); await turn(); assert.equal(h.requests.length, 1);
      for (const patch of patches) h.change(patch);
      if (label !== 'filter ABA') assert.equal(captured.isCurrent(), false, 'real access guard must retire the gesture');
      h.stopObserver(); await h.settle(); assert.deepEqual(h.notices, []);
    } finally { await h.close(); }
  });
  for (const retire of ['unmount', 'replaceClient', 'retireAccess']) test(`filter options ${kind}: ${retire} retires pending callbacks`, async () => {
    const h = await runtime(kind); try {
      const captured = h.capture(); h.start(); await turn(); h[retire]();
      assert.equal(captured.isCurrent(), false); h.stopObserver();
      const before = h.stateDeliveries.length; await h.settle();
      assert.deepEqual(h.notices, []); assert.equal(h.stateDeliveries.length, before);
    } finally { await h.close(); }
  });
  for (const retire of ['SID', 'unmount', 'SID ABA']) test(`filter options ${kind}: late rejection after ${retire} remains silent`, async () => {
    const h = await runtime(kind); try {
      h.throwOnError(); const captured = h.capture(); h.start(); await turn();
      // Keep another observer alive: a real HTTP rejection must reach catch,
      // rather than only testing cancellation's cached error result.
      if (retire === 'unmount') h.unmount();
      else { h.change({ sid: 'sid-b' }); if (retire === 'SID ABA') h.change({ sid: 'sid-a' }); }
      assert.equal(captured.isCurrent(), false); const before = h.stateDeliveries.length;
      h.fail(h.requests[0]); await h.settle();
      assert.deepEqual(h.notices, []); assert.equal(h.stateDeliveries.length, before);
    } finally { await h.close(); }
  });
  for (const outcome of ['success', 'error', 'throw']) test(`filter options ${kind}: current ${outcome} retains legitimate behavior`, async () => {
    const h = await runtime(kind); try {
      if (outcome === 'throw') h.throwOnError(); h.start(); await turn();
      h[outcome === 'success' ? 'success' : 'fail'](h.requests[0]); await h.settle();
      assert.equal(h.notices.length, outcome === 'success' ? 0 : 1);
      if (h.notices.length) assert.match(h.notices[0], /opções de filtro/);
    } finally { await h.close(); }
  });
  for (const success of [true, false]) test(`filter options ${kind}: same-SID token renewal preserves ${success ? 'success' : 'error'}`, async () => {
    const h = await runtime(kind); try {
      const captured = h.capture(); h.start(); await turn(); h.change({ version: 2 });
      assert.equal(captured.isCurrent(), true); h[success ? 'success' : 'fail'](h.requests[0]); await h.settle();
      assert.equal(h.notices.length, success ? 0 : 1);
    } finally { await h.close(); }
  });
  test(`filter options ${kind}: first lazy activation and healthy catalogs do not refetch`, async () => {
    const h = await runtime(kind); try {
      h.setLazy(); h.start(); await turn(); assert.equal(h.requests.length, 0);
      h.clearError(); h.start(); await turn(); assert.equal(h.requests.length, 0); assert.deepEqual(h.notices, []);
    } finally { await h.close(); }
  });
  test(`filter options ${kind}: old session cannot block or unlock the new session retry`, async () => {
    const h = await runtime(kind); try {
      h.start(); await turn(); const old = h.requests[0];
      h.change({ sid: 'sid-b' }); await h.newObserver(); h.start(); await turn();
      assert.equal(h.requests.length, 2, 'new session starts independently while old observer is still mounted');
      h.fail(old); await turn(); const before = h.requests.length;
      h.start(); await turn(); assert.equal(h.requests.length, before, 'old completion cannot release the newer mutex');
      assert.deepEqual(h.notices, []); h.fail(h.requests[1]); await h.settle(); assert.equal(h.notices.length, 1);
    } finally { await h.close(); }
  });
  test(`filter options ${kind}: catalog retry does not share the toolbar mutex`, async () => {
    const h = await runtime(kind); const gate = deferred(); try {
      const pending = h.render().toolbar.run({ reads: [() => gate.promise], onSuccess() {}, onError: assert.fail });
      h.start(); await turn(); assert.equal(h.requests.length, 1);
      h.success(h.requests[0]); await h.settle(); assert.deepEqual(h.notices, []);
      gate.resolve({ isError: false }); await pending;
    } finally { gate.resolve({ isError: false }); await h.close(); }
  });
}
