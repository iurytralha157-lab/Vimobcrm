import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual React/React Query and production components/hooks. All external
// requests are blocked; synthetic APIs defer authentication and responses.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = process.env.WHATSAPP_AUDIT_FRONTEND_BASELINE;
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-wa-audit-closure-'));
  const aliases = {};
  async function mock(name, source) {
    const file = join(directory, `${Object.keys(aliases).length}.js`);
    await writeFile(file, source); aliases[name] = file;
  }
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({profile:{id:window.h.scope.userId,organization_id:window.h.homeOrg},activeOrganization:{organizationId:window.h.scope.organizationId}});');
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>window.h.allowed,isLoading:false});');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:()=>window.h.moduleEnabled,isLoading:false});');
  await mock('@/hooks/use-automations', 'export const TRIGGER_TYPE_LABELS={manual:"Manual"};export const useAutomations=()=>({data:[{id:"flow-a",name:"Fluxo sintético",trigger_type:"manual",is_active:true}],isLoading:false});');
  await mock('sonner', 'export const toast={success:x=>window.h.toasts.push(x),error:x=>window.h.toasts.push(x),warning:x=>window.h.toasts.push(x),info:x=>window.h.toasts.push(x)};');
  await mock('@/lib/api/automations', 'export const automationsAPI={startAutomation:(...args)=>window.h.start(args)};');
  await mock('@/lib/api/whatsapp', 'export const whatsappAPI={getConversations:(p,intent)=>window.h.conversations(p,intent),getGroups:async()=>[],getMessages:async()=>({messages:[]})};');
  await mock('@/components/ui/dialog', `import React from 'react';
    export const Dialog=({children,open})=>open===false?null:React.createElement('div',null,children);
    export const DialogContent=({children})=>React.createElement('div',null,children);
    export const DialogDescription=DialogContent,DialogHeader=DialogContent,DialogTitle=DialogContent;`);
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const source = path => join(baseline || repository, path);
  await writeFile(entry, `
    import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{StartAutomationDialog}from${JSON.stringify(source('components/features/whatsapp/StartAutomationDialog.tsx'))};
    import{useMentionNames}from${JSON.stringify(source('hooks/use-mention-names.ts'))};
    import{WHATSAPP_MESSAGES_RECONCILE_EVENT}from'@/lib/whatsapp-query-cache';
    const root=createRoot(document.getElementById('root'));
    const h=window.h={scope:{organizationId:'org-a',userId:'user-a',accessScope:'own'},homeOrg:'org-a',moduleEnabled:true,mode:'automation',open:true,allowed:true,
      leadId:'lead-a',conversationId:'chat-a',deferAuth:true,ignoreAbort:false,requests:[],http:[],toasts:[],closed:0,
      name:'Nome inicial',digits:['5511999999999'],deferNames:false,failNames:false,nameRequests:[],nameWaiters:[],names:{},
      render(){flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(App))));},
      start(args){const intent=args[3]||{};return new Promise((resolve,reject)=>{const r={args,intent,resolve,reject,started:false};this.requests.push(r);
        const abort=()=>{r.aborted=true;if(!this.ignoreAbort)reject(new DOMException('Aborted','AbortError'));};
        if(intent.signal?.aborted){abort();return}intent.signal?.addEventListener('abort',abort,{once:true});
        r.begin=()=>{if(intent.signal?.aborted){abort();return}if(intent.expectedUserId!==undefined&&intent.expectedUserId!==this.scope.userId){reject(Error('Actor changed'));return}intent.onRequestStart?.();r.started=true;this.http.push({actor:this.scope.userId,lead:args[1].leadId});};
        if(!this.deferAuth)r.begin();});},
      releaseAuth(){for(const r of this.requests)if(!r.started&&!r.aborted)r.begin();},
      conversations(p,intent){this.nameRequests.push({p,actor:intent?.expectedUserId});if(this.failNames)return Promise.reject(Error('Transient synthetic failure'));
        const result=[{id:'chat-a',lead_id:this.leadId,remote_jid:'5511999999999@s.whatsapp.net',contact_phone:'5511999999999',contact_name:this.name}];
        return this.deferNames?new Promise(resolve=>this.nameWaiters.push(()=>resolve(result))):Promise.resolve(result);},
      reconcile(authorizationChanged=false){window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT,{detail:{scope:this.scope,leadIds:[this.leadId],authorizationChanged}}));},
      unmount(){flushSync(()=>root.render(null));},
    };
    const client=h.client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    function Names(){const names=useMentionNames(h.digits,{leadId:h.leadId,sessionId:'session-a'});h.names=names;return React.createElement('output',null,JSON.stringify(names));}
    function App(){return h.mode==='names'?React.createElement(Names):React.createElement(StartAutomationDialog,{open:h.open,leadId:h.leadId,conversationId:h.conversationId,onOpenChange:open=>{h.open=open;h.closed++;h.render();}});}
    h.render();
  `);
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = webpack({mode:'development',target:'web',entry,output:{path:directory,filename:'bundle.js',publicPath:''},
      resolve:{extensions:['.ts','.tsx','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{...aliases,'@':repository}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]}});
    compiler.run((error,stats)=>compiler.close(()=>error?rejectBuild(error):stats.hasErrors()?rejectBuild(Error(stats.toString({all:false,errors:true}))):resolveBuild()));
  });
  bundle=await readFile(join(directory,'bundle.js'),'utf8');browser=await chromium.launch({headless:true});
}, {timeout:120_000});
after(async()=>{await browser?.close();if(directory){assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&basename(directory).startsWith('vimob-wa-audit-closure-'));await rm(directory,{recursive:true,force:true});}});
async function harness(t, mode='automation') {
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(2_000);
  await page.route('**/*',route=>route.abort());await page.clock.install();
  t.after(async()=>{try{assert.deepEqual(errors,[]);}finally{await page.close();}});
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle});
  await page.evaluate(mode=>{window.h.mode=mode;window.h.render();},mode);return page;
}
for(const change of ['actor','card','close','permission','home','module']) test('automation cancels pending authentication on '+change,async t=>{
  const page=await harness(t);await page.getByRole('button',{name:'Fluxo sintético'}).click();
  await page.evaluate(change=>{const h=window.h;if(change==='actor')h.scope={...h.scope,userId:'user-b'};
    else if(change==='card'){h.leadId='lead-b';h.conversationId='chat-b';}else if(change==='close')h.open=false;
    else if(change==='home')h.homeOrg='org-b';else if(change==='module')h.moduleEnabled=false;
    else {h.allowed=false;h.scope={...h.scope,accessScope:'revoked'};}h.render();h.releaseAuth();},change);
  await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.h.http.length),0);
  assert.equal(await page.evaluate(()=>window.h.requests[0].intent.expectedUserId),'user-a');
  assert.equal(await page.evaluate(()=>window.h.toasts.length),0);
});
test('late automation response after HTTP cannot close another card or show a success',async t=>{
  const page=await harness(t);await page.evaluate(()=>{window.h.deferAuth=false;window.h.ignoreAbort=true;});
  await page.getByRole('button',{name:'Fluxo sintético'}).click();
  assert.equal(await page.evaluate(()=>window.h.http.length),1);
  await page.evaluate(()=>{const h=window.h;h.leadId='lead-b';h.conversationId='chat-b';h.render();h.requests[0].resolve({status:'queued'});});
  await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.h.closed),0);
  assert.equal(await page.evaluate(()=>window.h.toasts.length),0);
});
test('same-context automation preserves normal successful completion',async t=>{
  const page=await harness(t);await page.getByRole('button',{name:'Fluxo sintético'}).click();
  await page.evaluate(()=>{const h=window.h;h.releaseAuth();h.requests[0].resolve({status:'completed'});});
  await page.waitForFunction(()=>window.h.closed===1);assert.equal(await page.evaluate(()=>window.h.toasts.length),1);
});
test('an empty mention list performs no API reads',async t=>{
  const page=await harness(t);await page.evaluate(()=>{const h=window.h;h.mode='names';h.digits=[];h.render();});
  await page.waitForTimeout(30);assert.equal(await page.evaluate(()=>window.h.nameRequests.length),0);
});
test('mention changes invalidate cached names and share the conversation read',async t=>{
  const page=await harness(t,'names');await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome inicial');
  assert.equal(await page.evaluate(()=>window.h.nameRequests.length),1);
  await page.evaluate(()=>{const h=window.h;h.name='Nome atualizado';h.reconcile();});
  await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome atualizado');
  assert.equal(await page.evaluate(()=>window.h.nameRequests.length),2);
});
test('mention names expire while the conversation remains open',async t=>{
  const page=await harness(t,'names');await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome inicial');
  await page.evaluate(()=>{window.h.name='Nome após expiração';});await page.clock.fastForward(61_000);
  await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome após expiração');
});
test('a transient mention lookup does not permanently cache the phone fallback',async t=>{
  const page=await harness(t);await page.evaluate(()=>{const h=window.h;h.mode='names';h.failNames=true;h.render();});
  await page.waitForFunction(()=>window.h.nameRequests.length>0);
  await page.evaluate(()=>{window.h.failNames=false;window.h.name='Nome recuperado';});await page.clock.fastForward(11_000);
  await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome recuperado');
});
test('late old-actor mention lookup never replaces the current name',async t=>{
  const page=await harness(t);await page.evaluate(()=>{const h=window.h;h.mode='names';h.deferNames=true;h.render();});
  await page.waitForFunction(()=>window.h.nameWaiters.length===1);
  await page.evaluate(()=>{const h=window.h;h.deferNames=false;h.scope={...h.scope,userId:'user-b'};h.name='Nome autorizado B';h.render();});
  await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome autorizado B');
  await page.evaluate(()=>window.h.nameWaiters[0]());await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.h.names['5511999999999']),'Nome autorizado B');
});
test('authorization reconciliation clears a displayed mention before a fresh lookup completes',async t=>{
  const page=await harness(t,'names');await page.waitForFunction(()=>window.h.names['5511999999999']==='Nome inicial');
  await page.evaluate(()=>{window.h.deferNames=true;window.h.reconcile(true);});
  await page.waitForFunction(()=>window.h.names['5511999999999']!=='Nome inicial');
  assert.equal(await page.evaluate(()=>window.h.names['5511999999999']),'(11) 99999-9999');
});
