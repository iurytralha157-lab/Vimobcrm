import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createBrowserClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';

// Actual installed SSR/auth-js, with synthetic cookies, HTTP and React lifecycle.
// No real fetch, browser, credentials, email link or provider is used.
const repo = new URL('../../', import.meta.url);
const tick = () => new Promise(setImmediate);
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated',
  role: 'authenticated', email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {},
  created_at: '2026-01-01T00:00:00Z' };
let caseId = 0;
function session(method = 'recovery', identity = user, sessionId = '22222222-2222-4222-8222-222222222222', expiresIn = 3600) {
  const claims = { sub: identity.id, session_id: sessionId,
    exp: Math.floor(Date.now() / 1000) + expiresIn, amr: [{ method }] };
  const unsigned = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signature = createHmac('sha256', 'synthetic-sdk-test-secret').update(unsigned).digest('base64url');
  return { user: identity, access_token: unsigned + '.' + signature,
    refresh_token: 'synthetic-refresh', expires_in: expiresIn, expires_at: claims.exp, token_type: 'bearer' };
}
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const cookieValue = value => 'base64-' + Buffer.from(JSON.stringify(value)).toString('base64url');

async function harness({ url = 'https://app.test/reset-password?code=synthetic-code',
  verifier = true, method = 'recovery', storedSession = null, initializeBeforeMount = false,
  fragmentSession = null, renewedFragment = null } = {}) {
  const storageKey = 'sb-synthetic-' + ++caseId + '-auth-token';
  const previous = new Map(['window', 'document', 'BroadcastChannel'].map(key =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const cookies = new Map(), values = new Map(), events = [], requests = [], urlEffects = [];
  const signedInTokens = [];
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
      Uint8Array, TextDecoder, AbortController, DOMException, Request, Response, crypto, setTimeout, clearTimeout,
      fetch: (...args) => fetcher(...args), process: { env: {
        NEXT_PUBLIC_SUPABASE_URL: 'https://synthetic.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-public-key',
      } },
      require: name => { assert(name in dependencies, 'Unexpected module ' + name); return dependencies[name]; } });
    return record.exports;
  }
  const recovery = load('lib/auth/password-recovery.ts', { './post-login-redirect': { isProtectedAppPath: () => false } });
  const tokenReply = deferred();
  const json = (data, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { 'content-type': 'application/json' },
  });
  const fetcher = async (input, init) => {
    const parsed = new URL(String(input));
    assert.equal(parsed.origin, 'https://synthetic.supabase.co');
    const grant = parsed.searchParams.get('grant_type');
    requests.push({ path: parsed.pathname, grant, method: init?.method });
    if ((parsed.pathname === '/auth/v1/token' && grant === 'pkce') || parsed.pathname === '/auth/v1/verify') {
      await tokenReply.promise;
      return json(session(method));
    }
    if (parsed.pathname === '/auth/v1/user') {
      const bearer = new Headers(init.headers).get('authorization');
      const verified = [fragmentSession, renewedFragment].find(candidate =>
        candidate && bearer === 'Bearer ' + candidate.access_token);
      return verified ? json(verified.user) : json({ code: 'bad_jwt', message: 'Invalid synthetic JWT' }, 401);
    }
    if (parsed.pathname === '/auth/v1/token' && grant === 'refresh_token') {
      await tokenReply.promise;
      assert.equal(JSON.parse(init.body).refresh_token, fragmentSession.refresh_token);
      assert(renewedFragment, 'Only an explicit fixture can refresh an implicit recovery session');
      return json(renewedFragment);
    }
    throw new Error('Network is forbidden: unexpected synthetic request path');
  };
  const clientModule = load('lib/supabase/client.ts', {
    '@supabase/ssr': { createBrowserClient: (url, key, options) => createBrowserClient(url, key, {
      ...options, isSingleton: false, cookieOptions: { name: storageKey },
      auth: { ...options.auth, autoRefreshToken: false },
      cookies: {
        getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
        setAll: items => items.forEach(({ name, value, options }) => {
          if (!value || options?.maxAge === 0) cookies.delete(name); else cookies.set(name, value);
        }),
      },
    }) },
    '@supabase/supabase-js': { createClient },
    '@/lib/auth/password-recovery': recovery,
    '@/lib/auth/password-recovery-transport': load('lib/auth/password-recovery-transport.ts'),
    '@/lib/local-read-only': { shouldBlockLocalMutation: () => false },
  });
  const client = clientModule.supabase;
  client.auth.onAuthStateChange((event, current) => {
    events.push(event);
    if (event === 'SIGNED_IN') signedInTokens.push(current?.access_token);
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
    '@/lib/supabase/client': clientModule, '@/lib/api/vimob-client': { setVimobAPIAccessToken() {} },
    '@/lib/auth/global-sign-out': globalSignOut, '@/lib/auth/password-recovery-exit': exit,
    '@/lib/auth/password-recovery': recovery,
  });
  const params = new URL(url).searchParams;
  const result = hook.usePasswordRecoverySession(params);
  const layoutCleanup = layouts.map(callback => callback());
  const effectCleanup = callbacks.map(callback => callback());
  return { client, states, result, events, requests, cookies, storageKey, recovery, storage, urlEffects, signedInTokens,
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
    // Startup may re-emit the existing session. The fragment must never emit a new one.
    assert.deepEqual(h.signedInTokens, [existing.access_token]);
    assert.equal(h.requests.length, 0);
    assert.equal(new URL(globalThis.window.location.href).hash, '');
  } finally { await h.dispose(); }
});

function fragmentUrl(value) {
  return 'https://app.test/reset-password#' + new URLSearchParams({
    access_token: value.access_token, refresh_token: value.refresh_token, type: 'recovery',
  });
}

test('a valid administrative recovery fragment installs only the verified renewed pair', async () => {
  const original = session();
  const renewed = { ...session('recovery', user, undefined, 3660), refresh_token: 'renewed-recovery-refresh' };
  const h = await harness({ url: fragmentUrl(original), verifier: false, fragmentSession: original, renewedFragment: renewed });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'ready');
    assert.equal(h.result.captureGuard().expectedSessionId, '22222222-2222-4222-8222-222222222222');
    assert.equal((await h.client.auth.getSession()).data.session.access_token, renewed.access_token);
    assert.equal((await h.client.auth.getSession()).data.session.refresh_token, renewed.refresh_token);
    assert.deepEqual(h.requests.map(request => request.grant ?? request.path),
      ['/auth/v1/user', 'refresh_token', '/auth/v1/user']);
    assert.equal(new URL(globalThis.window.location.href).hash, '');
  } finally { await h.dispose(); }
});

test('a valid fragment for another account is blocked before its credentials are used', async () => {
  const existing = session('password');
  const otherUser = { ...user, id: '44444444-4444-4444-8444-444444444444' };
  const original = session('recovery', otherUser);
  const h = await harness({ url: fragmentUrl(original), verifier: false, storedSession: existing, fragmentSession: original });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.cookies.get(h.storageKey), cookieValue(existing));
    assert.deepEqual(h.signedInTokens, [existing.access_token]);
    assert.equal(h.requests.length, 0);
    assert.equal(new URL(globalThis.window.location.href).hash, '');
  } finally { await h.dispose(); }
});

test('a fragment refresh belonging to a different session never replaces the browser cookie', async () => {
  const existing = session('password');
  const original = session('recovery', user, '33333333-3333-4333-8333-333333333333');
  const unrelated = session('recovery', user, '66666666-6666-4666-8666-666666666666');
  const h = await harness({ url: fragmentUrl(original), verifier: false, storedSession: existing,
    fragmentSession: original, renewedFragment: unrelated });
  try {
    h.release(); await h.settle();
    assert.equal(h.states[0], 'invalid');
    assert.equal(h.cookies.get(h.storageKey), cookieValue(existing));
    assert.deepEqual(h.signedInTokens, [existing.access_token]);
    assert.deepEqual(h.requests.map(request => request.grant ?? request.path), ['/auth/v1/user', 'refresh_token']);
    assert.equal(new URL(globalThis.window.location.href).hash, '');
  } finally { await h.dispose(); }
});

for (const [name, injected, requestCount] of [
  ['expired', session('recovery', user, undefined, -60), 0],
  ['invalid signature', { ...session(), access_token: session().access_token.replace(/[^.]+$/, 'invalid-signature') }, 1],
]) {
  test(`an ${name} recovery fragment cannot refresh or replace the existing session`, async () => {
    const existing = session('password');
    const h = await harness({ url: fragmentUrl(injected), verifier: false, storedSession: existing,
      fragmentSession: session() });
    try {
      h.release(); await h.settle();
      assert.equal(h.states[0], 'invalid');
      assert.equal(h.cookies.get(h.storageKey), cookieValue(existing));
      assert.deepEqual(h.signedInTokens, [existing.access_token]);
      assert.equal(h.requests.length, requestCount);
      assert(h.requests.every(request => request.path === '/auth/v1/user'));
      assert.equal(new URL(globalThis.window.location.href).hash, '');
    } finally { await h.dispose(); }
  });
}
