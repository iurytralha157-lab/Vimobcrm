import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/query-core';
import ts from 'typescript';

const turn = () => new Promise((resolve) => setImmediate(resolve));
const prefix = 'enhanced-dashboard-stats';

function compile(path, imports = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(code, {
    module: loadedModule, exports: loadedModule.exports, queueMicrotask,
    require: (name) => {
      assert.ok(Object.hasOwn(imports, name), `Unexpected import: ${name}`);
      return imports[name];
    },
  });
  return loadedModule.exports;
}

function harness() {
  const access = compile('./access/query-client-access.ts');
  const { createDashboardQueryRefresh, isDashboardRefreshQueryKey } = compile('./dashboard-query-refresh.ts', {
    '@/lib/access/query-client-access': access,
  });
  const client = new QueryClient({ defaultOptions: { queries: {
    retry: false, gcTime: Infinity, staleTime: 600_000,
    refetchOnMount: false, refetchOnWindowFocus: false,
  } } });
  client.mount();
  let retire = access.activateQueryClientAccess(client);
  const owners = [];
  const stops = [];
  const calls = [];
  return {
    client, calls, isDashboardRefreshQueryKey,
    owner(organizationId = 'org-a') {
      const owner = createDashboardQueryRefresh(client, organizationId);
      owners.push(owner);
      return owner;
    },
    observe(queryPrefix = prefix, organizationId = 'org-a', extraOptions = {}) {
      const key = [queryPrefix, organizationId, 'synthetic-user', 'synthetic-access'];
      const observer = new QueryObserver(client, {
        queryKey: key,
        queryFn: ({ signal }) => new Promise((resolve, reject) => {
          calls.push({ key, signal, resolve, reject });
        }),
        ...extraOptions,
      });
      const stop = observer.subscribe(() => {});
      stops.push(stop);
      return { observer, stop, key, query: client.getQueryCache().find({ queryKey: key, exact: true }) };
    },
    rotateAccess() { retire(); retire = access.activateQueryClientAccess(client); },
    retireAccess() { retire(); },
    async resolve(index, value = { revision: index + 1 }) { calls[index].resolve(value); await turn(); },
    async reject(index) { calls[index].reject(new Error('Synthetic unavailable response')); await turn(); },
    close() {
      owners.forEach((owner) => owner.dispose());
      stops.forEach((stop) => stop());
      retire(); client.unmount(); client.clear(); onlineManager.setOnline(true);
    },
  };
}

async function withHarness(run) {
  const f = harness();
  try { await run(f); } finally { f.close(); }
}

test('many events during one read coalesce into a single trailing read', async () => {
  await withHarness(async (f) => {
    const owner = f.owner();
    const { observer } = f.observe();
    for (let index = 0; index < 20; index++) owner.invalidate(prefix);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].signal.aborted, false);
    await f.resolve(0);
    assert.equal(f.calls.length, 2);
    await f.resolve(1);
    assert.equal(observer.getCurrentResult().data.revision, 2);
    assert.equal(observer.getCurrentResult().isStale, false);
    await turn(); assert.equal(f.calls.length, 2);
  });
});

test('Lead and Backend owners share the same trailing request', async () => {
  await withHarness(async (f) => {
    const lead = f.owner(); const backend = f.owner();
    f.observe();
    lead.invalidate(prefix); backend.invalidate(prefix); lead.invalidate(prefix);
    await f.resolve(0);
    assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 2);
  });
});

test('disposing one owner preserves another owner pending event', async () => {
  await withHarness(async (f) => {
    const first = f.owner(); const second = f.owner();
    f.observe(); first.invalidate(prefix); second.invalidate(prefix); first.dispose();
    await f.resolve(0); assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 2);
  });
});

test('an uninvolved owner cannot keep a disposed owner pending event alive', async () => {
  await withHarness(async (f) => {
    const first = f.owner(); f.owner();
    f.observe(); first.invalidate(prefix); first.dispose();
    await f.resolve(0); assert.equal(f.calls.length, 1);
  });
});

test('same-client access lease A to B to A does not revive the first lease event', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); f.observe(); owner.invalidate(prefix);
    f.rotateAccess(); f.rotateAccess();
    await f.resolve(0);
    assert.equal(f.calls.length, 1);
    owner.invalidate(prefix);
    assert.equal(f.calls.length, 2, 'A new event belongs to the current visit');
    await f.resolve(1);
  });
});

test('a current-lease event during the old request replaces the expired owner request', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); f.observe(); owner.invalidate(prefix);
    f.rotateAccess(); owner.invalidate(prefix);
    await f.resolve(0); assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 2);
  });
});

test('retired access cannot request idle or trailing refreshes', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); f.observe(); owner.invalidate(prefix);
    f.retireAccess(); owner.invalidate(prefix);
    await f.resolve(0); owner.invalidate(prefix); await turn();
    assert.equal(f.calls.length, 1);
  });
});

test('removing and recreating the same key never transfers the old pending event', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); const first = f.observe(); owner.invalidate(prefix);
    first.stop(); f.client.removeQueries({ queryKey: first.key, exact: true });
    const next = f.observe();
    assert.notEqual(first.query, next.query);
    assert.equal(f.calls[0].signal.aborted, true);
    await f.resolve(1, { revision: 'new-query' });
    await f.resolve(0, { revision: 'removed-query' });
    assert.equal(f.calls.length, 2);
    assert.equal(next.observer.getCurrentResult().data.revision, 'new-query');
  });
});

test('offline paused requests wait for settlement and then refresh once', async () => {
  await withHarness(async (f) => {
    onlineManager.setOnline(false);
    const owner = f.owner(); const { observer } = f.observe();
    assert.equal(observer.getCurrentResult().fetchStatus, 'paused');
    owner.invalidate(prefix); owner.invalidate(prefix); await turn();
    assert.equal(f.calls.length, 0);
    onlineManager.setOnline(true); await turn();
    assert.equal(f.calls.length, 1);
    await f.resolve(0); assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 2);
    assert.equal(observer.getCurrentResult().data.revision, 2);
  });
});

test('failure without an intervening event does not invent a trailing retry', async () => {
  await withHarness(async (f) => {
    f.owner(); const { observer } = f.observe();
    await f.reject(0); await turn();
    assert.equal(f.calls.length, 1);
    assert.equal(observer.getCurrentResult().status, 'error');
  });
});

test('failure with an event gets one trailing attempt and its failure does not loop', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); const { observer } = f.observe(); owner.invalidate(prefix);
    await f.reject(0); assert.equal(f.calls.length, 2);
    await f.reject(1); await turn();
    assert.equal(f.calls.length, 2);
    assert.equal(observer.getCurrentResult().status, 'error');
    assert.equal(observer.getCurrentResult().fetchStatus, 'idle');
  });
});

test('events during a trailing request schedule one subsequent read', async () => {
  await withHarness(async (f) => {
    const first = f.owner(); const second = f.owner(); const { observer } = f.observe();
    first.invalidate(prefix); await f.resolve(0); assert.equal(f.calls.length, 2);
    for (let index = 0; index < 10; index++) { first.invalidate(prefix); second.invalidate(prefix); }
    assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 3);
    await f.resolve(2); await turn();
    assert.equal(f.calls.length, 3);
    assert.equal(observer.getCurrentResult().data.revision, 3);
  });
});

test('an event after settlement but before queued flush does not duplicate the refresh', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); const { query } = f.observe(); owner.invalidate(prefix);
    let sent = false;
    const stop = f.client.getQueryCache().subscribe((event) => {
      if (event.query === query && event.type === 'updated' && event.action.type === 'success' && !sent) {
        sent = true;
        owner.invalidate(prefix);
      }
    });
    try {
      await f.resolve(0); assert.equal(sent, true); assert.equal(f.calls.length, 2);
      await f.resolve(1); await turn();
      assert.equal(f.calls.length, 2, 'The older queued flush was consumed by the idle refresh');
    } finally { stop(); }
  });
});

test('disposing before an already queued flush prevents a request', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); const { query } = f.observe(); owner.invalidate(prefix);
    const stop = f.client.getQueryCache().subscribe((event) => {
      if (event.query === query && event.type === 'updated' && event.action.type === 'success') owner.dispose();
    });
    try { await f.resolve(0); assert.equal(f.calls.length, 1); } finally { stop(); }
  });
});

test('disposed handles remain inert and repeated cleanup cannot detach a successor', async () => {
  await withHarness(async (f) => {
    const old = f.owner(); old.dispose();
    const current = f.owner(); old.dispose();
    const otherBus = f.owner(); f.observe();
    old.invalidate(prefix); current.invalidate(prefix); otherBus.invalidate(prefix);
    await f.resolve(0); assert.equal(f.calls.length, 2);
    await f.resolve(1); assert.equal(f.calls.length, 2);
  });
});

test('organization and domain boundaries prevent unrelated refreshes', async () => {
  await withHarness(async (f) => {
    const owner = f.owner('org-a');
    f.observe(prefix, 'org-a'); f.observe(prefix, 'org-b'); f.observe('leads', 'org-a');
    owner.invalidate(prefix); owner.invalidate('leads');
    await f.resolve(0); await f.resolve(1); await f.resolve(2);
    assert.equal(f.calls.length, 4);
    assert.equal(f.calls[3].key[0], prefix);
    assert.equal(f.calls[3].key[1], 'org-a');
    await f.resolve(3);
    assert.equal(f.isDashboardRefreshQueryKey('dashboard-creative-media'), false, 'Media keeps its dedicated renewal policy');
  });
});

test('inactive cache is invalidated without an eager request and reconciles on mount', async () => {
  await withHarness(async (f) => {
    const owner = f.owner(); const first = f.observe();
    await f.resolve(0); first.stop(); owner.invalidate(prefix); await turn();
    assert.equal(f.calls.length, 1);
    assert.equal(f.client.getQueryState(first.key).isInvalidated, true);
    f.observe(prefix, 'org-a', { refetchOnMount: true });
    assert.equal(f.calls.length, 2);
    await f.resolve(1);
  });
});
