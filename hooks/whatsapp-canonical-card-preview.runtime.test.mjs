import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

const repository = process.cwd(), require = createRequire(import.meta.url);
const modules = {};
// Installed QueryClient/React Query CJS graph, bundled in RAM without webpack.
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
const hookPath = process.env.WHATSAPP_CANONICAL_PREVIEW_BASELINE === '1'
  ? 'D:/Vimob/tmp/whatsapp-canonical-card-preview-20261014/use-whatsapp-messages-paginated.ts.before'
  : join(repository, 'hooks/use-whatsapp-messages-paginated.ts');
const cid = '20000000-0000-4000-8000-000000000001', sid = '30000000-0000-4000-8000-000000000001';
const lead = '40000000-0000-4000-8000-000000000001';
const msgA = 'f0000000-0000-4000-8000-000000000001', msgB = '10000000-0000-4000-8000-000000000002';
const script = buildReactBrowserHarness({ repository, modules: {
  ...modules,
  '@/lib/api/whatsapp': 'exports.whatsappAPI={getMessages:(p,t)=>window.h.request(p,t),getHistoryAccess:(p,t)=>window.h.request(p,t)};',
  './use-whatsapp-query-scope': 'exports.useWhatsAppQueryScope=()=>window.h.scope;',
  '@/lib/whatsapp-message-order': transpile(join(repository, 'lib/whatsapp-message-order.ts')),
  '@/lib/whatsapp-query-cache': transpile(join(repository, 'lib/whatsapp-query-cache.ts')),
  '@/lib/whatsapp-message-input': transpile(join(repository, 'lib/whatsapp-message-input.ts')),
  '@/lib/whatsapp-access-revocation': transpile(join(repository, 'lib/whatsapp-access-revocation.ts')),
  '@/lib/whatsapp-canonical-conversation-preview': transpile(join(repository, 'lib/whatsapp-canonical-conversation-preview.ts')),
  hook: transpile(hookPath),
}, entry: `
  const {QueryClient,QueryClientProvider}=require('@tanstack/react-query');
  const {useWhatsAppMessagesPaginated}=require('hook');
  const {WHATSAPP_MESSAGES_RECONCILE_EVENT}=require('@/lib/whatsapp-query-cache');
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const separateClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const root=createRoot(document.getElementById('root'));
  const h=window.h={client,requests:[],cid:${JSON.stringify(cid)},sid:${JSON.stringify(sid)},lead:${JSON.stringify(lead)},history:null,
    scope:{organizationId:'org-a',userId:'actor-a',accessScope:'permission:sid-a'},
    request(params,transport){return new Promise((resolve,reject)=>this.requests.push({params,transport,resolve,reject}));},
    complete(index,messages,nextCursor=null){this.requests[index].resolve({messages,nextCursor});},
    fail(index,status,code){this.requests[index].reject({status,code:code||(status===403?'forbidden':'temporary')});},
    render(changes={}){Object.assign(this,changes);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(React.Fragment,null,React.createElement(Chat),this.duplicate&&React.createElement(QueryClientProvider,{client:this.separateClient?separateClient:client},React.createElement(Chat,{secondary:true}))))));},
    seed(messages){const q=client.getQueryCache().getAll().find(q=>q.isActive());client.setQueryData(q.queryKey,{pages:[{messages,nextCursor:null}],pageParams:[null]});},
    hint(detail={}){window.dispatchEvent(new CustomEvent(WHATSAPP_MESSAGES_RECONCILE_EVENT,{detail:{scope:this.scope,...detail}}));},
    unmount(){flushSync(()=>root.render(null));},
  };
  function Chat({secondary=false}){const q=useWhatsAppMessagesPaginated(h.cid,{pageSize:2,expectedLeadId:h.lead,expectedSessionId:h.sid,
    historyLeadId:h.history,refetchIntervalMs:false,includeMediaUrls:false});
    React.useEffect(()=>{h[secondary?'secondaryQuery':'query']=q;});return React.createElement('output',null,JSON.stringify(q.canonicalPreview??null));}
  if(window.fixtureHistory)h.history=h.lead;h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, history = false) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.route('https://canonical-card-fixture.invalid/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.goto('https://canonical-card-fixture.invalid/');
  await page.evaluate(value => { window.fixtureHistory = value; }, history);
  await page.addScriptTag({ content: script });
  await page.waitForFunction(() => h.requests.length === 1);
  return page;
}
const row = (id = msgB, patch = {}) => ({ id, conversation_id: cid, session_id: sid, message_id: 'provider-' + id,
  from_me: true, content: 'Canonical head', message_type: 'text', status: 'delivered',
  sent_at: '2026-10-14T02:19:29.123456Z', ...patch });
const settle = page => page.waitForTimeout(35);
const preview = page => page.evaluate(() => h.query.canonicalPreview ?? null);
async function complete(page, index, messages, cursor = null) {
  await page.evaluate(value => h.complete(value.index, value.messages, value.cursor), { index, messages, cursor }); await settle(page);
}

test('raw server ASC head supplies its entire tuple before optimistic merge, with no extra HTTP', async t => {
  const page = await fixture(t);
  await page.evaluate(value => h.seed([value]), row('local-client-id', { status: 'pending', content: 'Not recorded', sent_at: '2026-10-14T03:00:00Z' }));
  await complete(page, 0, [row(msgA, { content: 'Older', status: 'sent' }), row()]);
  assert.equal((await preview(page))?.messageId, msgB);
  assert.equal((await preview(page))?.status, 'delivered');
  assert.equal((await preview(page))?.preview, 'Canonical head');
  assert.equal(await page.evaluate(() => h.requests.length), 1);
  assert.equal(await page.evaluate(() => h.query.messages.some(m => m.id === 'local-client-id')), true);
});

test('historical pagination and quote/search cursor-null reads never replace the captured physical head', async t => {
  const page = await fixture(t); await complete(page, 0, [row()], 'older-cursor');
  await page.evaluate(() => { h.query.loadOlderMessages(); }); await page.waitForFunction(() => h.requests.length === 2);
  await complete(page, 1, [row(msgA, { content: 'Historical row' })]);
  assert.equal((await preview(page))?.messageId, msgB);
  await page.evaluate(() => { h.query.readMessagePage(null).catch(() => {}); }); await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgA, { content: 'Search-only row' })]);
  assert.equal((await preview(page))?.messageId, msgB);
});

test('lead history has no current conversation card fallback', async t => {
  const page = await fixture(t, true); await complete(page, 0, [row()]); assert.equal(await preview(page), null);
});

test('a fresh empty or invalid raw head retires the old fallback instead of reading merged cache', async t => {
  const page = await fixture(t); await complete(page, 0, [row()]); assert.ok(await preview(page));
  await page.evaluate(() => { h.query.retryReconciliation(); }); await page.waitForFunction(() => h.requests.length === 2);
  await complete(page, 1, []); assert.equal(await preview(page), null);
  await page.evaluate(() => { h.query.retryReconciliation(); }); await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgA), row('local-not-canonical')]); assert.equal(await preview(page), null);
});

for (const [label, changes] of [
  ['physical session replacement', { sid: '30000000-0000-4000-8000-000000000002' }],
  ['lead replacement', { lead: '40000000-0000-4000-8000-000000000002' }],
  ['Auth SID replacement', { scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'permission:sid-b' } }],
]) test(`${label} retires the captured tuple and late previous GET`, async t => {
  const page = await fixture(t); await complete(page, 0, [row()]); assert.ok(await preview(page));
  await page.evaluate(() => { h.query.retryReconciliation(); }); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(value => h.render(value), changes); await settle(page); assert.equal(await preview(page), null);
  await complete(page, 1, [row(msgA, { status: 'read' })]); assert.equal(await preview(page), null);
});

test('Auth SID A to B to A cannot revive an old raw HEAD request', async t => {
  const page = await fixture(t);
  await page.evaluate(() => h.render({ scope: { ...h.scope, accessScope: 'permission:sid-b' } })); await settle(page);
  await page.evaluate(() => h.render({ scope: { ...h.scope, accessScope: 'permission:sid-a' } })); await settle(page);
  await complete(page, 0, [row()]); assert.equal(await preview(page), null);
});

for (const status of [500, 403]) test(`head error ${status} drops preview while preserving existing message error policy`, async t => {
  const page = await fixture(t); await complete(page, 0, [row()]); assert.ok(await preview(page));
  await page.evaluate(() => { h.query.retryReconciliation(); }); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(value => h.fail(1, value), status); await settle(page); assert.equal(await preview(page), null);
  assert.equal(await page.evaluate(() => h.query.messages.length), status === 403 ? 0 : 1);
});

test('authorization change drops preview before revalidation completes', async t => {
  const page = await fixture(t); await complete(page, 0, [row()]); assert.ok(await preview(page));
  await page.evaluate(() => h.hint({ authorizationChanged: true })); await settle(page); assert.equal(await preview(page), null);
});

for (const mode of ['cancelled-query', 'manual-overlap']) test(`${mode}: a later raw HEAD wins over an older same-scope completion`, async t => {
  const page = await fixture(t); await complete(page, 0, [row()]);
  await page.evaluate(value => {
    if (value === 'manual-overlap') h.query.retryReconciliation();
    else h.query.refetch();
  }, mode); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => { h.query.refetch({ cancelRefetch: true }); }); await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgB, { content: 'Newer snapshot', status: 'read' })]);
  assert.equal((await preview(page))?.status, 'read');
  await complete(page, 1, [row(msgA, { content: 'Older snapshot', status: 'sent' })]);
  assert.equal((await preview(page))?.messageId, msgB);
  assert.equal((await preview(page))?.status, 'read');
});

for (const mode of ['cancelled-query', 'manual-overlap']) test(`${mode}: an obsolete head error cannot clear a newer tuple or report a stale reconciliation failure`, async t => {
  const page = await fixture(t); await complete(page, 0, [row()]);
  await page.evaluate(value => { if (value === 'manual-overlap') h.query.retryReconciliation(); else h.query.refetch(); }, mode);
  await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => { h.query.refetch({ cancelRefetch: true }); }); await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgB, { status: 'read' })]);
  await page.evaluate(() => h.fail(1, 500)); await settle(page);
  assert.equal((await preview(page))?.messageId, msgB);
  assert.equal((await preview(page))?.status, 'read');
  assert.equal(await page.evaluate(() => Boolean(h.query.isReconciliationError)), false);
});

test('identity-changed error from quote/search retires the preview without capturing that read', async t => {
  const page = await fixture(t); await complete(page, 0, [row()]); assert.ok(await preview(page));
  await page.evaluate(() => { h.query.readMessagePage(null).catch(() => {}); }); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => h.fail(1, 409, 'api_request_identity_changed')); await settle(page);
  assert.equal(await preview(page), null);
});

test('expired historical cursor drops the old tuple until a new current head is authorized', async t => {
  const page = await fixture(t); await complete(page, 0, [row()], 'older-cursor'); assert.ok(await preview(page));
  await page.evaluate(() => { h.query.loadOlderMessages(); }); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => h.fail(1, 409, 'whatsapp_message_cursor_rebase_required')); await settle(page);
  assert.equal(await preview(page), null);
  await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgA, { content: 'Revalidated head', status: 'read' })]);
  assert.equal((await preview(page))?.messageId, msgA);
});

test('late unmounted raw response does not populate a new mounted conversation', async t => {
  const page = await fixture(t); await page.evaluate(() => h.unmount()); await complete(page, 0, [row()]);
  await page.evaluate(() => h.render({ cid: '20000000-0000-4000-8000-000000000002' })); await settle(page);
  assert.equal(await preview(page), null);
});

async function startHeadOverlap(page, source = 'custom') {
  await page.evaluate(source => {
    if (source === 'custom') void h.query.retryReconciliation();
    else void h.query.refetch();
  }, source);
  await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(() => { void h.query.refetch({ cancelRefetch: true }); });
  await page.waitForFunction(() => h.requests.length === 3);
}
const messageTuple = page => page.evaluate(() => h.query.messages.map(({ id, content, status, can_quote }) => ({ id, content, status, can_quote })));

for (const source of ['custom', 'query']) for (const newerStatus of ['read', 'failed']) test(
  `whole HEAD ownership: ${source} cannot replace the same message's newer ${newerStatus} body or receipt`, async t => {
    const page = await fixture(t); await complete(page, 0, [row(msgB, { status: 'delivered' })]);
    await startHeadOverlap(page, source);
    const current = row(msgB, { content: 'New authorized body', status: newerStatus, can_quote: false });
    await complete(page, 2, [current]);
    const expected = [{ id: msgB, content: current.content, status: newerStatus, can_quote: false }];
    assert.deepEqual(await messageTuple(page), expected);
    await complete(page, 1, [row(msgB, { content: 'Obsolete body', status: 'sent', can_quote: true })]);
    assert.deepEqual(await messageTuple(page), expected);
    assert.equal((await preview(page))?.status, newerStatus);
    assert.equal(await page.evaluate(() => h.requests.length), 3, 'no obsolete historical or rebase GET');
  },
);

test('whole HEAD ownership: an obsolete disjoint head cannot trigger a rebase or append its row', async t => {
  const page = await fixture(t); await complete(page, 0, [row(msgA)]);
  await startHeadOverlap(page);
  await complete(page, 2, [row(msgB, { status: 'read', content: 'New current head' })]);
  await complete(page, 1, [row(msgA, { status: 'sent', content: 'Obsolete disjoint head' })], 'obsolete-history');
  assert.equal(await page.evaluate(() => h.requests.length), 3);
  assert.deepEqual((await messageTuple(page)).map(m => m.id), [msgB]);
  assert.equal((await preview(page))?.status, 'read');
});

test('whole HEAD ownership: two observers coalesce one current GET and publish the same canonical tuple', async t => {
  const page = await fixture(t); await complete(page, 0, [row(msgB)]);
  await page.evaluate(() => h.render({ duplicate: true })); await page.waitForFunction(() => h.requests.length === 2 && Boolean(h.secondaryQuery));
  await page.evaluate(() => { void h.query.retryReconciliation(); }); await settle(page);
  assert.equal(await page.evaluate(() => h.requests.length), 2);
  await complete(page, 1, [row(msgB, { status: 'read', content: 'One shared authorized GET' })]);
  assert.deepEqual(await page.evaluate(() => [h.query, h.secondaryQuery].map(q => ({ status:q.messages[0].status, preview:q.canonicalPreview?.status }))),
    [{ status:'read', preview:'read' }, { status:'read', preview:'read' }]);
});

test('whole HEAD ownership: one observer cannot overwrite the other observer current refetch', async t => {
  const page = await fixture(t); await complete(page, 0, [row(msgB)]);
  await page.evaluate(() => h.render({ duplicate: true })); await page.waitForFunction(() => h.requests.length === 2 && Boolean(h.secondaryQuery));
  await page.evaluate(() => { void h.query.refetch(); }); await page.waitForFunction(() => h.requests.length === 3);
  await complete(page, 2, [row(msgB, { status:'read', content:'New shared body' })]);
  await complete(page, 1, [row(msgB, { status:'sent', content:'Other observer old body' })]);
  assert.deepEqual(await page.evaluate(() => [h.query,h.secondaryQuery].map(q => ({status:q.messages[0].status,content:q.messages[0].content}))),
    [{status:'read',content:'New shared body'},{status:'read',content:'New shared body'}]);
});

test('whole HEAD ownership: removing and recreating the Query with the same key retires its old request', async t => {
  const page = await fixture(t); await complete(page, 0, [row(msgB)]);
  await page.evaluate(() => { void h.query.retryReconciliation(); }); await page.waitForFunction(() => h.requests.length === 2);
  await page.evaluate(current => {
    const oldQuery = h.client.getQueryCache().getAll().find(q => q.isActive());
    h.client.removeQueries({queryKey:oldQuery.queryKey,exact:true});
    h.client.setQueryData(oldQuery.queryKey,{pages:[{messages:[current],nextCursor:null}],pageParams:[null]});
    h.render();
  }, row(msgB,{status:'read',content:'Recreated Query body',can_quote:false}));
  await settle(page);
  await complete(page, 1, [row(msgB,{status:'sent',content:'Removed Query body',can_quote:true})]);
  assert.deepEqual(await messageTuple(page),[{id:msgB,status:'read',content:'Recreated Query body',can_quote:false}]);
  assert.equal(await page.evaluate(() => h.requests.length),2);
});

test('whole HEAD ownership: a newer access denial cannot be repopulated by an older same-message success', async t => {
  const page = await fixture(t); await complete(page, 0, [row(msgB)]);
  await startHeadOverlap(page);
  await page.evaluate(() => h.fail(2,403)); await settle(page);
  await complete(page,1,[row(msgB,{status:'sent',content:'Before access denial'})]);
  assert.deepEqual(await messageTuple(page),[]);
  assert.equal(await preview(page),null);
});

test('whole HEAD ownership: a current disjoint head still performs its own canonical rebase', async t => {
  const page=await fixture(t);await complete(page,0,[row(msgA)]);
  await page.evaluate(()=>{void h.query.retryReconciliation();});await page.waitForFunction(()=>h.requests.length===2);
  await complete(page,1,[row(msgB,{status:'read',content:'New disjoint candidate'})]);
  await page.waitForFunction(()=>h.requests.length===3);
  await complete(page,2,[row(msgB,{status:'read',content:'Canonical rebased body'})]);
  assert.deepEqual((await messageTuple(page)).map(m=>({id:m.id,status:m.status,content:m.content})),
    [{id:msgB,status:'read',content:'Canonical rebased body'}]);
  assert.equal((await preview(page))?.preview,'Canonical rebased body');
  assert.equal(await page.evaluate(()=>h.requests.length),3);
});

test('whole HEAD ownership: closing one coalesced observer keeps its shared GET for the remaining observer',async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>h.render({duplicate:true}));await page.waitForFunction(()=>h.requests.length===2&&Boolean(h.secondaryQuery));
  await page.evaluate(()=>{void h.query.retryReconciliation();});await settle(page);
  await page.evaluate(()=>h.render({duplicate:false}));
  await complete(page,1,[row(msgB,{status:'read',content:'Remaining observer body'})]);
  assert.deepEqual((await messageTuple(page)).map(m=>({status:m.status,content:m.content})),[{status:'read',content:'Remaining observer body'}]);
  assert.equal((await preview(page))?.status,'read');
  assert.equal(await page.evaluate(()=>h.requests.length),2);
});

test('whole HEAD ownership: a removed Query denial cannot clear the recreated same-key cache',async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>{void h.query.retryReconciliation();});await page.waitForFunction(()=>h.requests.length===2);
  await page.evaluate(current=>{
    const old=h.client.getQueryCache().getAll().find(q=>q.isActive());h.client.removeQueries({queryKey:old.queryKey,exact:true});
    h.client.setQueryData(old.queryKey,{pages:[{messages:[current],nextCursor:null}],pageParams:[null]});h.render();
  },row(msgB,{status:'read',content:'Fresh Query after removal'}));await settle(page);
  await page.evaluate(()=>h.fail(1,403));await settle(page);
  assert.equal((await messageTuple(page))[0]?.content,'Fresh Query after removal');
  assert.equal(await page.evaluate(()=>h.query.isReconciliationError),false);
});

test('whole HEAD ownership: separate QueryClients never coalesce or publish each other same-key responses',async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>h.render({duplicate:true,separateClient:true}));await page.waitForFunction(()=>h.requests.length===2&&Boolean(h.secondaryQuery));
  await complete(page,1,[row(msgB)]);
  await page.evaluate(()=>{void h.query.retryReconciliation();void h.secondaryQuery.retryReconciliation();});
  await page.waitForFunction(()=>h.requests.length===4);
  await complete(page,2,[row(msgB,{status:'read',content:'First client body'})]);
  await complete(page,3,[row(msgB,{status:'failed',content:'Second client body'})]);
  assert.deepEqual(await page.evaluate(()=>[h.query,h.secondaryQuery].map(q=>({status:q.messages[0].status,content:q.messages[0].content}))),
    [{status:'read',content:'First client body'},{status:'failed',content:'Second client body'}]);
});

test('whole HEAD ownership: a historical read from a removed Query cannot deny its recreated cache',async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)],'older-page');
  await page.evaluate(()=>{void h.query.loadOlderMessages();});await page.waitForFunction(()=>h.requests.length===2);
  await complete(page,1,[row(msgA,{sent_at:'2026-10-14T02:18:00.000000Z'})],'oldest-page');
  await page.evaluate(()=>{void h.query.retryReconciliation();});await page.waitForFunction(()=>h.requests.length===3);
  await complete(page,2,[row(msgB,{status:'read'})],'refresh-history');
  await page.waitForFunction(()=>h.requests.length===4);
  assert.equal(await page.evaluate(()=>h.requests[3].params.cursor),'refresh-history');
  await page.evaluate(current=>{
    const old=h.client.getQueryCache().getAll().find(q=>q.isActive());h.client.removeQueries({queryKey:old.queryKey,exact:true});
    h.client.setQueryData(old.queryKey,{pages:[{messages:[current],nextCursor:null}],pageParams:[null]});h.render();
  },row(msgB,{status:'read',content:'Current Query authorized body'}));await settle(page);
  await page.evaluate(()=>h.fail(3,403));await settle(page);
  assert.equal((await messageTuple(page))[0]?.content,'Current Query authorized body');
  assert.equal(await page.evaluate(()=>h.query.isReconciliationError),false);
});

async function peerCanonicalRead(t) {
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>h.render({duplicate:true}));await page.waitForFunction(()=>h.requests.length===2&&Boolean(h.secondaryQuery));
  await complete(page,1,[row(msgB)]);
  await page.evaluate(()=>{void h.secondaryQuery.refetch();});await page.waitForFunction(()=>h.requests.length===3);
  return page;
}

test('peer lifetime: a canonical HEAD outlives its initiating observer while its peer stays active',async t=>{
  const page=await peerCanonicalRead(t);await page.evaluate(()=>h.render({duplicate:false}));
  await complete(page,2,[row(msgB,{status:'read',content:'Authorized peer body'})]);
  assert.deepEqual((await page.evaluate(()=>h.query.messages)).map(m=>({status:m.status,content:m.content})),[{status:'read',content:'Authorized peer body'}]);
  assert.equal((await preview(page))?.status,'read');
  assert.equal(await page.evaluate(()=>h.query.fetchStatus),'idle');
  assert.equal(await page.evaluate(()=>h.requests.length),3);
});

test('peer lifetime: a canonical denial reaches the active peer without retrying or reviving its old cache',async t=>{
  const page=await peerCanonicalRead(t);await page.evaluate(()=>h.render({duplicate:false}));
  await page.evaluate(()=>h.fail(2,403));await settle(page);
  assert.deepEqual(await page.evaluate(()=>h.query.messages),[]);
  assert.equal(await preview(page),null);
  assert.equal(await page.evaluate(()=>h.query.fetchStatus),'idle');
  assert.equal(await page.evaluate(()=>h.requests.length),3);
});

test('peer lifetime: an infinite refetch historical page outlives its initiating observer',async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>h.render({duplicate:true}));await page.waitForFunction(()=>h.requests.length===2&&Boolean(h.secondaryQuery));
  await complete(page,1,[row(msgB)]);
  await page.evaluate(value=>{
    const query=h.client.getQueryCache().getAll().find(q=>q.isActive());
    h.client.setQueryData(query.queryKey,{pages:[{messages:[value.head],nextCursor:'older-page'},{messages:[value.older],nextCursor:null}],pageParams:[null,'older-page']});
    void h.secondaryQuery.refetch();
  },{head:row(msgB),older:row(msgA,{sent_at:'2026-10-14T02:18:00Z'})});
  await page.waitForFunction(()=>h.requests.length===3);await complete(page,2,[row(msgB,{status:'read'})],'older-page');
  await page.waitForFunction(()=>h.requests.length===4);await page.evaluate(()=>h.render({duplicate:false}));
  await complete(page,3,[row(msgA,{content:'Authorized historical body',sent_at:'2026-10-14T02:18:00Z'})]);
  assert.equal(await page.evaluate(()=>h.query.messages.find(m=>m.content==='Authorized historical body')?.id),msgA);
  assert.equal((await preview(page))?.status,'read');
  assert.equal(await page.evaluate(()=>h.query.fetchStatus),'idle');
  assert.equal(await page.evaluate(()=>h.requests.length),4);
});

for(const denial of [false,true]) test(`peer lifetime: a sole custom HEAD initiator can close before ${denial?'denial':'success'}`,async t=>{
  const page=await fixture(t);await complete(page,0,[row(msgB)]);
  await page.evaluate(()=>h.render({duplicate:true}));await page.waitForFunction(()=>h.requests.length===2&&Boolean(h.secondaryQuery));await complete(page,1,[row(msgB)]);
  await page.evaluate(()=>{void h.secondaryQuery.retryReconciliation();});await page.waitForFunction(()=>h.requests.length===3);
  await page.evaluate(()=>h.render({duplicate:false}));
  if(denial){await page.evaluate(()=>h.fail(2,403));await settle(page);}
  else await complete(page,2,[row(msgB,{status:'read',content:'Shared custom body'})]);
  if(denial){
    await page.evaluate(()=>{void h.query.retryReconciliation();});await settle(page);
    if(await page.evaluate(()=>h.requests.length)===4) await complete(page,3,[row(msgB,{status:'read',content:'Custom cannot restore a denied owner'})]);
    assert.deepEqual(await page.evaluate(()=>h.query.messages),[]);
  }
  assert.deepEqual((await page.evaluate(()=>h.query.messages)).map(m=>({status:m.status,content:m.content})),denial?[]:[{status:'read',content:'Shared custom body'}]);
  assert.equal((await preview(page))?.status??null,denial?null:'read');
  assert.equal(await page.evaluate(()=>h.query.fetchStatus),'idle');assert.equal(await page.evaluate(()=>h.requests.length),3);
});
