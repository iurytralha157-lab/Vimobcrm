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


function webPushHookHarness({ existing = false, syncResult, saveError, readyTimeout = false } = {}) {
  const effects = [];
  const calls = [];
  const values = new Map();
  const notification = { permission: existing ? 'granted' : 'default' };
  const vapidBytes = new Uint8Array(65);
  vapidBytes[0] = 4;
  const publicKey = Buffer.from(vapidBytes).toString('base64url');
  let browserSubscription = null;
  let userActivation = false;
  let state;

  const subscription = {
    endpoint: 'https://push.example.test/device',
    options: { applicationServerKey: vapidBytes.buffer },
    toJSON: () => ({
      endpoint: 'https://push.example.test/device',
      keys: { p256dh: 'synthetic', auth: 'synthetic' },
    }),
    unsubscribe: async () => {
      calls.push('unsubscribe');
      browserSubscription = null;
      return true;
    },
  };
  if (existing) browserSubscription = subscription;

  const registration = {
    scope: 'https://app.example.test/',
    active: { scriptURL: 'https://app.example.test/sw.js' },
    update: async () => undefined,
    pushManager: {
      getSubscription: async () => browserSubscription,
      subscribe: ({ applicationServerKey, userVisibleOnly }) => {
        assert.equal(userActivation, true, 'PushManager.subscribe must run before the tap handler returns');
        assert.equal(userVisibleOnly, true);
        assert.equal(Buffer.from(new Uint8Array(applicationServerKey)).toString('base64url'), publicKey);
        calls.push('subscribe');
        notification.permission = 'granted';
        browserSubscription = subscription;
        return Promise.resolve(subscription);
      },
    },
  };
  const settings = {
    getPushConfig: async () => {
      calls.push('load-config');
      return { enabled: true, publicKey };
    },
    savePushToken: async (input, organizationId, options) => {
      assert.equal(organizationId, 'org-a');
      assert.equal(options.expectedUserId, 'user-a');
      assert.equal(options.expectedSessionId, 'session-a');
      calls.push(input.syncOnly ? 'sync' : 'save');
      if (input.syncOnly && saveError) throw new Error('temporary failure');
      return input.syncOnly && syncResult ? syncResult : { ok: true, active: true };
    },
  };
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  };
  const window = {
    PushManager: class {},
    Notification: notification,
    atob,
    btoa,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
  };
  const navigator = {
    serviceWorker: {
      getRegistration: async () => registration,
      ready: readyTimeout ? new Promise(() => {}) : Promise.resolve(registration),
    },
    userAgent: 'Synthetic iOS Home Screen',
  };
  const captureIntent = () => ({
    userId: 'user-a', organizationId: 'org-a', sessionId: 'session-a',
    signal: new AbortController().signal,
    isCurrent: () => true, assertCurrent() {}, finish() {}, cancel() {},
  });
  const { useWebPush } = compile('hooks/use-web-push.ts', {
    react: {
      useState: initial => {
        state = initial;
        return [state, next => { state = typeof next === 'function' ? next(state) : next; }];
      },
      useEffect: effect => effects.push(effect),
      useCallback: callback => callback,
      useRef: current => ({ current }),
    },
    '@/contexts/AuthContext': { useAuth: () => ({ user: { id: 'user-a' }, activeOrganization: { organizationId: 'org-a' } }) },
    '@/lib/api/settings': { settingsAPI: settings },
    '@/lib/pwa/push-session': { rememberCurrentPushEndpoint() {}, forgetCurrentPushEndpoint() {} },
    '@tanstack/react-query': { useQueryClient: () => ({ invalidateQueries: async () => undefined }) },
    '@/hooks/use-push-device-intent': { usePushDeviceIntent: () => captureIntent },
  }, {
    window, navigator, Notification: notification, localStorage: storage, queueMicrotask,
    CustomEvent: class { constructor(type, { detail }) { this.type = type; this.detail = detail; } },
    setTimeout: readyTimeout ? (callback, delay) => {
      assert.equal(delay, 8000);
      return setTimeout(callback, 1);
    } : setTimeout,
  });

  const hook = useWebPush();
  effects.forEach(effect => effect());
  return {
    calls,
    state: () => state,
    async ready() {
      for (let i = 0; i < 50 && !state.isReady; i++) {
        await new Promise(resolve => setTimeout(resolve, 1));
      }
      assert.equal(state.isReady, true);
    },
    tap() {
      userActivation = true;
      try { return hook.subscribe(); }
      finally { userActivation = false; }
    },
  };
}

test('iOS Home Screen activation subscribes inside the tap and confirms backend registration', async () => {
  const h = webPushHookHarness();
  await h.ready();
  assert.deepEqual(h.calls, ['load-config']);
  const pending = h.tap();
  assert.deepEqual(h.calls, ['load-config', 'subscribe']);
  assert.equal((await pending).ok, true);
  assert.equal(h.state().isSubscribed, true);
  assert.deepEqual(h.calls, ['load-config', 'subscribe', 'save']);
});

for (const failure of [{ syncResult: { ok: true, active: false } }, { saveError: true }]) {
  const reason = failure.saveError ? 'sync failure' : 'inactive API reply';
  test('browser subscription alone is inactive after ' + reason, async () => {
    const h = webPushHookHarness({ existing: true, ...failure });
    await h.ready();
    assert.equal(h.state().isSubscribed, false);
    assert.ok(h.state().error);
    assert.deepEqual(h.calls, ['load-config', 'sync']);
    assert.equal((await h.tap()).ok, true);
    assert.equal(h.state().isSubscribed, true);
    assert.deepEqual(h.calls, ['load-config', 'sync', 'subscribe', 'save']);
  });
}

test('an expired server subscription is replaced only by a new tap', async () => {
  const h = webPushHookHarness({ existing: true, syncResult: { ok: true, active: false, requiresResubscribe: true } });
  await h.ready();
  assert.equal(h.state().isSubscribed, false);
  assert.deepEqual(h.calls, ['load-config', 'sync', 'unsubscribe']);
  assert.equal((await h.tap()).ok, true);
  assert.deepEqual(h.calls, ['load-config', 'sync', 'unsubscribe', 'subscribe', 'save']);
});

test('a service worker that never activates exits preparation without requesting permission', async () => {
  const h = webPushHookHarness({ readyTimeout: true });
  await h.ready();
  assert.equal(h.state().isSubscribed, false);
  assert.equal(h.state().configurationStatus, 'unavailable');
  assert.equal((await h.tap()).ok, false);
  assert.deepEqual(h.calls, []);
});
