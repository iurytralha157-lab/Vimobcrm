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
const eventName = 'vimob:lead-realtime-change';
const dashboardKey = (org = 'org-a', access = 'access-a') => ['enhanced-dashboard-stats', org, 'actor-a', access, { source: null }];
const settle = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); await new Promise(setImmediate); };

// Real bus, its real local dependencies and real QueryObserver; only React's
// effect host, browser events/auth and the bus clock are synthetic. No server,
// browser, Supabase credentials or network is needed. The optional source path
// permits a preserved pre-fix bus to demonstrate RED without restoring the tree.
function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
  const window = new EventTarget();
  const timers = new Map();
  const channels = [];
  const observers = [];
  const refs = [];
  const effects = [];
  let now = 100_000, timerId = 0, refIndex = 0, effectIndex = 0;
  let auth = { user: { id: 'actor-a' }, activeOrganization: { organizationId: 'org-a', status: 'ready' } };
  const setTimer = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; };
  const clearTimer = id => timers.delete(id);
  window.setTimeout = setTimer;
  window.clearTimeout = clearTimer;
  class BrowserChannel {
    constructor(name) { this.name = name; this.closed = false; channels.push(this); }
    close() { this.closed = true; }
    postMessage() {}
  }
  window.BroadcastChannel = BrowserChannel;
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
    '@/contexts/AuthContext': { useAuth: () => auth },
  };
  const modules = new Map();
  function load(path) {
    if (modules.has(path)) return modules.get(path).exports;
    const loadedModule = { exports: {} }; modules.set(path, loadedModule);
    const busSource = path === resolve(root, 'contexts/LeadRealtimeBus.tsx') && process.env.DASHBOARD_REALTIME_TEST_BUS_SOURCE;
    const code = ts.transpileModule(readFileSync(busSource || path, 'utf8'), {
      fileName: path,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
    }).outputText;
    const loadDependency = name => {
      if (dependencies[name]) return dependencies[name];
      if (!name.startsWith('@/') && !name.startsWith('.')) return require(name);
      const base = name.startsWith('@/') ? resolve(root, name.slice(2)) : resolve(dirname(path), name);
      const target = ['', '.ts', '.tsx', '.js'].map(suffix => base + suffix).find(candidate => existsSync(candidate));
      assert.ok(target, `unresolved local dependency ${name}`);
      return load(target);
    };
    runInNewContext(code, { module: loadedModule, exports: loadedModule.exports, require: loadDependency, console, window,
      setTimeout: setTimer, clearTimeout: clearTimer, queueMicrotask, Date: ClockDate, Event, CustomEvent: BrowserEvent,
      BroadcastChannel: BrowserChannel, AbortController, URL, URLSearchParams }, { filename: path });
    return loadedModule.exports;
  }
  const bus = load(resolve(root, 'contexts/LeadRealtimeBus.tsx'));
  const render = () => { refIndex = 0; effectIndex = 0; bus.LeadRealtimeBus(); };
  render();
  return {
    client,
    activateAccess() { return load(resolve(root, 'lib/access/query-client-access.ts')).activateQueryClientAccess(client); },
    async advance(ms) {
      const target = now + ms;
      for (let steps = 0; ; steps++) {
        assert.ok(steps < 500, 'timer loop did not settle');
        const next = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]); now = next[1].at; next[1].callback(); await settle();
      }
      now = target; await settle();
    },
    emit({ organizationId = 'org-a', reason = 'lead.updated', leadId = 'lead-a', via = 'local' } = {}) {
      const detail = { organizationId, reason, leadId };
      if (via === 'broadcast') { channels.filter(channel => !channel.closed).forEach(channel => channel.onmessage?.({ data: detail })); return; }
      if (via === 'storage') { const event = new Event('storage'); event.key = 'vimob:lead-realtime:last-change'; event.newValue = JSON.stringify(detail); window.dispatchEvent(event); return; }
      window.dispatchEvent(new BrowserEvent(eventName, { detail }));
    },
    switchOrganization(organizationId) { auth = { ...auth, activeOrganization: { organizationId, status: 'ready' } }; render(); },
    preservePipeline(leadId, duration) { bus.preserveOptimisticPipelineBoard('org-a', leadId, duration); },
    observe(key, { enabled = true, initialData } = {}) {
      const calls = [];
      const options = { queryKey: key, enabled, initialData, queryFn: ({ signal }) => new Promise((resolveRequest, reject) => { calls.push({ resolve: resolveRequest, reject, signal }); }) };
      const observer = new QueryObserver(client, options);
      const unsubscribe = observer.subscribe(() => {});
      const record = {
        calls, observer, key,
        async complete(index, value) { assert.ok(calls[index], `missing request ${index}`); calls[index].resolve(value); await settle(); },
        disable() { observer.setOptions({ ...options, enabled: false }); },
        stop() { unsubscribe(); observer.destroy(); },
        data() { return client.getQueryData(key); },
      };
      observers.push(record); return record;
    },
    unmount() { effects.forEach(effect => effect.cleanup?.()); effects.length = 0; },
    dispose() { this.unmount(); observers.forEach(record => { record.calls.forEach(call => call.resolve('cleanup')); record.stop(); }); client.clear(); timers.clear(); },
  };
}

for (const mode of ['initial', 'refetch']) test(`dashboard event during ${mode} GET runs one trailing read and keeps current request`, async () => {
  const h = harness();
  try {
    const query = h.observe(dashboardKey(), mode === 'refetch' ? { initialData: 'cached' } : {});
    if (mode === 'refetch') void query.observer.refetch();
    assert.equal(query.calls.length, 1);
    h.emit(); await h.advance(150);
    assert.equal(query.calls.length, 1); assert.equal(query.calls[0].signal.aborted, false);
    await query.complete(0, 'snapshot-before-event'); await h.advance(1_000);
    assert.equal(query.calls.length, 2, 'event during GET must not disappear when the older snapshot resolves');
    await query.complete(1, 'snapshot-after-event'); await h.advance(10_000);
    assert.equal(query.calls.length, 2); assert.equal(query.data(), 'snapshot-after-event');
  } finally { h.dispose(); }
});

test('dashboard burst coalesces, and an event during the trailing read gets one further read', async () => {
  const h = harness();
  try {
    const query = h.observe(dashboardKey());
    for (let index = 0; index < 30; index++) h.emit();
    await h.advance(150); assert.equal(query.calls.length, 1);
    await query.complete(0, 'old'); await h.advance(1_000); assert.equal(query.calls.length, 2);
    for (let index = 0; index < 30; index++) h.emit({ reason: 'lead.stage_moved' });
    await h.advance(150); assert.equal(query.calls.length, 2);
    await query.complete(1, 'intermediate'); await h.advance(1_000); assert.equal(query.calls.length, 3);
    await query.complete(2, 'latest'); await h.advance(10_000);
    assert.equal(query.calls.length, 3); assert.equal(query.data(), 'latest');
    assert.ok(query.calls.every(call => !call.signal.aborted));
  } finally { h.dispose(); }
});

test('dashboard fetch without an event has no trailing read', async () => {
  const h = harness();
  try { const query = h.observe(dashboardKey()); await query.complete(0, 'current'); await h.advance(20_000); assert.equal(query.calls.length, 1); }
  finally { h.dispose(); }
});

test('disabled and inactive dashboard queries stay stale without creating a fetch', async () => {
  const h = harness();
  try {
    const disabled = h.observe(dashboardKey(), { enabled: false, initialData: 'cached' });
    const inactiveKey = ['dashboard-campaigns', 'org-a', 'actor-a', 'access-a']; h.client.setQueryData(inactiveKey, 'inactive');
    h.emit(); await h.advance(20_000);
    assert.equal(disabled.calls.length, 0); assert.equal(disabled.data(), 'cached');
    assert.equal(h.client.getQueryState(disabled.key).isInvalidated, true);
    assert.equal(h.client.getQueryState(inactiveKey).isInvalidated, true);
  } finally { h.dispose(); }
});

test('unmount discards scheduled dashboard work after the in-flight GET settles', async () => {
  const h = harness();
  try {
    const query = h.observe(dashboardKey()); h.emit(); await h.advance(150); h.unmount();
    await query.complete(0, 'old'); await h.advance(20_000); assert.equal(query.calls.length, 1);
    h.emit(); await h.advance(150); assert.equal(query.calls.length, 1);
  } finally { h.dispose(); }
});

test('tenant switch stops old dashboard trailing work and ignores old-tenant events', async () => {
  const h = harness();
  try {
    const old = h.observe(dashboardKey()); h.emit(); await h.advance(150); old.stop(); h.switchOrganization('org-b');
    const current = h.observe(dashboardKey('org-b')); await old.complete(0, 'old-org');
    h.emit(); await h.advance(1_000); assert.equal(old.calls.length, 1); assert.equal(current.calls.length, 1);
    h.emit({ organizationId: 'org-b' }); await h.advance(150); await current.complete(0, 'old-b'); await h.advance(1_000);
    assert.equal(current.calls.length, 2); await current.complete(1, 'latest-b'); assert.equal(current.data(), 'latest-b');
  } finally { h.dispose(); }
});

test('access-key switch leaves no trailing fetch for the disabled old observer', async () => {
  const h = harness();
  try {
    const old = h.observe(dashboardKey()); h.emit(); await h.advance(150); old.disable();
    const current = h.observe(dashboardKey('org-a', 'access-b')); await old.complete(0, 'old-access'); await h.advance(1_000);
    assert.equal(old.calls.length, 1); assert.equal(current.calls.length, 1);
    h.emit(); await h.advance(150); await current.complete(0, 'before-current-event'); await h.advance(1_000);
    assert.equal(current.calls.length, 2); assert.equal(old.calls.length, 1);
  } finally { h.dispose(); }
});

for (const via of ['local', 'storage', 'broadcast']) test(`dashboard ${via} event refreshes only its organization`, async () => {
  const h = harness();
  try {
    const current = h.observe(dashboardKey(), { initialData: 'a' });
    const other = h.observe(dashboardKey('org-b'), { initialData: 'b' });
    h.emit({ via }); await h.advance(150);
    assert.equal(current.calls.length, 1); assert.equal(other.calls.length, 0);
    await current.complete(0, 'latest-a'); await h.advance(10_000); assert.equal(current.calls.length, 1);
  } finally { h.dispose(); }
});

test('WhatsApp-only events leave Dashboard alone and keep Pipeline stale without a board GET', async () => {
  const h = harness();
  try {
    const dashboard = h.observe(dashboardKey(), { initialData: 'dashboard' });
    const board = h.observe(['stages-with-leads', 'org-a'], { initialData: 'board' });
    const contacts = h.observe(['contacts-list', 'org-a'], { initialData: 'contacts' });
    h.emit({ reason: 'lead.whatsapp_activity' }); await h.advance(20_000);
    assert.equal(dashboard.calls.length, 0); assert.equal(h.client.getQueryState(dashboard.key).isInvalidated, false);
    assert.equal(board.calls.length, 0); assert.equal(h.client.getQueryState(board.key).isInvalidated, true);
    assert.equal(contacts.calls.length, 1);
  } finally { h.dispose(); }
});

test('Pipeline preserves its existing trailing read and optimistic move delay', async () => {
  const h = harness();
  try {
    const board = h.observe(['stages-with-leads', 'org-a']);
    h.emit(); await h.advance(150); await board.complete(0, 'old'); await h.advance(5_000);
    assert.equal(board.calls.length, 2); await board.complete(1, 'fresh');
    h.preservePipeline('lead-a', 4_000); h.emit(); await h.advance(150); assert.equal(board.calls.length, 2);
    await h.advance(5_000); assert.equal(board.calls.length, 3);
  } finally { h.dispose(); }
});

test('Contacts keeps its running GET and reconciles the event without changing Dashboard', async () => {
  const h = harness();
  try {
    const contacts = h.observe(['contacts-list', 'org-a']); h.emit(); await h.advance(150);
    assert.equal(contacts.calls.length, 1); assert.equal(contacts.calls[0].signal.aborted, false);
    await contacts.complete(0, 'before-event'); await h.advance(1_000); assert.equal(contacts.calls.length, 2);
    await contacts.complete(1, 'after-event'); await h.advance(20_000);
    assert.equal(contacts.calls.length, 2); assert.equal(contacts.data(), 'after-event');
  } finally { h.dispose(); }
});


test('query-client access ABA discards the old lease without disabling the new visit', async () => {
  const h = harness();
  const releaseOld = h.activateAccess();
  let releaseCurrent;
  try {
    const query = h.observe(dashboardKey()); h.emit(); await h.advance(150);
    releaseOld(); releaseCurrent = h.activateAccess();
    await query.complete(0, 'old-visit'); await h.advance(1_000);
    assert.equal(query.calls.length, 1, 'a renewed provider visit must not revive an old pending refresh');
    h.emit(); await h.advance(150); assert.equal(query.calls.length, 2);
    releaseOld(); // A late cleanup from the old visit cannot revoke the new visit.
    h.emit(); await h.advance(150); await query.complete(1, 'before-current-event'); await h.advance(1_000);
    assert.equal(query.calls.length, 3); await query.complete(2, 'current-visit');
    assert.equal(query.data(), 'current-visit');
  } finally { releaseCurrent?.(); releaseOld(); h.dispose(); }
});

test('unmount before the event debounce prevents any new dashboard GET', async () => {
  const h = harness();
  try {
    const query = h.observe(dashboardKey(), { initialData: 'cached' }); h.emit(); h.unmount();
    await h.advance(20_000); assert.equal(query.calls.length, 0); assert.equal(query.data(), 'cached');
  } finally { h.dispose(); }
});

test('LeadRealtimeBus dispatches all current Dashboard prefixes while legacy media and Finance remain unchanged', async () => {
  const h = harness();
  try {
    const prefixes = ['enhanced-dashboard-stats', 'funnel-data', 'lead-sources-data', 'deals-evolution',
      'dashboard-extra-counts', 'dashboard-lead-distribution', 'dashboard-campaigns', 'dashboard-creatives',
      'dashboard-first-contact', 'dashboard-first-contact-leads', 'dashboard-lead-entries', 'dashboard-visits'];
    const dashboard = prefixes.map(prefix => h.observe([prefix, 'org-a', 'actor-a', 'access-a']));
    const unchanged = ['dashboard-creative-media', 'financial-dashboard'].map(prefix => h.observe([prefix, 'org-a', 'actor-a']));
    h.emit(); await h.advance(150);
    for (const query of [...dashboard, ...unchanged]) await query.complete(0, 'before-event');
    await h.advance(1_000);
    for (const query of dashboard) assert.equal(query.calls.length, 2, `${query.key[0]} needs its trailing read`);
    for (const query of unchanged) assert.equal(query.calls.length, 1, `${query.key[0]} is outside this change`);
  } finally { h.dispose(); }
});

