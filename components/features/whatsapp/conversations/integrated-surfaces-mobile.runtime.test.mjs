import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Screen/Floating -> MessageBubble -> Media/Audio/Actions and Radix, real
// product CSS. Only auth/data/transport/microphone/AppLayout are closed fixtures.
// No server, DB, provider, real microphone, next/font, Safari or device keyboard.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-integrated-mobile-'));
const proof = process.env.WHATSAPP_INTEGRATION_PROOF_DIR;
const baseline = process.env.WHATSAPP_INTEGRATION_BASELINE_DIR;
const source = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
let bootstrap = source.slice(0, source.indexOf('async function confirmAttachments(page)'));
function removeMock(name) {
  const start = bootstrap.indexOf(`  await mock('${name}',`);
  assert.ok(start >= 0, `mock ${name} exists`);
  const end = bootstrap.indexOf('`);', start) + 3;
  assert.ok(end > start);
  bootstrap = bootstrap.slice(0, start) + bootstrap.slice(end);
}
for (const name of ['@/components/features/whatsapp/MessageBubble', '@/components/features/whatsapp/ConversationLeadPanel', '@/components/features/whatsapp/conversations$']) removeMock(name);
bootstrap = bootstrap
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace("['dialog','alert-dialog','tooltip','popover','hover-card','command','select']", '[]')
  .replace("export const AppLayout=({children})=>React.createElement('div',null,children);", "export const AppLayout=({children})=>React.createElement('div',{'data-synthetic-app-shell':true,className:'app-shell',style:{height:'100dvh',padding:12}},children);")
  .replace("export const useUploadLeadAttachment=()=>h().mutation;", "export const useUploadLeadAttachment=()=>h().mutation; export const useCreateLeadAttachment=()=>h().mutation;")
  .replace("export const useWhatsAppConversationFilterOptions=()=>h().emptyQuery;", "export const useWhatsAppConversationFilterOptions=()=>({...h().emptyQuery,data:undefined});")
  .replace("export const useWhatsAppMessagesPaginated=()=>h().messages;", "export const useWhatsAppMessagesPaginated=id=>id?h().messages:{...h().messages,messages:[]};")
  .replace("data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{}}", "data:{id,name:'Marina Sintética',phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{},...h().leadDetail}")
  .replace('export const whatsappAPI={findConversation:', 'export const whatsappAPI={getMessageMediaURL:(id,org,options)=>h().media(id,org,options),retryMediaDownload:async id=>h().manual.push(id),findConversation:')
  .replace("  const ts=require('typescript');", "  await mock('@/hooks/use-mention-names',`export const useMentionNames=()=>({namesMap:{}});`);\n  await mock('@/components/shared/SharedFilters',`import React from 'react';export const SharedFilters=()=>React.createElement('button',{'data-filter-fixture':true},'Filtros sintéticos');`);\n  const ts=require('typescript');")
  .replace('module.exports=s=>ts.transpileModule(s,', `const fs=require('node:fs'),path=require('node:path');module.exports=function(s){const baseline=process.env.WHATSAPP_INTEGRATION_BASELINE_DIR;const rel=path.relative(${JSON.stringify(repository.replaceAll('\\', '/'))},this.resourcePath);const frozen=baseline&&path.join(baseline,rel);if(frozen&&!rel.startsWith('..')&&fs.existsSync(frozen))s=fs.readFileSync(frozen,'utf8');if(process.env.WHATSAPP_INTEGRATION_LOADER_PROOF&&/MessageAudioPlayer|use-whatsapp-message-media-url/.test(rel))fs.appendFileSync(process.env.WHATSAPP_INTEGRATION_LOADER_PROOF,JSON.stringify({file:rel,frozen,exists:!!frozen&&fs.existsSync(frozen),pinned:s.includes('useMessagePlaybackSource')})+String.fromCharCode(10));return ts.transpileModule(s,`)
  .replace('jsx:ts.JsxEmit.ReactJSX}}).outputText;`);', 'jsx:ts.JsxEmit.ReactJSX}}).outputText;};`);')
  .replace('async function harness(t,mode){const page=await browser.newPage();', 'async function harness(t,mode,options={}){const page=await browser.newPage(options);')
  .replace("await page.route('**/*',r=>r.abort());", "const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'zero external browser requests'));");
assert.ok(!bootstrap.includes("await mock('@/components/features/whatsapp/MessageBubble'"));
assert.ok(!bootstrap.includes("await mock('@/components/features/whatsapp/conversations$'"));
assert.ok(bootstrap.includes('WHATSAPP_INTEGRATION_BASELINE_DIR'));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;
before(async () => {
  const cssPath = baseline ? join(baseline, 'app/globals.css') : join(repository, 'app/globals.css');
  const globals = (await readFile(cssPath, 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  const sources = ['components/features/whatsapp', 'components/features/chat', 'components/ui'].map(p => `@source "${join(repository, p).replaceAll('\\', '/')}";`).join('\n');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n${sources}`, { from: join(repository, 'app/integrated-mobile-fixture.css') })).css;
  if (proof) await mkdir(proof, { recursive: true });
}, { timeout: 300000 });
after(async () => {
  const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^vimob-integrated-mobile-/);
  await rm(target, { recursive: true, force: true });
});

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function audioURL(amplitude) {
  const wav = Buffer.alloc(40044); wav.write('RIFF'); wav.writeUInt32LE(40036, 4); wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28); wav.writeUInt16LE(1, 32); wav.writeUInt16LE(8, 34); wav.write('data', 36); wav.writeUInt32LE(40000, 40); wav.fill(amplitude, 44);
  return `data:audio/wav;base64,${wav.toString('base64')}`;
}
const row = (n, overrides = {}) => ({ id: id(n), message_id: `provider-${n}`, conversation_id: 'chat-a', lead_id: 'lead-a', session_id: 'session-a',
  content: 'Mensagem sintética de teste', message_type: 'text', from_me: true, status: 'read', can_quote: true, can_react: true, sent_at: `2026-10-14T10:${String(n).padStart(2, '0')}:00Z`, metadata: {}, sender_name: 'Corretor Sintético', ...overrides });
const card = () => ({ ...conversation('chat-a', 'lead-a'), contact_name: 'Marina Sintética', last_message: 'Mensagem sintética de teste', last_message_from_me: true, last_message_status: 'read',
  lead: { id: 'lead-a', name: 'Marina Sintética', assignee: { id: 'user-a', name: 'Corretor Sintético' }, tags: [] } });
async function fixture(t, mode, width, theme = 'light', messages = [row(1)]) {
  const page = await harness(t, mode, { hasTouch: width < 768 }); page.setDefaultTimeout(5000);
  await page.setViewportSize({ width, height: 820 });
  await page.emulateMedia({ colorScheme: theme });
  await page.addStyleTag({ content: `${css}\nhtml,body,#root{height:100%;margin:0} #root>output{display:none}` });
  await page.evaluate(({ width, theme, messages, contact, audioURLs }) => {
    document.documentElement.className = theme;
    const h = window.harness; h.mobile = width < 768; h.manual = []; h.mediaRequests = []; h.reacted = [];
    h.auth.organization = { id: 'org-a' }; h.auth.profile.name = 'Corretor Sintético'; h.leadDetail = { name: 'Marina Sintética' };
    h.sessions = [{ ...h.sessions[0], status: 'connected' }]; h.conversations = [contact];
    h.messages = { ...h.messages, messages }; h.mutation = { ...h.mutation, mutateAsync: async p => { h.reacted.push(p); return {}; } };
    h.media = async (messageId, organizationId) => { const previous = h.mediaRequests.filter(r => r.messageId === messageId).length; const url = audioURLs[previous % 2]; h.mediaRequests.push({ messageId, organizationId, url }); return { url, expiresIn: 1 }; };
    h.render(); if (h.mode === 'floating') h.ctx.openConversation(contact);
  }, { width, theme, messages, contact: card(), audioURLs: [audioURL(128), audioURL(129)] });
  if (mode === 'screen') await page.getByText('Marina Sintética', { exact: true }).first().click();
  await expect(page.locator('[data-message-bubble]').first()).toBeVisible();
  return page;
}
async function bounds(locator, width, label) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox(); assert.ok(box, label);
  assert.ok(box.x >= -0.5 && box.x + box.width <= width + 0.5, `${label} stays in viewport: ${JSON.stringify(box)}`);
  return box;
}
async function noOverflow(page, diagnostic) {
  const overflow = await page.evaluate(() => [...document.querySelectorAll('[data-whatsapp-message-log],[data-radix-scroll-area-viewport]')].map(n => ({ width: n.clientWidth, scroll: n.scrollWidth,
    type: n.hasAttribute('data-whatsapp-message-log') ? 'message-log' : 'radix-viewport', display: getComputedStyle(n).display,
    children: [...n.children].map(c => ({ tag: c.tagName, style: c.getAttribute('style'), width: c.clientWidth, scroll: c.scrollWidth, display: getComputedStyle(c).display })),
    bubbles: [...n.querySelectorAll('[data-message-bubble]')].map(b => ({ width: b.clientWidth, scroll: b.scrollWidth, owner: b.parentElement.clientWidth })) })));
  if (proof && diagnostic) await writeFile(join(proof, `${diagnostic}-geometry.json`), JSON.stringify(overflow, null, 2));
  assert.ok(overflow.length); for (const box of overflow) assert.ok(box.scroll <= box.width + 1, JSON.stringify(box));
}
async function screenshot(page, name) { if (proof) await page.screenshot({ path: join(proof, `${name}.png`), fullPage: true }); }

for (const mode of ['screen', 'floating']) for (const copyMode of ['absent', 'deferred-reject', 'denied']) {
  test(`integrated message copy ${mode} ${copyMode}: exact text, native touch selection and no CRM writes`, async t => {
    const content = '  Mensagem sintética\n\ncom ação e 😀  \n';
    const page = await fixture(t, mode, 390, 'light', [row(1, { content })]);
    await page.evaluate(copyMode => {
      window.copyProof = { attempts: [], fallback: [] };
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: copyMode === 'absent' ? undefined : { writeText: text => {
        copyProof.attempts.push(text); return new Promise((_resolve, reject) => { copyProof.reject = reject; });
      } } });
      Object.defineProperty(document, 'execCommand', { configurable: true, value: command => {
        const target = document.activeElement;
        const selected = target instanceof HTMLTextAreaElement && target.selectionStart === 0 && target.selectionEnd === target.value.length;
        copyProof.fallback.push({ command, selected, text: selected ? target.value : null, menuOpen: Boolean(document.querySelector('[role="menu"]')) });
        return copyMode !== 'denied' && selected;
      } });
    }, copyMode);
    const message = page.locator(`[data-message-id="${id(1)}"]`);
    const trigger = message.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
    await trigger.click(); await page.getByRole('menuitem', { name: 'Copiar texto', exact: true }).click();
    await page.getByRole('menu').waitFor({ state: 'detached' });
    if (copyMode !== 'absent') await page.evaluate(() => copyProof.reject(new DOMException('Synthetic denial', 'NotAllowedError')));
    await expect(message.getByRole('status')).toHaveText(copyMode === 'denied' ? 'Não foi possível copiar. Selecione o texto para copiar.' : 'Texto copiado.');
    const copied = await page.evaluate(() => ({ attempts: copyProof.attempts, fallback: copyProof.fallback, textareas: document.querySelectorAll('textarea').length }));
    assert.deepEqual(copied.attempts, copyMode === 'absent' ? [] : [content]);
    assert.equal(copied.fallback.length, 1); assert.equal(copied.fallback[0].text, content);
    assert.equal(copied.fallback[0].menuOpen, copyMode === 'absent');
    // The real chat composer remains; no temporary copy textarea survives.
    assert.equal(await page.locator('textarea[readonly]').count(), 0); await expect(trigger).toBeFocused();
    const native = await message.locator('[data-message-bubble]').evaluate(node => {
      const text = node.querySelector('[data-message-text]'), range = document.createRange(); range.selectNodeContents(text);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); const before = selection.toString();
      node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
      const event = new PointerEvent('contextmenu', { bubbles: true, cancelable: true, pointerType: 'touch' }); node.dispatchEvent(event);
      return { prevented: event.defaultPrevented, before, after: selection.toString() };
    });
    assert.equal(native.prevented, false); assert.equal(native.after, native.before); assert.ok(native.after.trim());
    assert.equal(await page.getByRole('menu').count(), 0);
    assert.equal(await page.evaluate(() => harness.requests.filter(request => ['send', 'archive', 'delete', 'link'].includes(request.kind)).length), 0);
    if (proof) await writeFile(join(proof, `message-copy-${mode}-${copyMode}.json`), JSON.stringify({ copied, native }, null, 2));
  });
}

for (const mode of ['screen', 'floating']) for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) for (const fromMe of [false, true]) {
  test(`integrated ${mode} ${width} ${theme} ${fromMe ? 'sent' : 'received'}: document placeholder and three message actions stay in bounds`, async t => {
    const page = await fixture(t, mode, width, theme, [row(1, { from_me: fromMe, status: fromMe ? 'read' : 'received', content: null, message_type: 'document', media_url: null, media_status: 'failed', media_error: 'media_policy_manual_only_type', media_size: 2 * 1024 * 1024, media_filename: 'Ficha sintética.pdf', media_mime_type: 'application/pdf' })]);
    const bubble = page.locator('[data-message-bubble]'); await bounds(bubble, width, 'document bubble');
    const fit = await bubble.evaluate(n => ({ bubble: n.getBoundingClientRect().width, owner: n.parentElement.clientWidth }));
    assert.ok(fit.bubble <= fit.owner + 1, `document bubble fits its shrunken flex owner: ${JSON.stringify(fit)}`);
    const download = page.getByRole('button', { name: 'Baixar arquivo', exact: true }); await expect(download).toBeVisible(); await bounds(download, width, 'manual download');
    await download.click({ trial: true });
    await screenshot(page, `${mode}-${width}-${theme}-${fromMe ? 'sent' : 'received'}-before-check`);
    await noOverflow(page, `${mode}-${width}-${theme}-${fromMe ? 'sent' : 'received'}`);
    const actions = page.locator('[data-message-actions-outside] button'); assert.equal(await actions.count(), 3);
    const boxes = []; for (let i = 0; i < 3; i++) {
      const box = await bounds(actions.nth(i), width, `message action ${i}`); boxes.push(box);
      // A universal 44px width failed the 320px audio/name geometry. The
      // reviewed compact contract enlarges height to 44, retaining width 32.
      if (width < 768) assert.deepEqual({ width: box.width, height: box.height }, { width: 32, height: 44 });
    }
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x >= boxes[i - 1].x + boxes[i - 1].width - 0.5, 'message action hitboxes do not overlap');
    await noOverflow(page); await screenshot(page, `${mode}-${width}-${theme}-${fromMe ? 'sent' : 'received'}-document`);
    if (width < 768) {
      await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).tap({ position: { x: 16, y: 2 } });
      await expect(page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
    }
    await download.click(); await page.waitForFunction(() => window.harness.manual.length === 1);
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
  });
}

for (const mode of ['screen', 'floating']) for (const width of [320, 390]) for (const fromMe of [false, true]) test(`integrated ${mode} ${width}: ${fromMe ? 'sent' : 'received'} stored audio survives URL renewal while playing`, async t => {
  const page = await fixture(t, mode, width, 'light', [row(1, { from_me: fromMe, status: fromMe ? 'read' : 'received', content: null,
    message_type: 'audio', media_url: null, media_status: 'ready', media_storage_path: 'synthetic/audio.wav', media_mime_type: 'audio/wav' })]);
  const audio = page.locator('audio'); await expect(audio).toHaveCount(1);
  const bubbleBox = await bounds(page.locator('[data-message-bubble]'), width, 'audio bubble');
  const clock = await bounds(page.locator('[data-message-timestamp-position]'), width, 'audio timestamp');
  assert.ok(clock.x >= bubbleBox.x - 0.5 && clock.x + clock.width <= bubbleBox.x + bubbleBox.width + 0.5, 'audio timestamp fits its bubble');
  const waveform = await bounds(page.getByRole('slider', { name: 'Posição do áudio' }), width, 'audio waveform'); assert.ok(waveform.width >= 32, 'waveform remains usable');
  await noOverflow(page, `${mode}-${width}-${fromMe ? 'sent' : 'received'}-audio`);
  await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).click();
  await expect.poll(() => audio.evaluate(n => n.paused)).toBe(false);
  const playingSource = await audio.evaluate(n => n.currentSrc);
  const initialReads = await page.evaluate(messageId => window.harness.mediaRequests.filter(r => r.messageId === messageId).length, id(1));
  await page.waitForFunction(({ initial, messageId }) => window.harness.mediaRequests.filter(r => r.messageId === messageId).length > initial, { initial: initialReads, messageId: id(1) });
  await page.evaluate(() => new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))));
  assert.equal(await audio.evaluate(n => n.paused), false, 'TTL refresh does not pause active playback');
  assert.equal(await audio.evaluate(n => n.currentSrc), playingSource, 'active source is pinned until pause');
  await expect.poll(() => audio.evaluate(n => n.currentTime)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Pausar áudio', exact: true }).click();
  await expect.poll(() => audio.evaluate(n => n.paused)).toBe(true);
  await expect.poll(() => audio.evaluate(n => n.currentSrc)).not.toBe(playingSource);
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
});

for (const mode of ['screen', 'floating']) test(`integrated ${mode}: reduced motion keeps loading states and disables pending pagination`, async t => {
  const page = await fixture(t, mode, 390);
  await page.evaluate(() => { const h = window.harness; h.messages = { ...h.messages, messages: [], isLoading: true }; h.render(); });
  const loading = page.getByRole('status').filter({ hasText: 'Carregando mensagens...' });
  await expect(loading).toBeVisible();
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    assert.equal(await loading.locator('svg').evaluate(n => getComputedStyle(n).animationName), reducedMotion === 'reduce' ? 'none' : 'spin');
    await expect(loading).toHaveText('Carregando mensagens...');
  }
  await page.getByRole('button', { name: mode === 'screen' ? 'Voltar para a lista de conversas' : 'Voltar à lista de conversas', exact: true }).click();
  await page.evaluate(() => { const h = window.harness; h.more = true; h.loadingMore = true; h.render(); });
  const more = page.getByRole('button', { name: 'Carregar mais conversas', exact: true }); await expect(more).toBeDisabled();
  for (const reducedMotion of ['no-preference', 'reduce']) {
    await page.emulateMedia({ reducedMotion });
    assert.equal(await more.locator('svg').evaluate(n => getComputedStyle(n).animationName), reducedMotion === 'reduce' ? 'none' : 'spin');
    await expect(more).toBeDisabled();
  }
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
});

for (const mode of ['screen', 'floating']) for (const width of [320, 390]) {
  test(`integrated ${mode} ${width}: actual reply reaction menu history and back`, async t => {
    const page = await fixture(t, mode, width);
    const bubble = page.locator('[data-message-bubble]');
    const identity = mode === 'screen' ? page.locator('[data-conversation-identity] p').first() : page.locator('#floating-whatsapp-chat').getByText('Marina Sintética', { exact: true });
    const identityBox = await bounds(identity, width, 'contact identity'); assert.ok(identityBox.width >= 40, `contact name retains at least 40px: ${identityBox.width}`);
    assert.deepEqual(await bubble.locator('[data-message-text]').evaluate(n => ({ size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight })), { size: '12px', weight: '200' });
    await page.getByRole('button', { name: 'Responder citando esta mensagem', exact: true }).tap({ position: { x: 16, y: 2 } });
    await expect(page.getByRole('button', { name: 'Cancelar resposta citada', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Cancelar resposta citada', exact: true }).click();
    await page.getByRole('button', { name: 'Reagir à mensagem', exact: true }).tap({ position: { x: 16, y: 42 } });
    await page.getByRole('button', { name: 'Reagir com 👍', exact: true }).click();
    await page.waitForFunction(() => window.harness.reacted.length === 1);
    await page.getByRole('button', { name: 'Mais opções da mensagem', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Dados da mensagem', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Mais opções da mensagem', exact: true })).toBeFocused();
    const search = page.getByRole('button', { name: mode === 'screen' ? 'Pesquisar nesta conversa' : 'Buscar nesta conversa', exact: true });
    // Header width 36 preserves the avatar and a 40px name slot in a 296px
    // page host; the visual surface remains 32 and the touch height is 44.
    if (mode === 'screen') { const hit = await search.boundingBox(); assert.deepEqual({ width: hit.width, height: hit.height }, { width: 36, height: 44 }); }
    await search.click(); const field = page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa', exact: true });
    await expect(field).toBeFocused(); await field.fill('Mensagem sintética'); await field.press('Enter');
    await expect(page.getByLabel('Resultados da pesquisa').getByRole('button')).toHaveCount(1);
    await page.getByLabel('Resultados da pesquisa').getByRole('button').click();
    await expect(page.locator(`[data-message-id="${id(1)}"]`)).toBeFocused();
    await field.press('Escape'); await expect(search).toBeFocused();
    if (mode === 'screen') {
      const details = page.getByRole('button', { name: 'Mostrar dados do contato', exact: true }); await details.click();
      const sheet = page.getByRole('dialog', { name: 'Dados do contato', exact: true }); await expect(sheet).toBeVisible();
      const title = sheet.getByRole('heading', { name: 'Documentação', exact: true });
      assert.deepEqual(await title.evaluate(n => ({ size: getComputedStyle(n).fontSize, weight: getComputedStyle(n).fontWeight })), { size: '11px', weight: '400' });
      const attach = sheet.getByRole('button', { name: 'Anexar', exact: true }); const ab = await attach.boundingBox(), section = await title.locator('..').locator('..').boundingBox();
      assert.equal(Math.round(ab.y - section.y), 4); assert.equal(Math.round(section.y + section.height - ab.y - ab.height), 4);
      await page.keyboard.press('Escape'); await expect(details).toBeFocused();
    }
    await screenshot(page, `${mode}-${width}-text`);
    await page.getByRole('button', { name: mode === 'screen' ? 'Voltar para a lista de conversas' : 'Voltar à lista de conversas', exact: true }).click();
    await expect(page.locator('[data-message-bubble]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['send', 'archive', 'delete', 'link'].includes(r.kind)).length), 0);
  });
}
