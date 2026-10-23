import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await new Promise(setImmediate);
};

// Execute both production buses and their local dependencies. Only the SSE
// transport, auth/router, React effect host and browser clock are synthetic.
function harness() {
  const clients = [], observers = [], effects = [], refs = [], connections = [];
  const timers = new Map(), modules = new Map();
  const window = new EventTarget();
  let now = 100_000, nextTimer = 0, effectIndex = 0, refIndex = 0;
  const makeClient = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    clients.push(client); return client;
  };
  let client = makeClient();
  let auth = { user: { id: 'actor-a' }, profile: { id: 'actor-a' },
    activeOrganization: { organizationId: 'org-a', status: 'ready' },
    refreshProfile: async () => {}, refreshOrganizations: async () => {} };
  const router = { replace() {} };
  const setTimer = (callback, delay = 0) => { const id = ++nextTimer; timers.set(id, { at: now + delay, callback }); return id; };
  const clearTimer = id => timers.delete(id);
  window.setTimeout = setTimer; window.clearTimeout = clearTimer;
  class BrowserEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail; } }
  class ClockDate extends Date { static now() { return now; } }
  const dependencies = {
    react: {
      useRef: initial => { const index = refIndex++; refs[index] ??= { current: initial }; return refs[index]; },
      useEffect: (setup, deps) => {
        const index = effectIndex++, previous = effects[index];
        if (previous && deps.every((value, position) => Object.is(value, previous.deps[position]))) return;
        previous?.cleanup?.(); effects[index] = { deps, cleanup: setup() };
      },
    },
    '@tanstack/react-query': { useQueryClient: () => client },
    'next/navigation': { useRouter: () => router, usePathname: () => '/dashboard' },
    '@/contexts/AuthContext': { useAuth: () => auth },
    '@/lib/api/realtime': { connectBackendRealtime: options => {
      const connection = { ...options, active: true }; connections.push(connection);
      return () => { connection.active = false; };
    } },
  };
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const loaded = { exports: {} }; modules.set(path, loaded);
    const preservedSource = path === resolve(root, 'contexts/BackendRealtimeBus.tsx') && process.env.DASHBOARD_BACKEND_TEST_BUS_SOURCE;
    const code = ts.transpileModule(readFileSync(preservedSource || path, 'utf8'), {
      fileName: path, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const loadDependency = name => {
      if (dependencies[name]) return dependencies[name];
      if (!name.startsWith('@/') && !name.startsWith('.')) return require(name);
      const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
      const target = ['', '.ts', '.tsx', '.js'].map(suffix => base + suffix).find(candidate => existsSync(candidate));
      assert.ok(target, `unresolved local dependency ${name}`); return load(target);
    };
    runInNewContext(code, { module: loaded, exports: loaded.exports, require: loadDependency, console, window,
      setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask, Date: ClockDate, Event, CustomEvent: BrowserEvent,
      AbortController, URL, URLSearchParams }, { filename: path });
    return loaded.exports;
  }
  const lead = load(resolve(root, 'contexts/LeadRealtimeBus.tsx'));
  const backend = load(resolve(root, 'contexts/BackendRealtimeBus.tsx'));
  const access = load(resolve(root, 'lib/access/query-client-access.ts'));
  let retireAccess = access.activateQueryClientAccess(client);
  const render = () => { refIndex = 0; effectIndex = 0; lead.LeadRealtimeBus(); backend.BackendRealtimeBus(); };
  render();
  return {
    get client() { return client; },
    async advance(ms) {
      const target = now + ms;
      for (let steps = 0; ; steps++) {
        assert.ok(steps < 500, 'timer loop');
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await settle();
      }
      now = target; await settle();
    },
    emit(type, organizationId = 'org-a') {
      connections.filter(connection => connection.active).forEach(connection => connection.onEvent({ type, organizationId, data: {} }));
    },
    switchAccess({ organizationId = 'org-a', newClient = true } = {}) {
      retireAccess(); if (newClient) client = makeClient();
      retireAccess = access.activateQueryClientAccess(client);
      auth = { ...auth, activeOrganization: { organizationId, status: 'ready' } }; render();
    },
    observe(prefix = 'enhanced-dashboard-stats', { organizationId = 'org-a', initialData } = {}) {
      const queryClient = client, key = [prefix, organizationId, 'actor-a', 'scope-a'];
      const calls = [];
      const observer = new QueryObserver(queryClient, { queryKey: key, initialData,
        queryFn: ({ signal }) => new Promise(resolveRequest => calls.push({ resolve: resolveRequest, signal })) });
      const unsubscribe = observer.subscribe(() => {});
      const record = { calls, observer,
        data: () => queryClient.getQueryData(key),
        async complete(index, value) { assert.ok(calls[index], `missing GET ${index}`); calls[index].resolve(value); await settle(); },
        close() { unsubscribe(); observer.destroy(); calls.forEach(call => call.resolve('cleanup')); },
      };
      observers.push(record); return record;
    },
    unmount() { effects.forEach(effect => effect.cleanup?.()); effects.length = 0; },
    dispose() { this.unmount(); retireAccess(); observers.forEach(record => record.close()); clients.forEach(item => item.clear()); timers.clear(); },
  };
}

for (const event of ['site.updated', 'schedule.changed']) {
  for (const mode of ['initial', 'refetch']) {
    test(`${event} during ${mode} GET preserves the request and reads again after settlement`, async () => {
      const h = harness();
      try {
        const query = h.observe('enhanced-dashboard-stats', mode === 'refetch' ? { initialData: 'cached' } : {});
        if (mode === 'refetch') void query.observer.refetch();
        h.emit(event); await h.advance(300);
        assert.equal(query.calls.length, 1); assert.equal(query.calls[0].signal.aborted, false);
        await query.complete(0, 'before-event'); await h.advance(300);
        assert.equal(query.calls.length, 2);
        await query.complete(1, 'after-event'); await h.advance(10_000);
        assert.equal(query.data(), 'after-event'); assert.equal(query.calls.length, 2);
      } finally { h.dispose(); }
    });
  }
}

test('Site, Agenda and Lead events share one trailing Dashboard read', async () => {
  const h = harness();
  try {
    const query = h.observe();
    for (let i = 0; i < 20; i++) { h.emit('site.updated'); h.emit('schedule.changed'); h.emit('lead.updated'); }
    await h.advance(500); assert.equal(query.calls.length, 1);
    await query.complete(0, 'old'); assert.equal(query.calls.length, 2);
    await query.complete(1, 'new'); await h.advance(5_000);
    assert.equal(query.calls.length, 2); assert.equal(query.data(), 'new');
  } finally { h.dispose(); }
});

test('Dashboard is organization scoped while Site analytics and Agenda consumers keep refreshing', async () => {
  const h = harness();
  try {
    const current = h.observe('enhanced-dashboard-stats', { initialData: 'dashboard' });
    const other = h.observe('enhanced-dashboard-stats', { organizationId: 'org-b', initialData: 'other' });
    const site = h.observe('site-analytics', { initialData: 'site' });
    const agenda = h.observe('schedule-events', { initialData: 'agenda' });
    h.emit('site.updated'); h.emit('schedule.changed'); await h.advance(300);
    assert.equal(current.calls.length, 1); assert.equal(other.calls.length, 0);
    // Site analytics keeps its existing cancellation policy; only Dashboard changes.
    assert.equal(site.calls.length, 2); assert.equal(site.calls[0].signal.aborted, true);
    assert.equal(agenda.calls.length, 1);
    h.emit('site.updated', 'org-b'); assert.equal(other.calls.length, 0);
  } finally { h.dispose(); }
});

for (const change of ['unmount', 'client', 'organization', 'same-client-session']) {
  test(`pending Backend work does not refresh the retired access after ${change}`, async () => {
    const h = harness();
    try {
      const old = h.observe(); h.emit('site.updated');
      if (change === 'unmount') h.unmount();
      else h.switchAccess({ organizationId: change === 'organization' ? 'org-b' : 'org-a', newClient: change !== 'same-client-session' });
      await old.complete(0, 'retired'); await h.advance(300);
      assert.equal(old.calls.length, 1);
      if (change !== 'unmount') {
        const next = change === 'same-client-session' ? old : h.observe('enhanced-dashboard-stats', { organizationId: change === 'organization' ? 'org-b' : 'org-a' });
        h.emit('site.updated', change === 'organization' ? 'org-b' : 'org-a');
        if (next !== old) await next.complete(0, 'new-access-before');
        assert.equal(next.calls.length, 2);
        await next.complete(1, 'new-access-after'); assert.equal(next.data(), 'new-access-after');
      }
    } finally { h.dispose(); }
  });
}

test('unmount cancels an Agenda debounce before Dashboard or Agenda reads start', async () => {
  const h = harness();
  try {
    const dashboard = h.observe('enhanced-dashboard-stats', { initialData: 'cached' });
    const agenda = h.observe('schedule-events', { initialData: 'cached' });
    h.emit('schedule.changed'); h.unmount(); await h.advance(500);
    assert.equal(dashboard.calls.length, 0); assert.equal(agenda.calls.length, 0);
  } finally { h.dispose(); }
});

for (const first of ['dashboard', 'contacts']) {
  test(`concurrent Dashboard and Contacts reads reconcile independently when ${first} settles first`, async () => {
    const h = harness();
    try {
      const dashboard = h.observe();
      const contacts = h.observe('contacts-list');
      h.emit('lead.updated'); await h.advance(150);
      assert.equal(dashboard.calls.length, 1); assert.equal(contacts.calls.length, 1);
      const [early, late] = first === 'dashboard' ? [dashboard, contacts] : [contacts, dashboard];
      await early.complete(0, 'early-old');
      assert.equal(early.calls.length, 2); assert.equal(late.calls.length, 1);
      await late.complete(0, 'late-old'); assert.equal(late.calls.length, 2);
      await dashboard.complete(1, 'dashboard-current'); await contacts.complete(1, 'contacts-current');
      await h.advance(10_000);
      assert.equal(dashboard.calls.length, 2); assert.equal(contacts.calls.length, 2);
      assert.equal(dashboard.data(), 'dashboard-current'); assert.equal(contacts.data(), 'contacts-current');
    } finally { h.dispose(); }
  });
}
