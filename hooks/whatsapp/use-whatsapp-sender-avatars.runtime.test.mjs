import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from '@playwright/test';

// Actual React, QueryClient, avatar selection and visibility hooks. Deferred
// summaries/auth and controlled IO are the boundaries; no external requests.
const repository = process.cwd();
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const ids = {
  a: '11111111-1111-4111-8111-111111111111',
  b: '22222222-2222-4222-8222-222222222222',
  c: '33333333-3333-4333-8333-333333333333',
};
let directory, browser, bundle;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-whatsapp-avatars-scope-'));
  const aliases = {};
  const mock = async (name, code) => {
    const file = join(directory, `mock-${Object.keys(aliases).length}.js`);
    await writeFile(file, code); aliases[name] = file;
  };
  await mock('@/hooks/use-whatsapp-query-scope', 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await mock('@/lib/api/user-summaries', 'export const getUserSummaries=(ids,org,transport)=>window.h.request({ids,org,...transport});');
  await mock('@/lib/whatsapp-query-cache', 'export const WHATSAPP_MESSAGES_RECONCILE_EVENT="synthetic-wa-reconcile";');
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{QueryClient,QueryClientProvider}from'@tanstack/react-query';
    import{useWhatsAppSenderAvatars}from'@/hooks/whatsapp/use-whatsapp-sender-avatars';
    import{useWhatsAppMediaVisibility}from'@/hooks/whatsapp/use-whatsapp-media-visibility';
    import{getWhatsAppAvatarCandidates,buildWhatsAppSenderAvatars}from'@/lib/whatsapp-avatar';
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}),root=createRoot(document.getElementById('root'));
    const h=window.h={client,scope:{organizationId:'org-a',userId:'actor-a',accessScope:'access-a'},
      props:{conversationId:'conversation-a',leadId:'lead-a',sessionId:'session-a',messages:[],enabled:true},
      mediaKey:'media-a',mediaEnabled:false,requests:[],observers:[],candidates:getWhatsAppAvatarCandidates,buildAvatars:buildWhatsAppSenderAvatars,
      request(p){return new Promise((resolve,reject)=>{const r={p,aborted:false,settled:false,resolve:v=>{r.settled=true;resolve(v);},reject:e=>{r.settled=true;reject(e);}};this.requests.push(r);this.maxActive=Math.max(this.maxActive||0,this.requests.filter(x=>!x.settled).length);if(p.ids.length>100){r.reject(Object.assign(new Error('Synthetic API limit: max100 user IDs'),{status:400}));return;}const abort=()=>{r.aborted=true;if(!this.ignoreAbort)r.reject(new DOMException('Aborted','AbortError'));};if(p.signal?.aborted)abort();else p.signal?.addEventListener('abort',abort,{once:true});});},
      render(patch={}){if(patch.props)this.props={...this.props,...patch.props};const {props,...other}=patch;Object.assign(this,other);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(View))));},
      resolve(index,users){this.requests[index].resolve(users);},
      reconcile(detail={}){window.dispatchEvent(new CustomEvent('synthetic-wa-reconcile',{detail}));},
      unmount(){flushSync(()=>root.render(null));},
    };
    if(!window.disableSyntheticIO)window.IntersectionObserver=class{constructor(callback,options){this.callback=callback;this.options=options;this.disconnected=false;h.observers.push(this);}observe(element){this.element=element;}disconnect(){this.disconnected=true;}emit(visible,target=this.element){this.callback([{target,isIntersecting:visible}]);}};
    else window.IntersectionObserver=undefined;
    function View(){const avatars=useWhatsAppSenderAvatars(h.props),peerAvatars=useWhatsAppSenderAvatars({...h.props,enabled:!!h.peerEnabled}),ref=React.useRef(null),visible=useWhatsAppMediaVisibility(ref,h.mediaKey,h.mediaEnabled);
      React.useLayoutEffect(()=>{h.avatars=avatars;h.peerAvatars=peerAvatars;h.visible=visible;});return React.createElement('div',{'data-radix-scroll-area-viewport':''},React.createElement('div',{ref,'data-media':''},'Synthetic media'));}
    h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry,
      output: { path: directory, filename: 'fixture.js', publicPath: '' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { ...aliases, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors()
      ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 90_000 });
after(async () => {
  await browser?.close();
  if (directory) {
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep));
    assert.match(basename(target), /^vimob-whatsapp-avatars-scope-/);
    await rm(target, { recursive: true, force: true });
  }
});
async function open(t, noIO = false) {
  const page = await browser.newPage(); page.setDefaultTimeout(4000);
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => { external.push(route.request().url()); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  await page.setContent('<div id="root"></div>');
  await page.evaluate(noIO => { window.process = { env: { NODE_ENV: 'development' } }; window.disableSyntheticIO = noIO; }, noIO);
  await page.addScriptTag({ content: bundle }); return page;
}
const outgoing = id => ({ from_me: true, sender_user_id: id });
const summary = (id, suffix = 'one') => ({ id, avatar_url: `https://avatar.synthetic.invalid/${suffix}.png` });
const render = (page, patch) => page.evaluate(patch => window.h.render(patch), patch);
const waitRequests = (page, count) => page.waitForFunction(count => window.h.requests.length === count, count);
const snapshot = page => page.evaluate(() => ({ avatars: [...window.h.avatars], requests: window.h.requests.map(r => ({ ids: r.p.ids, org: r.p.org, actor: r.p.expectedUserId, aborted: r.aborted })), visible: window.h.visible }));
const resolveRequest = (page, index, users) => page.evaluate(({ index, users }) => window.h.resolve(index, users), { index, users });
const waitAvatarCount = (page, count) => page.waitForFunction(count => window.h.avatars.size === count, count);

test('avatar candidates reject credentials, invalid schemes/control characters and keep unique authorized absolute URLs', async t => {
  const page = await open(t);
  const result = await page.evaluate(() => window.h.candidates(null, '', '/relative.png', 'javascript:alert(1)',
    'data:image/png;base64,cA==', 'https://name:secret@avatar.synthetic.invalid/a.png', 'https://avatar.synthetic.invalid/\u202Ea.png',
    'https://avatar.synthetic.invalid/' + 'a'.repeat(8200), ' https://avatar.synthetic.invalid/a.png ', 'https://avatar.synthetic.invalid/a.png',
    'http://avatar.synthetic.invalid/b.png'));
  assert.deepEqual(result, ['https://avatar.synthetic.invalid/a.png', 'http://avatar.synthetic.invalid/b.png']);
});

test('one authorized sorted batch requests only outgoing UUID authors and ignores foreign DTOs or invalid avatar URLs', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.b.toUpperCase()), outgoing(ids.a), outgoing(ids.a), outgoing('invalid-author'),
    { from_me: false, sender_user_id: ids.c }, { from_me: true, sender_user_id: null }] } }); await waitRequests(page, 1);
  assert.deepEqual((await snapshot(page)).requests[0], { ids: [ids.a, ids.b], org: 'org-a', actor: 'actor-a', aborted: false });
  await resolveRequest(page, 0, [summary(ids.a), { id: ids.b, avatar_url: '/invalid.png' }, summary(ids.c, 'foreign')]); await waitAvatarCount(page, 1);
  assert.deepEqual((await snapshot(page)).avatars, [[ids.a, { userId: ids.a, url: summary(ids.a).avatar_url }]]);
  await render(page, { props: { messages: [outgoing(ids.a), outgoing(ids.b), outgoing(ids.a)] } });
  await page.waitForTimeout(70); assert.equal((await snapshot(page)).requests.length, 1);
});

test('up to 1000 unique authors use bounded batches matching the real API max100 without a per-message request', async t => {
  const page = await open(t);
  const messages = Array.from({ length: 1005 }, (_, i) => outgoing(`${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`));
  await render(page, { props: { messages } }); await page.waitForFunction(() => window.h.requests.length >= 1);
  assert.ok((await snapshot(page)).requests[0].ids.length <= 100, 'the actual HTTP handler rejects larger batches');
  await waitRequests(page, 2);
  for (let count = 0; count < 10; count++) {
    await page.waitForFunction(() => window.h.requests.some(r => !r.settled));
    await page.evaluate(() => { const h=window.h,r=h.requests.find(r=>!r.settled);r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/'+id+'.png'}))); });
    if (count < 9) assert.equal((await snapshot(page)).avatars.length, 0, 'no partial batch is published');
  }
  await waitAvatarCount(page, 1000);
  const state=await page.evaluate(()=>({count:h.requests.length,maxActive:h.maxActive,ids:h.requests.flatMap(r=>r.p.ids),validTransport:h.requests.every(r=>r.p.ids.length<=100&&r.p.org==='org-a'&&r.p.expectedUserId==='actor-a'&&r.p.signal instanceof AbortSignal)}));
  assert.equal(state.count,10);assert.ok(state.maxActive<=2);assert.equal(new Set(state.ids).size,1000);assert.equal(state.validTransport,true);
});

for (const missing of ['conversationId']) test(`avatar summaries require an authorized thread and ${missing}`, async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)], [missing]: null } });
  await page.waitForTimeout(70); assert.deepEqual((await snapshot(page)).requests, []); assert.deepEqual((await snapshot(page)).avatars, []);
});

test('an authorized conversation without a lead may resolve its canonical CRM authors',async t=>{
  const page=await open(t);await render(page,{props:{leadId:null,messages:[outgoing(ids.a)]}});await waitRequests(page,1);
  await resolveRequest(page,0,[summary(ids.a)]);await waitAvatarCount(page,1);
  assert.deepEqual((await snapshot(page)).avatars,[[ids.a,{userId:ids.a,url:summary(ids.a).avatar_url}]]);
});

for(const status of [403,503])test(`batch HTTP ${status} aborts siblings and publishes no partial author photos`,async t=>{
  const page=await open(t);const messages=Array.from({length:201},(_,i)=>outgoing(`${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`));
  await render(page,{props:{messages}});await waitRequests(page,2);
  await page.evaluate(()=>{const r=h.requests[0];r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/first.png'})));});await waitRequests(page,3);
  assert.equal((await snapshot(page)).avatars.length,0);
  await page.evaluate(status=>h.requests[1].reject(Object.assign(new Error('Synthetic batch failure'),{status})),status);
  await page.waitForFunction(()=>h.requests[2].aborted);await page.waitForTimeout(50);assert.equal((await snapshot(page)).avatars.length,0);assert.equal((await snapshot(page)).requests.length,3);
});

test('a noncancelable old multi-batch request cannot schedule more work or settle an actor ABA',async t=>{
  const page=await open(t);const messages=Array.from({length:201},(_,i)=>outgoing(`${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`));
  await render(page,{ignoreAbort:true,props:{messages}});await waitRequests(page,2);
  await render(page,{scope:{organizationId:'org-b',userId:'actor-b',accessScope:'access-b'}});await waitRequests(page,4);
  await render(page,{scope:{organizationId:'org-a',userId:'actor-a',accessScope:'access-a'}});await waitRequests(page,6);
  await page.evaluate(()=>{for(const r of h.requests.slice(0,4))r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/obsolete.png'})));});
  await page.waitForTimeout(50);assert.equal((await snapshot(page)).requests.length,6);assert.equal((await snapshot(page)).avatars.length,0);
  for(let i=4;i<7;i++){await page.waitForFunction(i=>h.requests.length>i,i);await page.evaluate(i=>{const r=h.requests[i];r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/current.png'})));},i);}
  await waitAvatarCount(page,201);assert.ok((await snapshot(page)).avatars.every(([,value])=>value.url.endsWith('/current.png')));
});

test('disabling a thread aborts both batch workers and prevents late transport from scheduling another batch',async t=>{
  const page=await open(t);const messages=Array.from({length:201},(_,i)=>outgoing(`${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`));
  await render(page,{ignoreAbort:true,props:{messages}});await waitRequests(page,2);
  await render(page,{props:{enabled:false}});assert.equal((await snapshot(page)).avatars.length,0);
  await page.waitForFunction(()=>h.requests.every(r=>r.aborted));
  await page.evaluate(()=>{for(const r of h.requests)r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/retired.png'})));});
  await page.waitForTimeout(50);assert.equal((await snapshot(page)).requests.length,2);assert.equal((await snapshot(page)).avatars.length,0);
});

test('a disabled surface never cancels the same author query still used by another active surface',async t=>{
  const page=await open(t);const messages=Array.from({length:201},(_,i)=>outgoing(`${i.toString(16).padStart(8,'0')}-0000-4000-8000-000000000000`));
  await render(page,{peerEnabled:true,props:{messages}});await waitRequests(page,2);
  await render(page,{props:{enabled:false}});await page.waitForTimeout(50);assert.ok((await snapshot(page)).requests.every(r=>!r.aborted));
  for(let i=0;i<3;i++){await page.waitForFunction(i=>h.requests.length>i,i);await page.evaluate(i=>{const r=h.requests[i];r.resolve(r.p.ids.map(id=>({id,avatar_url:'https://avatar.synthetic.invalid/shared.png'})));},i);}
  await page.waitForFunction(()=>h.peerAvatars.size===201);assert.equal((await snapshot(page)).avatars.length,0);assert.equal((await snapshot(page)).requests.length,3);
});

test('disabled and deauthenticated threads hide current avatar data immediately without another request', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await render(page, { props: { enabled: false } }); assert.deepEqual((await snapshot(page)).avatars, []);
  await render(page, { scope: { organizationId: null, userId: null, accessScope: null } });
  assert.deepEqual((await snapshot(page)).avatars, []); assert.equal((await snapshot(page)).requests.length, 1);
});

test('noncancelable late summaries cannot replace the current actor/thread avatar map', async t => {
  const page = await open(t);
  await render(page, { ignoreAbort: true, props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await render(page, { scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'access-b' }, props: { conversationId: 'conversation-b', leadId: 'lead-b' } }); await waitRequests(page, 2);
  assert.deepEqual((await snapshot(page)).avatars, []);
  await resolveRequest(page, 1, [summary(ids.a, 'new')]); await waitAvatarCount(page, 1);
  await resolveRequest(page, 0, [summary(ids.a, 'old')]); await page.waitForTimeout(70);
  assert.equal((await snapshot(page)).avatars[0][1].url, summary(ids.a, 'new').avatar_url);
  assert.equal((await snapshot(page)).requests[0].aborted, true);
});

test('noncancelable request from before actor ABA cannot settle the new authorized request', async t => {
  const page = await open(t);
  await render(page, { ignoreAbort: true, props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await render(page, { scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'access-b' } }); await waitRequests(page, 2);
  await render(page, { scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'access-a' } }); await waitRequests(page, 3);
  await resolveRequest(page, 0, [summary(ids.a, 'obsolete')]); await page.waitForTimeout(70); assert.deepEqual((await snapshot(page)).avatars, []);
  await resolveRequest(page, 2, [summary(ids.a, 'current')]); await waitAvatarCount(page, 1);
  assert.equal((await snapshot(page)).avatars[0][1].url, summary(ids.a, 'current').avatar_url);
});

test('a summaries HTTP failure keeps initials and has no automatic retry loop', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await page.evaluate(() => window.h.requests[0].reject(new Error('Synthetic summaries HTTP 503')));
  await page.waitForTimeout(250); assert.deepEqual((await snapshot(page)).avatars, []); assert.equal((await snapshot(page)).requests.length, 1);
});

for (const status of [401, 403]) test(`summaries HTTP ${status} on refetch hides a previous authorized avatar instead of retaining stale data`, async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await page.evaluate(() => { void window.h.client.invalidateQueries({ queryKey: ['whatsapp-sender-avatars'] }); }); await waitRequests(page, 2);
  await page.evaluate(status => window.h.requests[1].reject(Object.assign(new Error('Synthetic summaries authorization denied'), { status })), status);
  await waitAvatarCount(page, 0); await page.waitForTimeout(100); assert.equal((await snapshot(page)).requests.length, 2);
  await page.evaluate(() => { void h.client.invalidateQueries({ queryKey: ['whatsapp-sender-avatars'] }); }); await waitRequests(page, 3);
  await resolveRequest(page, 2, [summary(ids.a)]); await waitAvatarCount(page, 1);
});

test('a transient 503 refetch preserves known authorized photos until a fresh result removes them', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await page.evaluate(() => { void h.client.invalidateQueries({ queryKey: ['whatsapp-sender-avatars'] }); }); await waitRequests(page, 2);
  await page.evaluate(() => h.requests[1].reject(Object.assign(new Error('Temporary unavailable'), { status: 503 })));
  await page.waitForTimeout(70); assert.equal((await snapshot(page)).avatars.length, 1);
  await page.evaluate(() => { void h.client.invalidateQueries({ queryKey: ['whatsapp-sender-avatars'] }); }); await waitRequests(page, 3);
  await resolveRequest(page, 2, []); await waitAvatarCount(page, 0);
});

test('new and removed visible authors preserve only photos of still visible known authors during the atomic read', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await render(page, { props: { messages: [outgoing(ids.a), outgoing(ids.b)] } }); await waitRequests(page, 2);
  assert.deepEqual((await snapshot(page)).avatars.map(([id]) => id), [ids.a]);
  await resolveRequest(page, 1, [summary(ids.a, 'fresh'), summary(ids.b)]); await waitAvatarCount(page, 2);
  await render(page, { props: { messages: [outgoing(ids.b)] } }); await waitRequests(page, 3);
  assert.deepEqual((await snapshot(page)).avatars.map(([id]) => id), [ids.b]);
  await resolveRequest(page, 2, [summary(ids.b)]); await waitAvatarCount(page, 1);
});

for (const dimension of ['actor', 'sid', 'conversation', 'lead', 'session', 'enabled']) test(`a cached ${dimension} ABA cannot revive photos before a fresh authorized read`, async t => {
  const page = await open(t);
  await render(page, { ignoreAbort: true, props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  const away = dimension === 'actor' ? { scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'access-b' } }
    : dimension === 'sid' ? { scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'access-a:sid-b' } }
      : { props: { [({ conversation: 'conversationId', lead: 'leadId', session: 'sessionId', enabled: 'enabled' })[dimension]]: dimension === 'enabled' ? false : `${dimension}-b` } };
  const back = ['actor', 'sid'].includes(dimension) ? { scope: { organizationId: 'org-a', userId: 'actor-a', accessScope: 'access-a' } }
    : { props: { [({ conversation: 'conversationId', lead: 'leadId', session: 'sessionId', enabled: 'enabled' })[dimension]]: dimension === 'enabled' ? true : `${dimension}-a` } };
  await render(page, away); assert.equal((await snapshot(page)).avatars.length, 0);
  const previousRequests = (await snapshot(page)).requests.length;
  await render(page, back); await waitRequests(page, previousRequests + 1);
  assert.equal((await snapshot(page)).avatars.length, 0, 'old fresh cache stays retired');
  if (dimension !== 'enabled') { await resolveRequest(page, 1, [summary(ids.a, 'abandoned')]); await page.waitForTimeout(35); assert.equal((await snapshot(page)).avatars.length, 0); }
  await resolveRequest(page, previousRequests, [summary(ids.a)]); await waitAvatarCount(page, 1);
  assert.equal((await snapshot(page)).avatars[0][1].url, summary(ids.a).avatar_url, 'identical fresh photos can return after reauthorization');
});

test('a cached peer survives transient refetch and another surface hiding without another transport', async t => {
  const page = await open(t);
  await render(page, { peerEnabled: true, props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await page.waitForFunction(() => h.peerAvatars.size === 1);
  await page.evaluate(() => { void h.client.invalidateQueries({ queryKey: ['whatsapp-sender-avatars'] }); }); await waitRequests(page, 2);
  await page.evaluate(() => h.requests[1].reject(new TypeError('Synthetic network unavailable')));
  await page.waitForTimeout(70); assert.equal((await snapshot(page)).avatars.length, 1);
  await page.waitForFunction(() => h.peerAvatars.size === 1);
  await render(page, { props: { enabled: false } }); assert.equal((await snapshot(page)).avatars.length, 0);
  assert.equal(await page.evaluate(() => h.peerAvatars.size), 1); assert.equal((await snapshot(page)).requests.length, 2);
});

test('reconciliation retires inactive author-set caches before pagination can reuse them', async t => {
  const page = await open(t);
  await render(page, { ignoreAbort: true, props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await render(page, { props: { messages: [outgoing(ids.a), outgoing(ids.b)] } }); await waitRequests(page, 2);
  await resolveRequest(page, 1, [summary(ids.a), summary(ids.b)]); await waitAvatarCount(page, 2);
  await page.evaluate(() => h.reconcile({ authorizationChanged: true, scope: h.scope, conversationIds: ['conversation-a'] })); await waitRequests(page, 3);
  assert.equal((await snapshot(page)).avatars.length, 0);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 4);
  assert.equal((await snapshot(page)).avatars.length, 0);
  await resolveRequest(page, 2, [summary(ids.a, 'abandoned'), summary(ids.b)]); await page.waitForTimeout(35);
  assert.equal((await snapshot(page)).avatars.length, 0);
  await resolveRequest(page, 3, [summary(ids.a)]); await waitAvatarCount(page, 1);
});

test('authorization reconciliation clears stale data and refetches only the matching scope and lead', async t => {
  const page = await open(t);
  await render(page, { props: { messages: [outgoing(ids.a)] } }); await waitRequests(page, 1);
  await resolveRequest(page, 0, [summary(ids.a)]); await waitAvatarCount(page, 1);
  await page.evaluate(() => {
    window.h.reconcile({ authorizationChanged: true, scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'access-b' } });
    window.h.reconcile({ authorizationChanged: true, leadIds: ['lead-other'] });
    window.h.reconcile({ scope: window.h.scope, leadIds: ['lead-a'] });
  }); await page.waitForTimeout(70); assert.equal((await snapshot(page)).requests.length, 1);
  await page.evaluate(() => window.h.reconcile({ authorizationChanged: true, scope: window.h.scope, leadIds: ['lead-a'] })); await waitRequests(page, 2);
  await waitAvatarCount(page, 0); await resolveRequest(page, 1, []); await page.waitForTimeout(70); assert.deepEqual((await snapshot(page)).avatars, []);
});

test('visibility is gated by viewport intersection and observes with a compact near-viewport margin', async t => {
  const page = await open(t); await render(page, { mediaEnabled: true });
  assert.equal((await snapshot(page)).visible, false);
  assert.deepEqual(await page.evaluate(() => ({ margin: window.h.observers[0].options.rootMargin, rootIsViewport: window.h.observers[0].options.root.hasAttribute('data-radix-scroll-area-viewport') })),
    { margin: '200px 0px', rootIsViewport: true });
  await page.evaluate(() => window.h.observers[0].emit(true)); await page.waitForFunction(() => window.h.visible);
  await page.evaluate(() => window.h.observers[0].emit(false)); await page.waitForFunction(() => !window.h.visible);
});

test('old observer callbacks after a key change or disable cannot enable the new media', async t => {
  const page = await open(t); await render(page, { mediaEnabled: true });
  await render(page, { mediaKey: 'media-b' });
  await page.evaluate(() => window.h.observers[0].emit(true)); await page.waitForTimeout(40); assert.equal((await snapshot(page)).visible, false);
  await page.evaluate(() => window.h.observers[1].emit(true)); await page.waitForFunction(() => window.h.visible);
  await render(page, { mediaEnabled: false }); assert.equal((await snapshot(page)).visible, false);
  await page.evaluate(() => window.h.observers[1].emit(true)); await page.waitForTimeout(40); assert.equal((await snapshot(page)).visible, false);
  assert.equal(await page.evaluate(() => window.h.observers.every(observer => observer.disconnected)), true);
});

test('visibility before any callback remains false again after a physical media ABA', async t => {
  const page = await open(t); await render(page, { mediaEnabled: true });
  await page.evaluate(() => window.h.observers[0].emit(true)); await page.waitForFunction(() => window.h.visible);
  await render(page, { mediaKey: 'media-b' }); assert.equal((await snapshot(page)).visible, false);
  await render(page, { mediaKey: 'media-a' }); assert.equal((await snapshot(page)).visible, false);
  await page.evaluate(() => window.h.observers[0].emit(true)); await page.waitForTimeout(40); assert.equal((await snapshot(page)).visible, false);
  await page.evaluate(() => window.h.observers[2].emit(true)); await page.waitForFunction(() => window.h.visible);
});

test('no IntersectionObserver keeps the explicit enabled fallback and disable still gates visibility', async t => {
  const page = await open(t, true); await render(page, { mediaEnabled: true }); assert.equal((await snapshot(page)).visible, true);
  await render(page, { mediaEnabled: false }); assert.equal((await snapshot(page)).visible, false);
});
