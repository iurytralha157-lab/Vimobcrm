import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import { buildLeadHistory } from './build-history.ts';
import * as pagination from './pagination.ts';
import * as paginationQuery from './pagination-query.ts';
import * as access from '../../lib/access/tenant-query-cache.ts';
import * as leadReadAccess from '../../lib/lead-read-access.ts';

const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const leadId = id(1), orgId = id(2), actorId = id(3);
const snapshot = '2026-10-16T12:00:00.123456Z';
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
function raw(number = 8) {
  return { timelineEvents: [], activityEvents: [{ id: id(number), type: 'note', content: 'Synthetic legacy history',
    created_at: '2026-10-16T10:00:00Z' }], entryEvents: [], distributionLogs: [], assignmentLogs: [], auditLogs: [],
    users: [], lead: { id: leadId, created_at: '2026-10-01T00:00:00Z' }, leadMeta: {} };
}
const legacy = number => ({ data: raw(number), legacy: true });
const page = (number = 8, nextCursor = 'next') => ({
  data: { ...raw(number), historyCoverage: { complete: false,
    canonicalPresence: { leadCreated: true, firstResponse: false, assignment: false } } },
  pagination: { nextCursor, hasOlder: nextCursor !== null, snapshotAt: snapshot },
});
function fixture(loadPage) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const keys = pagination.leadHistoryPageKeys(leadId, orgId, 'scope-a');
  const observer = new QueryObserver(queryClient, { queryKey: keys.projection, retry: false, staleTime: 60_000,
    queryFn: ({ signal }) => paginationQuery.fetchLeadHistoryProjection({ queryClient, leadId,
      projectionKey: keys.projection, stateKey: keys.state, loadPage,
      build: data => buildLeadHistory(data, leadId, formatters) }, signal) });
  const stop = observer.subscribe(() => {});
  return { queryClient, keys, observer, close() { stop(); queryClient.clear(); } };
}

// The hook's real return expression consumes actual query/cache state. Only
// React subscription plumbing and Auth/transport are synthetic in this helper.
function hookResult(f, { api = {}, capture = () => {} } = {}) {
  const source = readFileSync(new URL('../use-lead-history.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = {
    '@tanstack/react-query': { useQueryClient: () => f.queryClient,
      useQuery: options => {
        if (options.enabled === false) return { data: f.queryClient.getQueryData(f.keys.state) };
        capture(options);
        return { ...f.observer.getCurrentResult(), refetch: () => f.observer.refetch() };
      } },
    '@/contexts/AuthContext': { useAuth: () => ({ activeOrganization: { organizationId: orgId },
      user: { id: actorId }, tenantContext: { permissions: ['lead_view'] } }) },
    '@/hooks/use-lead-timeline': { formatResponseTime: String },
    '@/lib/api/leads': { leadsAPI: api }, '@/lib/lead-read-access': leadReadAccess,
    '@/lib/property-display-utils': { formatPropertyCurrency: String },
    '@/lib/utils/formatting': { formatBRLCurrencyWithDefaultDecimals: String },
    '@/lib/access/tenant-query-cache': access, './lead-history/pagination': pagination,
    './lead-history/pagination-query': paginationQuery, './lead-history': { buildLeadHistory },
  };
  const commonJSModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {})(name => {
    assert.ok(name in modules, `Unexpected dependency ${name}`); return modules[name];
  }, commonJSModule, commonJSModule.exports);
  return commonJSModule.exports.useLeadHistory(leadId, { paginated: true });
}

test('first-page legacy response displays events in array cache without claiming complete history or cursor', async () => {
  const calls = [];
  const f = fixture(async (_signal, cursor) => { calls.push(cursor); return legacy(8); });
  try {
    await f.observer.refetch();
    assert.equal(f.observer.getCurrentResult().isError, false);
    assert.ok(Array.isArray(f.queryClient.getQueryData(f.keys.projection)));
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === `activity-${id(8)}`), true);
    const state = f.queryClient.getQueryData(f.keys.state);
    assert.equal(state.paginationUnavailable, true);
    assert.equal(state.pagination, undefined);
    const result = hookResult(f);
    assert.equal(result.historyPaginationUnavailable, true);
    assert.equal(result.hasOlderHistory, false);
    assert.equal(result.historyComplete, false);
    assert.equal(await paginationQuery.fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state), false);
    assert.equal(calls.length, 1);
  } finally { f.close(); }
});

test('normal paged response keeps cursor and does not mark pagination unavailable', async () => {
  const f = fixture(async () => page());
  try {
    await f.observer.refetch();
    const state = f.queryClient.getQueryData(f.keys.state);
    assert.equal(state.paginationUnavailable, false);
    assert.equal(state.pagination.nextCursor, 'next');
    const result = hookResult(f);
    assert.equal(result.historyPaginationUnavailable, false);
    assert.equal(result.hasOlderHistory, true);
    assert.equal(result.historyComplete, false);
  } finally { f.close(); }
});

test('refetch after backend upgrade replaces legacy state with paged continuation', async () => {
  let upgraded = false;
  const f = fixture(async () => upgraded ? page(9) : legacy(8));
  try {
    await f.observer.refetch();
    assert.equal(f.queryClient.getQueryData(f.keys.state).paginationUnavailable, true);
    upgraded = true;
    await f.observer.refetch();
    const state = f.queryClient.getQueryData(f.keys.state);
    assert.equal(state.paginationUnavailable, false);
    assert.equal(state.pagination.nextCursor, 'next');
    assert.equal(hookResult(f).hasOlderHistory, true);
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === `activity-${id(8)}`), false);
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === `activity-${id(9)}`), true);
  } finally { f.close(); }
});

test('legacy history with unknown coverage never fabricates canonical events or creative facts outside its window', async () => {
  const response = legacy(8);
  response.data.lead = { ...response.data.lead, assigned_user_id: actorId,
    first_response_at: '2026-10-01T01:00:00Z', first_response_seconds: 3600 };
  response.data.leadMeta = { id: id(77), created_at: '2026-10-01T00:00:00Z',
    raw_payload: { name: 'Synthetic', interest: 'Synthetic question' }, creative_url: 'https://example.invalid/creative.png' };
  const f = fixture(async () => response);
  try {
    await f.observer.refetch();
    assert.equal(f.observer.getCurrentResult().isError, false);
    const events = f.observer.getCurrentResult().data;
    assert.equal(events.some(event => event.id.startsWith('lead-fallback-')), false);
    assert.equal(events.some(event => event.id.includes('lead-meta')), false);
    const coverage = f.queryClient.getQueryData(f.keys.state).raw.historyCoverage;
    assert.equal(coverage.complete, false);
    assert.equal(coverage.canonicalPresence, undefined);
  } finally { f.close(); }
});

for (const [name, data] of [['null payload', null], ['missing lead', { ...raw(), lead: undefined }],
  ['different lead', { ...raw(), lead: { ...raw().lead, id: id(99) } }]]) {
  test(`legacy ${name} is rejected instead of displaying an authorized empty result`, async () => {
    const f = fixture(async () => ({ data, legacy: true }));
    try {
      await f.observer.refetch();
      assert.equal(f.observer.getCurrentResult().isError, true);
      assert.equal(f.observer.getCurrentResult().data, undefined);
      assert.notEqual(f.queryClient.getQueryData(f.keys.state)?.paginationUnavailable, true);
    } finally { f.close(); }
  });
}

test('legacy response to an older-page cursor fails without replacing loaded paged events', async () => {
  const f = fixture(async (_signal, cursor) => cursor ? legacy(2) : page(8));
  try {
    await f.observer.refetch();
    const events = f.observer.getCurrentResult().data;
    assert.equal(await paginationQuery.fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state), false);
    assert.deepEqual(f.observer.getCurrentResult().data, events);
    assert.equal(f.observer.getCurrentResult().isError, false);
    const state = f.queryClient.getQueryData(f.keys.state);
    assert.ok(state.olderError instanceof Error);
    assert.equal(state.paginationUnavailable, false);
    assert.equal(state.pagination.nextCursor, 'next');
  } finally { f.close(); }
});

test('a first-page downgrade clears the old paginated cursor instead of mixing snapshots', async () => {
  let downgraded = false;
  const f = fixture(async () => downgraded ? legacy(9) : page(8));
  try {
    await f.observer.refetch();
    downgraded = true;
    await f.observer.refetch();
    const state = f.queryClient.getQueryData(f.keys.state);
    assert.equal(state.paginationUnavailable, true);
    assert.equal(state.pagination, undefined);
    assert.equal(hookResult(f).hasOlderHistory, false);
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === `activity-${id(8)}`), false);
  } finally { f.close(); }
});

test('definitive denial after legacy success clears raw history and cached events', async () => {
  let denied = false;
  const f = fixture(async () => {
    if (denied) throw Object.assign(new Error('Synthetic read denial'), { status: 403 });
    return legacy(8);
  });
  try {
    await f.observer.refetch();
    denied = true;
    await f.observer.refetch();
    assert.equal(f.observer.getCurrentResult().isError, true);
    assert.deepEqual(f.queryClient.getQueryData(f.keys.projection), []);
    assert.equal(f.queryClient.getQueryData(f.keys.state).raw, undefined);
    assert.equal(hookResult(f).historyPaginationUnavailable, false);
  } finally { f.close(); }
});

test('unmount cancels a deferred legacy response before it can populate history', async () => {
  let resolve, signal;
  const f = fixture(requestSignal => {
    signal = requestSignal;
    return new Promise(done => { resolve = done; });
  });
  try {
    f.observer.destroy();
    assert.equal(signal.aborted, true);
    resolve(legacy(8));
    await new Promise(done => setImmediate(done));
    assert.equal(f.queryClient.getQueryData(f.keys.projection), undefined);
    assert.equal(f.queryClient.getQueryData(f.keys.state).raw, undefined);
  } finally { f.close(); }
});

test('the actual hook opts into legacy only on first-page API reads, retaining organization and signal', async () => {
  const f = fixture(async () => page(8));
  const calls = [];
  try {
    await f.observer.refetch();
    let options;
    hookResult(f, { capture: value => { options = value; }, api: {
      getLeadHistoryPage: async (lead, org, request) => {
        calls.push({ lead, org, ...request });
        return request.cursor ? page(2, null) : legacy(8);
      },
    } });
    const signal = new AbortController().signal;
    await options.queryFn({ signal });
    const stateKey = pagination.leadHistoryPageKeys(leadId, orgId, options.queryKey[4]).state;
    f.queryClient.setQueryData(stateKey, { ...f.queryClient.getQueryData(f.keys.state), requestedCursor: 'next' });
    await options.queryFn({ signal });
    assert.deepEqual(calls.map(call => [call.lead, call.org, call.allowLegacy, call.cursor]),
      [[leadId, orgId, true, undefined], [leadId, orgId, false, 'next']]);
    assert.equal(calls.every(call => call.signal === signal && call.pageSize === 100), true);
  } finally { f.close(); }
});
