import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { QueryClient, QueryObserver, focusManager } from '@tanstack/query-core';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const turn = () => new Promise((resolve) => setImmediate(resolve));

function hookOptions(kind, isReady, load) {
  const filename = `../../../hooks/use-dashboard-${kind}.ts`;
  const compiled = ts.transpileModule(readFileSync(new URL(filename, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const compiledModule = { exports: {} };
  const imports = (specifier) => {
    if (specifier === '@tanstack/react-query') return { useQuery: (options) => options };
    if (specifier === '@/hooks/dashboard/use-dashboard-query') return {
      useDashboardQuery: (options, scope) => { assert.equal(scope.isReady, isReady); return options; },
    };
    if (specifier === '@/hooks/use-dashboard-stats') return {
      useDashboardQueryScope: () => ({ organizationId: 'synthetic-org', currentUserId: 'synthetic-user', accessSignature: 'synthetic-access', isReady }),
    };
    if (specifier === '@/lib/api/dashboard') return {
      getDashboardCampaigns: load, getDashboardCreatives: load,
      getDashboardFiltersQueryKey: (filters) => JSON.stringify(filters),
    };
    return require(specifier);
  };
  new Function('require', 'module', 'exports', compiled)(imports, compiledModule, compiledModule.exports);
  const name = kind === 'campaigns' ? 'useDashboardCampaigns' : 'useDashboardCreatives';
  return compiledModule.exports[name]({});
}

for (const kind of ['campaigns', 'creatives']) {
  for (const isReady of [true, false]) {
    test(`${kind} refreshes stale mounted/focused data only with a ready access scope (${isReady})`, async () => {
      let requests = 0;
      const options = hookOptions(kind, isReady, async () => ({ marker: ++requests }));
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } });
      client.setQueryData(options.queryKey, { marker: 'old' }, { updatedAt: Date.now() - 120_000 });
      focusManager.setFocused(false);
      client.mount();
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      try {
        await turn();
        assert.equal(requests, isReady ? 1 : 0);
        client.setQueryData(options.queryKey, { marker: 'missed-realtime' }, { updatedAt: Date.now() - 120_000 });
        focusManager.setFocused(true);
        await turn();
        assert.equal(requests, isReady ? 2 : 0);
        if (isReady) assert.equal(observer.getCurrentResult().data.marker, 2);
        // A fresh result and another focus event do not cause polling/reloads.
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        await turn();
        assert.equal(requests, isReady ? 2 : 0);
      } finally {
        unsubscribe(); client.unmount(); client.clear(); focusManager.setFocused(undefined);
      }
    });
  }
}
