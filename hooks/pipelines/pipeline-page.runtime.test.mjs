import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { MutationCache, MutationObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { captureLeadRequestIntent } from '../../lib/lead-request-intent.ts';
import { captureQueryClientAccess } from '../../lib/access/query-client-access.ts';
import { stageWithLeadsQueryKey } from '../../lib/pipeline-query-key.ts';
import { capturePipelinePageLease } from '../../lib/pipeline-page-lease.ts';
import { getPendingPipelineMoves, registerPendingPipelineMove, clearPendingPipelineMoves } from '../../lib/pipeline-board-cache.ts';
import { createPipelinePaginationStorageKey, getPipelineLeadPageCursor, getPipelineStagePaginationAfterPage, hasMorePipelineStageLeadsAfterPage } from '../../lib/pipeline-pagination-state.ts';
import { evaluateProduction, productionDeclaration, deferred, turn } from '../leads/lead-request-runtime-fixture.mjs';

const hookSource = productionDeclaration('hooks/use-stages.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLoadMoreLeads');
const scopeSource = productionDeclaration('hooks/leads/use-lead-request-scope.ts', node => ts.isFunctionDeclaration(node) && node.name?.text === 'useLeadRequestScope');
const initial = () => [{ id: 'stage-a', total_lead_count: 13, has_more: true, leads: Array.from({ length: 12 }, (_, index) => ({ id: `lead-${index}`, stage_id: 'stage-a', board_order_at: `2026-10-16T12:00:${String(30 - index).padStart(2, '0')}.000001Z` })) }];
const page = (extra = {}) => ({ stageId: 'stage-a', leads: [{ id: 'lead-page', stage_id: 'stage-a', organization_id: 'org-a', ...extra }] });
const pageRows = (start, count, metadata = {}) => ({ stageId: 'stage-a', ...metadata, leads: Array.from({ length: count }, (_, index) => ({
  id: `lead-${start + index}`, stage_id: 'stage-a', organization_id: 'org-a', pipeline_id: 'pipeline-a',
  board_order_at: `2026-10-16T12:00:${String(30 - start - index).padStart(2, '0')}.000001Z`,
})) });

function runtime(globalOnMutate) {
  const client = new QueryClient({ mutationCache: new MutationCache({ onMutate: globalOnMutate }), defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnMount: false }, mutations: { retry: false } } });
  const auth = { activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' }, profile: { id: 'actor-a' }, session: { sid: 'sid-a' } };
  const requests = [], storage = [], refetches = [], queryObservers = [], mutationObservers = [];
  const slots = []; let cursor = 0; let response = async () => page();
  const changed = (a, b) => !a || b.some((value, index) => value !== a[index]);
  const dependencies = {
    useAuth: () => auth, useOrganizationId: () => auth.activeOrganization.organizationId, useQueryClient: () => client,
    useRef: value => { const index = cursor++; return slots[index] ??= { current: value }; },
    useMemo: (build, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) slots[index] = { deps, value: build() }; return slots[index].value; },
    useLayoutEffect: (setup, deps) => { const index = cursor++; if (changed(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps, cleanup: setup() }; } },
    useMutation: options => {
      const index = cursor++;
      if (!slots[index]) {
        const observer = new MutationObserver(client, options);
        const unsubscribe = observer.subscribe(() => {});
        slots[index] = { observer, cleanup: unsubscribe }; mutationObservers.push(observer);
      }
      const observer = slots[index].observer; observer.setOptions(options);
      return { ...observer.getCurrentResult(), mutate: (variables, callbacks) => { void observer.mutate(variables, callbacks).catch(() => {}); }, mutateAsync: (variables, callbacks) => observer.mutate(variables, callbacks) };
    },
    getGlobalSignOutSessionId: session => session?.sid,
    captureLeadRequestIntent, captureQueryClientAccess,
    getVimobAPIAccessTokenUserId: () => auth.user?.id,
    getVimobAPIAccessTokenSessionId: () => auth.session?.sid,
    stageWithLeadsQueryKey, capturePipelinePageLease, getPendingPipelineMoves, createPipelinePaginationStorageKey, hasMorePipelineStageLeadsAfterPage,
    getPipelineStagePaginationAfterPage,
    persistPipelineStageLoadedCount: (...args) => storage.push(args), LEADS_PER_STAGE: 12,
    shouldRetryPipelineQuery: () => false,
    getPipelineStageLeads: async params => { requests.push(params); return response(params); },
  };
  dependencies.useLeadRequestScope = evaluateProduction(scopeSource, dependencies, 'useLeadRequestScope');
  const hook = evaluateProduction(hookSource, dependencies, 'useLoadMoreLeads');
  const key = filters => stageWithLeadsQueryKey({ organizationId: 'org-a', pipelineId: 'pipeline-a', filters });
  function observe(filters, data = initial()) {
    const queryKey = key(filters); client.setQueryData(queryKey, data);
    let server = data;
    const observer = new QueryObserver(client, { queryKey, queryFn: async () => { refetches.push(queryKey); return server; }, staleTime: Infinity, refetchOnMount: false });
    const unsubscribe = observer.subscribe(() => {}); queryObservers.push(unsubscribe);
    return { key: queryKey, stop: unsubscribe, server: data => { server = data; } };
  }
  const base = observe();
  const variables = (filters) => { const stage = client.getQueryData(key(filters))[0]; return { pipelineId: 'pipeline-a', stageId: 'stage-a', offset: stage.leads.length, ...getPipelineLeadPageCursor(stage.leads.at(-1)), filters }; };
  return {
    client, auth, requests, storage, refetches, base, key, observe, variables,
    render: () => { cursor = 0; return hook(); }, respond: callback => { response = callback; },
    switchTo: (org = 'org-a', actor = 'actor-a', sid = 'sid-a') => { auth.activeOrganization.organizationId = org; auth.user = { id: actor }; auth.session = { sid }; },
    unmount: () => slots.forEach(slot => slot?.cleanup?.()),
    close: () => { slots.forEach(slot => slot?.cleanup?.()); queryObservers.forEach(fn => fn()); client.clear(); },
  };
}

test('a normal page appends once and persists only its captured viewer/key', async () => {
  const h = runtime(); try {
    await h.render().mutateAsync(h.variables());
    assert.equal(h.client.getQueryData(h.base.key)[0].leads.length, 13);
    assert.equal(h.client.getQueryData(h.base.key)[0].has_more, false);
    assert.equal(h.storage.length, 1);
    assert.equal(h.requests[0].intent.expectedUserId, 'actor-a');
    assert.equal(h.requests[0].intent.expectedSessionId, 'sid-a');
    assert.equal(h.refetches.length, 0);
  } finally { h.close(); }
});

for (const mode of ['newer canonical snapshot', 'byte-identical server read', 'manual cache write', 'pending drag', 'filter A-B-A', 'remove and recreate query']) {
  test(`late page cannot overwrite ${mode}`, async () => {
    const h = runtime(); const gate = deferred();
    try {
      h.respond(() => gate.promise);
      const promise = h.render().mutateAsync(h.variables()); await turn();
      const canonical = initial(); canonical[0].total_lead_count = 12; canonical[0].has_more = false;
      h.base.server(canonical);
      if (mode === 'pending drag') registerPendingPipelineMove(h.base.key, { leadId: 'other', sourceStageId: 'stage-a', destinationStageId: 'stage-a', destinationIndex: 0, version: 1 });
      else if (mode === 'filter A-B-A') { h.base.stop(); const b = h.observe({ searchQuery: 'B' }); b.stop(); h.observe(); }
      else if (mode === 'remove and recreate query') { h.client.removeQueries({ queryKey: h.base.key, exact: true }); h.observe(undefined, canonical); }
      else if (mode === 'byte-identical server read') await h.client.fetchQuery({ queryKey: h.base.key, queryFn: async () => initial(), staleTime: 0 });
      else h.client.setQueryData(h.base.key, canonical);
      gate.resolve(page()); await promise; await turn();
      assert.equal(h.client.getQueryData(h.base.key)[0].leads.some(lead => lead.id === 'lead-page'), false);
      assert.equal(h.storage.length, 0);
    } finally { clearPendingPipelineMoves(h.base.key); gate.resolve(page()); h.close(); }
  });
}

for (const mode of ['org', 'actor', 'SID', 'org A-B-A', 'SID A-B-A', 'unmount']) {
  test(`a page begun before ${mode} cannot append, notify, persist or refetch a retired visit`, async () => {
    const h = runtime(); const gate = deferred(); let callbackCount = 0;
    try {
      h.respond(() => gate.promise);
      const promise = h.render().mutateAsync(h.variables(), { onSuccess: () => callbackCount++, onError: () => callbackCount++ }); await turn();
      if (mode === 'unmount') h.unmount();
      else {
        h.switchTo(mode.startsWith('org') ? 'org-b' : 'org-a', mode === 'actor' ? 'actor-b' : 'actor-a', mode.startsWith('SID') ? 'sid-b' : 'sid-a'); h.render();
        if (mode.endsWith('A-B-A')) { h.switchTo(); h.render(); }
      }
      gate.resolve(page()); await promise; await turn();
      assert.equal(h.client.getQueryData(h.base.key)[0].leads.length, 12);
      assert.equal(h.storage.length, 0); assert.equal(callbackCount, 0); assert.equal(h.refetches.length, 0);
      assert.equal(h.requests[0].signal.aborted, true);
    } finally { gate.resolve(page()); h.close(); }
  });
}

test('intent and filter snapshot are captured before a global onMutate await', async () => {
  const gate = deferred(); const h = runtime(() => gate.promise);
  try {
    const filters = { filterTags: ['tag-a'] }; const query = h.observe(filters);
    const promise = h.render().mutateAsync(h.variables(filters));
    filters.filterTags.push('tag-b'); h.switchTo('org-b'); h.render(); gate.resolve();
    await assert.rejects(promise, /quadro mudou/);
    assert.equal(h.requests.length, 0); assert.equal(h.client.getQueryData(query.key)[0].leads.length, 12);
  } finally { gate.resolve(); h.close(); }
});

test('a filter array mutated after click cannot change an in-flight request', async () => {
  const gate = deferred(); const h = runtime(() => gate.promise);
  try {
    const filters = { filterTags: ['tag-a'] }; h.observe(filters);
    const promise = h.render().mutateAsync(h.variables(filters)); filters.filterTags.push('tag-b'); gate.resolve(); await promise;
    assert.deepEqual(h.requests[0].filters.filterTags, ['tag-a']);
  } finally { gate.resolve(); h.close(); }
});

test('concurrent pages of the same base cannot append an older second response', async () => {
  const h = runtime(); const first = deferred(), second = deferred();
  try {
    h.respond(() => h.requests.length === 1 ? first.promise : second.promise);
    const hook = h.render(), vars = h.variables(); const a = hook.mutateAsync(vars), b = hook.mutateAsync(vars); await turn();
    first.resolve(page()); await a; second.resolve(page({ id: 'late-page' })); await b; await turn();
    assert.equal(h.client.getQueryData(h.base.key)[0].leads.some(lead => lead.id === 'late-page'), false);
    assert.equal(h.storage.length, 1);
  } finally { first.resolve(page()); second.resolve(page()); h.close(); }
});

test('wrong-stage and wrong-tenant responses never enter the board and request reconciliation', async () => {
  for (const value of [{ ...page(), stageId: 'stage-b' }, page({ organization_id: 'org-b' }), page({ stage_id: 'stage-b' })]) {
    const h = runtime(); try {
      h.respond(async () => value); await h.render().mutateAsync(h.variables()); await turn();
      assert.equal(h.client.getQueryData(h.base.key)[0].leads.length, 12); assert.equal(h.storage.length, 0); assert.equal(h.refetches.length, 1);
    } finally { h.close(); }
  }
});

for (const version of ['explicit continuation', 'legacy response']) {
  test(`${version} keeps a growing team cohort pageable after its initial total is reached`, async () => {
    const h = runtime();
    try {
      const filters = { teamId: 'team-a' }, before = initial(); before[0].total_lead_count = 24;
      const scoped = h.observe(filters, before);
      h.respond(async () => h.requests.length === 1
        ? pageRows(12, 12, version === 'explicit continuation' ? { hasMore: true } : {})
        : pageRows(24, 1, version === 'explicit continuation' ? { hasMore: false } : {}));
      await h.render().mutateAsync(h.variables(filters));
      let stage = h.client.getQueryData(scoped.key)[0];
      assert.equal(stage.leads.length, 24); assert.equal(stage.has_more, true);
      assert.ok(stage.total_lead_count >= 25, 'the local projection cannot claim all eligible cards are loaded');
      await h.render().mutateAsync(h.variables(filters));
      stage = h.client.getQueryData(scoped.key)[0];
      assert.equal(stage.leads.length, 25); assert.equal(stage.has_more, false); assert.equal(stage.total_lead_count, 25);
      assert.deepEqual(h.requests.map(value => [value.offset, value.cursorBeforeId, value.filters.teamId]), [[12, 'lead-11', 'team-a'], [24, 'lead-23', 'team-a']]);
      assert.equal(new Set(stage.leads.map(value => value.id)).size, 25);
      assert.equal(h.storage.length, 2); assert.equal(h.refetches.length, 0);
    } finally { h.close(); }
  });
}

test('an explicit terminal full page corrects the local total without an extra request', async () => {
  const h = runtime();
  try {
    const before = initial(); before[0].total_lead_count = 100; h.client.setQueryData(h.base.key, before);
    h.respond(async () => pageRows(12, 12, { hasMore: false }));
    await h.render().mutateAsync(h.variables()); await turn();
    const stage = h.client.getQueryData(h.base.key)[0];
    assert.equal(stage.leads.length, 24); assert.equal(stage.has_more, false); assert.equal(stage.total_lead_count, 24);
    assert.equal(h.requests.length, 1); assert.equal(h.refetches.length, 0); assert.equal(h.storage.length, 1);
  } finally { h.close(); }
});

test('an empty terminal page ends an already populated column despite its old total', async () => {
  const h = runtime();
  try {
    const before = initial(); before[0].total_lead_count = 100; h.client.setQueryData(h.base.key, before);
    h.respond(async () => pageRows(12, 0, { hasMore: false }));
    await h.render().mutateAsync(h.variables()); await turn();
    const stage = h.client.getQueryData(h.base.key)[0];
    assert.equal(stage.leads.length, 12); assert.equal(stage.has_more, false); assert.equal(stage.total_lead_count, 12);
    assert.equal(h.requests.length, 1); assert.equal(h.refetches.length, 0);
  } finally { h.close(); }
});

for (const version of ['explicit continuation', 'legacy response', 'explicit terminal', 'empty explicit continuation']) {
  test(`${version} reconciles a page without cursor progress once instead of exhausting the column`, async () => {
    const h = runtime(); let successes = 0;
    try {
      const canonical = initial(); canonical[0].total_lead_count = 12; canonical[0].has_more = false; h.base.server(canonical);
      h.respond(async () => pageRows(0, version === 'empty explicit continuation' ? 0 : version === 'explicit terminal' ? 1 : 12,
        version === 'legacy response' ? {} : { hasMore: version !== 'explicit terminal' }));
      await h.render().mutateAsync(h.variables(), { onSuccess: () => successes++ }); await turn();
      assert.equal(h.refetches.length, 1); assert.equal(h.requests.length, 1); assert.equal(h.storage.length, 0); assert.equal(successes, 0);
      assert.equal(h.client.getQueryData(h.base.key)[0].leads.length, 12);
      await turn(); assert.equal(h.refetches.length, 1); assert.equal(h.requests.length, 1);
    } finally { h.close(); }
  });
}

test('partial deduplication advances the visible cursor and preserves explicit continuation', async () => {
  const h = runtime();
  try {
    const before = initial(); before[0].total_lead_count = 13; h.client.setQueryData(h.base.key, before);
    h.respond(async () => h.requests.length === 1 ? pageRows(11, 12, { hasMore: true }) : pageRows(23, 1, { hasMore: false }));
    await h.render().mutateAsync(h.variables());
    const growing = h.client.getQueryData(h.base.key)[0];
    assert.equal(growing.leads.length, 23); assert.equal(growing.has_more, true); assert.ok(growing.total_lead_count >= 24);
    await h.render().mutateAsync(h.variables());
    const stage = h.client.getQueryData(h.base.key)[0];
    assert.equal(stage.leads.length, 24); assert.equal(stage.has_more, false); assert.equal(stage.total_lead_count, 24);
    assert.equal(h.requests[1].cursorBeforeId, 'lead-22'); assert.equal(h.requests[1].offset, 23);
    assert.equal(new Set(stage.leads.map(value => value.id)).size, 24); assert.equal(h.refetches.length, 0);
  } finally { h.close(); }
});
