import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { QueryClient } from '@tanstack/react-query';
import { isLeadResourceQuery } from '../lib/queue-pool-cache.ts';
import { createDashboardQueryRefresh, isDashboardRefreshQueryKey } from '../lib/dashboard-query-refresh.ts';
import { createContactsQueryRefresh } from '../lib/contacts-query-refresh.ts';

function productionModule(path, dependencies, expression) {
  const parsed = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const source = parsed.statements.filter(node => !ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)).map(node => node.getText(parsed)).join('\n').replace(/^export /gm, '');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(dependencies), `${code};return ${expression};`)(...Object.values(dependencies));
}

test('payload-free lead event invalidates active detail scopes without requiring a leaked lead ID', () => {
  const client = new QueryClient(); const window = new EventTarget(); const timers = new Map(); let timerId = 0; let cleanup;
  const calls = []; const invalidate = client.invalidateQueries.bind(client);
  client.invalidateQueries = (filter, options) => { calls.push(filter); return invalidate(filter, options); };
  const component = productionModule('contexts/LeadRealtimeBus.tsx', {
    useEffect: setup => { cleanup = setup(); }, useRef: value => ({ current: value }), useQueryClient: () => client,
    useAuth: () => ({ activeOrganization: { organizationId: 'org-a' } }), window,
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; }, clearTimeout: id => timers.delete(id),
    isWhatsAppOnlyLeadRealtimeBatch: () => false, shouldRefreshLeadMetaFilters: () => false,
    getPipelineRealtimeRefreshDelay: () => 0, invalidateTagCounts() {}, shouldRefreshTagCounts: () => false, isLeadResourceQuery,
    createDashboardQueryRefresh, isDashboardRefreshQueryKey,
    createContactsQueryRefresh,
  }, 'LeadRealtimeBus');
  try {
    component();
    const event = new Event('vimob:lead-realtime-change');
    event.detail = { organizationId: 'org-a', reason: 'lead.redistributed' };
    window.dispatchEvent(event);
    const callback = [...timers.values()][0]; assert.ok(callback); callback();
    const detail = calls.find(filter => filter.predicate && filter.predicate({ queryKey: ['lead', 'org-a', 'lead-a'] }));
    assert.ok(detail); assert.equal(detail.refetchType, 'active');
    assert.equal(detail.predicate({ queryKey: ['lead', 'org-b', 'lead-b'] }), false);
    assert.equal(detail.predicate({ queryKey: ['lead-history-v2', 'lead-a'] }), true);
  } finally { cleanup?.(); client.clear(); }
});

test('sanitized notification event refresh helper addresses only the current actor and tenant', () => {
  const source = readFileSync('contexts/BackendRealtimeBus.tsx', 'utf8');
  const start = source.indexOf('function invalidateNotificationQueries(');
  const end = source.indexOf('\nfunction invalidateDashboardRealtimeQueries', start);
  assert.ok(start >= 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const helper = Function(`${code};return invalidateNotificationQueries;`)();
  const client = new QueryClient();
  try {
    for (const actor of ['actor-a', 'actor-b']) for (const org of ['org-a', 'org-b']) for (const prefix of ['notifications', 'unread-notifications-count']) client.setQueryData([prefix, actor, org], []);
    helper(client, 'actor-a', 'org-a');
    assert.equal(client.getQueryState(['notifications', 'actor-a', 'org-a']).isInvalidated, true);
    assert.equal(client.getQueryState(['unread-notifications-count', 'actor-a', 'org-a']).isInvalidated, true);
    assert.equal(client.getQueryState(['notifications', 'actor-b', 'org-a']).isInvalidated, false);
    assert.equal(client.getQueryState(['notifications', 'actor-a', 'org-b']).isInvalidated, false);
  } finally { client.clear(); }
});
