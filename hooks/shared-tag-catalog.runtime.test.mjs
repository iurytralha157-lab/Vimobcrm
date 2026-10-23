import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as query from '@tanstack/react-query';
import { tagCatalogApiFixture, tagCatalogTestOrganization } from '../lib/api/tag-catalog-runtime-fixture.mjs';

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

// Both hooks, React Query, read transport adapter and schemas are actual code.
// Only identity, filter state and unrelated metadata/team transports are inert.
function fixture() {
  const api = tagCatalogApiFixture(), loaded = new Map();
  const session = 'synthetic.' + Buffer.from(JSON.stringify({ sub: 'actor-a', session_id: 'sid-a' })).toString('base64url') + '.synthetic';
  const auth = { user: { id: 'actor-a' }, profile: { id: 'actor-a' }, session: { access_token: session },
    activeOrganization: { organizationId: tagCatalogTestOrganization }, tenantContext: { organizationId: tagCatalogTestOrganization,
      permissions: ['lead_view_all'], enabledModules: ['crm'], memberRole: 'admin' } };
  const filters = { isHydrated: true, datePreset: null, customDateRange: null, activeDateRange: null,
    pipelineId: null, teamId: null, userId: null, source: null, pageId: null, campaignId: null, campaignIds: [],
    adSetId: null, adId: null, tagIds: [], dealStatus: null, searchQuery: '' };
  for (const name of ['DatePreset', 'CustomDateRange', 'PipelineId', 'TeamId', 'UserId', 'Source', 'PageId', 'CampaignId', 'CampaignIds', 'AdSetId', 'AdId', 'TagIds', 'DealStatus', 'SearchQuery']) filters['set' + name] = () => {};
  filters.clearFilters = filters.clearDateFilter = () => {};
  const emptyQuery = { data: [], isSuccess: true, isFetching: false, isError: false, dataUpdatedAt: 1, refetch: async () => ({ data: [] }) };
  const mocks = {
    react: React, '@tanstack/react-query': query, sonner: { toast: { success() {}, error() {} } },
    '@/contexts/AuthContext': { useAuth: () => auth }, '@/contexts/FilterContext': { useFilters: () => filters },
    '@/lib/api/tags': { tagsAPI: api.api }, '@/hooks/use-teams': { useTeams: () => emptyQuery },
    '@/hooks/use-user-permissions': { useUserPermissions: () => ({ hasPermission: () => true, isLoading: false }) },
    '@/lib/api/pipeline-board': { getLeadMetaFilters: async () => ({ sources: [], pages: [], campaigns: [], adsets: [], ads: [] }) },
  };
  function evaluate(filename) {
    if (loaded.has(filename)) return loaded.get(filename);
    const fixtureModule = { exports: {} }; loaded.set(filename, fixtureModule.exports);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const dependency = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(repository, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, base + '.ts', base + '.tsx'].find(candidate => existsSync(candidate));
        assert.ok(resolved, 'Unresolved source module ' + name); return evaluate(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error, Date, atob: globalThis.atob })(dependency, fixtureModule, fixtureModule.exports);
    loaded.set(filename, fixtureModule.exports); return fixtureModule.exports;
  }
  const sharedSource = process.env.TAG_SHARED_HOOK_BASELINE || path.join(repository, 'hooks/use-shared-filters.ts');
  const { useSharedFilters } = evaluate(sharedSource);
  const client = new query.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let latest;
  function Screen() { latest = useSharedFilters({ loadDynamicOptions: true }); return React.createElement('output', null, JSON.stringify(latest.tags)); }
  const render = () => renderToStaticMarkup(React.createElement(query.QueryClientProvider, { client }, React.createElement(Screen)));
  return { api, client, render, result: () => latest };
}

test('real shared filters hydrate legacy tags through the read catalog instead of the management list', async () => {
  const f = fixture();
  try {
    f.render();
    const tagQuery = f.client.getQueryCache().getAll().find(item => item.queryKey[0] === 'tags');
    assert.ok(tagQuery); assert.equal(tagQuery.options.enabled, true);
    await f.client.fetchQuery(tagQuery.options);
    f.render();
    assert.equal(f.result().hasTagsError, false);
    assert.equal(f.result().hasDynamicOptionsError, false);
    assert.deepEqual(JSON.parse(JSON.stringify(f.result().tags)), [{ id: '40000000-0000-4000-8000-000000000001', name: 'Visita', color: '#22c55e' }]);
    assert.equal(f.api.requests.length, 1);
    assert.equal(f.api.requests[0].options.query.view, 'catalog');
    assert.equal(f.api.requests[0].options.expectedUserId, 'actor-a');
    assert.equal(f.api.requests[0].options.expectedSessionId, 'sid-a');
    assert.equal(f.api.management.length, 0);
  } finally { f.client.clear(); }
});
