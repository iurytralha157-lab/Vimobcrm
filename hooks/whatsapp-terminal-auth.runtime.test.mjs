import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

// The actual hooks, QueryClient and API refresh/retry boundary run together.
// Only auth SDK results and HTTP promises are synthetic; no CRM or DB is used.
const repository = process.cwd(), require = createRequire(join(repository, 'package.json'));
const modules = {};
function cjs(name, parent = repository) {
  if (name === 'react') return 'react';
  const file = require.resolve(name, { paths: [parent] });
  if (modules[file]) return file;
  modules[file] = ' ';
  modules[file] = readFileSync(file, 'utf8').replace(/require\(["']([^"']+)["']\)/g,
    (_, dependency) => `require(${JSON.stringify(cjs(dependency, dirname(file)))})`);
  return file;
}
modules['@tanstack/react-query'] = `module.exports=require(${JSON.stringify(cjs('@tanstack/react-query'))});`;
for (const name of ['whatsapp-query-cache', 'whatsapp-message-input', 'whatsapp-message-order',
  'whatsapp-access-revocation', 'whatsapp-canonical-conversation-preview']) {
  modules['@/lib/' + name] = transpile(join(repository, 'lib/' + name + '.ts'));
}
for (const name of ['vimob-client', 'vimob-error']) modules['@/lib/api/' + name] = transpile(join(repository, 'lib/api/' + name + '.ts'));
modules['@/lib/utils/json'] = transpile(join(repository, 'lib/utils/json.ts'));
modules['@/lib/local-read-only'] = transpile(join(repository, 'lib/local-read-only.ts'));
const script = buildReactBrowserHarness({ repository, modules: {
  ...modules,
  '@/lib/supabase/client': `exports.supabase={auth:{getSession:async()=>({data:{session:null},error:null}),
    refreshSession:()=>new Promise(resolve=>window.h.refreshes.push(resolve))}};`,
  '@/lib/auth/global-sign-out': 'exports.getGlobalSignOutSessionId=()=>null;',
  '@/lib/auth/password-recovery': 'exports.isPasswordRecoveryAccessToken=()=>false;',
  '@/lib/api/whatsapp': `const {vimobAPIRequest}=require('@/lib/api/vimob-client');
    const read=(params,transport={})=>vimobAPIRequest('/v1/synthetic-whatsapp/messages',{retry:false,skipTelemetry:true,
      query:{cursor:params.cursor||'',lead:params.leadId||params.expectedLeadId||''},
      organizationId:params.organizationId,signal:transport.signal||params.signal,
      expectedUserId:transport.expectedUserId??window.h.scope.userId});
    exports.whatsappAPI={getMessages:read,getHistoryAccess:read};`,
  '@/hooks/use-whatsapp-query-scope': 'exports.useWhatsAppQueryScope=()=>window.h.scope;',
  './use-whatsapp-query-scope': 'exports.useWhatsAppQueryScope=()=>window.h.scope;',
  paginated: transpile(join(repository, 'hooks/use-whatsapp-messages-paginated.ts')),
  history: transpile(join(repository, 'hooks/use-lead-messages.ts')),
}, entry: `
  process.env.NEXT_PUBLIC_VIMOB_API_URL='https://synthetic-auth.invalid';
  const {QueryClient,QueryClientProvider}=require('@tanstack/react-query');
  const {useWhatsAppMessagesPaginated}=require('paginated'),{useLeadMessages}=require('history');
  const {whatsappQueryKeys:keys}=require('@/lib/whatsapp-query-cache');
  const api=require('@/lib/api/vimob-client');
  const root=createRoot(document.getElementById('root'));
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const h=window.h={client,keys,requests:[],refreshes:[],failures:[],denials:[],queries:{},mode:window.fixtureMode,
    cid:'20000000-0000-4000-8000-000000000001',lead:'40000000-0000-4000-8000-000000000001',
    sid:'30000000-0000-4000-8000-000000000001',scope:{organizationId:'org-a',userId:'actor-a',accessScope:'permission:sid-a'},
    render(changes={}){Object.assign(this,changes);if(api.getVimobAPIAccessTokenUserId()!==this.scope.userId)
        api.setVimobAPIAccessToken(this.scope.userId?'synthetic-'+this.scope.userId:null,this.scope.userId);
      flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(React.Fragment,null,
        React.createElement(Chat,{id:'main'}),this.peer&&React.createElement(Chat,{id:'peer'})))));},
    complete(index,messages,extra={}){this.requests[index].resolve(new Response(JSON.stringify({messages,nextCursor:null,...extra}),
      {status:200,headers:{'Content-Type':'application/json'}}));},
    fail(index,status){this.requests[index].resolve(new Response(JSON.stringify({error:{code:status===401?'session_revoked':'synthetic_rejection'}}),
      {status,headers:{'Content-Type':'application/json'}}));},
    refresh(index=0){this.refreshes[index]({data:{session:{access_token:'synthetic-renewed',user:{id:this.scope.userId}}},error:null});},
    markers(){this.markerKeys=[keys.leadMessages({...this.scope,organizationId:'org-b'},this.lead,2),
      keys.leadMessages({...this.scope,userId:'actor-b'},this.lead,2),
      keys.leadMessages({...this.scope,accessScope:'other-permission'},this.lead,2),
      keys.leadMessages(this.scope,'different-lead',2)];this.markerKeys.forEach(key=>client.setQueryData(key,{keep:true}));},
  };
  window.fetch=(url,init)=>new Promise((resolve,reject)=>h.requests.push({url:String(url),init,resolve,reject}));
  function Chat({id}){const options={pageSize:2,expectedLeadId:h.lead,expectedSessionId:h.sid,refetchIntervalMs:false,
      includeMediaUrls:false,historyLeadId:h.mode==='conversation-history'?h.lead:null,
      onConversationUnavailable:()=>h.denials.push(id)};
    return h.mode==='lead' ? React.createElement(Lead,{id}) : React.createElement(Conversation,{id,options});}
  function Lead({id}){const q=useLeadMessages(h.lead,{pageSize:2});
    React.useEffect(()=>{h.queries[id]=q;});return React.createElement('output',null,JSON.stringify(q.messages));}
  function Conversation({id,options}){const q=useWhatsAppMessagesPaginated(h.cid,options);
    React.useEffect(()=>{h.queries[id]=q;});return React.createElement('output',null,JSON.stringify(q.messages));}
  h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, mode = 'conversation', width = 390) {
  const page = await browser.newPage({ viewport: { width, height: 844 } }), errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(network, []); });
  await page.setContent('<div id="root"></div>');
  await page.evaluate(value => { window.fixtureMode = value; }, mode);
  await page.addScriptTag({ content: script });
  await requests(page, 1);
  await complete(page, 0, 'Previously authorized synthetic history');
  await page.waitForFunction(() => h.queries.main?.messages.length === 1);
  return page;
}
const requests = (page, count) => page.waitForFunction(count => h.requests.length === count, count);
const settle = page => page.waitForTimeout(50);
const messages = (page, id = 'main') => page.evaluate(id => h.queries[id].messages.map(m => m.content), id);
async function complete(page, index, content) {
  await page.evaluate(({ index, content }) => h.complete(index,[{id:'10000000-0000-4000-8000-000000000002',
    conversation_id:h.cid,session_id:h.sid,from_me:true,content,message_type:'text',status:'delivered',
    sent_at:'2026-10-21T12:00:00Z'}]), { index, content });
  await settle(page);
}
async function start(page, method = 'custom', id = 'main') {
  await page.evaluate(({ method, id }) => { const q=h.queries[id];void(method==='custom'?q.retryReconciliation():q.refetch()); }, { method, id });
}
async function terminal401(page, index) {
  await page.evaluate(index => h.fail(index,401), index);
  await page.waitForFunction(() => h.refreshes.length === 1);
  await page.evaluate(() => h.refresh()); await requests(page,index+2);
  await page.evaluate(index => h.fail(index+1,401),index);
  await settle(page);
}

for (const mode of ['conversation','conversation-history','lead']) for (const status of [401,403]) {
  test(`${mode}: terminal${status} clears denied history before Auth changes, keeps other scopes`, {timeout:20_000}, async t => {
    const page=await fixture(t,mode);await page.evaluate(()=>h.markers());
    await start(page,mode==='lead'?'canonical':'custom');await requests(page,2);
    if(status===401) await terminal401(page,1);
    else {await page.evaluate(()=>h.fail(1,403));await settle(page);}
    assert.deepEqual(await messages(page),[]);
    assert.equal(await page.evaluate(()=>h.scope.userId),'actor-a','AuthContext is deliberately still old');
    assert.deepEqual(await page.evaluate(()=>h.markerKeys.map(key=>h.client.getQueryData(key))),Array(4).fill({keep:true}));
    const count=await page.evaluate(()=>h.requests.length);await settle(page);
    assert.equal(await page.evaluate(()=>h.requests.length),count,'denied query does not retry');
  });
}

for(const width of [320,390]) test(`same-actor first401 refresh200 keeps history and normal read at${width}px`,{timeout:20_000},async t=>{
  const page=await fixture(t,'conversation',width);await start(page);await requests(page,2);
  await page.evaluate(()=>h.fail(1,401));await page.waitForFunction(()=>h.refreshes.length===1);await settle(page);
  assert.deepEqual(await messages(page),['Previously authorized synthetic history']);
  assert.deepEqual(await page.evaluate(()=>h.denials),[]);
  await page.evaluate(()=>h.refresh());await requests(page,3);await complete(page,2,'Refreshed authorized history');
  assert.deepEqual(await messages(page),['Refreshed authorized history']);
  assert.equal(await page.evaluate(()=>h.queries.main.isReconciliationError),false);
  assert.deepEqual(await page.evaluate(()=>h.denials),[]);
});

for(const mode of ['conversation','conversation-history','lead']) for(const failure of ['503','offline']) {
  test(`${mode}: ${failure} keeps the authorized cache`,{timeout:20_000},async t=>{
    const page=await fixture(t,mode);await start(page,mode==='lead'?'canonical':'custom');await requests(page,2);
    await page.evaluate(failure=>failure==='503'?h.fail(1,503):h.requests[1].reject(new TypeError('synthetic offline')),failure);
    await settle(page);assert.deepEqual(await messages(page),['Previously authorized synthetic history']);
    assert.deepEqual(await page.evaluate(()=>h.denials),[]);assert.equal(await page.evaluate(()=>h.refreshes.length),0);
  });
}

test('401 without a refreshed session retires history without signing out another scope',{timeout:20_000},async t=>{
  const page=await fixture(t);await start(page);await requests(page,2);await page.evaluate(()=>h.fail(1,401));
  await page.waitForFunction(()=>h.refreshes.length===1);
  await page.evaluate(()=>h.refreshes[0]({data:{session:null},error:{message:'synthetic refresh denied'}}));await settle(page);
  assert.deepEqual(await messages(page),[]);assert.equal(await page.evaluate(()=>h.requests.length),2);
  assert.equal(await page.evaluate(()=>h.scope.userId),'actor-a');
});

test('terminal401 reaches both peers, aborts an older HEAD and cannot be revived by its late success',{timeout:20_000},async t=>{
  const page=await fixture(t);await page.evaluate(()=>h.render({peer:true}));await requests(page,2);
  await start(page,'canonical');await requests(page,3);await terminal401(page,2);
  assert.deepEqual(await messages(page),[]);assert.deepEqual(await messages(page,'peer'),[]);
  assert.equal(await page.evaluate(()=>h.requests[1].init.signal.aborted),true);
  await complete(page,1,'Obsolete private peer head');assert.deepEqual(await messages(page),[]);
  await start(page,'canonical');await requests(page,5);await complete(page,4,'New authorized canonical GET');
  assert.deepEqual(await messages(page),['New authorized canonical GET']);
  assert.deepEqual(await messages(page,'peer'),['New authorized canonical GET']);
});

test('terminal401 aborts a pending search and a late response cannot restore revoked history',{timeout:20_000},async t=>{
  const page=await fixture(t);await page.evaluate(()=>{void h.queries.main.readMessagePage('search-cursor').catch(()=>{});});
  await requests(page,2);await start(page);await requests(page,3);await terminal401(page,2);
  assert.deepEqual(await messages(page),[]);assert.equal(await page.evaluate(()=>h.requests[1].init.signal.aborted),true);
  await complete(page,1,'Obsolete search result');assert.deepEqual(await messages(page),[]);
});

test('scope A to B to A cannot receive its old successful read after terminal401',{timeout:20_000},async t=>{
  const page=await fixture(t);await page.evaluate(()=>{void h.queries.main.readMessagePage('search-cursor').catch(()=>{});});
  await requests(page,2);await start(page);await requests(page,3);await terminal401(page,2);
  await page.evaluate(()=>h.render({scope:{...h.scope,organizationId:'org-b'}}));await requests(page,5);
  await page.evaluate(()=>h.render({scope:{...h.scope,organizationId:'org-a'}}));await settle(page);
  assert.equal(await page.evaluate(()=>h.requests.length),5,'returning to a denied scope does not retry automatically');
  await complete(page,4,'Other organization');await complete(page,1,'Old organization private result');
  assert.deepEqual(await messages(page),[]);await start(page,'canonical');await requests(page,6);
  await complete(page,5,'Current organization authorized again');
  assert.deepEqual(await messages(page),['Current organization authorized again']);
  await page.evaluate(()=>h.render({scope:{...h.scope,userId:null,accessScope:'signed-out'}}));
  assert.deepEqual(await messages(page),[]);
});
