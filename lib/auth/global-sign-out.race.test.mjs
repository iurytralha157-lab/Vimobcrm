import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = process.env.VIMOB_LOGOUT_BEFORE ? 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/logout-baseline/lib/auth/global-sign-out.ts' : new URL('./global-sign-out.ts', import.meta.url);
const compiled = ts.transpileModule(readFileSync(source, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandbox = { exports: {}, atob, JSON };
vm.runInNewContext(compiled, sandbox);
const signOut = sandbox.exports.signOutWithGlobalRevocation;
const jwt = (user, sessionId, version = 1) => `e30.${Buffer.from(JSON.stringify({ sub: user, session_id: sessionId, iat: version })).toString('base64url')}.synthetic`;
const session = (user = 'user-a', sessionId = 'session-a', version = 1) => ({ access_token: jwt(user, sessionId, version), user: { id: user } });
const result = current => ({ data: { session: current }, error: null });
function deferred() { let resolve;const promise = new Promise(done => { resolve = done; });return { resolve, promise }; }

test('a deferred session lookup cannot revoke or clear a newer actor', async () => {
  const gate = deferred();let current = true, revoked = 0, cleared = 0;
  const pending = signOut({ getSession: () => gate.promise, revokeGlobal: async () => { revoked++;return { error: null }; }, clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => current });
  current = false;gate.resolve(result(session('user-b', 'session-b')));
  assert.equal(await pending, 'cancelled');assert.equal(revoked, 0);assert.equal(cleared, 0);
});
test('a fresh SDK snapshot for another actor is rejected even before its auth event is delivered', async () => {
  let revoked = 0, cleared = 0;
  const outcome = await signOut({ getSession: async () => result(session('user-b', 'session-b')), revokeGlobal: async () => { revoked++;return { error: null }; }, clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'cancelled');assert.equal(revoked, 0);assert.equal(cleared, 0);
});
test('a same actor new session cannot replace the original session during lookup', async () => {
  let revoked = 0, cleared = 0;
  const outcome = await signOut({ getSession: async () => result(session('user-a', 'new-session-a')), revokeGlobal: async () => { revoked++;return { error: null }; }, clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'cancelled');assert.equal(revoked, 0);assert.equal(cleared, 0);
});
test('a revoke completion from the previous visit cannot clear a new browser session', async () => {
  const gate = deferred(), started = deferred();let current = true, cleared = 0;
  const pending = signOut({ getSession: async () => result(session()), revokeGlobal: () => { started.resolve();return gate.promise; }, clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => current });
  await started.promise;current = false;gate.resolve({ error: null });
  assert.equal(await pending, 'cancelled');assert.equal(cleared, 0);
});
test('same session token refresh still revokes the exact refreshed token and clears locally', async () => {
  let token, cleared = 0;
  const renewed = session('user-a', 'session-a', 2);
  const outcome = await signOut({ getSession: async () => result(renewed), revokeGlobal: async value => { token=value;return { error: null }; }, clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'verified-global');assert.equal(token, renewed.access_token);assert.equal(cleared, 1);
});
test('cancellation after SDK local completion does not claim the new session was logged out', async () => {
  let current = true;
  const outcome = await signOut({ getSession: async () => result(session()), revokeGlobal: async () => ({ error: null }), clearLocal: async () => { current=false;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => current });
  assert.equal(outcome, 'cancelled');
});

test('SDK storage replaced during revocation is rechecked before local cleanup without waiting for an auth event', async () => {
  let stored = session(), cleared = 0, lookups = 0;
  const outcome = await signOut({ getSession: async () => { lookups++;return result(stored); },
    revokeGlobal: async () => { stored=session('user-b','session-b');return { error: null }; },
    clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'cancelled');assert.equal(lookups, 2);assert.equal(cleared, 0);
});

test('a same-user new SDK session after revocation cannot be cleared by the original gesture', async () => {
  let stored = session(), cleared = 0;
  const outcome = await signOut({ getSession: async () => result(stored),
    revokeGlobal: async () => { stored=session('user-a','new-session-a');return { error: null }; },
    clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'cancelled');assert.equal(cleared, 0);
});

test('an unexplained absent SDK session cannot authorize cleanup of the original pinned visit', async () => {
  let stored = session(), cleared = 0;
  const outcome = await signOut({ getSession: async () => result(stored),
    revokeGlobal: async () => { stored=null;return { error: null }; },
    clearLocal: async () => { cleared++;return { error: null }; } },
    { expectedUserId: 'user-a', expectedSessionId: 'session-a', isCurrent: () => true });
  assert.equal(outcome, 'cancelled');assert.equal(cleared, 0);
});

test('a tracked original-to-null SDK transition permits finishing current local cleanup', async () => {
  let stored = session(), cleared = 0;
  const lifecycle = { generation: 0, sessionKey: null, userId: null, mounted: true };
  sandbox.exports.trackGlobalSignOutSession(lifecycle, stored);
  const guard = sandbox.exports.captureGlobalSignOutGuard(stored, 'user-a', lifecycle);
  const outcome = await signOut({ getSession: async () => result(stored),
    revokeGlobal: async () => { stored=null;sandbox.exports.trackGlobalSignOutSession(lifecycle,null);return { error: null }; },
    clearLocal: async () => { cleared++;return { error: null }; } }, guard);
  assert.equal(outcome, 'verified-global');assert.equal(cleared, 1);assert.equal(guard.isCurrent(), true);
});

test('a transient fresh pre-clear lookup failure preserves local credentials', async () => {
  let lookups=0, cleared=0;
  await assert.rejects(signOut({ getSession: async () => ({ data:{session:session()},error:++lookups===2 ? new Error('fresh lookup unavailable') : null }),
    revokeGlobal: async () => ({ error: null }), clearLocal: async () => { cleared++;return {error:null}; } },
    { expectedUserId:'user-a', expectedSessionId:'session-a', isCurrent:()=>true }), /fresh lookup unavailable/);
  assert.equal(cleared,0);
});
