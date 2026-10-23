import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as query from '@tanstack/react-query';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
function sourceLoader(mocks) {
  const loaded = new Map();
  function load(relative) {
    const file = resolve(root, relative);
    if (loaded.has(file)) return loaded.get(file).exports;
    const compiledModule = { exports: {} }; loaded.set(file, compiledModule);
    const code = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    const dependency = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name === '@tanstack/react-query') return query;
      if (name === 'react') return React;
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
        const resolved = [base + '.ts', base + '.tsx', resolve(base, 'index.ts')].find(existsSync);
        assert.ok(resolved, name); return load(resolved);
      }
      return require(name);
    };
    new Function('require', 'module', 'exports', code)(dependency, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  return load;
}
const organizationId = '10000000-0000-4000-8000-000000000001';
const auth = { user: { id: '20000000-0000-4000-8000-000000000001' }, activeOrganization: { organizationId },
  tenantContext: { organizationId, memberRole: 'admin', permissions: ['*'], enabledModules: ['crm'], isSuperAdmin: false }, isSuperAdmin: false };
const filters = { isHydrated: true, datePreset: null, customDateRange: null, activeDateRange: null, pipelineId: null, teamId: 'team-a',
  userId: null, source: null, pageId: null, campaignId: 'campaign-a', campaignIds: ['campaign-a'], adSetId: null, adId: null, tagIds: [], dealStatus: null, searchQuery: '' };
const metadata = { sources: ['Private Source'], pages: [{ id: 'page-a', name: 'Private Page' }],
  campaigns: [{ id: 'campaign-a', name: 'Private Campaign' }], adsets: [{ id: 'set-a', name: 'Private Set', campaignId: 'campaign-a' }], ads: [{ id: 'ad-a', name: 'Private Ad', campaignId: 'campaign-a', adsetId: 'set-a' }] };

function fixture() {
  let status, result, calls = 0;
  const catalog = { data: [{ id: 'team-a', name: 'Private Team', members: [{ user_id: 'private-user' }] }], isError: false, error: null, isSuccess: true, isFetching: false, dataUpdatedAt: 1 };
  const tags = { ...catalog, data: [{ id: 'tag-a', name: 'Private Tag', color: '#fff' }] };
  const load = sourceLoader({
    '@/contexts/AuthContext': { useAuth: () => auth }, '@/contexts/FilterContext': { useFilters: () => filters },
    '@/hooks/use-user-permissions': { useUserPermissions: () => ({ hasPermission: () => true, isLoading: false }) },
    '@/hooks/use-teams': { useTeams: () => catalog }, '@/hooks/use-tags': { useTags: () => tags },
    '@/lib/api/pipeline-board': { getLeadMetaFilters: async () => { calls++; if (status) throw Object.assign(new Error('synthetic failure'), { status }); return metadata; } },
  });
  const client = new query.QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, gcTime: Infinity } } });
  const { useSharedFilters } = load('hooks/use-shared-filters.ts');
  const { refreshStaleSharedFilterOptions } = load('lib/filters/shared-filter-options.ts');
  function Screen() { result = useSharedFilters({ loadDynamicOptions: false, entryMode: true, multiCampaigns: true }); return null; }
  const render = () => {
    renderToStaticMarkup(React.createElement(query.QueryClientProvider, { client }, React.createElement(Screen)));
    return client.getQueryCache().getAll().find(item => item.queryKey[0] === 'shared-filter-lead-meta-filters');
  };
  return { client, render, result: () => result, calls: () => calls, refresh: () => refreshStaleSharedFilterOptions(client, organizationId),
    fail: next => { status = next; for (const value of [catalog, tags]) { value.error = { status }; value.isError = true; value.isSuccess = false; } } };
}

for (const status of [401, 403]) test(`real shared filter hook hides cached metadata/tags/team members after ${status}`, async () => {
  const f = fixture();
  try {
    const entry = f.render(); await f.client.fetchQuery(entry.options); f.render();
    assert.equal(f.result().campaigns[0].name, 'Private Campaign');
    assert.deepEqual(f.result().selectedTeamUserIds, ['private-user']);
    f.fail(status);
    await assert.rejects(f.client.fetchQuery({ ...entry.options, staleTime: 0, retry: false }));
    f.render();
    for (const name of ['dynamicSources', 'pages', 'campaigns', 'adSets', 'ads', 'tags']) assert.deepEqual(f.result()[name], [], name);
    assert.equal(f.result().selectedTeamUserIds, undefined);
    assert.equal(f.result().hasDynamicOptionsError, true);
    assert.equal(f.result().isTeamScopeReady, false);
  } finally { f.client.clear(); }
});

test('a transient service failure preserves last options with the existing error signal', async () => {
  const f = fixture();
  try {
    const entry = f.render(); await f.client.fetchQuery(entry.options); f.fail(503);
    await assert.rejects(f.client.fetchQuery({ ...entry.options, staleTime: 0, retry: false })); f.render();
    assert.equal(f.result().campaigns[0].name, 'Private Campaign');
    assert.equal(f.result().tags[0].name, 'Private Tag');
    assert.deepEqual(f.result().selectedTeamUserIds, ['private-user']);
    assert.equal(f.result().hasDynamicOptionsError, true);
  } finally { f.client.clear(); }
});

test('opening filters refreshes stale active metadata even when a current selection already enabled it', async () => {
  const f = fixture(); let unsubscribe;
  try {
    const entry = f.render(); await f.client.fetchQuery(entry.options); f.render();
    const observer = new query.QueryObserver(f.client, entry.options); unsubscribe = observer.subscribe(() => {});
    f.client.setQueryData(entry.queryKey, metadata, { updatedAt: Date.now() - 660_000 }); observer.updateResult();
    const before = f.calls(); await f.refresh();
    assert.equal(f.calls(), before + 1);
    await f.refresh(); assert.equal(f.calls(), before + 1, 'fresh options do not refetch');
  } finally { unsubscribe?.(); f.client.clear(); }
});

test('opening filters does not refetch disabled, unrelated or other-organization queries', async () => {
  const f = fixture(); const unsubs = []; let unexpected = 0;
  try {
    for (const [key, enabled] of [
      [['shared-filter-lead-meta-filters', 'other-org'], true],
      [['leads', organizationId], true],
      [['tags', organizationId], true],
      [['shared-filter-lead-meta-filters', organizationId, 'disabled'], false],
    ]) {
      f.client.setQueryData(key, ['cached'], { updatedAt: 1 });
      const observer = new query.QueryObserver(f.client, { queryKey: key, enabled, staleTime: 0, refetchOnMount: false, queryFn: async () => { unexpected++; return []; } });
      unsubs.push(observer.subscribe(() => {}));
    }
    await f.refresh(); assert.equal(unexpected, 0);
  } finally { unsubs.forEach(stop => stop()); f.client.clear(); }
});

test('opening filters retries a denied active query even when its prior data is recent', async () => {
  const f = fixture(); let unsubscribe;
  try {
    const entry = f.render(); await f.client.fetchQuery(entry.options); f.render();
    const observerOptions = { ...entry.options };
    const observer = new query.QueryObserver(f.client, observerOptions); unsubscribe = observer.subscribe(() => {});
    f.fail(403);
    await assert.rejects(f.client.fetchQuery({ ...entry.options, staleTime: 0, retry: false }));
    f.render();
    observer.setOptions(observerOptions);
    assert.ok(Date.now() - entry.state.dataUpdatedAt < 60_000);
    const before = f.calls(); await f.refresh();
    assert.equal(f.calls(), before + 1);
    f.render(); assert.deepEqual(f.result().campaigns, []);
  } finally { unsubscribe?.(); f.client.clear(); }
});

test('the actual provider renders empty and ready during SSR without browser storage', () => {
  const load = sourceLoader({ './AuthContext': { useAuth: () => auth } });
  const { FilterProvider, useFilters } = load('contexts/FilterContext.tsx');
  let current;
  function Screen() { current = useFilters(); return React.createElement('output', null, current.searchQuery); }
  assert.equal(renderToStaticMarkup(React.createElement(FilterProvider, null, React.createElement(Screen))), '<output></output>');
  assert.equal(current.isHydrated, true);
  assert.equal(current.source, null);
  assert.equal(current.activeDateRange, null);
});
