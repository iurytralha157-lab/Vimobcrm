import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
// Real React components with deferred browser/API boundaries; every network
// request is blocked. No server, database, provider, or microphone is opened.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sourceRoot = process.env.VIMOB_WHATSAPP_MEDIA_BASELINE === '1'
    ? 'D:/Vimob/tmp/whatsapp-ui-hardening-20261011/media-baseline' : repository;
const audioHookRoot = process.env.VIMOB_MEDIA_DEEP_BASELINE === '1'
    ? 'D:/Vimob/tmp/whatsapp-deep-fixes-20261012/media/baseline' : sourceRoot;
let directory, browser, bundle;
before(async () => {
    directory = await mkdtemp(join(tmpdir(), 'vimob-media-runtime-'));
    const loader = join(directory, 'loader.cjs');
    const entry = join(directory, 'entry.js');
    const api = join(directory, 'api.js');
    const scope = join(directory, 'scope.js');
    const attachments = join(directory, 'attachments.js');
    const toast = join(directory, 'toast.js');
    const image = join(directory, 'image.js');
    const mention = join(directory, 'mention.js');
    await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});const fs=require('node:fs');module.exports=function(s){if(process.env.VIMOB_FINAL_AUDIO_BASELINE==='1'&&this.resourcePath.replace(/\\\\/g,'/').endsWith('/components/features/whatsapp/AudioRecorderButton.tsx'))s=fs.readFileSync('D:/Vimob/tmp/whatsapp-final-adjustments-20261012/media/baseline/components/features/whatsapp/AudioRecorderButton.tsx','utf8');return ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
    await writeFile(api, 'export const whatsappAPI={getMessageMediaURL:(...args)=>window.h.mediaRequest(...args)}');
    await writeFile(scope, 'export const useWhatsAppQueryScope=()=>window.h.scope');
    await writeFile(attachments, 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async(args)=>window.h.attachments.push(args)})');
    await writeFile(toast, 'export const toast=(args)=>window.h.toasts.push(args)');
    await writeFile(image, `import React from 'react'; export default function Image({unoptimized,priority,fill,...props}){return React.createElement('img',{...props,src:window.h.mode==='viewer'?'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S4AAAAASUVORK5CYII=':props.src})}`);
    await writeFile(mention, 'export const useMentionNames=()=>({})');
    await writeFile(entry, `
    import React,{useEffect,useRef} from 'react'; import {createRoot} from 'react-dom/client'; import {flushSync} from 'react-dom';
    import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
    import {AudioRecorderButton} from ${JSON.stringify(join(sourceRoot, 'components/features/whatsapp/AudioRecorderButton.tsx'))};
    import {MessageBubble} from ${JSON.stringify(join(sourceRoot, 'components/features/whatsapp/MessageBubble.tsx'))};
    import {MediaViewer} from ${JSON.stringify(join(repository, 'components/features/whatsapp/MediaViewer.tsx'))};
    import {MessageAudioPlayer} from ${JSON.stringify(join(sourceRoot, 'components/features/whatsapp/message-bubble/MessageAudioPlayer.tsx'))};
    import {useWhatsAppMessageMediaURL} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-message-media-url.ts'))};
    import {useWhatsAppThreadScroll} from ${JSON.stringify(join(repository, 'hooks/use-whatsapp-thread-scroll.ts'))};
    const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}}); const root=createRoot(document.getElementById('root'));
    window.h={mode:'recorder',context:'A',disabled:false,scope:{organizationId:'org-a',userId:'user-a',accessScope:'own'},mic:[],streams:[],constructors:0,toasts:[],sends:[],active:[],requests:[],attachments:[],sendError:null,sendResult:true,resolution:'pending',props:{},scrolls:0,
      mediaRequest(id,org,options){return new Promise((resolve,reject)=>this.requests.push({id,org,options,resolve,reject}))},
      resolveMic(index=0){let stops=0;const track={stop(){stops++}};const stream={getTracks:()=>[track],get stops(){return stops}};this.streams.push(stream);this.mic[index].resolve(stream)},
      render(mode=this.mode,props=this.props){this.mode=mode;this.props=props;flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Host))))},unmount(){flushSync(()=>root.render(null))}}
    Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:()=>new Promise((resolve,reject)=>h.mic.push({resolve,reject}))}});
    class Recorder{static isTypeSupported(m){return m==='audio/webm;codecs=opus'}constructor(stream,options){h.constructors++;if(h.constructorError)throw new Error('recorder unsupported');(h.recorders||= []).push(this);this.stream=stream;this.mimeType=options.mimeType||'audio/mp4';this.state='inactive'}start(){this.state='recording'}stop(){this.state='inactive';const data=this.ondataavailable,stop=this.onstop;queueMicrotask(()=>{data?.({data:new Blob(['synthetic voice'],{type:this.mimeType})});stop?.()})}}
    const setRecordingInterval=window.setInterval.bind(window),clearRecordingInterval=window.clearInterval.bind(window);h.recordingTimers=new Set();
    window.setInterval=(...args)=>{const timer=setRecordingInterval(...args);if(args[1]===250)h.recordingTimers.add(timer);return timer};
    window.clearInterval=(timer)=>{h.recordingTimers.delete(timer);clearRecordingInterval(timer)};
    const realScrollIntoView=HTMLElement.prototype.scrollIntoView;window.MediaRecorder=Recorder;HTMLElement.prototype.scrollIntoView=function(...args){h.scrolls++;if(h.mode==='scroll')realScrollIntoView.apply(this,args)};HTMLMediaElement.prototype.play=async function(){this.dispatchEvent(new Event('play'))};HTMLMediaElement.prototype.pause=function(){this.dispatchEvent(new Event('pause'))};
    function Host(){return h.mode==='recorder'?React.createElement(AudioRecorderButton,{contextKey:h.context,disabled:h.disabled,onActiveChange:a=>h.active.push(a),onResolveUnconfirmed:async()=>h.resolution,onSend:async(base64,mime,context)=>{h.sends.push({base64,mime,context,selected:h.context});if(h.sendError)throw h.sendError;return h.sendResult}}):h.mode==='quotes'?React.createElement(QuotedThread):h.mode==='viewer'?React.createElement(MediaViewer,{src:h.props.url,type:'image',isOpen:true,filename:'Imagem.png',onClose:()=>{},onRefreshMedia:async()=>{h.refreshes=(h.refreshes||0)+1;return h.props.url}}):h.mode==='source'?React.createElement(Source):h.mode==='scroll'?React.createElement(Thread):h.mode==='audio'?React.createElement(MessageAudioPlayer,{safeMediaUrl:h.props.url,mediaUrl:h.props.url,normalizedMediaMimeType:'audio/ogg',messageId:'audio-one',sentAt:'2026-10-11T10:00:00Z',fromMe:false,status:'received',audioAvatarName:'Contato',audioAvatarInitial:'C',safeAvatarUrl:null,attachableMediaUrl:null,leadId:'',onRequestAttach:()=>{},onDownload:()=>{},isDownloading:false}):React.createElement('div',{role:'log'},React.createElement(MessageBubble,{content:'Legenda da visita https://example.test/ficha',messageType:'image',mediaUrl:null,mediaMimeType:'image/png',mediaStatus:'failed',mediaError:'synthetic failure',fromMe:false,status:'received',sentAt:'2026-10-11T10:00:00Z',senderName:null,isGroup:false,messageId:'message-one',leadId:'lead-one',leadName:'Lead',reactions:[],...h.props}))}
    function QuotedThread(){const common={messageType:'text',mediaUrl:null,mediaMimeType:null,mediaStatus:null,mediaError:null,fromMe:false,status:'received',sentAt:'2026-10-11T10:00:00Z',senderName:null,isGroup:false,leadId:'lead-one',leadName:'Lead',reactions:[]};return React.createElement('div',{role:'log'},React.createElement(MessageBubble,{...common,messageId:'00000000-0000-4000-8000-000000000001',content:'Origem carregada'}),React.createElement(MessageBubble,{...common,messageId:'00000000-0000-4000-8000-000000000002',content:'Resposta',quotedMessage:{message_id:'provider-one',available:true,id:'00000000-0000-4000-8000-000000000001',content:'Origem carregada'}}))}
    function Source(){const value=useWhatsAppMessageMediaURL({messageId:'stored-one',leadId:'lead-one',sessionId:'session-one',storedMedia:true,mediaUrl:h.props.url||null});useEffect(()=>{h.source=value});return React.createElement('div',null,value.mediaUrl||'unavailable')}
    function Thread(){const scroll=useRef(null),bottom=useRef(null);const value=useWhatsAppThreadScroll(h.context,h.props.last||'last-a',scroll,bottom);useEffect(()=>{h.thread=value});const rows=Array.from({length:(h.props.count||20)+(h.props.prepend||0)},(_,i)=>i-(h.props.prepend||0));return React.createElement('div',null,React.createElement('div',{'data-scroll-fixture':true,ref:scroll,onScroll:value.onScroll,style:{height:100,overflow:'auto'}},rows.map(i=>React.createElement('div',{key:i,'data-thread-item-id':'row-'+i,style:{height:50}},'History '+i)),React.createElement('div',{ref:bottom})),value.showScrollToLatest&&React.createElement('button',{onClick:value.scrollToLatest},'Latest'))}
  `);
    await new Promise((resolveBuild, rejectBuild) => {
        const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: directory, filename: 'media.js' }, resolve: { extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'], alias: { '@/hooks/use-audio-recorder': join(audioHookRoot, 'hooks/use-audio-recorder.ts'), '@/lib/api/whatsapp': api, '@/hooks/use-whatsapp-query-scope': scope, '@/hooks/use-lead-attachments': attachments, '@/hooks/use-toast': toast, '@/hooks/use-mention-names': mention, 'next/image': image, '@': repository } }, module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
        compiler.run((error, stats) => compiler.close(() => error ? rejectBuild(error) : stats.hasErrors() ? rejectBuild(new Error(stats.toString({ all: false, errors: true }))) : resolveBuild()));
    });
    bundle = await readFile(join(directory, 'media.js'), 'utf8');
    browser = await chromium.launch({ headless: true });
}, { timeout: 90000 });
after(async () => { await browser?.close(); if (directory) {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir()) + '\\') || resolve(directory).startsWith(resolve(tmpdir()) + '/'));
    assert.ok(basename(directory).startsWith('vimob-media-runtime-'));
    await rm(directory, { recursive: true, force: true });
} });
test('viewer HTTP download failure exposes authorized GET renewal without false success', async (t) => {
    const page = await open(t);
    await page.evaluate(() => {
        window.fetch = async () => new Response('denied', { status: 403 });
        h.render('viewer', { url: 'https://example.test/storage/v1/object/sign/whatsapp-media/image.png' });
    });
    await page.getByRole('button', { name: 'Baixar', exact: true }).click();
    await page.getByRole('button', { name: 'Atualizar link da mídia', exact: true }).waitFor();
    assert.equal(await page.getByText('Download iniciado.', { exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Atualizar link da mídia', exact: true }).click();
    await page.waitForFunction(() => h.refreshes === 1);
});
async function open(t) { const page = await browser.newPage(); page.setDefaultTimeout(4000); await page.route('**/*', route => route.abort()); const errors=[]; page.on('pageerror',error=>errors.push(error.message)); t.after(async()=>{await page.close();assert.deepEqual(errors,[],'No uncaught browser failures')}); await page.setContent('<div id="root"></div>'); await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; }); await page.addScriptTag({ content: bundle }); await page.evaluate(() => h.render()); return page; }
async function record(page) { await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await page.evaluate(() => h.resolveMic(h.mic.length - 1)); await page.getByRole('button', { name: 'Parar gravação', exact: true }).click(); await page.getByRole('button', { name: 'Enviar áudio gravado', exact: true }).waitFor(); }

async function beginDeferredPreview(page) {
    await record(page);
    await page.evaluate(() => {
        h.previewPauses = 0;
        HTMLMediaElement.prototype.play = function () {
            h.previewElement = this;
            return new Promise((resolve, reject) => { h.resolvePreview = resolve; h.rejectPreview = reject; });
        };
        HTMLMediaElement.prototype.pause = function () { if (this === h.previewElement) h.previewPauses++; };
    });
    await page.getByRole('button', { name: 'Ouvir áudio gravado', exact: true }).click();
    await page.waitForFunction(() => Boolean(h.rejectPreview));
}

test('deferred audio preview rejection after context change cannot toast into the new conversation', async t => {
    const page = await open(t);
    await beginDeferredPreview(page);
    await page.evaluate(() => { h.context = 'B'; h.render(); h.rejectPreview(new Error('old decoder')); });
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.toasts.filter(item => item.title === 'Prévia indisponível').length), 0);
    assert.ok(await page.evaluate(() => h.previewPauses > 0));
});

test('deferred audio preview success after context change pauses the detached audio', async t => {
    const page = await open(t);
    await beginDeferredPreview(page);
    await page.evaluate(() => { h.context = 'B'; h.render(); h.resolvePreview(); });
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => h.previewPauses > 0));
    assert.equal(await page.evaluate(() => h.sends.length), 0);
});

test('deferred audio preview after unmount pauses without a stale failure toast', async t => {
    const page = await open(t);
    await beginDeferredPreview(page);
    await page.evaluate(() => { h.unmount(); h.rejectPreview(new Error('old decoder')); });
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    assert.equal(await page.evaluate(() => h.toasts.length), 0);
    assert.ok(await page.evaluate(() => h.previewPauses > 0));
});

test('current audio preview failure still reports the error and preserves recorded bytes', async t => {
    const page = await open(t);
    await beginDeferredPreview(page);
    await page.evaluate(() => h.rejectPreview(new Error('current decoder')));
    await page.waitForFunction(() => h.toasts.some(item => item.title === 'Prévia indisponível'));
    await page.getByRole('button', { name: 'Enviar áudio gravado', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.sends.length), 0);
    assert.equal(await page.evaluate(() => h.toasts.length), 1);
});

test('a resolved playing audio preview is paused when its conversation context changes', async t => {
    const page = await open(t);
    await beginDeferredPreview(page);
    await page.evaluate(() => { h.resolvePreview(); h.previewElement.dispatchEvent(new Event('play')); });
    await page.getByRole('button', { name: 'Pausar prévia do áudio', exact: true }).waitFor();
    await page.evaluate(() => { h.previewPauses = 0; h.context = 'B'; h.render(); });
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.ok(await page.evaluate(() => h.previewPauses > 0), 'Scope cleanup must pause the captured audio even after play already resolved');
    assert.equal(await page.evaluate(() => h.toasts.length), 0);
    assert.equal(await page.evaluate(() => h.sends.length), 0);
});
test('recorded audio cannot cross conversation or permission identity', async (t) => { const page = await open(t); await record(page); await page.evaluate(() => { h.context = 'B'; h.render(); }); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Enviar áudio gravado' }).count(), 0); assert.equal(await page.evaluate(() => h.sends.length), 0); });
test('late microphone permission after context change stops tracks without recording', async (t) => { const page = await open(t); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await page.evaluate(() => { h.context = 'B'; h.render(); h.resolveMic(); }); await page.waitForFunction(() => h.streams[0].stops > 0); assert.equal(await page.evaluate(() => h.constructors), 0); assert.equal(await page.getByRole('button', { name: 'Parar gravação' }).count(), 0); });
test('late microphone permission after unmount stops tracks', async (t) => { const page = await open(t); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await page.evaluate(() => { h.unmount(); h.resolveMic(); }); await page.waitForFunction(() => h.streams[0].stops > 0); assert.equal(await page.evaluate(() => h.constructors), 0); });
test('single microphone acquisition and constructor failure cleanup', async (t) => { const page = await open(t); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).dblclick(); assert.equal(await page.evaluate(() => h.mic.length), 1); await page.evaluate(() => { h.constructorError = true; h.resolveMic(); }); await page.waitForFunction(() => h.streams[0].stops > 0); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor(); });
test('explicit cancellation discards bytes and releases microphone', async (t) => { const page = await open(t); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click(); await page.evaluate(() => h.resolveMic()); await page.getByRole('button', { name: 'Cancelar gravação', exact: true }).click(); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor(); assert.ok(await page.evaluate(() => h.streams[0].stops > 0)); assert.equal(await page.getByRole('button', { name: 'Enviar áudio gravado' }).count(), 0); });
test('ambiguous audio send blocks repeat until authorized canonical read accepts', async (t) => { const page = await open(t); await record(page); await page.evaluate(() => { h.sendError = new TypeError('Failed to fetch'); }); await page.getByRole('button', { name: 'Enviar áudio gravado', exact: true }).click(); await page.getByText('Áudio aguardando confirmação. Não reenvie.', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: 'Enviar áudio gravado' }).count(), 0); await page.getByRole('button', { name: 'Verificar confirmação do áudio' }).click(); assert.equal(await page.evaluate(() => h.sends.length), 1); await page.evaluate(() => { h.resolution = 'accepted'; }); await page.getByRole('button', { name: 'Verificar confirmação do áudio' }).click(); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor(); assert.equal(await page.evaluate(() => h.sends.length), 1); });
test('definitive audio failure preserves bytes and next intentional send has new ID', async (t) => { const page = await open(t); await record(page); await page.evaluate(() => { h.sendError = Object.assign(new Error('invalid input'), { status: 400 }); }); await page.getByRole('button', { name: 'Enviar áudio gravado', exact: true }).click(); await page.waitForFunction(() => h.sends.length === 1); await page.evaluate(() => { h.sendError = null; }); await page.getByRole('button', { name: 'Enviar áudio gravado', exact: true }).click(); await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor(); const sends = await page.evaluate(() => h.sends); assert.equal(sends.length, 2); assert.equal(sends[0].base64, sends[1].base64); assert.notEqual(sends[0].context.clientMessageId, sends[1].context.clientMessageId); });
test('image and video captions remain visible when media failed', async (t) => { const page = await open(t); for (const messageType of ['image', 'video']) {
    await page.evaluate(messageType => h.render('bubble', { messageType }), messageType);
    await page.getByText('Legenda da visita', { exact: false }).waitFor();
    assert.equal(await page.getByRole('link', { name: 'https://example.test/ficha' }).count(), 1);
} });
test('document label uses authorized filename and reader cannot attach', async (t) => { const page = await open(t); await page.evaluate(() => h.render('bubble', { content: null, messageType: 'document', mediaFilename: 'Contrato-unidade-12.pdf', mediaUrl: 'data:application/pdf;base64,YWJj', mediaMimeType: 'application/pdf', mediaStatus: 'ready' })); await page.getByText('Contrato-unidade-12.pdf', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: /Anexar/ }).count(), 0); });
test('stored media renewal is a GET scoped to the current reader and fences late response', async (t) => { const page = await open(t); await page.evaluate(() => h.render('source')); await page.waitForFunction(() => h.requests.length === 1); await page.evaluate(() => { h.scope = { organizationId: 'org-b', userId: 'user-b', accessScope: 'reader' }; h.render('source'); }); await page.waitForFunction(() => h.requests.length === 2); await page.evaluate(() => h.requests[0].resolve({ url: 'https://example.test/old-secret', expiresIn: 20 })); assert.equal(await page.getByText('https://example.test/old-secret', { exact: true }).count(), 0); assert.ok(await page.evaluate(() => h.requests[0].options.signal.aborted)); await page.evaluate(() => h.requests[1].resolve({ url: 'https://example.test/current', expiresIn: 20 })); await page.getByText('https://example.test/current', { exact: true }).waitFor(); assert.equal(await page.evaluate(() => h.requests[1].org), 'org-b'); });
test('stored media denial clears URL without automatic retry loop', async (t) => { const page = await open(t); await page.evaluate(() => h.render('source')); await page.waitForFunction(() => h.requests.length === 1); await page.evaluate(() => h.requests[0].reject(Object.assign(new Error('denied'), { status: 403 }))); await page.waitForFunction(() => h.source.failed === true); assert.equal(await page.evaluate(() => h.requests.length), 1); assert.equal(await page.evaluate(() => h.source.mediaUrl), null); });
test('history reader preserves its actual anchor on append and prepend; Latest restores bottom follow', async t => {
    const page=await open(t);await page.evaluate(()=>h.render('scroll',{last:'row-19',count:20}));
    await page.waitForFunction(()=>{const n=document.querySelector('[data-scroll-fixture]');return n.scrollHeight-n.clientHeight-n.scrollTop<=1});
    await page.evaluate(()=>{const n=document.querySelector('[data-scroll-fixture]');n.scrollTop=200;n.dispatchEvent(new Event('scroll',{bubbles:true}));});
    await page.getByRole('button',{name:'Latest',exact:true}).waitFor();
    const anchor=()=>page.locator('[data-thread-item-id="row-4"]').evaluate(n=>({top:n.getBoundingClientRect().top-n.parentElement.getBoundingClientRect().top,scroll:n.parentElement.scrollTop}));
    const initial=await anchor();await page.evaluate(()=>h.render('scroll',{last:'row-20',count:21}));assert.deepEqual(await anchor(),initial);
    await page.evaluate(()=>h.render('scroll',{last:'row-20',count:21,prepend:3}));assert.deepEqual(await anchor(),{top:initial.top,scroll:initial.scroll+150});
    await page.getByRole('button',{name:'Latest',exact:true}).click();await page.waitForFunction(()=>{const n=document.querySelector('[data-scroll-fixture]');return n.scrollHeight-n.clientHeight-n.scrollTop<=1});
    await page.evaluate(()=>h.render('scroll',{last:'row-21',count:22,prepend:3}));await page.waitForFunction(()=>{const n=document.querySelector('[data-scroll-fixture]');return n.scrollHeight-n.clientHeight-n.scrollTop<=1});
});
test('quoted unavailable preview never exposes supplied body and contact/map require explicit clicks', async (t) => { const page = await open(t); await page.evaluate(() => h.render('bubble', { messageType: 'text', content: 'Atual', quotedMessage: { message_id: 'old', available: false, content: 'Forbidden historical body', sender_name: 'Forbidden sender' }, contacts: [{ display_name: 'Portaria', phones: ['+55 11 99999-1111'] }], location: { latitude: -23, longitude: -46, name: 'Portaria' } })); assert.equal(await page.getByText('Forbidden historical body').count(), 0); await page.getByText('Mensagem citada indisponível', { exact: true }).waitFor(); const link = page.getByRole('link', { name: 'Abrir mapa', exact: true }); assert.equal(await link.getAttribute('rel'), 'noopener noreferrer'); assert.ok((await link.getAttribute('href')).includes('-23')); assert.equal(await page.getByRole('link', { name: '+55 11 99999-1111', exact: true }).getAttribute('href'), 'tel:+5511999991111'); });
test('read-only quote navigation finds the loaded bubble without a reaction picker', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('quotes'));
    await page.getByRole('button', { name: 'Ir para mensagem citada', exact: true }).click();
    assert.equal(await page.evaluate(() => h.scrolls), 1);
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-message-id')), '00000000-0000-4000-8000-000000000001');
    assert.equal(await page.evaluate(() => h.requests.length), 0);
});
test('A-B-A cannot resurrect recorded bytes or an uncertain delivery', async (t) => {
    const page = await open(t);
    await record(page);
    await page.evaluate(() => { h.context = 'B'; h.render(); h.context = 'A'; h.render(); });
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Enviar áudio gravado' }).count(), 0);
    await record(page);
    await page.evaluate(() => { h.sendError = new TypeError('Failed to fetch'); });
    await page.getByRole('button', { name: 'Enviar áudio gravado' }).click();
    await page.getByText('Áudio aguardando confirmação. Não reenvie.', { exact: true }).waitFor();
    await page.evaluate(() => { h.context = 'B'; h.render(); h.context = 'A'; h.render(); });
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Verificar confirmação do áudio' }).count(), 0);
});
test('same scope callback churn preserves bytes; permission denial clears active acquisition', async (t) => {
    const page = await open(t);
    await record(page);
    await page.evaluate(() => h.render());
    await page.getByRole('button', { name: 'Enviar áudio gravado' }).waitFor();
    await page.getByRole('button', { name: 'Descartar áudio gravado' }).click();
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.evaluate(() => { h.disabled = true; h.render(); h.resolveMic(1); });
    await page.waitForFunction(() => h.streams[1].stops > 0);
    assert.equal(await page.getByRole('button', { name: 'Parar gravação' }).count(), 0);
});
test('media TTL renews once using server expiry instead of a provider fallback', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('source', { url: 'https://provider.example.test/file.enc' }));
    await page.waitForFunction(() => h.requests.length === 1);
    assert.equal(await page.getByText('https://provider.example.test/file.enc', { exact: true }).count(), 0);
    await page.evaluate(() => h.requests[0].resolve({ url: 'https://media.example.test/first', expiresIn: 1 }));
    await page.getByText('https://media.example.test/first', { exact: true }).waitFor();
    await page.waitForFunction(() => h.requests.length === 2);
    await page.evaluate(() => h.requests[1].resolve({ url: 'https://media.example.test/renewed', expiresIn: 60 }));
    await page.getByText('https://media.example.test/renewed', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.requests.length), 2);
});
test('stale audio fallback failure cannot mark a newer source as failed', async (t) => {
    const page = await open(t);
    const wav=Buffer.alloc(8044);wav.write('RIFF');wav.writeUInt32LE(8036,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(8000,28);wav.writeUInt16LE(1,32);wav.writeUInt16LE(8,34);wav.write('data',36);wav.writeUInt32LE(8000,40);wav.fill(128,44);
    // Native metadata is a valid in-memory asset. Explicit DOM error events
    // drive the two fallbacks; blocked-network timing is not the test trigger.
    await page.route('https://media.example.test/**',route=>route.fulfill({status:200,contentType:'audio/wav',body:wav}));
    await page.evaluate(() => { h.downloads=[];h.finished=[];window.fetch=(url,options)=>new Promise((resolve,reject)=>h.downloads.push({url,options,resolve,reject})).finally(()=>h.finished.push(url));h.render('audio',{url:'https://media.example.test/old.ogg'}); });
    await page.locator('audio').evaluate(n=>n.dispatchEvent(new Event('error')));
    await page.waitForFunction(()=>h.downloads.some(r=>r.url==='https://media.example.test/old.ogg'));
    await page.evaluate(() => h.render('audio', { url: 'https://media.example.test/new.ogg' }));
    await page.waitForFunction(()=>document.querySelector('audio source')?.getAttribute('src')==='https://media.example.test/new.ogg');
    await page.evaluate(()=>h.downloads.find(r=>r.url==='https://media.example.test/old.ogg').reject(new TypeError('old request failed')));
    await page.waitForFunction(()=>h.finished.includes('https://media.example.test/old.ogg'));
    await page.evaluate(()=>new Promise(requestAnimationFrame));
    await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).waitFor();
    assert.equal(await page.locator('audio source').getAttribute('src'),'https://media.example.test/new.ogg');
    assert.equal(await page.getByText('Erro de rede', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Não foi possível reproduzir', { exact: true }).count(), 0);
    // The settled old request has removed its abort listener. Check real
    // cancellation on a fresh, still-pending fallback when its player unmounts.
    await page.evaluate(()=>h.render('recorder'));
    await page.evaluate(()=>h.render('audio',{url:'https://media.example.test/new.ogg'}));
    await page.locator('audio').evaluate(n=>n.dispatchEvent(new Event('error')));
    await page.waitForFunction(()=>h.downloads.some(r=>r.url==='https://media.example.test/new.ogg'));
    await page.evaluate(()=>h.unmount());assert.ok(await page.evaluate(()=>h.downloads.find(r=>r.url==='https://media.example.test/new.ogg').options.signal.aborted));
    await page.evaluate(()=>h.downloads.find(r=>r.url==='https://media.example.test/new.ogg').reject(new DOMException('Cancelled','AbortError')));
    await page.waitForFunction(()=>h.finished.includes('https://media.example.test/new.ogg'));
});
test('local confirming without delivery error exposes safe check/copy, never recover or discard', async (t) => {
    const page = await open(t);
    await page.evaluate(() => { h.checks = 0; h.recoveries = 0; h.discards = 0; h.render('bubble', { messageType: 'text', content: 'Pedido de visita', fromMe: true, status: 'confirming', deliveryErrorCode: null, onCheckSend: async () => h.checks++, onRecoverText: () => h.recoveries++, onDiscardLocal: () => h.discards++ }); });
    await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
    assert.equal(await page.evaluate(() => h.checks), 1);
    assert.equal(await page.getByRole('button', { name: 'Usar texto no rascunho' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Remover tentativa local' }).count(), 0);
    await page.getByText('Envio não confirmado. Não reenvie até confirmar o estado.', { exact: false }).waitFor();
});

test('unknown send exposes only safe check/copy, never automatic recover or discard', async (t) => {
    const page = await open(t);
    await page.evaluate(() => { h.checks = 0; h.recoveries = 0; h.discards = 0; h.render('bubble', { messageType: 'text', content: 'Pedido de visita', fromMe: true, status: 'failed', deliveryErrorCode: 'outcome_unknown', onCheckSend: async () => h.checks++, onRecoverText: () => h.recoveries++, onDiscardLocal: () => h.discards++ }); });
    await page.getByRole('button', { name: 'Verificar envio', exact: true }).click();
    assert.equal(await page.evaluate(() => h.checks), 1);
    assert.equal(await page.getByRole('button', { name: 'Usar texto no rascunho' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Remover tentativa local' }).count(), 0);
    assert.equal(await page.evaluate(() => h.sends.length + h.recoveries + h.discards), 0);
});
test('recipient failure keeps its correction notice without inline actions and unknown status does not claim sent', async (t) => {
    const page = await open(t);
    await page.evaluate(() => { h.opens = 0; h.checks = 0; h.discards = 0; h.render('bubble', { messageType: 'text', content: 'Visita', fromMe: true, status: 'failed', deliveryErrorCode: 'recipient_not_registered', onCheckSend: async () => h.checks++, onOpenLead: () => h.opens++, onDiscardLocal: () => h.discards++, onRecoverText: () => { throw new Error('must not recover bad recipient'); } }); });
    await page.getByText('Não enviada: este número não possui WhatsApp.', { exact: false }).waitFor();
    for (const name of ['Copiar texto', 'Verificar envio', 'Ver telefone do lead']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0);
    }
    assert.equal(await page.evaluate(() => h.opens + h.checks + h.discards), 0);
    assert.equal(await page.getByRole('button', { name: 'Usar texto no rascunho' }).count(), 0);
    await page.evaluate(() => h.render('bubble', { messageType: 'text', content: 'Visita', fromMe: true, status: '' }));
    assert.equal(await page.getByRole('img', { name: 'Estado do envio indisponível', exact: true }).count(), 1);
    assert.equal(await page.getByRole('img', { name: 'Mensagem enviada', exact: true }).count(), 0);
});

test('legacy media integrity failure explains reattachment and updates the memoized bubble', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('bubble', { content: null, fromMe: true, status: 'failed', deliveryErrorCode: 'send_failed' }));
    await page.getByText('Não enviada. Houve uma falha no envio.', { exact: true }).waitFor();
    await page.evaluate(() => h.render('bubble', { ...h.props, deliveryErrorReason: 'media_integrity_unverified' }));
    await page.getByText('Não enviada: não foi possível confirmar o arquivo desta mensagem. Anexe o arquivo novamente para enviar.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Não enviada. Houve uma falha no envio.', { exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Reenviar|Enviar novamente/ }).count(), 0);
    assert.equal(await page.evaluate(() => h.sends.length), 0);
});

test('an unknown provider outcome takes precedence over a stale media failure reason', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('bubble', { content: null, fromMe: true, status: 'unconfirmed', deliveryErrorCode: 'outcome_unknown', deliveryErrorReason: 'media_integrity_unverified' }));
    await page.getByText('Envio não confirmado. Não reenvie até confirmar o estado.', { exact: true }).waitFor();
    assert.equal(await page.getByText('Anexe o arquivo novamente', { exact: false }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /Reenviar|Enviar novamente/ }).count(), 0);
    assert.equal(await page.evaluate(() => h.sends.length), 0);
});
test('A-B-A media scope cannot resurrect an old signed URL before canonical renewal', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('source'));
    await page.waitForFunction(() => h.requests.length === 1);
    await page.evaluate(() => h.requests[0].resolve({ url: 'https://media.example.test/old-scope', expiresIn: 60 }));
    await page.getByText('https://media.example.test/old-scope', { exact: true }).waitFor();
    await page.evaluate(() => { h.scope = { organizationId: 'org-b', userId: 'user-b', accessScope: 'reader' }; h.render('source'); });
    await page.waitForFunction(() => h.requests.length === 2);
    await page.evaluate(() => { h.scope = { organizationId: 'org-a', userId: 'user-a', accessScope: 'own' }; h.render('source'); });
    await page.waitForFunction(() => h.requests.length === 3);
    assert.equal(await page.getByText('https://media.example.test/old-scope', { exact: true }).count(), 0);
    await page.evaluate(() => h.requests[2].resolve({ url: 'https://media.example.test/current-scope', expiresIn: 60 }));
    await page.getByText('https://media.example.test/current-scope', { exact: true }).waitFor();
});

test('spontaneous recorder stop freezes its timer and preserves the recorded preview', async (t) => {
    const page = await open(t);
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.evaluate(() => h.resolveMic());
    await page.getByRole('button', { name: 'Parar gravação', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.recordingTimers.size), 1);
    await page.evaluate(() => h.recorders[0].stop());
    await page.getByText('Áudio gravado', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.recordingTimers.size), 0);
    assert.equal(await page.evaluate(() => h.streams[0].stops > 0), true);
    await page.getByRole('button', { name: 'Descartar áudio gravado', exact: true }).click();
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.evaluate(() => h.resolveMic(1));
    await page.getByRole('button', { name: 'Parar gravação', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => h.recordingTimers.size), 1);
});

test('recorder error releases the microphone and rejects late stop/data callbacks', async (t) => {
    const page = await open(t);
    await page.getByRole('button', { name: 'Gravar áudio', exact: true }).click();
    await page.evaluate(() => h.resolveMic());
    await page.getByRole('button', { name: 'Parar gravação', exact: true }).waitFor();
    await page.evaluate(() => {
        const recorder = h.recorders[0], data = recorder.ondataavailable, stop = recorder.onstop;
        recorder.onerror?.(new Event('error'));
        queueMicrotask(() => { data?.({ data: new Blob(['late bytes'], { type: recorder.mimeType }) }); stop?.(); });
    });
    await page.getByRole('alert').filter({ hasText: 'Não foi possível concluir a gravação' }).waitFor();
    assert.equal(await page.getByText('Áudio gravado', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => h.recordingTimers.size), 0);
    assert.equal(await page.evaluate(() => h.streams[0].stops > 0), true);
    assert.equal(await page.evaluate(() => h.sends.length), 0);
});

test('a queued Opus recording keeps its real bubble player before canonical URL renewal', async (t) => {
    const page = await open(t);
    await page.evaluate(() => h.render('bubble', { content: null, messageType: 'audio', mediaStatus: 'ready', mediaError: null,
        mediaUrl: 'data:audio/webm;codecs=opus;base64,YQ==', mediaMimeType: 'audio/webm;codecs=opus', fromMe: true, status: 'pending' }));
    assert.equal(await page.locator('audio source').getAttribute('src'), 'data:audio/webm;codecs=opus;base64,YQ==');
});
