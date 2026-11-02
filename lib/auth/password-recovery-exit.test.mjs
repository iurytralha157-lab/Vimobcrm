import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function load(relative, dependencies = {}) {
  const record = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module: record, exports: record.exports, atob, setTimeout, clearTimeout,
    require: name => dependencies[name] });
  return record.exports;
}
const auth = load('./global-sign-out.ts');
const reliability = load('./frontend-auth-reliability.ts');
const { exitPasswordRecovery } = load('./password-recovery-exit.ts', {
  '@/lib/auth/global-sign-out': auth, '@/lib/auth/frontend-auth-reliability': reliability,
});
const session = (user = 'a', sid = 'sid-a') => ({ user: { id: user },
  access_token: `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid })).toString('base64url')}.synthetic` });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function harness() {
  const lifecycle = { mounted: true, generation: 0, sessionKey: null, userId: null };
  const h = { current: session(), revokes: [], locals: [], clears: 0, redirects: [] };
  auth.trackGlobalSignOutSession(lifecycle, h.current);
  const guard = auth.captureGlobalSignOutGuard(h.current, h.current.user.id, lifecycle);
  h.transition = next => { h.current = next; auth.trackGlobalSignOutSession(lifecycle, next); };
  h.options = { guard, destination: '/login', operations: {
    getSession: () => h.lookup?.promise || Promise.resolve({ data: { session: h.current }, error: null }),
    revokeGlobal: async token => { h.revokes.push(token); await h.revocation?.promise; return { error: null }; },
    clearLocal: async () => { h.locals.push(h.current?.user.id); h.localStarted?.resolve(); if (h.localError) return { error: h.localError }; h.transition(null); return { error: null }; },
  }, effects: { clear: () => h.clears++, navigate: destination => h.redirects.push(destination), wait: () => h.wait?.promise || Promise.resolve() } };
  return { h, lifecycle, guard };
}
for (const replacement of [session('b', 'sid-b'), session('a', 'new-sid-a')]) {
  test(`local exit rejects replacement ${replacement.user.id} before SDK cleanup`, async () => {
    const { h } = harness(); h.lookup = deferred();
    const pending = exitPasswordRecovery(h.options);
    h.transition(replacement); h.lookup.resolve({ data: { session: replacement }, error: null });
    assert.equal(await pending, 'cancelled');
    assert.deepEqual(h.locals, []); assert.equal(h.clears, 0); assert.deepEqual(h.redirects, []);
  });
}
test('unverified global exit cannot clear a replacement while revocation is pending', async () => {
  const { h } = harness(); h.revocation = deferred();
  const pending = exitPasswordRecovery({ ...h.options, revokeGlobal: true });
  await new Promise(setImmediate); assert.equal(h.revokes.length, 1);
  h.transition(session('b', 'sid-b')); h.revocation.resolve();
  assert.equal(await pending, 'cancelled'); assert.deepEqual(h.locals, []); assert.equal(h.clears, 0);
});
test('replacement during success-message wait prevents token cleanup and navigation', async () => {
  const { h } = harness(); h.wait = deferred();
  const pending = exitPasswordRecovery({ ...h.options, messageWaitMs: 1600 });
  await new Promise(setImmediate); assert.deepEqual(h.locals, ['a']);
  h.transition(session('b', 'sid-b')); h.wait.resolve();
  assert.equal(await pending, 'cancelled'); assert.equal(h.clears, 0); assert.deepEqual(h.redirects, []);
});
test('unmount cancels all exit effects even if a prior lookup later resolves', async () => {
  const { h, lifecycle } = harness(); h.lookup = deferred();
  const pending = exitPasswordRecovery(h.options);
  lifecycle.mounted = false; lifecycle.generation++;
  h.lookup.resolve({ data: { session: h.current }, error: null });
  assert.equal(await pending, 'cancelled'); assert.deepEqual(h.locals, []); assert.equal(h.clears, 0);
});
test('failed local cleanup remains on the page for retry and never redirects with an old cookie', async () => {
  const { h } = harness(); h.localError = new Error('synthetic transient failure');
  assert.equal(await exitPasswordRecovery(h.options), 'incomplete');
  assert.equal(h.clears, 0); assert.deepEqual(h.redirects, []);
});
test('original recovery session completes local cleanup and navigates exactly once', async () => {
  const { h } = harness();
  assert.equal(await exitPasswordRecovery(h.options), 'finished');
  assert.deepEqual(h.locals, ['a']); assert.equal(h.clears, 1); assert.deepEqual(h.redirects, ['/login']);
});
test('a timed-out global operation cannot clear B after the guarded local fallback has finished', async () => {
  const { h } = harness(); h.revocation = deferred(); h.localStarted = deferred();
  const pending = exitPasswordRecovery({ ...h.options, revokeGlobal: true });
  await h.localStarted.promise;
  assert.equal(await pending, 'finished'); assert.deepEqual(h.locals, ['a']);
  h.transition(session('b', 'sid-b')); h.revocation.resolve(); await new Promise(setImmediate);
  assert.deepEqual(h.locals, ['a']); assert.equal(h.clears, 1); assert.deepEqual(h.redirects, ['/login']);
});
