import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

const repository = process.cwd(), sourceRoot = process.env.WHATSAPP_NAVIGATION_BASELINE_ROOT || repository;
// Actual installed React/React DOM execute in Chromium. Only the navigation
// TypeScript is transpiled in RAM; no Webpack, dev server, CRM/API or network.
const modules = {
  '@/lib/search-text': transpile(join(repository, 'lib/search-text.ts')),
  '@/lib/whatsapp-message-navigation': transpile(join(sourceRoot, 'lib/whatsapp-message-navigation.ts')),
  navigation: transpile(join(sourceRoot, 'hooks/use-whatsapp-message-navigation.ts')),
};
const script = buildReactBrowserHarness({ repository, modules, entry: `
const { useWhatsAppMessageNavigation } = require('navigation');
const root = createRoot(document.getElementById('root'));
const h = window.harness = {
  scope: 'A', messages: [], requests: [], olderRequests: [], frames: [], reader: true, loader: false, loaderMode: 'ordinary', firstLoads: 0, serverLoads: 0,
  render(patch = {}) { Object.assign(this,patch); flushSync(() => root.render(React.createElement(Chat,{version:Date.now()}))); },
  unmount() { flushSync(() => root.unmount()); },
};
function Chat() {
  const log = React.useRef(null);
  const [revealed,setRevealed]=React.useState(false);
  const nav = useWhatsAppMessageNavigation({ scopeKey: h.scope, messages: h.messages, logRef: log,
    readPage: h.reader ? (cursor,signal) => new Promise((resolve,reject) => h.requests.push({cursor,signal,resolve,reject})) : undefined,
    loadOlder: h.loader ? h.loaderMode==='reveal'||h.loaderMode==='held-reveal' ? async () => {
      if(!revealed){h.firstLoads++;const rows=[{id:'local',message_type:'text'}];const commit=()=>{h.messages=rows;setRevealed(true);};
        if(h.loaderMode==='held-reveal')h.commitReveal=commit;else commit();return {messages:rows,hasMore:true};}
      h.serverLoads++;h.render({messages:[{id:'local'},{id:'target',content:'Authorized target'}]});
      return {messages:h.messages,hasMore:false};
    } : () => new Promise((resolve,reject) => h.olderRequests.push({resolve,reject})) : undefined,
  });
  React.useLayoutEffect(() => { h.nav = nav; });
  return React.createElement('div',{role:'log',ref:log},...h.messages.map(row => React.createElement('div',{
    key:row.id,'data-message-id':row.id,tabIndex:-1,
  },row.content)));
}
h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function open(t, patch = {}) {
  const page = await browser.newPage(), errors = [];
  page.setDefaultTimeout(4000);
  await page.route('**/*', route => route.abort());
  page.on('pageerror', error => errors.push(error.message));
  t.after(async () => { assert.deepEqual(errors, []); await page.close(); });
  await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: script });
  await page.evaluate(patch => window.harness.render(patch), patch);
  return page;
}
const message = (id, patch = {}) => ({ id, message_id: `provider-${id}`, conversation_id: 'chat-a', session_id: 'session-a',
  content: 'Visita amanhã', message_type: 'text', ...patch });
async function search(page, query = 'visita') {
  await page.evaluate(query => window.harness.nav.setQuery(query), query);
  await page.waitForFunction(query => window.harness.nav.query === query, query);
  await page.evaluate(() => { window.harness.pending = window.harness.nav.search(); });
  await page.waitForFunction(() => window.harness.nav.isSearching);
}

test('React navigation cancels search and clears its busy state', async t => {
  const page = await open(t, { messages: [message('one')] });
  await search(page); await page.waitForFunction(() => window.harness.requests.length === 1);
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('one'); });
  await page.waitForFunction(() => !window.harness.nav.navigating);
  await page.evaluate(() => window.harness.requests[0].resolve({ messages: [
    { id: 'stale', content: 'visita privada', message_type: 'text' },
  ], nextCursor: null }));
  await page.evaluate(() => window.harness.pending);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.harness.nav.isSearching), false);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'one');
  assert.deepEqual(await page.evaluate(() => window.harness.nav.results), []);
});

test('React search detects a repeated cursor cycle', async t => {
  const page = await open(t); await search(page);
  for (let index = 0; index < 4; index += 1) {
    const count = await page.evaluate(() => window.harness.requests.length);
    if (count <= index) break;
    await page.evaluate(({index,cursor}) => window.harness.requests[index].resolve({ messages: [], nextCursor: cursor }),
      { index, cursor: index % 2 ? 'cursor-b' : 'cursor-a' });
    await page.waitForTimeout(30);
  }
  await page.evaluate(() => window.harness.pending);
  assert.notEqual(await page.evaluate(() => window.harness.nav.error), '');
  assert.equal(await page.evaluate(() => window.harness.nav.hasMore), false);
});

test('React query replacement and scope ABA discard obsolete private search responses', async t => {
  const page = await open(t); await search(page, 'old');
  await page.waitForFunction(() => window.harness.requests.length === 1);
  await page.evaluate(() => window.harness.nav.setQuery('new'));
  await page.waitForFunction(() => window.harness.nav.query === 'new');
  await page.evaluate(() => { window.harness.fresh = window.harness.nav.search(); });
  await page.waitForFunction(() => window.harness.requests.length === 2);
  await page.evaluate(() => window.harness.requests[1].resolve({ messages: [{ id: 'new', content: 'new', message_type: 'text' }], nextCursor: null }));
  await page.waitForFunction(() => window.harness.nav.results.length === 1);
  await page.evaluate(() => window.harness.requests[0].resolve({ messages: [{ id: 'old-private', content: 'old', message_type: 'text' }], nextCursor: null }));
  await page.evaluate(() => window.harness.pending);
  assert.deepEqual(await page.evaluate(() => window.harness.nav.results.map(row => row.id)), ['new']);
  await search(page, 'private'); await page.waitForFunction(() => window.harness.requests.length === 3);
  await page.evaluate(() => { window.harness.render({ scope: 'B' }); window.harness.render({ scope: 'A' }); });
  assert.equal(await page.evaluate(() => window.harness.requests[2].signal.aborted), true);
  await page.evaluate(() => window.harness.requests[2].resolve({ messages: [{ id: 'private', content: 'private', message_type: 'text' }], nextCursor: null }));
  await page.evaluate(() => window.harness.pending);
  assert.deepEqual(await page.evaluate(() => window.harness.nav.results), []);
});

test('React search is bounded to four pages and never inserts results into its message log', async t => {
  const page = await open(t); await search(page);
  for (let index = 0; index < 4; index += 1) {
    await page.waitForFunction(count => window.harness.requests.length === count, index + 1);
    await page.evaluate(({index,row}) => window.harness.requests[index].resolve({ messages: [row], nextCursor: `cursor-${index + 1}` }),
      { index, row: message(`match-${index}`) });
  }
  await page.waitForFunction(() => !window.harness.nav.isSearching);
  assert.equal(await page.evaluate(() => window.harness.requests.length), 4);
  assert.equal(await page.evaluate(() => window.harness.nav.results.length), 4);
  assert.equal(await page.locator('[data-message-id]').count(), 0);
});

test('React quote navigation respects session identity and cancels late loaded history on scope change', async t => {
  const page = await open(t, { messages: [message('one')] });
  await page.evaluate(() => window.harness.nav.navigateTo('provider-one', { sessionId: 'wrong-session' }));
  assert.notEqual(await page.evaluate(() => window.harness.nav.error), '');
  assert.notEqual(await page.evaluate(() => document.activeElement?.dataset.messageId), 'one');
  await page.evaluate(() => window.harness.nav.navigateTo('provider-one', { conversationId: 'chat-a', sessionId: 'session-a' }));
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'one');
  await page.evaluate(() => { window.harness.render({ loader: true }); window.harness.navigation = window.harness.nav.navigateTo('missing'); });
  await page.waitForFunction(() => window.harness.olderRequests.length === 1);
  await page.evaluate(() => window.harness.render({ scope: 'B', messages: [] }));
  await page.evaluate(() => window.harness.olderRequests[0].resolve({ messages: [{ id: 'missing' }], hasMore: false }));
  await page.evaluate(() => window.harness.navigation);
  assert.equal(await page.evaluate(() => window.harness.nav.navigating), false);
  assert.equal(await page.locator('[data-message-id]').count(), 0);
});

test('React unmount aborts pending search before its response resolves', async t => {
  const page = await open(t); await search(page);
  await page.waitForFunction(() => window.harness.requests.length === 1);
  await page.evaluate(() => window.harness.unmount());
  assert.equal(await page.evaluate(() => window.harness.requests[0].signal.aborted), true);
  await page.evaluate(() => window.harness.requests[0].resolve({ messages: [{ id: 'private', content: 'visita', message_type: 'text' }], nextCursor: null }));
  await page.evaluate(() => window.harness.pending);
  assert.equal(await page.locator('[data-message-id]').count(), 0);
});

test('React navigation commits a local reveal before calling the newer server-page adapter', async t => {
  const page = await open(t, { loader: true, loaderMode: 'reveal' });
  await page.evaluate(() => window.harness.nav.navigateTo('target'));
  assert.equal(await page.evaluate(() => window.harness.firstLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.serverLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.nav.error), '');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'target');
});

test('React navigation waits for the revealed rows to commit across several frames without calling the stale adapter again', async t => {
  const page = await open(t, { loader: true, loaderMode: 'held-reveal' });
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('target'); });
  await page.waitForFunction(() => window.harness.firstLoads >= 1);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.harness.firstLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.serverLoads), 0);
  assert.equal(await page.evaluate(() => window.harness.nav.navigating), true);
  await page.evaluate(() => window.harness.commitReveal()); await page.evaluate(() => window.harness.navigation);
  assert.equal(await page.evaluate(() => window.harness.firstLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.serverLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.nav.error), '');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'target');
});

test('React navigation cancels a reveal waiting for commit immediately after scope ABA', async t => {
  const page = await open(t, { loader: true, loaderMode: 'held-reveal' });
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('target'); });
  await page.waitForFunction(() => window.harness.firstLoads >= 1);
  await page.evaluate(() => { window.harness.render({ scope: 'B', messages: [] }); window.harness.render({ scope: 'A', messages: [] }); });
  await page.evaluate(() => window.harness.navigation);
  assert.equal(await page.evaluate(() => window.harness.nav.navigating), false);
  assert.equal(await page.evaluate(() => window.harness.nav.error), '');
  assert.equal(await page.evaluate(() => window.harness.firstLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.serverLoads), 0);
  assert.equal(await page.locator('[data-message-id]').count(), 0);
});

test('React navigation stops safely if a local reveal never commits instead of retrying the stale adapter', async t => {
  const page = await open(t, { loader: true, loaderMode: 'held-reveal' });
  await page.evaluate(() => window.harness.nav.navigateTo('target'));
  assert.equal(await page.evaluate(() => window.harness.firstLoads), 1);
  assert.equal(await page.evaluate(() => window.harness.serverLoads), 0);
  assert.equal(await page.evaluate(() => window.harness.nav.navigating), false);
  assert.notEqual(await page.evaluate(() => window.harness.nav.error), '');
});

test('React navigation waits for a server target to commit before querying and focusing its DOM row', async t => {
  const page = await open(t, { loader: true }), target = message('target');
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('target'); });
  await page.waitForFunction(() => window.harness.olderRequests.length === 1);
  await page.evaluate(target => window.harness.olderRequests[0].resolve({ messages: [target], hasMore: false }), target);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => window.harness.nav.navigating), true);
  assert.equal(await page.evaluate(() => window.harness.nav.error), '');
  await page.evaluate(target => window.harness.render({ messages: [target] }), target);
  await page.evaluate(() => window.harness.navigation);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'target');
  assert.equal(await page.evaluate(() => window.harness.olderRequests.length), 1);
});

test('React navigation does not wait for a reaction-only page to render a nonexistent message row', async t => {
  const page = await open(t, { loader: true });
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('target'); });
  await page.waitForFunction(() => window.harness.olderRequests.length === 1);
  await page.evaluate(() => window.harness.olderRequests[0].resolve({ messages: [{ id: 'reaction', message_type: 'reaction' }], hasMore: true }));
  await page.waitForFunction(() => window.harness.olderRequests.length === 2);
  await page.evaluate(target => { window.harness.render({ messages: [target] }); window.harness.olderRequests[1].resolve({ messages: [target], hasMore: false }); }, message('target'));
  await page.evaluate(() => window.harness.navigation);
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.messageId), 'target');
  assert.equal(await page.evaluate(() => window.harness.nav.error), '');
  assert.equal(await page.evaluate(() => window.harness.olderRequests.length), 2);
});

test('React navigation has a twelve-page ceiling and does not retry failed history', async t => {
  const page = await open(t, { loader: true });
  await page.evaluate(() => { window.harness.navigation = window.harness.nav.navigateTo('missing'); });
  for(let index=0;index<12;index++){
    await page.waitForFunction(count=>window.harness.olderRequests.length===count,index+1);
    await page.evaluate(index=>{const h=window.harness;h.render({messages:Array.from({length:index+1},(_,i)=>({id:'row-'+i}))});h.olderRequests[index].resolve({messages:h.messages,hasMore:true});},index);
  }
  await page.evaluate(()=>window.harness.navigation);
  assert.equal(await page.evaluate(()=>window.harness.olderRequests.length),12);
  assert.notEqual(await page.evaluate(()=>window.harness.nav.error),'');
  await page.evaluate(()=>{window.harness.navigation=window.harness.nav.navigateTo('other-missing');});
  await page.waitForFunction(()=>window.harness.olderRequests.length===13);
  await page.evaluate(()=>window.harness.olderRequests[12].reject({status:409}));
  await page.evaluate(()=>window.harness.navigation);
  assert.equal(await page.evaluate(()=>window.harness.olderRequests.length),13);
});

test('React removing the authorized reader aborts the pending search in the same scope', async t => {
  const page = await open(t);await search(page);
  await page.waitForFunction(()=>window.harness.requests.length===1);
  await page.evaluate(()=>window.harness.render({reader:false}));
  assert.equal(await page.evaluate(()=>window.harness.requests[0].signal.aborted),true);
  await page.evaluate(()=>window.harness.requests[0].resolve({messages:[{id:'private',content:'visita',message_type:'text'}],nextCursor:null}));
  await page.evaluate(()=>window.harness.pending);
  assert.deepEqual(await page.evaluate(()=>window.harness.nav.results),[]);
  assert.equal(await page.evaluate(()=>window.harness.nav.isSearching),false);
});
