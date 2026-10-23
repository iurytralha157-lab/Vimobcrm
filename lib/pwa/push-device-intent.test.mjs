import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const repository = new URL('../../', import.meta.url);
const finalBaseline = process.env.VIMOB_FINAL_PUSH_BASELINE ? new URL('file:///D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/baseline/') : null;
const sourceRoot = finalBaseline || (process.env.VIMOB_PUSH_DEVICE_BASELINE ? new URL('file:///D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/baseline/') : repository);
const token = (user='user-a',sid='session-a',version=1) => `e30.${Buffer.from(JSON.stringify({sub:user,session_id:sid,iat:version})).toString('base64url')}.synthetic`;
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function compile(path, imports, globals = {}, original = false) {
  const moduleRecord = { exports: {} };
  const candidate = new URL(path, finalBaseline || (original ? repository : sourceRoot));
  const source = readFileSync(existsSync(candidate) ? candidate : new URL(path,repository), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: moduleRecord.exports, module: moduleRecord, require: name => {
      if (!(name in imports)) throw new Error(`Unexpected import ${name}`);
      return imports[name];
    }, AbortController, DOMException, URL, Promise, atob, setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {} }, ...globals });
  return moduleRecord.exports;
}
function pipeline({ refresh = false } = {}) {
  const auth = deferred();
  const started = deferred();
  const calls = [];
  class APIError extends Error { constructor(message, options) { super(message); Object.assign(this, options); } }
  const client = compile('lib/api/vimob-client.ts', {
    '@/lib/auth/global-sign-out': compile('lib/auth/global-sign-out.ts', {}, {}, true),
    '@/lib/supabase/client': { supabase: { auth: {
      getSession: () => { started.resolve(); return auth.promise; },
      refreshSession: () => { started.resolve(); return auth.promise; },
    } } },
    '@/lib/api/vimob-error': { VimobAPIError: APIError, getTechnicalErrorMessage: error => error.message },
    '@/lib/auth/password-recovery': { isPasswordRecoveryAccessToken: () => false },
    '@/lib/local-read-only': { shouldBlockLocalMutation: () => false },
    '@/lib/utils/json': { parseJSONOrNull: value => { try { return JSON.parse(value); } catch { return null; } } },
  }, { Headers, Response, FormData, Request,
    process: { env: { NODE_ENV: 'production', NEXT_PUBLIC_VIMOB_API_URL: 'https://api.example.test' } },
    fetch: async (url, options) => {
      if (!String(url).includes('/push-tokens')) return new Response('{}', { status: 200 });
      calls.push({ url, actor: new Headers(options.headers).get('Authorization') });
      return new Response('{"ok":true,"active":true}', { status: refresh && calls.length === 1 ? 401 : 200 });
    },
  }, true);
  const settings = compile('lib/api/settings.ts', {
    './vimob-client': client,
    '@/lib/validation': { parseDomainInput: (_schema, input) => input, validateDomainResponse: (_schema, input) => input },
  }).settingsAPI;
  return { client, settings, auth, started, calls };
}

for (const method of ['save', 'deactivate']) {
  test(`${method} pins its actor before auth resolution and cannot mutate with a later login`, async () => {
    const h = pipeline();
    const endpoint = 'native:android:synthetic-device';
    const pending = method === 'save' ? h.settings.savePushToken({ endpoint }, 'org-a', { expectedUserId: 'user-a' })
      : h.settings.deactivatePushToken(endpoint, 'org-a', { expectedUserId: 'user-a' });
    const outcome = pending.then(() => null, error => error);
    await h.started.promise;
    h.client.setVimobAPIAccessToken(token('user-b','session-b'), 'user-b');
    h.auth.resolve({ data: { session: { access_token: token(), user: { id: 'user-a' } } }, error: null });
    assert.equal((await outcome)?.code, 'api_request_identity_changed');
    assert.equal(h.calls.length, 0);
  });
}
test('device save cannot repeat its POST as another actor after a401 refresh', async () => {
  const h = pipeline({ refresh: true });
  h.client.setVimobAPIAccessToken(token(), 'user-a');
  const pending = h.settings.savePushToken({ endpoint: 'native:android:synthetic-device' }, 'org-a');
  const outcome = pending.then(() => null, error => error);
  await h.started.promise;
  h.client.setVimobAPIAccessToken(token('user-b','session-b'), 'user-b');
  h.auth.resolve({ data: { session: { access_token: token('user-a','session-a',2), user: { id: 'user-a' } } }, error: null });
  assert.equal((await outcome)?.code, 'api_request_identity_changed');
  assert.deepEqual(h.calls.map(call => call.actor), [`Bearer ${token()}`]);
});
test('a token renewal for the same actor preserves an explicit device registration', async () => {
  const h = pipeline({ refresh: true });
  h.client.setVimobAPIAccessToken(token(), 'user-a');
  const pending = h.settings.savePushToken({ endpoint: 'native:android:synthetic-device' }, 'org-a');
  await h.started.promise;
  h.auth.resolve({ data: { session: { access_token: token('user-a','session-a',2), user: { id: 'user-a' } } }, error: null });
  assert.equal((await pending).ok, true);
  assert.deepEqual(h.calls.map(call => call.actor), [`Bearer ${token()}`, `Bearer ${token('user-a','session-a',2)}`]);
});
test('device auth preparation aborts without starting HTTP', async () => {
  const h = pipeline();
  const controller = new AbortController();
  const pending = h.settings.deactivatePushToken('native:android:synthetic-device', 'org-a', { expectedUserId: 'user-a', signal: controller.signal });
  const outcome = pending.then(() => null, error => error);
  await h.started.promise;
  controller.abort();
  let settledError;
  void outcome.then(error => { settledError = error; });
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(settledError?.name, 'AbortError');
    assert.equal(h.calls.length, 0);
  } finally {
    h.auth.resolve({ data: { session: null }, error: null });
    await outcome;
  }
});

function cleanup() {
  let actor = 'user-a';
  let sessionId = 'session-a';
  const storage = new Map();
  const mirror = deferred();
  const deactivation = deferred();
  const calls = [];
  let unsubscribes = 0;
  const subscription = { endpoint: 'https://push.example.test/synthetic', unsubscribe: async () => { unsubscribes++; return true; } };
  const session = compile('lib/pwa/push-session.ts', {
    '@/lib/api/settings': { settingsAPI: { deactivatePushToken: (...args) => { calls.push(args); return deactivation.promise; } } },
    '@/lib/api/vimob-client': { getVimobAPIAccessTokenUserId: () => actor, getVimobAPIAccessTokenSessionId: () => sessionId },
  }, { window: {}, sessionStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    navigator: { serviceWorker: { getRegistration: () => mirror.promise } } });
  session.rememberCurrentPushEndpoint(subscription.endpoint);
  return { session, mirror, deactivation, calls, storage, subscription, setActor: value => { actor = value; }, setSessionId: value=>{sessionId=value;}, unsubscribes: () => unsubscribes };
}

for(const method of ['save','deactivate'])test(`${method} rejects a new SID for the same actor while auth is pending`,async()=>{
  const h=pipeline(),opts={expectedUserId:'user-a',expectedSessionId:'session-a'};
  const pending=method==='save'?h.settings.savePushToken({endpoint:'native:android:synthetic-device'},'org-a',opts):h.settings.deactivatePushToken('native:android:synthetic-device','org-a',opts);
  const outcome=pending.then(()=>null,error=>error);await h.started.promise;
  h.client.setVimobAPIAccessToken(token('user-a','new-session-a'),'user-a');
  h.auth.resolve({data:{session:{access_token:token(),user:{id:'user-a'}}},error:null});
  assert.equal((await outcome)?.code,'api_request_identity_changed');assert.equal(h.calls.length,0);
});
test('401 device refresh cannot repeat HTTP with a same-user new SID',async()=>{
  const h=pipeline({refresh:true});h.client.setVimobAPIAccessToken(token(),'user-a');
  const pending=h.settings.savePushToken({endpoint:'native:android:synthetic-device'},'org-a');const outcome=pending.then(()=>null,error=>error);
  await h.started.promise;h.client.setVimobAPIAccessToken(token('user-a','new-session-a'),'user-a');
  h.auth.resolve({data:{session:{access_token:token('user-a','new-session-a'),user:{id:'user-a'}}},error:null});
  assert.equal((await outcome)?.code,'api_request_identity_changed');assert.equal(h.calls.length,1);
});
test('generic requests without expected SID preserve their legacy same-user refresh behavior',async()=>{
  const h=pipeline({refresh:true});h.client.setVimobAPIAccessToken(token(),'user-a');
  const pending=h.client.vimobAPIRequest('/v1/settings/push-tokens',{method:'POST',expectedUserId:'user-a'});
  await h.started.promise;h.client.setVimobAPIAccessToken(token('user-a','new-session-a'),'user-a');
  h.auth.resolve({data:{session:{access_token:token('user-a','new-session-a'),user:{id:'user-a'}}},error:null});
  assert.equal((await pending).ok,true);assert.equal(h.calls.length,2);
});
test('logout helper cannot deactivate the same actor new SID during mirror lookup',async()=>{
  const h=cleanup();const pending=h.session.deactivateCurrentPushEndpoint('org-a');h.setSessionId('new-session-a');
  h.deactivation.resolve();h.mirror.resolve({pushManager:{getSubscription:async()=>h.subscription}});await pending;
  assert.equal(h.calls.length,0);assert.equal(h.unsubscribes(),0);assert.equal(h.storage.size,1);
});
test('logout mirror lookup cannot deactivate or unsubscribe the new login binding', async () => {
  const h = cleanup();
  const pending = h.session.deactivateCurrentPushEndpoint('org-a');
  h.setActor('user-b');
  h.session.rememberCurrentPushEndpoint(h.subscription.endpoint);
  h.deactivation.resolve();
  h.mirror.resolve({ pushManager: { getSubscription: async () => h.subscription } });
  await pending;
  assert.equal(h.calls.length, 0);
  assert.equal(h.unsubscribes(), 0);
  assert.equal([...h.storage.values()][0], h.subscription.endpoint);
});
test('A-B-A or same endpoint re-registration cannot revive cleanup from the earlier binding', async () => {
  const h = cleanup();
  const pending = h.session.deactivateCurrentPushEndpoint('org-a');
  h.session.rememberCurrentPushEndpoint(h.subscription.endpoint);
  h.deactivation.resolve();
  h.mirror.resolve({ pushManager: { getSubscription: async () => h.subscription } });
  await pending;
  assert.equal(h.calls.length, 0);
  assert.equal(h.unsubscribes(), 0);
  assert.equal([...h.storage.values()][0], h.subscription.endpoint);
});
test('a delayed server completion cannot forget or unsubscribe a newer endpoint binding', async () => {
  const h = cleanup();
  const pending = h.session.deactivateCurrentPushEndpoint('org-a');
  h.mirror.resolve({ pushManager: { getSubscription: async () => h.subscription } });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.length, 1);
  h.session.rememberCurrentPushEndpoint(h.subscription.endpoint);
  h.deactivation.resolve();
  await pending;
  assert.equal(h.calls[0][2]?.expectedUserId, 'user-a');
  assert.equal(h.unsubscribes(), 0);
  assert.equal([...h.storage.values()][0], h.subscription.endpoint);
});
test('current logout pins the request, removes its browser subscription and forgets its own binding', async () => {
  const h = cleanup();
  const pending = h.session.deactivateCurrentPushEndpoint('org-a');
  h.deactivation.resolve();
  h.mirror.resolve({ pushManager: { getSubscription: async () => h.subscription } });
  await pending;
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0][2]?.expectedUserId, 'user-a');
  assert.equal(h.unsubscribes(), 1);
  assert.equal(h.storage.size, 0);
});
