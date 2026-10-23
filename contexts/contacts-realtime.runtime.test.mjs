import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const eventName = 'vimob:lead-realtime-change';
const contactsKey = (org = 'org-a', access = 'actor-a') => ['contacts-list', org, access, { page: 1, limit: 25 }];
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
    const busSource = path === resolve(root, 'contexts/LeadRealtimeBus.tsx') && process.env.CONTACTS_REALTIME_TEST_BUS_SOURCE;
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

for (const mode of ['initial', 'refetch']) test(`Contacts event during ${mode} read schedules one trailing snapshot`, async () => {
  const h = harness();
  try {
    const query = h.observe(contactsKey(), mode === 'refetch' ? { initialData: 'cached' } : {});
    if (mode === 'refetch') void query.observer.refetch();
    h.emit(); await h.advance(150);
    assert.equal(query.calls.length, 1);
    assert.equal(query.calls[0].signal.aborted, false);
    await query.complete(0, 'before-event'); await h.advance(1_000);
    assert.equal(query.calls.length, 2, 'the earlier snapshot must be followed by a read after the event');
    await query.complete(1, 'after-event'); await h.advance(10_000);
    assert.equal(query.calls.length, 2); assert.equal(query.data(), 'after-event');
  } finally { h.dispose(); }
});

test('Contacts bursts coalesce and a new event during the trailing read gets one more turn', async () => {
  const h = harness();
  try {
    const query = h.observe(contactsKey());
    for (let i = 0; i < 30; i++) h.emit();
    await h.advance(150); assert.equal(query.calls.length, 1);
    await query.complete(0, 'old'); await h.advance(1_000); assert.equal(query.calls.length, 2);
    for (let i = 0; i < 30; i++) h.emit({ reason: 'lead.created' });
    await h.advance(150); assert.equal(query.calls.length, 2);
    await query.complete(1, 'intermediate'); await h.advance(1_000); assert.equal(query.calls.length, 3);
    await query.complete(2, 'latest'); await h.advance(10_000);
    assert.equal(query.calls.length, 3); assert.equal(query.data(), 'latest');
    assert.ok(query.calls.every(call => !call.signal.aborted));
  } finally { h.dispose(); }
});

test('Contacts retries reconciliation after an older GET fails without a retry loop', async () => {
  const h = harness();
  try {
    const query = h.observe(contactsKey(), { initialData: 'cached' });
    void query.observer.refetch(); h.emit(); await h.advance(150);
    query.calls[0].reject(new Error('synthetic unavailable')); await settle(); await h.advance(1_000);
    assert.equal(query.calls.length, 2);
    await query.complete(1, 'recovered'); await h.advance(10_000);
    assert.equal(query.data(), 'recovered'); assert.equal(query.calls.length, 2);
  } finally { h.dispose(); }
});

test('Contacts does not refetch without an event and keeps disabled/inactive queries stale', async () => {
  const h = harness();
  try {
    const current = h.observe(contactsKey()); await current.complete(0, 'current'); await h.advance(10_000);
    assert.equal(current.calls.length, 1);
    const disabled = h.observe(contactsKey('org-a', 'disabled'), { enabled: false, initialData: 'disabled' });
    const inactiveKey = contactsKey('org-a', 'inactive'); h.client.setQueryData(inactiveKey, 'inactive');
    h.emit(); await h.advance(150); await current.complete(1, 'fresh'); await h.advance(1_000);
    assert.equal(current.calls.length, 2); assert.equal(disabled.calls.length, 0);
    assert.equal(h.client.getQueryState(disabled.key).isInvalidated, true);
    assert.equal(h.client.getQueryState(inactiveKey).isInvalidated, true);
  } finally { h.dispose(); }
});

test('unmount before debounce or during a Contacts GET discards scheduled work', async () => {
  for (const beforeDebounce of [true, false]) {
    const h = harness();
    try {
      const query = h.observe(contactsKey()); h.emit();
      if (!beforeDebounce) await h.advance(150);
      h.unmount(); await query.complete(0, 'old'); await h.advance(20_000);
      assert.equal(query.calls.length, 1);
    } finally { h.dispose(); }
  }
});

test('Contacts tenant switch cancels old trailing work and ignores old-tenant events', async () => {
  const h = harness();
  try {
    const old = h.observe(contactsKey()); h.emit(); await h.advance(150);
    old.stop(); h.switchOrganization('org-b');
    const current = h.observe(contactsKey('org-b'));
    await old.complete(0, 'old-org'); h.emit(); await h.advance(1_000);
    assert.equal(old.calls.length, 1); assert.equal(current.calls.length, 1);
    h.emit({ organizationId: 'org-b' }); await h.advance(150);
    await current.complete(0, 'before-b-event'); await h.advance(1_000);
    assert.equal(current.calls.length, 2); await current.complete(1, 'current-b');
    assert.equal(current.data(), 'current-b');
  } finally { h.dispose(); }
});

test('Contacts access ABA discards the old lease while the new visit can refresh', async () => {
  const h = harness(), releaseOld = h.activateAccess();
  let releaseCurrent;
  try {
    const query = h.observe(contactsKey()); h.emit(); await h.advance(150);
    releaseOld(); releaseCurrent = h.activateAccess();
    await query.complete(0, 'old-visit'); await h.advance(1_000);
    assert.equal(query.calls.length, 1);
    h.emit(); await h.advance(150); assert.equal(query.calls.length, 2);
    releaseOld(); h.emit(); await h.advance(150);
    await query.complete(1, 'before-current-event'); await h.advance(1_000);
    assert.equal(query.calls.length, 3); await query.complete(2, 'current-visit');
  } finally { releaseCurrent?.(); releaseOld(); h.dispose(); }
});

for (const via of ['local', 'storage', 'broadcast']) test(`Contacts ${via} only refreshes the event organization`, async () => {
  const h = harness();
  try {
    const current = h.observe(contactsKey(), { initialData: 'a' });
    const other = h.observe(contactsKey('org-b'), { initialData: 'b' });
    h.emit({ via }); await h.advance(150);
    assert.equal(current.calls.length, 1); assert.equal(other.calls.length, 0);
    await current.complete(0, 'fresh-a'); await h.advance(10_000);
    assert.equal(current.calls.length, 1); assert.equal(current.data(), 'fresh-a');
  } finally { h.dispose(); }
});

test('a removed Contacts query cannot schedule work for a replacement with the same key', async () => {
  const h = harness();
  try {
    const old = h.observe(contactsKey()); h.emit(); await h.advance(150);
    h.client.removeQueries({ queryKey: old.key, exact: true });
    const current = h.observe(contactsKey()); await current.complete(0, 'replacement');
    await old.complete(0, 'old'); await h.advance(10_000);
    assert.equal(current.calls.length, 1); assert.equal(current.data(), 'replacement');
  } finally { h.dispose(); }
});

test('Contacts waits for a paused request to settle before its trailing read', async () => {
  onlineManager.setOnline(false);
  const h = harness(); h.client.mount();
  try {
    const query = h.observe(contactsKey());
    assert.equal(h.client.getQueryState(query.key).fetchStatus, 'paused');
    h.emit(); await h.advance(1_000); assert.equal(query.calls.length, 0);
    onlineManager.setOnline(true); await settle(); assert.equal(query.calls.length, 1);
    await query.complete(0, 'before-event'); await h.advance(1_000);
    assert.equal(query.calls.length, 2); await query.complete(1, 'after-reconnect');
    await h.advance(10_000); assert.equal(query.calls.length, 2);
  } finally { onlineManager.setOnline(true); h.client.unmount(); h.dispose(); }
});

test('changing filters disables the old Contacts observer without refreshing its stale scope', async () => {
  const h = harness();
  try {
    const old = h.observe(contactsKey()); h.emit(); await h.advance(150); old.disable();
    const current = h.observe([...contactsKey().slice(0, 3), { page: 1, search: 'new-filter' }]);
    await old.complete(0, 'old-filter'); await current.complete(0, 'new-filter'); await h.advance(1_000);
    assert.equal(old.calls.length, 1); assert.equal(current.calls.length, 1);
    assert.equal(current.data(), 'new-filter');
    assert.equal(h.client.getQueryState(old.key).isInvalidated, true);
  } finally { h.dispose(); }
});


