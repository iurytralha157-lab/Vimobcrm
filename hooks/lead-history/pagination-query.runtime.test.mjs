import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { leadHookRuntime } from '../leads/lead-request-runtime-fixture.mjs';
import { QueryClient, QueryObserver } from '@tanstack/query-core';

import { buildLeadHistory } from './build-history.ts';
import { leadHistoryPageKeys, mergeLeadHistoryPage, historyRawRowCount } from './pagination.ts';
import { fetchLeadHistoryProjection, fetchOlderLeadHistory } from './pagination-query.ts';
import { appendOptimisticLeadHistoryEvent, removeOptimisticLeadHistoryEvent } from '../use-optimistic-lead-history.ts';
import * as optimisticHistory from '../use-optimistic-lead-history.ts';
import { leadHistoryPageResponseSchema } from '../../lib/validation/lead-history-pagination.ts';
import { manualActivityCreateInputSchema } from '../../lib/validation/manual-activities.ts';
import { parseDomainInput } from '../../lib/validation/common.ts';

const leadId = '00000000-0000-4000-8000-000000000001';
const orgId = '00000000-0000-4000-8000-000000000002';
const actorId = '00000000-0000-4000-8000-000000000003';
const snapshot = '2026-10-12T14:00:00.123456Z';
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const formatters = { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String };
const build = raw => buildLeadHistory(raw, leadId, formatters);
const presence = { leadCreated: true, firstResponse: true, assignment: true };
const activity = (number, type = 'note') => ({ id: id(number), type, content: `Synthetic ${number}`,
  created_at: `2026-10-12T${String(number % 10 + 1).padStart(2, '0')}:00:00Z`, user_id: actorId });
function page(rows = [], nextCursor = null, extra = {}) {
  return { data: { timelineEvents: [], activityEvents: rows, entryEvents: [], distributionLogs: [],
    assignmentLogs: [], auditLogs: [], users: [], leadMeta: {},
    lead: { id: leadId, created_at: '2026-10-01T00:00:00Z', source: 'manual',
      assigned_user_id: actorId, first_response_at: '2026-10-01T01:00:00Z' },
    historyCoverage: { complete: false, canonicalPresence: presence }, ...extra },
    pagination: { nextCursor, hasOlder: nextCursor !== null, snapshotAt: snapshot } };
}
function defer() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
const turn = () => new Promise(resolve => setImmediate(resolve));
function fixture(loadPage, scope = 'scope-a') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const keys = leadHistoryPageKeys(leadId, orgId, scope);
  const context = { queryClient, projectionKey: keys.projection, stateKey: keys.state, leadId, loadPage, build };
  const observer = new QueryObserver(queryClient, { queryKey: keys.projection,
    queryFn: ({ signal }) => fetchLeadHistoryProjection(context, signal), staleTime: 60_000, retry: false });
  const unsubscribe = observer.subscribe(() => {});
  return { queryClient, keys, observer, context, close: () => { unsubscribe(); queryClient.clear(); } };
}

test('schema rejeita marcador ausente, cursor incoerente e envelope antigo no caminho paginado', () => {
  assert.equal(leadHistoryPageResponseSchema.safeParse(page([activity(1)], 'next')).success, true);
  const legacy = page(); delete legacy.data.historyCoverage;
  assert.equal(leadHistoryPageResponseSchema.safeParse(legacy).success, false);
  const broken = page(); broken.pagination.hasOlder = true;
  assert.equal(leadHistoryPageResponseSchema.safeParse(broken).success, false);
  assert.equal(leadHistoryPageResponseSchema.safeParse({ data: page().data }).success, false);
});

test('página parcial não fabrica criação, resposta, atribuição, formulário ou criativo alternativo', () => {
  const result = mergeLeadHistoryPage(undefined, page([activity(1)], 'next', {
    leadMeta: { id: id(77), created_at: '2026-10-01T00:00:00Z', platform: 'webhook',
      raw_payload: { name: 'Synthetic', email: 'example@example.invalid', interest: 'Synthetic question' },
      creative_url: 'https://example.invalid/creative.png' },
    entryEvents: [{ id: id(80), created_at: '2026-10-10T00:00:00Z', entry_type: 'reentry', source: 'webhook' }],
  }), leadId);
  const history = build(result.raw);
  assert.equal(history.some(event => event.id.startsWith('lead-fallback-')), false);
  assert.equal(history.some(event => event.id.includes('lead-meta')), false);
  assert.equal(history.find(event => event.id === `entry-${id(80)}`).label, 'Reentrada');
});

test('ausência canônica comprovada permite fatos derivados sem esperar página inexistente', () => {
  const result = mergeLeadHistoryPage(undefined, page([activity(1)], 'next', {
    historyCoverage: { complete: false, canonicalPresence: { leadCreated: false, firstResponse: false, assignment: false } },
  }), leadId);
  assert.equal(build(result.raw).filter(event => event.id.startsWith('lead-fallback-')).length, 3);
});

test('mesmo UUID entre fontes permanece, repetição dentro da fonte deduplica e página final equivale ao legado', () => {
  const first = page([activity(8)], 'next', { timelineEvents: [{ id: id(8), event_type: 'note', created_at: activity(8).created_at }] });
  const partial = { ...mergeLeadHistoryPage(undefined, first, leadId), generation: 1, isFetchingOlder: false, olderError: null };
  const last = page([activity(2), activity(8)], null, {
    entryEvents: [ { id: id(51), created_at: '2026-10-03T00:00:00Z', entry_type: 'reentry' },
      { id: id(50), created_at: '2026-10-02T00:00:00Z', entry_type: 'reentry' } ],
  });
  const complete = mergeLeadHistoryPage(partial, last, leadId, 'next');
  assert.equal(historyRawRowCount(complete.raw), 5);
  assert.equal(complete.raw.historyCoverage.complete, true);
  const expected = { ...complete.raw }; delete expected.historyCoverage;
  // Presence says the canonical events exist but are outside this synthetic sample;
  // compare the real source mapping without the lead fallback context.
  delete expected.lead;
  assert.deepEqual(build({ ...complete.raw, lead: undefined }), build(expected));
  assert.deepEqual(build(complete.raw).filter(event => event.type === 'lead_reentry').map(event => event.label), ['2ª Entrada', '3ª Entrada']);
  assert.equal(build(complete.raw).filter(event => event.id.endsWith(id(8))).length, 2);
});

test('cursor repetido, snapshot diferente, lead estranho, presença instável e página sem avanço falham explicitamente', () => {
  const base = { ...mergeLeadHistoryPage(undefined, page([activity(8)], 'next'), leadId), generation: 1, isFetchingOlder: false, olderError: null };
  const inputs = [page([activity(2)], 'next'), page([], 'new-cursor'), page([activity(8)], null),
    { ...page([activity(2)]), pagination: { ...page().pagination, snapshotAt: '2026-10-12T15:00:00Z' } },
    page([activity(2)], null, { lead: { id: id(99) } }),
    page([activity(2)], null, { historyCoverage: { complete: false, canonicalPresence: { ...presence, assignment: false } } }),
  ];
  for (const input of inputs) assert.throws(() => mergeLeadHistoryPage(base, input, leadId, 'next'));
});

test('timestamps nulos têm epoch determinístico no caminho paginado', () => {
  const merged = mergeLeadHistoryPage(undefined, page([], null, {
    timelineEvents: [{ id: id(4), event_type: 'note', created_at: null, event_at: null }],
  }), leadId);
  assert.equal(build(merged.raw)[0].timestamp, '1970-01-01T00:00:00.000Z');
});

test('QueryObserver real une páginas, mantém chave legada completa e deduplica clique concorrente', async () => {
  const older = defer(); const calls = [];
  const f = fixture(async (signal, cursor) => { calls.push({ signal, cursor }); return cursor ? older.promise : page([activity(8)], 'next'); });
  try {
    await f.observer.refetch();
    const legacy = [ { id: 'legacy-full', timestamp: snapshot, type: 'note', label: 'Full legacy', source: 'activity' } ];
    f.queryClient.setQueryData(['lead-history-v2', leadId], legacy);
    const a = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    const b = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    assert.equal(calls.length, 2);
    assert.equal(f.queryClient.getQueryState(f.keys.projection).fetchStatus, 'fetching');
    older.resolve(page([activity(2)])); await Promise.all([a, b]);
    assert.equal(f.observer.getCurrentResult().data.length, 2);
    assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.hasOlder, false);
    assert.deepEqual(f.queryClient.getQueryData(['lead-history-v2', leadId]), legacy);
    for (const [, value] of f.queryClient.getQueriesData({ queryKey: ['lead-history-v2', leadId] })) assert.ok(Array.isArray(value));
  } finally { f.close(); }
});

test('cancelamento pelo prefixo aborta transporte de página anterior e resposta tardia não escreve', async () => {
  const older = defer(); let olderSignal;
  const f = fixture(async (signal, cursor) => { if (cursor) { olderSignal = signal; return older.promise; } return page([activity(8)], 'next'); });
  try {
    await f.observer.refetch();
    const pending = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    await f.queryClient.cancelQueries({ queryKey: ['lead-history-v2', leadId] });
    assert.equal(olderSignal.aborted, true);
    assert.equal(f.queryClient.getQueryData(f.keys.state).isFetchingOlder, false);
    older.resolve(page([activity(2)])); await pending; await turn();
    assert.deepEqual(f.observer.getCurrentResult().data.map(event => event.id), [`activity-${id(8)}`]);
    assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.nextCursor, 'next');
  } finally { f.close(); }
});

test('invalidação durante página anterior refaz primeira página e exclui resposta antiga', async () => {
  const older = defer(); let firstReads = 0; let olderSignal;
  const f = fixture(async (signal, cursor) => {
    if (cursor) { olderSignal = signal; return older.promise; }
    firstReads++; return page([activity(firstReads === 1 ? 8 : 9)], 'next');
  });
  try {
    await f.observer.refetch();
    const pending = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    await f.queryClient.invalidateQueries({ queryKey: ['lead-history-v2', leadId] });
    assert.equal(olderSignal.aborted, true);
    assert.equal(firstReads, 2);
    older.resolve(page([activity(2)])); await pending; await turn();
    assert.deepEqual(f.observer.getCurrentResult().data.map(event => event.id), [`activity-${id(9)}`]);
    assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.hasOlder, true);
  } finally { f.close(); }
});

test('falha anterior conserva eventos, cursor e erro recuperável; retry alcança página final', async () => {
  let fail = true;
  const f = fixture(async (_signal, cursor) => {
    if (cursor && fail) throw new Error('Synthetic older error');
    return cursor ? page([activity(2)]) : page([activity(8)], 'next');
  });
  try {
    await f.observer.refetch();
    await fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    assert.equal(f.observer.getCurrentResult().isError, false);
    assert.equal(f.observer.getCurrentResult().data.length, 1);
    assert.match(f.queryClient.getQueryData(f.keys.state).olderError.message, /Synthetic/);
    assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.hasOlder, true);
    fail = false; await fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    assert.equal(f.queryClient.getQueryData(f.keys.state).olderError, null);
    assert.equal(f.observer.getCurrentResult().data.length, 2);
  } finally { f.close(); }
});

test('invalidação realtime com cancelRefetch false agenda leitura nova após página em andamento', async () => {
  const older = defer(); let firstReads = 0;
  const f = fixture(async (_signal, cursor) => {
    if (cursor) return older.promise;
    firstReads++; return page([activity(firstReads === 1 ? 8 : 9)], 'next');
  });
  try {
    await f.observer.refetch();
    const pending = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    const invalidation = f.queryClient.invalidateQueries({ queryKey: ['lead-history-v2', leadId] }, { cancelRefetch: false });
    older.resolve(page([activity(2)])); await Promise.all([pending, invalidation]);
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(firstReads, 2);
    assert.deepEqual(f.observer.getCurrentResult().data.map(event => event.id), [`activity-${id(9)}`]);
    assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.hasOlder, true);
  } finally { f.close(); }
});

test('optimismo escreve todas as projeções array, rollback próprio conserva fatos concorrentes', async () => {
  const f = fixture(async () => page([activity(8)], 'next'));
  try {
    await f.observer.refetch();
    f.queryClient.setQueryData(['lead-history-v2', leadId], [ { id: 'legacy-full', timestamp: snapshot } ]);
    const optimistic = { id: 'optimistic-own', type: 'note', label: 'Synthetic', source: 'activity', timestamp: snapshot };
    appendOptimisticLeadHistoryEvent(f.queryClient, leadId, optimistic);
    const other = { ...optimistic, id: 'optimistic-other' };
    appendOptimisticLeadHistoryEvent(f.queryClient, leadId, other);
    f.queryClient.setQueriesData({ queryKey: ['lead-history-v2', leadId] }, current => [...current, { ...other, id: 'server-concurrent' }]);
    removeOptimisticLeadHistoryEvent(f.queryClient, leadId, optimistic.id);
    for (const [, value] of f.queryClient.getQueriesData({ queryKey: ['lead-history-v2', leadId] })) {
      assert.equal(value.some(event => event.id === optimistic.id), false);
      assert.equal(value.some(event => event.id === other.id), true);
      assert.equal(value.some(event => event.id === 'server-concurrent'), true);
    }
    assert.equal(historyRawRowCount(f.queryClient.getQueryData(f.keys.state).raw), 1);
  } finally { f.close(); }
});

test('página anterior preserva eventos otimistas e atualização normal os substitui por fonte canônica', async () => {
  const older = defer();
  const f = fixture(async (_signal, cursor) => cursor ? older.promise : page([activity(8)], 'next'));
  try {
    await f.observer.refetch();
    const pending = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
    appendOptimisticLeadHistoryEvent(f.queryClient, leadId, { id: 'optimistic-own', type: 'note', source: 'activity', label: 'Synthetic', timestamp: snapshot });
    older.resolve(page([activity(2)])); await pending;
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === 'optimistic-own'), true);
    await f.queryClient.invalidateQueries({ queryKey: ['lead-history-v2', leadId] });
    assert.equal(f.observer.getCurrentResult().data.some(event => event.id === 'optimistic-own'), false);
  } finally { f.close(); }
});

test('scope, organização e lead participam das chaves da projeção e do cursor', () => {
  const base = leadHistoryPageKeys(leadId, orgId, 'scope-a');
  for (const other of [leadHistoryPageKeys(leadId, orgId, 'scope-b'), leadHistoryPageKeys(id(50), orgId, 'scope-a'), leadHistoryPageKeys(leadId, id(51), 'scope-a')]) {
    assert.notDeepEqual(base.projection, other.projection); assert.notDeepEqual(base.state, other.state);
  }
});

test('desmontar último observer cancela página e protege state contra resposta tardia', async () => {
  const older = defer(); let signal;
  const f = fixture(async (requestSignal, cursor) => {
    if (cursor) { signal = requestSignal; return older.promise; }
    return page([activity(8)], 'next');
  });
  await f.observer.refetch();
  const pending = fetchOlderLeadHistory(f.queryClient, f.keys.projection, f.keys.state);
  f.observer.destroy();
  assert.equal(signal.aborted, true);
  older.resolve(page([activity(2)])); await pending; await turn();
  assert.equal(f.queryClient.getQueryData(f.keys.state).pagination.nextCursor, 'next');
  f.close();
});

function mutationHook(file, exportName, queryClient) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: file,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const commonJSModule = { exports: {} };
  const requestRuntime = leadHookRuntime(queryClient);
  const dependencies = {
    '@tanstack/react-query': { useQueryClient: () => queryClient, useMutation: options => options },
    '@/hooks/use-optimistic-lead-history': optimisticHistory,
    '@/hooks/leads/use-lead-request-scope': { useLeadRequestScope: () => requestRuntime.scope() },
    '@/lib/api/activities': { activitiesAPI: {} }, '@/lib/api/lead-tasks': { leadTasksAPI: {} },
    '@/lib/validation/manual-activities': { manualActivityCreateInputSchema }, '@/lib/validation/common': { parseDomainInput },
    sonner: { toast: { error: () => {}, success: () => {} } },
  };
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : ['2026-10-12T12:00:00Z'])); } }
  vm.runInNewContext(`(function(require,module,exports){${output.outputText}\n})`, { Date: FixedDate })(
    name => { assert.ok(name in dependencies, `Unexpected ${name}`); return dependencies[name]; },
    commonJSModule, commonJSModule.exports);
  return { ...commonJSModule.exports[exportName](), disposeScope: () => requestRuntime.unmount() };
}

test('hooks reais de atividade e cadência aplicam/retiram só seu evento em projeções concorrentes', async () => {
  for (const kind of ['activity', 'cadence']) {
    const client = new QueryClient(); const keys = leadHistoryPageKeys(leadId, orgId, 'scope');
    const existing = { id: 'server-before', timestamp: snapshot, type: 'note', source: 'activity', label: 'Synthetic' };
    client.setQueryData(['lead-history-v2', leadId], [existing]); client.setQueryData(keys.projection, [existing]);
    const hook = kind === 'activity' ? mutationHook('../use-activities.ts', 'useCreateActivity', client)
      : mutationHook('../use-lead-tasks.ts', 'useCompleteCadenceTask', client);
    const input = kind === 'activity' ? { lead_id: leadId, type: 'note', content: 'Synthetic same millisecond' }
      : { leadId, templateTaskId: id(70), title: 'Synthetic', type: 'call', dayOffset: 0 };
    const first = await hook.onMutate(input); const second = await hook.onMutate(input);
    assert.notEqual(first.optimisticHistoryId, second.optimisticHistoryId);
    client.setQueriesData({ queryKey: ['lead-history-v2', leadId] }, current => [...current, { ...existing, id: 'server-during' }]);
    hook.onError(new Error('Synthetic rollback'), input, first);
    for (const [, rows] of client.getQueriesData({ queryKey: ['lead-history-v2', leadId] })) {
      assert.equal(rows.some(row => row.id === first.optimisticHistoryId), false);
      assert.equal(rows.some(row => row.id === second.optimisticHistoryId), true);
      assert.equal(rows.some(row => row.id === 'server-before'), true);
      assert.equal(rows.some(row => row.id === 'server-during'), true);
    }
    hook.disposeScope();
    client.clear();
  }
});

test('audit usa nomes dos responsáveis antigos e novos retornados pela página scoped', () => {
  const oldId = id(71); const newId = id(72);
  const merged = mergeLeadHistoryPage(undefined, page([], null, {
    users: [{ id: oldId, name: 'Old synthetic' }, { id: newId, name: 'New synthetic' }],
    auditLogs: [{ id: id(73), action: 'update', created_at: snapshot,
      old_data: { assigned_user_id: oldId }, new_data: { assigned_user_id: newId } }],
  }), leadId);
  const audit = build(merged.raw).find(event => event.id === `audit-${id(73)}`);
  assert.equal(audit.metadata.from_user_name, 'Old synthetic');
  assert.equal(audit.metadata.to_user_name, 'New synthetic');
});
