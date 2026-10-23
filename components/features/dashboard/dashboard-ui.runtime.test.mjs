import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
let currentQuery;
const element = (tag, fixedProps = {}) => function MockElement({ children, ...props }) { return React.createElement(tag, { ...props, ...fixedProps }, children); };
const mocks = {
  'next/link': { __esModule: true, default: element('a') },
  '@/hooks/use-dashboard-lead-entries': { useDashboardLeadEntries: () => currentQuery },
  '@/hooks/use-dashboard-filters': { sourceLabels: {} },
  '@/components/ui/button': { Button: element('button') },
  '@/components/ui/dialog': { Dialog: element('div'), DialogContent: element('div', { role: 'dialog' }), DialogHeader: element('div'), DialogTitle: element('h2'), DialogDescription: element('p') },
  '@/components/ui/avatar': { Avatar: element('span'), AvatarImage: element('img'), AvatarFallback: element('span') },
  '@/components/ui/select': { Select: element('div'), SelectContent: element('div'), SelectItem: element('div'), SelectTrigger: element('button'), SelectValue: element('span') },
  '@/components/ui/tooltip': { Tooltip: element('div'), TooltipProvider: element('div'), TooltipTrigger: element('div'), TooltipContent: element('div') },
  '@/contexts/AuthContext': { useAuth: () => ({ activeOrganization: { organizationId: 'synthetic-org' } }) },
  '@/hooks/use-stages': { usePipelines: () => ({ data: [{ id: 'one', name: 'Private Pipeline' }, { id: 'two', name: 'Private Second Pipeline' }], isError: true, isLoading: false, refetch: async () => {} }) },
  '@/hooks/use-dashboard-stats': { useDashboardFirstContactLeads: () => currentQuery, useFunnelData: () => ({ data: [], isLoading: false, isError: false, refetch: async () => {} }) },
  '@/components/ui/scroll-area': { ScrollArea: element('div') },
  '@/components/ui/skeleton': { Skeleton: element('span') },
  '@/components/ui/card': { Card: element('div'), CardContent: element('div'), CardHeader: element('div'), CardTitle: element('h3') },
};
const loaded = new Map();
function loadSource(relativePath) {
  const path = resolve(root, relativePath);
  if (loaded.has(path)) return loaded.get(path).exports;
  const compiledModule = { exports: {} };
  loaded.set(path, compiledModule);
  const compiled = ts.transpileModule(readFileSync(path, 'utf8'), {
    fileName: path,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  function loadImport(specifier) {
    if (mocks[specifier]) return mocks[specifier];
    if (specifier.startsWith('@/')) {
      const base = specifier.slice(2);
      return loadSource(existsSync(resolve(root, `${base}.tsx`)) ? `${base}.tsx` : `${base}.ts`);
    }
    if (specifier.startsWith('.')) {
      const base = resolve(dirname(path), specifier);
      return loadSource(existsSync(`${base}.tsx`) ? `${base}.tsx` : `${base}.ts`);
    }
    return require(specifier);
  }
  new Function('require', 'module', 'exports', compiled)(loadImport, compiledModule, compiledModule.exports);
  return compiledModule.exports;
}
const { DashboardLeadEntriesDialog } = loadSource('components/features/dashboard/DashboardLeadEntriesDialog.tsx');
const { LeadSourceRows } = loadSource('components/features/dashboard/LeadSourceRows.tsx');
const { FirstContactDialog } = loadSource('components/features/dashboard/FirstContactDialog.tsx');
const { SalesFunnelWithPipeline } = loadSource('components/features/dashboard/SalesFunnelWithPipeline.tsx');
const { buildDashboardSourcesModel } = loadSource('components/features/dashboard/lead-sources-model.ts');
const { getDashboardStatsFailureState } = loadSource('components/features/dashboard/dashboard-stats-error.ts');
const { getDashboardSourceLabel } = loadSource('lib/analytics/dashboard-source-label.ts');
const cachedEntry = {
  entryId: 'entry', leadId: 'lead', name: 'Private Synthetic Lead', entryType: 'initial',
  source: 'Private Source', campaignName: 'Private Campaign', pipelineName: 'Private Pipeline',
  occurredAt: '2026-10-12T12:00:00Z', leadUrl: '/crm/pipelines?lead=lead',
};
function entryMarkup(error) {
  currentQuery = {
    data: { pages: [{ total: 1, items: [cachedEntry] }] }, isError: true, error,
    isPending: false, isFetchNextPageError: false, hasNextPage: false,
    refetch: async () => {},
  };
  return renderToStaticMarkup(React.createElement(DashboardLeadEntriesDialog, {
    open: true, available: true, onOpenChange: () => {}, onRetryAvailability: () => {},
  }));
}

test('entries render allowed prototype-name origins as text instead of crashing', () => {
  for (const source of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const entry = { ...cachedEntry, source };
    currentQuery = {
      data: { pages: [{ total: 1, items: [entry] }] }, isError: false,
      isPending: false, isFetchNextPageError: false, hasNextPage: false, refetch: async () => {},
    };
    const html = renderToStaticMarkup(React.createElement(DashboardLeadEntriesDialog, {
      open: true, available: true, onOpenChange: () => {}, onRetryAvailability: () => {},
    }));
    assert.ok(html.includes(source));
    assert.ok(html.includes(cachedEntry.name));
    assert.equal(entry.source, source);
  }
});

test('source labels preserve known names, custom text and each existing empty fallback', () => {
  assert.equal(getDashboardSourceLabel('facebook'), 'Meta Ads');
  assert.equal(getDashboardSourceLabel('custom source'), 'custom source');
  assert.equal(getDashboardSourceLabel(' Facebook '), ' Facebook ');
  assert.equal(getDashboardSourceLabel(null), 'Origem não informada');
  assert.equal(getDashboardSourceLabel('', 'Sem origem'), 'Sem origem');
  assert.equal(getDashboardSourceLabel('', ''), '');
});

test('real entries component hides cached personal data after 401 and 403', () => {
  for (const status of [401, 403]) {
    const html = entryMarkup({ status });
    assert.ok(html.includes('Não foi possível carregar as entradas'));
    for (const value of ['Private Synthetic Lead', 'Private Source', 'Private Campaign', 'Private Pipeline', 'lead=lead']) assert.ok(!html.includes(value));
  }
});

test('temporary service failure preserves entries with an explicit stale notice', () => {
  const html = entryMarkup({ status: 503 });
  assert.ok(html.includes('Private Synthetic Lead'));
  assert.ok(html.includes('Exibindo as últimas entradas carregadas'));
});

test('the actual query cache retains data after denial but the dashboard policy closes display', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let denied = false;
  const observer = new QueryObserver(client, { queryKey: ['synthetic-audit'], queryFn: async () => {
    if (denied) throw Object.assign(new Error('denied'), { status: 403 });
    return { private: 'synthetic' };
  } });
  const unsubscribe = observer.subscribe(() => {});
  try {
    await observer.refetch();
    denied = true;
    await observer.refetch();
    const result = observer.getCurrentResult();
    assert.ok(result.data);
    assert.equal(getDashboardStatsFailureState(Boolean(result.data), result.isError, result.error), 'unavailable');
  } finally { unsubscribe(); client.clear(); }
});

test('source detail renders full names, exact numbers and keyboard buttons with raw selection', () => {
  const name = 'Imported source ' + 'x'.repeat(118);
  const { sources } = buildDashboardSourcesModel([{ name, rawSource: 'Exact Raw Id', value: 1_234_567 }, { name: 'Não informada', rawSource: '', value: 1 }]);
  const html = renderToStaticMarkup(React.createElement(LeadSourceRows, { sources, total: 1_234_568, selectedSource: 'Exact Raw Id', onSelect: () => {} }));
  assert.ok(html.includes(name));
  assert.ok(html.includes('1.234.567'));
  assert.ok(html.includes('aria-pressed="true"'));
  assert.equal((html.match(/type="button"/g) ?? []).length, 2);
  assert.ok(html.includes('disabled=""'));
});

test('unsupported historical sources remain visible but cannot dispatch an invalid filter', () => {
  for (const rawSource of ['ã'.repeat(5000), 'all', '  Facebook  ']) {
    const { sources } = buildDashboardSourcesModel([{ name: rawSource, rawSource, value: 1_234_567 }]);
    let selections = 0;
    const props = { sources, total: 1_234_567, onSelect: () => { selections++; } };
    const tree = LeadSourceRows(props);
    const button = tree.props.children[0].props.children;
    assert.equal(button.props.disabled, true);
    button.props.onClick();
    assert.equal(selections, 0);
    const html = renderToStaticMarkup(React.createElement(LeadSourceRows, props));
    assert.ok(html.includes(rawSource));
    assert.ok(html.includes('1.234.567'));
    assert.match(html, /disponível(?: apenas)? para consulta/);
  }
  const source = '🏠'.repeat(4096);
  const { sources } = buildDashboardSourcesModel([{ name: source, rawSource: source, value: 1 }]);
  let selected;
  const tree = LeadSourceRows({ sources, total: 1, onSelect: (row) => { selected = row.rawSource; } });
  const button = tree.props.children[0].props.children;
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.equal(selected, source);
});

test('first-contact detail masks cached count and broker name after 403', () => {
  currentQuery = { data: { pages: [{ total: 987654, items: [cachedEntry] }] }, isError: true, error: { status: 403 }, isPending: false, refetch: async () => {} };
  const broker = { id: 'broker', name: 'Private Broker', averageResponseSeconds: 30, handledLeads: 1, contactedLeads: 1, leadCount: 1, receivedLeads: 1, redistributedAway: 0, redistributedReceived: 0 };
  const html = renderToStaticMarkup(React.createElement(FirstContactDialog, { open: true, isError: false, isLoading: false, onOpenChange: () => {}, onRetry: () => {}, filters: { userId: 'broker' }, data: { brokers: [broker], sources: [], averageResponseSeconds: 30, leadCount: 1, contactedLeads: 1, redistributedLeads: 0, redistributionEvents: 0 } }));
  assert.ok(!html.includes('987654'));
  assert.ok(!html.includes('Primeiras respostas de Private Broker'));
  assert.ok(!html.includes('Private Synthetic Lead'));
  assert.ok(html.includes('Não foi possível carregar os leads deste corretor'));
});

test('funnel pipeline names are not exposed after the pipeline query fails', () => {
  const html = renderToStaticMarkup(React.createElement(SalesFunnelWithPipeline, { enabled: true }));
  assert.ok(!html.includes('Private Pipeline'));
  assert.ok(!html.includes('Private Second Pipeline'));
  assert.ok(html.includes('Não foi possível carregar os funis de vendas'));
});
