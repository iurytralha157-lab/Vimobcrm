import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { QueryClient, QueryObserver, InfiniteQueryObserver, focusManager } from '@tanstack/query-core';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));

function compile(source, imports = {}, globals = {}) {
  const record = { exports: {} };
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = (name) => {
    assert.ok(Object.hasOwn(imports, name), `Unexpected module: ${name}`);
    return imports[name];
  };
  new Function('require', 'module', 'exports', ...Object.keys(globals), code)(
    require, record, record.exports, ...Object.values(globals),
  );
  return record.exports;
}

function parse(path) {
  return ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

// Use the current provider's factory, including its global mount/focus defaults.
const provider = parse('components/providers/query-provider.tsx');
const providerDeclarations = provider.statements.filter((node) =>
  (ts.isFunctionDeclaration(node) && node.name?.text === 'createTenantQueryClient')
  || (ts.isVariableStatement(node) && node.declarationList.declarations.some((declaration) =>
    /^DEFAULT_QUERY_/.test(declaration.name.getText(provider)))));
const createClient = compile(
  `${providerDeclarations.map((node) => node.getText(provider)).join('\n')}\nexport { createTenantQueryClient };`,
  {}, { QueryClient },
).createTenantQueryClient;

// Extract the real inline extra-count options without rendering the entire screen.
const screen = parse('components/features/dashboard/DashboardScreen.tsx');
let extraCountsOptions;
let extraCountsStaleTime;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(screen) === 'DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS') {
    extraCountsStaleTime = node.initializer.getText(screen);
  }
  if (ts.isCallExpression(node) && ['useQuery', 'useDashboardQuery'].includes(node.expression.getText(screen))) {
    const options = node.arguments[0];
    if (options && ts.isObjectLiteralExpression(options) && options.properties.some((property) =>
      ts.isPropertyAssignment(property) && property.name.getText(screen) === 'queryKey'
      && property.initializer.getText(screen).includes('"dashboard-extra-counts"'))) {
      extraCountsOptions = options.getText(screen);
    }
  }
  ts.forEachChild(node, visit);
}
visit(screen);
assert.ok(extraCountsOptions && extraCountsStaleTime, 'Real extra-count query must be exercised');

const orgA = 'synthetic-org-a';
const orgB = 'synthetic-org-b';
const signature = compile(read('lib/access/tenant-query-cache.ts')).createTenantQueryAccessSignature;

function fixture(load) {
  let auth = {
    user: { id: 'synthetic-user' }, activeOrganization: { organizationId: orgA },
    tenantContext: { organizationId: orgA, memberRole: 'admin', permissions: ['dashboard_view'], enabledModules: ['dashboard'] },
    isSuperAdmin: false,
  };
  const calls = [];
  const api = {
    getDashboardFiltersQueryKey: (filters) => JSON.stringify(filters),
    getDashboardOptionalIdQueryKey: (id) => id ?? null,
  };
  for (const name of ['Stats', 'Funnel', 'Sources', 'LeadDistribution', 'FirstContact', 'FirstContactLeadPage', 'DealsEvolution', 'Visits', 'LeadEntries', 'ExtraCounts']) {
    api[`getDashboard${name}`] = async (params) => {
      calls.push({ name, ...params });
      if (load) return load(name, params, calls.length);
      if (name === 'Sources') return [{ name: 'Site', rawSource: 'site', value: calls.length }];
      return { revision: calls.length, items: [{ id: `synthetic-${calls.length}` }], hasMore: false, nextCursor: null };
    };
  }
  const imports = {
    '@tanstack/react-query': { useQuery: (options) => options, useInfiniteQuery: (options) => options },
    '@/hooks/dashboard/use-dashboard-query': { useDashboardQuery: (options, scope) => {
      assert.equal(typeof scope.isReady, 'boolean');
      assert.equal(typeof scope.accessSignature, 'string');
      return options;
    } },
    // This suite exercises the actual options with QueryObserver below;
    // access-denial visibility has its own mounted-hook regression suite.
    '@/hooks/shared/use-query-data-trust': { useQueryDataTrust: () => ({ canDisplayData: true, isAccessBlocked: false }) },
    '@/lib/api/dashboard': api,
    '@/lib/api/dashboard-visits': api,
    '@/lib/api/dashboard-lead-entries': api,
    '@/lib/performance': { performanceTracker: { trackTimed: (_name, run) => run() } },
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/lib/access/tenant-navigation': { isTenantContextForOrganization: (id, context) => Boolean(id) && id === context?.organizationId },
    '@/lib/access/tenant-query-cache': { createTenantQueryAccessSignature: signature },
    './use-dashboard-filters': { sourceLabels: {} },
  };
  const hooks = compile(read('hooks/use-dashboard-stats.ts'), imports);
  for (const name of ['visits', 'lead-entries']) {
    Object.assign(hooks, compile(read(`hooks/use-dashboard-${name}.ts`), {
      ...imports, '@/hooks/use-dashboard-stats': hooks,
    }));
  }
  hooks.extraCounts = compile(`
    const DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS = ${extraCountsStaleTime};
    export function extraCounts(dashboardQueryScope, dashboardFilters, canQueryDashboard) {
      const activeOrganizationId = dashboardQueryScope.organizationId;
      return ${extraCountsOptions};
    }`, {}, api).extraCounts;
  return {
    hooks, calls,
    setOrganization: (id, tenantId = id) => {
      auth = { ...auth, activeOrganization: { organizationId: id }, tenantContext: { ...auth.tenantContext, organizationId: tenantId } };
    },
  };
}

const queries = [
  ['summary', (hooks, enabled) => hooks.useEnhancedDashboardStats({}, { enabled })],
  ['Won/Lost details', (hooks, enabled) => hooks.useEnhancedDashboardStats({}, { enabled, includeDetails: true })],
  ['funnel', (hooks, enabled) => hooks.useFunnelData({}, 'synthetic-pipeline', { enabled })],
  ['sources', (hooks, enabled) => hooks.useLeadSourcesData({}, undefined, { enabled, countEntries: true })],
  ['distribution', (hooks, enabled) => hooks.useDashboardLeadDistribution({}, { enabled })],
  ['first contact', (hooks, enabled) => hooks.useDashboardFirstContact({}, { enabled })],
  ['first-contact leads', (hooks, enabled) => hooks.useDashboardFirstContactLeads({}, 'synthetic-broker', { enabled }), true],
  ['evolution', (hooks, enabled) => hooks.useDealsEvolutionData({}, { enabled })],
  ['visits', (hooks, enabled) => hooks.useDashboardVisits({}, enabled)],
  ['lead entries', (hooks, enabled) => hooks.useDashboardLeadEntries({}, enabled), true],
  ['extra counts', (hooks, enabled) => hooks.extraCounts(hooks.useDashboardQueryScope(), {}, enabled)],
];

function cachedData(name, infinite) {
  if (name === 'sources') return [{ name: 'Site', rawSource: 'site', value: 0 }];
  const page = { revision: 0, items: [{ id: 'synthetic-old' }], hasMore: false, nextCursor: null };
  return infinite ? { pages: [page], pageParams: [name === 'lead entries' ? null : 0] } : page;
}

function revision(data, name, infinite) {
  return name === 'sources' ? data[0].value : infinite ? data.pages[0].revision : data.revision;
}

async function withObserver(name, getOptions, infinite, options, run) {
  const f = fixture();
  if (options.notReady) f.setOrganization(orgA, orgB);
  const queryOptions = getOptions(f.hooks, options.enabled !== false);
  const client = createClient('synthetic-access');
  const old = cachedData(name, infinite);
  const staleAt = Date.now() - queryOptions.staleTime - 1_000;
  client.setQueryData(queryOptions.queryKey, old, { updatedAt: options.stale ? staleAt : Date.now() });
  if (options.invalidated) await client.invalidateQueries({ queryKey: queryOptions.queryKey, refetchType: 'active' });
  focusManager.setFocused(false);
  client.mount();
  const Observer = infinite ? InfiniteQueryObserver : QueryObserver;
  const observer = new Observer(client, queryOptions);
  const stop = observer.subscribe(() => {});
  try {
    await turn();
    await run({ f, client, observer, queryOptions, old, staleAt });
  } finally {
    stop(); client.unmount(); client.clear(); focusManager.setFocused(undefined);
  }
}

for (const [name, getOptions, infinite = false] of queries) {
  test(`${name}: fresh return and repeated focus reuse the cache`, async () => {
    await withObserver(name, getOptions, infinite, {}, async ({ f, observer }) => {
      assert.equal(f.calls.length, 0);
      for (let index = 0; index < 3; index++) {
        focusManager.setFocused(false); focusManager.setFocused(true); await turn();
      }
      assert.equal(f.calls.length, 0);
      assert.equal(revision(observer.getCurrentResult().data, name, infinite), 0);
    });
  });

  test(`${name}: stale return reads once and shows the new snapshot`, async () => {
    await withObserver(name, getOptions, infinite, { stale: true }, async ({ f, observer }) => {
      assert.equal(f.calls.length, 1);
      assert.equal(revision(observer.getCurrentResult().data, name, infinite), 1);
      focusManager.setFocused(true); await turn();
      assert.equal(f.calls.length, 1, 'The refreshed cache is fresh on focus');
    });
  });

  test(`${name}: focus refreshes an expired visible snapshot without a business event`, async () => {
    await withObserver(name, getOptions, infinite, {}, async ({ f, client, observer, queryOptions, old, staleAt }) => {
      assert.equal(f.calls.length, 0);
      client.setQueryData(queryOptions.queryKey, old, { updatedAt: staleAt });
      focusManager.setFocused(true); await turn();
      assert.equal(f.calls.length, 1);
      assert.equal(revision(observer.getCurrentResult().data, name, infinite), 1);
    });
  });

  test(`${name}: invalidation while absent reconciles on return even before staleTime`, async () => {
    await withObserver(name, getOptions, infinite, { invalidated: true }, async ({ f, observer }) => {
      assert.equal(f.calls.length, 1);
      assert.equal(revision(observer.getCurrentResult().data, name, infinite), 1);
      assert.equal(observer.getCurrentResult().isStale, false);
    });
  });

  test(`${name}: closed or disabled consumers wait until enabled`, async () => {
    await withObserver(name, getOptions, infinite, { stale: true, enabled: false }, async ({ f, observer }) => {
      focusManager.setFocused(true); await turn();
      assert.equal(f.calls.length, 0);
      observer.setOptions(getOptions(f.hooks, true)); await turn();
      assert.equal(f.calls.length, 1);
    });
  });

  test(`${name}: tenant readiness blocks reads and a new organization uses a distinct cache`, async () => {
    await withObserver(name, getOptions, infinite, { stale: true, notReady: true }, async ({ f, client, observer, queryOptions }) => {
      focusManager.setFocused(true); await turn();
      assert.equal(f.calls.length, 0);
      f.setOrganization(orgB);
      const next = getOptions(f.hooks, true);
      assert.notDeepEqual(next.queryKey, queryOptions.queryKey);
      assert.equal(client.getQueryData(next.queryKey), undefined);
      observer.setOptions(next); await turn();
      assert.equal(f.calls.length, 1);
      assert.equal(f.calls[0].organizationId, orgB);
      assert.equal(revision(observer.getCurrentResult().data, name, infinite), 1);
    });
  });
}

for (const name of ['first-contact leads', 'lead entries']) {
  test(`${name}: stale pagination refreshes pages in order using the renewed continuation`, async () => {
    const entries = name === 'lead entries';
    const f = fixture((_kind, params, count) => ({
      revision: count, items: [{ id: `new-${count}` }],
      hasMore: entries ? params.cursor === null : params.offset === 0,
      nextCursor: 'renewed-cursor',
    }));
    const [, getOptions] = queries.find(([key]) => key === name);
    const options = getOptions(f.hooks, true);
    const client = createClient('synthetic-access');
    client.setQueryData(options.queryKey, {
      pages: [
        { revision: 0, items: [{ id: 'old-first' }], hasMore: true, nextCursor: 'old-cursor' },
        { revision: 0, items: [{ id: 'old-second' }], hasMore: false, nextCursor: null },
      ],
      pageParams: entries ? [null, 'old-cursor'] : [0, 25],
    }, { updatedAt: Date.now() - options.staleTime - 1_000 });
    const observer = new InfiniteQueryObserver(client, options);
    const stop = observer.subscribe(() => {});
    try {
      await turn();
      assert.equal(f.calls.length, 2);
      assert.deepEqual(f.calls.map((call) => entries ? call.cursor : call.offset), entries ? [null, 'renewed-cursor'] : [0, 1]);
      assert.deepEqual(observer.getCurrentResult().data.pages.map((page) => page.items[0].id), ['new-1', 'new-2']);
    } finally { stop(); client.clear(); }
  });
}

test('simultaneous stale observers and focus share one pending refresh', async () => {
  let complete;
  const pending = new Promise((resolve) => { complete = resolve; });
  const f = fixture(() => pending);
  const options = f.hooks.useEnhancedDashboardStats({});
  const client = createClient('synthetic-access');
  client.setQueryData(options.queryKey, { revision: 0 }, { updatedAt: Date.now() - options.staleTime - 1_000 });
  focusManager.setFocused(false); client.mount();
  const first = new QueryObserver(client, options);
  const second = new QueryObserver(client, options);
  const stopFirst = first.subscribe(() => {});
  const stopSecond = second.subscribe(() => {});
  try {
    focusManager.setFocused(true); await turn();
    assert.equal(f.calls.length, 1);
    complete({ revision: 1 }); await turn();
    assert.equal(first.getCurrentResult().data.revision, 1);
    assert.equal(second.getCurrentResult().data.revision, 1);
  } finally {
    complete({ revision: 1 }); stopFirst(); stopSecond();
    client.unmount(); client.clear(); focusManager.setFocused(undefined);
  }
});
