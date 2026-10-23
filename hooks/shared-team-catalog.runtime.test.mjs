import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as query from '@tanstack/react-query';
import { legacyTeamResponse, teamCatalogApiFixture, teamCatalogOrganization } from '../lib/api/team-catalog-runtime-fixture.mjs';

const require = createRequire(import.meta.url), repository = process.cwd(), noop = () => {};
function fixture(role = 'admin', consumer = 'shared') {
  const api = teamCatalogApiFixture(), loaded = new Map(), uid = legacyTeamResponse.members[0].user_id;
  const permissions = role === 'admin' ? ['lead_view_all', 'team_view'] : role === 'leader' ? ['lead_view_team', 'team_view'] : ['lead_view_own'];
  const auth = { user: { id: uid }, profile: { id: uid }, isSuperAdmin: false,
    session: { access_token: 'synthetic.' + Buffer.from(JSON.stringify({ sub: uid, session_id: 'sid-a' })).toString('base64url') + '.synthetic' },
    userOrganizations: [{ organization_id: teamCatalogOrganization, member_role: role === 'admin' ? 'admin' : 'user' }],
    activeOrganization: { organizationId: teamCatalogOrganization }, tenantContext: { organizationId: teamCatalogOrganization,
      permissions, enabledModules: ['crm'], memberRole: role === 'admin' ? 'admin' : 'user', ledTeamIds: [], ledUserIds: [] } };
  const filters = { isHydrated: true, filterApplicationRevision: 0, datePreset: null, customDateRange: null, activeDateRange: null,
    pipelineId: null, teamId: role === 'user' ? null : legacyTeamResponse.id, userId: null, source: null, pageId: null,
    campaignId: null, campaignIds: [], adSetId: null, adId: null, tagIds: [], dealStatus: null, searchQuery: '' };
  for (const name of ['DatePreset', 'CustomDateRange', 'PipelineId', 'TeamId', 'UserId', 'Source', 'PageId', 'CampaignId', 'CampaignIds', 'AdSetId', 'AdId', 'TagIds', 'DealStatus', 'SearchQuery']) filters['set' + name] = noop;
  filters.clearFilters = filters.clearDateFilter = noop;
  const empty = { data: [], isSuccess: true, isFetching: false, isError: false, isLoading: false, dataUpdatedAt: 1, refetch: async () => ({ data: [] }) };
  const mocks = { react: React, '@tanstack/react-query': query, sonner: { toast: { error: noop, success: noop } },
    '@/contexts/AuthContext': { useAuth: () => auth }, '@/contexts/FilterContext': { useFilters: () => filters },
    '@/lib/api/teams': { teamsAPI: api.api }, '@/lib/api/management-request': {},
    '@/hooks/use-user-permissions': { useUserPermissions: () => ({ hasPermission: key => permissions.includes(key), isLoading: false }) },
    '@/hooks/use-tags': { useTags: () => empty, useCreateTag: () => ({}) },
    '@/hooks/use-users': { useOrganizationUsers: () => empty }, '@/hooks/use-mobile': { useIsMobile: () => false },
    '@/hooks/use-team-pipelines': { useAllTeamPipelines: () => empty },
    // These tests exercise the panel's actual read hooks. Its unrelated visual
    // shells are covered by the offline React/Radix browser suites.
    '@/components/shared/filters/SharedFilterPanel': { SharedFilterPanel: () => null },
    '@/components/ui/date-filter-popover': { DateFilterPopover: () => null },
    '@/components/shared/SearchableTagPicker': { SearchableTagPicker: () => null },
    '@/components/shared/SearchableFilterSelect': { SearchableFilterSelect: () => null },
    '@/components/shared/SharedUserFilter': { SharedUserFilter: () => null },
    '@/lib/api/pipeline-board': { getLeadMetaFilters: async () => ({ sources: [], pages: [], campaigns: [], adsets: [], ads: [] }) } };
  function evaluate(filename) {
    if (loaded.has(filename)) return loaded.get(filename);
    const fixtureModule = { exports: {} }; loaded.set(filename, fixtureModule.exports);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const dependency = name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        const base = name.startsWith('@/') ? path.join(repository, name.slice(2)) : path.resolve(path.dirname(filename), name);
        const resolved = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
        assert.ok(resolved, 'Unresolved real source ' + name); return evaluate(resolved);
      }
      return require(name);
    };
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, { Error, Date, atob: globalThis.atob })(dependency, fixtureModule, fixtureModule.exports);
    loaded.set(filename, fixtureModule.exports); return fixtureModule.exports;
  }
  const client = new query.QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  let latest;
  function Screen() {
    if (consumer === 'panel') {
      const { SharedFilters } = evaluate(path.join(repository, 'components/shared/SharedFilters.tsx'));
      return React.createElement(SharedFilters, { ...filters, loadDynamicOptions: true, datePreset: null, onDatePresetChange: noop,
        onTeamChange: noop, onUserChange: noop, onSourceChange: noop, onCampaignChange: noop, onAdSetChange: noop,
        onAdChange: noop, onTagsChange: noop, onDealStatusChange: noop, onSearchChange: noop, onClear: noop, hasActiveFilters: false });
    }
    const filename = consumer === 'access' ? path.join(repository, 'hooks/use-user-access-scope.ts')
      : process.env.TEAM_SHARED_HOOK_BASELINE || path.join(repository, 'hooks/use-shared-filters.ts');
    const hooks = evaluate(filename); latest = consumer === 'access' ? hooks.useUserAccessScope() : hooks.useSharedFilters({ loadDynamicOptions: true });
    return React.createElement('output', null);
  }
  return { api, client, result: () => latest,
    render: () => renderToStaticMarkup(React.createElement(query.QueryClientProvider, { client }, React.createElement(Screen))) };
}

for (const role of ['admin', 'leader']) test(`actual shared filter hook loads the legacy team DTO for ${role} without the warning`, async () => {
  const f = fixture(role);
  try {
    f.render(); const entry = f.client.getQueryCache().getAll().find(item => item.queryKey[0] === 'teams');
    assert.ok(entry); assert.equal(entry.options.enabled, true); await f.client.fetchQuery(entry.options); f.render();
    assert.equal(f.result().hasTeamOptionsError, false); assert.equal(f.result().hasDynamicOptionsError, false);
    assert.equal(f.result().isTeamScopeReady, true);
    assert.deepEqual(Array.from(f.result().selectedTeamUserIds), [legacyTeamResponse.members[0].user_id]);
    assert.equal(f.api.requests.length, 1); assert.equal(f.api.requests[0].options.expectedSessionId, 'sid-a');
  } finally { f.client.clear(); }
});

test('the standard shared-filter profile does not enable the forbidden team catalog', () => {
  const f = fixture('user');
  try { f.render(); const entry = f.client.getQueryCache().getAll().find(item => item.queryKey[0] === 'teams');
    assert.equal(entry.options.enabled, false); assert.equal(f.api.requests.length, 0);
  } finally { f.client.clear(); }
});

test('the real filter panel also requests the scoped read catalog instead of management', async () => {
  const f = fixture('admin', 'panel');
  try { f.render(); const entry = f.client.getQueryCache().getAll().find(item => item.queryKey[0] === 'teams');
    assert.ok(entry); assert.equal(entry.options.enabled, true); assert.equal(entry.queryKey[2], 'filter-catalog');
    await f.client.fetchQuery(entry.options); f.render(); assert.equal(f.api.requests.length, 1);
    assert.equal('revision' in entry.state.data[0], false);
  } finally { f.client.clear(); }
});

test('the real access-scope hook resolves leadership from the revision-free roster', async () => {
  const f = fixture('leader', 'access');
  try { f.render(); const entry = f.client.getQueryCache().getAll().find(item => item.queryKey[0] === 'teams');
    assert.ok(entry); await f.client.fetchQuery(entry.options); f.render();
    assert.equal(f.result().isError, false); assert.equal(f.result().isTeamLeader, true);
    assert.deepEqual(Array.from(f.result().ledTeamIds), [legacyTeamResponse.id]);
    assert.deepEqual(Array.from(f.result().ledUserIds), [legacyTeamResponse.members[0].user_id]);
  } finally { f.client.clear(); }
});
