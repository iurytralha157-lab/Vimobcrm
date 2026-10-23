import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { isDefinitiveLeadReadDenial } from '../../lib/lead-read-access.ts';
import { createTenantQueryAccessSignature } from '../../lib/access/tenant-query-cache.ts';
import { leadHistoryPageKeys } from '../lead-history/pagination.ts';
import { fetchLeadHistoryProjection, fetchOlderLeadHistory } from '../lead-history/pagination-query.ts';
import { buildLeadHistory } from '../lead-history/build-history.ts';
import { deferred, evaluateProduction, productionDeclaration, turn } from './lead-request-runtime-fixture.mjs';

function readHook(path, name, extra = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  let observer;
  const dependencies = {
    useQueryClient: () => client,
    useAuth: () => ({ activeOrganization: { organizationId: 'org-a' }, user: { id: 'actor-a' } }),
    useQuery: options => {
      if (options.enabled === false && options.queryKey[0].startsWith('lead-history-page-state')) return { data: client.getQueryData(options.queryKey) };
      if (!observer) observer = new QueryObserver(client, options);
      else observer.setOptions(options);
      return observer.getCurrentResult();
    },
    isDefinitiveLeadReadDenial, ...extra,
  };
  const hook = evaluateProduction(productionDeclaration(path, node => ts.isFunctionDeclaration(node) && node.name?.text === name), dependencies, name);
  return { hook, client, observer: () => observer, close: () => client.clear() };
}

for (const status of [403, 404, 503]) test(`actual contacts hook ${status} clears only definitive denied envelopes`, async () => {
  let failure;
  const fixture = readHook('hooks/use-contacts-list.ts', 'useContactsList', {
    keepPreviousData: data => data, validateDateRangeLimit: () => null,
    MAX_SHARED_REPORT_RANGE_DAYS: 366, CONTACTS_STALE_TIME_MS: 600_000, CONTACTS_CACHE_TIME_MS: 3_600_000,
    contactsAPI: { listPage: async () => { if (failure) throw failure; return { data: [{ id: 'lead-a', name: 'Synthetic' }], total: 1 }; } },
  });
  try {
    const filters = { page: 1, limit: 50 }; fixture.hook(filters); await fixture.observer().refetch();
    failure = Object.assign(new Error('Synthetic denied/unavailable'), { status }); await fixture.observer().refetch();
    const result = fixture.hook(filters); assert.equal(result.isError, true);
    const cached = fixture.client.getQueryData(['contacts-list', 'org-a', 'actor-a', filters]);
    if (status < 500) { assert.equal(result.data, undefined); assert.deepEqual(cached, { data: [], total: 0 }); assert.equal(result.isPlaceholderData, false); }
    else { assert.equal(result.data.length, 1); assert.equal(cached.total, 1); }
  } finally { fixture.close(); }
});

for (const status of [403, 404]) test(`actual sensitive hook ${status} erases cached CPF/RG and hover refuses capability loss`, async () => {
  let failure;
  const fixture = readHook('hooks/use-leads.ts', 'useLeadSensitiveProfile', { leadsAPI: { getSensitiveProfile: async () => {
    if (failure) throw failure; return { cpf: '11122233344', rg: '11223344' };
  } } });
  try {
    fixture.hook('lead-a'); await fixture.observer().refetch(); failure = Object.assign(new Error('Synthetic denied'), { status }); await fixture.observer().refetch();
    const result = fixture.hook('lead-a'); assert.equal(result.data, undefined);
    assert.deepEqual(fixture.client.getQueryData(['lead-sensitive-profile', 'org-a', 'lead-a']), {});
    const source = 'const ' + productionDeclaration('components/features/leads/lead-detail/LeadProfileHover.tsx', node => ts.isVariableDeclaration(node) && node.name.getText() === 'sensitiveValue');
    const visible = allowed => evaluateProduction(source, { canRevealSensitive: allowed, revealSensitive: true, sensitiveProfile: { ...result, data: { cpf: '11122233344' } }, maskCPF: String, maskRG: String }, 'sensitiveValue');
    assert.equal(visible(false)('cpf'), '••••••••••••'); assert.equal(visible(true)('cpf'), 'Indisponível');
  } finally { fixture.close(); }
});

test('closing the actual profile hover masks locally without canceling the editor shared sensitive query', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const key = ['lead-sensitive-profile', 'org-a', 'lead-a'], pending = deferred(); let aborted = false, revealed = true;
  client.setQueryData(key, { cpf: '11122233344' });
  const observer = new QueryObserver(client, { queryKey: key, queryFn: ({ signal }) => {
    signal.addEventListener('abort', () => { aborted = true; }); return pending.promise;
  } });
  try {
    const fetch = observer.refetch(); await turn();
    const clear = evaluateProduction('const ' + productionDeclaration('components/features/leads/lead-detail/LeadProfileHover.tsx',
      node => ts.isVariableDeclaration(node) && node.name.getText() === 'clearSensitiveData'), {
      setRevealSensitive: value => { revealed = value; }, queryClient: client, organizationId: 'org-a', lead: { id: 'lead-a' },
    }, 'clearSensitiveData');
    clear(); assert.equal(revealed, false); assert.equal(aborted, false);
    assert.deepEqual(client.getQueryData(key), { cpf: '11122233344' });
    pending.resolve({ cpf: '99988877766' }); await fetch;
    assert.deepEqual(client.getQueryData(key), { cpf: '99988877766' });
  } finally { client.clear(); }
});

for (const paginated of [false, true]) for (const status of [403, 404, 503]) {
  test(`actual ${paginated ? 'paged' : 'legacy'} history ${status} hides denied history while retaining transient fallback`, async () => {
    let failure;
    const raw = { lead: { id: 'lead-a' }, activityEvents: [{ id: 'event-a', type: 'note', content: 'Synthetic', created_at: '2026-10-13T10:00:00Z' }],
      historyCoverage: { complete: false, canonicalPresence: { leadCreated: true, firstResponse: true, assignment: true } } };
    const page = { data: raw, pagination: { snapshotAt: '2026-10-13T11:00:00Z', nextCursor: 'older', hasOlder: true } };
    const fixture = readHook('hooks/use-lead-history.ts', 'useLeadHistory', {
      createTenantQueryAccessSignature, leadHistoryPageKeys, fetchLeadHistoryProjection, fetchOlderLeadHistory,
      LEAD_HISTORY_FETCH_PAGE_SIZE: 100, buildLeadHistory,
      leadHistoryFormatters: { formatCurrency: String, formatPropertyCurrency: String, formatResponseTime: String },
      leadsAPI: {
        getLeadHistoryRaw: async () => { if (failure) throw failure; return raw; },
        getLeadHistoryPage: async () => { if (failure) throw failure; return page; },
      },
    });
    try {
      fixture.hook('lead-a', { paginated }); await fixture.observer().refetch();
      assert.ok(fixture.observer().getCurrentResult().data.length > 0);
      const stateQuery = fixture.client.getQueryCache().findAll({ queryKey: ['lead-history-page-state', 'lead-a'] })[0];
      if (paginated) fixture.client.setQueryData(stateQuery.queryKey, current => ({ ...current, requestedCursor: 'older' }));
      failure = Object.assign(new Error('Synthetic denied/unavailable'), { status }); await fixture.observer().refetch();
      const result = fixture.hook('lead-a', { paginated });
      if (status < 500) {
        assert.equal(result.isError, true); assert.deepEqual(result.data, []); assert.equal(result.hasOlderHistory, false); assert.equal(result.historyComplete, false);
        if (paginated) { const state = fixture.client.getQueryData(stateQuery.queryKey); assert.equal(state.raw, undefined); assert.equal(state.pagination, undefined); }
      } else assert.ok(result.data.length > 0);
    } finally { fixture.close(); }
  });
}
