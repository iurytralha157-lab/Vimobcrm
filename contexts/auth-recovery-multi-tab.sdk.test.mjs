import assert from 'node:assert/strict';
import { BroadcastChannel } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createBrowserClient } from '@supabase/ssr';

// Actual installed SSR/auth-js, shared cookies and native BroadcastChannel.
// Only HTTP/provider responses and the AuthContext's React state setters are
// synthetic. No real account, email link, token, password or network is used.
const contextSource = ts.createSourceFile('AuthContext.tsx', readFileSync(new URL('./AuthContext.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let recoveryBoundary;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(contextSource) === 'isolatePasswordRecoverySession') recoveryBoundary = node.initializer.getText(contextSource);
  ts.forEachChild(node, visit);
}
visit(contextSource);
assert.ok(recoveryBoundary);
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));
const user = { id: '11111111-1111-4111-8111-111111111111', aud: 'authenticated', role: 'authenticated',
  email: 'synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const claims = { sub: user.id, session_id: '22222222-2222-4222-8222-222222222222',
  exp: Math.floor(Date.now() / 1000) + 3600, amr: [{ method: 'recovery' }] };
const recoverySession = { user, access_token: 'e30.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic',
  refresh_token: 'synthetic-refresh', expires_in: 3600, expires_at: claims.exp, token_type: 'bearer' };
let caseId = 0;

async function harness(pathname) {
  const previous = new Map(['window', 'document', 'BroadcastChannel'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const document = { visibilityState: 'hidden' };
  const window = { document, location: { href: 'https://app.test' + pathname, pathname }, addEventListener() {}, removeEventListener() {} };
  for (const [key, value] of Object.entries({ window, document, BroadcastChannel })) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  const cookies = new Map(), storageKey = 'sb-multitab-synthetic-' + ++caseId;
  const h = { requests: [], ownerEvents: [], idleEvents: [], redirects: [], isolated: 0, serverRevoked: false };
  const cookieOptions = {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: items => items.forEach(({ name, value, options }) => { if (!value || options?.maxAge === 0) cookies.delete(name); else cookies.set(name, value); }),
  };
  const fetcher = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://synthetic.supabase.co');
    h.requests.push({ path: url.pathname, grant: url.searchParams.get('grant_type'), scope: url.searchParams.get('scope'), method: init?.method });
    if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'pkce') return new Response(JSON.stringify(recoverySession), { status: 200 });
    if (url.pathname === '/auth/v1/logout') { h.serverRevoked = true; return new Response(null, { status: 204 }); }
    if (url.pathname === '/auth/v1/user') return new Response(JSON.stringify(user), { status: 200 });
    throw new Error('Unexpected synthetic Auth endpoint');
  };
  const options = { isSingleton: false, cookieOptions: { name: storageKey },
    auth: { autoRefreshToken: false, detectSessionInUrl: false }, cookies: cookieOptions, global: { fetch: fetcher } };
  // The two tab clients deliberately share one Node process. Suppress only its
  // expected same-process instance warning, while retaining native broadcasts.
  const originalWarn = console.warn;
  console.warn = (message, ...rest) => { if (!String(message).includes('Multiple GoTrueClient instances detected')) originalWarn(message, ...rest); };
  let owner, idle;
  try {
    owner = createBrowserClient('https://synthetic.supabase.co', 'synthetic-public-key', options);
    idle = createBrowserClient('https://synthetic.supabase.co', 'synthetic-public-key', options);
  } finally { console.warn = originalWarn; }
  await Promise.all([owner.auth.initialize(), idle.auth.initialize()]);
  const idleStorage = new Map();
  const idleWindow = { location: { pathname, replace: destination => h.redirects.push(destination) }, sessionStorage: {
    getItem: key => idleStorage.get(key) ?? null, setItem: (key, value) => idleStorage.set(key, value), removeItem: key => idleStorage.delete(key),
  } };
  const globals = { window: idleWindow, URL, URLSearchParams, atob, Uint8Array, TextDecoder, AbortController, setTimeout, clearTimeout };
  function load(file, dependencies = {}) {
    const record = { exports: {} };
    vm.runInNewContext(compile(readFileSync(new URL(file, import.meta.url), 'utf8')), { ...globals, exports: record.exports, module: record,
      require: name => { assert(name in dependencies, 'Unexpected helper import'); return dependencies[name]; } });
    return record.exports;
  }
  const signOut = load('../lib/auth/global-sign-out.ts');
  const redirect = load('../lib/auth/post-login-redirect.ts');
  const recovery = load('../lib/auth/password-recovery.ts', { './post-login-redirect': redirect });
  const sandbox = { ...globals, ...signOut, ...recovery, isMounted: true, supabase: idle,
    logoutLifecycleRef: { current: { generation: 0, sessionKey: null, userId: null, mounted: true, pendingPush: new Set() } },
    recoveryActionScheduledRef: { current: null }, ROUTES: { RESET_PASSWORD: '/reset-password', LOGIN: '/login', SIGNUP: '/cadastro' },
    clearAllStates: () => { h.isolated += 1; }, setLoading() {}, setAuthInitialized() {}, setOrganizationsLoaded() {},
    setVimobAPIAccessToken() {}, authDebugWarn() {},
  };
  vm.runInNewContext(compile(`globalThis.isolateRecovery = ${recoveryBoundary}`), sandbox);
  owner.auth.onAuthStateChange(event => { h.ownerEvents.push(event); });
  idle.auth.onAuthStateChange((event, current) => {
    h.idleEvents.push(event);
    if (current) sandbox.isolateRecovery(current);
  });
  cookies.set(storageKey + '-code-verifier', 'base64-' + Buffer.from(JSON.stringify('synthetic-verifier/recovery')).toString('base64url'));
  return { h, owner, idle, cookies, storageKey,
    settle: async () => { for (let i = 0; i < 12; i++) await tick(); },
    dispose: async () => {
      await Promise.all([owner.auth.dispose(), idle.auth.dispose()]);
      for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
    },
  };
}

for (const path of ['/login', '/cadastro', '/onboarding', '/crm', '/reset-password']) {
  test(`an idle tab at ${path} cannot revoke another tab's real SDK recovery session`, async t => {
    const h = await harness(path);
    try {
      const exchange = await h.owner.auth.exchangeCodeForSession('synthetic-code');
      assert.equal(exchange.error, null);
      await h.settle();
      t.diagnostic(JSON.stringify({ idleReceivedRecovery: h.h.idleEvents.includes('PASSWORD_RECOVERY'),
        actualLogoutRequests: h.h.requests.filter(request => request.path === '/auth/v1/logout').length,
        ownerReceivedSignedOut: h.h.ownerEvents.includes('SIGNED_OUT'), serverRevoked: h.h.serverRevoked }));
      assert(h.h.idleEvents.includes('PASSWORD_RECOVERY'), 'native BroadcastChannel must deliver the SDK recovery event to the idle tab');
      assert(h.h.isolated > 0, 'idle CRM application state must still be isolated');
      assert.equal(h.h.requests.filter(request => request.path === '/auth/v1/logout').length, 0, 'passive tab must not perform SDK logout');
      assert.equal(h.h.serverRevoked, false);
      assert.equal(h.h.ownerEvents.includes('SIGNED_OUT'), false);
      assert.equal((await h.owner.auth.getSession()).data.session?.user.id, user.id);
      assert.deepEqual(h.h.redirects, path === '/reset-password' ? [] : ['/reset-password']);
    } finally { await h.dispose(); }
  });
}
