import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const authPath = process.env.VIMOB_AUTH_BOOTSTRAP_TEST_SOURCE || new URL('./AuthContext.tsx', import.meta.url);
const source = ts.createSourceFile('AuthContext.tsx', readFileSync(authPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(source);
  assert.ok(result, 'production auth expression must exist');
  return result;
}
const initializer = name => extract(node => ts.isVariableDeclaration(node) && node.name.getText(source) === name).initializer.getText(source);
const effect = extract(node => ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect'
  && node.arguments[0]?.getText(source).includes('supabase.auth.onAuthStateChange')).arguments[0].getText(source);
const compile = code => ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function moduleExports(path) {
  const record = { exports: {} };
  vm.runInNewContext(compile(readFileSync(new URL(path, import.meta.url), 'utf8')), { exports: record.exports, module: record, atob, JSON, AbortController });
  return record.exports;
}
const sessionHelpers = moduleExports('../lib/auth/global-sign-out.ts');
const authHelpers = moduleExports('../lib/auth/frontend-auth-reliability.ts');
const USER_A = '10000000-0000-4000-8000-000000000001';
const USER_B = '10000000-0000-4000-8000-000000000002';
const ORG = '20000000-0000-4000-8000-000000000001';
const ORG_B = '20000000-0000-4000-8000-000000000002';
const makeSession = (user = USER_A, sid = 'session-a', version = 1) => ({ user: { id: user },
  access_token: `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, iat: version })).toString('base64url')}.synthetic` });
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const tick = () => new Promise(resolve => setImmediate(resolve));

// Run the production mount effect, auth listener and profile loader. Only the
// SDK/API transport and React state setters are synthetic; no network/storage.
function harness() {
  const initial = deferred(), timers = [], local = new Map(), noop = () => {};
  const h = { initial, profileRequests: [], profileGates: [], writes: [], apiSession: null,
    state: { user: null, session: null, profile: null, organization: null, tenantContext: null,
      loading: true, authInitialized: false, organizationsLoaded: false, isInitializingOrg: false } };
  const sandbox = {
    ...sessionHelpers, ...authHelpers, Promise, JSON, Date, Set, AbortController,
    console: { error: noop }, authDebug: noop, authDebugWarn: noop, useCallback: fn => fn,
    MEMBERSHIP_FOCUS_REVALIDATION_INTERVAL_MS: 30000, STALE_ACCESS_RETRY_INTERVAL_MS: 35000,
    userRef: { current: null }, sessionRef: { current: null }, profileRef: { current: null }, organizationRef: { current: null },
    logoutLifecycleRef: { current: { generation: 0, sessionKey: null, userId: null, mounted: true, pendingPush: new Set() } },
    authStateRef: { current: h.state }, fetchProfileRequestRef: { current: 0 }, organizationListRequestRef: { current: 0 },
    organizationSwitchGenerationRef: { current: 0 }, credentialSignInInFlightRef: { current: false },
    validatedAccessUserRef: { current: null }, accessValidationStaleRef: { current: false },
    isLoggingOutRef: { current: false }, signOutInFlightRef: { current: null }, automaticLogoutSequenceRef: { current: 0 },
    recoveryActionScheduledRef: { current: null }, recoveryRequestedHereRef: { current: false },
    localStorage: { getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) },
    window: { location: { pathname: '/login', replace: noop, reload: noop }, addEventListener: noop, removeEventListener: noop, setInterval: () => 1, clearInterval: noop },
    document: { visibilityState: 'visible', addEventListener: noop, removeEventListener: noop },
    setTimeout: (fn, delay) => { if (!delay) timers.push(fn); return timers.length; }, clearTimeout: noop,
    ROUTES: { RESET_PASSWORD: '/reset-password', LOGIN: '/login' },
    performanceTracker: { trackTimed: async (_name, operation) => operation() },
    authSnapshotKey: id => `snapshot:${id}`, parseImpersonationSession: () => null,
    normalizeProfileRole: role => role === 'admin' ? 'admin' : 'user',
    markAccessValidationStale: noop, retainValidatedAccess: () => false,
    failOrganizationValidation: message => { throw new Error(`Unexpected validation failure: ${message}`); },
    isPasswordRecoveryAccessToken: token => token.includes('recovery'),
    isPasswordRecoveryPath: path => path === '/reset-password', readPasswordRecoverySessionIdentity: () => null,
    getVimobAPIAccessTokenUserId: () => h.apiSession?.user.id ?? null,
    getVimobAPIAccessTokenSessionId: () => sessionHelpers.getGlobalSignOutSessionId(h.apiSession),
    performFullCacheClear: async () => { h.cacheClears = (h.cacheClears ?? 0) + 1; },
    usersAPI: { listUserOrganizations: async () => [{ organization_id: h.apiSession.user.id === USER_B ? ORG_B : ORG }] },
    meAPI: { getProfile: async () => {
      const actor = h.apiSession.user.id;
      const organizationId = actor === USER_B ? ORG_B : ORG;
      h.profileRequests.push(actor);
      const gate = h.profileGates.shift();
      if (gate) await gate.promise;
      return { profile: { id: actor, organization_id: organizationId, name: 'QA actor', is_active: true },
        organization: { id: organizationId }, context: { userId: actor, organizationId, memberRole: actor === USER_A ? 'admin' : 'user', isSuperAdmin: false } };
    } },
    setVimobAPIAccessToken: (token, userId) => { h.apiSession = token ? { access_token: token, user: { id: userId } } : null; },
    supabase: { auth: { getSession: () => initial.promise,
      onAuthStateChange: callback => { h.event = callback; return { data: { subscription: { unsubscribe: noop } } }; } } },
  };
  for (const name of ['user', 'profile', 'organization', 'tenantContext', 'loading', 'authInitialized', 'organizationsLoaded', 'isInitializingOrg']) {
    const setter = name === 'session' ? 'setSessionState' : `set${name[0].toUpperCase()}${name.slice(1)}`;
    sandbox[setter] = value => { h.state[name] = typeof value === 'function' ? value(h.state[name]) : value; h.writes.push(name); };
  }
  sandbox.setSessionState = value => { h.state.session = value; h.writes.push('session'); };
  for (const setter of ['setIsSuperAdmin', 'setImpersonating', 'setOrganizationsError', 'setUserOrganizations']) sandbox[setter] = noop;
  sandbox.checkMultiOrgRef = { current: async userId => {
    if (sandbox.userRef.current?.id === userId) sandbox.setOrganizationsLoaded(true);
  } };
  vm.runInNewContext(compile(`const setSession=${initializer('setSession')};
    const revokeInactiveAccountAccess=${initializer('revokeInactiveAccountAccess')};
    const fetchProfile=${initializer('fetchProfile')};
    globalThis.fetchProfileRef={current:fetchProfile};
    globalThis.cleanup=(${effect})();`), sandbox);
  h.finishInitial = async (session, error = null) => { initial.resolve({ data: { session }, error }); await tick(); await tick(); };
  h.flushEvents = async () => { while (timers.length) timers.shift()(); await tick(); await tick(); };
  h.unmount = sandbox.cleanup;
  h.snapshot = () => JSON.stringify({ state: h.state, apiSession: h.apiSession });
  return h;
}

test('normal INITIAL_SESSION preserves the initial profile bootstrap', async () => {
  const h = harness(), session = makeSession();
  h.event('INITIAL_SESSION', session);
  await h.finishInitial(session);
  assert.equal(h.state.profile.id, USER_A);
  assert.equal(h.state.user.id, USER_A);
  assert.equal(h.state.tenantContext.userId, USER_A);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.organizationsLoaded, true);
});

test('bootstrap without an auth event still initializes and no-session still clears', async () => {
  const h = harness(); await h.finishInitial(makeSession());
  assert.equal(h.state.profile.id, USER_A);
  const empty = harness(); await empty.finishInitial(null);
  assert.equal(empty.state.user, null);
  assert.equal(empty.state.authInitialized, true);
  assert.equal(empty.state.organizationsLoaded, true);
});

for (const result of ['old-actor', 'null', 'error']) test(`late initial ${result} cannot replace an initialized actor B`, async () => {
  const h = harness(); h.event('SIGNED_IN', makeSession(USER_B, 'session-b')); await h.flushEvents();
  const before = h.snapshot(), requests = h.profileRequests.length;
  await h.finishInitial(result === 'old-actor' ? makeSession() : null, result === 'error' ? new Error('Synthetic old error') : null);
  assert.equal(h.snapshot(), before);
  assert.equal(h.profileRequests.length, requests);
  assert.equal(h.state.user.id, USER_B);
  assert.equal(h.state.profile.id, USER_B);
  assert.equal(h.state.organization.id, ORG_B);
  assert.equal(h.state.tenantContext.organizationId, ORG_B);
});

test('late initial result cannot finish actor B loading while its context is pending', async () => {
  const h = harness(), gate = deferred(); h.profileGates.push(gate);
  h.event('SIGNED_IN', makeSession(USER_B, 'session-b')); await h.flushEvents();
  const before = h.snapshot(); await h.finishInitial(makeSession());
  assert.equal(h.snapshot(), before);
  gate.resolve(); await tick(); await tick();
  assert.equal(h.state.profile.id, USER_B);
});

for (const event of ['SIGNED_OUT', 'PASSWORD_RECOVERY']) test(`${event} cannot be undone by a late initial session`, async () => {
  const h = harness();
  h.event(event, event === 'SIGNED_OUT' ? null : { ...makeSession(), access_token: 'synthetic-recovery' });
  const before = h.snapshot(); await h.finishInitial(makeSession());
  assert.equal(h.snapshot(), before);
  assert.equal(h.state.user, null);
  assert.equal(h.profileRequests.length, 0);
});

test('A-B-A does not revive the obsolete bootstrap even when the same actor returns', async () => {
  const h = harness();
  h.event('SIGNED_IN', makeSession());
  h.event('SIGNED_IN', makeSession(USER_B, 'session-b'));
  h.event('SIGNED_IN', makeSession(USER_A, 'session-c'));
  const before = h.snapshot(); await h.finishInitial(makeSession());
  assert.equal(h.snapshot(), before);
  assert.equal(h.profileRequests.length, 0);
});

test('same SID token refresh keeps bootstrap and retains the renewed session object', async () => {
  const h = harness(), original = makeSession(), renewed = makeSession(USER_A, 'session-a', 2);
  h.event('INITIAL_SESSION', original); h.event('TOKEN_REFRESHED', renewed);
  await h.finishInitial(original);
  await h.flushEvents();
  assert.equal(h.state.profile.id, USER_A);
  assert.equal(h.state.session.access_token, renewed.access_token);
  assert.equal(h.apiSession.access_token, renewed.access_token);
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.profileRequests, [USER_A]);
});

test('replacement during the bootstrap profile request retires its response and completion', async () => {
  const h = harness(), oldProfile = deferred(), newProfile = deferred();
  h.profileGates.push(oldProfile);
  await h.finishInitial(makeSession());
  assert.deepEqual(h.profileRequests, [USER_A]);
  h.profileGates.push(newProfile);
  h.event('SIGNED_IN', makeSession(USER_A, 'replacement-sid')); await h.flushEvents();
  const before = h.snapshot(); oldProfile.resolve(); await tick(); await tick();
  assert.equal(h.snapshot(), before, 'same-user replacement must not accept the old profile or clear loading');
  newProfile.resolve(); await tick(); await tick();
  assert.equal(h.state.profile.id, USER_A);
  assert.equal(sessionHelpers.getGlobalSignOutSessionId(h.state.session), 'replacement-sid');
});

test('unmount discards a late initial session', async () => {
  const h = harness(); h.unmount(); const before = h.snapshot();
  await h.finishInitial(makeSession()); assert.equal(h.snapshot(), before);
});

for (const [actor, sid] of [[USER_B, 'session-b'], [USER_A, 'replacement-sid']]) {
  for (const result of ['old', 'null', 'error']) test(`replacement refresh owns startup before initial ${result}: ${actor}/${sid}`, async () => {
    const h = harness(), replacement = makeSession(actor, sid, 2);
    h.event('TOKEN_REFRESHED', replacement);
    await h.flushEvents();
    await h.finishInitial(result === 'old' ? makeSession() : null, result === 'error' ? new Error('Synthetic old error') : null);
    assert.equal(h.state.user.id, actor);
    assert.equal(h.state.profile?.id, actor);
    assert.equal(h.state.tenantContext?.userId, actor);
    assert.equal(h.state.session.access_token, replacement.access_token);
    assert.equal(h.state.loading, false);
    assert.equal(h.state.authInitialized, true);
    assert.equal(h.state.organizationsLoaded, true);
    assert.deepEqual(h.profileRequests, [actor], 'only the current visit may initialize');
  });

  test(`replacement refresh owns an in-flight bootstrap profile: ${actor}/${sid}`, async () => {
    const h = harness(), old = deferred(); h.profileGates.push(old);
    await h.finishInitial(makeSession());
    assert.deepEqual(h.profileRequests, [USER_A]);
    h.event('TOKEN_REFRESHED', makeSession(actor, sid)); await h.flushEvents();
    old.resolve(); await tick(); await tick();
    assert.equal(h.state.profile?.id, actor);
    assert.equal(h.state.tenantContext?.userId, actor);
    assert.equal(sessionHelpers.getGlobalSignOutSessionId(h.state.session), sid);
    assert.equal(h.state.loading, false);
    assert.equal(h.state.authInitialized, true);
    assert.deepEqual(h.profileRequests, [USER_A, actor]);
  });

  test(`replacement refresh clears the previous context after startup: ${actor}/${sid}`, async () => {
    const h = harness(); await h.finishInitial(makeSession());
    const gate = deferred(); h.profileGates.push(gate);
    h.event('TOKEN_REFRESHED', makeSession(actor, sid));
    assert.equal(h.state.profile, null);
    assert.equal(h.state.tenantContext, null);
    assert.equal(h.state.organization, null);
    assert.equal(h.state.loading, true);
    await h.flushEvents(); gate.resolve(); await tick(); await tick();
    assert.equal(h.state.profile.id, actor);
    assert.equal(h.state.tenantContext.userId, actor);
    assert.equal(h.state.loading, false);
    assert.deepEqual(h.profileRequests, [USER_A, actor]);
  });
}

test('same SID refresh during the pending profile keeps one bootstrap request', async () => {
  const h = harness(), gate = deferred(), renewed = makeSession(USER_A, 'session-a', 2);
  h.profileGates.push(gate); await h.finishInitial(makeSession());
  h.event('TOKEN_REFRESHED', renewed); await h.flushEvents();
  assert.deepEqual(h.profileRequests, [USER_A]);
  gate.resolve(); await tick(); await tick();
  assert.equal(h.state.profile.id, USER_A);
  assert.equal(h.state.session.access_token, renewed.access_token);
  assert.equal(h.state.loading, false);
  assert.deepEqual(h.profileRequests, [USER_A]);
});

test('an obsolete signed-in initializer cannot finish the replacement refresh visit', async () => {
  const h = harness(), old = deferred(), current = deferred();
  h.profileGates.push(old); h.event('SIGNED_IN', makeSession()); await h.flushEvents();
  h.profileGates.push(current); h.event('TOKEN_REFRESHED', makeSession(USER_B, 'session-b')); await h.flushEvents();
  const before = h.snapshot(); old.resolve(); await tick(); await tick();
  assert.equal(h.snapshot(), before);
  current.resolve(); await tick(); await tick();
  assert.equal(h.state.profile.id, USER_B);
  assert.equal(h.state.loading, false);
  assert.equal(h.state.organizationsLoaded, true);
});

test('a replacement refresh retires the earlier signed-in timer before it fetches', async () => {
  const h = harness(); h.event('SIGNED_IN', makeSession());
  h.event('TOKEN_REFRESHED', makeSession(USER_B, 'session-b')); await h.flushEvents();
  await h.finishInitial(makeSession());
  assert.deepEqual(h.profileRequests, [USER_B]);
  assert.equal(h.state.profile.id, USER_B);
  assert.equal(h.state.loading, false);
});

test('a refresh without a session clears the previous context', async () => {
  const h = harness(); await h.finishInitial(makeSession());
  h.event('TOKEN_REFRESHED', null); await h.flushEvents();
  assert.equal(h.state.user, null);
  assert.equal(h.state.session, null);
  assert.equal(h.state.profile, null);
  assert.equal(h.state.tenantContext, null);
  assert.equal(h.state.loading, false);
});
