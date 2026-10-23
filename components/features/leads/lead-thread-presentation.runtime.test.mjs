import assert from 'node:assert/strict';
import { createHistoryPresentationFixture } from './lead-thread-presentation.fixture.mjs';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real LeadUnifiedThread -> MessageBubble/media/audio/Radix and real application
// and Pipeline CSS. Auth, query results, clipboard and audio transport are closed
// fixtures. No application server, CRM database or external service is used.
const require = createRequire(import.meta.url);
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const directory = await mkdtemp(join(tmpdir(), 'vimob-lead-thread-presentation-'));
const proof = process.env.LEAD_THREAD_PRESENTATION_PROOF_DIR;
const phase = process.env.LEAD_THREAD_PRESENTATION_PHASE || 'current';
const baseline = process.env.LEAD_THREAD_PRESENTATION_BASELINE_DIR;
const fontPath = process.env.LEAD_THREAD_PRESENTATION_FONT_PATH;
const imageURL = 'https://synthetic.test/creative.png';
const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a2S4AAAAASUVORK5CYII=', 'base64');
const avatarURL = `data:image/png;base64,${image.toString('base64')}`;
const wav = Buffer.alloc(844);
wav.write('RIFF'); wav.writeUInt32LE(836, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(8000, 28);
wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(800, 40); wav.fill(128, 44);
const audioURL = `data:audio/wav;base64,${wav.toString('base64')}`;
const id = index => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const sentAt = index => `2026-10-17T12:${String(index).padStart(2, '0')}:00Z`;
const message = (index, overrides = {}) => ({
  id: id(index), conversation_id: id(100), session_id: id(101), lead_id: 'lead-a', organization_id: 'org-a',
  message_id: `synthetic-${index}`, message_type: 'text', content: 'Texto sintético com detalhes do atendimento.',
  sent_at: sentAt(index), from_me: false, status: 'received', sender_name: 'Lead sintético', ...overrides,
});
const event = (index, type, label, extra = {}) => ({ id: `activity-${index}`, type, label, timestamp: sentAt(index),
  source: 'activity', actor: { id: id(102), name: 'Atendente sintético', avatar_url: null }, metadata: {}, ...extra });
const events = [
  event(1, 'lead_created', 'Lead criado', { metadata: { source: 'manual' } }),
  event(2, 'stage_changed', 'Etapa alterada', { metadata: { old_stage_name: 'Novo', new_stage_name: 'Em atendimento' } }),
  event(3, 'note', 'Nota adicionada', { content: 'Feedback sintético: cliente procura apartamento com varanda e duas vagas.' }),
  event(4, 'meta_form_answer', 'Meta: Renda familiar?', { metadata: { question: 'Qual é sua renda familiar mensal?', answer: 'Entre R$ 4.000 e R$ 6.000' } }),
  event(5, 'webhook_form_answer', 'Webhook: Quando comprar?', { metadata: { question: 'Quando pretende comprar?', answer: 'Nos próximos três meses' } }),
  event(6, 'meta_creative', 'Criativo Meta registrado', { metadata: { creative_name: 'Apartamento sintético com varanda',
    creative_url: imageURL, creative_link_url: 'https://example.test/imoveis/sintetico?origem=meta' } }),
  event(7, 'assignee_changed', 'Responsável alterado', { isAutomation: true, metadata: { distribution_type: 'canonical_round_robin',
    assigned_user_name: 'Responsável sintético', assigned_user_id: id(103), queue_name: 'Fila sintética', is_initial_distribution: true } }),
  event(8, 'whatsapp_message_queued', 'Mensagem na fila', { isAutomation: true, metadata: { message_row_id: id(999), channel: 'whatsapp' } }),
  event(9, 'assignee_changed', 'Responsável transferido', { metadata: { reason: 'manual_transfer', to_user_name: 'Destino sintético', transferred_by_name: 'Atendente sintético' } }),
];

const base = await readFile(join(repository, 'components/features/leads/history-thread-controls.runtime.test.mjs'), 'utf8');
let bootstrap = base.slice(0, base.indexOf('// History surface assertions'));
function replace(from, to) {
  assert.ok(bootstrap.includes(from), `shared fixture still contains ${from.slice(0, 90)}`);
  bootstrap = bootstrap.replace(from, to);
}
function removeMock(name) {
  const start = bootstrap.indexOf(`  await mock('${name}',`);
  assert.ok(start >= 0, `shared fixture mock ${name} exists`);
  const end = bootstrap.indexOf('`);', start) + 3;
  assert.ok(end > start); bootstrap = bootstrap.slice(0, start) + bootstrap.slice(end);
}
removeMock('@/components/features/whatsapp/MessageBubble');
removeMock('@/components/ui/avatar');
replace("import { buildLeadHistory } from '../../../hooks/lead-history/build-history.ts';", '');
replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`);
replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`);
replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`);
replace('}, { timeout: 90_000 });', '}, { timeout: 300_000 });');
replace("export const useWhatsAppMediaGallery=()=>({});", "export const useWhatsAppMediaGallery=()=>[];");
replace("export const useWhatsAppThreadScroll=()=>({onScroll:()=>{},showScrollToLatest:false,loadOlderPreservingPosition:fn=>fn()});",
  "export const useWhatsAppThreadScroll=()=>({onScroll:()=>{},showScrollToLatest:!!window.harness.showScroll,scrollToLatest:()=>window.harness.scrollClicks++,loadOlderPreservingPosition:fn=>fn()});");
replace('  const loader = join(directory, \'loader.cjs\');', `
  await mock('@/hooks/use-whatsapp-message-media-url', 'export const useWhatsAppMessageMediaURL=({mediaUrl})=>({mediaUrl,isLoading:false,failed:false,refresh:async()=>null});');
  await mock('@/hooks/use-lead-attachments', 'export const useCreateLeadAttachment=()=>({isPending:false,mutateAsync:async input=>{window.harness.writes.push(input);throw Error("Unexpected CRM attachment write");}});');
  await mock('@/hooks/use-mention-names', 'export const useMentionNames=()=>({});');
  await mock('@/hooks/use-toast', 'export const toast=()=>{};');
  await mock('next/link', "import React from 'react';export default function Link(p){return React.createElement('a',p)}");
  await mock('next/image', "import React from 'react';export default function Image({src,unoptimized,priority,fill,...props}){return React.createElement('img',{...props,src})}");
  const loader = join(directory, 'loader.cjs');`);
replace("module.exports=s=>ts.transpileModule(s,", `module.exports=function(s){${phase === 'baseline' && baseline ? `if(require('node:path').basename(this.resourcePath)==='LeadUnifiedThread.tsx')s=require('node:fs').readFileSync(${JSON.stringify(join(baseline, 'LeadUnifiedThread.tsx').replaceAll('\\', '/'))},'utf8');` : ''}return ts.transpileModule(s,`);
replace('jsx:ts.JsxEmit.ReactJSX}}).outputText;', 'jsx:ts.JsxEmit.ReactJSX}}).outputText;};');
replace("import{LeadUnifiedThread}from'@/components/features/leads/LeadUnifiedThread';", `import{LeadUnifiedThread}from'@/components/features/leads/LeadUnifiedThread';
    import{MessageBubble}from'@/components/features/whatsapp/MessageBubble';`);
replace("mode:'lead',writeHookMounts:0,writes:[],realtime:null,", "mode:'lead',writeHookMounts:0,writes:[],realtime:null,copies:[],played:0,paused:0,scrollClicks:0,showScroll:false,reference:null,");
replace('    h.render();`);', `
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>h.copies.push(text)}});
    const audioStates=new WeakMap();
    Object.defineProperty(HTMLMediaElement.prototype,'paused',{configurable:true,get(){return audioStates.get(this)!==false}});
    HTMLMediaElement.prototype.play=async function(){audioStates.set(this,false);h.played++;this.dispatchEvent(new Event('play'))};
    HTMLMediaElement.prototype.pause=function(){if(audioStates.get(this)===false){audioStates.set(this,true);h.paused++;this.dispatchEvent(new Event('pause'))}};
    h.render();\`);`);
replace("function App(){return h.mode==='search'?React.createElement(SearchProbe):React.createElement(LeadUnifiedThread,{leadId:'lead-a',leadName:'Lead sintético',historyPagination:true});}", `function App(){if(h.mode==='reference'){const m=h.reference;return React.createElement('section',{className:'flex h-full min-h-0 flex-col p-3'},React.createElement('div',{className:'flex-1 rounded-[8px] bg-[var(--app-surface-soft)] px-1 py-3'},React.createElement(MessageBubble,{content:m.content,messageType:m.message_type,mediaUrl:m.media_url||null,mediaMimeType:m.media_mime_type||null,mediaFilename:m.media_filename||null,mediaStatus:m.media_status||null,mediaError:null,fromMe:m.from_me,status:m.status,sentAt:m.sent_at,senderName:m.sender_name,isGroup:false,messageId:m.id,leadId:'lead-a',leadName:'Lead sintético',reactions:[],readOnly:true,compact:true,reactionPickerPosition:'outside'})));}return React.createElement(LeadUnifiedThread,{leadId:'lead-a',leadName:'Lead sintético',historyPagination:true});}`);
bootstrap += '\nexport {fixture};\n';
replace("return React.createElement(LeadUnifiedThread,{leadId:'lead-a',leadName:'Lead sintético',historyPagination:true});}",
  "return React.createElement(React.Fragment,null,React.createElement(LeadUnifiedThread,{leadId:'lead-a',leadName:'Lead sintético',historyPagination:true}),React.createElement('div',{style:{position:'absolute',visibility:'hidden'}},React.createElement('button',{'data-wrapper-control':true,className:'rounded-[8px]'},React.createElement('span',{'data-wrapper-caption':true,className:'text-[10px]'},'Campo fora do histórico'))));}");
const bootstrapPath = join(directory, 'bootstrap.mjs');
await writeFile(bootstrapPath, bootstrap);
const { fixture: sharedFixture } = await import(pathToFileURL(bootstrapPath).href);
let css, dialogClass;
const measurements = [];

before(async () => {
  const fromBaseline = phase === 'baseline' && baseline;
  const globals = await readFile(fromBaseline ? join(baseline, 'globals.css') : join(repository, 'app/globals.css'), 'utf8');
  const moduleSource = await readFile(fromBaseline ? join(baseline, 'PipelineLeadDetail.module.css') : join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css'));
  const sources = ['components/features/leads/LeadUnifiedThread.tsx', 'components/features/leads/lead-detail/history-event-presentation.ts', 'components/features/whatsapp', 'components/ui']
    .concat(fromBaseline ? [join(baseline, 'LeadUnifiedThread.tsx')] : [])
    .map(path => `@source "${resolve(repository, path).replaceAll('\\', '/')}";`).join('\n');
  const product = await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(
    `${globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);')}\n${sources}`,
    { from: join(repository, 'app/lead-thread-presentation-fixture.css') });
  const compiledModule = require('lightningcss').transform({ filename: join(repository, 'components/features/leads/lead-detail/PipelineLeadDetail.module.css'),
    code: moduleSource, cssModules: true });
  dialogClass = compiledModule.exports.dialog.name;
  const font = fontPath ? await readFile(fontPath) : null;
  css = `${product.css}\n${compiledModule.code.toString()}${font ? `\n@font-face{font-family:Geist;src:url(data:font/woff2;base64,${font.toString('base64')}) format('woff2');font-style:normal;font-weight:100 900;font-display:block}:root{--font-geist-sans:Geist}` : ''}`;
  if (proof) await mkdir(proof, { recursive: true });
}, { timeout: 90_000 });

after(async () => {
  if (proof) await writeFile(join(proof, `lead-thread-${phase}-measurements.json`), JSON.stringify(measurements, null, 2));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('vimob-lead-thread-presentation-'));
  await rm(directory, { recursive: true, force: true });
});

async function fixture(t, { width = 390, theme = 'light', variant = 'pipeline', messages = [] } = {}) {
  const page = await sharedFixture(t);
  page.setDefaultTimeout(5000);
  const blocked = [], served = [];
  await page.unroute('**/*');
  await page.route('**/*', route => {
    if (route.request().url() === imageURL) { served.push(imageURL); return route.fulfill({ status: 200, contentType: 'image/png', body: image }); }
    blocked.push(route.request().url()); return route.abort();
  });
  t.after(async () => assert.deepEqual(blocked, [], 'No external request was attempted'));
  await page.setViewportSize({ width, height: 880 });
  await page.addStyleTag({ content: css });
  if (fontPath) {
    await page.evaluate(async () => { await document.fonts.load('12px Geist'); await document.fonts.ready; });
    assert.equal(await page.evaluate(() => document.fonts.check('12px Geist')), true, 'the explicitly supplied local Geist font is ready');
  }
  await page.evaluate(({ theme, width, variant, dialogClass, events, messages }) => {
    document.documentElement.className = theme;
    document.body.className = ''; document.body.style.margin = '0';
    const node = document.getElementById('root');
    node.dataset.variant = variant;
    node.dataset.mode = width < 1024 ? 'drawer' : 'dialog';
    node.className = `${variant === 'pipeline' && width >= 1024 ? dialogClass : ''} vimob-dialog-content`;
    const columnWidth = width < 768 ? width - 16 : variant === 'pipeline' ? width === 1024 ? 304 : 348 : 390;
    Object.assign(node.style, { width: `${columnWidth}px`, maxWidth: 'calc(100vw - 16px)', height: '856px', maxHeight: 'calc(100dvh - 24px)',
      margin: '12px auto', borderRadius: '8px', background: 'var(--app-surface-solid)', overflow: 'hidden' });
    const h = window.harness; h.messages.data = messages; h.history.data = events; h.showScroll = true; h.render();
  }, { theme, width, variant, dialogClass, events, messages });
  await page.getByText('Feedback sintético:', { exact: false }).waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
  return { page, served };
}

async function bubbleGeometry(page, messageId) {
  return page.locator(`[data-message-id="${messageId}"]`).evaluate(row => {
    const style = node => { if (!node) return null; const s = getComputedStyle(node), r = node.getBoundingClientRect(); return {
      size: s.fontSize, weight: s.fontWeight, line: s.lineHeight, color: s.color, bg: s.backgroundColor, radius: s.borderRadius,
      x: r.x, y: r.y, width: r.width, height: r.height,
    }; };
    const metadata = row.querySelector('[data-message-timestamp-position]');
    const clock = metadata && [...metadata.querySelectorAll('span')].find(node => /^\d{2}:\d{2}$/.test(node.textContent.trim()) && !node.querySelector('[role="img"]'));
    return { bubble: style(row.querySelector('[data-message-bubble]')), text: style(row.querySelector('[data-message-text]')),
      list: style(row.querySelector('li')), clock: style(clock || metadata), receipt: style(metadata?.querySelector('svg[role="img"]')),
      duration: style(row.querySelector('[data-message-audio-duration]')), play: style(row.querySelector('button[aria-label="Reproduzir áudio"]')),
      avatar: style(row.querySelector('button[aria-label="Avatar do audio"]')), slider: style(row.querySelector('[role="slider"]')),
      overflow: row.scrollWidth > row.clientWidth + 1 };
  });
}

function sameStyle(actual, expected, keys, label) {
  assert.ok(actual && expected, `${label} rendered in both surfaces`);
  for (const key of keys) assert.equal(actual[key], expected[key], `${label}: ${key} matches shared chat`);
}

async function eventAvatarGeometry(page, eventId, withImage = false) {
  const avatar = page.locator(`[data-thread-item-id="event-${eventId}"] [title="Atendente sintético"]`);
  await expect(avatar).toHaveCount(1);
  const root = await typography(avatar);
  if (!withImage) {
    const fallback = avatar.locator(':scope > span');
    await expect(fallback).toHaveText('A');
    return { root, fallback: await typography(fallback) };
  }
  const photo = avatar.getByRole('img', { name: 'Atendente sintético', exact: true });
  await expect(photo).toBeVisible();
  await expect.poll(() => photo.evaluate(node => node.complete && node.naturalWidth > 0)).toBe(true);
  assert.equal(await photo.getAttribute('src'), avatarURL, 'actor photo comes from the local synthetic bytes');
  assert.equal(await avatar.locator(':scope > span').count(), 0, 'the loaded photo replaces its fallback');
  return { root: await typography(avatar), image: await typography(photo), loaded: await photo.evaluate(node => ({ complete: node.complete, naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight })) };
}

const { typography, historySurface, assertHistoryColor, coreHistoryPalette } = createHistoryPresentationFixture({ phase, events });

for (const width of [320, 390, 1024, 1440]) for (const theme of ['light', 'dark']) for (const variant of ['pipeline', 'contacts']) {
  test(`lead thread presentation ${variant} ${width} ${theme}: shared message scale and preserved history`, async t => {
    const messages = [message(11, { content: 'Texto recebido sintético\n- Detalhe importante\n1. Próximo passo' }),
      message(12, { content: 'Texto enviado sintético\n- Detalhe importante\n1. Próximo passo', from_me: true, status: 'read', sender_name: 'Atendente sintético' }),
      message(13, { message_type: 'audio', content: null, media_url: audioURL, media_mime_type: 'audio/wav', media_status: 'ready' }),
      message(14, { message_type: 'audio', content: null, from_me: true, status: 'read', media_url: audioURL, media_mime_type: 'audio/wav', media_status: 'ready' }),
      message(15, { message_type: 'document', content: null, media_filename: 'Ficha sintética.pdf', media_mime_type: 'application/pdf', media_status: 'failed', media_error: 'media_policy_manual_only_type' }),
      message(16, { message_type: 'document', content: null, from_me: true, status: 'delivered', media_filename: 'Proposta sintética.pdf', media_mime_type: 'application/pdf', media_status: 'failed', media_error: 'media_policy_manual_only_type' })];
    const { page, served } = await fixture(t, { width, theme, variant, messages });
    const log = page.getByRole('log', { name: 'Histórico de mensagens do lead' });
    const initialData = await page.evaluate(() => JSON.stringify([harness.messages.data, harness.history.data]));
    await log.evaluate(node => { node.scrollTop = 0; });
    const feedback = await typography(page.getByText(events[2].content, { exact: true }));
    const answer = await typography(page.getByText(events[3].metadata.answer, { exact: true }));
    const question = await typography(page.getByText(events[3].metadata.question, { exact: true }));
    const neutral = await typography(page.getByText('Lead criado', { exact: true }));
    const scroll = await typography(page.getByRole('button', { name: 'Ir para mensagens mais recentes', exact: true }));
    const control = await typography(page.locator('[data-wrapper-control]'));
    const caption = await typography(page.locator('[data-wrapper-caption]'));
    const palette = await coreHistoryPalette(page, theme);
    const actorFallbacks = { manual: await eventAvatarGeometry(page, events[1].id), feedback: await eventAvatarGeometry(page, events[2].id) };
    if (proof) await page.screenshot({ path: join(proof, `lead-thread-${phase}-${variant}-${width}-${theme}-events.png`) });
    assert.equal(await page.locator('[data-thread-item-id]').count(), events.length + messages.length);
    assert.equal(await page.locator('textarea').count(), 0, 'readOnly history has no send composer');
    assert.equal(await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).count(), 0);
    const link = page.getByRole('link', { name: 'Abrir', exact: true });
    const creativeLink = await typography(link);
    assert.equal(await link.getAttribute('href'), events[5].metadata.creative_link_url);
    assert.equal(await link.getAttribute('target'), '_blank'); assert.match(await link.getAttribute('rel'), /noopener/);
    assert.ok(served.length >= 1, 'creative uses only locally fulfilled fixture bytes');
    // Exercise real Radix AvatarImage after measuring the fallback in the same
    // history. Both states use only the existing synthetic actor metadata.
    await page.evaluate(({ avatarURL, ids }) => {
      harness.avatarFixtureSnapshot = harness.history.data;
      harness.history.data = harness.history.data.map(event => ids.includes(event.id)
        ? { ...event, actor: { ...event.actor, avatar_url: avatarURL } } : event);
      harness.render();
    }, { avatarURL, ids: [events[1].id, events[2].id] });
    const actorImages = { manual: await eventAvatarGeometry(page, events[1].id, true), feedback: await eventAvatarGeometry(page, events[2].id, true) };
    if (phase !== 'baseline') {
      for (const key of ['manual', 'feedback']) {
        assert.deepEqual({ width: actorFallbacks[key].root.width, height: actorFallbacks[key].root.height, font: actorFallbacks[key].fallback.size },
          { width: 24, height: 24, font: '10px' }, `${key} actor fallback uses the common external-avatar scale`);
        assert.deepEqual({ width: actorImages[key].root.width, height: actorImages[key].root.height }, { width: 24, height: 24 }, `${key} actor root keeps its size after image load`);
        assert.deepEqual({ width: actorImages[key].image.width, height: actorImages[key].image.height }, { width: 24, height: 24 }, `${key} actor image fills the same circle`);
      }
      assert.equal(actorFallbacks.manual.root.radius, actorFallbacks.feedback.root.radius, 'manual event and feedback avatars have the same rounding');
      assert.equal(actorImages.manual.root.radius, actorImages.feedback.root.radius, 'loaded manual event and feedback avatars have the same rounding');
    }
    if (proof) await page.screenshot({ path: join(proof, `lead-thread-${phase}-${variant}-${width}-${theme}-actor-images.png`) });
    await page.evaluate(() => { harness.history.data = harness.avatarFixtureSnapshot; delete harness.avatarFixtureSnapshot; harness.render(); });
    const shared = [];
    for (const row of messages) {
      const messageNode = page.locator(`[data-message-id="${row.id}"]`);
      await messageNode.scrollIntoViewIfNeeded();
      const actual = await bubbleGeometry(page, row.id);
      if (proof && [11, 13, 14].includes(Number(row.id.slice(-12)))) await page.screenshot({ path: join(proof, `lead-thread-${phase}-${variant}-${width}-${theme}-${row.message_type}-${row.from_me ? 'sent' : 'received'}.png`) });
      await page.evaluate(row => {
        const root = document.getElementById('root'); root.dataset.originalClasses = root.className; root.className = 'app-shell';
        harness.mode = 'reference'; harness.reference = row; harness.render();
      }, row);
      const reference = await bubbleGeometry(page, row.id);
      if (phase !== 'baseline') {
        sameStyle(actual.bubble, reference.bubble, ['bg', 'radius'], 'message bubble');
        sameStyle(actual.clock, reference.clock, ['size', 'weight', 'line', 'color'], 'message clock');
        assert.equal(actual.clock.size, '10px', 'the visible clock text keeps its compact size');
        if (actual.text) sameStyle(actual.text, reference.text, ['size', 'weight', 'line', 'color'], 'message text');
        if (actual.list) sameStyle(actual.list, reference.list, ['weight', 'line', 'color'], 'formatted list');
        if (actual.duration) sameStyle(actual.duration, reference.duration, ['size', 'weight', 'line', 'color'], 'audio duration');
        if (actual.play) sameStyle(actual.play, reference.play, ['bg', 'color', 'radius'], 'audio play');
        if (actual.avatar) sameStyle(actual.avatar, reference.avatar, ['radius'], 'audio avatar');
        assert.equal(Boolean(actual.receipt), row.from_me, 'only sent messages have a delivery receipt');
        if (actual.receipt) { sameStyle(actual.receipt, reference.receipt, ['width', 'height', 'color'], 'delivery receipt'); assert.equal(actual.receipt.width, 12); }
        assert.equal(actual.overflow, false, 'message row has no horizontal overflow');
        if (actual.slider) {
          assert.ok(actual.avatar, 'ready audio retains its independent player avatar');
          assert.deepEqual({ width: actual.avatar.width, height: actual.avatar.height }, { width: 40, height: 40 }, 'player avatar keeps its existing 40px scale');
          const center = rect => rect.y + rect.height / 2;
          assert.ok(Math.abs(center(actual.play) - center(actual.slider)) <= 0.5, 'play and waveform centers align');
          assert.ok(Math.abs(center(actual.clock) - center(actual.duration)) <= 0.5, 'duration and clock share a baseline');
        }
      }
      shared.push({ id: row.id, direction: row.from_me ? 'sent' : 'received', type: row.message_type, actual, reference });
      await page.evaluate(() => { const root = document.getElementById('root'); root.className = root.dataset.originalClasses; harness.mode = 'lead'; harness.render(); });
    }
    if (phase !== 'baseline') {
      assert.deepEqual({ size: feedback.size, weight: feedback.weight, line: feedback.line }, { size: '12px', weight: '200', line: '17px' });
      assert.deepEqual({ size: answer.size, weight: answer.weight, line: answer.line }, { size: '12px', weight: '200', line: '17px' });
      assert.deepEqual({ size: question.size, weight: question.weight, line: question.line }, { size: '12px', weight: '200', line: '17px' });
      assert.deepEqual({ size: neutral.size, weight: neutral.weight }, { size: '11px', weight: '300' });
      assert.ok(Number.parseFloat(scroll.radius) >= scroll.width / 2, 'scroll-to-latest remains circular inside lead wrappers');
      assert.equal(control.radius, '6px', 'ordinary dialog controls retain their existing rounding');
      assert.equal(caption.size, variant === 'pipeline' && width >= 1024 ? '12px' : '10px', 'Pipeline font adjustment still applies outside the history only');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'page has no horizontal overflow');
    assert.equal(await page.evaluate(() => JSON.stringify([harness.messages.data, harness.history.data])), initialData, 'presentation does not alter query data');
    assert.deepEqual(await page.evaluate(() => harness.writes), []);
    measurements.push({ phase, width, theme, variant, feedback, answer, question, neutral, scroll, control, caption, creativeLink,
      eventAvatars: { fallback: actorFallbacks, loaded: actorImages }, palette, shared });
  });
}

test('lead thread readOnly mobile retains copy/details/media controls and safe creative destinations without mutation', async t => {
  const row = message(20, { content: 'Mensagem sintética para copiar exatamente.\nhttps://example.test/contato', from_me: true, status: 'delivered', sender_name: 'Atendente sintético' });
  const audio = message(21, { message_type: 'audio', content: null, media_url: audioURL, media_mime_type: 'audio/wav', media_status: 'ready' });
  const { page } = await fixture(t, { messages: [row, audio] });
  const bubble = page.locator(`[data-message-id="${row.id}"]`);
  const menu = bubble.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
  await menu.click();
  await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).click();
  await expect.poll(() => page.evaluate(() => harness.copies)).toEqual([row.content]);
  await menu.click(); await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dados da mensagem', exact: true });
  await expect(dialog).toBeVisible(); await expect(dialog.getByText('Entregue', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Enviada', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(menu).toBeFocused();
  await menu.click(); assert.equal(await page.getByRole('menuitem', { name: 'Anexar ao lead', exact: true }).count(), 0);
  assert.equal(await page.getByRole('menuitem', { name: /Responder|Reagir|Excluir/ }).count(), 0); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Pausar áudio', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pausar áudio', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => [harness.played, harness.paused]), [1, 1]);
  const jump = page.getByRole('button', { name: 'Ir para mensagens mais recentes', exact: true });
  await jump.click(); assert.equal(await page.evaluate(() => harness.scrollClicks), 1);
  assert.deepEqual(await page.evaluate(() => harness.writes), []);
});

test('lead thread narrow Pipeline column wraps unbroken event, feedback and form metadata without changing content', async t => {
  const token = 'DadoSinteticoSemEspacos'.repeat(16);
  const { page } = await fixture(t, { width: 320, messages: [message(22, { content: token })] });
  await page.evaluate(token => {
    harness.history.data = [
      { id: 'long-stage', type: 'stage_changed', label: 'Etapa alterada', timestamp: '2026-10-17T12:01:00Z', source: 'activity', metadata: { old_stage_name: token, new_stage_name: 'Atendimento' } },
      { id: 'long-feedback', type: 'note', label: 'Nota adicionada', content: token, timestamp: '2026-10-17T12:02:00Z', source: 'activity', metadata: {} },
      { id: 'long-form', type: 'meta_form_answer', label: 'Meta: Campo sintético', timestamp: '2026-10-17T12:03:00Z', source: 'activity', metadata: { question: token, answer: token } },
    ]; harness.render();
  }, token);
  const fits = await page.locator('[data-thread-item-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.threadItemId,
    width: node.clientWidth, scroll: node.scrollWidth, content: node.textContent,
    escaping: [...node.querySelectorAll('*')].filter(child => child.getBoundingClientRect().right > node.getBoundingClientRect().right + 1).map(child => ({ tag: child.tagName, text: child.textContent.slice(0, 50) })),
  })));
  measurements.push({ phase, kind: 'unbroken-content', fits });
  if (proof) await page.screenshot({ path: join(proof, `lead-thread-${phase}-320-unbroken.png`) });
  for (const fit of fits) {
    assert.ok(fit.content.includes(token), `${fit.id} preserves the whole supplied value`);
    if (phase !== 'baseline') { assert.ok(fit.scroll <= fit.width + 1, `${fit.id} stays within its narrow column: ${JSON.stringify(fit)}`); assert.deepEqual(fit.escaping, [], `${fit.id} child stays in bounds`); }
  }
  assert.deepEqual(await page.evaluate(() => harness.writes), []);
});

test('lead history colors distinguish outcomes, appointments, tags and first response without altering event data', async t => {
  const { page } = await fixture(t, { width: 390 });
  const groups = [
    [
      { item: event(21, 'call', 'Ligação realizada', { content: 'Retorno sintético concluído', metadata: { outcome: 'answered', notes: 'Cliente confirmou o interesse.' } }), tone: 'emerald' },
      { item: event(22, 'call', 'Ligação realizada', { content: 'Tentativa sintética de contato', metadata: { outcome: 'not_answered' } }), tone: 'amber' },
      { item: event(23, 'call', 'Ligação realizada', { content: 'Contato sintético sem sucesso', metadata: { outcome: 'invalid_number' } }), tone: 'red' },
      { item: event(24, 'agenda_created', 'Atividade agendada', { metadata: { title: 'Visita sintética', starts_at: '2026-10-20T12:00:00Z' } }), tone: 'blue' },
      { item: event(25, 'tag_added', 'Tag adicionada', { metadata: { tag_name: 'Prioridade sintética' } }), tone: 'violet' },
      { item: event(26, 'first_response', 'Primeiro contato', { content: 'Primeira resposta em dois minutos' }), tone: 'amber' },
    ],
    [
      { item: event(27, 'status_change', 'Situação atualizada', { metadata: { to_status: 'won' } }), tone: 'emerald' },
      { item: event(28, 'status_change', 'Situação atualizada', { metadata: { to_status: 'lost', lost_reason: 'Sem interesse no momento' } }), tone: 'red' },
      { item: event(29, 'status_change', 'Situação atualizada', { metadata: { to_status: 'open' } }), tone: 'amber' },
      { item: event(30, 'property_selected', 'Imóvel selecionado', { metadata: { property_title: 'Apartamento sintético', property_code: 'QA-001', property_price: 345000 } }), tone: 'orange' },
      { item: event(31, 'proposal_sent', 'Proposta registrada', { content: 'Proposta sintética preservada' }), tone: 'amber' },
      { item: event(32, 'task_completed', 'Tarefa concluída', { content: 'Tarefa sintética concluída', metadata: { outcome: 'replied' } }), tone: 'zinc' },
      { item: event(33, 'lead_distribution_pending', 'Distribuição pendente', { isAutomation: true, metadata: { reason: 'no_available_members', queue_name: 'Fila sintética pendente' } }), tone: 'zinc' },
      { item: event(34, 'tag_removed', 'Tag removida', { metadata: { tag_name: 'Prioridade sintética' } }), tone: 'violet' },
    ],
  ];
  for (const theme of ['light', 'dark']) for (const [groupIndex, group] of groups.entries()) {
    const items = group.map(entry => entry.item);
    await page.evaluate(({ theme, items }) => { document.documentElement.className = theme; harness.history.data = items; harness.messages.data = []; harness.render(); }, { theme, items });
    const palette = [];
    for (const { item, tone } of group) {
      const surface = await historySurface(page, item.id);
      if (phase !== 'baseline') {
        assertHistoryColor(surface, tone, `${item.type}/${item.metadata?.outcome || item.metadata?.to_status || ''}`);
        if (item.type === 'first_response') assert.ok(surface.textRGBA.slice(0, 3).every(channel => channel < 130), 'first-response yellow keeps its dark foreground');
        else assert.ok(surface.textRGBA.slice(0, 3).every(channel => channel >= 245), `${item.type} solid color keeps its white foreground`);
        if (item.type === 'lead_distribution_pending') {
          assert.equal(surface.borderWidth, '2px', 'pending distribution retains its accent rail');
          assertHistoryColor({ ...surface, rgba: surface.borderRGBA }, 'primary', 'pending distribution accent');
        }
      }
      palette.push({ id: item.id, type: item.type, outcome: item.metadata?.outcome, status: item.metadata?.to_status, expectedTone: tone, surface });
    }
    assert.deepEqual(await page.evaluate(() => harness.history.data), items, 'event metadata, content and timestamps remain unchanged');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'semantic event colors introduce no horizontal overflow');
    assert.deepEqual(await page.evaluate(() => harness.writes), []);
    measurements.push({ phase, kind: 'semantic-event-colors', theme, groupIndex, palette });
    await page.getByRole('log', { name: 'Histórico de mensagens do lead' }).evaluate(node => { node.scrollTop = 0; });
    if (proof) await page.screenshot({ path: join(proof, `lead-history-${phase}-390-${theme}-semantic-colors-${groupIndex}.png`) });
  }
});
