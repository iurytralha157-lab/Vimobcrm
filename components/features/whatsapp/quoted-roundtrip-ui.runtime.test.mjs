import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Consumes DTOs exported by TestLocalQuotedReplyHTTPRoundtrip. No invented DTO
// fallback, production URL, provider request, database, or microphone is opened.
const require = createRequire(import.meta.url);
const { webpack } = require('next/dist/compiled/webpack/webpack.js');
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const evidenceRoot = resolve('D:/Vimob/tmp/whatsapp-quoted-roundtrip-local-20261013');
const framesDirectory = resolve(process.env.VIMOB_WHATSAPP_QUOTE_FRAMES_DIR || evidenceRoot);
assert.ok(framesDirectory === evidenceRoot || framesDirectory.startsWith(evidenceRoot + sep), 'Only the explicit local evidence directory is accepted');
let temporary, browser, bundle, css, frame;

before(async () => {
  frame = JSON.parse(await readFile(join(framesDirectory, 'roundtrip-frame.json'), 'utf8'));
  assert.equal(frame.schemaVersion, 1);
  assert.equal(frame.scope, 'disposable-local-crm-with-fake-provider');
  assert.equal(frame.nativePhoneVerified, false);
  assert.equal(frame.evolutionGoAdapterExecuted, false);
  assert.equal(frame.tenantMiddlewareSynthetic, true);
  assert.equal(frame.providerCalls, 1);
  assert.equal(frame.foreignQuoteHTTPRejected, true);
  assert.equal(frame.duplicateReceipt, true);
  assert.ok(frame.actorId && frame.organizationId && frame.leadId);
  assert.equal(frame.outbound.quoted_message.id, frame.target.id);
  assert.equal(frame.incoming.quoted_message.id, frame.outbound.id);
  assert.equal(frame.incoming.quoted_message.sender_name, frame.outbound.sender_name);
  assert.equal(frame.incoming.quoted_message.sender_user_id, undefined, 'Canonical quote preserves the previous strict DTO contract');
  assert.equal(frame.unavailable.quoted_message.available, false);
  temporary = await mkdtemp(join(tmpdir(), 'vimob-quoted-roundtrip-'));
  const loader = join(temporary, 'loader.cjs'), entry = join(temporary, 'entry.js');
  const media = join(temporary, 'media.js'), scope = join(temporary, 'scope.js');
  const attachments = join(temporary, 'attachments.js'), toast = join(temporary, 'toast.js');
  const mention = join(temporary, 'mention.js'), image = join(temporary, 'image.js');
  await writeFile(loader, `const ts=require(${JSON.stringify(require.resolve('typescript'))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);
  await writeFile(media, 'export const useWhatsAppMessageMediaURL=({mediaUrl})=>({mediaUrl,isLoading:false,failed:false,refresh:async()=>null});');
  await writeFile(scope, 'export const useWhatsAppQueryScope=()=>window.h.scope;');
  await writeFile(attachments, 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async()=>{throw new Error("Unexpected attachment mutation")}});');
  await writeFile(toast, 'export const toast=()=>{};');
  await writeFile(mention, 'export const useMentionNames=()=>({});');
  await writeFile(image, `import React from 'react';export default function Image({unoptimized,priority,fill,...props}){return React.createElement('img',props)}`);
  await writeFile(entry, `import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
    import {MessageBubble} from ${JSON.stringify(join(repository, 'components/features/whatsapp/MessageBubble.tsx'))};
    const root=createRoot(document.getElementById('root'));
    window.h={scope:null,frame:null,includeTarget:true,navigations:[],render(frame=this.frame,includeTarget=this.includeTarget){this.frame=frame;this.includeTarget=includeTarget;this.scope={userId:frame.actorId,organizationId:frame.organizationId,accessScope:'synthetic-local'};flushSync(()=>root.render(React.createElement(Thread)))},unmount(){flushSync(()=>root.render(null))}};
    function Thread(){const f=h.frame,messages=h.includeTarget?[f.target,f.outbound,f.incoming,f.unavailable]:[f.incoming,f.unavailable];return React.createElement('main',{className:'mx-auto max-w-3xl p-6'},React.createElement('header',{className:'mb-4 border-b pb-3'},React.createElement('h1',{className:'text-base font-medium'},'Respostas citadas — cenário local'),React.createElement('p',{className:'mt-1 text-xs text-muted-foreground'},'API e banco descartáveis; provedor HTTP simulado. Prévia no aparelho ainda não verificada.')),React.createElement('section',{role:'log','aria-label':'Mensagens do roundtrip local',className:'space-y-2 rounded-lg bg-background p-4'},messages.map(m=>React.createElement(MessageBubble,{key:m.id,messageId:m.id,content:m.content,messageType:m.message_type,mediaUrl:m.media_url||null,mediaMimeType:m.media_mime_type||null,mediaStatus:m.media_status||null,mediaError:m.media_error||null,fromMe:m.from_me,status:m.status,sentAt:m.sent_at,senderName:m.sender_name||null,senderUserId:m.sender_user_id||null,viewerUserId:f.actorId,isGroup:false,leadId:f.leadId,leadName:'Contato sintético',conversationSessionId:m.session_id,quotedMessage:m.quoted_message||null,reactions:[],grouping:'single',onNavigateQuoted:async id=>h.navigations.push(id)}))))}
  `);
  await new Promise((done, reject) => {
    const compiler = webpack({ mode: 'development', target: 'web', entry, output: { path: temporary, filename: 'quotes.js' },
      resolve: { symlinks: false, extensions: ['.ts', '.tsx', '.js'], modules: [join(repository, 'node_modules'), 'node_modules'],
        alias: { '@/hooks/use-whatsapp-message-media-url': media, '@/hooks/use-whatsapp-query-scope': scope, '@/hooks/use-lead-attachments': attachments, '@/hooks/use-toast': toast, '@/hooks/use-mention-names': mention, 'next/image': image, '@': repository } },
      module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: loader }] } });
    compiler.run((error, stats) => compiler.close(() => error ? reject(error) : stats.hasErrors() ? reject(new Error(stats.toString({ all: false, errors: true }))) : done()));
  });
  bundle = await readFile(join(temporary, 'quotes.js'), 'utf8');
  const productCss = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = [join(repository, 'components/features/whatsapp/MessageBubble.tsx'), join(repository, 'components/features/whatsapp/message-bubble'), entry];
  const rendered = await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${productCss}\n${sources.map(source => `@source "${source.replaceAll('\\', '/')}";`).join('\n')}`, { from: join(repository, 'app/quoted-roundtrip-fixture.css') });
  css = rendered.css;
  await mkdir(join(evidenceRoot, 'ui'), { recursive: true });
  browser = await chromium.launch({ headless: true });
}, { timeout: 300000 });

after(async () => {
  await browser?.close();
  if (temporary) {
    assert.ok(resolve(temporary).startsWith(resolve(tmpdir()) + sep));
    assert.ok(basename(temporary).startsWith('vimob-quoted-roundtrip-'));
    await rm(temporary, { recursive: true, force: true });
  }
});

async function open(t, options = {}) {
  const page = await browser.newPage({ viewport: { width: options.width || 1000, height: 800 } });
  page.setDefaultTimeout(4000);
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { network.push(route.request().url()); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'No uncaught browser failures'); assert.deepEqual(network, [], 'No external requests'); });
  await page.setContent('<html class="dark"><body><div id="root"></div></body></html>');
  await page.addStyleTag({ content: css });
  await page.evaluate(() => { window.process = { env: { NODE_ENV: 'development' } }; });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ data, includeTarget }) => h.render(data, includeTarget), { data: frame, includeTarget: options.includeTarget !== false });
  return page;
}

const row = (page, id) => page.locator(`[data-message-id="${id}"]`);

test('captured DB quote survives empty provider echo and resolves the CRM reply on ingress', async t => {
  const page = await open(t);
  assert.equal(await row(page, frame.outbound.id).getByRole('button', { name: 'Ir para mensagem citada' }).innerText(), 'Synthetic Sender\nsynthetic quoted body');
  const incomingPreview = await row(page, frame.incoming.id).getByRole('button', { name: 'Ir para mensagem citada' }).innerText();
  assert.ok(incomingPreview.includes('Resposta CRM sintética'));
  assert.equal(incomingPreview.split('\n')[0], frame.outbound.sender_name, 'Server quote retains the captured CRM author name');
  assert.ok(!incomingPreview.includes('(você)'), 'A sender name alone never attributes a server quote to the current viewer');
  assert.equal(await row(page, frame.unavailable.id).getByText('Mensagem citada indisponível', { exact: true }).count(), 1);
  await page.screenshot({ path: join(evidenceRoot, 'ui/quoted-roundtrip-desktop.png'), fullPage: true });
  await writeFile(join(evidenceRoot, 'ui/quoted-roundtrip-dom.html'), await page.content());
});

test('loaded quote navigates to the exact canonical original and nested reply target', async t => {
  const page = await open(t);
  for (const [source, target] of [[frame.outbound, frame.target], [frame.incoming, frame.outbound]]) {
    await row(page, source.id).getByRole('button', { name: 'Ir para mensagem citada' }).click();
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-message-id')), target.id);
  }
  assert.deepEqual(await page.evaluate(() => h.navigations), [], 'Loaded DOM target does not need history fetch');
});

test('quote missing from the loaded DOM delegates only the authorized canonical target', async t => {
  const page = await open(t, { includeTarget: false });
  await row(page, frame.incoming.id).getByRole('button', { name: 'Ir para mensagem citada' }).click();
  assert.deepEqual(await page.evaluate(() => h.navigations), [frame.outbound.id]);
  assert.equal(await row(page, frame.unavailable.id).getByRole('button', { name: 'Ir para mensagem citada' }).count(), 0);
});

test('foreign and forged inline quote bodies are absent from the DOM and cannot navigate', async t => {
  const page = await open(t);
  const text = await page.locator('[role="log"]').innerText();
  assert.ok(!text.includes('forged inline preview'));
  assert.ok(!text.includes('forbidden foreign body'));
  assert.equal(await row(page, frame.unavailable.id).getByRole('button', { name: 'Ir para mensagem citada' }).count(), 0);
  assert.deepEqual(await page.evaluate(() => h.navigations), []);
});

test('re-mounting the exported server DTO retains quote content and bounded mobile presentation', async t => {
  const page = await open(t, { width: 390 });
  await page.evaluate(data => { h.unmount(); h.render(JSON.parse(JSON.stringify(data))); }, frame);
  assert.equal(await row(page, frame.outbound.id).getByRole('button', { name: 'Ir para mensagem citada' }).count(), 1);
  assert.ok((await row(page, frame.incoming.id).innerText()).includes('Resposta CRM sintética'));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile fixture must not overflow horizontally');
  await page.screenshot({ path: join(evidenceRoot, 'ui/quoted-roundtrip-mobile.png'), fullPage: true });
});
