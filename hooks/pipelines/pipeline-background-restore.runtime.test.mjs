import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { stageWithLeadsQueryKey } from '../../lib/pipeline-query-key.ts';
import { capturePipelinePageLease } from '../../lib/pipeline-page-lease.ts';
import { refreshExpandedPipelineBoard } from './refresh-expanded-pipeline-board.ts';
import { getPipelineBoardQueryKeyId, getPendingPipelineMoves, registerPendingPipelineMove, clearPendingPipelineMoves } from '../../lib/pipeline-board-cache.ts';
import { buildPipelineStageRestorePlans, createPipelinePaginationStorageKey, getPipelineStageLoadedCountsFromBoard, getPipelineStagePaginationAfterPage, hasMorePipelineStageLeadsAfterPage, mergePipelineStageLoadedCounts } from '../../lib/pipeline-pagination-state.ts';
import { evaluateProduction, productionDeclaration, deferred, turn } from '../leads/lead-request-runtime-fixture.mjs';

const hookSource = productionDeclaration(process.env.PIPELINE_RESTORE_SOURCE_FILE || 'hooks/use-stages.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useStagesWithLeads');
const scopeSource = productionDeclaration('hooks/leads/use-lead-request-scope.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadRequestScope');
const leads = (start, count, stageId = 'stage-a') => Array.from({ length: count }, (_, index) => ({
  id: `${stageId}-lead-${start + index}`, stage_id: stageId, pipeline_id: 'pipeline-a', organization_id: 'org-a',
  board_sort_at: `2026-10-16T12:00:00.${String(999999 - start - index).padStart(6, '0')}Z`,
}));
const board = (stageIds = ['stage-a']) => stageIds.map(id => ({ id, total_lead_count: 100, has_more: true, leads: leads(0, 12, id) }));
const page = (stageId = 'stage-a', count = 12, start = 12) => ({ stageId, leads: leads(start, count, stageId) });

function runtime({ desired = { 'stage-a': 24 }, stages = ['stage-a'] } = {}) {
  const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnMount: false } } });
  let client = newClient(), cursor = 0, params = {}, stageResponse = async p => page(p.stageId, p.limit, p.offset), boardResponse = async () => board(stages);
  const clients = [client], slots = [], requests = [], boardRequests = [], storage = [], errors = [];
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, profile: { id: 'actor-a' }, session: { sid: 'sid-a' } };
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const effect = (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } };
  const dependencies = {
    useAuth: () => auth, useOrganizationId: () => auth.activeOrganization.organizationId, useQueryClient: () => client,
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useState: value => { const index = cursor++; slots[index] ??= { value }; return [slots[index].value, next => { slots[index].value = typeof next === 'function' ? next(slots[index].value) : next; if (slots[index].value?.error) errors.push(slots[index].value); }]; },
    useEffect: effect, useLayoutEffect: effect,
    useQuery: options => {
      const index = cursor++;
      if (!slots[index] || slots[index].client !== client) {
        slots[index]?.cleanup?.();
        const observer = new QueryObserver(client, options), cleanup = observer.subscribe(() => {});
        slots[index] = { client, observer, cleanup };
      } else slots[index].observer.setOptions(options);
      return slots[index].observer.getCurrentResult();
    },
    getGlobalSignOutSessionId: session => session?.sid, captureLeadRequestIntent, captureQueryClientAccess,
    getVimobAPIAccessTokenUserId: () => auth.user?.id, getVimobAPIAccessTokenSessionId: () => auth.session?.sid,
    stageWithLeadsQueryKey, capturePipelinePageLease, getPipelineBoardQueryKeyId, getPendingPipelineMoves, refreshExpandedPipelineBoard,
    buildPipelineStageRestorePlans, createPipelinePaginationStorageKey, getPipelineStageLoadedCountsFromBoard,
    hasMorePipelineStageLeadsAfterPage, mergePipelineStageLoadedCounts,
    getPipelineStagePaginationAfterPage,
    readPipelineStageLoadedCounts: () => desired, persistPipelineStageLoadedCount: (...args) => storage.push(args),
    PIPELINE_BOARD_STALE_TIME_MS: 600_000, PIPELINE_CACHE_TIME_MS: Infinity, LEADS_PER_STAGE: 12,
    shouldRetryPipelineQuery: () => false, reusePreviousDataWhenKeyPartsMatch: () => undefined,
    reconcilePipelineBoardSnapshot: (_old, next) => next,
    getPipelineBoard: async p => { boardRequests.push(p); return boardResponse(p); },
    getPipelineStageLeads: async p => { requests.push(p); return stageResponse(p); },
  };
  dependencies.useLeadRequestScope = evaluateProduction(scopeSource, dependencies, 'useLeadRequestScope');
  const hook = evaluateProduction(hookSource, dependencies, 'useStagesWithLeads');
  const key = () => stageWithLeadsQueryKey({ organizationId: auth.activeOrganization.organizationId, pipelineId: params.pipelineId || 'pipeline-a', filters: params.filters });
  const render = (next = params) => { params = next; cursor = 0; return hook(params.pipelineId || 'pipeline-a', undefined, params.filters, { enabled: params.enabled ?? true }); };
  const unmount = () => slots.forEach(slot => slot?.cleanup?.());
  return {
    auth, requests, boardRequests, storage, errors, key, render, client: () => client,
    start: async () => { render(); await turn(); return render(); },
    pageResponse: callback => { stageResponse = callback; }, boardResponse: callback => { boardResponse = callback; },
    replaceClient: () => { client = newClient(); clients.push(client); },
    unmount, remount: () => { unmount(); slots.length = 0; return render(); },
    close: () => { unmount(); clients.forEach(item => item.clear()); },
  };
}

test('restore is bounded, sequential and uses the initiating actor/SID and cursor', async () => {
  const h = runtime({ desired: { 'stage-a': 24, 'stage-b': 9999 }, stages: ['stage-a', 'stage-b'] });
  const first = deferred(), second = deferred();
  try {
    h.pageResponse(p => p.stageId === 'stage-a' ? first.promise : second.promise); await h.start();
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].limit, 12);
    assert.equal(h.requests[0].cursorBeforeId, 'stage-a-lead-11');
    assert.equal(h.requests[0].intent.expectedUserId, 'actor-a'); assert.equal(h.requests[0].intent.expectedSessionId, 'sid-a');
    first.resolve(page()); await turn(); assert.equal(h.requests.length, 2); assert.equal(h.requests[1].limit, 48);
    second.resolve(page('stage-b', 48)); await turn(); h.render();
    assert.deepEqual(h.client().getQueryData(h.key()).map(stage => stage.leads.length), [24, 60]);
    assert.equal(h.requests.length, 2); assert.equal(h.storage.length, 2); assert.equal(h.errors.length, 0);
  } finally { first.resolve(page()); second.resolve(page('stage-b', 48)); h.close(); }
});

test('the first 12 cards resolve before background restoration and unexpanded columns make no request', async () => {
  const initialGate = deferred(), h = runtime({ desired: {} });
  try {
    h.boardResponse(() => initialGate.promise); const loading = h.render();
    assert.equal(loading.data, undefined); assert.equal(h.requests.length, 0);
    initialGate.resolve(board()); await turn(); const loaded = h.render();
    assert.equal(loaded.data[0].leads.length, 12); assert.equal(h.requests.length, 0);
  } finally { initialGate.resolve(board()); h.close(); }
});

test('all columns use the filter values captured by their canonical generation', async () => {
  const first = deferred(), h = runtime({ desired: { 'stage-a': 24, 'stage-b': 24 }, stages: ['stage-a', 'stage-b'] });
  try {
    const filters = { filterTags: ['tag-a'] };
    h.pageResponse(p => p.stageId === 'stage-a' ? first.promise : Promise.resolve(page('stage-b')));
    h.render({ filters }); await turn(); h.render(); filters.filterTags.push('tag-b');
    first.resolve(page()); await turn();
    assert.equal(h.requests.length, 2); assert.deepEqual(h.requests.map(request => request.filters.filterTags), [['tag-a'], ['tag-a']]);
  } finally { first.resolve(page()); h.close(); }
});

for (const mode of ['manual page', 'new canonical', 'identical canonical', 'invalidation', 'remove/recreate', 'pending move']) {
  test(`late restoration cannot alter has_more or persist after ${mode}`, async () => {
    const gate = deferred(), h = runtime();
    try {
      h.pageResponse(() => gate.promise); await h.start(); const key = h.key();
      if (mode === 'manual page') { const next = board(); next[0].leads.push(...leads(12, 12)); h.client().setQueryData(key, next); }
      else if (mode === 'new canonical') { const next = board(); next[0].leads = leads(100, 12); h.client().setQueryData(key, next); }
      else if (mode === 'identical canonical') await h.client().fetchQuery({ queryKey: key, queryFn: async () => board(), staleTime: 0 });
      else if (mode === 'invalidation') await h.client().invalidateQueries({ queryKey: key, exact: true, refetchType: 'none' });
      else if (mode === 'remove/recreate') { h.client().removeQueries({ queryKey: key, exact: true }); h.client().setQueryData(key, board()); }
      else registerPendingPipelineMove(key, { leadId: 'other', sourceStageId: 'stage-a', destinationStageId: 'stage-a', destinationIndex: 0, version: 1 });
      const before = h.client().getQueryData(key); gate.resolve(page()); await turn(); h.render();
      assert.equal(h.client().getQueryData(key), before); assert.equal(before[0].has_more, true);
      assert.equal(h.storage.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.requests.length, 1);
      if (mode !== 'pending move') assert.equal(h.requests[0].signal.aborted, true);
      clearPendingPipelineMoves(key);
    } finally { gate.resolve(page()); clearPendingPipelineMoves(h.key()); h.close(); }
  });
}

for (const mode of ['org', 'actor', 'SID', 'filters', 'permission', 'client', 'unmount', 'org ABA', 'SID ABA', 'filter ABA', 'permission ABA']) {
  test(`retired ${mode} visit cannot append, persist or show stale failure`, async () => {
    const gate = deferred(), h = runtime();
    try {
      h.pageResponse(() => gate.promise); await h.start(); const oldClient = h.client(), key = h.key();
      if (mode === 'unmount') h.unmount();
      else if (mode === 'client') { h.replaceClient(); h.render(); }
      else if (mode.startsWith('org')) { h.auth.activeOrganization.organizationId = 'org-b'; h.render(); if (mode.endsWith('ABA')) { h.auth.activeOrganization.organizationId = 'org-a'; h.render(); } }
      else if (mode === 'actor') { h.auth.user = { id: 'actor-b' }; h.render(); }
      else if (mode.startsWith('SID')) { h.auth.session = { sid: 'sid-b' }; h.render(); if (mode.endsWith('ABA')) { h.auth.session = { sid: 'sid-a' }; h.render(); } }
      else if (mode.startsWith('filter')) { h.render({ filters: { searchQuery: 'B' } }); if (mode.endsWith('ABA')) h.render({}); }
      else { h.render({ enabled: false }); if (mode.endsWith('ABA')) h.render({ enabled: true }); }
      gate.reject(Error('retired network failure')); await turn();
      assert.equal(oldClient.getQueryData(key)[0].leads.length, 12); assert.equal(oldClient.getQueryData(key)[0].has_more, true);
      assert.equal(h.storage.length, 0); assert.equal(h.errors.length, 0); assert.equal(h.requests[0].signal.aborted, true);
    } finally { gate.resolve(page()); h.close(); }
  });
}

for (const mode of ['wrong stage', 'wrong lead stage', 'wrong tenant', 'wrong pipeline', 'network failure']) {
  test(`current ${mode} leaves the initial page usable and exposes one bounded error`, async () => {
    const h = runtime();
    try {
      h.pageResponse(async () => {
        const value = page();
        if (mode === 'network failure') throw Error('synthetic failure');
        if (mode === 'wrong stage') value.stageId = 'stage-b';
        if (mode === 'wrong lead stage') value.leads[0].stage_id = 'stage-b';
        if (mode === 'wrong tenant') value.leads[0].organization_id = 'org-b';
        if (mode === 'wrong pipeline') value.leads[0].pipeline_id = 'pipeline-b';
        return value;
      });
      await h.start(); await turn(); const result = h.render();
      assert.equal(result.data[0].leads.length, 12); assert.equal(result.data[0].has_more, true);
      assert.ok(result.restoreError?.error); assert.equal(h.errors.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.storage.length, 0);
      h.render(); await turn(); assert.equal(h.requests.length, 1, 'no automatic retry loop');
    } finally { h.close(); }
  });
}

for (const mode of ['actor ABA', 'SID ABA', 'permission ABA']) {
  test(`a previously visible restore error is retired after ${mode} even with the same query key`, async () => {
    const h = runtime();
    try {
      h.pageResponse(async () => { throw Error('old visit failure'); }); await h.start(); await turn();
      assert.ok(h.render().restoreError);
      if (mode === 'actor ABA') { h.auth.user = { id: 'actor-b' }; h.render(); h.auth.user = { id: 'actor-a' }; }
      else if (mode === 'SID ABA') { h.auth.session = { sid: 'sid-b' }; h.render(); h.auth.session = { sid: 'sid-a' }; }
      else h.render({ enabled: false });
      assert.equal(h.render({ enabled: true }).restoreError, null);
      assert.equal(h.requests.length, 1);
    } finally { h.close(); }
  });
}

test('manual pagination started against restoration snapshot is retired when restore wins', async () => {
  const gate = deferred(), h = runtime();
  try {
    h.pageResponse(() => gate.promise); await h.start();
    const snapshot = h.client().getQueryData(h.key())[0];
    const manual = capturePipelinePageLease(h.client(), h.key(), { stageId: snapshot.id, offset: 12,
      cursorBefore: snapshot.leads.at(-1).board_sort_at, cursorBeforeId: snapshot.leads.at(-1).id, signal: new AbortController().signal });
    gate.resolve(page()); await turn();
    assert.equal(h.client().getQueryData(h.key())[0].leads.length, 24); assert.equal(h.client().getQueryData(h.key())[0].has_more, true);
    assert.equal(manual.isCurrent(), false); assert.equal(manual.signal.aborted, true); manual.release();
  } finally { gate.resolve(page()); h.close(); }
});

test('a refreshed canonical read gets one new bounded restoration generation', async () => {
  const h = runtime();
  try {
    await h.start(); await turn(); h.render(); assert.equal(h.requests.length, 1);
    await h.client().refetchQueries({ queryKey: h.key(), exact: true }); h.render(); await turn(); h.render();
    assert.equal(h.requests.length, 2); assert.equal(h.client().getQueryData(h.key())[0].leads.length, 24);
    assert.equal(h.boardRequests.length, 2); assert.equal(h.errors.length, 0);
  } finally { h.close(); }
});

test('an expanded column stays visible across navigation and refresh, then uses only freshly read leads', async () => {
  const h = runtime({ desired: {}, stages: ['stage-a', 'stage-b'] });
  const gate = deferred();
  try {
    await h.start();
    const key = h.key();
    h.client().setQueryData(key, board(['stage-a', 'stage-b']).map(stage =>
      stage.id === 'stage-a' ? { ...stage, leads: leads(1000, 132) } : stage));
    h.render();
    assert.equal(h.remount().data[0].leads.length, 132);
    assert.equal(h.boardRequests.length, 1, 'returning to the route does not reread a fresh board');

    h.pageResponse(p => p.offset === 12 ? gate.promise : Promise.resolve(page(p.stageId, p.limit, p.offset)));
    const refresh = h.client().refetchQueries({ queryKey: key, exact: true });
    await turn();
    assert.equal(h.render().data[0].leads[0].id, 'stage-a-lead-1000');
    assert.equal(h.render().data[0].leads.length, 132);
    assert.equal(h.requests[0].limit, 100);
    assert.equal(h.requests[0].intent.expectedSessionId, 'sid-a');

    gate.resolve(page('stage-a', 100));
    await refresh;
    const refreshed = h.render().data;
    assert.deepEqual(refreshed.map(stage => stage.leads.length), [132, 12]);
    assert.equal(refreshed[0].leads[0].id, 'stage-a-lead-0');
    assert.deepEqual(h.requests.map(p => [p.stageId, p.offset, p.limit]), [
      ['stage-a', 12, 100], ['stage-a', 112, 20],
    ]);
  } finally { gate.resolve(page('stage-a', 100)); h.close(); }
});

test('remount resumes an interrupted cold restore even when the partial cache is fresh', async () => {
  const h = runtime();
  const first = deferred();
  try {
    h.pageResponse(() => first.promise);
    await h.start();
    assert.equal(h.render().data[0].leads.length, 12);
    h.pageResponse(p => Promise.resolve(page(p.stageId, p.limit, p.offset)));
    h.remount();
    first.resolve(page());
    await turn();
    assert.equal(h.render().data[0].leads.length, 24);
    assert.equal(h.boardRequests.length, 2);
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].signal.aborted, true);
  } finally { first.resolve(page()); h.close(); }
});

for (const version of ['explicit continuation', 'legacy response']) {
  test(`${version} restores a saved depth up to 60 even when the first-page total is stale`, async () => {
    const h = runtime({ desired: { 'stage-a': 9999 } });
    try {
      h.boardResponse(async () => { const value = board(); value[0].total_lead_count = 12; return value; });
      h.pageResponse(async params => ({ ...page(params.stageId, params.limit, params.offset), ...(version === 'explicit continuation' ? { hasMore: true } : {}) }));
      await h.start(); await turn(); h.render();
      const stage = h.client().getQueryData(h.key())[0];
      assert.equal(stage.leads.length, 60); assert.equal(stage.has_more, true); assert.ok(stage.total_lead_count >= 61);
      assert.equal(h.requests.length, 1); assert.equal(h.requests[0].limit, 48); assert.equal(h.requests[0].offset, 12);
      assert.equal(h.requests[0].cursorBeforeId, 'stage-a-lead-11'); assert.equal(h.storage.length, 1); assert.equal(h.errors.length, 0);
      h.render(); await turn(); assert.equal(h.requests.length, 1, 'restoration never continues automatically beyond its saved cap');
    } finally { h.close(); }
  });
}

test('restoration honors an explicit terminal full page and projects only the loaded count', async () => {
  const h = runtime({ desired: { 'stage-a': 60 } });
  try {
    h.pageResponse(async params => ({ ...page(params.stageId, params.limit, params.offset), hasMore: false }));
    await h.start(); await turn(); h.render();
    const stage = h.client().getQueryData(h.key())[0];
    assert.equal(stage.leads.length, 60); assert.equal(stage.has_more, false); assert.equal(stage.total_lead_count, 60);
    assert.equal(h.requests.length, 1); assert.equal(h.storage.length, 1); assert.equal(h.errors.length, 0);
  } finally { h.close(); }
});

for (const version of ['duplicate continuation', 'duplicate terminal', 'empty continuation']) {
  test(`a ${version} restore page preserves the initial snapshot and reports one bounded error`, async () => {
    const h = runtime();
    try {
      h.pageResponse(async () => ({ ...page('stage-a', version === 'empty continuation' ? 0 : version === 'duplicate terminal' ? 1 : 12, 0), hasMore: version !== 'duplicate terminal' }));
      await h.start(); await turn(); const result = h.render(), stage = result.data[0];
      assert.equal(stage.leads.length, 12); assert.equal(stage.has_more, true); assert.equal(stage.total_lead_count, 100);
      assert.ok(result.restoreError?.error); assert.equal(h.errors.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.storage.length, 0);
      h.render(); await turn(); assert.equal(h.requests.length, 1); assert.equal(h.boardRequests.length, 1);
    } finally { h.close(); }
  });
}
