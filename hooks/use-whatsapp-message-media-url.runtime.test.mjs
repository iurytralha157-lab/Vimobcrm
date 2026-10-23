import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import { buildReactBrowserHarness, transpileBrowserTestModule as transpile } from './whatsapp-react-browser-test-harness.mjs';

const repository = process.cwd(), require = createRequire(import.meta.url), modules = {};
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
const script = buildReactBrowserHarness({ repository, modules: {
  ...modules,
  '@/lib/api/whatsapp': 'exports.whatsappAPI={getMessageMediaURL:(id,org,transport)=>window.h.request(id,org,transport)};',
  '@/hooks/use-whatsapp-query-scope': 'exports.useWhatsAppQueryScope=()=>window.h.scope;',
  '@/lib/whatsapp-message-order': transpile(join(repository, 'lib/whatsapp-message-order.ts')),
  '@/lib/whatsapp-query-cache': transpile(join(repository, 'lib/whatsapp-query-cache.ts')),
  '@/lib/whatsapp-message-input': transpile(join(repository, 'lib/whatsapp-message-input.ts')),
  '@/lib/whatsapp-access-revocation': transpile(join(repository, 'lib/whatsapp-access-revocation.ts')),
  hook: transpile(join(repository, 'hooks/use-whatsapp-message-media-url.ts')),
}, entry: `
  const {useWhatsAppMessageMediaURL}=require('hook'),{QueryClient,QueryClientProvider}=require('@tanstack/react-query');
  const root=createRoot(document.getElementById('root')), client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
  const h=window.h={requests:[],views:{},count:1,enabled:window.fixtureEnabled!==false,hidden:[],
    scope:{organizationId:'org-a',userId:'actor-a',accessScope:'permission:sid-a'},url:null,
    request(id,organizationId,transport){return new Promise((resolve,reject)=>this.requests.push({id,organizationId,transport,resolve,reject}));},
    render(changes={}){Object.assign(this,changes);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},
      React.createElement('div',null,Array.from({length:this.count},(_,index)=>React.createElement(Source,{key:index,index}))))));},
    unmount(){flushSync(()=>root.render(null));},
    complete(index,expiresIn=60){this.requests[index].resolve({url:'https://media.example.invalid/'+this.requests[index].id+'/'+index,expiresIn});},
  };
  function Source({index}){const value=useWhatsAppMessageMediaURL({messageId:'media-'+index,leadId:'lead-'+index,sessionId:'session-a',
    storedMedia:true,mediaUrl:h.url,enabled:h.enabled&&!h.hidden.includes(index)});React.useEffect(()=>{h.views[index]=value;});
    return React.createElement('div',{'data-media':index},value.mediaUrl||'not loaded');}
  h.render();
` });
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { enabled = true } = {}) {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  await page.setContent('<div id="root"></div>');
  await page.evaluate(value => { window.fixtureEnabled = value; }, enabled);
  await page.addScriptTag({ content: script });
  return page;
}
const settle = page => page.waitForTimeout(30);
const count = page => page.evaluate(() => h.requests.length);
async function complete(page, index, expiresIn = 60) {
  await page.evaluate(v => h.complete(v.index, v.expiresIn), { index, expiresIn }); await settle(page);
}

test('disabled stored media starts no GET or loading placeholder and loads once on visibility', async t => {
  const page = await fixture(t, { enabled: false }); await settle(page);
  assert.equal(await count(page), 0);
  await page.evaluate(() => { h.scope = { ...h.scope, accessScope: 'permission:disabled-owner' }; h.render(); }); await settle(page);
  const before = await count(page);
  assert.equal(await page.evaluate(() => h.views[0].isLoading), false);
  await settle(page); assert.equal(await count(page), before);
  await page.evaluate(() => h.render({ enabled: true })); await settle(page);
  assert.equal(await count(page), before + 1); await complete(page, before);
});

test('hiding accepted media preserves URL and cancels automatic TTL renewal until visible', async t => {
  const page = await fixture(t); await settle(page); await complete(page, 0, 1);
  const url = await page.evaluate(() => h.views[0].mediaUrl);
  await page.evaluate(() => h.render({ enabled: false })); await settle(page);
  assert.equal(await page.evaluate(() => h.views[0].mediaUrl), url);
  await page.waitForTimeout(1050); assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ enabled: true })); await settle(page);
  assert.equal(await count(page), 2); assert.equal(await page.evaluate(() => h.views[0].mediaUrl), url);
  await complete(page, 1); assert.equal(await page.evaluate(() => h.views[0].failed), false);
});

test('offscreen automatic GET aborts and its late response cannot publish before another visible read', async t => {
  const page = await fixture(t); await settle(page);
  await page.evaluate(() => h.render({ enabled: false })); await settle(page);
  assert.equal(await page.evaluate(() => h.requests[0].transport.signal.aborted), true);
  await complete(page, 0); assert.equal(await page.evaluate(() => h.views[0].mediaUrl), null);
  await page.evaluate(() => h.render({ enabled: true })); await settle(page);
  assert.equal(await count(page), 2); await complete(page, 1);
  assert.match(await page.evaluate(() => h.views[0].mediaUrl), /\/1$/);
});

test('explicit media refresh works while disabled and visibility does not cancel it', async t => {
  const page = await fixture(t); await settle(page);
  await page.evaluate(() => h.render({ enabled: false })); await complete(page, 0);
  await page.evaluate(() => { h.explicit = h.views[0].refresh(); }); await settle(page);
  assert.equal(await count(page), 2);
  await page.evaluate(() => { h.render({ enabled: true }); h.render({ enabled: false }); }); await settle(page);
  assert.equal(await page.evaluate(() => h.requests[1].transport.signal.aborted), false);
  await complete(page, 1); assert.match(await page.evaluate(() => h.views[0].mediaUrl), /\/1$/);
  assert.equal(await page.evaluate(() => h.views[0].isLoading), false);
});

test('opening a prefetched media promotes its pending read before the bubble becomes offscreen', async t => {
  const page = await fixture(t); await settle(page);
  await page.evaluate(() => { h.explicit = h.views[0].refresh(); h.render({ enabled: false }); }); await settle(page);
  assert.equal(await count(page), 1); assert.equal(await page.evaluate(() => h.requests[0].transport.signal.aborted), false);
  await complete(page, 0); assert.match(await page.evaluate(() => h.views[0].mediaUrl), /\/0$/);
  assert.equal(await page.evaluate(() => h.views[0].isLoading), false);
});

test('aborted transports hold the four leases until settlement and hidden queued media never sends', async t => {
  const page = await fixture(t); await page.evaluate(() => h.render({ count: 8 })); await settle(page);
  assert.equal(await count(page), 4);
  await page.evaluate(() => h.render({ hidden: [0, 1, 2, 3, 4, 5] })); await settle(page);
  assert.equal(await count(page), 4);
  await complete(page, 0); await settle(page); assert.equal(await count(page), 5);
  assert.equal(await page.evaluate(() => h.requests[4].id), 'media-6');
  await complete(page, 1); await settle(page); assert.equal(await count(page), 6);
  assert.equal(await page.evaluate(() => h.requests[5].id), 'media-7');
  await complete(page, 2); await complete(page, 3); await complete(page, 4); await complete(page, 5);
  assert.equal(await count(page), 6);
});

test('hidden tenant and Auth SID ABA cannot revive an earlier accepted URL', async t => {
  const page = await fixture(t); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.originalScope = h.scope; h.render({ enabled: false });
    h.render({ scope: { organizationId: 'org-b', userId: 'actor-b', accessScope: 'permission:sid-b' } });
    h.render({ scope: h.originalScope });
  }); await settle(page);
  assert.equal(await page.evaluate(() => h.views[0].mediaUrl), null); assert.equal(await count(page), 1);
  await page.evaluate(() => h.render({ enabled: true })); await settle(page);
  assert.equal(await count(page), 2); await complete(page, 1);
});

test('explicit access denial clears accepted hidden media and remains terminal for automatic retries', async t => {
  const page = await fixture(t); await settle(page); await complete(page, 0);
  await page.evaluate(() => { h.render({ enabled: false }); h.views[0].refresh().catch(() => {}); }); await settle(page);
  await page.evaluate(() => h.requests[1].reject({ status: 403, code: 'access_denied' })); await settle(page);
  assert.equal(await page.evaluate(() => h.views[0].mediaUrl), null); assert.equal(await page.evaluate(() => h.views[0].failed), true);
  await page.evaluate(() => h.render({ enabled: true })); await settle(page);
  assert.equal(await count(page), 2);
});
