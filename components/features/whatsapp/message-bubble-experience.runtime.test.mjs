import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';

// Real Bubble/players/viewer/Radix. Network, clipboard and audio play are mocked.
// Product CSS is compiled for geometry. This is Chromium, not native macOS.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const baseline = 'D:/Vimob/tmp/whatsapp-mac-experience-20261012/bubble';
const imageURL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S4AAAAASUVORK5CYII=';
const wav = Buffer.alloc(844); wav.write('RIFF'); wav.writeUInt32LE(836, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40); wav.fill(128, 44);
const audioURL = `data:audio/wav;base64,${wav.toString('base64')}`;
let directory, browser, bundle, css;

before(async () => {
  directory = await mkdtemp(join(tmpdir(), 'vimob-message-experience-'));
  const loader = join(directory, 'loader.cjs'), entry = join(directory, 'entry.js');
  const media = join(directory, 'media.js'), attachments = join(directory, 'attachments.js');
  const toast = join(directory, 'toast.js'), image = join(directory, 'image.js'), mention = join(directory, 'mention.js'), scope = join(directory, 'scope.js'), api = join(directory, 'api.js'), link = join(directory, 'link.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))}),fs=require('node:fs'),path=require('node:path');module.exports=function(source){
    if(process.env.VIMOB_MAC_BUBBLE_BASELINE==='1'){const rel=path.relative(${JSON.stringify(repository)},this.resourcePath),candidate=path.join(${JSON.stringify(baseline)},rel);if(!rel.startsWith('..')&&fs.existsSync(candidate))source=fs.readFileSync(candidate,'utf8');}
    return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(media, 'export const useWhatsAppMessageMediaURL=({mediaUrl})=>({mediaUrl,isLoading:false,failed:false,refresh:async()=>null});');
  await writeFile(attachments, `import {useState} from 'react';export function useCreateLeadAttachment(){const [isPending,setPending]=useState(false);return {isPending,mutateAsync:async input=>{window.h.attachmentCalls.push(input);if(!window.h.props.attachmentFixture)throw new Error('Unexpected attachment mutation');setPending(true);try{return await new Promise((resolve,reject)=>window.h.attachmentRequests.push({resolve,reject}));}finally{setPending(false);}}};}`);
  await writeFile(toast, 'export const toast=()=>{};');
  await writeFile(link, "import React from 'react';export default function Link(props){return React.createElement('a',props)}");
  await writeFile(image, `import React from 'react';export default function Image({src,unoptimized,priority,fill,...props}){return React.createElement('img',{...props,'data-actual-src':src,src:src.startsWith('data:image/')?src:window.h?.imageFixture||${JSON.stringify(imageURL)}})}`);
  await writeFile(mention, 'export const useMentionNames=()=>({5511999991111:"Ana"});');
  await writeFile(scope, 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await writeFile(api, 'export const whatsappAPI={getMessageMediaURL:(id,org,options)=>new Promise((resolve,reject)=>window.h.mediaRequests.push({id,org,options,resolve,reject}))};');
  await writeFile(entry, `import React,{useEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {MessageBubble} from ${JSON.stringify(join(repository, 'components/features/whatsapp/MessageBubble.tsx'))};
    import {Dialog,DialogContent,DialogTitle,DialogDescription} from ${JSON.stringify(join(repository, 'components/ui/dialog.tsx'))};
    import {OwnWhatsAppStartNotice} from ${JSON.stringify(join(repository, 'components/features/whatsapp/OwnWhatsAppStartNotice.tsx'))};
    import {ScrollToLatestButton} from ${JSON.stringify(join(repository, 'components/features/whatsapp/ScrollToLatestButton.tsx'))};
    import {MessageAudioPlayer} from ${JSON.stringify(join(repository, 'components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx'))};
    import {MediaViewer} from ${JSON.stringify(join(repository, 'components/features/whatsapp/MediaViewer.tsx'))};
    import {useWhatsAppMediaGallery} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-media-gallery.ts'))};
    const root=createRoot(document.getElementById('root'));const states=new WeakMap();
    window.h={mode:'bubble',scope:{organizationId:'org-a',userId:'user-a',accessScope:'allowed'},props:{},copies:[],replies:[],reactions:[],jumps:[],played:[],paused:[],keys:[],mediaRequests:[],manualRequests:[],attachmentCalls:[],attachmentRequests:[],galleryItems:[],galleryResults:[],render(mode=this.mode,props=this.props){this.mode=mode;this.props=props;if(props.queryScope)this.scope=props.queryScope;flushSync(()=>root.render(React.createElement(Host)))},unmount(){flushSync(()=>root.render(null))}};
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>h.copies.push(text)}});
    document.addEventListener('keydown',event=>h.keys.push(event.key));
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{configurable:true,get(){return states.get(this)!==false}});
    HTMLMediaElement.prototype.play=async function(){states.set(this,false);h.played.push(this.closest('[data-player-id]')?.dataset.playerId);this.dispatchEvent(new Event('play'))};
    HTMLMediaElement.prototype.pause=function(){if(states.get(this)===false){states.set(this,true);h.paused.push(this.closest('[data-player-id]')?.dataset.playerId);this.dispatchEvent(new Event('pause'))}};
    function GalleryHookHost(){const items=useWhatsAppMediaGallery({messages:h.props.messages||[],scopeKey:h.props.physicalScope||'physical-a',conversationId:h.props.conversationId});useEffect(()=>{h.galleryItems=items});if(h.props.preview)return React.createElement(MediaViewer,{src:${JSON.stringify(imageURL)},type:'image',messageId:'00000000-0000-4000-8000-000000000021',galleryScopeKey:h.props.physicalScope||'physical-a',gallery:items,isOpen:true,onClose:()=>h.unmount()});return React.createElement('div',null,items.map(item=>React.createElement('button',{key:item.id,onClick:()=>{h.savedRefresh=item.refresh;item.refresh?.().then(result=>h.galleryResults.push({result}),error=>h.galleryResults.push({error:error.status||error.message}))}},'Abrir '+item.id)))}
    function Host(){const p=h.props;if(h.mode==='jump')return React.createElement('div',{className:'relative h-36 bg-primary'},React.createElement(ScrollToLatestButton,{unreadCount:p.unreadCount,onClick:()=>h.replies.push('latest')}));if(h.mode==='own-start')return React.createElement(OwnWhatsAppStartNotice,{notice:p.notice,busy:p.busy,onStart:p.withoutAction?undefined:()=>h.replies.push('start')});if(h.mode==='gallery-hook')return React.createElement(GalleryHookHost);if(h.mode==='viewer')return React.createElement(MediaViewer,{src:p.url||${JSON.stringify(imageURL)},type:'image',messageId:'image-a',galleryScopeKey:p.scope||'scope-a',gallery:(p.gallery||[]).map(item=>item.lazy?{...item,url:'',refresh:()=>new Promise((resolve,reject)=>h.mediaRequests.push({id:item.id,scope:p.scope,resolve,reject}))}:item),isOpen:true,onClose:()=>h.render('bubble',{})});
      if(h.mode==='audio')return React.createElement('div',null,['A','B'].map(id=>React.createElement('section',{key:id,'data-player-id':id},React.createElement(MessageAudioPlayer,{safeMediaUrl:${JSON.stringify(audioURL)},mediaUrl:${JSON.stringify(audioURL)},normalizedMediaMimeType:'audio/wav',messageId:id,sentAt:'2026-10-12T10:00:00Z',fromMe:false,status:'received',audioAvatarName:'Contato',audioAvatarInitial:'C',safeAvatarUrl:null,leadId:'',onDownload:()=>{},isDownloading:false}))));
      if(h.mode==='metadata-comparison')return React.createElement('section',{role:'log',style:{display:'flex',flexDirection:'column',gap:'24px',padding:'12px',borderRadius:'8px',background:'var(--app-surface-muted)'}},p.messages.map((message,index)=>React.createElement(MessageBubble,{key:index,content:null,mediaUrl:null,mediaMimeType:null,mediaStatus:null,mediaError:null,fromMe:true,status:'read',sentAt:'2026-10-17T15:21:00Z',senderName:'Corretor sintético',isGroup:false,messageId:'00000000-0000-4000-8000-'+String(index+1).padStart(12,'0'),leadId:'',leadName:'Contato sintético',reactions:[],reactionPickerPosition:'outside',readOnly:true,...message})));
      const bubble=React.createElement('div',{role:'log'},React.createElement(MessageBubble,{content:'Mensagem de teste',messageType:'text',mediaUrl:null,mediaMimeType:null,mediaStatus:null,mediaError:null,fromMe:false,status:'received',sentAt:'2026-10-12T10:00:00Z',senderName:'Ana',isGroup:false,messageId:'00000000-0000-4000-8000-000000000001',leadId:'lead-one',leadName:'Lead',reactions:[],reactionPickerPosition:'outside',...p,onRetryMedia:p.manualDownload?()=>new Promise((resolve,reject)=>h.manualRequests.push({resolve,reject})):undefined,onReply:p.readOnly?undefined:()=>h.replies.push('reply'),onReact:p.readOnly?undefined:emoji=>h.reactions.push(emoji),onNavigateQuoted:p.navigate?async id=>h.jumps.push(id):undefined}));
      return p.dialogHost?React.createElement(Dialog,{open:true},React.createElement(DialogContent,null,React.createElement(DialogTitle,null,'Conversa sintética'),React.createElement(DialogDescription,null,'Teste local sem envio'),bubble)):bubble;}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'experience.js' },
      resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@/hooks/use-whatsapp-message-media-url': media, '@/hooks/use-whatsapp-query-scope': scope, '@/lib/api/whatsapp': api, '@/hooks/use-lead-attachments': attachments, '@/hooks/use-toast': toast, '@/hooks/use-mention-names': mention, 'next/image': image, 'next/link': link, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(directory, 'experience.js'), 'utf8');
  const productCss = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/whatsapp', 'components/ui', 'components/features/leads/LeadAttachments']
    .map(source => `@source "${join(repository, source).replaceAll('\\', '/')}";`).join('\n');
  const rendered = await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${productCss}\n${sources}`, { from: join(repository, 'app/message-experience-fixture.css') });
  css = rendered.css;
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });
after(async () => { await browser?.close(); if (directory) { assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + sep)); assert.ok(basename(directory).startsWith('vimob-message-experience-')); await rm(directory, { recursive: true, force: true }); } });

async function open(t, props = {}, mode = 'bubble', browserOptions = {}) {
  const page = await browser.newPage(browserOptions); page.setDefaultTimeout(3500); const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message)); await page.route('**/*', route => {
    // Only these synthetic attachment media are served entirely from local bytes.
    if (route.request().url() === 'https://example.test/synthetic-attachment-media.wav') return route.fulfill({ status: 200, contentType: 'audio/wav', body: wav });
    if (route.request().url() === 'https://example.test/synthetic-attachment-media.mp4') return route.fulfill({ status: 204, body: '' });
    network.push(route.request().url()); return route.abort();
  });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'No uncaught browser failure'); assert.deepEqual(network, [], 'No external network request'); });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:24px"><div id="root"></div></main>`); await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle }); await page.evaluate(({ props, mode }) => h.render(mode, props), { props, mode }); return page;
}

test('URL with @ keeps its destination and email text is not a mention', async t => {
  const page = await open(t, { content: 'https://example.test/@corretor andre@example.test @5511999991111' });
  assert.equal(await page.getByRole('link', { name: 'https://example.test/@corretor', exact: true }).getAttribute('href'), 'https://example.test/@corretor');
  assert.equal(await page.getByText('andre@example.test', { exact: true }).count(), 0); // Plain email shares a text flow, not a separate mention element.
  assert.equal(await page.locator('[data-message-id]').evaluate(node => node.textContent.includes('andre@example.test')), true);
  assert.equal(await page.getByText('@Ana', { exact: true }).count(), 1);
});
test('a ready sticker shows one timestamp and one outgoing delivery indicator', async t => {
  const page = await open(t, { messageType: 'sticker', mediaUrl: imageURL, mediaMimeType: 'image/png', mediaStatus: 'ready', content: null, fromMe: true, status: 'sent' });
  await page.locator('img').waitFor(); assert.equal(await page.locator('[data-message-timestamp-position]').count(), 1);
  assert.equal(await page.getByRole('img', { name: 'Mensagem enviada', exact: true }).count(), 1);
});

test('timestamps and receipts keep compact size and consistent colors for text and media in compact and page layouts', async t => {
  const page = await open(t);
  const cases = [
    { messageType: 'text', content: 'Mensagem sintética comprida para conferir horário e recibo.' },
    { messageType: 'image', mediaUrl: imageURL, mediaMimeType: 'image/png', mediaStatus: 'ready', content: 'Legenda da imagem' },
    { messageType: 'image', mediaUrl: null, mediaMimeType: 'image/png', mediaStatus: 'pending', content: null },
    { messageType: 'sticker', mediaUrl: imageURL, mediaMimeType: 'image/png', mediaStatus: 'ready', content: null },
    { messageType: 'document', mediaUrl: 'https://example.test/synthetic.pdf', mediaMimeType: 'application/pdf', mediaStatus: 'ready', mediaFilename: 'Proposta.pdf', content: null },
    { messageType: 'document', mediaUrl: null, mediaStatus: 'failed', content: null },
    { messageType: 'audio', mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready', content: null },
    { messageType: 'audio', mediaUrl: null, mediaStatus: 'pending', content: null },
    { messageType: 'video', mediaUrl: null, mediaStatus: 'failed', content: null },
  ];
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const compact of [true, false]) {
      for (const fromMe of [true, false]) {
        for (const fixture of cases) {
          const props = { ...fixture, compact, fromMe, status: fromMe ? 'read' : 'received', reactionPickerPosition: 'outside' };
          await page.evaluate(props => h.render('bubble', props), props);
          const metadata = page.locator('[data-message-timestamp-position]');
          assert.equal(await metadata.count(), 1, `${width}/${compact}/${fromMe}/${fixture.messageType}: one clock`);
          assert.equal(await metadata.getAttribute('data-message-timestamp-position'), fromMe ? 'bottom-right' : 'bottom-left');
          await metadata.waitFor({ state: 'visible' });
          const clock = await metadata.boundingBox(), bubble = await page.locator('[data-message-bubble]').boundingBox();
          assert.ok(clock && bubble);
          const clockCenter = clock.x + clock.width / 2, bubbleCenter = bubble.x + bubble.width / 2;
          assert.ok(fromMe ? clockCenter >= bubbleCenter : clockCenter <= bubbleCenter,
            `${width}/${compact}/${fromMe}/${fixture.messageType}: timestamp on requested side`);
          assert.equal(await page.getByRole('img', { name: 'Mensagem lida', exact: true }).count(), fromMe ? 1 : 0);
          const clockStyle = await metadata.evaluate(node => {
            const clock = [...node.querySelectorAll('span')].find(child => /^\d{2}:\d{2}$/.test(child.textContent.trim()) && !child.querySelector('[role="img"]')) || node;
            const style = getComputedStyle(clock);
            return { size: style.fontSize, color: style.color };
          });
          const referenceColors = await page.evaluate(() => {
            const reference = document.createElement('span'); document.body.append(reference);
            reference.style.color = 'var(--app-text-tertiary)'; const incoming = getComputedStyle(reference).color;
            reference.style.removeProperty('color'); reference.className = 'text-blue-400'; const read = getComputedStyle(reference).color;
            reference.className = 'text-primary-foreground/60'; const outgoing = getComputedStyle(reference).color;
            reference.remove(); return { incoming, read, outgoing };
          });
          const overlayClock = ['image', 'video', 'sticker'].includes(fixture.messageType) && fixture.mediaStatus === 'ready';
          assert.deepEqual(clockStyle, { size: '10px', color: overlayClock ? 'rgb(255, 255, 255)' : fromMe ? referenceColors.outgoing : referenceColors.incoming },
            `${width}/${compact}/${fromMe}/${fixture.messageType}/${fixture.mediaStatus || 'text'}: compact clock and direction color`);
          if (fromMe) {
            assert.deepEqual(await page.getByRole('img', { name: 'Mensagem lida', exact: true }).evaluate(node => {
              const style = getComputedStyle(node); return { width: style.width, height: style.height, color: style.color };
            }), { width: '12px', height: '12px', color: referenceColors.read }, 'read receipt stays blue and has a 12px visual size');
          }
          if (fixture.messageType === 'audio' && fixture.mediaStatus === 'ready') {
            const duration = page.locator('[data-message-audio-duration]');
            assert.deepEqual(await duration.evaluate(node => ({ size: getComputedStyle(node).fontSize, color: getComputedStyle(node).color })),
              { size: '10px', color: fromMe ? referenceColors.outgoing : referenceColors.incoming }, 'audio duration follows the clock typography');
          }
        }
      }
    }
  }
  const output = process.env.WHATSAPP_MESSAGE_METADATA_ARTIFACT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
      await page.setViewportSize({ width, height: 600 });
      await page.evaluate(({ theme, audioURL, compact }) => {
        document.documentElement.className = theme;
        h.render('metadata-comparison', { messages: [
          { messageType: 'text', content: 'Bom dia! Tudo bem?', compact },
          { messageType: 'audio', mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready', compact },
        ] });
      }, { theme, audioURL, compact: width < 500 });
      await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).waitFor();
      await page.locator('[data-message-bubble]').evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished.catch(() => {})))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'comparison has no horizontal overflow');
      await page.screenshot({ path: join(output, `message-metadata-${width}-${theme}.png`) });
    }
  }
});

test('ready audio aligns play and waveform, fills the track and keeps a low common metadata baseline at every layout width', async t => {
  const desktopPage = await open(t), touchPage = await open(t, {}, 'bubble', { hasTouch: true });
  const measurements = [];
  for (const width of [320, 390, 1440]) for (const compact of [true, false]) for (const fromMe of [true, false]) {
    const page = width < 500 ? touchPage : desktopPage;
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    assert.equal(await page.evaluate(() => matchMedia('(pointer:coarse)').matches), width < 500, 'narrow-screen geometry uses touch-pointer CSS');
    const shared = { compact, fromMe, status: fromMe ? 'read' : 'received', showSenderName: false, reactions: [] };
    const footerInset = () => page.locator('[data-message-timestamp-position]').evaluate(node => {
      const footer = node.getBoundingClientRect(), bubble = node.closest('[data-message-bubble]').getBoundingClientRect();
      return { bottom: bubble.bottom - footer.bottom, innerPadding: Number.parseFloat(getComputedStyle(node.parentElement).paddingBottom) || 0 };
    });
    await page.evaluate(props => h.render('bubble', props), { ...shared, messageType: 'text', content: 'Mensagem sintética de referência' });
    const textInset = await footerInset();
    await page.evaluate(props => h.render('bubble', props), { ...shared, messageType: 'document', content: null, mediaUrl: 'https://example.test/synthetic.pdf', mediaMimeType: 'application/pdf', mediaFilename: 'Documento.pdf', mediaStatus: 'ready' });
    const documentInset = await footerInset();
    await page.evaluate(props => h.render('bubble', props), { ...shared, messageType: 'audio', content: null, mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready' });
    await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).waitFor();
    const geometry = await page.locator('[data-message-audio-player]').evaluate(node => {
      const play = node.querySelector('button[aria-label="Reproduzir áudio"]'), slider = node.querySelector('[role="slider"]');
      const bars = [...slider.children], duration = node.querySelector('[data-message-audio-duration]'), timestamp = node.querySelector('[data-message-timestamp-position]');
      const rect = element => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom, centerY: y + height / 2 };
      };
      return { play: rect(play), slider: rect(slider), first: rect(bars[0]), last: rect(bars.at(-1)), duration: rect(duration), timestamp: rect(timestamp), gap: getComputedStyle(slider).columnGap,
        barCount: bars.length, overflow: node.scrollWidth > node.clientWidth,
        bubble: rect(node.closest('[data-message-bubble]')), player: rect(node) };
    });
    measurements.push({ width, compact, fromMe, textInset, documentInset, ...geometry });
    if (process.env.WHATSAPP_MESSAGE_AUDIO_GEOMETRY_ARTIFACT_DIR) {
      await mkdir(process.env.WHATSAPP_MESSAGE_AUDIO_GEOMETRY_ARTIFACT_DIR, { recursive: true });
      await writeFile(join(process.env.WHATSAPP_MESSAGE_AUDIO_GEOMETRY_ARTIFACT_DIR, 'audio-geometry-measurements.json'), JSON.stringify(measurements, null, 2));
    }
    const label = `${width}/${compact ? 'compact' : 'page'}/${fromMe ? 'outgoing' : 'incoming'}`;
    assert.ok(Math.abs(geometry.play.centerY - geometry.slider.centerY) <= 1, `${label}: waveform is vertically centered with play`);
    assert.ok(geometry.barCount > 1 && Math.abs(geometry.first.x - geometry.slider.x) <= 1, `${label}: waveform starts at track edge`);
    assert.ok(Math.abs(geometry.last.right - geometry.slider.right) <= 1, `${label}: waveform fills all remaining track width`);
    assert.ok(geometry.first.width > 0 && geometry.last.width > 0, `${label}: waveform bars remain visible at narrow widths`);
    assert.ok(geometry.first.x >= geometry.slider.x - 1 && geometry.last.right <= geometry.slider.right + 1, `${label}: waveform never overflows track`);
    assert.ok(Math.abs(geometry.duration.centerY - geometry.timestamp.centerY) <= 1, `${label}: duration and timestamp share one metadata row`);
    const audioInset = geometry.bubble.bottom - geometry.timestamp.bottom;
    assert.ok(Math.abs(audioInset - textInset.bottom) <= 1, `${label}: audio footer has the same lower inset as ordinary messages (${audioInset}/${textInset.bottom})`);
    assert.ok(Math.abs(audioInset - (documentInset.bottom - documentInset.innerPadding)) <= 1, `${label}: document and audio share the lower inset outside the document card`);
    assert.equal(geometry.overflow, false, `${label}: player has no overflow`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${label}: page has no horizontal overflow`);
    for (const seconds of [7200, 36000]) {
      await page.locator('audio').evaluate((audio, seconds) => {
        Object.defineProperty(audio, 'duration', { configurable: true, value: seconds });
        Object.defineProperty(audio, 'currentTime', { configurable: true, writable: true, value: 0 });
        audio.dispatchEvent(new Event('loadedmetadata')); audio.dispatchEvent(new Event('canplay')); audio.dispatchEvent(new Event('timeupdate'));
      }, seconds);
      await expect(page.locator('[data-message-audio-duration]')).toHaveText(`${seconds / 60}:00`);
      const longFooter = await page.locator('[data-message-audio-player]').evaluate(node => {
        const rect = selector => { const { x, y, width, height, right, bottom } = node.querySelector(selector).getBoundingClientRect(); return { x, y, width, height, right, bottom, centerY: y + height / 2 }; };
        const { x, right } = node.getBoundingClientRect();
        return { player: { x, right }, duration: rect('[data-message-audio-duration]'), timestamp: rect('[data-message-timestamp-position]'), overflow: node.scrollWidth > node.clientWidth };
      });
      measurements.push({ width, compact, fromMe, seconds, ...longFooter });
      const left = fromMe ? longFooter.duration : longFooter.timestamp, right = fromMe ? longFooter.timestamp : longFooter.duration;
      assert.ok(left.right + 7 <= right.x, `${label}/${seconds}: duration and clock do not overlap or lose their gap`);
      assert.ok(Math.abs(left.centerY - right.centerY) <= 1, `${label}/${seconds}: a long duration remains on the same metadata line`);
      assert.ok(left.x >= longFooter.player.x && right.right <= longFooter.player.right + 1, `${label}/${seconds}: long metadata remains within the player`);
      assert.equal(longFooter.overflow, false, `${label}/${seconds}: long metadata causes no overflow`);
      const slider = page.getByRole('slider', { name: 'Posição do áudio', exact: true });
      const track = await slider.boundingBox();
      await slider.click({ position: { x: track.width / 2, y: track.height / 2 } });
      assert.ok(Math.abs((await page.locator('audio').evaluate(audio => audio.currentTime)) / seconds - 0.5) <= 1 / track.width, `${label}/${seconds}: middle click seeks the middle of the full-width track`);
      await slider.focus(); await page.keyboard.press('End');
      assert.equal(await page.locator('audio').evaluate(audio => audio.currentTime), seconds, `${label}/${seconds}: End seeks to the end`);
      await page.keyboard.press('Home');
      assert.equal(await page.locator('audio').evaluate(audio => audio.currentTime), 0, `${label}/${seconds}: Home seeks to the start`);
    }
  }
  const output = process.env.WHATSAPP_MESSAGE_AUDIO_GEOMETRY_ARTIFACT_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'audio-geometry-measurements.json'), JSON.stringify(measurements, null, 2));
    for (const width of [320, 390, 1440]) for (const fromMe of [true, false]) for (const theme of ['light', 'dark']) {
      const page = width < 500 ? touchPage : desktopPage;
      await page.setViewportSize({ width, height: 650 });
      await page.evaluate(({ width, fromMe, theme, audioURL }) => {
        document.documentElement.className = theme;
        const shared = { compact: width < 500, fromMe, status: fromMe ? 'read' : 'received', showSenderName: false };
        h.render('metadata-comparison', { messages: [
          { ...shared, messageType: 'text', content: 'Bom dia! Tudo bem?' },
          { ...shared, messageType: 'audio', mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready' },
          { ...shared, messageType: 'document', mediaUrl: 'https://example.test/synthetic.pdf', mediaMimeType: 'application/pdf', mediaFilename: 'Documento.pdf', mediaStatus: 'ready' },
        ] });
      }, { width, fromMe, theme, audioURL });
      await page.getByRole('slider', { name: 'Posição do áudio', exact: true }).waitFor();
      await page.locator('[data-message-bubble]').evaluateAll(nodes => Promise.all(nodes.flatMap(node => node.getAnimations().map(animation => animation.finished.catch(() => {})))));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'comparison keeps text, audio and document inside the viewport');
      await page.screenshot({ path: join(output, `audio-geometry-${width}-${fromMe ? 'outgoing' : 'incoming'}-${theme}.png`) });
    }
  }
});

test('message text follows compact small-screen and desktop product typography', async t => {
  const page = await open(t, { content: 'Texto sintético', compact: false });
  for (const [width, compact, size] of [[390, false, '12px'], [1440, false, '12px'], [1440, true, '12px']]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(compact => h.render('bubble', { content: 'Texto sintético', compact }), compact);
    assert.deepEqual(await page.locator('[data-message-text]').evaluate(node => {
      const style = getComputedStyle(node); return { size: style.fontSize, weight: style.fontWeight };
    }), { size, weight: '200' });
  }
});

test('lighter message bodies keep their weight in lists and shared contact or location text', async t => {
  const page = await open(t, { content: '- Primeiro item\n1. Segundo item\n*Destaque explícito*' });
  assert.deepEqual(await page.locator('[data-message-text] li').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontWeight)), ['200', '200']);
  assert.equal(await page.locator('[data-message-text] strong').evaluate(node => getComputedStyle(node).fontWeight), '400');
  await page.evaluate(() => h.render('bubble', {
    content: null, contacts: [{ display_name: 'Contato sintético', phones: ['+55 11 99999-0000'] }],
    location: { latitude: 0, longitude: 0, name: 'Local sintético', address: 'Endereço sintético' },
  }));
  for (const text of ['+55 11 99999-0000', 'Local sintético', 'Endereço sintético']) {
    assert.equal(await page.getByText(text, { exact: true }).evaluate(node => getComputedStyle(node).fontWeight), '200');
  }
  assert.equal(await page.getByRole('button', { name: 'Copiar coordenadas' }).evaluate(node => getComputedStyle(node).fontWeight), '300');
});

test('image metadata keeps the original white overlay with attachment only in the message menu', async t => {
  const page = await open(t);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const compact of [true, false]) for (const fromMe of [true, false]) for (const caption of [null, 'Legenda sintética']) {
      await page.evaluate(props => h.render('bubble', props), { messageType: 'image', mediaUrl: 'https://example.test/photo.png', mediaMimeType: 'image/png', mediaStatus: 'ready', content: caption, compact, fromMe, status: fromMe ? 'read' : 'received', canAttachToLead: true });
      const frame = page.locator('[data-message-media-frame="image"]');
      const footer = frame.locator('[data-message-timestamp-position]');
      await frame.waitFor(); await footer.waitFor();
      await frame.locator('img').evaluate(node => node.decode());
      assert.equal(await frame.locator('[data-message-timestamp-position]').count(), 1, 'clock uses the original image overlay');
      assert.equal(await page.locator('[data-message-media-metadata]').count(), 0, 'separate image footer was removed at the user request');
      assert.equal(await page.locator('[data-message-timestamp-position]').count(), 1, 'one clock per image');
      const picture = await frame.boundingBox(), metadata = await footer.boundingBox();
      assert.ok(metadata.y >= picture.y && metadata.y + metadata.height <= picture.y + picture.height, `metadata stays inside the photo corner: ${JSON.stringify({ width, compact, fromMe, caption, picture, metadata })}`);
      assert.equal(await footer.getAttribute('data-message-timestamp-position'), fromMe ? 'bottom-right' : 'bottom-left');
      assert.equal(await page.getByRole('img', { name: 'Mensagem lida', exact: true }).count(), fromMe ? 1 : 0);
      assert.deepEqual(await footer.locator('span').first().evaluate(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight, color: getComputedStyle(node).color })), { size: '10px', weight: '300', color: 'rgb(255, 255, 255)' });
      assert.equal(await frame.getByRole('button', { name: /Anexar/ }).count(), 0, 'the image overlay contains no inline attachment control');
      await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).click();
      await page.getByRole('alertdialog').waitFor();
      assert.deepEqual(await page.evaluate(() => h.attachmentCalls), [], 'opening the existing confirmation never mutates');
      await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
      assert.equal(await page.getByRole('alertdialog').count(), 0);
    }
  }
  for (const state of ['ready', 'pending', 'failed']) {
    await page.evaluate(({ state, url }) => h.render('bubble', { messageType: 'image', mediaUrl: state === 'ready' ? url : null, mediaMimeType: 'image/png', mediaStatus: state, content: null, fromMe: false, status: 'received', canAttachToLead: false }), { state, url: imageURL });
    assert.equal(await page.locator('[data-message-media-metadata]').count(), 0);
    assert.equal(await page.locator('[data-message-timestamp-position]').count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Anexar mídia à documentação do lead' }).count(), 0);
  }
  // Synthetic visual fixture; no customer image or remote media is loaded.
  await page.setViewportSize({ width: 900, height: 650 });
  const output = 'D:/Vimob/tmp/whatsapp-typography-media-local-20261014/screenshots';
  await mkdir(output, { recursive: true });
  await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 600; canvas.height = 400;
    const context = canvas.getContext('2d');
    context.fillStyle = '#d7e4e6'; context.fillRect(0, 0, 600, 400);
    context.fillStyle = '#90b9aa'; context.fillRect(0, 280, 600, 120);
    context.fillStyle = '#f7f4eb'; context.fillRect(160, 130, 280, 180);
    context.fillStyle = '#6c858e'; context.beginPath(); context.moveTo(130, 130); context.lineTo(300, 35); context.lineTo(470, 130); context.fill();
    context.fillStyle = '#90b9aa'; context.fillRect(205, 180, 65, 60); context.fillRect(330, 180, 65, 60);
    context.fillStyle = '#6c858e'; context.fillRect(285, 245, 40, 65);
    h.imageFixture = canvas.toDataURL('image/png');
  });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => {
      document.documentElement.className = theme;
      h.render('bubble', { messageType: 'image', mediaUrl: 'https://example.test/photo.png', mediaMimeType: 'image/png', mediaStatus: 'ready', content: null, fromMe: true, status: 'read', canAttachToLead: true });
    }, theme);
    await page.locator('[data-message-media-frame="image"] img').evaluate(node => node.decode());
    await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-message-id]')).opacity === '1', null, { timeout: 1500 });
    await page.waitForFunction(() => document.querySelector('[data-message-bubble]').getAnimations().every(animation => animation.playState !== 'running'), null, { timeout: 1500 });
    await page.screenshot({ path: join(output, `image-overlay-white-${theme}.png`) });
  }
});

const attachmentMediaCases = [
  { messageType: 'audio', mediaUrl: 'https://example.test/synthetic-attachment-media.wav', mediaMimeType: 'audio/wav', mediaFilename: 'audio-sintetico.wav' },
  { messageType: 'image', mediaUrl: 'https://example.test/photo.png', mediaMimeType: 'image/png', mediaFilename: 'imagem-sintetica.png' },
  { messageType: 'video', mediaUrl: 'https://example.test/synthetic-attachment-media.mp4', mediaMimeType: 'video/mp4', mediaFilename: 'video-sintetico.mp4' },
  { messageType: 'document', mediaUrl: 'https://example.test/synthetic.pdf', mediaMimeType: 'application/pdf', mediaFilename: 'documento-sintetico.pdf' },
  { messageType: 'sticker', mediaUrl: 'https://example.test/sticker.webp', mediaMimeType: 'image/webp', mediaFilename: 'figurinha-sintetica.webp' },
];

test('all authorized media expose attachment in the message menu for compact, page and narrow-screen layouts', async t => {
  const page = await open(t);
  const output = process.env.WHATSAPP_MESSAGE_ATTACH_ARTIFACT_DIR;
  if (output) await mkdir(output, { recursive: true });
  for (const width of [320, 390, 1440]) for (const compact of [true, false]) for (const fromMe of [true, false]) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    for (const fixture of attachmentMediaCases) {
      await page.evaluate(props => h.render('bubble', props), { ...fixture, content: 'Legenda sintética', mediaStatus: 'ready', compact, fromMe, status: fromMe ? 'read' : 'received', canAttachToLead: true });
      const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
      assert.equal(await page.getByRole('button', { name: /Anexar/ }).count(), 0, 'there is no inline attachment button on any media');
      await trigger.click();
      for (const name of ['Copiar texto', 'Dados da mensagem', 'Anexar ao lead']) await page.getByRole('menuitem', { name, exact: true }).waitFor();
      const menu = page.getByRole('menu');
      const box = await menu.boundingBox();
      assert.ok(box && box.x >= 0 && box.x + box.width <= width, `${width}/${compact}/${fromMe}/${fixture.messageType}: menu fits viewport`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'menu causes no horizontal scroll');
      if (output && compact && fromMe && fixture.messageType === 'audio') {
        await page.screenshot({ path: join(output, `attachment-menu-${width}.png`) });
      }
      await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).click();
      const confirmation = page.getByRole('alertdialog', { name: 'Anexar ao Lead', exact: true });
      await confirmation.waitFor();
      assert.equal(await page.getByRole('menu').count(), 0, 'opening the existing confirmation closes the menu');
      assert.deepEqual(await page.evaluate(() => h.attachmentCalls), [], 'selection cannot attach until explicit confirmation');
      await confirmation.getByRole('button', { name: 'Cancelar', exact: true }).click();
      await confirmation.waitFor({ state: 'hidden' });
      await expect(trigger).toBeFocused();
    }
  }
  assert.deepEqual(await page.evaluate(() => [h.attachmentCalls, h.replies, h.reactions]), [[], [], []]);
});

test('attachment menu never exposes an unavailable, unauthorized, local or removed source', async t => {
  const page = await open(t);
  const base = { messageType: 'image', mediaUrl: 'https://example.test/photo.png', mediaMimeType: 'image/png', mediaStatus: 'ready', content: 'Conteúdo sintético', canAttachToLead: true };
  const cases = [
    { label: 'permission denied', canAttachToLead: false },
    { label: 'missing lead', leadId: '' },
    { label: 'missing source', mediaUrl: null, mediaStatus: 'pending' },
    { label: 'invalid URL', mediaUrl: 'javascript:alert(1)' },
    { label: 'provider encrypted source', mediaUrl: 'https://mmg.whatsapp.net/synthetic.enc' },
    { label: 'data source', mediaUrl: imageURL },
    { label: 'blob source', mediaUrl: 'blob:https://example.test/synthetic' },
    { label: 'ordinary text', messageType: 'text', mediaUrl: null, mediaMimeType: null },
    { label: 'removed message', messageType: 'deleted' },
  ];
  for (const { label, ...fixture } of cases) {
    await page.evaluate(props => h.render('bubble', props), { ...base, ...fixture });
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
    assert.equal(await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).count(), 0, label);
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('menu').waitFor({ state: 'hidden' });
  }
  assert.deepEqual(await page.evaluate(() => h.attachmentCalls), []);
});

test('explicit attachment confirmation keeps the existing lead, source and metadata with pending and failed retry behavior', async t => {
  const page = await open(t);
  for (const fixture of attachmentMediaCases) {
    const props = { ...fixture, content: null, mediaStatus: 'ready', mediaSize: 2048, leadId: 'lead-synthetic-one', leadName: 'Lead sintético',
      messageId: '00000000-0000-4000-8000-000000000012', attachmentFixture: true, canAttachToLead: true };
    await page.evaluate(props => h.render('bubble', props), props);
    const before = await page.evaluate(() => h.attachmentCalls.length);
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).click();
    const confirmation = page.getByRole('alertdialog', { name: 'Anexar ao Lead', exact: true });
    await confirmation.getByRole('button', { name: 'Anexar', exact: true }).click();
    await expect(confirmation.getByRole('button', { name: 'Anexar', exact: true })).toBeDisabled();
    assert.deepEqual(await page.evaluate(() => h.attachmentCalls.at(-1)), {
      lead_id: props.leadId, file_name: fixture.mediaFilename, file_url: fixture.mediaUrl, file_type: fixture.messageType, file_size: 2048, message_id: props.messageId,
    });
    assert.equal(await page.evaluate(() => h.attachmentCalls.length), before + 1);
    await expect(confirmation.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
    // An error leaves the same confirmation usable for an intentional retry.
    await page.evaluate(() => h.attachmentRequests.at(-1).reject(new Error('Synthetic attachment failure')));
    await expect(confirmation.getByRole('button', { name: 'Anexar', exact: true })).toBeEnabled();
    await confirmation.getByRole('button', { name: 'Anexar', exact: true }).click();
    assert.equal(await page.evaluate(() => h.attachmentCalls.length), before + 2);
    await page.evaluate(() => h.attachmentRequests.at(-1).resolve({ id: 'synthetic-attachment' }));
    await confirmation.waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => h.attachmentCalls.at(-1)), await page.evaluate(() => h.attachmentCalls.at(-2)), 'retry uses the same exact authorized source');
  }
});

test('attachment Escape in the lead dialog returns focus without closing the conversation or mutating', async t => {
  const page = await open(t, { ...attachmentMediaCases[0], content: null, mediaStatus: 'ready', compact: true, dialogHost: true, canAttachToLead: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const parent = page.getByRole('dialog', { name: 'Conversa sintética', exact: true });
  const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
  await trigger.focus(); await page.keyboard.press('Enter');
  await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('alertdialog', { name: 'Anexar ao Lead', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
  await parent.waitFor(); await expect(trigger).toBeFocused();
  assert.deepEqual(await page.evaluate(() => [h.attachmentCalls, h.replies, h.reactions]), [[], [], []]);
});

test('an open attachment confirmation cannot follow a changed lead, message, session or permission', async t => {
  const page = await open(t);
  const base = { ...attachmentMediaCases[1], content: null, mediaStatus: 'ready', canAttachToLead: true,
    leadId: 'lead-synthetic-one', messageId: '00000000-0000-4000-8000-000000000012', conversationSessionId: 'session-synthetic-one' };
  for (const change of [
    { leadId: 'lead-synthetic-two' },
    { messageId: '00000000-0000-4000-8000-000000000013' },
    { conversationSessionId: 'session-synthetic-two' },
    { canAttachToLead: false },
  ]) {
    await page.evaluate(props => h.render('bubble', props), base);
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).click();
    await page.getByRole('alertdialog').waitFor();
    await page.evaluate(props => h.render('bubble', props), { ...base, ...change });
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    await page.evaluate(props => h.render('bubble', props), base);
    assert.equal(await page.getByRole('alertdialog').count(), 0, 'returning to the original identity never reopens a stale confirmation');
    assert.deepEqual(await page.evaluate(() => h.attachmentCalls), []);
  }
});

test('message menus and details use compact Vimob typography and control radius', async t => {
  const page = await open(t, { content: 'Mensagem sintética' });
  for (const width of [390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(theme => document.documentElement.className = theme, theme);
    const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
    assert.equal(await trigger.evaluate(node => getComputedStyle(node).borderRadius), '6px');
    await trigger.click();
    for (const name of ['Copiar texto', 'Dados da mensagem']) {
      assert.deepEqual(await page.getByRole('menuitem', { name, exact: true }).evaluate(node => {
        const style = getComputedStyle(node), icon = getComputedStyle(node.querySelector('svg'));
        return { size: style.fontSize, weight: style.fontWeight, radius: style.borderRadius, icon: icon.width };
      }), { size: '12px', weight: '300', radius: '6px', icon: '14px' });
    }
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    assert.deepEqual(await page.getByRole('heading', { name: 'Dados da mensagem' }).evaluate(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight })), { size: '14px', weight: '400' });
    const values = await page.getByRole('dialog').locator('p,dt,dd').evaluateAll(nodes => nodes.map(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight })));
    assert.equal(values.length, 10);
    assert.ok(values.every(value => value.size === '12px' && value.weight === '300'));
    if (width === 1440 && theme === 'light') {
      const output = 'D:/Vimob/tmp/whatsapp-typography-media-local-20261014/screenshots';
      await mkdir(output, { recursive: true });
      await page.screenshot({ path: join(output, 'message-details.png') });
    }
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
  }
});

test('message details keep left-aligned content and a separate neutral close target within narrow screens', async t => {
  const page = await open(t, { content: 'Mensagem sintética', senderName: 'Contato sintético', mediaFilename: 'arquivo-sintetico-'.repeat(14) + '.pdf' });
  const measurements = [];
  for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.evaluate(theme => document.documentElement.className = theme, theme);
    const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
    await trigger.click();
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Dados da mensagem', exact: true });
    await dialog.waitFor();
    assert.equal(await dialog.getByText('Estado registrado no CRM. Horários adicionais do provedor não são inferidos.', { exact: true }).count(), 0);
    assert.equal(await dialog.getAttribute('aria-describedby'), null, 'the removed description leaves no dangling accessible reference');
    const measurement = await dialog.evaluate(node => {
      const close = node.querySelector(':scope > button'), header = node.querySelector('h2').parentElement, data = node.querySelector('dl');
      const style = getComputedStyle(node), closeStyle = getComputedStyle(close), rect = node.getBoundingClientRect();
      const dataStyle = getComputedStyle(data);
      const closeRect = close.getBoundingClientRect(), titleRect = node.querySelector('h2').getBoundingClientRect();
      return { padding: style.padding, gap: style.gap, closeSize: [closeStyle.width, closeStyle.height], closeRadius: closeStyle.borderRadius,
        closeBackground: closeStyle.backgroundColor, closeBorder: closeStyle.borderTopWidth, closeShadow: closeStyle.boxShadow, headerAlign: getComputedStyle(header).textAlign,
        dataBackground: dataStyle.backgroundColor, dataRadius: dataStyle.borderRadius, dataPadding: dataStyle.padding,
        textAlignments: [...node.querySelectorAll('h2,p,dt,dd')].map(child => getComputedStyle(child).textAlign),
        titleClearsClose: titleRect.right <= closeRect.left, overflow: node.scrollWidth > node.clientWidth,
        contained: rect.left >= 8 && rect.right <= innerWidth - 8 && rect.top >= 8 && rect.bottom <= innerHeight - 8 };
    });
    measurements.push({ width, theme, ...measurement });
    const output = process.env.WHATSAPP_MESSAGE_DETAILS_ARTIFACT_DIR;
    if (output) {
      await mkdir(output, { recursive: true });
      await writeFile(join(output, 'message-details-measurements.json'), JSON.stringify(measurements, null, 2));
      await page.screenshot({ path: join(output, `message-details-${width}-${theme}.png`) });
    }
    assert.equal(measurement.padding, '16px');
    assert.equal(measurement.gap, '12px');
    assert.deepEqual(measurement.closeSize, ['28px', '28px']);
    assert.equal(measurement.closeRadius, '6px');
    assert.notEqual(measurement.closeBackground, 'rgba(0, 0, 0, 0)');
    assert.equal(measurement.closeBorder, '0px');
    assert.equal(measurement.dataBackground, measurement.closeBackground, 'the data block uses the same neutral gray surface as the close control');
    assert.equal(measurement.dataRadius, '6px');
    assert.equal(measurement.dataPadding, '12px');
    assert.ok(measurement.closeShadow === 'none' || (measurement.closeShadow.match(/-?[\d.]+px/g) || []).every(size => Number.parseFloat(size) === 0), 'the close target has no persistent orange ring');
    assert.equal(measurement.headerAlign, 'left');
    assert.ok(measurement.textAlignments.every(alignment => alignment === 'left'));
    assert.equal(measurement.titleClearsClose, true);
    assert.equal(measurement.overflow, false);
    assert.equal(measurement.contained, true);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await expect(trigger).toBeFocused();
  }
  if (process.env.WHATSAPP_MESSAGE_DETAILS_ARTIFACT_DIR) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { document.documentElement.className = 'light'; h.render('bubble', { content: 'Mensagem sintética', senderName: 'Contato sintético' }); });
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    await page.getByRole('dialog', { name: 'Dados da mensagem', exact: true }).waitFor();
    await page.screenshot({ path: join(process.env.WHATSAPP_MESSAGE_DETAILS_ARTIFACT_DIR, 'message-details-preview-390-light.png') });
  }
});

test('focusing a historical message preserves the target without a black outline around its row', async t => {
  const page = await open(t, { content: 'Mensagem encontrada no histórico' });
  const target = page.locator('[data-message-id]');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.className = theme, theme);
    await target.focus();
    const focus = await target.evaluate(node => {
      const style = getComputedStyle(node);
      return { focused: document.activeElement === node, outlineWidth: style.outlineWidth, outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, border: style.borderTopWidth };
    });
    assert.equal(focus.focused, true); assert.equal(focus.border, '0px');
    assert.ok(focus.outlineStyle === 'none' || focus.outlineWidth === '0px' || focus.outlineColor === 'rgba(0, 0, 0, 0)', JSON.stringify(focus));
    assert.equal(await target.getAttribute('tabindex'), '-1', 'history navigation still has a focusable target');
  }
});

test('manual media download has a visible neutral borderless control and retains one request while busy', async t => {
  const page = await open(t);
  const primary = await page.evaluate(() => {
    const probe = document.createElement('span'); probe.style.color = 'var(--primary)'; document.body.append(probe);
    const color = getComputedStyle(probe).color; probe.remove(); return color;
  });
  for (const theme of ['light', 'dark']) for (const fromMe of [true, false]) {
    await page.evaluate(({ theme, fromMe }) => {
      document.documentElement.className = theme;
      h.render('bubble', { messageType: 'document', content: null, mediaUrl: null, mediaMimeType: 'application/pdf', mediaStatus: 'failed', mediaError: 'media_policy_manual_only_type', mediaSize: 2 * 1024 * 1024, fromMe, status: fromMe ? 'sent' : 'received', manualDownload: true });
    }, { theme, fromMe });
    const button = page.getByRole('button', { name: 'Baixar arquivo', exact: true });
    const appearance = await button.evaluate(node => {
      const style = getComputedStyle(node);
      return { border: style.borderTopWidth, radius: style.borderRadius, size: style.fontSize, weight: style.fontWeight, color: style.color, background: style.backgroundColor };
    });
    assert.equal(appearance.border, '0px'); assert.equal(appearance.radius, '6px');
    assert.equal(appearance.size, '12px'); assert.equal(appearance.weight, '300');
    assert.notEqual(appearance.color, appearance.background, 'download label contrasts with its surface');
    await button.hover();
    await page.waitForFunction(primary => getComputedStyle([...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Baixar arquivo')).color === primary, primary, { timeout: 1500 });
    await page.mouse.move(0, 0);
  }
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).click();
  assert.equal(await page.evaluate(() => h.manualRequests.length), 1);
  assert.equal(await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).count(), 0, 'busy policy cannot enqueue another request');
  await page.getByText('Solicitando download', { exact: true }).waitFor();
  await page.evaluate(() => h.manualRequests[0].resolve());
  await page.getByRole('button', { name: 'Baixar arquivo', exact: true }).waitFor();
});

test('own-start notice uses the requested borderless half-orange white-text presentation and preserves its actions', async t => {
  const page = await open(t, { notice: { kind: 'connect' } }, 'own-start');
  const notice = page.locator('[data-whatsapp-own-start]');
  for (const theme of ['light', 'dark']) {
    await page.evaluate(theme => document.documentElement.className = theme, theme);
    const style = await notice.evaluate(node => {
      const box = getComputedStyle(node), action = getComputedStyle(node.firstElementChild);
      return { border: box.borderTopWidth, color: action.color, background: box.backgroundColor };
    });
    assert.equal(style.border, '0px');
    assert.equal(style.color, 'rgb(255, 255, 255)');
    assert.match(style.background, /(?:0\.5|50%)/);
  }
  assert.equal(await page.getByRole('link').getAttribute('href'), '/settings?tab=whatsapp');
  await page.evaluate(() => h.render('own-start', { notice: { kind: 'start' } }));
  await page.getByRole('button', { name: 'Iniciar conversa pelo seu WhatsApp' }).click();
  assert.deepEqual(await page.evaluate(() => h.replies), ['start']);
  await page.evaluate(() => h.render('own-start', { notice: { kind: 'start' }, busy: true }));
  assert.equal(await page.getByRole('button').isDisabled(), true);
  await page.evaluate(() => h.render('own-start', { notice: null }));
  assert.equal(await notice.count(), 0);
});

test('shared latest-message control contrasts against outgoing bubbles and keeps its action and unread count', async t => {
  const page = await open(t, { unreadCount: 120 }, 'jump');
  const button = page.locator('[data-scroll-to-latest]');
  for (const [theme, background, color] of [['light', 'rgb(255, 255, 255)', 'rgb(255, 69, 41)'], ['dark', 'rgb(255, 255, 255)', 'rgb(255, 69, 41)']]) {
    await page.evaluate(theme => document.documentElement.className = theme, theme);
    await page.waitForFunction(({ background, color }) => {
      const style = getComputedStyle(document.querySelector('[data-scroll-to-latest]'));
      return style.backgroundColor === background && style.color === color;
    }, { background, color }, { timeout: 1500 });
    assert.deepEqual(await button.evaluate(node => {
      const style = getComputedStyle(node); return { background: style.backgroundColor, color: style.color, border: style.borderTopWidth };
    }), { background, color, border: '0px' });
    await button.hover();
    await expect(button).toHaveCSS('background-color', 'rgb(255, 69, 41)');
    await expect(button).toHaveCSS('color', 'rgb(255, 255, 255)');
    await page.mouse.move(0, 0);
  }
  assert.equal(await button.getAttribute('aria-label'), 'Ir para mensagens mais recentes, 120 não lidas');
  assert.equal(await button.locator('span').innerText(), '99+');
  await button.click();
  assert.deepEqual(await page.evaluate(() => h.replies), ['latest']);
  await page.evaluate(() => h.render('jump', {}));
  assert.equal(await button.locator('span').count(), 0);
});
test('formatting renders semantic elements while hostile HTML stays visible text', async t => {
  const page = await open(t, { content: '*Casa* _visita_ ~antigo~ `literal`\n> Retorno\n- Item\n<img src=x onerror="window.injected=true">' });
  assert.equal(await page.locator('strong').innerText(), 'Casa'); assert.equal(await page.locator('em').innerText(), 'visita');
  assert.equal(await page.locator('del').innerText(), 'antigo'); assert.equal(await page.locator('code').innerText(), 'literal');
  assert.equal(await page.locator('blockquote').innerText(), 'Retorno'); assert.equal(await page.locator('li').innerText(), 'Item');
  assert.equal(await page.locator('img[src=x]').count(), 0); assert.equal(await page.evaluate(() => window.injected), undefined);
});
test('group position and sender visibility update when a previous page is prepended', async t => {
  const page = await open(t, { grouping: 'first', showSenderName: true });
  assert.equal(await page.locator('[data-message-id]').getAttribute('data-message-group'), 'first');
  assert.equal(await page.getByText('Ana', { exact: true }).count(), 1);
  await page.evaluate(() => h.render('bubble', { grouping: 'middle', showSenderName: false }));
  assert.equal(await page.locator('[data-message-id]').getAttribute('data-message-group'), 'middle'); assert.equal(await page.getByText('Ana', { exact: true }).count(), 0);
});
test('read-only message menu copies but exposes no reply, edit, forward or provider delete', async t => {
  const page = await open(t, { readOnly: true }); await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
  assert.equal(await page.getByRole('menuitem', { name: 'Responder', exact: true }).count(), 0);
  assert.equal(await page.getByRole('menuitem').filter({ hasText: /Editar|Encaminhar|Apagar|Excluir/ }).count(), 0);
  await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).click(); assert.deepEqual(await page.evaluate(() => h.copies), ['Mensagem de teste']);
});
async function configureCopyEnvironment(page, mode, fallbackAllowed = true) {
  await page.evaluate(({ mode, fallbackAllowed }) => {
    h.copies = []; h.copyAttempts = []; h.fallbackCopies = []; h.copyFocusTrace = [];
    document.addEventListener('focusin', event => h.copyFocusTrace.push({ tag: event.target.tagName, role: event.target.getAttribute('role') }), true);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'absent' ? undefined : {
      writeText: text => { h.copyAttempts.push(text); return mode === 'deferred-reject'
        ? new Promise((_resolve, reject) => { h.rejectCopy = reject; }) : (h.copies.push(text), Promise.resolve()); },
    } });
    Object.defineProperty(document, 'execCommand', { configurable: true, value: command => {
      const target = document.activeElement;
      const selected = target instanceof HTMLTextAreaElement && target.selectionStart === 0 && target.selectionEnd === target.value.length;
      h.fallbackCopies.push({ command, text: selected ? target.value : null, selected, menuOpen: Boolean(document.querySelector('[role="menu"]')), dialogHost: Boolean(target?.closest('[role="dialog"]')) });
      return fallbackAllowed && selected;
    } });
  }, { mode, fallbackAllowed });
}

for (const dialogHost of [false, true]) for (const mode of ['modern', 'absent', 'deferred-reject']) test(`real message menu copies exact multiline text with ${mode}, dialog=${dialogHost}`, async t => {
  const content = '  Primeira linha\n\nSegunda linha: ação 😀  \n';
  const page = await open(t, { content, compact: dialogHost, dialogHost });
  await configureCopyEnvironment(page, mode);
  const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
  await trigger.click(); await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' });
  if (mode === 'deferred-reject') await page.evaluate(() => h.rejectCopy(new DOMException('Synthetic denial', 'NotAllowedError')));
  await expect(page.getByRole('status'), JSON.stringify(await page.evaluate(() => ({ fallback: h.fallbackCopies, focus: h.copyFocusTrace })))).toHaveText('Texto copiado.');
  const observed = await page.evaluate(() => ({ copies: h.copies, attempts: h.copyAttempts, fallback: h.fallbackCopies, textareas: document.querySelectorAll('textarea').length }));
  assert.deepEqual(observed.attempts, mode === 'absent' ? [] : [content]);
  assert.deepEqual(observed.copies, mode === 'modern' ? [content] : []);
  assert.equal(observed.fallback.length, mode === 'modern' ? 0 : 1);
  if (mode !== 'modern') {
    assert.equal(observed.fallback[0].text, content); assert.equal(observed.fallback[0].selected, true);
    assert.equal(observed.fallback[0].menuOpen, mode === 'absent');
    if (dialogHost && mode === 'deferred-reject') assert.equal(observed.fallback[0].dialogHost, true);
  }
  assert.equal(observed.textareas, 0); await expect(trigger).toBeFocused();
  assert.deepEqual(await page.evaluate(() => [h.replies, h.reactions]), [[], []]);
});

test('copy failure never confirms success when the browser and fallback deny it', async t => {
  const page = await open(t, { content: 'Mensagem sintética', dialogHost: true });
  await configureCopyEnvironment(page, 'deferred-reject', false);
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).click();
  await page.getByRole('menu').waitFor({ state: 'detached' }); await page.evaluate(() => h.rejectCopy(new DOMException('Synthetic denial', 'NotAllowedError')));
  await expect(page.getByRole('status')).toHaveText('Não foi possível copiar. Selecione o texto para copiar.');
  assert.equal(await page.getByText('Texto copiado.', { exact: true }).count(), 0);
  assert.equal(await page.locator('textarea').count(), 0);
});

test('structured contacts and coordinates use the same exact copy fallback and report rejection', async t => {
  const contact = { display_name: '  Contato sintético  ', phones: ['  +5500000000000  '] };
  const page = await open(t, { contacts: [contact], location: { latitude: -23.5, longitude: -46.6 } });
  await configureCopyEnvironment(page, 'absent');
  await page.getByRole('button', { name: `Copiar contato ${contact.display_name}`, exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Copiado.');
  assert.deepEqual(await page.evaluate(() => h.fallbackCopies.map(copy => copy.text)), [`${contact.display_name}\n${contact.phones[0]}`]);
  await page.getByRole('button', { name: 'Copiar coordenadas', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => h.fallbackCopies.map(copy => copy.text)), [`${contact.display_name}\n${contact.phones[0]}`, '-23.5, -46.6']);
  await configureCopyEnvironment(page, 'absent', false);
  await page.getByRole('button', { name: 'Copiar coordenadas', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Não foi possível copiar. Selecione o texto para copiar.');
  assert.equal(await page.getByText('Copiado.', { exact: true }).count(), 0);
  assert.equal(await page.locator('textarea').count(), 0);
});

test('touch and pen context menus preserve native selection while mouse and keyboard keep message actions', async t => {
  const page = await open(t, { content: 'Texto sintético selecionável https://example.test/seguro' });
  const bubble = page.locator('[data-message-bubble]');
  for (const pointerType of ['touch', 'pen']) {
    const native = await bubble.evaluate((node, pointerType) => {
      const range = document.createRange(); range.selectNodeContents(node.querySelector('[data-message-text]'));
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); const before = selection.toString();
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType }));
      const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType }); node.dispatchEvent(event);
      return { prevented: event.defaultPrevented, before, after: selection.toString(), userSelect: getComputedStyle(node.querySelector('[data-message-text]')).userSelect };
    }, pointerType);
    assert.equal(native.prevented, false); assert.equal(native.after, native.before); assert.notEqual(native.userSelect, 'none');
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await bubble.evaluate(node => { const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }); node.dispatchEvent(event); return event.defaultPrevented; }), false, 'touch-compatible legacy mouse event does not replace native selection');
  }
  await page.evaluate(() => getSelection().removeAllRanges());
  await bubble.click({ button: 'right', position: { x: 4, y: 4 } }); await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await bubble.dispatchEvent('pointerdown', { pointerType: 'touch' });
  await page.locator('[data-message-id]').focus(); await page.keyboard.press('Shift+F10');
  await bubble.dispatchEvent('contextmenu', { button: 0 });
  await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).waitFor(); await page.keyboard.press('Escape');
  const link = page.getByRole('link', { name: 'https://example.test/seguro', exact: true });
  assert.equal(await link.evaluate(node => { const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' }); node.dispatchEvent(event); return event.defaultPrevented; }), false);
  assert.equal(await page.getByRole('menu').count(), 0);
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Responder', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => h.replies), ['reply']);
});

test('right-click opens the same message menu and details describe actual delivery state', async t => {
  const page = await open(t, { fromMe: true, status: 'delivered' });
  await page.getByText('Mensagem de teste', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  await page.getByRole('dialog').waitFor(); assert.equal(await page.getByText('Entregue', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Lida', { exact: true }).count(), 0);
});
test('message authorship: another broker audio is not attributed to the shared-account viewer', async t => {
  const page = await open(t, { fromMe: true, senderName: 'Bruno Corretor', senderUserId: '00000000-0000-4000-8000-000000000002', viewerUserId: '00000000-0000-4000-8000-000000000001', messageType: 'audio', mediaMimeType: 'audio/ogg', plainHistory: true });
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog'); await details.waitFor();
  assert.equal(await details.getByText('Enviada por você', { exact: true }).count(), 0);
  assert.equal(await details.locator('dt').filter({ hasText: /^Direção$/ }).locator('xpath=following-sibling::dd[1]').innerText(), 'Enviada');
  assert.equal(await details.getByText('Bruno Corretor', { exact: true }).count(), 1);
  assert.equal(await details.getByText('Áudio', { exact: true }).count(), 1);
});
test('message authorship: a personal CRM send identifies the viewer only through matching author ID', async t => {
  const page = await open(t, { fromMe: true, senderName: 'Ana Corretora', senderUserId: '00000000-0000-4000-8000-000000000001', viewerUserId: '00000000-0000-4000-8000-000000000001', messageType: 'audio', mediaMimeType: 'audio/ogg' });
  assert.equal(await page.getByText('Ana Corretora (você)', { exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog'); await details.waitFor(); assert.equal(await details.getByText('Ana Corretora (você)', { exact: true }).count(), 1);
  assert.equal(await details.locator('dt').filter({ hasText: /^Direção$/ }).locator('xpath=following-sibling::dd[1]').innerText(), 'Enviada');
});
test('message authorship: legacy history name alone never implies the current viewer', async t => {
  const page = await open(t, { fromMe: true, senderName: 'Ana Corretora', viewerUserId: '00000000-0000-4000-8000-000000000001', plainHistory: true });
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog'); await details.waitFor(); assert.equal(await details.getByText('Ana Corretora', { exact: true }).count(), 1);
  assert.equal(await details.getByText(/você/i).count(), 0);
});
test('message authorship: unknown device send and a legacy literal Você never blame the viewer', async t => {
  const page = await open(t, { fromMe: true, senderName: null, viewerUserId: '00000000-0000-4000-8000-000000000001' });
  for (const senderName of [null, 'Você']) {
    await page.evaluate(senderName => h.render('bubble', { fromMe: true, senderName, viewerUserId: '00000000-0000-4000-8000-000000000001' }), senderName);
    assert.equal(await page.getByText('Conta do WhatsApp', { exact: true }).count(), 1);
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    const details = page.getByRole('dialog'); await details.waitFor(); assert.equal(await details.getByText('Autor não identificado', { exact: true }).count(), 1);
    assert.equal(await details.getByText(/você/i).count(), 0); await page.keyboard.press('Escape');
  }
});
test('message authorship: received audio uses its actual contact sender and stays received', async t => {
  const page = await open(t, { fromMe: false, senderName: 'Carla Contato', senderUserId: '00000000-0000-4000-8000-000000000001', viewerUserId: '00000000-0000-4000-8000-000000000001', messageType: 'audio', mediaMimeType: 'audio/ogg' });
  await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog'); await details.waitFor(); assert.equal(await details.locator('dt').filter({ hasText: /^Direção$/ }).locator('xpath=following-sibling::dd[1]').innerText(), 'Recebida');
  assert.equal(await details.getByText('Carla Contato', { exact: true }).count(), 1); assert.equal(await details.getByText(/você/i).count(), 0);
});
test('message authorship: an open history dialog updates when the viewer changes without changing message author', async t => {
  const props = { fromMe: true, senderName: 'Bruno Corretor', senderUserId: '00000000-0000-4000-8000-000000000002', viewerUserId: '00000000-0000-4000-8000-000000000001', plainHistory: true };
  const page = await open(t, props); await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog'); await details.waitFor(); assert.equal(await details.getByText('Bruno Corretor', { exact: true }).count(), 1);
  await page.evaluate(props => h.render('bubble', props), { ...props, viewerUserId: props.senderUserId });
  assert.equal(await details.getByText('Bruno Corretor (você)', { exact: true }).count(), 1);
  await page.evaluate(props => h.render('bubble', props), props); assert.equal(await details.getByText('Bruno Corretor', { exact: true }).count(), 1);
  assert.equal(await details.getByText(/você/i).count(), 0);
});
test('message authorship: received quote preserves another broker sender and delegates the authorized target', async t => {
  const page = await open(t, { navigate: true, viewerUserId: '00000000-0000-4000-8000-000000000001', quotedMessage: { available: true, message_id: 'provider-quote', id: '00000000-0000-4000-8000-000000000020', from_me: true, sender_name: 'Bruno Corretor', sender_user_id: '00000000-0000-4000-8000-000000000002', message_type: 'audio' } });
  const quote = page.getByRole('button', { name: 'Ir para mensagem citada', exact: true }); assert.deepEqual(await quote.locator('span').allTextContents(), ['Bruno Corretor', 'Áudio']);
  await quote.click(); assert.deepEqual(await page.evaluate(() => h.jumps), ['00000000-0000-4000-8000-000000000020']);
});
test('message authorship: quote unknown account and unavailable target reveal no fabricated viewer or content', async t => {
  const page = await open(t, { navigate: true, quotedMessage: { available: true, id: 'quote-a', message_id: 'provider-a', from_me: true, sender_name: 'Você', message_type: 'audio' } });
  assert.deepEqual(await page.getByRole('button', { name: 'Ir para mensagem citada', exact: true }).locator('span').allTextContents(), ['Conta do WhatsApp', 'Áudio']);
  await page.evaluate(() => h.render('bubble', { navigate: true, quotedMessage: { available: false, id: 'private-target', message_id: 'private-provider', from_me: true, sender_name: 'Bruno privado', content: 'Conteúdo privado' } }));
  assert.equal(await page.getByRole('button', { name: 'Ir para mensagem citada', exact: true }).count(), 0);
  assert.equal(await page.getByText('Mensagem citada indisponível', { exact: true }).count(), 1);
  assert.equal(await page.getByText('Conteúdo privado', { exact: true }).count(), 0); assert.equal(await page.getByText('Bruno privado', { exact: true }).count(), 0);
});
test('Escape closes only the message menu or details and restores the message action focus', async t => {
  const page = await open(t); const trigger = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
  await trigger.click(); await page.keyboard.press('Escape'); assert.equal(await page.getByRole('menuitem').count(), 0);
  await trigger.click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click(); await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Mais opções da mensagem', undefined, { timeout: 1500 });
  assert.equal(await trigger.evaluate(node => node === document.activeElement), true); assert.equal(await page.evaluate(() => h.keys.includes('Escape')), false);
});
test('an unloaded quoted message delegates the exact ID once', async t => {
  const page = await open(t, { readOnly: true, navigate: true, quotedMessage: { available: true, id: '00000000-0000-4000-8000-000000000099', message_id: 'provider-quote', content: 'Mensagem antiga' } });
  await page.getByRole('button', { name: 'Ir para mensagem citada', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => h.jumps), ['00000000-0000-4000-8000-000000000099']);
});
test('expanded reactions accept a single family emoji through keyboard without sending a draft', async t => {
  const page = await open(t); await page.getByRole('button', { name: 'Reagir à mensagem', exact: true }).click(); await page.getByRole('button', { name: 'Mais emojis', exact: true }).click();
  assert.deepEqual(await page.locator('label').evaluateAll(nodes => nodes.map(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight }))), [{ size: '12px', weight: '300' }, { size: '12px', weight: '300' }], 'reaction field labels stay compact under the actual app-shell cascade');
  const input = page.getByLabel('Outro emoji', { exact: true }); await input.fill('👨‍👩‍👧‍👦'); await input.press('Enter');
  assert.deepEqual(await page.evaluate(() => h.reactions), ['👨‍👩‍👧‍👦']); assert.equal(await page.evaluate(() => h.keys.includes('Enter')), false);
});
test('reaction badges aggregate identical emojis and reveal every participant', async t => {
  const page = await open(t, { reactions: [{ emoji: '👍', senderName: 'Ana', fromMe: false }, { emoji: '👍', senderName: 'Bruno', fromMe: false }, { emoji: '❤️', senderName: 'Você', fromMe: true }] });
  assert.equal(await page.getByRole('img', { name: '👍: 2', exact: true }).count(), 1);
  await page.getByRole('button', { name: 'Ver 3 reações', exact: true }).click();
  assert.equal(await page.locator('li').count(), 3); assert.equal(await page.getByText('Bruno', { exact: true }).count(), 1);
});
test('shared-account reactions keep the actual author or account fallback without assigning the viewer', async t => {
  const page = await open(t, { viewerUserId: '00000000-0000-4000-8000-000000000001', reactions: [
    { emoji: '👍', senderName: 'bRUNo CORRETOR', fromMe: true },
    { emoji: '❤️', senderName: 'Você', fromMe: true },
    { emoji: '😮', senderName: 'ANA BEATRIZ', fromMe: false },
  ] });
  await page.getByRole('button', { name: 'Ver 3 reações', exact: true }).click();
  const names = page.locator('li span.truncate');
  assert.deepEqual(await names.allTextContents(), ['Bruno Corretor', 'Conta do WhatsApp', 'Ana Beatriz']);
  assert.deepEqual(await names.evaluateAll(nodes => nodes.map(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight }))), Array.from({ length: 3 }, () => ({ size: '12px', weight: '300' })));
  assert.deepEqual(await page.evaluate(() => h.reactions), [], 'viewing reaction authors never sends another reaction');
});
test('starting audio B pauses audio A in the real two-player component tree', async t => {
  const page = await open(t, {}, 'audio'); await page.locator('[data-player-id=A]').getByRole('button', { name: 'Reproduzir áudio', exact: true }).click();
  await page.locator('[data-player-id=B]').getByRole('button', { name: 'Reproduzir áudio', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => h.played), ['A', 'B']); assert.equal(await page.evaluate(() => h.paused.includes('A')), true);
  assert.equal(await page.locator('[data-player-id=A]').getByRole('button', { name: 'Reproduzir áudio', exact: true }).count(), 1);
});
test('gallery supports bounded arrows and resets selection when the conversation scope changes', async t => {
  const gallery = [{ id: 'image-a', url: imageURL, type: 'image', filename: 'A.png' }, { id: 'image-b', url: imageURL, type: 'image', filename: 'B.png' }];
  const page = await open(t, { gallery, scope: 'scope-a', url: imageURL }, 'viewer');
  assert.equal(await page.getByRole('button', { name: 'Mídia anterior', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Próxima mídia', exact: true }).click(); await page.getByRole('heading', { name: 'B.png', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Próxima mídia', exact: true }).isDisabled(), true);
  await page.keyboard.press('ArrowLeft'); await page.getByRole('heading', { name: 'A.png', exact: true }).waitFor();
  await page.keyboard.press('ArrowRight'); await page.getByRole('heading', { name: 'B.png', exact: true }).waitFor();
  await page.evaluate(({ gallery, imageURL }) => h.render('viewer', { gallery, scope: 'scope-b', url: imageURL }), { gallery, imageURL });
  await page.getByRole('heading', { name: 'A.png', exact: true }).waitFor();
});
test('stored gallery media waits for its own authorized URL and a 403 never reuses the previous image', async t => {
  const gallery = [{ id: 'image-a', url: imageURL, type: 'image' }, { id: 'image-b', url: '', lazy: true, type: 'image', filename: 'B.png' }];
  const page = await open(t, { gallery, scope: 'scope-a' }, 'viewer');
  await page.getByRole('button', { name: 'Próxima mídia', exact: true }).click(); await page.waitForFunction(() => h.mediaRequests.length === 1);
  assert.equal(await page.locator('img').count(), 0);
  await page.evaluate(() => h.mediaRequests[0].reject(Object.assign(new Error('denied'), { status: 403 })));
  await page.getByText('Mídia indisponível', { exact: true }).waitFor(); assert.equal(await page.locator('img').count(), 0);
  assert.equal(await page.evaluate(() => h.mediaRequests.length), 1);
});
test('late stored URL completion after A to B to A cannot replace the current authorized request', async t => {
  const gallery = [{ id: 'image-a', url: imageURL, type: 'image' }, { id: 'image-b', url: '', lazy: true, type: 'image', filename: 'B.png' }];
  const page = await open(t, { gallery, scope: 'scope-a' }, 'viewer');
  await page.getByRole('button', { name: 'Próxima mídia', exact: true }).click(); await page.waitForFunction(() => h.mediaRequests.length === 1);
  for (const scope of ['scope-b', 'scope-a']) await page.evaluate(({ gallery, scope }) => h.render('viewer', { gallery, scope }), { gallery, scope });
  await page.getByRole('button', { name: 'Próxima mídia', exact: true }).click(); await page.waitForFunction(() => h.mediaRequests.length === 2);
  await page.evaluate(() => h.mediaRequests[0].resolve('https://example.test/storage/v1/object/sign/whatsapp-media/old.png'));
  assert.equal(await page.locator('img').count(), 0);
  await page.evaluate(() => h.mediaRequests[1].resolve('https://example.test/storage/v1/object/sign/whatsapp-media/fresh.png'));
  await page.locator('img[data-actual-src$="fresh.png"]').waitFor(); assert.equal(await page.locator('img[data-actual-src$="old.png"]').count(), 0);
});

const storedMessage = { id: '00000000-0000-4000-8000-000000000011', conversation_id: 'conversation-a', message_type: 'image', status: 'received', media_status: 'ready', media_storage_path: 'org-a/session-a/image.png', media_url: null, media_mime_type: 'image/png' };
const signedURL = 'https://example.test/storage/v1/object/sign/whatsapp-media/fresh.png';
test('gallery hook admits only confirmed ready visual rows in the selected conversation', async t => {
  const messages = [storedMessage, ...[{ id: 'local-attempt' }, { id: '00000000-0000-4000-8000-000000000012', status: 'confirming' }, { id: '00000000-0000-4000-8000-000000000013', media_status: 'failed' }, { id: '00000000-0000-4000-8000-000000000014', message_type: 'deleted' }, { id: '00000000-0000-4000-8000-000000000015', conversation_id: 'conversation-b' }, { id: '00000000-0000-4000-8000-000000000016', delivery_error_reason: 'media_integrity_unverified' }].map(changes => ({ ...storedMessage, ...changes }))];
  const page = await open(t, { messages, conversationId: 'conversation-a' }, 'gallery-hook');
  assert.deepEqual(await page.evaluate(() => h.galleryItems.map(item => ({ id: item.id, url: item.url }))), [{ id: storedMessage.id, url: '' }]);
  assert.equal(await page.evaluate(() => h.mediaRequests.length), 0);
  await page.getByRole('button', { name: 'Abrir ' + storedMessage.id, exact: true }).click();
  assert.deepEqual(await page.evaluate(() => ({ org: h.mediaRequests[0].org, user: h.mediaRequests[0].options.expectedUserId })), { org: 'org-a', user: 'user-a' });
  await page.evaluate(signedURL => h.mediaRequests[0].resolve({ url: signedURL }), signedURL); await page.waitForFunction(() => h.galleryResults.length === 1);
  assert.deepEqual(await page.evaluate(() => h.galleryResults), [{ result: signedURL }]);
});
for (const change of ['actor', 'organization', 'access', 'physical']) test('gallery hook rejects old ' + change + ' intent before HTTP and ignores an old completion', async t => {
  const page = await open(t, { messages: [storedMessage] }, 'gallery-hook'); await page.getByRole('button', { name: 'Abrir ' + storedMessage.id, exact: true }).click();
  const props = { messages: [storedMessage], physicalScope: change === 'physical' ? 'physical-b' : 'physical-a', queryScope: { organizationId: change === 'organization' ? 'org-b' : 'org-a', userId: change === 'actor' ? 'user-b' : 'user-a', accessScope: change === 'access' ? 'revoked' : 'allowed' } };
  await page.evaluate(props => h.render('gallery-hook', props), props);
  assert.equal(await page.evaluate(() => h.mediaRequests[0].options.signal.aborted), true);
  assert.equal(await page.evaluate(() => h.savedRefresh()), null); assert.equal(await page.evaluate(() => h.mediaRequests.length), 1);
  await page.evaluate(signedURL => h.mediaRequests[0].resolve({ url: signedURL }), signedURL); await page.waitForFunction(() => h.galleryResults.length === 1);
  assert.deepEqual(await page.evaluate(() => h.galleryResults), [{ result: null }]);
});
test('gallery hook rejects the original callback after physical A to B to A', async t => {
  const page = await open(t, { messages: [storedMessage] }, 'gallery-hook'); await page.evaluate(() => { h.savedRefresh = h.galleryItems[0].refresh; });
  for (const physicalScope of ['physical-b', 'physical-a']) await page.evaluate(({ messages, physicalScope }) => h.render('gallery-hook', { messages, physicalScope }), { messages: [storedMessage], physicalScope });
  assert.equal(await page.evaluate(() => h.savedRefresh()), null); assert.equal(await page.evaluate(() => h.mediaRequests.length), 0);
});
test('gallery hook aborts pending reads on unmount and rejects removed or deleted rows', async t => {
  const page = await open(t, { messages: [storedMessage] }, 'gallery-hook'); await page.getByRole('button', { name: 'Abrir ' + storedMessage.id, exact: true }).click();
  await page.evaluate(() => h.render('gallery-hook', { messages: [] })); assert.equal(await page.evaluate(() => h.savedRefresh()), null);
  await page.evaluate(() => h.unmount()); assert.equal(await page.evaluate(() => h.mediaRequests[0].options.signal.aborted), true);
  await page.evaluate(signedURL => h.mediaRequests[0].resolve({ url: signedURL }), signedURL); await page.waitForFunction(() => h.galleryResults.length === 1); assert.deepEqual(await page.evaluate(() => h.galleryResults), [{ result: null }]);
});
test('gallery hook propagates a current 403 without a signed URL or retry loop', async t => {
  const page = await open(t, { messages: [storedMessage] }, 'gallery-hook'); await page.getByRole('button', { name: 'Abrir ' + storedMessage.id, exact: true }).click();
  await page.evaluate(() => h.mediaRequests[0].reject(Object.assign(new Error('denied'), { status: 403 }))); await page.waitForFunction(() => h.galleryResults.length === 1);
  assert.deepEqual(await page.evaluate(() => h.galleryResults), [{ error: 403 }]); assert.equal(await page.evaluate(() => h.mediaRequests.length), 1);
});
test('an identical authorized feed update keeps the selected stored read and never issues another GET', async t => {
  const first = { ...storedMessage, id: '00000000-0000-4000-8000-000000000021', media_storage_path: null, media_url: imageURL };
  const messages = [first, storedMessage]; const page = await open(t, { messages, preview: true }, 'gallery-hook');
  await page.getByRole('button', { name: 'Próxima mídia', exact: true }).click(); await page.waitForFunction(() => h.mediaRequests.length === 1);
  await page.evaluate(messages => h.render('gallery-hook', { messages, preview: true }), messages);
  assert.equal(await page.evaluate(() => h.mediaRequests[0].options.signal.aborted), false); assert.equal(await page.evaluate(() => h.mediaRequests.length), 1);
  await page.evaluate(signedURL => h.mediaRequests[0].resolve({ url: signedURL }), signedURL); await page.locator('img[data-actual-src$="fresh.png"]').waitFor();
});
