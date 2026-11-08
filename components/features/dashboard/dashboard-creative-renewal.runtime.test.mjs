import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import React from 'react';
import { QueryClient, QueryObserver } from '@tanstack/query-core';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const turn = () => new Promise((done) => setImmediate(done));
const image = (number) => `https://scontent.fbcdn.net/synthetic-${number}.jpg`;
const media = (number) => ({ thumbnailUrl: image(number), imageUrl: image(number) });
const creative = (number) => ({ ...media(number), key: 'creative:1', name: 'Synthetic creative', creativeId: '1', attributionLevel: 'creative', leadCount: 1, campaignCount: 1, isVideo: false });

function find(element, predicate) {
  if (!element || typeof element !== 'object') return null;
  if (predicate(element)) return element;
  for (const child of React.Children.toArray(element.props?.children)) {
    const found = find(child, predicate);
    if (found) return found;
  }
  return null;
}

// Stateful real CreativeRow + real media hook; QueryObserver is the installed
// TanStack implementation. Only React's host mounting and API/auth are mocked.
function harness(context) {
  const cache = new Map(), slots = [], subscriptions = [];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnMount: false, refetchOnWindowFocus: false } } });
  let cursor = 0, requests = 0, reply = media(2), ready = true, organizationId = 'org-one', latestOptions;
  const react = { ...React,
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (next) => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useCallback(callback) { return callback; },
    useMemo(factory, dependencies) {
      const slot = react.useRef(null);
      if (!slot.current || dependencies.some((value, index) => !Object.is(value, slot.current.dependencies[index]))) {
        slot.current = { value: factory(), dependencies };
      }
      return slot.current.value;
    },
    useSyncExternalStore(subscribe, getSnapshot) {
      const slot = react.useRef(null);
      if (slot.current?.subscribe !== subscribe) {
        slot.current?.stop();
        const unsubscribe = subscribe(() => {});
        let active = true;
        slot.current = { subscribe, stop() { if (active) { active = false; unsubscribe(); } } };
        const current = slot.current;
        subscriptions.push(() => current.stop());
      }
      return getSnapshot();
    },
  };
  function useQuery(options) {
    latestOptions = options;
    const observer = react.useRef(null);
    if (!observer.current) {
      observer.current = new QueryObserver(client, options);
      subscriptions.push(observer.current.subscribe(() => {}));
    } else observer.current.setOptions(options);
    return observer.current.getCurrentResult();
  }
  function load(relative) {
    const filename = resolve(root, relative);
    if (cache.has(filename)) return cache.get(filename).exports;
    const compiledModule = { exports: {} };
    cache.set(filename, compiledModule);
    let compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    }).outputText;
    if (relative.endsWith('TopCreativesCard.tsx')) compiled += '\nexports.AuditCreativeRow = CreativeRow;';
    const imports = (specifier) => {
      if (specifier === 'react') return react;
      if (specifier === '@tanstack/react-query') return { useQuery, useQueryClient: () => client };
      if (specifier === '@/hooks/use-dashboard-stats') return { useDashboardQueryScope: () => ({ organizationId, currentUserId: 'synthetic-user', accessSignature: organizationId, isReady: ready }) };
      if (specifier === '@/hooks/use-dashboard-creatives') return {};
      if (specifier === '@/lib/api/dashboard') return { getDashboardFiltersQueryKey: (filters) => filters,
        getDashboardCreativeMedia: async () => { requests++; if (reply instanceof Error) throw reply; return reply; },
      };
      if (specifier === 'next/image') return { __esModule: true, default: function MockImage() {} };
      if (specifier.startsWith('@/')) {
        const base = specifier.slice(2);
        return load(base + (existsSync(resolve(root, `${base}.tsx`)) ? '.tsx' : '.ts'));
      }
      return require(specifier);
    };
    new Function('require', 'module', 'exports', compiled)(imports, compiledModule, compiledModule.exports);
    return compiledModule.exports;
  }
  const { AuditCreativeRow } = load('components/features/dashboard/TopCreativesCard.tsx');
  context.after(() => { subscriptions.forEach((unsubscribe) => unsubscribe()); client.clear(); });
  return {
    render(value = creative(1), rankingUpdatedAt = 0) {
      cursor = 0;
      const row = AuditCreativeRow({ creative: value, rank: 1, filters: {}, rankingUpdatedAt });
      const thumbnail = find(row, (element) => element.type?.name === 'CreativeThumbnail');
      return { row, thumbnail };
    },
    get requests() { return requests; },
    get queryKey() { return latestOptions.queryKey; },
    async cacheMedia(value, at) {
      assert.equal(Date.now(), at);
      // Seed an authorized completed read: manual writes deliberately cannot
      // establish or recover trust in an already observed query.
      await client.fetchQuery({ ...latestOptions, queryFn: async () => value, staleTime: 0 });
    },
    reply(value) { reply = value; },
    scope(value, isReady = true) { organizationId = value; ready = isReady; },
    canRefresh: load('hooks/use-dashboard-creative-media.ts').canRefreshDashboardCreativeMedia,
  };
}

test('a second expired URL renews while the creative remains mounted, without an immediate retry loop', async (context) => {
  let now = 100_000;
  context.mock.method(Date, 'now', () => now);
  const view = harness(context);
  view.render().thumbnail.props.onUnavailable();
  view.render(); await turn();
  const renewed = view.render();
  assert.equal(view.requests, 1);
  assert.equal(renewed.thumbnail.props.creative.imageUrl, image(2));
  renewed.thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 1, 'a newly returned but broken URL must not create a request storm');
  now += 30_000; view.reply(media(3));
  view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 2);
  assert.equal(view.render().thumbnail.props.creative.imageUrl, image(3));
});

test('an expired lookup in a fresh cache still fetches, and a retry from the preview remounts the same URL', async (context) => {
  let now = 200_000;
  context.mock.method(Date, 'now', () => now);
  const view = harness(context);
  view.render(); await view.cacheMedia(media(2), now);
  view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 1);
  const before = view.render();
  before.thumbnail.props.onUnavailable();
  now += 30_000;
  const failed = view.render();
  // The ranking shows no refresh buttons: recovery lives in the image preview.
  assert.equal(find(failed.row, (element) => element.type === 'button' && element.props.children === 'Atualizar miniatura'), null);
  find(failed.row, (element) => element.type === 'button' && element.props['aria-label']?.includes('Visualizar imagem')).props.onClick();
  find(view.render().row, (element) => element.type?.name === 'CreativeImageDialog').props.onRetry(); view.render(); await turn();
  assert.equal(view.requests, 2);
  const after = view.render();
  assert.equal(after.thumbnail.props.creative.imageUrl, image(2));
  assert.notEqual(after.thumbnail.key, before.thumbnail.key, 'a retried unchanged URL resets exhausted image fallbacks');
  after.thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 2);
  after.thumbnail.props.onAvailable();
  assert.equal(find(view.render().row, (element) => element.type === 'button' && element.props.children === 'Atualizar miniatura'), null);
});

test('same-URL automatic refresh waits for cache freshness and every refresh respects the cooldown', (context) => {
  const { canRefresh } = harness(context);
  const previous = { version: 'same-url', at: 100_000 };
  assert.equal(canRefresh(previous, 'new-url', 129_999), false);
  assert.equal(canRefresh(previous, 'new-url', 130_000), true);
  assert.equal(canRefresh(previous, 'same-url', 130_000), false);
  assert.equal(canRefresh(previous, 'same-url', 700_000), true);
  assert.equal(canRefresh(previous, 'same-url', 129_999, true), false);
  assert.equal(canRefresh(previous, 'same-url', 130_000, true), true);
});

test('a transient refresh failure offers bounded manual recovery without automatic retry', async (context) => {
  let now = 250_000;
  context.mock.method(Date, 'now', () => now);
  const view = harness(context);
  view.reply(Object.assign(new Error('Synthetic unavailable'), { status: 503 }));
  view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 1);
  const preview = () => find(view.render().row, (element) => element.type?.name === 'CreativeImageDialog');
  find(view.render().row, (element) => element.type === 'button' && element.props['aria-label']?.includes('Visualizar imagem')).props.onClick();
  assert.ok(preview());
  preview().props.onRetry(); view.render(); await turn();
  assert.equal(view.requests, 1);
  assert.equal(preview().props.refreshHint, 'Atualização recente. Tente novamente em instantes.');
  now += 30_000; view.reply(media(2));
  preview().props.onRetry(); view.render(); await turn();
  assert.equal(view.requests, 2);
  assert.equal(view.render().thumbnail.props.creative.imageUrl, image(2));
});

test('new ranking URLs and newer ranking data take precedence over an older lookup', async (context) => {
  let now = 300_000;
  context.mock.method(Date, 'now', () => now);
  const view = harness(context);
  view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.render().thumbnail.props.creative.imageUrl, image(2));
  const previousKey = view.queryKey;
  now += 60_000;
  assert.equal(view.render(creative(3), now).thumbnail.props.creative.imageUrl, image(3));
  assert.notDeepEqual(view.queryKey, previousKey);
  assert.equal(view.render(creative(1), now).thumbnail.props.creative.imageUrl, image(1));
  assert.equal(view.requests, 1, 'healthy ranking updates stay lazy');
});

test('media cache and renewal guards follow organization scope and disabled access', async (context) => {
  context.mock.method(Date, 'now', () => 400_000);
  const view = harness(context);
  view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  view.scope('org-two');
  assert.equal(view.render().thumbnail.props.creative.imageUrl, image(1));
  view.reply(media(3)); view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
  assert.equal(view.requests, 2);
  assert.equal(view.render().thumbnail.props.creative.imageUrl, image(3));
  view.scope('org-three', false);
  const unavailable = view.render();
  assert.equal(unavailable.thumbnail, null);
  assert.equal(unavailable.row.props.role, 'alert');
  find(unavailable.row, (element) => element.type === 'button').props.onClick();
  view.render(); await turn();
  assert.equal(view.requests, 2);
});

for (const error of [{ status: 401 }, { status: 403 }, { status: 503, code: 'session_check_unavailable' }]) {
  test(`a denied renewal ${error.code ?? error.status} hides the whole cached row`, async (context) => {
    context.mock.method(Date, 'now', () => 500_000);
    const view = harness(context);
    view.render(); await view.cacheMedia(media(2), 500_000);
    view.reply(Object.assign(new Error('Synthetic denial'), error));
    view.render().thumbnail.props.onUnavailable(); view.render(); await turn();
    const denied = view.render();
    assert.equal(denied.thumbnail, null);
    assert.equal(denied.row.props.role, 'alert');
    assert.equal(find(denied.row, (element) => element.props?.title === 'Synthetic creative'), null);
    assert.equal(find(denied.row, (element) => element.type === 'a'), null);
    const retry = find(denied.row, (element) => element.type === 'button');
    assert.equal(retry.props.children, 'Tentar novamente');
    retry.props.onClick(); view.render(); await turn();
    assert.equal(view.requests, 1);
  });
}
