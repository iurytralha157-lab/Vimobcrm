import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
function storage(){const map=new Map([['synthetic-auth','new-session-b']]);return {map,get length(){return map.size},key:index=>[...map.keys()][index],removeItem:key=>map.delete(key)};}
function harness(phase){
  const gate=deferred();let current=true;const actions=[];
  const local=storage(),session=storage();
  const registration={pushManager:{getSubscription:async()=>phase==='subscription'?gate.promise:{unsubscribe:async()=>{actions.push('unsubscribe');}}},unregister:async()=>{actions.push('unregister')},update:async()=>{actions.push('update')}};
  const record={exports:{}};
  const path=process.env.VIMOB_LOGOUT_BEFORE?'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/logout-baseline/lib/cache-utils.ts':new URL('./cache-utils.ts',import.meta.url);
  vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:record.exports,module:record,URL,Date,
    console:{log(){},error(){}},process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://synthetic.supabase.co'}},
    window:{location:{pathname:'/crm',origin:'https://crm.example.test',replace:()=>actions.push('redirect')},caches:{}},
    navigator:{serviceWorker:{getRegistrations:async()=>phase==='worker'?gate.promise:[registration]}},localStorage:local,sessionStorage:session,
    caches:{keys:async()=>phase==='caches'?gate.promise:['one','two'],delete:async name=>{actions.push(`delete:${name}`);if(phase==='delete')return gate.promise;return true;}},
  });
  return {clear:record.exports.performFullCacheClear,gate,actions,local,session,isCurrent:()=>current,cancel:()=>{current=false;},registration};
}
for(const phase of ['worker','subscription','caches','delete'])test(`cache clear stops at deferred ${phase} before mutating the new login`,async()=>{
  const h=harness(phase);const pending=h.clear({clearAuth:true,redirectTo:'/login',isCurrent:h.isCurrent});
  await new Promise(resolve=>setImmediate(resolve));const initial=[...h.actions];h.cancel();
  h.gate.resolve(phase==='worker'?[h.registration]:phase==='subscription'?{unsubscribe:async()=>h.actions.push('late unsubscribe')}:phase==='caches'?['late-one']:true);
  await pending;assert.deepEqual(h.actions,initial);assert.equal(h.local.map.get('synthetic-auth'),'new-session-b');assert.equal(h.session.map.get('synthetic-auth'),'new-session-b');
});
test('default unguarded full clear preserves existing cleanup and navigation',async()=>{
  const h=harness('normal');await h.clear({clearAuth:true,redirectTo:'/login'});
  assert.equal(h.local.map.size,0);assert.equal(h.session.map.size,0);assert.ok(h.actions.includes('unsubscribe'));assert.ok(h.actions.includes('unregister'));assert.ok(h.actions.includes('redirect'));
});
