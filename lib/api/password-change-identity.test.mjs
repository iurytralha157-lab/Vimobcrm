import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const repo = new URL('../../', import.meta.url);
const read = relative => readFileSync(new URL(relative, repo), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const auth = { exports: {} };
vm.runInNewContext(compile(read('lib/auth/global-sign-out.ts')), { atob, module: auth, exports: auth.exports });
const jwt = (user, sid, version = 1) => `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, version })).toString('base64url')}.synthetic`;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
function harness() {
  const source = read('lib/api/vimob-client.test.mjs');
  const start = source.indexOf('function loadVimobClient('), end = source.indexOf('\n}\n', start) + 3;
  class APIError extends Error { constructor(message, options) { super(message); Object.assign(this, options); } }
  const load = new Function('ts', 'readFileSync', 'clientSourcePath', 'globalSignOutModule', 'TestVimobAPIError', 'vm',
    `return (${source.slice(start, end)})`)(ts, readFileSync, new URL('lib/api/vimob-client.ts', repo), auth, APIError, vm);
  const refresh = deferred(), started = deferred();
  const { client, fetchCalls } = load({ getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: () => { started.resolve(); return refresh.promise; }, isPasswordRecoveryAccessToken: () => true,
    fetchResponse: (_url, _init, call) => new Response(JSON.stringify({ allowed: true, message: 'synthetic', sessionsRevoked: true }), { status: call === 1 ? 401 : 200 }),
  });
  const settings = { exports: {} };
  vm.runInNewContext(compile(read('lib/api/settings.ts')), { module: settings, exports: settings.exports, FormData, Blob,
    require: name => {
      if (name === './vimob-client') return client;
      if (name === '@/lib/validation') return { parseDomainInput: (_schema, input) => input, validateDomainResponse: () => {} };
      throw new Error('Unexpected import');
    },
  });
  client.setVimobAPIAccessToken(jwt('a', 'sid-a'), 'a');
  return { client, fetchCalls, refresh, started, settings: settings.exports.settingsAPI };
}
for (const [user, sid] of [['b', 'sid-b'], ['a', 'new-sid-a']]) {
  test(`actual password API cannot replay the recovery POST as ${user}/${sid}`, async () => {
    const h = harness();
    const pending = h.settings.changePassword({ password: 'Synthetic-password1!', source: 'recovery' }, null,
      { expectedUserId: 'a', expectedSessionId: 'sid-a' });
    await h.started.promise;
    h.client.setVimobAPIAccessToken(jwt(user, sid), user);
    h.refresh.resolve({ data: { session: { user: { id: 'a' }, access_token: jwt('a', 'sid-a', 2) } }, error: null });
    await assert.rejects(pending, error => error.code === 'api_request_identity_changed');
    assert.equal(h.fetchCalls.length, 1);
  });
  test(`settings callers without explicit intent are also pinned before replacement ${user}/${sid}`, async () => {
    const h = harness();
    const pending = h.settings.changePassword({ password: 'Synthetic-password1!', source: 'settings' });
    await h.started.promise;
    h.client.setVimobAPIAccessToken(jwt(user, sid), user);
    h.refresh.resolve({ data: { session: { user: { id: 'a' }, access_token: jwt('a', 'sid-a', 2) } }, error: null });
    await assert.rejects(pending, error => error.code === 'api_request_identity_changed');
    assert.equal(h.fetchCalls.length, 1);
  });
}
test('the password API permits a token refresh belonging to the same recovery session', async () => {
  const h = harness();
  const pending = h.settings.changePassword({ password: 'Synthetic-password1!', source: 'recovery' }, null,
    { expectedUserId: 'a', expectedSessionId: 'sid-a' });
  await h.started.promise;
  h.refresh.resolve({ data: { session: { user: { id: 'a' }, access_token: jwt('a', 'sid-a', 2) } }, error: null });
  assert.equal((await pending).sessionsRevoked, true); assert.equal(h.fetchCalls.length, 2);
});
test('an explicitly absent expected identity is not replaced by the default current user', async () => {
  const h = harness();
  await assert.rejects(h.settings.changePassword({ password: 'Synthetic-password1!', source: 'recovery' }, null,
    { expectedUserId: null, expectedSessionId: 'sid-a' }), error => error.code === 'api_request_identity_changed');
  assert.equal(h.fetchCalls.length, 0);
});
