import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

const repository=process.cwd(), hookRoot=process.env.WHATSAPP_DRAFT_BASELINE_ROOT||repository;
const ownerA={userId:'user-a',organizationId:'org-a',accessScope:'role-a'};
const emptyScope={userId:null,organizationId:null,accessScope:''};
const script=buildReactBrowserHarness({repository,modules:{
  '@/lib/whatsapp-message-input':transpile(join(repository,'lib/whatsapp-message-input.ts')),
  '@/lib/whatsapp-draft-store':transpile(join(repository,'lib/whatsapp-draft-store.ts')),
  draft:transpile(join(hookRoot,'hooks/use-whatsapp-conversation-draft.ts')),
},entry:`
const {useWhatsAppConversationDraft}=require('draft');
const {getWhatsAppDraftStore}=require('@/lib/whatsapp-draft-store');
const root=createRoot(document.getElementById('root'));
const h=window.harness={scope:window.initialDraftScope||${JSON.stringify(ownerA)},chat:'chat-a',floatingChat:window.initialFloatingChat,lead:'lead-a',views:{},store:getWhatsAppDraftStore(),
 render(patch={}){Object.assign(this,patch);flushSync(()=>root.render(React.createElement(App)));},
 unmount(){flushSync(()=>root.unmount());}
};
function View({name}){const chat=name==='floating'&&h.floatingChat!==undefined?h.floatingChat:h.chat;
 const draft=useWhatsAppConversationDraft(h.scope,chat,h.lead);React.useLayoutEffect(()=>{h.views[name]=draft;});
 return React.createElement(React.Fragment,null,React.createElement('div',{'data-view':name},draft.text),React.createElement('div',{'data-draft-preview':name},draft.getConversationDraft('chat-a','lead-a')));}
function App(){return React.createElement(React.Fragment,null,React.createElement(View,{name:'page'}),React.createElement(View,{name:'floating'}));}
h.render();
`});
let browser;
before(async()=>{browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();});
async function open(t,initialScope){
  const page=await browser.newPage(),errors=[];
  await page.route('**/*',route=>route.abort());
  await page.route('https://draft-fixture.invalid/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
  page.on('pageerror',error=>errors.push(error.message));
  t.after(async()=>{assert.deepEqual(errors,[]);await page.close();});
  await page.goto('https://draft-fixture.invalid/');
  if(initialScope)await page.evaluate(scope=>{window.initialDraftScope=scope;},initialScope);
  await page.addScriptTag({content:script});return page;
}
async function setText(page,text){await page.evaluate(text=>window.harness.views.page.setText(text),text);await page.waitForFunction(text=>window.harness.views.floating.text===text,text);}

test('draft shares text across two real React surfaces without changing scope',async t=>{
  const page=await open(t);await setText(page,'Visita ainda não enviada');
  assert.equal(await page.locator('[data-view="floating"]').innerText(),'Visita ainda não enviada');
  await page.evaluate(()=>window.harness.views.floating.setText(text=>text+' amanhã'));
  await page.waitForFunction(()=>window.harness.views.page.text==='Visita ainda não enviada amanhã');
  await page.evaluate(scope=>window.harness.render({scope}),ownerA);
  assert.equal(await page.locator('[data-view="page"]').innerText(),'Visita ainda não enviada amanhã');
});

test('draft reload keeps persisted text through the initial unresolved auth owner',async t=>{
  const page=await open(t);await setText(page,'Persistido nesta aba');
  await page.reload();await page.evaluate(scope=>{window.initialDraftScope=scope;},emptyScope);await page.addScriptTag({content:script});
  assert.equal(await page.locator('[data-view="page"]').innerText(),'');
  assert.notEqual(await page.evaluate(()=>sessionStorage.getItem('vimob:whatsapp-drafts:v1')),null);
  await page.evaluate(scope=>window.harness.render({scope}),ownerA);
  await page.waitForFunction(()=>window.harness.views.page.text==='Persistido nesta aba');
});

test('draft conversation scope ABA fences a late setText callback',async t=>{
  const page=await open(t);await setText(page,'A inicial');
  await page.evaluate(()=>{window.harness.saved=window.harness.views.page.setText;window.harness.render({chat:'chat-b'});window.harness.render({chat:'chat-a'});});
  await setText(page,'A atual');await page.evaluate(()=>window.harness.saved('A obsoleto'));await page.waitForTimeout(60);
  assert.equal(await page.locator('[data-view="page"]').innerText(),'A atual');
});

test('draft owner ABA fences old targeted writes and clearConversation callbacks',async t=>{
  const page=await open(t);await setText(page,'A inicial');
  await page.evaluate(scope=>{const h=window.harness;h.savedWrite=h.views.page.setConversationDraft;h.savedClear=h.views.page.clearConversation;h.render({scope});h.render({scope:{userId:'user-a',organizationId:'org-a',accessScope:'role-a'}});},{...ownerA,organizationId:'org-b'});
  await setText(page,'Novo A');
  await page.evaluate(()=>{const h=window.harness;h.savedWrite('target-chat','lead-target','late private');h.savedClear('chat-a');});await page.waitForTimeout(60);
  assert.equal(await page.locator('[data-view="page"]').innerText(),'Novo A');
  assert.equal(await page.evaluate(()=>window.harness.views.page.getConversationDraft('target-chat','lead-target')),'');
});

test('draft unmount prevents old callbacks from mutating persisted text',async t=>{
  const page=await open(t);await setText(page,'Keep persisted draft');
  await page.evaluate(()=>{const h=window.harness;h.savedSet=h.views.page.setText;h.savedKey=h.views.page.key;h.unmount();h.savedSet('late after unmount');});
  assert.equal(await page.evaluate(()=>window.harness.store.get(window.harness.savedKey)),'Keep persisted draft');
});

test('draft role change and logout remove old private drafts and reject late writes',async t=>{
  const page=await open(t);await setText(page,'Private old role');
  await page.evaluate(scope=>{window.harness.saved=window.harness.views.page.setText;window.harness.render({scope});},{...ownerA,accessScope:'role-b'});
  assert.equal(await page.locator('[data-view="page"]').innerText(),'');
  await page.evaluate(()=>window.harness.saved('obsolete role text'));
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vimob:whatsapp-drafts:v1')),null);
  await setText(page,'Current role');await page.evaluate(scope=>window.harness.render({scope}),emptyScope);
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('vimob:whatsapp-drafts:v1')),null);
  await page.evaluate(scope=>window.harness.render({scope}),ownerA);assert.equal(await page.locator('[data-view="page"]').innerText(),'');
});

test('draft targeted write supports its own null-to-prepared conversation under the same owner',async t=>{
  const page=await open(t);await page.evaluate(()=>{const h=window.harness;h.render({chat:null});h.savedTargeted=h.views.page.setConversationDraft;h.render({chat:'prepared-chat'});h.savedTargeted('prepared-chat','lead-a','Own prepared draft');});
  await page.waitForFunction(()=>window.harness.views.page.text==='Own prepared draft');
  assert.equal(await page.locator('[data-view="floating"]').innerText(),'Own prepared draft');
});

test('draft changes update a second inbox surface whose current conversation is null',async t=>{
  const page=await open(t);await page.evaluate(()=>window.harness.render({floatingChat:null}));
  await page.evaluate(()=>window.harness.views.page.setText('Draft for inbox row'));
  await page.waitForFunction(()=>window.harness.views.page.text==='Draft for inbox row');await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-draft-preview="floating"]').innerText(),'Draft for inbox row');
  assert.equal(await page.locator('[data-view="floating"]').innerText(),'');
  await page.evaluate(()=>window.harness.views.page.clearConversation('chat-a'));await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-draft-preview="floating"]').innerText(),'');
});

test('draft reload with no selected conversation repaints its persisted inbox preview after owner resolves',async t=>{
  const page=await open(t);await setText(page,'Persisted inbox preview');await page.reload();
  await page.evaluate(scope=>{window.initialDraftScope=scope;window.initialFloatingChat=null;},emptyScope);await page.addScriptTag({content:script});
  assert.equal(await page.locator('[data-draft-preview="floating"]').innerText(),'');
  await page.evaluate(scope=>window.harness.render({scope}),ownerA);await page.waitForTimeout(80);
  assert.equal(await page.locator('[data-draft-preview="floating"]').innerText(),'Persisted inbox preview');
});
