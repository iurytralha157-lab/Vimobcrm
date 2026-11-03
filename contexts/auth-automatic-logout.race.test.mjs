import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const authPath = process.env.VIMOB_AUTO_LOGOUT_BEFORE
  ? 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/logout-auto-baseline/AuthContext.tsx'
  : new URL('./AuthContext.tsx', import.meta.url);
const source = ts.createSourceFile('AuthContext.tsx', readFileSync(authPath, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function extract(predicate) {
  let text;
  function visit(node) { if (predicate(node)) text=node.getText(source);ts.forEachChild(node,visit); }
  visit(source);assert.ok(text);return text;
}
const initializer = name => {
  const declaration=extract(node=>ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text===name);
  return declaration.slice(declaration.indexOf('=')+1);
};
const branch = condition => extract(node=>ts.isIfStatement(node)&&node.expression.getText(source)===condition);
const compile = code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
function load(path,sandbox) { const record={exports:{}};vm.runInNewContext(compile(readFileSync(path,'utf8')),{...sandbox,exports:record.exports,module:record});return record.exports; }
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done});return {promise,resolve};}
const makeSession=(user='user-a',sid='session-a')=>({user:{id:user},access_token:`e30.${Buffer.from(JSON.stringify({sub:user,session_id:sid})).toString('base64url')}.synthetic`});
function storage(){const map=new Map();return {map,get length(){return map.size},key:index=>[...map.keys()][index],removeItem:key=>map.delete(key),getItem:key=>map.get(key)||null,setItem:(key,value)=>map.set(key,value)};}

function harness(pathname='/crm') {
  const h={session:null,user:null,sdkSession:null,timers:[],revokes:[],locals:0,cacheActions:[],redirects:[],tokenWrites:[]};
  const lifecycle={current:{generation:0,sessionKey:null,userId:null,mounted:true,pendingPush:new Set()}};
  const userRef={current:null}, local=storage(), scoped=storage();
  const base={atob,JSON,URL,Date,AbortController,Promise,console:{log(){},error(){}},
    window:{location:{pathname,origin:'https://crm.example.test',replace:path=>h.redirects.push(path)},caches:{},sessionStorage:scoped},
    navigator:{serviceWorker:{getRegistrations:()=>h.workerGate?.promise||Promise.resolve([{pushManager:{getSubscription:async()=>({unsubscribe:async()=>h.cacheActions.push('unsubscribe')})},unregister:async()=>h.cacheActions.push('unregister')}])}},
    caches:{keys:async()=>['one'],delete:async()=>h.cacheActions.push('cache delete')},localStorage:local,sessionStorage:scoped,
    process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.supabase.co'}}};
  const helper=load(new URL('../lib/auth/global-sign-out.ts',import.meta.url),base);
  const cache=load(new URL('../lib/cache-utils.ts',import.meta.url),base);
  const redirect=load(new URL('../lib/auth/post-login-redirect.ts',import.meta.url),base);
  const recovery=load(new URL('../lib/auth/password-recovery.ts',import.meta.url),{
    ...base,URLSearchParams,require:path=>{
      assert.equal(path,'./post-login-redirect');return redirect;
    },
  });
  const noop=()=>{};
  const sandbox={...base,...helper,...cache,h,isMounted:true,userRef,logoutLifecycleRef:lifecycle,
    automaticLogoutSequenceRef:{current:0},isLoggingOutRef:{current:false},signOutInFlightRef:{current:null},
    credentialSignInInFlightRef:{current:false},validatedAccessUserRef:{current:null},markAccessValidationStale:()=>{},organizationListRequestRef:{current:0},profileRef:{current:null},organizationRef:{current:null},
    recoveryActionScheduledRef:{current:null},ROUTES:{RESET_PASSWORD:'/reset-password',SIGNUP:'/cadastro',LOGIN:'/login'},
    useCallback:callback=>callback,setSessionState:value=>{h.session=value},setUser:value=>{h.user=value},
    setVimobAPIAccessToken:token=>h.tokenWrites.push(token),authSnapshotKey:id=>`snapshot:${id}`,authDebug:noop,authDebugWarn:noop,
    setProfile:noop,setOrganization:noop,setTenantContext:noop,setUserOrganizations:noop,setOrganizationsLoaded:noop,setIsSuperAdmin:noop,
    setImpersonating:noop,setOrganizationsError:noop,setIsInitializingOrg:noop,setLoading:noop,setAuthInitialized:noop,
    failOrganizationValidation:noop,isExpiredAPISessionError:()=>true,isPasswordRecoveryAccessToken:()=>true,
    getPasswordRecoveryStorage:recovery.getPasswordRecoveryStorage,clearPasswordRecoveryEvidence:recovery.clearPasswordRecoveryEvidence,
    setTimeout:callback=>h.timers.push(callback),
    supabase:{auth:{getSession:()=>h.lookupGate?.promise||Promise.resolve({data:{session:h.sdkSession},error:null}),
      admin:{signOut:async token=>{h.revokes.push(JSON.parse(Buffer.from(token.split('.')[1],'base64url')).sub);return h.revokeGate?.promise||{error:null}}},
      signOut:async options=>{
        if(options.scope==='global'){await h.revokeGate?.promise;h.revokes.push(h.sdkSession?.user.id);}
        h.locals++;h.transition(null);return {error:null};
      }}}};
  vm.runInNewContext(compile(`const setSession=${initializer('setSession')};const clearAllStates=${initializer('clearAllStates')};
    globalThis.setSessionForTest=setSession;
    globalThis.signedOutEvent=()=>{const authEvent='SIGNED_OUT';${branch("authEvent === 'SIGNED_OUT'")}};
    globalThis.expiredSession=async()=>{const session=h.session,userId=h.user.id,error={status:401};${branch('isExpiredAPISessionError(error)')}};
    globalThis.suspendedCatalogue=async()=>{const session=h.session,userId=h.user.id,accountEntry='globally_suspended';${branch("accountEntry === 'globally_suspended'")}};
    globalThis.suspendedProfile=async()=>{const session=h.session,userId=h.user.id,profileData={is_active:false},superAdmin=false;${branch('!profileData.is_active && !superAdmin')}};
    globalThis.recoverySession=${initializer('isolatePasswordRecoverySession')};`),sandbox);
  h.transition=next=>{sandbox.setSessionForTest(next);h.user=next?.user||null;userRef.current=h.user;h.sdkSession=next;};
  h.transition(makeSession());h.flushTimer=()=>{assert.equal(h.timers.length,1);h.timers.shift()();};
  return {h,sandbox,local,scoped};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('automatic SIGNED_OUT cache cleanup cannot erase B while awaiting Service Worker lookup',async()=>{
  const {h,sandbox,local}=harness();h.workerGate=deferred();sandbox.signedOutEvent();h.flushTimer();await tick();
  h.transition(makeSession('user-b','session-b'));local.map.set('synthetic-auth','session-b');h.workerGate.resolve([]);await tick();
  assert.deepEqual(h.cacheActions,[]);assert.deepEqual(h.redirects,[]);assert.equal(local.map.get('synthetic-auth'),'session-b');
});
test('automatic SIGNED_OUT timer cannot revive after same actor signs in with a new session',async()=>{
  const {h,sandbox,local}=harness();sandbox.signedOutEvent();h.transition(makeSession('user-a','new-session-a'));local.map.set('synthetic-auth','new-session-a');h.flushTimer();await tick();
  assert.deepEqual(h.cacheActions,[]);assert.deepEqual(h.redirects,[]);assert.equal(local.map.get('synthetic-auth'),'new-session-a');
});
test('current automatic SIGNED_OUT still clears and redirects once',async()=>{
  const {h,sandbox}=harness();sandbox.signedOutEvent();h.flushTimer();await tick();
  assert.ok(h.cacheActions.includes('unsubscribe'));assert.equal(h.redirects.length,1);
});
for(const name of ['expiredSession','suspendedCatalogue','suspendedProfile'])test(`${name}: deferred revocation cannot consume B or clear its browser state`,async()=>{
  const {h,sandbox}=harness();h.revokeGate=deferred();const pending=sandbox[name]();await tick();
  h.transition(makeSession('user-b','session-b'));h.revokeGate.resolve({error:null});await pending;
  assert.equal(h.revokes.includes('user-b'),false);assert.equal(h.locals,0);assert.deepEqual(h.cacheActions,[]);assert.deepEqual(h.redirects,[]);
});
for(const name of ['expiredSession','suspendedCatalogue','suspendedProfile'])test(`${name}: a same actor new session also invalidates the original cleanup`,async()=>{
  const {h,sandbox}=harness();h.revokeGate=deferred();const pending=sandbox[name]();await tick();
  h.transition(makeSession('user-a','new-session-a'));h.revokeGate.resolve({error:null});await pending;
  assert.equal(h.locals,0);assert.deepEqual(h.cacheActions,[]);assert.deepEqual(h.redirects,[]);assert.equal(h.sdkSession.access_token,makeSession('user-a','new-session-a').access_token);
});
for(const name of ['expiredSession','suspendedCatalogue','suspendedProfile'])test(`${name}: current session still revokes its own token and clears locally`,async()=>{
  const {h,sandbox}=harness();await sandbox[name]();
  assert.deepEqual(h.revokes,['user-a']);assert.equal(h.locals,1);
  if(name==='expiredSession')assert.equal(h.redirects.length,1);
});
test('recovery timer cannot clear or redirect after a new authenticated visit',async()=>{
  const {h,sandbox}=harness('/login');sandbox.recoverySession(h.session);h.transition(makeSession('user-b','session-b'));h.flushTimer();await tick();
  assert.equal(h.locals,0);assert.deepEqual(h.redirects,[]);assert.deepEqual(h.tokenWrites.filter(value=>value!==null),[]);
});
test('same actor new session invalidates a scheduled recovery cleanup',async()=>{
  const {h,sandbox}=harness('/login');sandbox.recoverySession(h.session);h.transition(makeSession('user-a','new-session-a'));h.flushTimer();await tick();
  assert.equal(h.locals,0);assert.deepEqual(h.redirects,[]);
});
test('passive recovery on the login page preserves evidence and redirects without SDK cleanup',async()=>{
  const {h,sandbox,scoped}=harness('/login');
  scoped.setItem('vimob:password-recovery:intent:v1','synthetic-intent');
  scoped.setItem('vimob:password-recovery:proof:v1','synthetic-proof');
  scoped.setItem('synthetic-unrelated','preserved');
  sandbox.recoverySession(h.session);h.flushTimer();await tick();
  assert.deepEqual(h.revokes,[]);assert.equal(h.locals,0);assert.deepEqual(h.redirects,['/reset-password']);
  assert.equal(scoped.getItem('vimob:password-recovery:intent:v1'),'synthetic-intent');
  assert.equal(scoped.getItem('vimob:password-recovery:proof:v1'),'synthetic-proof');
  assert.equal(scoped.getItem('synthetic-unrelated'),'preserved');
});

test('passive recovery navigation does not acquire denied browser storage or sign out',async()=>{
  const {h,sandbox}=harness('/login');
  Object.defineProperty(sandbox.window,'sessionStorage',{get(){throw new DOMException('Synthetic denied storage','SecurityError');}});
  sandbox.recoverySession(h.session);h.flushTimer();await tick();
  assert.deepEqual(h.revokes,[]);assert.equal(h.locals,0);assert.deepEqual(h.redirects,['/reset-password']);
});
test('current recovery route still navigates to reset without local or global revocation',async()=>{
  const {h,sandbox}=harness('/crm');sandbox.recoverySession(h.session);h.flushTimer();await tick();
  assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);assert.deepEqual(h.redirects,['/reset-password']);
});
test('recovery fresh SDK lookup cannot finish against B while its auth callback is delayed',async()=>{
  const {h,sandbox}=harness('/login');h.lookupGate=deferred();sandbox.recoverySession(h.session);h.flushTimer();await tick();
  h.sdkSession=makeSession('user-b','session-b');h.lookupGate.resolve({data:{session:h.sdkSession},error:null});await tick();
  assert.equal(h.locals,0);assert.deepEqual(h.redirects,[]);
});

test('a stale recovery action cannot prevent a later recovery visit after a normal login',async()=>{
  const {h,sandbox}=harness('/login');
  sandbox.recoverySession(h.sdkSession);
  h.transition(makeSession('user-b','normal-session-b'));
  h.transition(makeSession('user-c','recovery-session-c'));
  sandbox.recoverySession(h.sdkSession);
  assert.equal(h.timers.length,2);
  h.timers.shift()();h.flushTimer();await tick();
  assert.deepEqual(h.redirects,['/reset-password']);assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);
  assert.equal(h.sdkSession.user.id,'user-c');
});

test('repeated recovery notifications coalesce to the latest valid redirect guard',async()=>{
  const {h,sandbox}=harness('/login');
  sandbox.recoverySession(h.sdkSession);sandbox.recoverySession(h.sdkSession);
  assert.equal(h.timers.length,2);
  h.timers.shift()();h.flushTimer();await tick();
  assert.deepEqual(h.redirects,['/reset-password']);assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);
});

test('a deferred passive redirect cannot replace a recovery URL already reached by navigation',async()=>{
  const {h,sandbox}=harness('/login');sandbox.recoverySession(h.sdkSession);
  sandbox.window.location.pathname='/reset-password';h.flushTimer();await tick();
  assert.deepEqual(h.redirects,[]);assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);
});

test('a failed fresh SDK read does not navigate or clean up a passive recovery',async()=>{
  const {h,sandbox}=harness('/login');h.lookupGate=deferred();sandbox.recoverySession(h.sdkSession);h.flushTimer();await tick();
  h.lookupGate.resolve({data:{session:h.sdkSession},error:new Error('Synthetic session lookup failure')});await tick();
  assert.deepEqual(h.redirects,[]);assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);
});

test('a refreshed JWT for the same recovery user and session keeps the latest redirect valid',async()=>{
  const {h,sandbox}=harness('/login');h.lookupGate=deferred();
  sandbox.recoverySession(h.sdkSession);h.flushTimer();await tick();
  const refreshed=makeSession();refreshed.access_token=refreshed.access_token.replace('.synthetic','.synthetic-refreshed');
  h.sdkSession=refreshed;sandbox.recoverySession(refreshed);h.flushTimer();await tick();
  h.lookupGate.resolve({data:{session:refreshed},error:null});await tick();
  assert.deepEqual(h.redirects,['/reset-password']);assert.equal(h.locals,0);assert.deepEqual(h.revokes,[]);
  assert.equal(h.sdkSession.access_token,refreshed.access_token);
  assert.equal(sandbox.recoveryActionScheduledRef.current,null);
});
