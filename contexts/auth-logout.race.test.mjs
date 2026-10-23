import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function loadModule(path, globals = {}) {
  const record = { exports: {} };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports: record.exports, module: record, atob, JSON, AbortController, ...globals });
  return record.exports;
}
const authHelper = loadModule(new URL('../lib/auth/global-sign-out.ts', import.meta.url));
const authPath = process.env.VIMOB_LOGOUT_BEFORE ? 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/logout-baseline/contexts/AuthContext.tsx' : new URL('./AuthContext.tsx', import.meta.url);
const source = ts.createSourceFile('AuthContext.tsx', readFileSync(authPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name) {
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) expression = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return expression;
}
function mountInitializer() {
  let expression;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(source) === 'useLayoutEffect'
      && node.arguments[0]?.getText(source).includes('logoutLifecycleRef.current')) expression = node.arguments[0].getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return expression;
}
function deferred() { let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }
const makeSession = (user = 'user-a', sid = 'session-a', version = 1) => ({ user: { id: user }, access_token: `e30.${Buffer.from(JSON.stringify({sub:user,session_id:sid,iat:version})).toString('base64url')}.synthetic` });

function harness() {
  const lifecycle = { current: { generation: 0, sessionKey: null, userId: null, mounted: true, pendingPush: new Set() } };
  const h = { session: null, user: null, sdkSession: null, pushCalls: [], revokes: [], clears: 0, full: [], actorGeneration: 0,
    transition(next) {
      if (this.user?.id !== next?.user?.id) { this.actorGeneration++;this.pushControllers.forEach(controller=>controller.abort()); }
      this.setSession(next);this.user=next?.user||null;this.sdkSession=next;
    }, pushControllers: new Set(),
  };
  const sandbox = {
    ...authHelper, h, logoutLifecycleRef: lifecycle,
    isLoggingOutRef: {current:false}, signOutInFlightRef: {current:null}, signOutInFlightIdentityRef: {current:null},
    useCallback: callback=>callback, AbortController, DOMException, Promise,
    setSessionState: next=>{h.session=next;}, authDebug:()=>{},
    supabase: {auth: {
      getSession: ()=>h.lookupGate?.promise||Promise.resolve({data:{session:h.sdkSession},error:null}),
      admin: {signOut: async(token,scope)=>{assert.equal(scope,'global');h.revokes.push(JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString()).sub);return h.revokeGate?.promise||{error:h.revokeError||null};}},
      signOut: async options=>{assert.equal(options.scope,'local');h.clears++;h.transition(null);return h.localGate?.promise||{error:null};},
    }},
    deactivateCurrentPushEndpoint: async(org,options)=>{h.pushCalls.push({org,options});await h.pushGate?.promise;},
    performFullCacheClear: async options=>{if(options.isCurrent)assert.equal(options.isCurrent(),true);h.full.push(options);},
  };
  const renderCode = `globalThis.renderLogout=()=>{const user=h.user,session=h.session;
    const captureLogoutPushIntent=()=>{if(!user||h.user?.id!==user.id)throw new DOMException('Cancelled','AbortError');const epoch=h.actorGeneration,controller=new AbortController();h.pushControllers.add(controller);return {userId:user.id,organizationId:'org-a',signal:controller.signal,isCurrent:()=>!controller.signal.aborted&&h.user?.id===user.id&&h.actorGeneration===epoch,finish:()=>h.pushControllers.delete(controller)}};
    const setSession=${initializer('setSession')||'setSessionState'};h.setSession=setSession;
    return ${initializer('signOut')};};${mountInitializer() ? `globalThis.unmount=(${mountInitializer()})();` : 'globalThis.unmount=()=>{logoutLifecycleRef.current.mounted=false;logoutLifecycleRef.current.generation++};'}`;
  vm.runInNewContext(ts.transpileModule(renderCode,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
  sandbox.renderLogout();h.transition(makeSession());h.signOut=sandbox.renderLogout();
  return {h,sandbox,lifecycle,render:()=>sandbox.renderLogout()};
}

test('production caller cannot revoke or clear B after deferred push mirror cleanup', async()=>{
  const {h}=harness();h.pushGate=deferred();const pending=h.signOut();
  h.transition(makeSession('user-b','session-b'));h.pushGate.resolve();await pending;
  assert.deepEqual(h.revokes,[]);assert.equal(h.clears,0);assert.equal(h.full.length,0);
});
test('same actor new session during push mirror aborts the transport and the whole old logout', async()=>{
  const {h}=harness();h.pushGate=deferred();const pending=h.signOut();
  h.transition(makeSession('user-a','new-session-a'));h.pushGate.resolve();await pending;
  assert.equal(h.pushCalls[0].options.signal.aborted,true);assert.equal(h.pushCalls[0].options.isCurrent(),false);
  assert.deepEqual(h.revokes,[]);assert.equal(h.clears,0);assert.equal(h.full.length,0);
});
test('A-B-A cannot revive a logout from the previous authenticated visit', async()=>{
  const {h}=harness();h.pushGate=deferred();const pending=h.signOut();
  h.transition(makeSession('user-b','session-b'));h.transition(makeSession('user-a','new-session-a'));h.pushGate.resolve();await pending;
  assert.deepEqual(h.revokes,[]);assert.equal(h.clears,0);assert.equal(h.full.length,0);
});
test('a getSession completion for B cannot be used as the global revocation token', async()=>{
  const {h}=harness();h.lookupGate=deferred();const pending=h.signOut();
  await new Promise(resolve=>setImmediate(resolve));h.transition(makeSession('user-b','session-b'));
  h.lookupGate.resolve({data:{session:h.sdkSession},error:null});await pending;
  assert.deepEqual(h.revokes,[]);assert.equal(h.clears,0);assert.equal(h.full.length,0);
});
test('completion of an already started A revocation cannot clear the new B session', async()=>{
  const {h}=harness();h.revokeGate=deferred();const pending=h.signOut();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.revokes,['user-a']);
  h.transition(makeSession('user-b','session-b'));h.revokeGate.resolve({error:null});await pending;
  assert.equal(h.clears,0);assert.equal(h.full.length,0);assert.equal(h.user.id,'user-b');
});
test('SDK storage replaced without its auth callback during revoke cannot be cleared by the production caller', async()=>{
  const {h}=harness();h.revokeGate=deferred();const pending=h.signOut();
  await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(h.revokes,['user-a']);
  h.sdkSession=makeSession('user-b','session-b');h.revokeGate.resolve({error:null});await pending;
  assert.equal(h.clears,0);assert.equal(h.full.length,0);assert.equal(h.sdkSession.user.id,'user-b');
});
test('a local SDK operation already started cannot trigger broad cleanup after B logs in', async()=>{
  const {h}=harness();h.localGate=deferred();const pending=h.signOut();
  await new Promise(resolve=>setImmediate(resolve));assert.equal(h.clears,1);
  h.transition(makeSession('user-b','session-b'));h.localGate.resolve({error:null});await pending;
  assert.equal(h.full.length,0);assert.equal(h.user.id,'user-b');
});
test('unmount during push preparation cancels all later logout effects', async()=>{
  const {h,sandbox}=harness();h.pushGate=deferred();const pending=h.signOut();sandbox.unmount();h.pushGate.resolve();await pending;
  assert.deepEqual(h.revokes,[]);assert.equal(h.clears,0);assert.equal(h.full.length,0);
});
test('same-session refresh and the legitimate SDK signed-out transition still finish current logout once', async()=>{
  const {h}=harness();h.pushGate=deferred();const first=h.signOut(),second=h.signOut();assert.equal(first,second);
  h.transition(makeSession('user-a','session-a',2));h.pushGate.resolve();await first;
  assert.deepEqual(h.revokes,['user-a']);assert.equal(h.clears,1);assert.equal(h.full.length,1);
  assert.equal(h.full[0].redirectTo,'/login');
});
test('401 global response preserves the local-unverified destination after legitimate null transition', async()=>{
  const {h}=harness();h.revokeError={status:401};await h.signOut();
  assert.equal(h.clears,1);assert.equal(h.full[0].redirectTo,'/login?logout=unverified');
});
test('an explicit current B logout can proceed while the stale A push mirror is still pending', async()=>{
  const {h,render}=harness();const oldGate=deferred();h.pushGate=oldGate;const old=h.signOut();
  h.transition(makeSession('user-b','session-b'));h.pushGate=null;const current=render()();
  await new Promise(resolve=>setImmediate(resolve));
  try { assert.deepEqual(h.revokes,['user-b']);assert.equal(h.clears,1);assert.equal(h.full.length,1); }
  finally { oldGate.resolve();await Promise.all([old,current]); }
  assert.deepEqual(h.revokes,['user-b']);assert.equal(h.clears,1);assert.equal(h.full.length,1);
});
