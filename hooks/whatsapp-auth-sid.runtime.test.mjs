import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Actual React, QueryClient, query scope, media hook and gallery lifetime.
// Only Auth/organization delivery and API responses are deferred fixtures.
// Synthetic JWTs pin a gesture; they are not an authenticated Auth service.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const baseline = 'D:/Vimob/tmp/whatsapp-auth-sid-local-20261014/before/hooks__use-whatsapp-query-scope.ts.before';
const sidA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const sidB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const initialURL = 'https://example.test/storage/v1/object/sign/whatsapp-media/org-a/synthetic.png?token=fixture';
const freshURL = 'https://example.test/storage/v1/object/sign/whatsapp-media/org-a/fresh.png?token=fixture';
let directory, browser, bundle;
before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-wa-auth-sid-'));
  const auth = join(directory, 'auth.js'), organization = join(directory, 'organization.js'), api = join(directory, 'api.js');
  await writeFile(auth, 'export const useAuth=()=>window.h.auth;');
  await writeFile(organization, 'export const useActiveOrganization=()=>({organizationId:window.h.organizationId});');
  await writeFile(api, 'export const whatsappAPI={getMessageMediaURL:(...args)=>window.h.request(args)};');
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const fs=require('fs');module.exports=function(s){
    if(${process.env.VIMOB_WHATSAPP_AUTH_SID_BASELINE === '1'} && this.resourcePath===${JSON.stringify(join(repository, 'hooks/use-whatsapp-query-scope.ts'))})s=fs.readFileSync(${JSON.stringify(baseline)},'utf8');
    if(${process.env.VIMOB_WHATSAPP_SID_DRAFT_BASELINE === '1'} && ['hooks/use-whatsapp-query-scope.ts','hooks/use-whatsapp-conversation-draft.ts','lib/whatsapp-query-cache.ts'].some(p=>this.resourcePath===${JSON.stringify(repository)}+'/'+p||this.resourcePath===require('path').join(${JSON.stringify(repository)},p)))s=fs.readFileSync(require('path').join('D:/Vimob/tmp/whatsapp-auth-sid-local-20261014/draft-before',require('path').relative(${JSON.stringify(repository)},this.resourcePath).split(require('path').sep).join('__')+'.before'),'utf8');
    return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(entry, `
    import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider,useQuery} from '@tanstack/react-query';
    import {useWhatsAppQueryScope} from '@/hooks/use-whatsapp-query-scope';
    import {useWhatsAppMessageMediaURL} from '@/hooks/use-whatsapp-message-media-url';
    import {useWhatsAppMediaGallery} from '@/hooks/use-whatsapp-media-gallery';
    import {useWhatsAppConversationDraft} from '@/hooks/use-whatsapp-conversation-draft';
    import {whatsappQueryKeys} from '@/lib/whatsapp-query-cache';
    const root=createRoot(document.getElementById('root'));
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity},mutations:{retry:false}}});
    const h=window.h={organizationId:'org-a',requests:[],galleryResults:[],mediaProps:window.__fixtureMediaProps||{storedMedia:false,mediaUrl:null},
      auth:{profile:{id:'10000000-0000-4000-8000-000000000001'},tenantContext:{memberRole:'user',permissions:['whatsapp_view'],ledTeamIds:[],ledUserIds:[],ledPipelineIds:[]},session:null},
      token(sid,nonce){return 'fixture.'+btoa(JSON.stringify({sub:this.auth.profile.id,...(sid?{session_id:sid}:{}),nonce})).replace(/=+$/,'')+'.synthetic';},
      change(sid,nonce=1){this.auth.session={access_token:this.token(sid,nonce)};this.render();},
      render(){flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Host))));},
      request(args){return new Promise(resolve=>{const options=args[2];const r={args,resolve,aborted:options.signal.aborted};options.signal.addEventListener('abort',()=>r.aborted=true,{once:true});this.requests.push(r);});},
      complete(index,url){this.requests[index].resolve({url,expiresIn:900});},
      seedCache(){client.setQueryData(this.key,{media_url:${JSON.stringify(initialURL)}});},
      unmount(){flushSync(()=>root.render(null));},
    };
    function Host(){const scope=useWhatsAppQueryScope();const key=whatsappQueryKeys.conversation(scope,'20000000-0000-4000-8000-000000000001');
      const cached=useQuery({queryKey:key,enabled:false,queryFn:async()=>null});
      const draft=useWhatsAppConversationDraft(scope,'20000000-0000-4000-8000-000000000001','lead-a');
      const inboxDraft=useWhatsAppConversationDraft(scope,null,null);
      h.renderedInboxText=inboxDraft.getConversationDraft('20000000-0000-4000-8000-000000000001','lead-a');
      const media=useWhatsAppMessageMediaURL({messageId:'30000000-0000-4000-8000-000000000001',leadId:'lead-a',sessionId:'wa-session-a',...h.mediaProps});
      const items=useWhatsAppMediaGallery({scopeKey:'same-physical-chat',conversationId:'20000000-0000-4000-8000-000000000001',messages:[{id:'30000000-0000-4000-8000-000000000002',conversation_id:'20000000-0000-4000-8000-000000000001',message_type:'image',media_url:null,media_storage_path:'org-a/synthetic.png',media_status:'ready',status:'received'}]});
      h.scope=scope;h.key=key;h.cached=cached.data;h.media=media;h.items=items;h.draft=draft;h.inboxDraft=inboxDraft;return React.createElement('output',null,media.mediaUrl||'empty');}
    h.change(${JSON.stringify(sidA)});
  `);
  await new Promise((resolveBuild, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'bundle.js', publicPath: '' },
      plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })],
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/contexts/AuthContext': auth, '@/hooks/use-active-organization': organization, '@/lib/api/whatsapp': api, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
  });
  bundle = await readFile(join(directory, 'bundle.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  if (directory) {
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^vimob-wa-auth-sid-/);
    await rm(directory, { recursive: true, force: true });
  }
});
async function fixture(t, mediaProps) {
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.abort());
  await page.route('http://whatsapp-sid-fixture.test/', route => route.fulfill({ contentType:'text/html',body:'<div id="root"></div>' }));
  await page.goto('http://whatsapp-sid-fixture.test/');
  if (mediaProps) await page.evaluate(input => { window.__fixtureMediaProps=input; }, mediaProps);
  await page.addScriptTag({ content: bundle });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); });
  assert.equal(await page.evaluate(() => typeof window.h), 'object'); return page;
}
const settle = page => page.waitForTimeout(25);

test('same actor and permissions with a different SID get a different scope and query cache', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { h.oldScope=h.scope.accessScope;h.oldKey=JSON.stringify(h.key);h.seedCache(); }); await settle(page);
  assert.equal(await page.evaluate(() => Boolean(h.cached?.media_url)), true);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  assert.equal(await page.evaluate(() => h.scope.accessScope!==h.oldScope), true);
  assert.equal(await page.evaluate(() => JSON.stringify(h.key)!==h.oldKey && !h.cached), true);
  assert.equal(await page.evaluate(() => !h.scope.accessScope.includes(h.auth.session.access_token)), true);
});

test('refreshing only the token with the same SID keeps scope cache and media without a new GET', async t => {
  const page = await fixture(t, { storedMedia:true, mediaUrl:initialURL });
  await page.evaluate(() => { h.previousScope=h.scope;h.oldKey=JSON.stringify(h.key);h.seedCache(); }); await settle(page);
  await page.evaluate(sid => h.change(sid,2), sidA); await settle(page);
  assert.equal(await page.evaluate(() => h.scope===h.previousScope && JSON.stringify(h.key)===h.oldKey), true);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), initialURL);
});

test('SID rotation drops an already-issued initial media URL until the new authorized GET returns', async t => {
  const page = await fixture(t, { storedMedia:true, mediaUrl:initialURL }); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), initialURL);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), null);
  assert.equal(await page.evaluate(() => h.requests.length), 1);
  await page.evaluate(url => h.complete(0,url), freshURL); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), freshURL);
});

test('a pending old-SID media GET is aborted and cannot update the new SID even when transport ignores abort', async t => {
  const page = await fixture(t, { storedMedia:true, mediaUrl:null }); await settle(page);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  assert.equal(await page.evaluate(() => h.requests[0].aborted), true);
  assert.equal(await page.evaluate(() => h.requests.length), 2);
  await page.evaluate(url => h.complete(0,url), initialURL); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), null);
  await page.evaluate(url => h.complete(1,url), freshURL); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), freshURL);
});

test('committed SID A to B to A retires the original media completion by generation', async t => {
  const page = await fixture(t, { storedMedia:true, mediaUrl:null }); await settle(page);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  await page.evaluate(sid => h.change(sid,3), sidA); await settle(page);
  assert.equal(await page.evaluate(() => h.requests.length), 3);
  assert.equal(await page.evaluate(() => h.requests[0].aborted && h.requests[1].aborted), true);
  await page.evaluate(url => {h.complete(0,url);h.complete(1,url);}, initialURL); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), null);
  await page.evaluate(url => h.complete(2,url), freshURL); await settle(page);
  assert.equal(await page.evaluate(() => h.media.mediaUrl), freshURL);
});

test('a saved gallery reader from the old SID returns null without making another API call', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {h.saved=h.items[0].refresh;});
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  await page.evaluate(() => {h.savedResult='pending';h.saved().then(value=>h.savedResult=value);}); await settle(page);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
  assert.equal(await page.evaluate(() => h.savedResult), null);
});

test('gallery SID A to B to A ignores an old completion and lets the current reader authorize anew', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {h.items[0].refresh().then(value=>h.galleryResults.push(value));}); await settle(page);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  await page.evaluate(sid => h.change(sid,3), sidA); await settle(page);
  assert.equal(await page.evaluate(() => h.requests[0].aborted), true);
  await page.evaluate(url => h.complete(0,url), initialURL); await settle(page);
  assert.deepEqual(await page.evaluate(() => h.galleryResults), [null]);
  await page.evaluate(() => { h.items[0].refresh().then(value=>h.galleryResults.push(value)); }); await settle(page);
  await page.evaluate(url => h.complete(1,url), freshURL); await settle(page);
  assert.deepEqual(await page.evaluate(() => h.galleryResults), [null,freshURL]);
});

test('unknown SID fixtures remain stable and never fall back to raw tokens as a scope key', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {h.change(null);h.oldScope=h.scope;h.oldKey=JSON.stringify(h.key);h.change(null,2);}); await settle(page);
  assert.equal(await page.evaluate(() => h.scope===h.oldScope && JSON.stringify(h.key)===h.oldKey), true);
  assert.equal(await page.evaluate(() => !h.scope.accessScope.includes(h.auth.session.access_token)), true);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
});

test('draft storage keeps the same text and owner on SID rotation for the same actor organization and permissions', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { h.draft.setText('Rascunho sintético'); }); await settle(page);
  await page.evaluate(() => { h.oldDraftKey=h.draft.key;h.persisted=sessionStorage.getItem('vimob:whatsapp-drafts:v1'); });
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  assert.equal(await page.evaluate(() => h.draft.text), 'Rascunho sintético');
  assert.equal(await page.evaluate(() => h.draft.key===h.oldDraftKey), true);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob:whatsapp-drafts:v1')===h.persisted), true);
  assert.equal(await page.evaluate(() => h.inboxDraft.getConversationDraft('20000000-0000-4000-8000-000000000001','lead-a')), 'Rascunho sintético');
  assert.equal(await page.evaluate(() => h.renderedInboxText), 'Rascunho sintético');
});

test('old draft callbacks cannot set clear or read the current visit after SID A to B to A', async t => {
  const page = await fixture(t);
  await page.evaluate(() => { h.draft.setText('Texto preservado');h.oldSet=h.draft.setText;h.oldTarget=h.draft.setConversationDraft;h.oldClear=h.draft.clearConversation;h.oldGet=h.draft.getConversationDraft; }); await settle(page);
  await page.evaluate(sid => h.change(sid), sidB); await settle(page);
  await page.evaluate(sid => h.change(sid,3), sidA); await settle(page);
  await page.evaluate(() => {h.oldSet('Texto antigo indevido');h.oldTarget('20000000-0000-4000-8000-000000000001','lead-a','Alvo antigo indevido');h.oldClear('20000000-0000-4000-8000-000000000001');}); await settle(page);
  assert.equal(await page.evaluate(() => h.draft.text), 'Texto preservado');
  assert.equal(await page.evaluate(() => h.oldGet('20000000-0000-4000-8000-000000000001','lead-a')), '');
  await page.evaluate(() => h.draft.setText('Texto atual')); await settle(page);
  assert.equal(await page.evaluate(() => h.draft.text), 'Texto atual');
});

test('same-SID token refresh preserves draft text key and the current callback lifetime', async t => {
  const page = await fixture(t);
  await page.evaluate(() => {h.draft.setText('Mesmo SID');h.savedSet=h.draft.setText;h.savedDraftKey=h.draft.key;}); await settle(page);
  await page.evaluate(sid => h.change(sid,2), sidA); await settle(page);
  assert.equal(await page.evaluate(() => h.draft.text==='Mesmo SID' && h.draft.key===h.savedDraftKey), true);
  await page.evaluate(() => h.savedSet('Refresh válido')); await settle(page);
  assert.equal(await page.evaluate(() => h.draft.text), 'Refresh válido');
});

test('draft user organization permission and logout changes still clear the previous owner', async t => {
  for (const mode of ['user','organization','permissions','logout']) {
    const page = await fixture(t);
    await page.evaluate(() => h.draft.setText('Privado anterior')); await settle(page);
    await page.evaluate(kind => {
      h.savedSet=h.draft.setText;
      if(kind==='user')h.auth.profile={id:'10000000-0000-4000-8000-000000000002'};
      if(kind==='organization')h.organizationId='org-b';
      if(kind==='permissions')h.auth.tenantContext={...h.auth.tenantContext,permissions:['whatsapp_view','whatsapp_operate']};
      if(kind==='logout'){h.auth.profile=null;h.auth.tenantContext=null;h.auth.session=null;h.organizationId=null;}
      h.render();h.savedSet('Callback antigo');
    }, mode); await settle(page);
    assert.equal(await page.evaluate(() => h.draft.text), '', mode);
    assert.equal(await page.evaluate(() => sessionStorage.getItem('vimob:whatsapp-drafts:v1')), null, mode);
    await page.close();
  }
});
