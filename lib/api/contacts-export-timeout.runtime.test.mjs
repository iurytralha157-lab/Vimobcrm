import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
// The optional override also supports the existing local dependency junction:
// CI uses its normal npm-ci installation of the declared patched Zod package.
const zod = require(process.env.VIMOB_TEST_ZOD4_PACKAGE || 'zod');
const organizationId = '11111111-1111-4111-8111-111111111111';
const tagId = '22222222-2222-4222-8222-222222222222';
const contact = {
  id: '33333333-3333-4333-8333-333333333333',
  name: 'Synthetic export contact',
  created_at: '2026-10-27T12:00:00Z',
  updated_at: '2026-10-27T12:00:00Z',
  tags: [],
  total_count: 1,
  metadata_json: '{"source":"synthetic"}',
};

async function flushPromises() {
  for (let turn = 0; turn < 25; turn += 1) await Promise.resolve();
}

function createClock() {
  let now = 0;
  let nextId = 0;
  const timers = new Map();
  return {
    get now() { return now; },
    get pending() { return timers.size; },
    setTimeout(callback, delay = 0) {
      const id = ++nextId;
      timers.set(id, { due: now + delay, callback });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    async advanceTo(target) {
      assert.ok(target >= now);
      await flushPromises();
      while (true) {
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort(([a, left], [b, right]) => left.due - right.due || a - b)[0];
        if (!next) break;
        const [id, timer] = next;
        timers.delete(id);
        now = timer.due;
        timer.callback();
        await flushPromises();
      }
      now = target;
      await flushPromises();
    },
  };
}

function observe(promise) {
  const state = { status: 'pending', value: undefined, error: undefined };
  promise.then(
    (value) => { state.status = 'fulfilled'; state.value = value; },
    (error) => { state.status = 'rejected'; state.error = error; },
  );
  return state;
}

function createRuntime({ bodyDelay = 18_000, envelope = { data: [contact] } } = {}) {
  const clock = createClock();
  const requests = [];
  const modules = new Map();
  const scope = vm.createContext({
    AbortController, DOMException, Error, FormData, Headers, JSON, TextDecoder,
    URL, URLSearchParams, Uint8Array, atob, Date,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://api.fixture.invalid' } },
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    fetch(url, options) {
      assert.equal(new URL(url).pathname, '/v1/contacts');
      const request = { url, options, startedAt: clock.now, headersAt: null, abortedAt: null };
      requests.push(request);
      // Actual incident shape: HTTP 200 headers arrive quickly; consuming the
      // response body still needs more than the normal twelve-second deadline.
      return new Promise((resolveHeaders, rejectHeaders) => {
        let bodyTimer;
        let rejectBody;
        const abort = () => {
          request.abortedAt = clock.now;
          clock.clearTimeout(headerTimer);
          clock.clearTimeout(bodyTimer);
          const error = new DOMException('Synthetic response aborted', 'AbortError');
          if (rejectBody) rejectBody(error);
          else rejectHeaders(error);
          options.signal.removeEventListener('abort', abort);
        };
        const headerTimer = clock.setTimeout(() => {
          request.headersAt = clock.now;
          resolveHeaders({
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'application/json' }),
            text() {
              return new Promise((resolveBody, reject) => {
                rejectBody = reject;
                bodyTimer = clock.setTimeout(() => {
                  options.signal.removeEventListener('abort', abort);
                  resolveBody(JSON.stringify(envelope));
                }, bodyDelay);
              });
            },
          });
        }, 780);
        options.signal.addEventListener('abort', abort, { once: true });
      });
    },
  });

  function load(relativePath) {
    const filename = resolve(root, relativePath);
    if (modules.has(filename)) return modules.get(filename).exports;
    const loadedModule = { exports: {} };
    modules.set(filename, loadedModule);
    const source = readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      fileName: filename,
    }).outputText;
    const requireSource = (specifier) => {
      if (specifier === 'zod') return zod;
      if (specifier === '@/lib/supabase/client') {
        return { supabase: {} };
      }
      if (specifier === '@/lib/validation') {
        // These are the real schemas consumed by contactsAPI, without loading
        // unrelated domain schemas or any application providers.
        return { ...load('lib/validation/common.ts'), ...load('lib/validation/crm-support.ts') };
      }
      if (specifier.startsWith('@/')) return load(`${specifier.slice(2)}.ts`);
      if (specifier.startsWith('.')) return load(resolve(dirname(filename), `${specifier}.ts`));
      throw new Error(`Unexpected runtime dependency: ${specifier}`);
    };
    const wrapper = vm.runInContext(`(function(exports, require, module) { ${compiled}\n })`, scope);
    wrapper(loadedModule.exports, requireSource, loadedModule);
    return loadedModule.exports;
  }

  // Only authentication and the network are synthetic boundaries. contactsAPI,
  // schemas, timeout, body consumption, retry and cleanup execute real source.
  const transport = load('lib/api/vimob-client.ts');
  transport.setVimobAPIAccessToken('synthetic-test-session', 'synthetic-user');
  return { clock, requests, contactsAPI: load('lib/api/contacts.ts').contactsAPI };
}

test('export consumes a slow legacy HTTP 200 body past 12s without retrying', async () => {
  const { clock, requests, contactsAPI } = createRuntime();
  const operation = observe(contactsAPI.list({ mode: 'export', page: 1, limit: 500, tagIds: [tagId] }, organizationId));
  await clock.advanceTo(12_001);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headersAt, 780);
  assert.equal(requests[0].options.signal.aborted, false);
  assert.equal(operation.status, 'pending');
  await clock.advanceTo(18_780);
  assert.equal(operation.status, 'fulfilled');
  assert.deepEqual(operation.value, [contact]);
  assert.equal(requests.length, 1);
  const url = new URL(requests[0].url);
  assert.equal(url.origin, 'https://api.fixture.invalid');
  assert.deepEqual(Object.fromEntries(url.searchParams), { mode: 'export', page: '1', limit: '500', tagIds: tagId });
  assert.equal(requests[0].options.headers.get('X-Organization-ID'), organizationId);
  assert.equal(clock.pending, 0);
  await clock.advanceTo(60_001);
  assert.equal(requests[0].options.signal.aborted, false);
});

test('compact and default list retain their 12s body deadline and existing retries', async () => {
  for (const filters of [{}, { mode: 'compact' }]) {
    const { clock, requests, contactsAPI } = createRuntime();
    const operation = observe(contactsAPI.list(filters, organizationId));
    await clock.advanceTo(12_001);
    assert.equal(requests[0].abortedAt, 12_000);
    assert.equal(operation.status, 'pending');
    await clock.advanceTo(38_001);
    assert.equal(operation.status, 'rejected');
    assert.equal(operation.error.code, 'api_timeout');
    assert.deepEqual(requests.map((request) => request.startedAt), [0, 12_500, 26_000]);
    assert.deepEqual(requests.map((request) => request.abortedAt), [12_000, 24_500, 38_000]);
    assert.equal(clock.pending, 0);
  }
});

test('export remains bounded at 60s per attempt and retains the retry policy', async () => {
  const { clock, requests, contactsAPI } = createRuntime({ bodyDelay: 90_000 });
  const operation = observe(contactsAPI.list({ mode: 'export' }, organizationId));
  await clock.advanceTo(59_999);
  assert.equal(requests[0].options.signal.aborted, false);
  await clock.advanceTo(60_001);
  assert.equal(requests[0].abortedAt, 60_000);
  await clock.advanceTo(182_001);
  assert.equal(operation.status, 'rejected');
  assert.equal(operation.error.code, 'api_timeout');
  assert.deepEqual(requests.map((request) => request.startedAt), [0, 60_500, 122_000]);
  assert.deepEqual(requests.map((request) => request.abortedAt), [60_000, 120_500, 182_000]);
  assert.equal(clock.pending, 0);
});

test('external cancellation aborts the export body immediately without retry', async () => {
  const { clock, requests, contactsAPI } = createRuntime();
  const controller = new AbortController();
  const operation = observe(contactsAPI.list({ mode: 'export' }, organizationId, { signal: controller.signal }));
  await clock.advanceTo(2_000);
  controller.abort(new DOMException('Synthetic user cancellation', 'AbortError'));
  await flushPromises();
  assert.equal(operation.status, 'rejected');
  assert.equal(operation.error.name, 'AbortError');
  assert.equal(operation.error.message, 'Synthetic user cancellation');
  assert.equal(requests[0].abortedAt, 2_000);
  assert.equal(requests.length, 1);
  assert.equal(clock.pending, 0);
  await clock.advanceTo(60_001);
  assert.equal(requests.length, 1);
});

test('input and legacy response validation still run through the actual contacts schemas', async () => {
  const invalidInput = createRuntime();
  await assert.rejects(invalidInput.contactsAPI.list({ mode: 'export', limit: 501 }, organizationId), { code: 'domain_validation_error' });
  assert.equal(invalidInput.requests.length, 0);
  const invalidResponse = createRuntime({ bodyDelay: 1, envelope: { data: [{ ...contact, total_count: -1 }] } });
  const operation = observe(invalidResponse.contactsAPI.list({ mode: 'export' }, organizationId));
  await invalidResponse.clock.advanceTo(781);
  assert.equal(operation.status, 'rejected');
  assert.equal(operation.error.code, 'domain_validation_error');
  assert.equal(invalidResponse.requests.length, 1);
  assert.equal(invalidResponse.clock.pending, 0);
});
