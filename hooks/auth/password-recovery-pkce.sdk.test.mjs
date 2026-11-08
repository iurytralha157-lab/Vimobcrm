import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createBrowserClient } from '@supabase/ssr';

// Actual installed SSR/auth-js, with synthetic cookies, HTTP and React lifecycle.
// No real fetch, browser, credentials, email link or provider is used.
const repo = new URL('../../', import.meta.url);
const tick = () => new Promise(setImmediate);
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated',
  role: 'authenticated', email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z' };
let caseId = 0;
function session(method = 'recovery', identity = user, sessionId = '22222222-2222-4222-8222-222222222222') {
  const claims = { sub: identity.id, session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method }] };
  const unsigned = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', 'synthetic-sdk-test-secret').update(unsigned).digest('base64url');
  return { user: identity, access_token: unsigned + '.' + signature,
    refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: claims.exp, token_type: 'bearer' };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cookieValue = value => 'base64-' + Buffer.from(JSON.stringify(value)).toString('base64url');

async function harness({ url = 'https://app.test/reset-password?code=synthetic-code',
  verifier = true, method = 'recovery', storedSession = null, initializeBeforeMount = false,
  fragmentSession = null } = {}) {
  const storageKey = 'sb-synthetic-' + ++caseId + '-auth-token';
  const previous = new Map(['window', 'document', 'BroadcastChannel'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cookies = new Map(), values = new Map(), events = [], requests = [], urlEffects = [];
  if (verifier) cookies.set(storageKey + '-code-verifier', cookieValue('synthetic-verifier/recovery'));
  if (storedSession) cookies.set(storageKey, cookieValue(storedSession));
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key) };
  const document = { visibilityState: 'hidden' };
  const window = { document, location: { href: url, replace: destination => urlEffects.push(destination) },
    history: { state: null, replaceState: (_state, _title, destination) => {
      window.location.href = new URL(destination, window.location.href).href;
      urlEffects.push(new URL(window.location.href).pathname + new URL(window.location.href).search);
    } }, sessionStorage: storage, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
  for (const [key, value] of Object.entries({ window, document, BroadcastChannel: undefined })) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  function load(relative, dependencies = {}) {
    const record = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, repo), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module: record, exports: record.exports, window, URL, URLSearchParams, atob,
      Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout,
      require: name => { assert(name in dependencies, 'Unexpected module ' + name); return dependencies[name]; } });
    return record.exports;
  }
  const recovery = load('lib/auth/password-recovery.ts', { './post-login-redirect': { isProtectedAppPath: () => false } });
  recovery.capturePasswordRecoveryIntent(storage, new URL(url));
  const tokenReply = deferred();
  const client = createBrowserClient('https://synthetic.supabase.co', 'synthetic-public-key', {
    isSingleton: false, cookieOptions: { name: storageKey }, auth: { autoRefreshToken: false },
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
      setAll: items => items.forEach(({ name, value, options }) => {
        if (!value || options?.maxAge === 0) cookies.delete(name); else cookies.set(name, value);
      }),
    },
    global: { fetch: async (input, init) => {
      const parsed = new URL(String(input));
      assert.equal(parsed.origin, 'https://synthetic.supabase.co');
      requests.push({ path: parsed.pathname, grant: parsed.searchParams.get('grant_type'), method: init?.method });
      if (parsed.pathname === '/auth/v1/token' && parsed.searchParams.get('grant_type') === 'pkce') {
        await tokenReply.promise;
        return new Response(JSON.stringify(session(method)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (parsed.pathname === '/auth/v1/verify') {
        await tokenReply.promise;
        return new Response(JSON.stringify(session(method)), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (parsed.pathname === '/auth/v1/user') {
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + fragmentSession.access_token);
        return new Response(JSON.stringify(fragmentSession.user), { status: 200 });
      }
      throw new Error('Network is forbidden: unexpected synthetic request path');
    } },
  });
  client.auth.onAuthStateChange((event, current) => {
    events.push(event);
    if (event === 'PASSWORD_RECOVERY' && current?.user.id) recovery.grantPasswordRecoveryProof(storage, current.user.id);
  });
  if (initializeBeforeMount) {
    tokenReply.resolve();
    await client.auth.initialize();
    await tick();
  }
  const states = [], refs = [], callbacks = [], layouts = [];
  const globalSignOut = load('lib/auth/global-sign-out.ts');
  const reliability = load('lib/auth/frontend-auth-reliability.ts');
  const exit = load('lib/auth/password-recovery-exit.ts', { '@/lib/auth/global-sign-out': globalSignOut,
    '@/lib/auth/frontend-auth-reliability': reliability });
  const hook = load('hooks/auth/use-password-recovery-session.ts', {
    react: {
      useState: initial => { const index = states.length; states.push(initial); return [initial, value => { states[index] = value; }]; },
      useRef: initial => { const ref = { current: initial }; refs.push(ref); return ref; },
      useCallback: callback => callback, useEffect: callback => callbacks.push(callback), useLayoutEffect: callback => layouts.push(callback),
    },
    '@/config/constants': { ROUTES: { LOGIN: '/login', SIGNUP: '/cadastro', RESET_PASSWORD: '/reset-password' } },
    '@/lib/supabase/client': { supabase: client }, '@/lib/api/vimob-client': { setVimobAPIAccessToken() {} },
    '@/lib/auth/global-sign-out': globalSignOut, '@/lib/auth/password-recovery-exit': exit,
    '@/lib/auth/password-recovery': recovery,
  });
  const params = new URL(url).searchParams;
  const result = hook.usePasswordRecoverySession(params);
  const layoutCleanup = layouts.map(callback => callback());
  const effectCleanup = callbacks.map(callback => callback());
  return { client, states, result, events, requests, cookies, storageKey, recovery, storage, urlEffects,
    release: () => tokenReply.resolve(),
    settle: async () => { await client.auth.initialize(); for (let i = 0; i < 4; i++) await tick(); },
    rerunAfterUrlCleanup: () => {
      effectCleanup[0]?.(); params.delete('code');
      effectCleanup[0] = callbacks[0]();
    },
    dispose: async () => {
      layoutCleanup.forEach(cleanup => cleanup?.()); effectCleanup.forEach(cleanup => cleanup?.());
      await client.auth.dispose();
      for (const [key, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
      }
    },
  };
}

test('real SSR PKCE initialization, PASSWORD_RECOVERY and sanitized URL permit the recovery form', async () => {
  const h = await harness();
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'ready');
    assert(h.events.includes('PASSWORD_RECOVERY'));
    assert.equal(h.requests.filter(request => request.grant === 'pkce').length, 1);
    assert.equal(h.cookies.has(h.storageKey + '-code-verifier'), false);
    assert.equal(new URL(globalThis.window.location.href).search, '');
    h.rerunAfterUrlCleanup(); await h.settle();
    assert.equal(h.states[0], 'ready');
    const guard = h.result.captureGuard();
    assert.equal(guard.expectedUserId, user.id);
    assert.equal(guard.expectedSessionId, '22222222-2222-4222-8222-222222222222');
  } finally { await h.dispose(); }
});

test('a PKCE link in another browser without its verifier never exposes a recovery form', async () => {
  const h = await harness({ verifier: false });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.result.captureGuard(), null);
    assert.equal(h.requests.length, 0);
    assert.equal(h.recovery.hasPasswordRecoveryProof(h.storage, user.id), false);
  } finally { await h.dispose(); }
});

test('PKCE already consumed by SSR before hook mount is admitted only through its recovery proof', async () => {
  const h = await harness({ initializeBeforeMount: true });
  try {
    await h.settle();
    assert.equal(new URL(globalThis.window.location.href).search, '');
    assert.equal(h.states[0], 'ready');
    assert.equal(h.recovery.hasPasswordRecoveryProof(h.storage, user.id), true);
    assert.equal(h.requests.filter(request => request.grant === 'pkce').length, 1);
  } finally { await h.dispose(); }
});

test('a PKCE recovery event cannot promote a signed normal OTP session to recovery', async () => {
  const h = await harness({ method: 'otp' });
  try {
    h.release(); await h.settle();
    assert(h.events.includes('PASSWORD_RECOVERY'));
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.result.captureGuard(), null);
  } finally { await h.dispose(); }
});

test('real verifyOtp with normal OTP AMR is rejected even with recovery URL type and SDK event', async () => {
  const h = await harness({ url: 'https://app.test/reset-password?token_hash=synthetic&type=recovery', method: 'otp' });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.result.captureGuard(), null);
    assert(h.events.includes('PASSWORD_RECOVERY'));
    assert.equal(h.requests.filter(request => request.path === '/auth/v1/verify').length, 1);
  } finally { await h.dispose(); }
});

test('a normal OTP cookie plus recovery query cannot become recovery proof', async () => {
  const h = await harness({ url: 'https://app.test/reset-password?type=recovery',
    verifier: false, storedSession: session('otp') });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.result.captureGuard(), null);
    assert.equal(h.recovery.hasPasswordRecoveryProof(h.storage, user.id), false);
    assert.equal(h.requests.length, 0);
  } finally { await h.dispose(); }
});

test('a recovery fragment cannot replace a signed-in account with another normal session', async () => {
  const existing = session('password');
  const otherUser = { ...user, id: '44444444-4444-4444-8444-444444444444', email: 'other@example.invalid' };
  const injected = session('password', otherUser, '55555555-5555-4555-8555-555555555555');
  injected.refresh_token = 'synthetic-other-refresh';
  const hash = new URLSearchParams({ access_token: injected.access_token, refresh_token: injected.refresh_token, type: 'recovery' });
  const h = await harness({ url: 'https://app.test/reset-password#' + hash, verifier: false,
    storedSession: existing, fragmentSession: injected });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.result.captureGuard(), null);
    assert.equal((await h.client.auth.getSession()).data.session?.user.id, existing.user.id);
    assert.equal(h.cookies.get(h.storageKey), cookieValue(existing));
    assert(!h.events.includes('SIGNED_IN'));
    assert.equal(h.requests.length, 0);
    assert.equal(new URL(globalThis.window.location.href).hash, '');
  } finally { await h.dispose(); }
});
