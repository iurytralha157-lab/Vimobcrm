import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Production hooks + React + QueryClient. Deferred fake APIs and synthetic
// auth are the only boundaries; Chromium blocks every network request.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-whatsapp-send-scope-'));
  const aliases = {};
  const mock = async (name, source) => { const file = join(directory, `${Object.keys(aliases).length}.js`); await writeFile(file, source); aliases[name] = file; };
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({profile:{id:window.harness.scope.userId,name:"Synthetic",organization_id:window.harness.originalOrganizationId}});');
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.harness.scope;');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:()=>true});');
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>true});');
  await mock('@/hooks/use-toast', 'export const toast=x=>window.harness.toasts.push(x);');
  // Override only the shared intent implementation for the byte-preserved RED.
  if (process.env.WHATSAPP_MUTATION_INTENT_BASELINE) aliases['@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent'] = process.env.WHATSAPP_MUTATION_INTENT_BASELINE;
  await mock('@/lib/api/whatsapp', 'export const whatsappAPI={sendMessage:(id,input,org,options)=>window.harness.request({id,input,org,kind:"send",...options}),getSendStatus:(p,options)=>window.harness.request({...p,...options}),startConversation:(input,org,options)=>window.harness.request({input,org,kind:"start",...options}),reactToMessage:(id,target,input,org,options)=>window.harness.request({id,target,input,org,kind:"reaction",...options}),markConversationAsRead:(id,leadId,org,options)=>window.harness.request({id,leadId,org,kind:"mark-read",...options})};');
  await mock('@/lib/api/vimob-client', `export {VimobAPIError} from ${JSON.stringify(join(repository, 'lib/api/vimob-error.ts'))};`);
  await mock('@/lib/api/telemetry', 'export const reportErrorEvent=()=>{};');
  await mock('@/lib/supabase/client', 'export const createClient=()=>{throw Error("No database allowed in hook fixture")};');
  await mock('@/lib/supabase/private-broadcast', 'export const getPrivateBroadcastRegistry=()=>{throw Error("No broadcast allowed in hook fixture")};');
  await mock('@/components/ui/button', `import React from 'react';export const Button=({variant,size,...props})=>React.createElement('button',props);`);
  await mock('@/components/ui/input', `import React from 'react';export const Input=props=>React.createElement('input',props);`);
  await mock('next/image', `import React from 'react';export default props=>React.createElement('img',props);`);
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}); module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const source = process.env.WHATSAPP_SEND_HOOK_BASELINE || join(repository, 'hooks/use-whatsapp-conversations.ts');
  const startSource = process.env.WHATSAPP_START_HOOK_BASELINE || join(repository, 'hooks/use-start-conversation.ts');
  await writeFile(entry, `
    import React from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
    import * as hooks from ${JSON.stringify(source)};
    import {useStartConversation} from ${JSON.stringify(startSource)};
    import {useWhatsAppIntentMutation} from '@/hooks/integrations/whatsapp/use-whatsapp-mutation-intent';
    import {whatsappQueryKeys as keys,WHATSAPP_MESSAGES_RECONCILE_EVENT} from ${JSON.stringify(join(repository, 'lib/whatsapp-query-cache.ts'))};
    import {VimobAPIError} from ${JSON.stringify(join(repository, 'lib/api/vimob-error.ts'))};
    import {useWhatsAppAttachments} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-attachments.ts'))};
    import {AttachmentPreviewComposer} from ${JSON.stringify(join(repository, 'components/features/whatsapp/AttachmentPreviewComposer.tsx'))};
    import {getWhatsAppFileSendFeedback} from ${JSON.stringify(join(repository, 'lib/whatsapp-send-intent.ts'))};
    import {getWhatsAppSendFailureStatus} from ${JSON.stringify(join(repository, 'lib/whatsapp-query-cache.ts'))};
    import {getWhatsAppFileIntentStore,getWhatsAppFileIntentOwnerKey} from ${JSON.stringify(join(repository, 'lib/whatsapp-file-send-intent.ts'))};
    import {useWhatsAppLocalSendPreviews} from ${JSON.stringify(join(repository, 'hooks/whatsapp/use-whatsapp-local-send-previews.ts'))};
    let client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});const root=createRoot(document.getElementById('root'));
    const harness=window.harness={client,keys,VimobAPIError,originalOrganizationId:'org-a',scope:{organizationId:'org-a',userId:'user-a',accessScope:'allowed'},requests:[],http:[],authWaiters:[],deferAuth:false,toasts:[],cancelCount:0,identities:[],autoRead:false,readTarget:null,callbackVersion:'first',callbacks:[],cacheRevision:0,
      conversation:{id:'11111111-1111-4111-8111-111111111111',lead_id:'22222222-2222-4222-8222-222222222222',session_id:'33333333-3333-4333-8333-333333333333',remote_jid:'synthetic@s.whatsapp.net'},
      request(p){return new Promise((resolve,reject)=>{
        const request={p,resolve,reject,aborted:false};this.requests.push(request);
        const abort=()=>{request.aborted=true;if(!this.ignoreAbort)reject(new DOMException('Aborted','AbortError'))};
        if(p.signal?.aborted){abort();return}p.signal?.addEventListener('abort',abort,{once:true});
        request.begin=()=>{if(p.signal?.aborted){abort();return}try{p.onRequestStart?.();this.http.push({kind:p.kind,org:p.org,expectedUserId:p.expectedUserId});request.started=true}catch(error){reject(error)}};
        if(p.input||p.kind==='mark-read'){if(this.deferAuth)this.authWaiters.push(request);else request.begin()}
      });},
      releaseAuth(){for(const request of this.authWaiters.splice(0))request.begin()},
      render(scope=this.scope){this.scope=scope;flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Hooks))));},
      replaceClient(scope=this.scope){client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});this.client=client;this.render(scope);},
      probeKey(){return ['synthetic-hook-render',this.scope.organizationId,this.scope.userId]},
      bumpCache(){client.setQueryData(this.probeKey(),{revision:++this.cacheRevision})},
      unmount(){flushSync(()=>root.render(null));},
      send(){this.outcome=null;this.sendHook.mutateAsync({conversation:this.conversation,text:'Synthetic draft',clientMessageId:'44444444-4444-4444-8444-444444444444'}).then(x=>this.outcome={ok:true},e=>this.outcome={code:e.code});},
      sendFile(bytes='original file'){this.outcome=null;const file=new File([bytes],'visita.png',{type:'image/png'});this.sendHook.mutateAsync({conversation:this.conversation,text:'visita.png',mediaType:'image',base64:'synthetic',mimetype:'image/png',filename:'visita.png',fileIntentSource:file,fileIntentIsCurrent:()=>!this.fileCancelled}).then(result=>this.outcome={ok:true,result},error=>this.outcome={ok:false,code:error.code});},
      prepareAttachment(){this.mode='attachments';this.render();flushSync(()=>this.attachmentHook.addFiles([new File(['synthetic attachment'],'visita.pdf',{type:'application/pdf'})]));},
      clearFileIntentRegistry(){getWhatsAppFileIntentStore(getWhatsAppFileIntentOwnerKey(this.scope)).clear();},
      fileCanonical(status='queued',code=null){const id=this.requests.find(r=>r.p.kind==='send').p.input.clientMessageId;const result=this.canonical(status,code);result.clientMessageId=id;result.message.client_message_id=id;return result;},
      start(){this.outcome=null;this.startHook.mutateAsync({phone:'+5511999999999',leadId:this.conversation.lead_id,sessionId:this.conversation.session_id,expectedPreviousLeadId:this.conversation.lead_id}).then(x=>this.outcome={ok:true},e=>this.outcome={code:e.code});},
      react(){this.outcome=null;const target=this.canonical('received').message;this.reactHook.mutateAsync({conversation:this.conversation,targetMessage:{...target,session_id:this.conversation.session_id,message_type:'text',from_me:false,can_react:true},emoji:'👍'}).then(x=>this.outcome={ok:true},e=>this.outcome={code:e.code});},
      recover(){this.resolution='waiting';return this.check({conversation:this.conversation,clientMessageId:'44444444-4444-4444-8444-444444444444'}).then(result=>this.resolution=result);},
      canonical(status='queued',code=null){const clientMessageId='44444444-4444-4444-8444-444444444444';return {conversationId:this.conversation.id,clientMessageId,status,message:{id:'55555555-5555-4555-8555-555555555555',message_id:'provider-one',conversation_id:this.conversation.id,client_message_id:clientMessageId,from_me:true,status,delivery_error_code:code,metadata:{}}};},
      delayCancel(){const original=client.cancelQueries.bind(client);client.cancelQueries=()=>{this.cancelCount++;return new Promise(resolve=>this.releaseCancel=resolve)};this.originalCancel=original;},
      key(scope=this.scope){return keys.paginatedMessages(scope,this.conversation.id,20,this.conversation.lead_id)},
      seed(scope=this.scope,messages=[]){client.setQueryData(this.key(scope),{pages:[{messages,nextCursor:null}],pageParams:[null]});},
      rows(scope=this.scope){return client.getQueryData(this.key(scope))?.pages[0].messages||[];},
    };
    function Hooks(){
      harness.sendHook=hooks.useSendWhatsAppMessage();harness.reactHook=hooks.useReactToWhatsAppMessage();harness.startHook=useStartConversation();harness.readHook=hooks.useMarkConversationAsRead();harness.discard=hooks.useDiscardFailedLocalWhatsAppMessage?.();harness.check=hooks.useResolveWhatsAppSendIntent?.();
      harness.previewCards=useWhatsAppLocalSendPreviews(harness.listCards,harness.scope);
      harness.attachmentHook=useWhatsAppAttachments({scopeKey:JSON.stringify([harness.scope,harness.conversation.id,harness.conversation.lead_id]),disabled:false,
        onSend:async(file,caption,context)=>{try{const response=await harness.sendHook.mutateAsync({conversation:harness.conversation,text:caption,mediaType:'document',base64:'synthetic',mimetype:file.type,filename:file.name,fileIntentSource:file,fileIntentVerificationOnly:context.verificationOnly});return getWhatsAppFileSendFeedback(response,{conversationId:harness.conversation.id,clientMessageId:response.clientMessageId}).state;}catch(error){return getWhatsAppSendFailureStatus(error)==='confirming'?'unconfirmed':'failed';}}});
      const version=harness.callbackVersion;
      harness.callbackHook=useWhatsAppIntentMutation({mutationFn:(input,intent)=>harness.request({input:{...input,version},kind:'callback-probe',org:intent.scope.organizationId,...intent}),onSuccess:()=>harness.callbacks.push('hook:'+version)});
      const probe=useQuery({queryKey:harness.probeKey(),queryFn:async()=>({revision:0}),enabled:false});harness.observedRevision=probe.data?.revision;
      const {mutate:markRead}=harness.readHook,candidate=harness.readTarget,enabled=harness.autoRead;
      const target=React.useMemo(()=>candidate,[candidate?.id,candidate?.sessionId,candidate?.remoteJid,candidate?.leadId,candidate?.unreadCount]);
      React.useEffect(()=>{if(enabled&&target&&target.unreadCount>0)markRead({id:target.id,session_id:target.sessionId,remote_jid:target.remoteJid,lead_id:target.leadId,is_group:false})},[enabled,target,markRead]);
      harness.identities.push({send:harness.sendHook.mutate,sendAsync:harness.sendHook.mutateAsync,start:harness.startHook.mutate,startAsync:harness.startHook.mutateAsync,react:harness.reactHook.mutate,reactAsync:harness.reactHook.mutateAsync,read:markRead,readAsync:harness.readHook.mutateAsync});
      return harness.mode==='attachments'?React.createElement(AttachmentPreviewComposer,{attachments:harness.attachmentHook}):React.createElement('div',null,'Synthetic');
    }
    harness.refreshes=[];window.addEventListener(WHATSAPP_MESSAGES_RECONCILE_EVENT,event=>harness.refreshes.push(event.detail));
    harness.listCards=[{...harness.conversation,last_message:'Prévia anterior',last_message_at:'2026-10-18T10:00:00Z',last_message_id:'66666666-6666-4666-8666-666666666666',last_message_sent_at:'2026-10-18T10:00:00Z',last_message_from_me:false,last_message_status:'received'}];
    harness.conversation={...harness.listCards[0]};
    harness.render();harness.seed();
  `);
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'bundle.js', publicPath: '' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? rejectBuild(error) : stats.hasErrors() ? rejectBuild(new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, 'bundle.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });
after(async () => { await browser?.close(); if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir())) && basename(directory).startsWith('vimob-whatsapp-send-scope-')); await rm(directory, { recursive: true, force: true }); } });
async function pageFor(t) { const page = await browser.newPage(); page.setDefaultTimeout(4000); await page.route('**/*', r => r.abort()); const errors=[];page.on('pageerror',error=>errors.push(error.message));t.after(async()=>{await page.close();assert.deepEqual(errors,[], 'No uncaught browser failures')}); await page.route('https://fixture.invalid/', r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'})); await page.goto('https://fixture.invalid/'); await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; }); await page.addScriptTag({ content: bundle }); return page; }

test('own list preview is pending before POST resolves, advances with acceptance and does not regress behind a stale list GET',async t=>{
  const page=await pageFor(t);await page.evaluate(()=>harness.send())
  await page.waitForFunction(()=>harness.requests.length===1&&harness.previewCards[0].last_message_status==='pending')
  assert.deepEqual(await page.evaluate(()=>({text:harness.previewCards[0].last_message,fromMe:harness.previewCards[0].last_message_from_me,base:harness.listCards[0].last_message})),{text:'Synthetic draft',fromMe:true,base:'Prévia anterior'})
  await page.evaluate(()=>harness.requests[0].resolve(harness.canonical('sent')))
  await page.waitForFunction(()=>harness.previewCards[0].last_message_status==='sent')
  await page.evaluate(()=>{harness.baseCards=harness.listCards;const p=harness.previewCards[0];harness.listCards=[{...p,last_message_status:'read'}];harness.render()})
  await page.waitForFunction(()=>harness.previewCards[0].last_message_status==='read')
  await page.evaluate(()=>{harness.listCards=harness.baseCards;harness.render()})
  assert.equal(await page.evaluate(()=>harness.previewCards[0].last_message_status),'read')
  assert.equal(await page.evaluate(()=>harness.requests.length),1,'preview never waits for or starts an extra list/message request')
})

test('a newer incoming list head wins over an own send and a late POST acknowledgement cannot restore its receipt',async t=>{
  const page=await pageFor(t);await page.evaluate(()=>harness.send())
  await page.waitForFunction(()=>harness.requests.length===1&&harness.previewCards[0].last_message_status==='pending')
  await page.evaluate(()=>{harness.listCards=[{...harness.listCards[0],last_message_id:'77777777-7777-4777-8777-777777777777',last_message:'Resposta do lead',last_message_at:new Date().toISOString(),last_message_sent_at:new Date().toISOString()}];harness.render()})
  await page.waitForFunction(()=>harness.previewCards[0].last_message==='Resposta do lead')
  await page.evaluate(()=>harness.requests[0].resolve(harness.canonical('read')))
  await page.waitForFunction(()=>harness.outcome?.ok===true)
  assert.deepEqual(await page.evaluate(()=>[harness.previewCards[0].last_message,harness.previewCards[0].last_message_from_me,harness.previewCards[0].last_message_status]),['Resposta do lead',false,'received'])
})

async function prepareUnconfirmedAttachment(page) {
  await page.evaluate(() => window.harness.prepareAttachment());
  await page.getByRole('button', { name: 'Enviar arquivo', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.some(request => request.p.kind === 'send'));
  const id = await page.evaluate(() => window.harness.requests.find(request => request.p.kind === 'send').p.input.clientMessageId);
  await page.evaluate(() => window.harness.requests.find(request => request.p.kind === 'send').reject(new TypeError('synthetic response lost')));
  await page.getByRole('button', { name: 'Verificar envio', exact: true }).waitFor();
  await page.waitForFunction(() => !window.harness.attachmentHook.busy);
  assert.equal(await page.getByRole('textbox', { name: 'Legenda de visita.pdf' }).isDisabled(), true);
  return id;
}

test('integrated attachments consume canonical acceptance and remove Verify without a second POST', async t => {
  const page = await pageFor(t), original = await prepareUnconfirmedAttachment(page);
  await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.length === 2);
  assert.equal(await page.evaluate(() => window.harness.requests[1].p.clientMessageId), original);
  await page.evaluate(() => window.harness.requests[1].resolve(window.harness.fileCanonical('queued')));
  await page.waitForFunction(() => window.harness.attachmentHook.entries.length === 0 && !window.harness.attachmentHook.busy);
  assert.equal(await page.getByRole('button', { name: 'Verificar envio', exact: true }).count(), 0);
  await page.evaluate(() => window.harness.attachmentHook.send());
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.p.kind === 'send').length), 1);
});

test('integrated attachments keep uncertain provider outcomes on the original GET only', async t => {
  const page = await pageFor(t), original = await prepareUnconfirmedAttachment(page);
  for (let index = 1; index <= 3; index += 1) {
    await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
    await page.waitForFunction(index => window.harness.requests.length === index + 1, index);
    assert.equal(await page.evaluate(index => window.harness.requests[index].p.clientMessageId, index), original);
    await page.evaluate(index => window.harness.requests[index].resolve(window.harness.fileCanonical('failed', 'outcome_unknown')), index);
    await page.waitForFunction(() => !window.harness.attachmentHook.busy);
    assert.equal(await page.getByRole('button', { name: 'Verificar envio', exact: true }).count(), 1);
  }
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.p.kind === 'send').length), 1);
});

test('integrated attachments expose confirmed rejection before an explicit new send', async t => {
  const page = await pageFor(t), original = await prepareUnconfirmedAttachment(page);
  await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.length === 2);
  await page.evaluate(() => window.harness.requests[1].resolve(window.harness.fileCanonical('failed', 'send_failed')));
  await page.waitForFunction(() => window.harness.attachmentHook.entries[0]?.outcome === 'failed' && !window.harness.attachmentHook.busy);
  assert.equal(await page.getByRole('button', { name: 'Verificar envio', exact: true }).count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Legenda de visita.pdf' }).isDisabled(), false);
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.p.kind === 'send').length), 1);
  await page.waitForTimeout(1020);
  await page.getByRole('button', { name: 'Enviar arquivo', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.filter(request => request.p.kind === 'send').length === 2);
  assert.notEqual(await page.evaluate(() => window.harness.requests.filter(request => request.p.kind === 'send')[1].p.input.clientMessageId), original);
  await page.evaluate(() => { const h = window.harness, request = h.requests.filter(request => request.p.kind === 'send')[1], response = h.canonical(); response.clientMessageId = request.p.input.clientMessageId; response.message.client_message_id = response.clientMessageId; request.resolve(response); });
  await page.waitForFunction(() => window.harness.attachmentHook.entries.length === 0 && !window.harness.attachmentHook.busy);
});

for (const terminal of ['queued', 'failed']) test(`integrated attachments recheck the original ID after ${terminal} resolution in another surface`, async t => {
  const page = await pageFor(t), original = await prepareUnconfirmedAttachment(page);
  await page.evaluate(id => { window.harness.check({ conversation: window.harness.conversation, clientMessageId: id }).then(result => window.harness.externalResolution = result); }, original);
  await page.waitForFunction(() => window.harness.requests.length === 2);
  await page.evaluate(terminal => window.harness.requests[1].resolve(window.harness.fileCanonical(terminal, terminal === 'failed' ? 'send_failed' : null)), terminal);
  await page.waitForFunction(() => ['accepted', 'failed'].includes(window.harness.externalResolution));
  await page.waitForTimeout(1020);
  await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
  await page.waitForFunction(() => window.harness.requests.length === 3);
  assert.equal(await page.evaluate(() => window.harness.requests[2].p.clientMessageId), original);
  assert.equal(await page.evaluate(() => window.harness.requests.filter(request => request.p.kind === 'send').length), 1);
  await page.evaluate(terminal => window.harness.requests[2].resolve(window.harness.fileCanonical(terminal, terminal === 'failed' ? 'send_failed' : null)), terminal);
  await page.waitForFunction(terminal => !window.harness.attachmentHook.busy && (terminal === 'queued' ? window.harness.attachmentHook.entries.length === 0 : window.harness.attachmentHook.entries[0]?.outcome === 'failed'), terminal);
});

test('integrated attachments never turn Verify into POST when its registry entry is absent', async t => {
  const page = await pageFor(t); await prepareUnconfirmedAttachment(page);
  await page.evaluate(() => window.harness.clearFileIntentRegistry());
  await page.waitForTimeout(1020);
  for (let index = 0; index < 2; index += 1) {
    await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
    await page.waitForFunction(() => !window.harness.attachmentHook.busy);
    assert.equal(await page.evaluate(() => window.harness.requests.length), 1);
    assert.equal(await page.getByRole('button', { name: 'Verificar envio', exact: true }).count(), 1);
  }
});

test('file Verify without original source cannot fall through to a send POST', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { const h = window.harness; h.sendHook.mutateAsync({ conversation: h.conversation, text: 'synthetic', mediaType: 'document', fileIntentVerificationOnly: true }).then(result => h.outcome = result); });
  await page.waitForFunction(() => window.harness.outcome?.fileIntentResolution === 'pending');
  assert.equal(await page.evaluate(() => window.harness.outcome.fileIntentChecked), true);
  assert.equal(await page.evaluate(() => window.harness.requests.length), 0);
  await page.evaluate(() => { const h = window.harness; h.sendHook.mutate({ conversation: h.conversation, text: 'synthetic', mediaType: 'document', fileIntentVerificationOnly: true }); });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await page.evaluate(() => window.harness.requests.length), 0);
});

test('real send hook preserves ambiguous file ID and reselection performs GET only until canonical acceptance', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => window.harness.sendFile());
  await page.waitForFunction(() => window.harness.requests.some(r => r.p.kind === 'send'));
  const id = await page.evaluate(() => window.harness.requests[0].p.input.clientMessageId);
  await page.evaluate(() => window.harness.requests[0].reject(new TypeError('response lost')));
  await page.waitForFunction(() => window.harness.outcome?.ok === false);
  for (let i = 1; i <= 3; i++) {
    await page.evaluate(() => window.harness.sendFile());
    await page.waitForFunction(index => window.harness.requests.length === index + 1, i);
    assert.equal(await page.evaluate(index => window.harness.requests[index].p.clientMessageId, i), id);
    assert.equal(await page.evaluate(index => window.harness.requests[index].p.expectedUserId, i), 'user-a');
    await page.evaluate(index => { const h=window.harness;h.requests[index].resolve(index===3 ? h.fileCanonical('queued') : h.fileCanonical('failed',index===1?'outcome_unknown':null)); }, i);
    await page.waitForFunction(() => window.harness.outcome?.result?.fileIntentChecked === true);
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r=>r.p.kind==='send').length), 1);
  }
  await page.waitForTimeout(1020);
  await page.evaluate(() => window.harness.sendFile());
  await page.waitForFunction(() => window.harness.requests.filter(r=>r.p.kind==='send').length===2);
  assert.notEqual(await page.evaluate(() => window.harness.requests.filter(r=>r.p.kind==='send')[1].p.input.clientMessageId), id);
  await page.evaluate(() => {const h=window.harness;h.requests.filter(r=>r.p.kind==='send')[1].resolve(h.fileCanonical());});
});

test('unknown file cannot resend after a status 404 or unavailable lookup', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.sendFile()); await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.requests[0].reject(new TypeError('lost'))); await page.waitForFunction(()=>window.harness.outcome?.ok===false);
  for (let i=1;i<=2;i++) {
    await page.evaluate(()=>window.harness.sendFile()); await page.waitForFunction(index=>window.harness.requests.length===index+1,i);
    await page.evaluate(index=>{const h=window.harness;h.requests[index].reject(index===1?new h.VimobAPIError('not found',{status:404,code:'whatsapp_message_not_found'}):new TypeError('lookup unavailable'));},i);
    await page.waitForFunction(()=>window.harness.outcome?.ok===true);
  }
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.p.kind==='send').length),1);
});

test('post-admission confirming response without message preserves file CID and checks the admitted send', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.sendFile());await page.waitForFunction(()=>window.harness.requests.length===1);
  const original=await page.evaluate(()=>window.harness.requests[0].p.input.clientMessageId);
  await page.evaluate(()=>{const h=window.harness;h.requests[0].resolve({clientMessageId:h.requests[0].p.input.clientMessageId,conversationId:h.conversation.id,status:'confirming'});});
  await page.waitForFunction(()=>window.harness.outcome?.ok===true);
  await page.evaluate(()=>window.harness.sendFile());await page.waitForFunction(()=>window.harness.requests.length===2);
  assert.equal(await page.evaluate(()=>window.harness.requests[1].p.clientMessageId),original);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.p.kind==='send').length),1);
  await page.evaluate(()=>window.harness.requests[1].resolve(window.harness.fileCanonical('queued')));
  await page.waitForFunction(()=>window.harness.outcome?.result?.fileIntentChecked===true);
});

test('same actor permission revision keeps ambiguous file CID and checks current authorized status instead of POST', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.sendFile());await page.waitForFunction(()=>window.harness.requests.length===1);
  const original=await page.evaluate(()=>window.harness.requests[0].p.input.clientMessageId);
  await page.evaluate(()=>window.harness.requests[0].reject(new TypeError('lost')));await page.waitForFunction(()=>window.harness.outcome?.ok===false);
  // Past the local rate-limit window, a lost intent would issue a second POST.
  await page.waitForTimeout(1020);
  await page.evaluate(()=>{const h=window.harness;h.replaceClient({...h.scope,accessScope:'revised-allowed-permissions'});h.sendFile();});
  await page.waitForFunction(()=>window.harness.requests.length===2);
  assert.equal(await page.evaluate(()=>window.harness.requests[1].p.clientMessageId),original);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.p.kind==='send').length),1);
  await page.evaluate(()=>window.harness.requests[1].resolve(window.harness.fileCanonical('failed','outcome_unknown')));
  await page.waitForFunction(()=>window.harness.outcome?.result?.fileIntentChecked===true);
});

test('mutate and mutateAsync both guard the same unresolved file gesture', async t => {
  const page=await pageFor(t);
  const gesture=()=>{const h=window.harness;h.sendHook.mutate({conversation:h.conversation,text:'ficha.pdf',mediaType:'document',base64:'synthetic',mimetype:'application/pdf',filename:'ficha.pdf',fileIntentSource:new File(['original'],'ficha.pdf',{type:'application/pdf'})});};
  await page.evaluate(gesture);await page.waitForFunction(()=>window.harness.requests.length===1);
  const original=await page.evaluate(()=>window.harness.requests[0].p.input.clientMessageId);
  await page.evaluate(()=>window.harness.requests[0].reject(new TypeError('lost')));await page.waitForFunction(()=>window.harness.sendHook.isError);
  await page.evaluate(gesture);await page.waitForFunction(()=>window.harness.requests.length===2);
  assert.equal(await page.evaluate(()=>window.harness.requests[1].p.clientMessageId),original);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(r=>r.p.kind==='send').length),1);
  await page.evaluate(()=>window.harness.requests[1].resolve(window.harness.fileCanonical('failed','outcome_unknown')));
  await page.waitForTimeout(20);
});

test('real file fingerprint completion cannot POST after caller context changes', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;let release;const file=new File(['original'],'visita.png',{type:'image/png'});file.arrayBuffer=()=>new Promise(resolve=>release=()=>resolve(new Uint8Array([1,2,3]).buffer));h.fileCancelled=false;h.sendHook.mutateAsync({conversation:h.conversation,text:'visita.png',mediaType:'image',fileIntentSource:file,fileIntentIsCurrent:()=>!h.fileCancelled}).then(result=>h.outcome=result);h.cancelFile=()=>{h.fileCancelled=true;release();};});
  await page.evaluate(()=>window.harness.cancelFile()); await page.waitForFunction(()=>window.harness.outcome?.fileIntentChecked);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0); assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('tenant change during cache cancellation cannot start an old send in another tenant', async t => {
  const page = await pageFor(t);
  await page.evaluate(() => { const h=window.harness; const original=h.client.cancelQueries.bind(h.client); let resolve;const promise=new Promise(r=>resolve=r);h.releaseCancel=resolve;h.client.cancelQueries=()=>{h.cancelCount++;return promise};h.originalCancel=original;h.send(); });
  await page.waitForFunction(() => window.harness.cancelCount >= 2);
  await page.evaluate(() => { const h=window.harness;h.render({...h.scope,organizationId:'org-b'});h.seed();h.releaseCancel(); });
  await page.waitForFunction(() => window.harness.outcome || window.harness.requests.length);
  assert.equal(await page.evaluate(() => window.harness.requests.length), 0);
  assert.equal(await page.evaluate(() => window.harness.outcome.code), 'whatsapp_send_context_changed');
  assert.equal(await page.evaluate(() => window.harness.rows().length), 0);
});
test('late network failure settles only original cache and cannot show a stale tenant toast', async t => {
  const page=await pageFor(t);
  await page.evaluate(() => window.harness.send());
  await page.waitForFunction(() => window.harness.requests.length===1);
  await page.evaluate(() => {const h=window.harness;h.render({...h.scope,organizationId:'org-b'});h.seed();h.requests[0].reject(new Error('network timeout'));});
  await page.waitForFunction(() => window.harness.outcome);
  const state=await page.evaluate(() => {const h=window.harness;return {old:h.rows({...h.scope,organizationId:'org-a'})[0]?.status,current:h.rows().length,toasts:h.toasts.length,org:h.requests[0].p.org};});
  assert.deepEqual(state,{old:'confirming',current:0,toasts:0,org:'org-a'});
});
test('tenant A to B to A cannot revive preparation from the previous visit', async t => {
  const page=await pageFor(t);
  await page.evaluate(() => {const h=window.harness;let resolve;const promise=new Promise(r=>resolve=r);h.releaseCancel=resolve;h.client.cancelQueries=()=>{h.cancelCount++;return promise};h.send();});
  await page.waitForFunction(() => window.harness.cancelCount>=2);
  await page.evaluate(() => {const h=window.harness,scope=h.scope;h.render({...scope,organizationId:'org-b'});h.render(scope);h.releaseCancel();});
  await page.waitForFunction(() => window.harness.outcome || window.harness.requests.length);
  assert.equal(await page.evaluate(() => window.harness.requests.length),0);
  assert.equal(await page.evaluate(() => window.harness.outcome.code),'whatsapp_send_context_changed');
});
test('secondary membership cannot initiate WhatsApp outside the original organization', async t => {
  const page=await pageFor(t);
  await page.evaluate(() => {const h=window.harness;h.render({...h.scope,organizationId:'org-b',accessScope:'admin-secondary'});h.seed();h.send();});
  await page.waitForFunction(() => window.harness.outcome);
  assert.equal(await page.evaluate(() => window.harness.outcome.code),'whatsapp_original_organization_required');
  assert.equal(await page.evaluate(() => window.harness.requests.length),0);
  assert.equal(await page.evaluate(() => window.harness.rows().length),0);
});
test('discard only removes failed local rows from array, paginated and lead caches in its own scope', async t => {
  const page=await pageFor(t);
  const state=await page.evaluate(() => { const h=window.harness, local={id:'intent-local',message_id:'intent-local',client_message_id:'intent-local',conversation_id:h.conversation.id,status:'failed',metadata:{local_delivery_state:'failed'}},canonical={...local,id:'canonical',metadata:{}};
    h.seed(h.scope,[local,canonical]);const other={...h.scope,organizationId:'org-b'};h.seed(other,[local]);
    const array=h.keys.messages(h.scope,{conversationId:h.conversation.id,leadId:h.conversation.lead_id,limit:20,includeLeadHistory:false});h.client.setQueryData(array,[local,canonical]);
    const lead=h.keys.leadMessages(h.scope,h.conversation.lead_id,20);h.client.setQueryData(lead,{pages:[{messages:[local,canonical]}],pageParams:[null]});
    h.discard({conversation:h.conversation,message:local});return {current:h.rows().map(x=>x.id),other:h.rows(other).map(x=>x.id),array:h.client.getQueryData(array).map(x=>x.id),lead:h.client.getQueryData(lead).pages[0].messages.map(x=>x.id)};
  });
  assert.deepEqual(state,{current:['canonical'],other:['intent-local'],array:['canonical'],lead:['canonical']});
});

test('unmount during cache cancellation cannot start a deferred POST', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;let release;const pending=new Promise(resolve=>release=resolve);h.releaseCancel=release;h.client.cancelQueries=()=>{h.cancelCount++;return pending};h.send();});
  await page.waitForFunction(()=>window.harness.cancelCount>=2);
  await page.evaluate(()=>{const h=window.harness;h.unmount();h.releaseCancel();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.requests.length);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
  assert.equal(await page.evaluate(()=>window.harness.outcome.code),'whatsapp_send_context_changed');
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('unmount during start preparation cannot create a conversation later', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;let release;const pending=new Promise(resolve=>release=resolve);h.releaseStart=release;h.client.getMutationCache().config.onMutate=()=>{h.startPreparing=true;return pending};h.start();});
  await page.waitForFunction(()=>window.harness.startPreparing);
  await page.evaluate(()=>{const h=window.harness;h.unmount();h.releaseStart();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.requests.length);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
  assert.equal(await page.evaluate(()=>window.harness.outcome.code),'whatsapp_send_context_changed');
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('unmount aborts an indefinite recovery GET and never permits resend', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>void window.harness.recover());
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.unmount());
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  await page.waitForFunction(()=>window.harness.resolution!=='waiting');
  assert.equal(await page.evaluate(()=>window.harness.resolution),'cancelled');
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(x=>x.p.input).length),0);
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length),0);
});

test('a recovery GET accepted after tenant change cannot settle the new scope', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>void window.harness.recover());
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>{const h=window.harness;h.render({...h.scope,organizationId:'org-b'});h.requests[0].resolve(h.canonical());});
  await page.waitForFunction(()=>window.harness.resolution!=='waiting');
  assert.equal(await page.evaluate(()=>window.harness.resolution),'cancelled');
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length),0);
});

test('A-B-A cannot revive accepted recovery from the previous visit', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>void window.harness.recover());
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>{const h=window.harness,original=h.scope;h.render({...original,organizationId:'org-b'});h.render(original);h.requests[0].resolve(h.canonical());});
  await page.waitForFunction(()=>window.harness.resolution!=='waiting');
  assert.equal(await page.evaluate(()=>window.harness.resolution),'cancelled');
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length),0);
});

test('current forbidden recovery cancels while exact message absence stays pending', async t => {
  const page=await pageFor(t);
  for(const [status,code,expected] of [[403,'forbidden','cancelled'],[404,'whatsapp_message_not_found','pending'],[404,'whatsapp_conversation_not_found','cancelled']]){
    const index=await page.evaluate(()=>{const h=window.harness;const index=h.requests.length;void h.recover();return index;});
    await page.waitForFunction(index=>window.harness.requests.length===index+1,index);
    await page.evaluate(({index,status,code})=>{const h=window.harness;h.requests[index].reject(new h.VimobAPIError('Synthetic rejection',{status,code}));},{index,status,code});
    await page.waitForFunction(()=>window.harness.resolution!=='waiting');
    assert.equal(await page.evaluate(()=>window.harness.resolution),expected);
  }
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(x=>x.p.input).length),0);
});

test('deferred forbidden recovery after ABA cannot refresh or toast the current visit', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>void window.harness.recover());
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>{const h=window.harness,original=h.scope;h.render({...original,accessScope:'revoked'});h.render(original);h.requests[0].reject(new h.VimobAPIError('Old forbidden',{status:403,code:'forbidden'}));});
  await page.waitForFunction(()=>window.harness.resolution!=='waiting');
  assert.equal(await page.evaluate(()=>window.harness.resolution),'cancelled');
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length+window.harness.toasts.length),0);
});

test('undefined and unknown recovery outcomes remain pending without a new POST', async t => {
  const page=await pageFor(t);
  for(const kind of ['undefined','unknown-status','unknown-outcome']){
    const index=await page.evaluate(()=>{const h=window.harness;const index=h.requests.length;void h.recover();return index;});
    await page.waitForFunction(index=>window.harness.requests.length===index+1,index);
    await page.evaluate(({kind,index})=>{const h=window.harness;h.requests[index].resolve(kind==='undefined'?undefined:kind==='unknown-status'?h.canonical('unrecognized'):h.canonical('sent','outcome_unknown'));},{kind,index});
    await page.waitForFunction(()=>window.harness.resolution!=='waiting');
    assert.equal(await page.evaluate(()=>window.harness.resolution),'pending');
  }
  assert.equal(await page.evaluate(()=>window.harness.requests.filter(x=>x.p.input).length),0);
  assert.equal(await page.evaluate(()=>window.harness.refreshes.length),0);
});

test('scope change during deferred transport auth aborts before HTTP and keeps only a failed local attempt', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.deferAuth=true;h.send();});
  await page.waitForFunction(()=>window.harness.authWaiters.length===1);
  const original=await page.evaluate(()=>window.harness.scope);
  await page.evaluate(()=>{const h=window.harness;h.render({...h.scope,userId:'user-b',organizationId:'org-b'});h.seed();h.releaseAuth();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.http.length);
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.status,original),'failed');
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.metadata?.local_delivery_state,original),'failed');
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('unmount during deferred transport auth aborts before HTTP without losing the failed local row', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.deferAuth=true;h.send();});
  await page.waitForFunction(()=>window.harness.authWaiters.length===1);
  await page.evaluate(()=>{const h=window.harness;h.unmount();h.releaseAuth();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.http.length);
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
  assert.equal(await page.evaluate(()=>window.harness.rows()[0]?.status),'failed');
  assert.equal(await page.evaluate(()=>window.harness.rows()[0]?.metadata?.local_delivery_state),'failed');
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('abort after transport starts stays unknown and cannot become a failed retryable send', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.send());
  await page.waitForFunction(()=>window.harness.http.length===1);
  const original=await page.evaluate(()=>window.harness.scope);
  await page.evaluate(()=>{const h=window.harness;h.render({...h.scope,userId:'user-b',organizationId:'org-b'});h.seed();});
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  await page.waitForFunction(()=>window.harness.outcome);
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.status,original),'confirming');
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.metadata?.local_delivery_state,original),'awaiting_reconciliation');
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.delivery_error_code,original),null);
  assert.equal(await page.evaluate(()=>window.harness.http.length),1);
  assert.deepEqual(await page.evaluate(()=>window.harness.http[0]),{kind:'send',org:'org-a',expectedUserId:'user-a'});
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
});

test('start and reaction cannot cross a scope change during deferred transport auth', async t => {
  for(const action of ['start','react']){
    const page=await pageFor(t);
    await page.evaluate(action=>{const h=window.harness;h.deferAuth=true;h[action]();},action);
    await page.waitForFunction(()=>window.harness.authWaiters.length===1);
    await page.evaluate(()=>{const h=window.harness;h.render({...h.scope,userId:'user-b',organizationId:'org-b'});h.releaseAuth();});
    await page.waitForFunction(()=>window.harness.outcome||window.harness.http.length);
    assert.equal(await page.evaluate(()=>window.harness.http.length),0,action);
    assert.equal(await page.evaluate(()=>window.harness.toasts.length),0,action);
  }
});

test('A-B-A cannot restart transport auth from the previous visit', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.deferAuth=true;h.send();});
  await page.waitForFunction(()=>window.harness.authWaiters.length===1);
  await page.evaluate(()=>{const h=window.harness,original=h.scope;h.render({...original,userId:'user-b',organizationId:'org-b'});h.render(original);h.releaseAuth();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.http.length);
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
  assert.equal(await page.evaluate(()=>window.harness.rows()[0]?.status),'failed');
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('unmount after HTTP started retains the unknown attempt without retransmitting', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.send());
  await page.waitForFunction(()=>window.harness.http.length===1);
  await page.evaluate(()=>window.harness.unmount());
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  await page.waitForFunction(()=>window.harness.outcome);
  assert.equal(await page.evaluate(()=>window.harness.rows()[0]?.status),'confirming');
  assert.equal(await page.evaluate(()=>window.harness.rows()[0]?.metadata?.local_delivery_state),'awaiting_reconciliation');
  assert.equal(await page.evaluate(()=>window.harness.http.length),1);
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('reaction cache preparation cannot survive scopeA-B-A', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;let release;const pending=new Promise(resolve=>release=resolve);h.releaseCancel=release;h.client.cancelQueries=()=>{h.cancelCount++;return pending};h.react();});
  await page.waitForFunction(()=>window.harness.cancelCount>=3);
  await page.evaluate(()=>{const h=window.harness,original=h.scope;h.render({...original,userId:'user-b',organizationId:'org-b'});h.render(original);h.releaseCancel();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.requests.length);
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
  assert.equal(await page.evaluate(()=>window.harness.requests.length),0);
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
});

test('reaction auth preparation aborts on unmount without HTTP or a residual optimistic badge', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.deferAuth=true;h.react();});
  await page.waitForFunction(()=>window.harness.authWaiters.length===1);
  await page.evaluate(()=>{const h=window.harness;h.unmount();h.releaseAuth();});
  await page.waitForFunction(()=>window.harness.outcome||window.harness.http.length);
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('reaction aborted after HTTP starts remains confirming in only its original cache', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>window.harness.react());
  await page.waitForFunction(()=>window.harness.http.length===1);
  const original=await page.evaluate(()=>window.harness.scope);
  await page.evaluate(()=>{const h=window.harness;h.render({...h.scope,userId:'user-b',organizationId:'org-b'});h.seed();});
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.signal?.aborted),true);
  await page.waitForFunction(()=>window.harness.outcome);
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.status,original),'confirming');
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
  assert.equal(await page.evaluate(()=>window.harness.http.length),1);
  assert.deepEqual(await page.evaluate(()=>window.harness.http[0]),{kind:'reaction',org:'org-a',expectedUserId:'user-a'});
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('a late noncancelable reaction completion can update only the original scoped cache', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.ignoreAbort=true;h.react();});
  await page.waitForFunction(()=>window.harness.http.length===1);
  const original=await page.evaluate(()=>window.harness.scope);
  await page.evaluate(()=>{const h=window.harness,request=h.requests[0];h.render({...h.scope,userId:'user-b',organizationId:'org-b'});h.seed();request.resolve({conversationId:h.conversation.id,reaction:{...h.canonical('sent').message,id:'66666666-6666-4666-8666-666666666666',message_id:'provider-reaction',client_message_id:request.p.input.clientReactionId,message_type:'reaction',reaction_to_message_id:'provider-one',reaction_emoji:'👍'}});});
  await page.waitForFunction(()=>window.harness.outcome);
  assert.equal(await page.evaluate(scope=>window.harness.rows(scope)[0]?.id,original),'66666666-6666-4666-8666-666666666666');
  assert.equal(await page.evaluate(()=>window.harness.rows().length),0);
  assert.equal(await page.evaluate(()=>window.harness.http.length),1);
  assert.equal(await page.evaluate(()=>window.harness.toasts.length),0);
});

test('automatic mark-read effect sends once through mutation status, cache notifications and unrelated renders', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness,c=h.conversation;h.autoRead=true;h.readTarget={id:c.id,sessionId:c.session_id,remoteJid:c.remote_jid,leadId:c.lead_id,unreadCount:1,messageRevision:1};h.render();});
  await page.waitForFunction(()=>window.harness.http.some(request=>request.kind==='mark-read'));
  const count=()=>page.evaluate(()=>window.harness.http.filter(request=>request.kind==='mark-read').length);
  assert.equal(await count(),1,'The pending mutation must not change mutate identity and restart its consumer effect');
  await page.evaluate(()=>{const h=window.harness;for(let i=0;i<5;i++){h.readTarget={...h.readTarget};h.render({...h.scope})}h.requests.find(request=>request.p.kind==='mark-read').resolve();});
  await page.waitForFunction(()=>window.harness.readHook.isSuccess);
  await page.evaluate(()=>window.harness.bumpCache());
  await page.waitForFunction(()=>window.harness.observedRevision===1);
  assert.equal(await count(),1,'Completion and a subscribed QueryClient notification must not repeat mark-read');
  await page.evaluate(()=>{const h=window.harness;h.readTarget={...h.readTarget,unreadCount:0};h.render();});
  assert.equal(await count(),1,'No unread messages means no POST');
  await page.evaluate(()=>{const h=window.harness;h.readTarget={...h.readTarget,unreadCount:1,messageRevision:2};h.render();});
  await page.waitForFunction(()=>window.harness.http.filter(request=>request.kind==='mark-read').length>=2);
  assert.equal(await count(),2,'A new unread message may create one new authorized read gesture');
  await page.evaluate(()=>{const h=window.harness;h.requests.filter(request=>request.p.kind==='mark-read')[1].resolve();});
  await page.waitForFunction(()=>window.harness.readHook.isSuccess);
  await page.evaluate(()=>{const h=window.harness;h.readTarget={...h.readTarget,id:'77777777-7777-4777-8777-777777777777',messageRevision:1};h.render();});
  await page.waitForFunction(()=>window.harness.http.filter(request=>request.kind==='mark-read').length>=3);
  assert.equal(await count(),3,'A different current conversation may create one new read gesture');
  await page.evaluate(()=>{const h=window.harness;h.requests.filter(request=>request.p.kind==='mark-read')[2].resolve();});
  await page.waitForFunction(()=>window.harness.readHook.isSuccess);
  assert.equal(await count(),3);
  assert.deepEqual(await page.evaluate(()=>window.harness.http.map(({kind,org,expectedUserId})=>({kind,org,expectedUserId}))),Array(3).fill({kind:'mark-read',org:'org-a',expectedUserId:'user-a'}));
});

test('send start reaction and read mutate functions retain identity within the same authorization scope', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;for(let i=0;i<5;i++)h.render({...h.scope});h.bumpCache();});
  await page.waitForFunction(()=>window.harness.observedRevision===1);
  const equality=await page.evaluate(()=>{const h=window.harness,first=h.identities[0];return Object.fromEntries(Object.keys(first).map(key=>[key,h.identities.every(identity=>identity[key]===first[key])]))});
  assert.deepEqual(equality,{send:true,sendAsync:true,start:true,startAsync:true,react:true,reactAsync:true,read:true,readAsync:true});
  assert.equal(await page.evaluate(()=>window.harness.http.length),0);
});

test('a stable saved mutation uses latest committed options and preserves original gesture callbacks', async t => {
  const page=await pageFor(t);
  await page.evaluate(()=>{const h=window.harness;h.savedMutation=h.callbackHook.mutate;h.callbackVersion='latest';h.render();h.savedMutation({value:'first'},{onSuccess:()=>h.callbacks.push('gesture:first')});});
  await page.waitForFunction(()=>window.harness.requests.length===1);
  assert.equal(await page.evaluate(()=>window.harness.requests[0].p.input.version),'latest');
  await page.evaluate(()=>{const h=window.harness;h.callbackVersion='future';h.render();h.requests[0].resolve('first');});
  await page.waitForFunction(()=>window.harness.callbacks.length>=2);
  assert.deepEqual(await page.evaluate(()=>window.harness.callbacks),['hook:latest','gesture:first']);
  await page.evaluate(()=>{const h=window.harness;h.savedMutation({value:'second'},{onSuccess:()=>h.callbacks.push('gesture:second')});});
  await page.waitForFunction(()=>window.harness.requests.length===2);
  assert.equal(await page.evaluate(()=>window.harness.requests[1].p.input.version),'future');
  await page.evaluate(()=>window.harness.requests[1].resolve('second'));
  await page.waitForFunction(()=>window.harness.callbacks.length>=4);
  assert.deepEqual(await page.evaluate(()=>window.harness.callbacks),['hook:latest','gesture:first','hook:future','gesture:second']);
  assert.equal(await page.evaluate(()=>window.harness.http.length),2);
});
