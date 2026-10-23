import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from '../whatsapp-react-browser-test-harness.mjs';

const repository = process.cwd();
const require = createRequire(import.meta.url), modules = {};
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
// Extract the actual list hook, not a mirrored query/caching implementation.
const listFile = join(repository, 'hooks/use-whatsapp-conversations.ts');
const listSource = ts.createSourceFile(listFile, readFileSync(listFile, 'utf8'), ts.ScriptTarget.Latest, true);
const listNames = new Set(['useWhatsAppConversations', 'WHATSAPP_CONVERSATIONS_REFETCH_MS', 'WHATSAPP_CONVERSATIONS_PAGINATED_REFETCH_MS']);
const listNodes = listSource.statements.filter(node => ts.isFunctionDeclaration(node)
  ? listNames.has(node.name?.text) : ts.isVariableStatement(node)
    && node.declarationList.declarations.some(declaration => listNames.has(declaration.name.getText(listSource))));
assert.equal(listNodes.length, 3);
modules['list-hook'] = `const{useInfiniteQuery,useQueryClient}=require('@tanstack/react-query');const{useMemo}=require('react');
  const{readWhatsAppInbox}=require('@/lib/whatsapp-inbox-access');
  const{whatsappQueryKeys}=require('@/lib/whatsapp-query-cache');const{whatsappAPI}=require('@/lib/api/whatsapp');
  const useWhatsAppQueryScope=()=>window.h.scope;` + ts.transpileModule(listNodes.map(node => node.getText(listSource)).join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const script = buildReactBrowserHarness({ repository, modules: {
  ...modules,
  '@/lib/api/whatsapp': 'exports.whatsappAPI={getMessages:(p,t)=>window.h.request(p,t),getConversationsPage:(p,t)=>window.h.listRequest(p,t)};',
  '@/lib/whatsapp-message-order': transpile(join(repository, 'lib/whatsapp-message-order.ts')),
  '@/lib/whatsapp-query-cache': transpile(join(repository, 'lib/whatsapp-query-cache.ts')),
  '@/lib/whatsapp-inbox-access': transpile(join(repository, 'lib/whatsapp-inbox-access.ts')),
  '@/lib/whatsapp-message-input': transpile(join(repository, 'lib/whatsapp-message-input.ts')),
  '@/lib/whatsapp-canonical-conversation-preview': transpile(join(repository, 'lib/whatsapp-canonical-conversation-preview.ts')),
  '@/lib/whatsapp-access-revocation': transpile(join(repository, 'lib/whatsapp-access-revocation.ts')),
  hook: transpile(join(repository, 'hooks/whatsapp/use-whatsapp-visible-canonical-previews.ts')),
}, entry: `
  const {useWhatsAppVisibleCanonicalPreviews}=require('hook');
  const {useWhatsAppConversations}=require('list-hook');
  const {QueryClient,QueryClientProvider}=require('@tanstack/react-query');
  const {WHATSAPP_MESSAGES_RECONCILE_EVENT}=require('@/lib/whatsapp-query-cache');
  process.env.NODE_ENV=window.fixtureMode||'development';
  const root=createRoot(document.getElementById('root')),baseTime=Date.now();
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const h=window.h={requests:[],listRequests:[],observers:[],views:{},revision:1,clock:0,enabled:true,count:1,
    canonicalList:!!window.fixtureCanonicalList,
    scope:{organizationId:'org-a',userId:'actor-a',accessScope:'permission:sid-a'},source:'page-a',
    card(index){const tail=String(index+1).padStart(12,'0');return{id:'20000000-0000-4000-8000-'+tail,
      session_id:'30000000-0000-4000-8000-000000000001',lead_id:'40000000-0000-4000-8000-'+tail,
      last_message:'Legacy preview',last_message_at:'2026-10-14T02:19:29Z',is_group:false};},
    cards:[],
    listRequest(params,transport){this.listRequests.push({params,transport});return this.listFailure?Promise.reject(this.listFailure):Promise.resolve({conversations:this.cards,nextCursor:null});},
    request(params,transport){const card={...this.cards.find(c=>c.id===params.conversationId)};
      return new Promise((resolve,reject)=>this.requests.push({params,transport,card,resolve,reject}));},
    complete(index,fromMe=true,status='delivered'){const r=this.requests[index],tail=r.params.conversationId.slice(-12);
      r.resolve({messages:[{id:r.headId||'50000000-0000-4000-8000-'+tail,conversation_id:r.params.conversationId,
        session_id:r.card.session_id,from_me:fromMe,status,content:'Canonical visible '+tail,message_type:'text',
        sent_at:r.headTime||'2026-10-14T02:19:29Z',message_id:'provider-'+tail}],nextCursor:null});},
    render(changes={}){Object.assign(this,changes);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement('section',null,
      Array.from({length:this.count},(_,index)=>React.createElement(Surface,{key:index,index}))))));},
    emit(ids,visible=true,observer=0){const o=this.observers[observer];o.callback([...o.nodes].filter(n=>ids.includes(n.dataset.conversationId))
      .map(target=>({target,isIntersecting:visible})));},
    emitAll(observer=0){const o=this.observers[observer];this.emit([...o.nodes].map(n=>n.dataset.conversationId),true,observer);},
    hint(detail={}){window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT,{detail:{scope:this.scope,...detail}}));},
    unmount(){flushSync(()=>root.render(null));},
  };
  Date.now=()=>baseTime+h.clock;
  window.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;this.nodes=new Set();this.disconnected=false;h.observers.push(this);}
    observe(node){this.nodes.add(node);}unobserve(node){this.nodes.delete(node);}disconnect(){this.disconnected=true;this.nodes.clear();}};
  function Surface({index}){const list=useWhatsAppConversations(undefined,undefined,undefined,80,{enabled:h.canonicalList,refetchOnWindowFocus:false});
    const cards=h.canonicalList?list.data:h.cards;
    const result=useWhatsAppVisibleCanonicalPreviews({conversations:cards,scope:h.scope,listRevision:h.revision,
    enabled:h.enabled,sourceKey:h.source+':'+index,pausedConversationId:h.pausedConversationId});React.useEffect(()=>{h.views[index]={...result,conversations:cards,refetchList:list.refetch,listError:list.isError};});
    return React.createElement('div',null,(h.detached?[]:cards).map(card=>React.createElement('div',{key:card.id,ref:result.previewCardRef,
      'data-conversation-id':card.id},card.last_message)));}
  h.cards=Array.from({length:window.fixtureCards||6},(_,i)=>h.card(i));
  if(window.fixtureOwnFields)h.cards=h.cards.map(c=>({...c,...window.fixtureOwnFields}));
  h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { hostname = '127.0.0.1', mode = 'development', cards = 6, ownFields, canonicalList = false } = {}) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', route => route.abort());
  const url = `http://${hostname}:3444/visible-fixture/`;
  await page.route(url, route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto(url);
  await page.evaluate(value => { window.fixtureMode = value.mode; window.fixtureCards = value.cards; window.fixtureOwnFields = value.ownFields; window.fixtureCanonicalList = value.canonicalList; }, { mode, cards, ownFields, canonicalList });
  await page.addScriptTag({ content: script });
  assert.equal(await page.evaluate(() => typeof window.h), 'object', errors.join('\n'));
  return page;
}
const settle = page => page.waitForTimeout(30);
const count = page => page.evaluate(() => h.requests.length);
const previews = page => page.evaluate(() => h.views[0].previews);
async function complete(page, index, fromMe = true, status = 'delivered') {
  await page.evaluate(v => h.complete(v.index, v.fromMe, v.status), { index, fromMe, status }); await settle(page);
}

for (const options of [
  { mode: 'production' }, { hostname: 'published-fixture.invalid' },
  { mode: 'production', hostname: '192.168.1.3' },
  { hostname: '192.168.1.3.public-fixture.invalid' }, { hostname: '10.public-fixture.invalid' },
  { hostname: '172.15.1.3' }, { hostname: '172.32.1.3' }, { hostname: '192.169.1.3' },
  { ownFields: { last_message_from_me: null, last_message_status: null } },
  { ownFields: { last_message_status: 'sent' } },
]) test(`no observer or SDK request outside local legacy eligibility: ${JSON.stringify(options)}`, async t => {
  const page = await fixture(t, options);
  assert.equal(await page.evaluate(() => h.observers.length), 0); assert.equal(await count(page), 0);
});

for (const hostname of ['192.168.1.3', '10.0.0.3', '172.16.0.3', '172.31.255.3'])
test(`a LAN development list warms unselected visible legacy cards with the same bounded scoped reads: ${hostname}`, async t => {
  const page = await fixture(t, { hostname });
  assert.equal(await count(page), 0, 'offscreen cards never start a compatibility read');
  await page.evaluate(() => h.emitAll()); await settle(page);
  assert.equal(await count(page), 4, 'LAN preview shares the existing four-read limit');
  for (let index = 0; index < 6; index++) await complete(page, index, index % 2 === 0, index % 2 === 0 ? 'read' : 'received');
  const result = await previews(page);
  assert.equal(result.length, 6, 'every visible card is resolved without selecting it');
  assert.equal(result.filter(value => value.fromMe && value.status === 'read').length, 3);
  assert.equal(result.filter(value => !value.fromMe && value.status === 'received').length, 3);
  assert.ok(await page.evaluate(() => h.requests.every(request => request.params.includeMediaUrls === false
    && request.params.limit === 10 && request.transport.expectedUserId === h.scope.userId)));
});

test('only visible cards read, at most four leases, correct SDK shape and complete canonical tuples', async t => {
  const page = await fixture(t);
  assert.equal(await count(page), 0);
  await page.evaluate(() => h.emitAll()); await settle(page); assert.equal(await count(page), 4);
  assert.equal(await page.evaluate(() => h.observers.length), 1);
  assert.equal(await page.evaluate(() => h.observers[0].options.rootMargin), '96px');
  const request = await page.evaluate(() => ({ params: h.requests[0].params, expectedUserId: h.requests[0].transport.expectedUserId }));
  assert.equal(request.params.limit, 10); assert.equal(request.params.cursor, null); assert.equal(request.params.includeMediaUrls, false);
  assert.equal(request.expectedUserId, 'actor-a'); assert.ok(request.params.expectedLeadId);
  await complete(page, 0); assert.equal(await count(page), 5);
  assert.equal((await previews(page))[0].status, 'delivered'); assert.equal((await previews(page))[0].fromMe, true);
  await complete(page, 1, false, 'received'); assert.equal(await count(page), 6);
  assert.ok((await previews(page)).some(p => p.fromMe === false && p.status === 'received'));
});

test('two widgets share global four leases and a queued unmounted widget never sends', async t => {
  const page = await fixture(t, { cards: 4 });
  await page.evaluate(() => h.render({ count: 2 })); await page.evaluate(() => { h.emitAll(0); h.emitAll(1); }); await settle(page);
  assert.equal(await count(page), 4);
  await page.evaluate(() => h.render({ count: 1 })); await complete(page, 0); assert.equal(await count(page), 4);
});

test('scope retirement aborts but retains global leases until ignored-abort transports settle', async t => {
  const page = await fixture(t, { cards: 4 }); await page.evaluate(() => h.emitAll()); await settle(page);
  await page.evaluate(() => h.render({ scope: { ...h.scope, accessScope: 'permission:sid-b' } }));
  await page.evaluate(() => h.emitAll(1)); await settle(page);
  assert.equal(await count(page), 4);
  assert.equal(await page.evaluate(() => h.requests.every(r => r.transport.signal.aborted)), true);
  await complete(page, 0); assert.equal(await count(page), 5); assert.equal((await previews(page)).length, 0);
  await complete(page, 4); assert.equal((await previews(page))[0].scope.accessScope, 'permission:sid-b');
});

test('offscreen and detached targets do not drain queued reads or publish a late response', async t => {
  const page = await fixture(t, { cards: 5 }); await page.evaluate(() => h.emitAll()); await settle(page);
  await page.evaluate(() => h.emit([h.cards[4].id, h.cards[1].id], false)); await complete(page, 0);
  assert.equal(await count(page), 4); await complete(page, 1); assert.equal((await previews(page)).length, 1);
  await page.evaluate(() => h.render({ cards: h.cards.slice(2) })); await settle(page); assert.equal((await previews(page)).length, 0);
});

test('cached binding A to B to A cannot revive the former tuple before a new authorized raw head', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  assert.equal((await previews(page)).length, 1);
  await page.evaluate(() => { h.original = h.cards[0]; h.render({ cards: [{ ...h.original, lead_id: '40000000-0000-4000-8000-999999999999' }] }); }); await settle(page);
  assert.equal((await previews(page)).length, 0);
  await page.evaluate(() => h.render({ cards: [h.original] })); await settle(page); assert.equal((await previews(page)).length, 0);
  await complete(page, 1); assert.equal((await previews(page)).length, 0);
  await complete(page, 2); assert.equal((await previews(page)).length, 1);
});

test('scoped hints coalesce, update receipts and never refresh a foreign Auth SID', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.hint({ scope: { ...h.scope, accessScope: 'foreign-sid' } })); await settle(page); assert.equal(await count(page), 1);
  await page.evaluate(() => { h.hint(); h.hint(); }); await settle(page); assert.equal(await count(page), 1);
  await page.evaluate(() => { h.clock = 5_000; h.hint(); }); await settle(page); assert.equal(await count(page), 2);
  await complete(page, 1, true, 'read'); assert.equal((await previews(page))[0].status, 'read');
  await page.evaluate(() => { h.clock = 10_000; h.hint(); }); await settle(page); await complete(page, 2, false, 'received');
  assert.equal((await previews(page))[0].fromMe, false);
});

test('authorization hint clears immediately, aborts pending reads and denies late resurrection', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 5_000; h.hint(); }); await settle(page);
  await page.evaluate(() => h.hint({ authorizationChanged: true })); await settle(page); assert.equal((await previews(page)).length, 0);
  assert.equal(await page.evaluate(() => h.requests[1].transport.signal.aborted), true);
  await complete(page, 1); assert.equal((await previews(page)).length, 0);
});

test('a current SDK error removes the previous tuple and releases the read lease', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 5_000; h.hint(); }); await settle(page);
  await page.evaluate(() => h.requests[1].reject({ status: 403 })); await settle(page);
  assert.equal((await previews(page)).length, 0);
  await page.evaluate(() => { h.clock = 10_000; h.hint(); }); await settle(page); assert.equal(await count(page), 3);
});

test('a mismatched raw physical session cannot publish or retain a cached tuple', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 5_000; h.hint(); }); await settle(page);
  await page.evaluate(() => { h.requests[1].card.session_id = '30000000-0000-4000-8000-000000000002'; h.complete(1); }); await settle(page);
  assert.equal((await previews(page)).length, 0);
});

test('new authoritative API fields retire the compatibility observer and old preview', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.render({ cards: h.cards.map(c => ({ ...c, last_message_from_me: null, last_message_status: null })) })); await settle(page);
  assert.equal((await previews(page)).length, 0); assert.equal(await page.evaluate(() => h.observers[0].disconnected), true);
});

test('Auth UID organization and source A to B to A keep old IO and response callbacks retired', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page);
  await page.evaluate(() => h.render({ scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'permission:sid-b' }, source: 'other-source' }));
  await page.evaluate(() => h.render({ scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'permission:sid-a' }, source: 'page-a' }));
  await complete(page, 0); assert.equal((await previews(page)).length, 0);
  await page.evaluate(() => h.observers[0].callback([{ target: document.querySelector('[data-conversation-id]'), isIntersecting: true }]));
  await settle(page); assert.equal(await count(page), 1);
});

test('scroll out and back retains the authorized receipt without another head request', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.emit([h.cards[0].id], false)); await settle(page);
  assert.equal((await previews(page)).length, 1);
  await page.evaluate(() => h.emitAll()); await settle(page);
  assert.equal((await previews(page))[0].status, 'delivered'); assert.equal(await count(page), 1);
});

test('ref detach and reattach retain the same bound receipt without a new GET', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.render({ detached: true })); await settle(page);
  assert.equal((await previews(page)).length, 1);
  await page.evaluate(() => { h.render({ detached: false }); h.emitAll(); }); await settle(page);
  assert.equal(await count(page), 1); assert.equal((await previews(page))[0].status, 'delivered');
});

test('equivalent list revision and page append do not reread a fresh unchanged head', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 5_000; h.render({ revision: 2, cards: h.cards.map(c => ({ ...c })) }); }); await settle(page);
  assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ revision: 3, cards: [...h.cards, h.card(1)] })); await settle(page);
  assert.equal(await count(page), 1); assert.equal((await previews(page)).length, 1);
});

test('hiding and returning to the same authorized surface retains its cached tuple', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.render({ enabled: false })); await settle(page); assert.equal((await previews(page)).length, 0);
  await page.evaluate(() => { h.render({ enabled: true }); h.emitAll(1); }); await settle(page);
  assert.equal((await previews(page))[0]?.status, 'delivered'); assert.equal(await count(page), 1);
});

test('TTL schedules revalidation only on a trigger and keeps the tuple through a transient failure', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 29_999; h.render({ revision: 2 }); }); await settle(page); assert.equal(await count(page), 1);
  await page.evaluate(() => { h.clock = 30_000; h.render({ revision: 3 }); }); await settle(page); assert.equal(await count(page), 2);
  assert.equal((await previews(page))[0].status, 'delivered');
  await page.evaluate(() => h.requests[1].reject({ status: 500, code: 'api_error' })); await settle(page);
  assert.equal((await previews(page))[0].status, 'delivered'); assert.equal(await count(page), 2);
  await page.evaluate(() => { h.clock = 30_300; h.hint(); }); await settle(page); assert.equal(await count(page), 3);
  await complete(page, 2, true, 'read'); assert.equal((await previews(page))[0].status, 'read');
});

test('status hints revalidate within 300ms and retain the prior receipt while awaiting the server', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 300; h.hint(); h.hint(); h.hint(); }); await settle(page);
  assert.equal(await count(page), 2); assert.equal((await previews(page))[0].status, 'delivered');
  await complete(page, 1, true, 'read'); assert.equal((await previews(page))[0].status, 'read');
});

test('a newer list head clears an unsafe receipt and replaces the whole canonical tuple', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 300; h.render({ cards: h.cards.map(c => ({ ...c, last_message: 'New incoming preview', last_message_at: '2026-10-14T02:19:30Z' })) }); });
  await settle(page); assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 2);
  await page.evaluate(() => { h.requests[1].headTime = '2026-10-14T02:19:30Z'; h.requests[1].headId = '60000000-0000-4000-8000-000000000001'; h.complete(1, false, 'received'); });
  await settle(page); const current = (await previews(page))[0];
  assert.equal(current.fromMe, false); assert.equal(current.status, 'received'); assert.equal(current.messageId, '60000000-0000-4000-8000-000000000001');
});

test('offscreen authorization hints retire retained tuples without reading hidden cards', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.emit([h.cards[0].id], false); h.hint({ authorizationChanged: true, conversationIds: [h.cards[0].id] }); });
  await settle(page); assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 1);
  await page.evaluate(() => h.emitAll()); await settle(page); assert.equal(await count(page), 2);
});

test('paused surface receives revocation and binding ABA without reviving its former snapshot', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.render({ enabled: false }); h.hint({ authorizationChanged: true }); h.render({ enabled: true }); h.emitAll(1); });
  await settle(page); assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 2);
  await complete(page, 1); assert.equal((await previews(page)).length, 1);
  await page.evaluate(() => { h.original = h.cards[0]; h.render({ enabled: false });
    h.render({ cards: [{ ...h.original, lead_id: '40000000-0000-4000-8000-999999999999' }] });
    h.render({ cards: [h.original] }); h.render({ enabled: true }); h.emitAll(2); });
  await settle(page); assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 3);
});

test('official null or partial fields during pause prevent an old legacy receipt from resurrecting', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.original = h.cards[0]; h.render({ enabled: false });
    h.render({ cards: [{ ...h.original, last_message_status: 'read' }] });
    h.render({ cards: [h.original] }); h.render({ enabled: true }); h.emitAll(1); });
  await settle(page); assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 2);
});

for (const failure of [{ status: 401, code: 'session_revoked' }, { status: 409, code: 'api_request_identity_changed' }])
  test(`invalid authentication retires every cached card and blocks the same owner: ${failure.code}`, async t => {
    const page = await fixture(t, { cards: 2 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0); await complete(page, 1);
    await page.evaluate(() => { h.clock = 300; h.hint(); }); await settle(page); assert.equal(await count(page), 4);
    await page.evaluate(value => h.requests[2].reject(value), failure); await settle(page); assert.equal((await previews(page)).length, 0);
    assert.equal(await page.evaluate(() => h.requests[3].transport.signal.aborted), true);
    await complete(page, 3); await page.evaluate(() => { h.clock = 30_000; h.hint(); }); await settle(page);
    assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 4);
  });

test('snapshot retention is capped at 128 and a recently revisited card survives LRU eviction', async t => {
  const page = await fixture(t, { cards: 129 }); await page.evaluate(() => h.emitAll()); await settle(page);
  for (let index = 0; index < 128; index++) await page.evaluate(i => h.complete(i), index);
  await settle(page); assert.equal((await previews(page)).length, 128);
  await page.evaluate(() => { h.emit([h.cards[0].id], false); h.emit([h.cards[0].id]); h.complete(128); }); await settle(page);
  const retained = await previews(page); assert.equal(retained.length, 128);
  assert.ok(retained.some(p => p.conversationId.endsWith('000000000001')));
  assert.ok(!retained.some(p => p.conversationId.endsWith('000000000002')));
});

test('the actual list hook consumes one canonical page for 80 cards and starts no warm reads or observer', async t => {
  const page = await fixture(t, { cards: 80, canonicalList: true, ownFields: { last_message_from_me: true, last_message_status: 'delivered' } });
  await settle(page); const actual = await page.evaluate(() => ({ list: h.listRequests.length,
    limit: h.listRequests[0]?.params.limit, cards: h.views[0].conversations.length,
    complete: h.views[0].conversations.every(c => c.last_message && c.last_message_from_me === true && c.last_message_status === 'delivered'),
    observers: h.observers.length, heads: h.requests.length }));
  assert.deepEqual(actual, { list: 1, limit: 80, cards: 80, complete: true, observers: 0, heads: 0 });
  await page.evaluate(() => h.render({ revision: 2, detached: true })); await page.evaluate(() => h.render({ detached: false })); await settle(page);
  assert.equal(await page.evaluate(() => h.listRequests.length), 1); assert.equal(await count(page), 0);
});

for (const status of [401, 403, 503]) test(`mounted canonical list handles ${status} without retaining denied cards or losing transient data`, async t => {
  const page = await fixture(t, { cards: 2, canonicalList: true, ownFields: { last_message_from_me: false, last_message_status: 'received' } });
  await page.waitForFunction(() => document.querySelectorAll('[data-conversation-id]').length === 2);
  await page.evaluate(async status => { h.listFailure = { status }; await h.views[0].refetchList(); }, status);
  await page.waitForFunction(() => h.views[0].listError === true);
  assert.equal(await page.locator('[data-conversation-id]').count(), status === 503 ? 2 : 0);
  if (status !== 503) assert.doesNotMatch(await page.locator('body').innerText(), /Legacy preview/);
  await page.evaluate(async () => { h.listFailure = null; await h.views[0].refetchList(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-conversation-id]').length === 2 && !h.views[0].listError);
});

for (const failure of [{ status: 410, code: 'conversation_deleted' }, { status: 400, code: 'invalid_whatsapp_reference' },
  { code: 'invalid_response' }, { code: 'domain_validation_error', direction: 'response' },
  { status: 409, code: 'unknown_conflict' }, { status: 503, code: 'session_check_unavailable' }])
  test(`terminal or unclassified revalidation failure retires its tuple: ${failure.code}`, async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 300; h.hint(); }); await settle(page);
  await page.evaluate(value => h.requests[1].reject(value), failure); await settle(page);
  assert.equal((await previews(page)).length, 0);
});

for (const failure of [{ status: 0, code: 'api_timeout' }, { status: 0, code: 'api_unavailable' }])
  test(`known transport failure retains only the previously authorized whole tuple: ${failure.code}`, async t => {
    const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
    await page.evaluate(() => { h.clock = 300; h.hint(); }); await settle(page);
    await page.evaluate(value => h.requests[1].reject(value), failure); await settle(page);
    assert.equal((await previews(page))[0].status, 'delivered');
  });

test('a receipt hint during a pending GET keeps a trailing read after its older response settles', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 300; h.hint(); }); await settle(page); assert.equal(await count(page), 2);
  await page.evaluate(() => { h.clock = 600; h.hint(); }); await complete(page, 1, true, 'delivered');
  assert.equal(await count(page), 3);
  await complete(page, 2, true, 'read'); assert.equal((await previews(page))[0].status, 'read');
});

test('real access loss and restoration use a new owner and cannot reuse a retained receipt', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.originalSource = h.source; h.render({ enabled: false, source: 'page:no-access' });
    h.render({ enabled: true, source: h.originalSource }); h.emitAll(1); }); await settle(page);
  assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 2);
  await complete(page, 1, true, 'read'); assert.equal((await previews(page))[0].status, 'read');
});

test('opening and returning from a warm selected card retains its receipt without another GET', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => h.render({ pausedConversationId: h.cards[0].id })); await settle(page);
  assert.equal((await previews(page))[0]?.status, 'delivered'); assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ pausedConversationId: null })); await settle(page);
  assert.equal((await previews(page))[0]?.status, 'delivered'); assert.equal(await count(page), 1);
});

test('selecting an in-flight card aborts warming and fences its late response before return', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page);
  await page.evaluate(() => h.render({ pausedConversationId: h.cards[0].id })); await settle(page);
  assert.equal(await page.evaluate(() => h.requests[0].transport.signal.aborted), true);
  await complete(page, 0); assert.equal((await previews(page)).length, 0);
  await page.evaluate(() => { h.clock = 301; h.render({ pausedConversationId: null }); }); await settle(page);
  assert.equal(await count(page), 2); await complete(page, 1, true, 'read');
  assert.equal((await previews(page))[0]?.status, 'read');
});

test('selected receipt hints wait for return while retaining the authorized whole tuple', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.clock = 600; h.render({ pausedConversationId: h.cards[0].id }); h.hint(); }); await settle(page);
  assert.equal(await count(page), 1); assert.equal((await previews(page))[0]?.status, 'delivered');
  await page.evaluate(() => h.render({ pausedConversationId: null })); await settle(page);
  assert.equal(await count(page), 2); assert.equal((await previews(page))[0]?.status, 'delivered');
  await complete(page, 1, true, 'read'); assert.equal((await previews(page))[0]?.status, 'read');
});

test('selection never preserves a receipt after authorization retirement', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.render({ pausedConversationId: h.cards[0].id }); h.hint({ authorizationChanged: true }); }); await settle(page);
  assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ pausedConversationId: null })); await settle(page);
  assert.equal(await count(page), 2); await complete(page, 1, true, 'read');
  assert.equal((await previews(page))[0]?.status, 'read');
});

test('selected binding ABA retires the former receipt before a new authorized head', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => {
    h.originalLead = h.cards[0].lead_id; h.render({ pausedConversationId: h.cards[0].id });
    h.render({ cards: h.cards.map(c => ({ ...c, lead_id: '40000000-0000-4000-8000-999999999999' })) });
    h.render({ cards: h.cards.map(c => ({ ...c, lead_id: h.originalLead })) });
  }); await settle(page);
  assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ pausedConversationId: null })); await settle(page);
  assert.equal(await count(page), 2); await complete(page, 1, true, 'read');
  assert.equal((await previews(page))[0]?.status, 'read');
});

test('official null fields replace a selected legacy receipt without compatibility reads', async t => {
  const page = await fixture(t, { cards: 1 }); await page.evaluate(() => h.emitAll()); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.render({ pausedConversationId: h.cards[0].id });
    h.render({ cards: h.cards.map(c => ({ ...c, last_message_from_me: null, last_message_status: null })) });
    h.render({ pausedConversationId: null });
  }); await settle(page);
  assert.equal((await previews(page)).length, 0); assert.equal(await count(page), 1);
});
