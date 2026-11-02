import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const repo = new URL('../../', import.meta.url);
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { resolve, promise }; }
const session = (user = 'a', sid = 'sid-a', recovery = true) => ({ user: { id: user }, access_token:
  `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sid, amr: [{ method: typeof recovery === 'string' ? recovery : recovery ? 'recovery' : 'password' }] })).toString('base64url')}.synthetic` });
const tick = () => new Promise(setImmediate);

function harness(kind = 'token_hash', unavailableStorage = false, initial = {}) {
  const suffix = initial.suffix ?? (kind === 'pkce' ? '?code=synthetic-code'
    : kind === 'implicit' ? `#access_token=${session().access_token}&refresh_token=synthetic-refresh&type=recovery`
      : kind === 'none' ? '' : '?token_hash=synthetic-hash&type=recovery');
  const auth = deferred(), states = [], updates = [], effects = [], refs = [], layouts = [], callbacks = [];
  const values = new Map();
  const h = { sdkSession: initial.session ?? null, auth, effects, states, updates, refs, storageWrites: [], calls: [], callback: null };
  const storage = { getItem: key => values.get(key) || null,
    setItem: (key, value) => { h.storageWrites.push(key); values.set(key, value); },
    removeItem: key => { h.storageWrites.push(key); values.delete(key); } };
  const window = { location: { href: `https://staging.example.test/reset-password${suffix}`, replace: destination => effects.push(['navigate', destination]) },
    history: { replaceState: (_state, _title, destination) => effects.push(['url', destination]) }, setTimeout, clearTimeout };
  Object.defineProperty(window, 'sessionStorage', { get: () => { if (unavailableStorage) throw new DOMException('blocked', 'SecurityError'); return storage; } });
  function load(relative, dependencies = {}) {
    const record = { exports: {} };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(relative, repo), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { module: record, exports: record.exports, window, URL, URLSearchParams, atob, Uint8Array, TextDecoder,
      AbortController, setTimeout, clearTimeout, require: name => {
        if (!(name in dependencies)) throw new Error(`Unexpected import ${name}`);
        return dependencies[name];
      } });
    return record.exports;
  }
  const globalSignOut = load('lib/auth/global-sign-out.ts');
  const reliability = load('lib/auth/frontend-auth-reliability.ts');
  const exit = load('lib/auth/password-recovery-exit.ts', { '@/lib/auth/global-sign-out': globalSignOut,
    '@/lib/auth/frontend-auth-reliability': reliability });
  const recovery = load('lib/auth/password-recovery.ts', { './post-login-redirect': { isProtectedAppPath: () => false } });
  if (initial.recordedProof && h.sdkSession) {
    recovery.capturePasswordRecoveryIntent(storage, new URL('https://staging.example.test/reset-password?code=synthetic-code'));
    recovery.grantPasswordRecoveryProof(storage, h.sdkSession.user.id);
  }
  const supabase = { auth: {
    getUser: () => h.userLookup?.promise || Promise.resolve({ data: { user: h.sdkSession?.user }, error: null }),
    getSession: () => h.lookupSession ? h.lookupSession() : h.getSessionError ? Promise.reject(h.getSessionError)
      : h.fresh?.promise || Promise.resolve({ data: { session: h.sdkSession }, error: null }),
    exchangeCodeForSession: () => { h.calls.push('pkce'); return h.auth.promise; },
    verifyOtp: () => { h.calls.push('token_hash'); return h.auth.promise; },
    setSession: () => { h.calls.push('implicit'); return h.auth.promise; },
    onAuthStateChange: callback => { h.callback = callback; return { data: { subscription: { unsubscribe: () => {} } } }; },
    signOut: async () => { effects.push(['logout']); h.transition(null, 'SIGNED_OUT'); return { error: null }; },
    admin: { signOut: async () => { effects.push(['global']); return { error: null }; } },
  } };
  const react = {
    useState: initial => { const index = states.length; states.push(initial); return [initial, value => {
      states[index] = typeof value === 'function' ? value(states[index]) : value; updates.push(index);
    }]; },
    useRef: initial => { const ref = { current: initial }; refs.push(ref); return ref; },
    useCallback: callback => callback, useLayoutEffect: callback => layouts.push(callback), useEffect: callback => callbacks.push(callback),
  };
  const hook = load('hooks/auth/use-password-recovery-session.ts', { react,
    '@/config/constants': { ROUTES: { LOGIN: '/login', SIGNUP: '/cadastro', RESET_PASSWORD: '/reset-password' } },
    '@/lib/supabase/client': { supabase }, '@/lib/api/vimob-client': { setVimobAPIAccessToken: () => effects.push(['api-token']) },
    '@/lib/auth/global-sign-out': globalSignOut, '@/lib/auth/password-recovery-exit': exit,
    '@/lib/auth/password-recovery': recovery,
  });
  const params = new URL(window.location.href).searchParams;
  h.result = hook.usePasswordRecoverySession(params);
  const layoutCleanup = layouts.map(callback => callback());
  const effectCleanup = callbacks.map(callback => callback());
  h.rerunAfterUrlCleanup = () => {
    effectCleanup[0]?.();
    params.delete('code'); params.delete('token_hash'); params.delete('type');
    window.location.href = 'https://staging.example.test/reset-password';
    effectCleanup[0] = callbacks[0]();
  };
  h.startNewLink = () => {
    effectCleanup[0]?.(); h.auth = deferred();
    params.set('token_hash', 'synthetic-next-hash'); params.set('type', 'recovery');
    window.location.href = 'https://staging.example.test/reset-password?token_hash=synthetic-next-hash&type=recovery';
    effectCleanup[0] = callbacks[0]();
  };
  h.unmount = () => { layoutCleanup.forEach(cleanup => cleanup?.()); effectCleanup.forEach(cleanup => cleanup?.()); };
  h.transition = (next, event = 'PASSWORD_RECOVERY') => { h.sdkSession = next; h.callback(event, next); };
  h.resolve = next => { h.transition(next); h.auth.resolve({ data: { session: next, redirectType: 'recovery' }, error: null }); };
  h.attachSubmit = () => {
    const source = ts.createSourceFile('ResetPasswordScreen.tsx', readFileSync(new URL('components/features/auth/screens/ResetPasswordScreen.tsx', repo), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let submit;
    function visit(node) {
      if (ts.isFunctionDeclaration(node) && node.name?.text === 'handleSubmit') submit = node.getText(source);
      ts.forEachChild(node, visit);
    }
    visit(source); assert(submit);
    h.passwordCalls = [];
    const context = { Promise, supabase, ...globalSignOut, ...recovery,
      ...h.result, resetSchema: { safeParse: () => ({ success: true }) },
      submissionInFlightRef: { current: null },
      password: 'Synthetic-password1!', confirmPassword: 'Synthetic-password1!', passwordStrength: { isValid: true },
      setErrors: () => effects.push(['errors']), setLoading: () => effects.push(['loading']),
      setPassword: () => effects.push(['password-clear']), setConfirmPassword: () => effects.push(['confirmation-clear']),
      setEmailNotificationSent: () => effects.push(['email-status']), toast: () => effects.push(['toast']),
      setVimobAPIAccessToken: () => effects.push(['api-token']),
      passwordErrorMessage: () => 'synthetic error', VimobAPIError: class extends Error {},
      settingsAPI: { changePassword: async (...args) => { h.passwordCalls.push(args); return h.passwordResult?.promise || { allowed: true, sessionsRevoked: true }; } },
    };
    vm.runInNewContext(ts.transpileModule(`${submit}\nglobalThis.submit = handleSubmit;`, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, context);
    h.submit = () => context.submit({ preventDefault() {} });
  };
  return h;
}

for (const kind of ['pkce', 'token_hash', 'implicit']) {
  test(`${kind} completion after unmount cannot grant proof, clean the URL or update UI`, async () => {
    const h = harness(kind); assert.deepEqual(h.calls, [kind]);
    h.unmount(); const writes = h.storageWrites.length, updates = h.updates.length;
    h.resolve(session()); await tick(); await tick();
    assert.equal(h.storageWrites.length, writes); assert.equal(h.updates.length, updates); assert.deepEqual(h.effects, []);
  });
  test(`${kind} response cannot revive the page after another actor signs in`, async () => {
    const h = harness(kind); h.transition(session('b', 'sid-b', false), 'SIGNED_IN');
    const writes = h.storageWrites.length, updates = h.updates.length;
    h.resolve(session()); await tick(); await tick();
    assert.equal(h.storageWrites.length, writes); assert.equal(h.updates.length, updates); assert.deepEqual(h.effects, []);
    assert.equal(h.states[0], 'invalid');
  });
}
test('a same-user new recovery session invalidates the original pending visit', async () => {
  const h = harness(); h.transition(session()); h.transition(session('a', 'new-sid-a'));
  const writes = h.storageWrites.length;
  h.resolve(session()); await tick(); await tick();
  assert.equal(h.states[0], 'invalid'); assert.equal(h.storageWrites.length, writes); assert.deepEqual(h.effects, []);
});
test('a delayed fresh-session lookup also obeys unmount before proof and URL effects', async () => {
  const h = harness(); h.fresh = deferred(); h.resolve(session()); await tick();
  h.unmount(); const writes = h.storageWrites.length;
  h.fresh.resolve({ data: { session: session() }, error: null }); await tick();
  assert.equal(h.storageWrites.length, writes); assert.deepEqual(h.effects, []);
});
test('the original recovery becomes ready and binds requests to its user and session', async () => {
  const h = harness(); h.resolve(session()); await tick(); await tick();
  assert.equal(h.states[0], 'ready'); assert.deepEqual(h.effects, [['url', '/reset-password']]);
  const guard = h.result.captureGuard(); assert.equal(guard.expectedUserId, 'a'); assert.equal(guard.expectedSessionId, 'sid-a');
  const request = h.result.captureRequest(guard);
  h.transition(session('b', 'sid-b', false), 'SIGNED_IN');
  assert.equal(guard.isCurrent(), false); assert.equal(request.signal.aborted, true); request.finish();
  h.unmount();
});
test('an explicit new recovery URL starts a fresh visit instead of inheriting the previous user', async () => {
  const h = harness(); h.resolve(session()); await tick(); await tick();
  const oldGuard = h.result.captureGuard(), oldRequest = h.result.captureRequest(oldGuard);
  h.startNewLink(); assert.equal(oldGuard.isCurrent(), false); assert.equal(oldRequest.signal.aborted, true);
  h.resolve(session('b', 'sid-b')); await tick(); await tick();
  assert.equal(h.states[0], 'ready');
  const nextGuard = h.result.captureGuard(); assert.equal(nextGuard.expectedUserId, 'b'); assert.equal(nextGuard.expectedSessionId, 'sid-b');
  oldRequest.finish(); h.unmount();
});
test('the original guard still permits leaving after the password request revoked its own SDK session', async () => {
  const h = harness(); h.resolve(session()); await tick(); await tick();
  const original = h.result.captureGuard(), request = h.result.captureRequest(original);
  h.transition(null, 'SIGNED_OUT'); request.finish();
  assert.equal(original.isCurrent(), true); assert.equal(h.result.captureGuard(), original);
  await h.result.leavePasswordRecovery('/login');
  assert(h.effects.some(effect => effect[0] === 'navigate' && effect[1] === '/login'));
  h.unmount();
});
for (const [name, current] of [['absent', null], ['normal', session('a', 'sid-a', false)], ['unproven recovery', session()]]) {
  test(`a legacy cancel query cannot revoke or navigate the ${name} session`, async () => {
    const h = harness('none', false, { suffix: '?cancel=1&next=%2Flogin', session: current });
    try {
      await tick(); await tick();
      assert.equal(h.states[0], 'invalid'); assert.equal(h.result.captureGuard(), null);
      assert.equal(h.sdkSession, current); assert.deepEqual(h.calls, []);
      assert.deepEqual(h.effects, []); assert.deepEqual(h.storageWrites, []);
    } finally { h.unmount(); }
  });
}
test('a legacy cancel query preserves an already proven recovery and its identity guard', async () => {
  const current = session();
  const h = harness('none', false, { suffix: '?cancel=1&next=%2Fcadastro', session: current, recordedProof: true });
  try {
    await tick(); await tick();
    assert.equal(h.states[0], 'ready'); assert.equal(h.sdkSession, current);
    assert.deepEqual(h.calls, []); assert.deepEqual(h.effects, [['url', '/reset-password']]);
    const guard = h.result.captureGuard();
    assert.equal(guard.expectedUserId, 'a'); assert.equal(guard.expectedSessionId, 'sid-a');
  } finally { h.unmount(); }
});
test('cancel query parameters cannot cancel an otherwise valid PKCE recovery visit', async () => {
  const h = harness('pkce', false, { suffix: '?code=synthetic-code&cancel=1&next=%2Flogin' });
  try {
    h.resolve(session()); await tick(); await tick();
    assert.equal(h.states[0], 'ready'); assert.deepEqual(h.calls, ['pkce']);
    assert.deepEqual(h.effects, [['url', '/reset-password']]);
    assert.equal(h.result.captureGuard().expectedSessionId, 'sid-a');
  } finally { h.unmount(); }
});
test('an explicit leave action still signs out its own verified recovery session', async () => {
  const h = harness();
  try {
    h.resolve(session()); await tick(); await tick();
    await h.result.leavePasswordRecovery('/login');
    assert.equal(h.sdkSession, null);
    assert.equal(h.effects.filter(effect => effect[0] === 'logout').length, 1);
    assert(h.effects.some(effect => effect[0] === 'navigate' && effect[1] === '/login'));
  } finally { h.unmount(); }
});
test('explicit Back exits an observed unproven recovery without authorizing a password change', async () => {
  const current = session(), h = harness('none', false, { session: current });
  try {
    h.transition(current, 'INITIAL_SESSION'); await tick(); await tick();
    assert.equal(h.states[0], 'invalid'); assert.equal(h.result.captureGuard(), null);
    await h.result.leavePasswordRecovery('/login');
    assert.equal(h.states[0], 'invalid'); assert.equal(h.result.captureGuard(), null);
    assert.equal(h.sdkSession, null);
    assert.equal(h.effects.filter(effect => effect[0] === 'logout').length, 1);
    assert(h.effects.some(effect => effect[0] === 'navigate' && effect[1] === '/login'));
  } finally { h.unmount(); }
});
for (const [name, current] of [['absent', null], ['password', session('a', 'sid-a', false)], ['OTP', session('a', 'sid-a', 'otp')]]) {
  test(`explicit Back preserves a stable ${name} session and navigates without logout`, async () => {
    const h = harness('none', false, { session: current });
    try {
      h.transition(current, 'INITIAL_SESSION'); await tick(); await tick();
      await h.result.leavePasswordRecovery('/login');
      assert.equal(h.sdkSession, current);
      assert.deepEqual(h.effects, [['navigate', '/login']]);
    } finally { h.unmount(); }
  });
}
for (const [name, replacement] of [['password', session('b', 'sid-b', false)], ['OTP', session('b', 'sid-b', 'otp')], ['recovery', session('a', 'next-sid-a')]]) {
  test(`explicit Back cannot acquire a replacement ${name} session while its auth callback lags`, async () => {
    const current = session(), h = harness('none', false, { session: current });
    try {
      h.transition(current, 'INITIAL_SESSION'); await tick(); await tick();
      h.fresh = deferred(); const leave = h.result.leavePasswordRecovery('/login');
      h.sdkSession = replacement;
      h.fresh.resolve({ data: { session: replacement }, error: null }); await leave;
      assert.equal(h.sdkSession, replacement); assert.equal(h.states[0], 'invalid');
      assert.deepEqual(h.effects, []); assert.deepEqual(h.storageWrites, []);
    } finally { h.unmount(); }
  });
}
test('a closed invalid visit still observes C and D so a pending explicit exit cannot clear D', async () => {
  const h = harness();
  try {
    h.resolve(session()); await tick(); await tick();
    h.transition(session('b', 'sid-b', false), 'SIGNED_IN');
    assert.equal(h.states[0], 'invalid');
    const current = session('c', 'sid-c'), replacement = session('d', 'sid-d', false);
    h.transition(current, 'PASSWORD_RECOVERY');
    assert.equal(h.states[0], 'invalid'); assert.equal(h.result.captureGuard(), null);
    h.effects.length = 0;
    const lookup = deferred(); let reads = 0;
    h.lookupSession = () => ++reads === 1 ? Promise.resolve({ data: { session: current }, error: null }) : lookup.promise;
    const leave = h.result.leavePasswordRecovery('/login'); await tick();
    assert.equal(reads, 2);
    h.transition(replacement, 'SIGNED_IN');
    lookup.resolve({ data: { session: current }, error: null }); await leave;
    assert.equal(h.sdkSession, replacement); assert.equal(h.states[0], 'invalid');
    assert.deepEqual(h.effects, []);
  } finally { h.unmount(); }
});
test('unmount invalidates a pending explicit Back lookup without effects', async () => {
  const current = session(), h = harness('none', false, { session: current });
  h.transition(current, 'INITIAL_SESSION'); await tick(); await tick();
  h.fresh = deferred(); const leave = h.result.leavePasswordRecovery('/login');
  h.unmount(); h.fresh.resolve({ data: { session: current }, error: null }); await leave;
  assert.equal(h.sdkSession, current); assert.deepEqual(h.effects, []);
});
test('a failed explicit Back lookup remains on the invalid page without exposing raw errors', async () => {
  const current = session(), h = harness('none', false, { session: current });
  try {
    h.transition(current, 'INITIAL_SESSION'); await tick(); await tick();
    h.getSessionError = new Error('Synthetic provider detail');
    await h.result.leavePasswordRecovery('/login');
    assert.equal(h.sdkSession, current); assert.equal(h.states[0], 'invalid');
    assert.equal(h.states[1], 'Não foi possível conferir a sessão. Tente voltar ao login novamente.');
    assert.deepEqual(h.effects, []);
  } finally { h.unmount(); }
});
test('blocked sessionStorage cannot manufacture recovery proof from an existing session', async () => {
  const h = harness('none', true); h.sdkSession = session();
  await tick(); await tick();
  assert.equal(h.states[0], 'invalid'); assert.deepEqual(h.storageWrites, []); h.unmount();
});
test('a link verified in this mounted visit can survive URL cleanup when sessionStorage is blocked', async () => {
  const h = harness('token_hash', true); h.resolve(session()); await tick(); await tick();
  assert.equal(h.states[0], 'ready');
  h.rerunAfterUrlCleanup(); await tick(); await tick();
  assert.equal(h.states[0], 'ready'); assert.deepEqual(h.storageWrites, []); h.unmount();
});
test('failed SDK lookups during validation become an invalid link without an unhandled promise', async () => {
  const h = harness(); h.getSessionError = new Error('synthetic SDK failure'); h.resolve(session());
  await tick(); await tick(); assert.equal(h.states[0], 'invalid'); h.unmount();
});
test('the actual submit handler suppresses duplicate synchronous submissions in the same recovery session', async () => {
  const h = harness(); h.resolve(session()); await tick(); await tick(); h.attachSubmit();
  h.passwordResult = deferred();
  const first = h.submit(), second = h.submit(); await tick();
  assert.equal(h.passwordCalls.length, 1); await second;
  h.transition(session('b', 'sid-b', false), 'SIGNED_IN');
  h.passwordResult.resolve({ allowed: true, sessionsRevoked: true }); await first; h.unmount();
});
test('the actual submit handler cannot start a password request after its identity lookup becomes stale', async () => {
  const h = harness(); h.resolve(session()); await tick(); await tick(); h.attachSubmit();
  h.userLookup = deferred(); const pending = h.submit();
  h.transition(session('b', 'sid-b', false), 'SIGNED_IN');
  const effects = h.effects.length;
  h.userLookup.resolve({ data: { user: session().user }, error: null }); await pending;
  assert.equal(h.passwordCalls.length, 0); assert.equal(h.effects.length, effects); h.unmount();
});
for (const replacement of [session('b', 'sid-b', false), session('a', 'new-sid-a')]) {
  test(`the actual submit binds identity and discards its late result after replacement ${replacement.user.id}`, async () => {
    const h = harness(); h.resolve(session()); await tick(); await tick(); h.attachSubmit();
    h.passwordResult = deferred(); const pending = h.submit(); await tick();
    assert.equal(h.passwordCalls.length, 1);
    const intent = h.passwordCalls[0][2];
    assert.equal(intent.expectedUserId, 'a'); assert.equal(intent.expectedSessionId, 'sid-a');
    h.transition(replacement, 'SIGNED_IN'); const effects = h.effects.length;
    assert.equal(intent.signal.aborted, true);
    h.passwordResult.resolve({ allowed: true, sessionsRevoked: true }); await pending;
    assert.equal(h.effects.length, effects); h.unmount();
  });
}
