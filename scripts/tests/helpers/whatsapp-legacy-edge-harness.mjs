import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const legacyRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
export const fixtureSecrets={service:'fixture-service-role-only',provider:'fixture-provider-key-only',cron:'fixture-cron-secret-only'};
export const fixtureSession=(id='session-a')=>({id,provider:'evolution_go',instance_id:`instance-${id}`,instance_name:`private-${id}`,status:'connected',is_active:true,display_name:`Nome ${id}`,organization_id:'org-a',owner_user_id:'owner-a',updated_at:'2026-10-14T00:00:00Z',created_at:'2026-10-14T00:00:00Z'});

/** Executes real Deno entrypoints in a closed VM. Only HTTP, auth/DB and clock
 * are fixtures. The 5s deadline is recorded and accelerated to8ms; legacy3s
 * retry sleeps become1ms. No SDK import or external connection can execute. */
export function legacyEdgeHarness(slug,options={}){
 const effects={clients:0,auth:0,reads:[],updates:[],inserts:[],requests:[],bodyReads:0,appliedUpdates:[]};
 const logs=[],delays=[],timers=new Set();let handler;
 const environment={SUPABASE_URL:'https://fixture.supabase.test',SUPABASE_SERVICE_ROLE_KEY:fixtureSecrets.service,EVOLUTION_API_URL:'https://provider.example.test',EVOLUTION_API_KEY:fixtureSecrets.provider,EVOLUTION_GO_API_URL:'https://go.example.test',EVOLUTION_GO_API_KEY:fixtureSecrets.provider,CRON_SECRET:fixtureSecrets.cron,...options.environment};
 const sessions=options.sessions||[fixtureSession()];
 function from(table){
  const state={table,operation:'read',filters:[],value:null,columns:null};
  const matches=row=>state.filters.every(([key,value,operator='eq'])=>operator==='neq'||operator==='not-is'?row[key]!==value:(row[key]??null)===(value??null));
  const execute=async()=>{
   effects[state.operation==='update'?'updates':state.operation==='insert'?'inserts':'reads'].push({...state,filters:state.filters.map(filter=>[...filter])});
   const overridden=options.onQuery?.(state,sessions);if(overridden)return overridden;
   if(state.operation==='update'){
    const rows=table==='whatsapp_sessions'?sessions.filter(matches):[];
    for(const row of rows){Object.assign(row,state.value);effects.appliedUpdates.push({id:row.id,...state.value});}
    return{data:state.columns?rows.map(row=>({id:row.id})):null,error:null};
   }
   if(state.operation==='insert')return{data:null,error:null};
   return{data:table==='whatsapp_sessions'?sessions.filter(matches).map(row=>({...row})):table==='users'?options.admins||[]:[],error:null};
  };
  const query={select:columns=>{state.columns=columns;return query;},eq:(k,v)=>{state.filters.push([k,v]);return query;},neq:(k,v)=>{state.filters.push([k,v,'neq']);return query;},in:()=>query,is:(k,v)=>{state.filters.push([k,v]);return query;},not:(k,operator,v)=>{assert.equal(operator,'is');state.filters.push([k,v,'not-is']);return query;},order:()=>query,limit:()=>query,
   update:value=>{state.operation='update';state.value=value;return query;},insert:value=>{state.operation='insert';state.value=value;return query;},
   single:async()=>{effects.reads.push({...state});return{data:options.profileMissing?null:{role:options.role||'super_admin',is_active:options.active===undefined?true:options.active},error:options.profileError||null};},
   maybeSingle:async()=>{const result=await execute();if(result.error)return result;return{data:result.data?.length===1?result.data[0]:null,error:result.data?.length>1?{code:'PGRST116'}:null};},
   then(resolve,reject){return execute().then(resolve,reject);},
  };return query;
 }
 const admin={from,auth:{getUser:async()=>{effects.auth++;return options.authDenied?{data:{user:null},error:new Error('denied')}:{data:{user:{id:'actor-a'}},error:null};},getClaims:async()=>({data:{claims:{sub:'service-actor',role:'service_role'}}})}};
 const context=vm.createContext({Request,Response,URL,AbortController,DOMException,TextEncoder,TextDecoder,Uint8Array,JSON,Promise,Date,Math,crypto,
  console:Object.fromEntries(['error','warn','info','log'].map(level=>[level,(...args)=>logs.push([level,...args])])),
  setTimeout:(callback,ms,...args)=>{delays.push(ms);const id=setTimeout(()=>{timers.delete(id);callback(...args);},ms>=1000?ms===3000?1:8:ms);timers.add(id);return id;},
  clearTimeout:id=>{timers.delete(id);clearTimeout(id);},
  Deno:{serve:callback=>{handler=callback;},env:{get:name=>environment[name]}},
  fetch:async(input,init={})=>{const request={url:String(input),...init};effects.requests.push(request);return options.fetch?options.fetch(request,effects):Response.json({state:'open'});},
 });
 const loaded=new Map();
 function execute(filename){
  const normalized=path.resolve(filename);assert.ok(normalized.startsWith(path.join(legacyRoot,'supabase','functions')+path.sep));
  if(loaded.has(normalized))return loaded.get(normalized);
  const base=process.env.WHATSAPP_LEGACY_EDGE_BASELINE_DIR;
  const frozen=base&&path.join(base,path.relative(legacyRoot,normalized));
  let source;try{source=readFileSync(frozen||normalized,'utf8');}catch(error){if(!frozen)throw error;source=readFileSync(normalized,'utf8');}
  const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const mod={exports:{}};loaded.set(normalized,mod.exports);
  const run=new vm.Script(`(function(require,module,exports){${compiled}\n})`,{filename:normalized}).runInContext(context);
  run(specifier=>{if(specifier.startsWith('npm:'))return{createClient:(url,key)=>{effects.clients++;if(!url)throw new Error('supabaseUrl is required.');if(!key)throw new Error('supabaseKey is required.');return admin;}};
   if(specifier.endsWith('/rate-limit.ts'))return{enforceRateLimit:async()=>({response:null})};
   if(specifier.startsWith('.'))return execute(path.resolve(path.dirname(normalized),specifier));
   throw new Error(`Unexpected dependency ${specifier}`);
  },mod,mod.exports);loaded.set(normalized,mod.exports);return mod.exports;
 }
 execute(path.join(legacyRoot,'supabase/functions',slug,'index.ts'));assert.equal(typeof handler,'function');
 return{effects,logs,delays,environment,handler,http:()=>execute(path.join(legacyRoot,'supabase/functions/_shared/whatsapp-legacy-http.ts')),pendingTimers:()=>timers.size,dispose:()=>{for(const timer of timers)clearTimeout(timer);timers.clear();},
  request(body={},headers={authorization:`Bearer ${fixtureSecrets.service}`}){const request=new Request(`https://functions.example.test/${slug}`,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(body)});const read=request.json.bind(request);request.json=()=>{effects.bodyReads++;return read();};return request;},
 };
}
export async function boundedResult(promise,limit=120){let timer;try{return await Promise.race([promise,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),limit);})]);}finally{clearTimeout(timer);}}
export function pendingRequest(request){return new Promise((_,reject)=>request.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));}
