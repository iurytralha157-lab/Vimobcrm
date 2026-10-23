import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Mounted production hooks, React Query and the real attachment/intent store.
// Only API/auth boundaries are synthetic; all browser network is denied.
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-wa-send-admission-'));
  const aliases = {};
  const mock = async (name, source) => { const file = join(directory, `${Object.keys(aliases).length}.js`); await writeFile(file, source); aliases[name] = file; };
  await mock('@/contexts/AuthContext', 'export const useAuth=()=>({profile:{id:window.h.scope.userId,name:"Synthetic",organization_id:window.h.originalOrganizationId}});');
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/hooks/use-organization-modules', 'export const useOrganizationModules=()=>({hasModule:()=>true});');
  await mock('@/hooks/use-user-permissions', 'export const useUserPermissions=()=>({hasPermission:()=>true});');
  await mock('@/hooks/use-toast', 'export const toast=value=>window.h.toasts.push(value);');
  await mock('@/lib/api/whatsapp', 'export const whatsappAPI=new Proxy({}, {get:(_,name)=>(...args)=>window.h.request(name,args)});');
  await mock('@/lib/api/telemetry', 'export const reportErrorEvent=()=>{};');
  await mock('@/lib/supabase/client', 'export const createClient=()=>{throw Error("No database in fixture")};');
  await mock('@/lib/supabase/private-broadcast', 'export const getPrivateBroadcastRegistry=()=>{throw Error("No broadcast in fixture")};');
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  const sendSource = process.env.WHATSAPP_SEND_FLOW_BASELINE || join(repository, 'hooks/use-whatsapp-conversations.ts');
  const sessionsSource = process.env.WHATSAPP_SESSION_FLOW_BASELINE || join(repository, 'hooks/use-whatsapp-sessions.ts');
  await writeFile(entry, `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {useSendWhatsAppMessage} from ${JSON.stringify(sendSource)};
    import {useGetConnectionStatus,useWhatsAppLiveStatusSync} from ${JSON.stringify(sessionsSource)};
    import {useWhatsAppAttachments} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-attachments.ts'))};
    import {whatsappQueryKeys as keys,getWhatsAppSendFailureStatus} from ${JSON.stringify(join(repository, 'lib/whatsapp-query-cache.ts'))};
    import {getWhatsAppFileSendFeedback} from ${JSON.stringify(join(repository, 'lib/whatsapp-send-intent.ts'))};
    import {VimobAPIError} from ${JSON.stringify(join(repository, 'lib/api/vimob-error.ts'))};
    const root=createRoot(document.getElementById('root'));
    const h=window.h={scope:{organizationId:'org-a',userId:'user-a',accessScope:'allowed'},originalOrganizationId:'org-a',
      requests:[],posts:[],checks:[],toasts:[],outcomes:{},cancelWaiters:[],cancelCalls:0,heldPost:null,heldAttendance:null,releaseFiles:{},hashStarts:[],
      holdSend:false,holdAttendance:false,holdLists:false,ignoreAbort:false,live:false,joined:true,denyAttendance:false,
      session:{id:'session-a',organization_id:'org-a',owner_user_id:'user-a',instance_name:'synthetic',status:'disconnected',provider:'evolution_go',is_active:true,can_send:false},
      conversation:{id:'conversation-a',session_id:'session-a',lead_id:'lead-a',remote_jid:'synthetic@s.whatsapp.net'},
      render(scope=this.scope){this.scope={...scope};const tree=React.createElement(QueryClientProvider,{client},React.createElement(Hooks));flushSync(()=>root.render(this.strict?React.createElement(React.StrictMode,null,tree):tree));},
      seed(rows=[this.session],scope=this.scope){client.setQueryData(keys.sessions(scope),rows);client.setQueryData(keys.accessibleSessions(scope),rows);},
      cached(scope=this.scope){return [client.getQueryData(keys.sessions(scope)),client.getQueryData(keys.accessibleSessions(scope))]},
      canonical(input,status='queued',code=null){return {conversationId:input.conversation.id,clientMessageId:input.clientMessageId,status,
        message:{id:'canonical-'+input.clientMessageId,message_id:'provider-'+input.clientMessageId,conversation_id:input.conversation.id,
          client_message_id:input.clientMessageId,from_me:true,status,delivery_error_code:code,metadata:{}}}},
      request(name,args){const intent=args.at(-1)||{};const call={name,args,intent};this.requests.push(call);
        return new Promise((resolve,reject)=>{
          call.resolve=resolve;call.reject=reject;
          const abort=()=>{call.aborted=true;if(!this.ignoreAbort)reject(intent.signal?.reason||new DOMException('Aborted','AbortError'));};
          if(intent.signal?.aborted){abort();return}intent.signal?.addEventListener('abort',abort,{once:true});
          try{intent.onRequestStart?.()}catch(error){reject(error);return}
          if(name==='sendMessage'){
            const [id,input]=args;this.posts.push({id,...input,actor:intent.expectedUserId,org:args[2]});
            if(this.holdSend){this.heldPost=call;return}
            if(this.unknownSend){reject(new TypeError('Synthetic response lost'));return}
            resolve(this.canonical({conversation:{id},clientMessageId:input.clientMessageId}));return;
          }
          if(name==='getConversationAttendance'){
            if(this.holdAttendance){this.heldAttendance=call;return}
            if(this.denyAttendance){reject(new VimobAPIError('Access revoked',{status:403,code:'whatsapp_session_access_revoked'}));return}
            resolve({joined:this.joined,entries:[]});return;
          }
          if(name==='getSendStatus'){this.checks.push(args[0]);if(this.holdChecks)return;resolve(this.canonical({conversation:this.conversation,clientMessageId:args[0].clientMessageId},this.checkStatus||'failed',this.checkStatus?null:'outcome_unknown'));return}
          if(name==='getConnectionStatus'){resolve(this.statusResponse||{connected:true,status:'connected'});return}
          if(name==='getSessions'){if(this.holdLists)return;resolve({data:this.freshSessions||[{...this.session,status:'connected',can_send:true}],meta:{total:1}});return}
          reject(Error('Unexpected fixture API '+name));
        });},
      send(label,hook=0,patch={}){const variables={conversation:this.conversation,text:label,clientMessageId:label,...patch};
        this.outcomes[label]=null;const op=this.sends[hook].mutateAsync(variables);
        op.then(result=>this.outcomes[label]={ok:true,result},error=>this.outcomes[label]={ok:false,code:error.code,message:error.message});return op;},
      sendFile(label,hook=0,bytes='same synthetic file',patch={}){const file=new File([bytes],'synthetic.pdf',{type:'application/pdf'});
        if(this.holdFile)file.arrayBuffer=()=>new Promise(resolve=>{this.hashStarts.push(label);this.releaseFile=this.releaseFiles[label]=()=>resolve(new TextEncoder().encode(bytes).buffer);});
        return this.send(label,hook,{clientMessageId:undefined,text:'',mediaType:'document',mimetype:file.type,filename:file.name,base64:'synthetic',fileIntentSource:file,...patch});},
      delayCancel(){client.cancelQueries=()=>{this.cancelCalls++;return new Promise(resolve=>this.cancelWaiters.push(resolve));};},
      releaseCancel(){client.cancelQueries=realCancel;for(const resolve of this.cancelWaiters.splice(0))resolve();},
      finishPost(){const call=this.heldPost;this.heldPost=null;this.holdSend=false;call.resolve(this.canonical({conversation:{id:call.args[0]},clientMessageId:call.args[1].clientMessageId}));},
      status(){this.statusOutcome=null;this.statusHook.mutateAsync({provider:'evolution_go',instanceName:'synthetic',sessionId:'session-a'}).then(()=>this.statusOutcome='ok',e=>this.statusOutcome=e.code);},
      unmount(){flushSync(()=>root.render(null));},
    };
    const client=h.client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const realCancel=client.cancelQueries.bind(client);
    function Hooks(){h.sends=[useSendWhatsAppMessage(),useSendWhatsAppMessage()];h.statusHook=useGetConnectionStatus();
      useWhatsAppLiveStatusSync([h.session],{enabled:h.live});
      h.attachments=useWhatsAppAttachments({scopeKey:JSON.stringify(h.scope),disabled:false,onSend:async(file,caption,context)=>{
        try{const result=await h.sends[0].mutateAsync({conversation:h.conversation,text:caption,mediaType:'document',base64:'synthetic',
          mimetype:file.type,filename:file.name,fileIntentSource:file,fileIntentVerificationOnly:context.verificationOnly});
          return getWhatsAppFileSendFeedback(result,{conversationId:h.conversation.id,clientMessageId:result.clientMessageId}).state;
        }catch(error){return getWhatsAppSendFailureStatus(error)==='confirming'?'unconfirmed':'failed';}}});
      return null;}
    h.render();h.seed();
  `);
  await new Promise((resolveBuild, rejectBuild) => {
    const compiler = webpack({ mode:'development',target:'web',entry,output:{path:directory,filename:'bundle.js',publicPath:''},
      resolve:{extensions:['.ts','.tsx','.js'],modules:[join(repository,'node_modules'),'node_modules'],alias:{...aliases,'@':repository}},
      module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader}]} });
    compiler.run((error,stats)=>compiler.close(()=>error?rejectBuild(error):stats.hasErrors()?rejectBuild(new Error(stats.toString({all:false,errors:true}))):resolveBuild()));
  });
  bundle=await readFile(join(directory,'bundle.js'),'utf8');browser=await chromium.launch({headless:true});
}, {timeout:90_000});
after(async()=>{await browser?.close();if(directory){assert.ok(resolve(directory).startsWith(resolve(tmpdir()))&&basename(directory).startsWith('vimob-wa-send-admission-'));await rm(directory,{recursive:true,force:true});}});
async function fixture(t){const page=await browser.newPage();page.setDefaultTimeout(5000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.abort());await page.route('https://fixture.invalid/',r=>r.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  await page.goto('https://fixture.invalid/');await page.addScriptTag({content:bundle});t.after(async()=>{await page.close();assert.deepEqual(errors,[])});return page;}
const settled=(page,label)=>page.waitForFunction(label=>h.outcomes[label]!==null,label);

test('rapid valid text admissions succeed without a synthetic cooldown failure',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{void h.send('one');void h.send('two');void h.send('three')});await settled(page,'three');
  assert.deepEqual(await page.evaluate(()=>[h.posts.map(x=>x.text),Object.values(h.outcomes).map(x=>x.ok),h.toasts.filter(x=>x.title==='Aguarde um instante').length]),[['one','two','three'],[true,true,true],0]);
});
test('two hook instances preserve the gesture order across asynchronous onMutate',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.delayCancel();void h.send('first',0);void h.send('second',1)});await page.waitForFunction(()=>h.cancelCalls===2);
  assert.equal(await page.evaluate(()=>h.posts.length),0);await page.evaluate(()=>{h.holdSend=true;h.releaseCancel()});await page.waitForFunction(()=>h.posts.length===1);
  assert.equal(await page.evaluate(()=>h.posts[0].text),'first');await page.evaluate(()=>h.finishPost());await settled(page,'second');
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>x.text)),['first','second']);
});
test('a waiting hook exposes pending before its optimistic mutation starts',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first',0);void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost&&h.sends[1].isPending);
  assert.equal(await page.evaluate(()=>h.posts.length),1);await page.evaluate(()=>h.finishPost());await settled(page,'waiting');
  await page.waitForFunction(()=>h.sends.every(x=>!x.isPending));
});
test('strict mode remount keeps pending state reactive through its current generation',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.strict=true;h.render();h.holdSend=true;void h.send('first',0);void h.send('waiting',1)});
  await page.waitForFunction(()=>h.heldPost&&h.sends.every(x=>x.isPending));await page.evaluate(()=>h.finishPost());await settled(page,'waiting');
  await page.waitForFunction(()=>h.sends.every(x=>!x.isPending));assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>x.text)),['first','waiting']);
});
test('pending admissions belong to their generation across permission ABA and a new send',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.ignoreAbort=true;h.holdSend=true;void h.send('old-active',0);void h.send('old-waiting',1)});await page.waitForFunction(()=>h.heldPost&&h.sends[1].isPending);
  await page.evaluate(()=>{const original={...h.scope};h.render({...original,accessScope:'revised'});h.render(original)});
  await page.waitForFunction(()=>h.sends.every(x=>!x.isPending));
  await page.evaluate(()=>{h.delayCancel();void h.send('new',1,{conversation:{...h.conversation,id:'conversation-b'}})});await page.waitForFunction(()=>h.cancelCalls===2&&h.sends[1].isPending);
  assert.equal(await page.evaluate(()=>h.outcomes['old-waiting']),null);await page.evaluate(()=>h.finishPost());await settled(page,'old-waiting');
  assert.equal(await page.evaluate(()=>h.sends[1].isPending),true);await page.evaluate(()=>h.releaseCancel());await settled(page,'new');
  await page.waitForFunction(()=>h.sends.every(x=>!x.isPending));
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>x.text)),['old-active','new']);
});
test('another physical conversation is admitted while its neighbor waits for HTTP',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('held',0)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.holdSend=false;void h.send('independent',1,{conversation:{...h.conversation,id:'conversation-b'}})});await settled(page,'independent');
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>x.text)),['held','independent']);await page.evaluate(()=>h.finishPost());await settled(page,'held');
});
test('file fingerprint preparation reserves its place before a later text gesture',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdFile=true;void h.sendFile('file');void h.send('later',1)});await page.waitForFunction(()=>h.releaseFile);
  assert.equal(await page.evaluate(()=>h.posts.length),0);await page.evaluate(()=>h.releaseFile());await settled(page,'later');
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>x.mediaType||'text')),['document','text']);
});
test('the real attachment batch admits three small files with fast API responses',async t=>{const page=await fixture(t);
  await page.evaluate(()=>h.attachments.addFiles(['a','b','c'].map(x=>new File([x],x+'.pdf',{type:'application/pdf'}))));
  await page.evaluate(()=>void h.attachments.send());await page.waitForFunction(()=>h.posts.length===3&&!h.attachments.busy);
  assert.deepEqual(await page.evaluate(()=>[h.posts.map(x=>x.filename),h.attachments.entries.length,h.attachments.error]),[['a.pdf','b.pdf','c.pdf'],0,'']);
});
for(const mode of ['unjoined','revoked'])test(`queued admission rechecks ${mode} attendance before POST`,async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(mode=>{h.joined=mode!=='unjoined';h.denyAttendance=mode==='revoked';h.finishPost()},mode);await settled(page,'waiting');
  assert.equal(await page.evaluate(()=>h.posts.length),1);assert.equal(await page.evaluate(()=>h.outcomes.waiting.ok),false);
  assert.equal(await page.evaluate(()=>h.outcomes.waiting.code),mode==='revoked'?'whatsapp_session_access_revoked':'whatsapp_attendance_required');
});
for(const mode of ['actor','organization','permission','aba','unmount'])test(`queued admission cannot cross ${mode}`,async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.ignoreAbort=true;h.holdSend=true;void h.send('first');void h.send('old-waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(mode=>{const a={...h.scope};if(mode==='unmount')h.unmount();else{h.render({...a,...(mode==='actor'?{userId:'user-b'}:mode==='organization'?{organizationId:'org-b'}:{accessScope:'revised'})});if(mode==='aba')h.render(a)}h.finishPost()},mode);
  await settled(page,'old-waiting');assert.equal(await page.evaluate(()=>h.posts.length),1);
  assert.equal(await page.evaluate(()=>h.outcomes['old-waiting'].code),'whatsapp_send_context_changed');
});
test('a context change during the queued attendance GET prevents the subsequent POST',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.holdAttendance=true;h.finishPost()});await page.waitForFunction(()=>h.heldAttendance);
  await page.evaluate(()=>{h.ignoreAbort=true;h.render({...h.scope,accessScope:'revised'});h.heldAttendance.resolve({joined:true,entries:[]})});await settled(page,'waiting');
  assert.equal(await page.evaluate(()=>h.posts.length),1);
});
test('a joined attendance cannot borrow a revoked send grant after queueing',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.freshSessions=[{...h.session,status:'connected',can_send:false}];h.finishPost()});await settled(page,'waiting');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.outcomes.waiting.code]),[1,'whatsapp_session_access_revoked']);
});
test('a queued disconnected session is reported as disconnected rather than revoked',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.freshSessions=[{...h.session,status:'disconnected',can_send:false}];h.finishPost()});await settled(page,'waiting');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.outcomes.waiting.code]),[1,'whatsapp_disconnected']);
});
test('navigation to another chat cannot retarget an already queued text intention',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.conversation={...h.conversation,id:'new-conversation',session_id:'new-session',lead_id:'new-lead'};h.render();h.finishPost()});await settled(page,'waiting');
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>[x.id,x.sendSessionId,x.expectedLeadId])),[['conversation-a',undefined,'lead-a'],['conversation-a',undefined,'lead-a']]);
  assert.deepEqual(await page.evaluate(()=>h.requests.find(x=>x.name==='getConversationAttendance').args.slice(0,2)),['conversation-a',{expectedLeadId:'lead-a',sendSessionId:'session-a'}]);
});
test('in-place changes to a caller conversation cannot retarget its queued snapshot',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;h.conversation.lead={id:'lead-a'};void h.send('first');void h.send('waiting',1)});await page.waitForFunction(()=>h.heldPost);
  await page.evaluate(()=>{h.conversation.id='new-conversation';h.conversation.session_id='new-session';h.conversation.lead_id='new-lead';h.conversation.lead.id='new-lead';h.finishPost()});await settled(page,'waiting');
  assert.deepEqual(await page.evaluate(()=>h.posts.map(x=>[x.id,x.expectedLeadId])),[['conversation-a','lead-a'],['conversation-a','lead-a']]);
  assert.deepEqual(await page.evaluate(()=>h.requests.find(x=>x.name==='getConversationAttendance').args.slice(0,2)),['conversation-a',{expectedLeadId:'lead-a',sendSessionId:'session-a'}]);
});
test('an uncertain file retains its original ID across hook instances and performs GET only',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.unknownSend=true;void h.sendFile('original')});await settled(page,'original');
  await page.evaluate(()=>void h.sendFile('check',1));await settled(page,'check');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.checks.length,h.checks[0].clientMessageId===h.posts[0].clientMessageId,h.outcomes.check.result.fileIntentResolution]),[1,1,true,'pending']);
});
test('a concurrent reselection of the same file never admits a second POST',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdSend=true;h.checkStatus='queued';void h.sendFile('first',0);void h.sendFile('duplicate',1)});
  await page.waitForFunction(()=>h.posts.length===1);await page.evaluate(()=>h.finishPost());await settled(page,'first');await settled(page,'duplicate');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.checks.length,h.checks[0].clientMessageId===h.posts[0].clientMessageId,h.outcomes.duplicate.result.fileIntentResolution]),[1,1,true,'accepted']);
});
for(const uncertain of [false,true])test(`same-file hashing cannot invert captions with ${uncertain?'uncertain':'known'} original outcome`,async t=>{const page=await fixture(t);
  await page.evaluate(uncertain=>{h.holdFile=true;h.holdSend=!uncertain;h.unknownSend=uncertain;h.checkStatus=uncertain?undefined:'queued';
    void h.sendFile('first',0,'same bytes',{text:'earliest caption'});void h.sendFile('second',1,'same bytes',{text:'later caption'})},uncertain);
  await page.waitForFunction(()=>h.releaseFiles.first);assert.deepEqual(await page.evaluate(()=>h.hashStarts),['first']);
  await page.evaluate(()=>h.releaseFiles.first());await page.waitForFunction(()=>h.posts.length===1);
  if(!uncertain){assert.deepEqual(await page.evaluate(()=>h.hashStarts),['first']);await page.evaluate(()=>h.finishPost())}
  await page.waitForFunction(()=>h.releaseFiles.second);await page.evaluate(()=>h.releaseFiles.second());await settled(page,'second');
  assert.deepEqual(await page.evaluate(()=>[h.posts.map(x=>x.text),h.checks.length,h.checks[0].clientMessageId===h.posts[0].clientMessageId,h.outcomes.second.result.fileIntentResolution]),[['earliest caption'],1,true,uncertain?'pending':'accepted']);
});
test('a later deliberate reuse after successful completion creates a fresh file intention',async t=>{const page=await fixture(t);
  await page.evaluate(()=>void h.sendFile('first'));await settled(page,'first');await page.evaluate(()=>void h.sendFile('later',1));await settled(page,'later');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.checks.length,h.posts[0].clientMessageId!==h.posts[1].clientMessageId]),[2,0,true]);
});
test('a concurrent selection cannot resend an earlier unknown file settled by its verification',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.unknownSend=true;void h.sendFile('original')});await settled(page,'original');
  await page.evaluate(()=>{h.unknownSend=false;h.holdChecks=true;void h.sendFile('verify',0,'same synthetic file',{fileIntentVerificationOnly:true});void h.sendFile('selection',1)});
  await page.waitForFunction(()=>h.checks.length===1);await page.evaluate(()=>{h.holdChecks=false;h.checkStatus='queued';const call=h.requests.find(x=>x.name==='getSendStatus');call.resolve(h.canonical({conversation:h.conversation,clientMessageId:call.args[0].clientMessageId}))});
  await settled(page,'verify');await settled(page,'selection');
  assert.deepEqual(await page.evaluate(()=>[h.posts.length,h.checks.length,h.checks.every(x=>x.clientMessageId===h.posts[0].clientMessageId),h.outcomes.selection.result.fileIntentResolution]),[1,2,true,'accepted']);
});

test('connection response cannot elevate can_send before a fresh authorized list',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdLists=true;h.status()});await page.waitForFunction(()=>h.requests.some(x=>x.name==='getSessions'));
  assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>[x[0].status,x[0].can_send])),[['connected',false],['connected',false]]);
  await page.evaluate(()=>h.requests.find(x=>x.name==='getSessions').resolve({data:[{...h.session,status:'connected',can_send:true}],meta:{total:1}}));
  await page.waitForFunction(()=>h.statusOutcome==='ok');assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>x[0].can_send)),[true,true]);
});
test('a disconnected observation lowers can_send in both caches immediately',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.seed([{...h.session,status:'connected',can_send:true}]);h.statusResponse={connected:false,status:'disconnected'};h.holdLists=true;h.status()});
  await page.waitForFunction(()=>h.requests.some(x=>x.name==='getSessions'));
  assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>[x[0].status,x[0].can_send])),[['disconnected',false],['disconnected',false]]);
  await page.evaluate(()=>h.requests.find(x=>x.name==='getSessions').resolve({data:[],meta:{}}));await page.waitForFunction(()=>h.statusOutcome==='ok');
  assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>x.length)),[0,0]);
});
test('a fresh read-only grant stays read-only after reconnect',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.freshSessions=[{...h.session,status:'connected',owner_user_id:'admin',can_send:false}];h.status()});await page.waitForFunction(()=>h.statusOutcome==='ok');
  assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>[x[0].status,x[0].can_send])),[['connected',false],['connected',false]]);
});
for(const mode of ['actor','permission','aba'])test(`late authorized list cannot restore access after ${mode}`,async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdLists=true;h.ignoreAbort=true;h.status()});await page.waitForFunction(()=>h.requests.some(x=>x.name==='getSessions'));
  await page.evaluate(mode=>{const original={...h.scope};h.render({...original,...(mode==='actor'?{userId:'user-b'}:{accessScope:'revised'})});if(mode==='aba')h.render(original);
    h.seed([{...h.session,status:'disconnected',can_send:false}]);h.requests.find(x=>x.name==='getSessions').resolve({data:[{...h.session,status:'connected',can_send:true}],meta:{}})},mode);
  await page.waitForFunction(()=>h.statusOutcome!==null);assert.deepEqual(await page.evaluate(()=>h.cached().map(x=>x[0].can_send)),[false,false]);
});
test('changing scope aborts the authorized list transport as well as ignoring its result',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.holdLists=true;h.status()});await page.waitForFunction(()=>h.requests.some(x=>x.name==='getSessions'));
  await page.evaluate(()=>{h.render({...h.scope,accessScope:'revised'});h.seed()});await page.waitForFunction(()=>h.statusOutcome!==null);
  assert.deepEqual(await page.evaluate(()=>[h.requests.find(x=>x.name==='getSessions').aborted,h.cached().map(x=>x[0].can_send)]),[true,[false,false]]);
});
test('live status reconciliation refreshes permissions in both caches too',async t=>{const page=await fixture(t);
  await page.evaluate(()=>{h.freshSessions=[{...h.session,status:'connected',can_send:true}];h.live=true;h.render()});
  await page.waitForFunction(()=>h.cached().every(x=>x[0]?.can_send===true));
  assert.deepEqual(await page.evaluate(()=>h.requests.map(x=>x.name)),['getConnectionStatus','getSessions']);
});
