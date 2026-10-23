import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Real Radix avatar/recovery and Player. The Next Image shim renders a browser
// image, and every HTTP image response below is intercepted synthetic bytes.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url), { webpack } = require('next/dist/compiled/webpack/webpack.js');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=', 'base64');
const audio = Buffer.alloc(1644); audio.write('RIFF'); audio.writeUInt32LE(1636, 4); audio.write('WAVEfmt ', 8); audio.writeUInt32LE(16, 16); audio.writeUInt16LE(1, 20); audio.writeUInt16LE(1, 22); audio.writeUInt32LE(8000, 24); audio.writeUInt32LE(16000, 28); audio.writeUInt16LE(2, 32); audio.writeUInt16LE(16, 34); audio.write('data', 36); audio.writeUInt32LE(1600, 40);
const origin = 'https://avatar.synthetic.invalid';
const evidence = process.env.WHATSAPP_AVATAR_RECOVERY_EVIDENCE;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-avatar-recovery-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js'), image = join(directory, 'image.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;`);
  await writeFile(image, `import React from 'react';export default function Image({unoptimized,fill,...p}){return React.createElement('img',p);}`);
  await writeFile(entry, `import React from 'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';
    import{Avatar,AvatarFallback}from'@/components/ui/avatar';import{WhatsAppAvatarImage}from'@/components/features/whatsapp/WhatsAppAvatarImage';
    import{MessageAudioPlayer}from'@/components/features/whatsapp/message-bubble/MessageAudioPlayer';
    const root=createRoot(document.getElementById('root'));window.h={mode:'shared',props:{},calls:[],render(mode=this.mode,p=this.props){this.mode=mode;this.props=p;flushSync(()=>root.render(React.createElement(Host)));}};
    function Host(){const p=h.props;if(h.mode==='shared')return React.createElement(Avatar,{style:{width:36,height:36}},React.createElement(WhatsAppAvatarImage,{src:p.src,fallbackSrc:p.fallback,alt:'Lead sintético'}),React.createElement(AvatarFallback,null,'L'));
      if(h.mode==='player'){const player=React.createElement(MessageAudioPlayer,{safeMediaUrl:${JSON.stringify('data:audio/wav;base64,' + audio.toString('base64'))},mediaUrl:${JSON.stringify('data:audio/wav;base64,' + audio.toString('base64'))},normalizedMediaMimeType:'audio/wav',messageId:p.id||'audio-a',sentAt:'2026-10-14T10:00:00Z',fromMe:p.fromMe!==false,status:'sent',audioAvatarName:'Autor sintético',audioAvatarInitial:'A',safeAvatarUrl:p.src||null,contactAvatarFallbackUrl:p.fallback,attachableMediaUrl:p.attach?'https://media.synthetic.invalid/file.wav':null,leadId:'lead-a',onRequestAttach:()=>h.calls.push(['attach']),onDownload:()=>{},isDownloading:false});
        // The player inherits its orange/gray surface from MessageBubble. Preview
        // supplies those same caller classes; recovery cases keep the raw player.
        return p.preview?React.createElement('div',{className:'inline-block max-w-full rounded-[8px] border-0 shadow-none px-3 py-2 '+(p.fromMe!==false?'rounded-tr-[4px] bg-primary text-primary-foreground':'rounded-tl-[4px] text-[var(--app-text-primary)] bg-[var(--app-surface-soft)]')},player):player;}return null;}`);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'fixture.js', publicPath: '' }, resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { 'next/image': image, '@': repository } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] }, plugins: [new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 })] });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'fixture.js'), 'utf8');
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n@source "${join(repository, 'components/features/whatsapp').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui').replaceAll('\\', '/')}";`, { from: join(repository, 'app/avatar-recovery-fixture.css') })).css;
  browser = await chromium.launch({ headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
}, { timeout: 300000 });
after(async () => { await browser?.close(); if (directory) { const target = resolve(directory); assert.ok(target.startsWith(resolve(tmpdir()) + sep)); assert.match(basename(target), /^vimob-avatar-recovery-/); await rm(target, { recursive: true, force: true }); } });

async function fixture(t, mode, props, failures = {}) {
  const page = await browser.newPage({ viewport: { width: 320, height: 800 } }); page.setDefaultTimeout(4000);
  const requests = new Map(), external = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) { external.push(url.href); return route.abort(); }
    const count = (requests.get(url.pathname) || 0) + 1; requests.set(url.pathname, count);
    const fail = failures[url.pathname] === 'always' || count <= (failures[url.pathname] || 0);
    await route.fulfill({ status: fail ? 503 : 200, body: fail ? 'synthetic unavailable' : png, contentType: fail ? 'text/plain' : 'image/png', headers: { 'Cache-Control': fail ? 'no-store' : 'public, max-age=3600' } });
  });
  t.after(async () => { await page.close(); assert.deepEqual(external, [], 'no external network'); assert.deepEqual(errors, [], 'no uncaught browser errors'); });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:12px"><div id="root"></div></main>`); await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle }); await page.evaluate(({ mode, props }) => h.render(mode, props), { mode, props });
  return { page, requests, failures };
}
const image = page => page.getByRole('img', { name: /sintético/ });
async function render(page, props) { await page.evaluate(props => h.render(h.mode, props), props); }

test('actual incoming and outgoing audio controls fit compact viewports under product CSS', async t => {
  const { page } = await fixture(t, 'player', { src: `${origin}/author.png`, attach: true, preview: true }); await expect(image(page)).toBeVisible();
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) for (const fromMe of [true, false]) {
    await page.setViewportSize({ width, height: 800 }); await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    await render(page, { src: `${origin}/author.png`, attach: true, fromMe, preview: true }); await expect(image(page)).toBeVisible();
    // Reusing the same player changes inherited foreground through transition-colors.
    // Assert the settled color before capturing, so white-to-gray does not capture
    // the outgoing frame as if it were the received control's final appearance.
    await expect.poll(() => page.getByRole('button', { name: 'Reproduzir áudio' }).evaluate(n => {
      const parent = n.closest('.inline-block'); return { button: getComputedStyle(n).color, icon: getComputedStyle(n.querySelector('svg')).color, expected: getComputedStyle(parent).color };
    }).then(c => c.button === c.expected && c.icon === c.expected)).toBe(true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false);
    if (evidence) await page.screenshot({ path: join(evidence, `audio-${fromMe ? 'outgoing' : 'incoming'}-${width}-${theme}.png`), fullPage: true });
  }
});

test('shared avatar uses valid authorized fallback after primary fails without another retry', async t => {
  const { page, requests } = await fixture(t, 'shared', { src: `${origin}/primary.png`, fallback: `${origin}/fallback.png` }, { '/primary.png': 'always' });
  await expect(image(page)).toHaveAttribute('src', `${origin}/fallback.png`); await page.waitForTimeout(1000);
  // Routing disables HTTP cache: Radix preloads once, then its visible img loads.
  assert.equal(requests.get('/primary.png'), 1); assert.equal(requests.get('/fallback.png'), 2);
  assert.deepEqual(await page.locator('#root>span').evaluate(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })), { width: 36, height: 36 });
});

test('same avatar URL recovers one transient failure and permanent errors stop after one retry', async t => {
  const { page, requests } = await fixture(t, 'shared', { src: `${origin}/temporary.png` }, { '/temporary.png': 1 });
  await expect(image(page)).toHaveAttribute('src', `${origin}/temporary.png`); assert.equal(requests.get('/temporary.png'), 3);
  await render(page, { src: `${origin}/temporary.png` }); await page.waitForTimeout(1000); assert.equal(requests.get('/temporary.png'), 3);
  const failed = await fixture(t, 'shared', { src: `${origin}/failed.png`, fallback: `${origin}/failed-fallback.png` }, { '/failed.png': 'always', '/failed-fallback.png': 'always' });
  await expect.poll(() => failed.requests.get('/failed-fallback.png')).toBe(2); await failed.page.waitForTimeout(1100);
  assert.equal(failed.requests.get('/failed.png'), 2); assert.equal(failed.requests.get('/failed-fallback.png'), 2); await expect(image(failed.page)).toHaveCount(0);
});

test('changing avatar source cancels pending recovery; invalid sources never reach network', async t => {
  const { page, requests } = await fixture(t, 'shared', { src: `${origin}/first.png` }, { '/first.png': 'always' });
  await expect.poll(() => requests.get('/first.png')).toBe(1); await expect(image(page)).toHaveCount(0);
  await render(page, { src: `${origin}/next.png` }); await expect(image(page)).toHaveAttribute('src', `${origin}/next.png`); await page.waitForTimeout(1100); assert.equal(requests.get('/first.png'), 1);
  await render(page, { src: 'javascript:window.avatarInjected=true', fallback: '/relative.png' }); await expect(image(page)).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.avatarInjected), undefined); assert.equal(requests.size, 2);
});

test('audio same-URL error retries once then recovers, preserves attachment and received fallback', async t => {
  const { page, requests } = await fixture(t, 'player', { src: `${origin}/own.png`, attach: true }, { '/own.png': 1 });
  await expect(image(page)).toHaveAttribute('src', `${origin}/own.png`); await expect(image(page)).toBeVisible(); await expect.poll(() => requests.get('/own.png')).toBe(2);
  const attach = page.getByRole('button', { name: 'Anexar áudio à documentação do lead' });
  assert.deepEqual(await attach.evaluate(n => ({ width: n.getBoundingClientRect().width, height: n.getBoundingClientRect().height })), { width: 24, height: 24 });
  await attach.click(); assert.deepEqual(await page.evaluate(() => h.calls), [['attach']]);
  await render(page, { src: `${origin}/own.png`, attach: true }); await page.waitForTimeout(1100); assert.equal(requests.get('/own.png'), 2);
  const inbound = await fixture(t, 'player', { fromMe: false, src: `${origin}/lead-primary.png`, fallback: `${origin}/lead-fallback.png` }, { '/lead-primary.png': 'always' });
  await expect(image(inbound.page)).toHaveAttribute('src', `${origin}/lead-fallback.png`); await page.waitForTimeout(1000);
  assert.equal(inbound.requests.get('/lead-primary.png'), 1); assert.equal(inbound.requests.get('/lead-fallback.png'), 1);
});

test('outgoing audio never borrows a lead fallback and permanent image errors remain bounded', async t => {
  const { page, requests } = await fixture(t, 'player', { src: `${origin}/peer.png`, fallback: `${origin}/lead.png` }, { '/peer.png': 'always' });
  await expect.poll(() => requests.get('/peer.png')).toBe(2); await page.waitForTimeout(1100); await expect(image(page)).toHaveCount(0);
  assert.equal(requests.get('/peer.png'), 2); assert.equal(requests.has('/lead.png'), false);
  await render(page, { src: 'data:image/png;base64,ZmFrZQ==', fallback: `${origin}/lead.png` }); await expect(image(page)).toHaveCount(0); assert.equal(requests.has('/lead.png'), false);
});

test('audio generation resets retry eligibility without a stale earlier timer changing the new source', async t => {
  const { page, requests, failures } = await fixture(t, 'player', { id: 'audio-a', src: `${origin}/old.png` }, { '/old.png': 'always' });
  await expect.poll(() => requests.get('/old.png')).toBe(1); await expect(image(page)).toHaveCount(0);
  await render(page, { id: 'audio-b', src: `${origin}/new.png` }); await expect(image(page)).toHaveAttribute('src', `${origin}/new.png`); await page.waitForTimeout(1100); assert.equal(requests.get('/old.png'), 1);
  failures['/old.png'] = 0; await render(page, { id: 'audio-a', src: `${origin}/old.png` }); await expect(image(page)).toHaveAttribute('src', `${origin}/old.png`); await expect(image(page)).toBeVisible();
  assert.equal(requests.get('/old.png'), 2);
});
