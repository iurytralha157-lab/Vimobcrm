import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Real media URL hook, React Query, audio player, inline video and viewer.
// Chromium decodes a synthetic PCM fixture; every HTTP request is intercepted.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const proof = 'D:/Vimob/tmp/whatsapp-final-four-fixes-20261014/playback';
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const wav = Buffer.alloc(44 + 8000 * 30);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32);
wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40); wav.fill(128, 44);
let browser, bundle;
before(async () => {
  await mkdir(proof, { recursive: true });
  const loader = join(proof, 'loader.cjs'), entry = join(proof, 'entry.js');
  const stubs = {
    api: 'export const whatsappAPI={getMessageMediaURL:(id,org,transport)=>window.h.request(id,org,transport)};',
    scope: 'export const useWhatsAppQueryScope=()=>window.h.scope;',
    attachments: 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async()=>{throw Error("Unexpected write")}});',
    image: 'import React from "react";export default function Image({unoptimized,fill,priority,...props}){return React.createElement("img",props)}',
    mention: 'export const useMentionNames=()=>({});',
    toast: 'export const toast=()=>{};',
  };
  for (const [name, code] of Object.entries(stubs)) await writeFile(join(proof, name + '.js'), code);
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),fs=require('node:fs'),path=require('node:path');module.exports=function(source){
    if(process.env.VIMOB_PLAYBACK_BASELINE==='1'){const rel=path.relative(${JSON.stringify(repository)},this.resourcePath).split(path.sep).join('/');const candidate=path.join(${JSON.stringify(proof)},rel.replaceAll('/','__')+'.before');if(fs.existsSync(candidate))source=fs.readFileSync(candidate,'utf8');}
    return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(entry, `import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {useWhatsAppMessageMediaURL} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-message-media-url.ts'))};
    import {MessageMedia} from ${JSON.stringify(join(repository, 'components/features/whatsapp/message-bubble/MessageMedia.tsx'))};
    const root=createRoot(document.getElementById('root')),client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const h=window.h={scope:{organizationId:'org-a',userId:'user-a',accessScope:'permission:sid-a'},kind:'audio',messageId:'message-a',sessionId:'session-a',leadId:'lead-a',count:1,requests:[],views:{},
      request(id,organizationId,transport){return new Promise((resolve,reject)=>this.requests.push({id,organizationId,transport,resolve,reject}));},
      complete(index,expiresIn=3600){this.requests[index].resolve({url:'http://127.0.0.1:47919/fixture.wav?token='+index,expiresIn});},
      render(changes={}){Object.assign(this,changes);flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(React.Fragment,null,Array.from({length:this.count},(_,index)=>React.createElement(Source,{key:index,index}))))));},
      unmount(){flushSync(()=>root.render(null));}};
    function Source({index}){const messageId=h.messageId+'-'+index;
      const source=useWhatsAppMessageMediaURL({messageId,leadId:h.leadId,sessionId:h.sessionId,storedMedia:true,mediaUrl:null,enabled:true});
      useEffect(()=>{h.views[index]=source});
      return React.createElement('section',{'data-player':index},React.createElement(MessageMedia,{mediaKind:h.kinds?.[index]||h.kind,content:'',mediaUrl:source.mediaUrl,
        playbackIdentity:source.playbackIdentity,mediaMimeType:'audio/wav',mediaStatus:source.failed?'failed':'ready',mediaError:source.failed?'Unavailable':null,
        mediaURLLoading:source.isLoading,onRefreshMedia:source.refresh,fromMe:false,status:'received',sentAt:'2026-10-14T12:00:00Z',messageId,leadId:h.leadId,
        leadName:'Lead sintético',audioAvatarName:'Lead sintético',audioAvatarInitial:'L',mediaGalleryScopeKey:JSON.stringify([h.scope,h.sessionId,h.leadId,messageId])}));}
    h.render();`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: proof, filename: 'playback.js' },
      resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/lib/api/whatsapp': join(proof, 'api.js'), '@/hooks/use-whatsapp-query-scope': join(proof, 'scope.js'),
          '@/hooks/use-lead-attachments': join(proof, 'attachments.js'), 'next/image': join(proof, 'image.js'),
          '@/hooks/use-mention-names': join(proof, 'mention.js'), '@/hooks/use-toast': join(proof, 'toast.js'), '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors()
      ? reject(Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(proof, 'playback.js'), 'utf8');
  browser = await chromium.launch({ headless: true });
}, { timeout: 120000 });
after(async () => { await browser?.close(); });
async function open(t, kind = 'audio') {
  const page = await browser.newPage(), errors = [], external = [];
  page.setDefaultTimeout(5000);
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (route.request().url().startsWith('http://127.0.0.1:47919/fixture.wav?token=')) {
      const range = route.request().headers().range?.match(/^bytes=(\d+)-(\d*)$/);
      const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), wav.length - 1) : wav.length - 1;
      return route.fulfill({ status: range ? 206 : 200, contentType: 'audio/wav', body: wav.subarray(start, end + 1),
        headers: { 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1),
          ...(range ? { 'Content-Range': `bytes ${start}-${end}/${wav.length}` } : {}) } });
    }
    external.push(route.request().url()); return route.abort();
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, []); assert.deepEqual(external, []); });
  await page.setContent('<main><div id="root"></div></main>');
  await page.addScriptTag({ content: bundle });
  await page.evaluate(kind => h.render({ kind: kind === 'viewer' ? 'video' : kind }), kind);
  await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => h.complete(0, 1));
  await page.waitForFunction(() => document.querySelector('audio,video')?.readyState >= 1);
  if (kind === 'viewer') {
    await page.getByRole('button', { name: 'Abrir vídeo em tela ampliada' }).click();
    await page.waitForFunction(() => document.querySelector('[role="dialog"] video')?.readyState >= 1);
    page.playbackSelector = '[role="dialog"] video';
  }
  return page;
}
const selector = (page, index = 0) => page.playbackSelector || `[data-player="${index}"] audio,[data-player="${index}"] video`;
const element = (page, index = 0) => page.locator(selector(page, index)).first();
async function playAt(page, index = 0, time = 3) {
  await element(page, index).evaluate(async (node, time) => {
    await new Promise(resolve => { node.addEventListener('seeked', resolve, { once: true }); node.currentTime = time; });
    node.playbackRate = 1.5; await node.play(); h.startTime = node.currentTime;
  }, time);
  await page.waitForFunction(selector => !document.querySelector(selector).paused, selector(page, index));
  assert.ok(await element(page, index).evaluate(node => node.currentTime >= 3), 'real PCM fixture sought before renewal');
}
async function renew(page) {
  await page.waitForFunction(() => h.requests.length >= 2);
  await page.evaluate(() => h.complete(1));
  await page.waitForFunction(() => h.views[0].mediaUrl?.endsWith('token=1'));
}
for (const kind of ['audio', 'video', 'viewer']) {
  test(`${kind}: TTL renewal keeps the playing element, position and rate`, async t => {
    const page = await open(t, kind); await playAt(page);
    await element(page).evaluate(node => { h.original = node; h.originalBars = [...document.querySelectorAll('[role="slider"] > div')].map(node => node.style.height); });
    await renew(page);
    assert.deepEqual(await element(page).evaluate(node => ({ same: node === h.original, playing: !node.paused,
      advanced: node.currentTime >= 3, rate: node.playbackRate, oldSource: (node.currentSrc || node.src).endsWith('token=0') })),
    { same: true, playing: true, advanced: true, rate: 1.5, oldSource: true });
    if (kind === 'audio') {
      assert.equal(await page.evaluate(() => h.originalBars.length), 28);
      assert.equal(await page.evaluate(() => JSON.stringify(h.originalBars) === JSON.stringify([...document.querySelectorAll('[role="slider"] > div')].map(node => node.style.height))), true);
    }
  });
  test(`${kind}: pausing adopts the renewed URL without losing seek or rate or resuming`, async t => {
    const page = await open(t, kind); await playAt(page);
    await element(page).evaluate(node => { node.volume = .35; node.muted = true; });
    await renew(page);
    await element(page).evaluate(node => { node.pause(); h.pauseTime = node.currentTime; });
    await page.waitForFunction(selector => document.querySelector(selector)?.currentSrc.endsWith('token=1'), selector(page));
    await page.waitForFunction(selector => Math.abs(document.querySelector(selector).currentTime - h.pauseTime) < .15, selector(page));
    assert.deepEqual(await element(page).evaluate(node => ({ paused: node.paused, rate: node.playbackRate, volume: node.volume, muted: node.muted })),
      { paused: true, rate: 1.5, volume: .35, muted: true });
  });
  test(`${kind}: the same asset can recover from the former token without losing play intent`, async t => {
    const page = await open(t, kind); await playAt(page); await renew(page);
    await element(page).evaluate(node => { h.errorTime = node.currentTime; node.dispatchEvent(new Event('error')); });
    await page.waitForFunction(selector => { const node = document.querySelector(selector); return node?.currentSrc.endsWith('token=1') && !node.paused && node.currentTime >= h.errorTime - .15; }, selector(page));
    assert.equal(await element(page).evaluate(node => node.playbackRate), 1.5);
  });
  test(`${kind}: a 403 during renewal clears even the playing pinned source`, async t => {
    const page = await open(t, kind); await playAt(page);
    await element(page).evaluate(node => { h.original = node; });
    await page.waitForFunction(() => h.requests.length >= 2);
    await page.evaluate(() => h.requests[1].reject({ status: 403, code: 'forbidden' }));
    await page.waitForFunction(selector => !document.querySelector(selector), selector(page));
    assert.equal(await page.evaluate(() => h.original.paused), true);
  });
}
test('scope, SID, lead and message ABA retire old playback and ignore late renewal responses', async t => {
  for (const field of ['organizationId', 'userId', 'accessScope', 'sessionId', 'leadId', 'messageId']) {
    const page = await open(t); await playAt(page); await element(page).evaluate(node => { h.original = node; });
    await page.waitForFunction(() => h.requests.length >= 2);
    await page.evaluate(field => { const scopeField = ['organizationId', 'userId', 'accessScope'].includes(field), original = scopeField ? h.scope : h[field];
      h.render(scopeField ? { scope: { ...original, [field]: original[field] + '-b' } } : { [field]: original + '-b' });
      h.render(scopeField ? { scope: original } : { [field]: original }); }, field);
    assert.equal(await page.locator('audio').count(), 0, `${field} removes the previous source synchronously`);
    await page.evaluate(() => h.complete(1));
    await page.waitForTimeout(50); assert.equal(await page.locator('audio').count(), 0, `${field} ignores former-generation source`);
    assert.equal(await page.evaluate(() => h.original.paused), true);
    await page.close();
  }
});
test('claiming another player pauses the former one and a renewed token does not restart it', async t => {
  const page = await open(t); await playAt(page); await renew(page);
  await page.evaluate(() => h.render({ count: 2 }));
  await page.waitForFunction(() => h.requests.length >= 3); await page.evaluate(() => h.complete(2));
  await page.waitForFunction(() => document.querySelector('[data-player="1"] audio')?.readyState >= 1);
  await playAt(page, 1);
  assert.equal(await element(page, 0).evaluate(node => node.paused), true);
  assert.equal(await element(page, 1).evaluate(node => node.paused), false);
});
test('audio, inline video and fullscreen share the same exclusive playback admission', async t => {
  const page = await open(t); await playAt(page);
  await page.evaluate(() => h.render({ count: 2, kinds: ['audio', 'video'] }));
  await page.waitForFunction(() => h.requests.some(request => request.id.endsWith('-1')));
  await page.evaluate(() => h.complete(h.requests.findIndex(request => request.id.endsWith('-1'))));
  await page.waitForFunction(() => document.querySelector('[data-player="1"] video')?.readyState >= 1);
  await playAt(page, 1);
  assert.equal(await element(page, 0).evaluate(node => node.paused), true);
  await page.getByRole('button', { name: 'Abrir vídeo em tela ampliada' }).click();
  page.playbackSelector = '[role="dialog"] video';
  await page.waitForFunction(() => document.querySelector('[role="dialog"] video')?.readyState >= 1);
  await playAt(page);
  assert.deepEqual(await page.locator('[data-player] audio,[data-player] video').evaluateAll(nodes => nodes.map(node => node.paused)), [true, true]);
  await page.getByRole('button', { name: 'Fechar visualizador' }).click();
  assert.equal(await page.locator('[role="dialog"] video').count(), 0);
});
test('unmount pauses native playback and late media refresh cannot remount it', async t => {
  const page = await open(t); await playAt(page); await element(page).evaluate(node => { h.original = node; });
  await page.waitForFunction(() => h.requests.length >= 2); await page.evaluate(() => { h.unmount(); h.complete(1); });
  await page.waitForTimeout(50); assert.equal(await page.locator('audio,video').count(), 0);
  assert.equal(await page.evaluate(() => h.original.paused), true);
});
for (const kind of ['audio', 'video', 'viewer']) {
  test(`${kind}: multiple rotations preserve the seek and the last renewed URL after pause`, async t => {
    const page = await open(t, kind); await playAt(page);
    await page.waitForFunction(() => h.requests.length >= 2); await page.evaluate(() => h.complete(1, 1));
    await page.waitForFunction(() => h.requests.length >= 3); await page.evaluate(() => h.complete(2));
    await page.waitForFunction(() => h.views[0].mediaUrl?.endsWith('token=2'));
    assert.equal(await element(page).evaluate(node => !node.paused && node.currentTime >= 3), true);
    await element(page).evaluate(node => { node.pause(); h.pauseTime = node.currentTime; });
    await page.waitForFunction(selector => document.querySelector(selector)?.currentSrc.endsWith('token=2'), selector(page));
    await page.waitForFunction(selector => Math.abs(document.querySelector(selector).currentTime - h.pauseTime) < .15, selector(page));
    assert.deepEqual(await element(page).evaluate(node => ({ paused: node.paused, rate: node.playbackRate })), { paused: true, rate: 1.5 });
  });
  test(`${kind}: rejected resume is reported without an autoplay retry loop`, async t => {
    const page = await open(t, kind); await playAt(page); await renew(page);
    await page.evaluate(selector => { h.resumeAttempts = 0; HTMLMediaElement.prototype.play = function() { h.resumeAttempts++; return Promise.reject(Error('Synthetic admission failure')); };
      document.querySelector(selector).dispatchEvent(new Event('error')); }, selector(page));
    await page.waitForFunction(() => h.resumeAttempts === 1);
    await page.waitForTimeout(100); assert.equal(await page.evaluate(() => h.resumeAttempts), 1);
    await element(page).waitFor({ state: 'detached' });
  });
  test(`${kind}: an invalid native seek fails visibly without an unhandled rejection`, async t => {
    const page = await open(t, kind); await playAt(page); await renew(page);
    await page.evaluate(selector => {
      const original = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
      Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', { configurable: true, get: original.get,
        set(value) { if ((this.currentSrc || this.src).includes('token=1')) throw Error('Synthetic seek admission failure'); original.set.call(this, value); } });
      document.querySelector(selector).dispatchEvent(new Event('error'));
    }, selector(page));
    await element(page).waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => h.requests.length), 2);
  });
  test(`${kind}: a late resume promise cannot restart a retired SID generation`, async t => {
    const page = await open(t, kind); await playAt(page); await renew(page);
    await page.evaluate(selector => { HTMLMediaElement.prototype.play = function() { h.pendingResumeNode = this;
      return new Promise(resolve => { h.releaseResume = resolve; }); }; document.querySelector(selector).dispatchEvent(new Event('error')); }, selector(page));
    await page.waitForFunction(() => Boolean(h.releaseResume));
    await page.evaluate(() => { h.render({ sessionId: 'retired-b' }); h.render({ sessionId: 'session-a' }); h.releaseResume(); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('audio,video').count(), 0);
    assert.equal(await page.evaluate(() => h.pendingResumeNode.paused), true);
  });
}
test('blob fallback is preserved on renewal and revoked on access loss', async t => {
  const page = await open(t);
  await element(page).evaluate(node => node.dispatchEvent(new Event('error')));
  await page.waitForFunction(() => document.querySelector('audio')?.currentSrc.startsWith('blob:'));
  await page.waitForFunction(() => document.querySelector('audio')?.readyState >= 1);
  await playAt(page); await renew(page);
  assert.equal(await element(page).evaluate(node => !node.paused && node.currentSrc.startsWith('blob:') && node.currentTime >= 3), true);
  await page.evaluate(() => { h.revoked = []; const original = URL.revokeObjectURL; URL.revokeObjectURL = value => { h.revoked.push(value); original(value); }; h.views[0].refresh().catch(() => {}); });
  await page.waitForFunction(() => h.requests.length >= 3); await page.evaluate(() => h.requests[2].reject({ status: 403, code: 'forbidden' }));
  await page.waitForFunction(() => !document.querySelector('audio') && h.revoked.length > 0);
});
