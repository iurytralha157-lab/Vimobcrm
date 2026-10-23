import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-conversation-layout-'));
const source = await readFile(join(repository, 'components/features/whatsapp/whatsapp-ui-hardening.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf('async function confirmAttachments(page)');
assert.ok(boundary > 0);
// Reuse the established closed API fixtures; register only their bootstrap,
// then render real headers, lead pane, Sheet, menu, and the page under real CSS.
let bootstrap = source.slice(0, boundary)
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace("['dialog','alert-dialog','tooltip','popover','hover-card','command','select']", "['dialog','alert-dialog']")
  .replace("export const AppLayout=({children})=>React.createElement('div',null,children);", "export const AppLayout=({children})=>React.createElement('div',{className:'app-shell',style:{height:'100vh',padding:16}},children);")
  .replace("data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{}}", "data:{id,name:id,phone:'5511999998888',created_at:'2026-10-11T00:00:00Z',tags:[],meta:{},...h().leadDetail}")
  .replace("useConversationLeadDetail=id=>({data:{", "useConversationLeadDetail=id=>({data:h().leadDetailAbsent?null:{")
  .replace("...h().leadDetail},isLoading:false,isError:false", "...h().leadDetail},isLoading:!!h().leadDetailLoading,isError:!!h().leadDetailError")
  .replace("export const useUsers=()=>h().emptyQuery;", "export const useUsers=()=>({...h().emptyQuery,data:h().panelUsers||[]});")
  .replace("  const ts=require('typescript');", "  await mock('@/hooks/use-mention-names',`export const useMentionNames=()=>({namesMap:{}});`);\n  const ts=require('typescript');")
  .replace("  aliases['@/contexts/FloatingChatContext']=sources.Context;", "  if(process.env.WHATSAPP_TITLE_BASELINE_DIR){sources.Panel=join(process.env.WHATSAPP_TITLE_BASELINE_DIR,'ConversationLeadPanel.before.tsx');aliases['@/components/features/whatsapp/ConversationHeader']=join(process.env.WHATSAPP_TITLE_BASELINE_DIR,'ConversationHeader.before.tsx');aliases['./ConfirmConversationLeadLinkDialog']=join(repository,'components/features/whatsapp/ConfirmConversationLeadLinkDialog.tsx');}\n  aliases['@/contexts/FloatingChatContext']=sources.Context;\n  aliases['@/components/features/whatsapp/ConversationLeadPanel']=sources.Panel;")
  .replace('import{ConversationLeadPanel}from', 'import{ConversationLeadPanel,ConversationUnregisteredPanel}from')
  .replace('    import ConversationsScreen from', `    import {ConversationListItem as ActualCard} from ${JSON.stringify(join(repository, 'components/features/whatsapp/conversations/ConversationListItem.tsx').replaceAll('\\', '/'))};\n    import ConversationsScreen from`)
  .replace("{'data-screen-chat':p.conversation.id,'data-layout':p.layout}", "{'data-screen-chat':p.conversation.id,'data-layout':p.layout,style:{display:'flex',flex:1,minHeight:0,flexDirection:'column'}}")
  .replace("      if(h.mode==='panel')", "      if(h.mode==='card')return !h.conversations[0]?null:React.createElement('div',{style:{width:360}},React.createElement(ActualCard,{conversation:h.conversations[0],currentUserId:'user-a',isSelected:false,availableTags:[],canOperate:false,canManageTags:false,onClick:noop,formatTime:()=> '09:00'}));\n      if(h.mode==='unregistered-panel')return React.createElement(ConversationUnregisteredPanel,{contactName:'Contato sintético sem lead',contactPhone:'5511999998888',canLinkLead:false,onClose:noop});\n      if(h.mode==='panel')")
  .replace("await page.route('**/*',r=>r.abort());", "const network=[];await page.route('**/*',r=>{network.push(r.request().url());return r.abort();});t.after(()=>assert.deepEqual(network,[],'no external network attempted'));");
assert.ok(bootstrap.includes("aliases['@/components/features/whatsapp/ConversationLeadPanel']=sources.Panel;"));
assert.ok(bootstrap.includes("...h().leadDetail"));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {harness,conversation};`);
const { harness, conversation } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;
const screenshots = process.env.WHATSAPP_LAYOUT_SCREENSHOT_DIR;
before(async () => {
  const sourceCSS = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${sourceCSS}\n@source "${join(repository, 'components/features/whatsapp').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui').replaceAll('\\', '/')}";`, { from: join(repository, 'app/layout-fixture.css') })).css;
  if (screenshots) await mkdir(screenshots, { recursive: true });
}, { timeout: 300000 });
after(async () => {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-conversation-layout-/);
  await rm(target, { recursive: true, force: true });
});

function card(id, lead) {
  return { ...conversation(id, lead), contact_name: 'Marina sintética', last_message: 'Vamos visitar amanhã?', last_message_from_me: true, last_message_status: 'read', last_message_at: '2026-10-13T12:00:00Z',
    lead: lead ? { id: lead, name: 'Marina sintética', assignee: { id: 'user-b', name: 'Bruno sintético' }, pipeline: { id: 'pipe-a', name: 'Funil de vendas' }, stage: { id: 'stage-a', name: 'Visita marcada', color: '#8b5cf6' }, tags: [{ tag: { id: 'tag-one', name: 'Visita agendada', color: '#0891b2' } }, { tag: { id: 'tag-two', name: 'Financiamento', color: '#8b5cf6' } }] } : null };
}
async function fixture(t, { width = 1440, mobile = false, permissions = ['lead_operate', 'whatsapp_view', 'whatsapp_operate'], mode = 'screen', group = false, lead = 'lead-a' } = {}) {
  const page = await harness(t, mode);
  await page.setViewportSize({ width, height: 900 });
  await page.addStyleTag({ content: `${css}\nhtml,body,#root{height:100%;margin:0} [data-screen-chat]{min-height:0}` });
  await page.evaluate(({ mobile, permissions, conversations, group, mode }) => {
    const h = window.harness; h.mobile = mobile; h.permissions = permissions;
    h.sessions = [{ ...h.sessions[0], status: 'connected' }]; h.conversations = conversations;
    h.conversations[0].is_group = group; h.leadDetail = { name: 'Marina sintética', phone: '5511999998888', tags: conversations[0].lead?.tags || [], assigned_user_id: 'user-b', stage: conversations[0].lead?.stage, pipeline: conversations[0].lead?.pipeline };
    h.panelUsers = [{ id: 'user-b', name: 'Bruno sintético' }]; h.render(mode);
    h.scrollScenario = true;
    h.messages = { ...h.messages, messages: [
      { id:'00000000-0000-4000-8000-000000000001',conversation_id:'chat-a',lead_id:'lead-a',content:'Olá, podemos visitar o apartamento amanhã?',message_type:'text',from_me:false,status:'received',sent_at:'2026-10-13T12:00:00Z',metadata:{},sender_name:'Marina sintética' },
      { id:'00000000-0000-4000-8000-000000000002',conversation_id:'chat-a',lead_id:'lead-a',content:'Sim, vou confirmar o horário com o proprietário.',message_type:'text',from_me:true,status:'read',sent_at:'2026-10-13T12:01:00Z',metadata:{},sender_name:'Bruno sintético' }
    ] }; h.render(mode);
  }, { mobile, permissions, conversations: [card('chat-a', lead), card('chat-b', 'lead-b')], group, mode });
  if (mode === 'screen') await page.getByRole('button', { name: 'Abrir chat-a', exact: true }).click();
  return page;
}
async function actions(page, label) {
  await page.getByRole('button', { name: label, exact: true }).click();
}
async function screenshot(page, name) { if (screenshots) await page.screenshot({ path: join(screenshots, name), fullPage: true }); }
function colorBytes(value) {
  // Chromium can serialize fractional CSS alpha after quantizing to 8 bits.
  const channels = value.match(/[\d.]+/g).map(Number);
  assert.ok(channels.length === 3 || channels.length === 4);
  return [...channels.slice(0, 3), Math.round((channels[3] ?? 1) * 255)];
}
async function typographySnapshot(name, fields) {
  if (!screenshots) return;
  const values = await Promise.all(fields.map(async ([field, locator]) => ({ field, ...await locator.evaluate(node => {
    const s = getComputedStyle(node); return { text: node.textContent.trim().slice(0, 80), family: s.fontFamily, size: s.fontSize,
      weight: s.fontWeight, color: s.color, background: s.backgroundColor, radius: s.borderRadius, height: s.height };
  }) })));
  await writeFile(join(screenshots, name), JSON.stringify(values, null, 2) + '\n');
}

test('layout desktop opens authorized lead details without duplicate identity and tags use the full row', async t => {
  const page = await fixture(t);
  const pane = page.getByRole('complementary', { name: 'Dados do contato' });
  await expect(pane).toBeVisible();
  await expect(page.locator('header [data-conversation-identity]')).toHaveCount(0);
  await expect(page.locator('header').getByText('Ver lead', { exact: true })).toBeVisible();
  await expect(page.locator('header').getByText('Marina Sintética', { exact: true })).toHaveCount(0);
  assert.equal(await page.locator('header').innerText().then(text => /99999|551199/.test(text)), false);
  const actionColors = await page.locator('header [aria-label="Ações da conversa"]').evaluate(group => [...group.querySelectorAll('a,button')].map(e => ({ background: getComputedStyle(e).backgroundColor, foreground: getComputedStyle(e).color, opacity: getComputedStyle(e).opacity })));
  assert.equal(actionColors.length, 4);
  assert.deepEqual(actionColors.map(color => ({ ...color, background: colorBytes(color.background), foreground: colorBytes(color.foreground) })), Array.from({ length: 4 }, () => ({ background: colorBytes('rgba(255, 255, 255, 0.045)'), foreground: colorBytes('rgba(255, 255, 255, 0.72)'), opacity: '1' })));
  await expect(pane.getByRole('heading', { name: 'Marina Sintética' })).toBeVisible();
  const geometry = await pane.evaluate(pane => {
    const identity = pane.querySelector('[data-conversation-lead-identity]').getBoundingClientRect();
    const tags = pane.querySelector('[data-conversation-lead-tags]').getBoundingClientRect();
    return { tagsX: tags.x, identityX: identity.x, tagsWidth: tags.width, identityWidth: identity.width, top: tags.top, bottom: identity.bottom, overflow: pane.scrollWidth > pane.clientWidth };
  });
  assert.ok(Math.abs(geometry.tagsX - geometry.identityX) < 1);
  assert.ok(Math.abs(geometry.tagsWidth - geometry.identityWidth) < 1);
  assert.ok(geometry.top >= geometry.bottom); assert.equal(geometry.overflow, false);
  const colors = await page.locator('[data-conversation-stage]').evaluate(stage => ({ background: getComputedStyle(stage).backgroundColor, foreground: getComputedStyle(stage).color, radius: getComputedStyle(stage).borderRadius, fontSize: getComputedStyle(stage).fontSize }));
  assert.deepEqual(colors, { background: 'rgb(139, 92, 246)', foreground: 'rgb(255, 255, 255)', radius: '4px', fontSize: '10px' });
  assert.equal(await page.locator('[data-conversation-pipeline]').evaluate(e => getComputedStyle(e).backgroundColor.includes('rgba')), false);
  await screenshot(page, 'conversas-desktop.png');
});

test('layout collapse survives refresh and the next selection opens its own details', async t => {
  const page = await fixture(t);
  await expect(page.locator('[data-conversation-details="docked"]')).toBeVisible();
  await actions(page, 'Recolher dados do contato');
  await expect(page.locator('[data-conversation-details]')).toHaveCount(0);
  await expect(page.locator('header [data-conversation-identity]')).toBeVisible();
  await page.evaluate(() => { window.harness.conversations = window.harness.conversations.map(c => ({ ...c, unread_count: 2 })); window.harness.render(); });
  await expect(page.locator('[data-conversation-details]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir chat-b', exact: true }).click();
  await expect(page.locator('[data-conversation-details="docked"]')).toBeVisible();
  await page.getByRole('button', { name: 'Abrir chat-a', exact: true }).click();
  await expect(page.locator('[data-conversation-details="docked"]')).toBeVisible();
});

test('layout narrow desktop opens a bounded Sheet on request and Escape restores the menu focus', async t => {
  const page = await fixture(t, { width: 1000 });
  await expect(page.locator('[data-conversation-details]')).toHaveCount(0);
  await expect(page.locator('header [data-conversation-identity]')).toBeVisible();
  await actions(page, 'Mostrar dados do contato');
  const dialog = page.getByRole('dialog', { name: 'Dados do contato' }); await expect(dialog).toBeVisible();
  assert.equal(await dialog.evaluate(e => e.scrollWidth > e.clientWidth), false);
  await screenshot(page, 'conversas-desktop-estreito.png');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mostrar dados do contato' })).toBeFocused({ timeout: 1500 });
});

test('layout mobile remains chat first and read-only users can open details search and view lead', async t => {
  const page = await fixture(t, { width: 390, mobile: true, permissions: ['whatsapp_view'] });
  await expect(page.locator('[data-conversation-details]')).toHaveCount(0);
  await expect(page.locator('header [data-conversation-identity]')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ver lead', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pesquisar nesta conversa', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mais ações da conversa' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Arquivar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Mudar vínculo da conversa', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mostrar dados do contato', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Dados do contato' }); await expect(dialog).toBeVisible();
  for (let index = 0; index < 8; index++) { await page.keyboard.press('Tab'); assert.equal(await dialog.evaluate(e => e.contains(document.activeElement)), true); }
  await screenshot(page, 'conversas-mobile-dados.png');
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Mostrar dados do contato' })).toBeFocused({ timeout: 1500 });
  await screenshot(page, 'conversas-mobile-chat.png');
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['archive', 'delete', 'link', 'send'].includes(r.kind)).length), 0);
});

test('layout group or unlinked read-only contact keeps identity without an empty details affordance', async t => {
  for (const group of [true, false]) {
    const page = await fixture(t, { group, lead: null, permissions: ['whatsapp_view'] });
    await expect(page.locator('[data-conversation-details]')).toHaveCount(0);
    await expect(page.locator('header [data-conversation-identity]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mais ações da conversa' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Mostrar dados do contato', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Mudar vínculo da conversa', exact: true })).toHaveCount(0);
  }
});

test('layout rebind is only in the header menu and historical scope never offers it', async t => {
  const page = await fixture(t);
  await expect(page.getByRole('button', { name: 'Mudar vínculo da conversa', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Mais ações da conversa' }).click();
  await expect(page.getByRole('menuitem', { name: 'Mudar vínculo da conversa', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => { window.harness.conversations = window.harness.conversations.map(c => ({ ...c, historical_lead_view: true })); window.harness.render(); });
  await expect(page.getByRole('button', { name: 'Mais ações da conversa' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Mudar vínculo da conversa', exact: true })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Arquivar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Ver lead', exact: true })).toBeVisible();
});

test('layout current shared cards retain outgoing status and full-width assignee metadata', async t => {
  const page = await fixture(t, { mode: 'card', width: 800 });
  // Actual page and floating consumers sit inside AppLayout's app-shell.
  await page.locator('#root').evaluate(node => node.classList.add('app-shell'));
  await expect(page.getByRole('img', { name: 'Mensagem lida' })).toBeVisible();
  await expect(page.locator('[data-conversation-tags]').getByText('Bruno Sintético', { exact: true })).toBeVisible();
  for (const [locator, size] of [[page.locator('[data-conversation-id] span[title="Marina Sintética"]'), '12px'], [page.locator('[data-conversation-preview]'), '11px']]) {
    assert.deepEqual(await locator.evaluate(node => ({ size: getComputedStyle(node).fontSize, weight: getComputedStyle(node).fontWeight })), { size, weight: '300' });
  }
  await typographySnapshot('card-typography.json', [
    ['name', page.locator('[data-conversation-id] span[title="Marina Sintética"]')],
    ['preview', page.locator('[data-conversation-preview]')],
    ['assignee', page.getByLabel('Responsável: Bruno Sintético', { exact: true })],
  ]);
  await screenshot(page, 'conversas-card.png');
});

test('layout mobile details can always close while the lead is loading failed or absent', async t => {
  const page = await fixture(t, { width: 320, mobile: true });
  for (const state of ['loading', 'failed', 'absent']) {
    await page.evaluate(state => { window.harness.leadDetailLoading = state === 'loading'; window.harness.leadDetailError = state === 'failed'; window.harness.leadDetailAbsent = state === 'absent'; window.harness.render(); }, state);
    await page.getByRole('button', { name: 'Mostrar dados do contato' }).click();
    const dialog = page.getByRole('dialog', { name: 'Dados do contato' }); await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Fechar dados do contato' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Fechar dados do contato' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Mostrar dados do contato' })).toBeFocused({ timeout: 1500 });
  }
});

test('toolbar follows Vimob neutral controls in light and dark and preserves the funnel badge', async t => {
  const page = await fixture(t);
  const group = page.locator('header [aria-label="Ações da conversa"]');
  for (const [theme, background, foreground, hover, hoverForeground, funnel] of [
    ['dark', 'rgba(255, 255, 255, 0.045)', 'rgba(255, 255, 255, 0.72)', 'rgba(255, 255, 255, 0.07)', 'rgb(255, 255, 255)', 'rgb(51, 20, 4)'],
    ['light', 'rgba(15, 23, 42, 0.055)', 'rgba(21, 21, 21, 0.68)', 'rgba(15, 23, 42, 0.075)', 'rgb(21, 21, 21)', 'rgb(255, 237, 213)'],
  ]) {
    await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
    await expect.poll(async () => (await group.evaluate(group => [...group.querySelectorAll('a,button')].map(e => ({ background: getComputedStyle(e).backgroundColor, foreground: getComputedStyle(e).color })))).map(color => ({ background: colorBytes(color.background), foreground: colorBytes(color.foreground) }))).toEqual(Array.from({ length: 4 }, () => ({ background: colorBytes(background), foreground: colorBytes(foreground) })));
    await expect.poll(async () => (await group.evaluate(group => [...group.querySelectorAll('svg')].map(e => getComputedStyle(e).stroke))).map(colorBytes)).toEqual(Array.from({ length: 4 }, () => colorBytes(foreground)));
    assert.deepEqual(await group.evaluate(group => [...group.querySelectorAll('a,button')].map(e => ({ height: e.getBoundingClientRect().height, radius: getComputedStyle(e).borderRadius, weight: getComputedStyle(e).fontWeight, fontSize: getComputedStyle(e).fontSize }))), Array.from({ length: 4 }, () => ({ height: 32, radius: '6px', weight: '300', fontSize: '12px' })));
    assert.deepEqual(await group.evaluate(group => [...group.querySelectorAll('svg')].map(e => ({ width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }))), Array.from({ length: 4 }, () => ({ width: 14, height: 14 })));
    assert.equal(await group.evaluate(e => getComputedStyle(e).gap), '6px');
    await expect.poll(() => page.locator('[data-conversation-pipeline]').evaluate(e => getComputedStyle(e).backgroundColor)).toBe(funnel);
    assert.equal(await page.locator('[data-conversation-stage]').evaluate(e => getComputedStyle(e).backgroundColor), 'rgb(139, 92, 246)');
    await screenshot(page, `conversas-toolbar-${theme}.png`);
    await page.getByRole('button', { name: 'Pesquisar nesta conversa' }).hover();
    await expect.poll(async () => colorBytes(await page.getByRole('button', { name: 'Pesquisar nesta conversa' }).evaluate(e => getComputedStyle(e).backgroundColor))).toEqual(colorBytes(hover));
    await expect.poll(async () => colorBytes(await page.getByRole('button', { name: 'Pesquisar nesta conversa' }).evaluate(e => getComputedStyle(e).color))).toEqual(colorBytes(hoverForeground));
    await page.mouse.move(0, 0);
  }
});

test('compact identity titles use card typography under real product CSS and preserve the dialog exception', async t => {
  const style = node => {
    const computed = getComputedStyle(node);
    return { size: computed.fontSize, weight: computed.fontWeight };
  };
  const narrow = await fixture(t, { width: 1000 });
  assert.deepEqual(await narrow.locator('header [data-conversation-identity] h2').evaluate(style), { size: '14px', weight: '300' });

  const docked = await fixture(t);
  assert.deepEqual(await docked.locator('[data-conversation-lead-identity] h2').evaluate(style), { size: '14px', weight: '300' });

  const unregistered = await fixture(t, { mode: 'unregistered-panel' });
  await unregistered.locator('#root').evaluate(node => node.classList.add('app-shell'));
  assert.deepEqual(await unregistered.getByRole('heading', { name: 'Contato Sintético Sem Lead', exact: true }).evaluate(style), { size: '14px', weight: '300' });

  const mobile = await fixture(t, { width: 390, mobile: true });
  await mobile.getByRole('button', { name: 'Mostrar dados do contato', exact: true }).click();
  const dialog = mobile.getByRole('dialog', { name: 'Dados do contato' });
  await expect(dialog).toBeVisible();
  assert.deepEqual(await dialog.locator('[data-conversation-lead-identity] h2').evaluate(style), { size: '14px', weight: '400' });

  for (const page of [docked, mobile]) {
    const phone = page.getByRole('button', { name: 'Ligar para Marina Sintética', exact: true });
    for (const theme of ['light', 'dark']) {
      await page.mouse.move(0, 0);
      await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
      const background = await page.evaluate(() => {
        const reference = document.createElement('span');
        reference.style.backgroundColor = 'color-mix(in oklab, var(--primary) 10%, transparent)';
        document.body.append(reference);
        const result = getComputedStyle(reference).backgroundColor;
        reference.remove();
        return result;
      });
      await phone.hover();
      await expect.poll(() => phone.evaluate(node => {
        const computed = getComputedStyle(node), icon = getComputedStyle(node.querySelector('svg'));
        return { color: computed.color, background: computed.backgroundColor, stroke: icon.stroke };
      })).toEqual({ color: 'rgb(255, 69, 41)', background, stroke: 'rgb(255, 69, 41)' });
    }
  }
});

test('lead data and assignee picker use lighter compact typography while the registered names remain raw', async t => {
  const page = await fixture(t);
  const pane = page.getByRole('complementary', { name: 'Dados do contato' });
  const styles = node => {
    const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight, radius: s.borderRadius, height: s.height };
  };
  const nameValue = pane.getByText('Nome', { exact: true }).locator('..').locator('span').last();
  assert.equal(await nameValue.textContent(), 'Marina Sintética');
  assert.deepEqual(await nameValue.evaluate(node => { const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight }; }), { size: '12px', weight: '300' });
  const owner = pane.getByRole('button', { name: 'Bruno Sintético', exact: true });
  assert.deepEqual(await owner.evaluate(styles), { size: '11px', weight: '300', radius: '6px', height: '32px' });
  for (const [control, height] of [[pane.getByRole('link', { name:'Editar',exact:true }), '28px'],[pane.getByRole('button', { name:'Anexar',exact:true }), '24px']]) {
    assert.deepEqual(await control.evaluate(styles), { size:'10px',weight:'300',radius:'6px',height });
  }
  await typographySnapshot('lead-data-typography.json', [['nameValue', nameValue], ['owner', owner],
    ['title', pane.getByRole('heading', { name: 'Marina Sintética', exact: true })],
    ['toolbarSearch', page.getByRole('button', { name: 'Pesquisar nesta conversa', exact: true })]]);
  await owner.click();
  const pickerInput = page.getByPlaceholder('Buscar responsável...', { exact: true });
  await expect(pickerInput).toBeVisible();
  assert.deepEqual(await pickerInput.evaluate(node => { const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight, height: s.height }; }), { size: '12px', weight: '300', height: '32px' });
  const option = page.getByRole('option', { name: /Bruno Sintético/ });
  assert.equal(await option.locator('span.truncate').textContent(), 'Bruno Sintético');
  assert.deepEqual(await option.evaluate(node => { const s = getComputedStyle(node); return { size: s.fontSize, weight: s.fontWeight, radius: s.borderRadius }; }), { size: '12px', weight: '300', radius: '6px' });
  await typographySnapshot('picker-portal-typography.json', [['input', pickerInput], ['personOption', option]]);
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => [window.harness.leadDetail.name, window.harness.panelUsers[0].name]), ['Marina sintética', 'Bruno sintético']);
  assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['feedback', 'archive', 'delete', 'link', 'send'].includes(r.kind)).length), 0);
});

test('toolbar search precedes the pane and gray close controls preserve their actions', async t => {
  const docked = await fixture(t);
  const labels = page => page.locator('header [aria-label="Ações da conversa"]').evaluate(group => [...group.querySelectorAll('a,button')].map(node => node.getAttribute('aria-label')));
  assert.deepEqual(await labels(docked), ['Ver lead', 'Mais ações da conversa', 'Pesquisar nesta conversa', 'Recolher dados do contato']);
  await docked.getByRole('button', { name: 'Pesquisar nesta conversa', exact: true }).click();
  await expect(docked.getByRole('textbox', { name: 'Buscar mensagem nesta conversa' })).toBeVisible();
  await docked.getByRole('button', { name: 'Fechar pesquisa', exact: true }).click();

  async function grayClose(page, button) {
    const styles = (node, hover) => {
      const style = getComputedStyle(node), reference = document.createElement('span');
      reference.style.backgroundColor = hover ? 'var(--app-surface-muted)' : 'var(--app-surface-soft)';
      reference.style.color = hover ? 'var(--app-text-primary)' : 'var(--app-text-secondary)';
      node.append(reference); const expected = getComputedStyle(reference);
      const result = { background: style.backgroundColor, color: style.color, expectedBackground: expected.backgroundColor, expectedColor: expected.color, radius: style.borderRadius };
      reference.remove(); return result;
    };
    const matches = result => ({ background: JSON.stringify(colorBytes(result.background)) === JSON.stringify(colorBytes(result.expectedBackground)),
      foreground: JSON.stringify(colorBytes(result.color)) === JSON.stringify(colorBytes(result.expectedColor)), radius: result.radius });
    for (const theme of ['light', 'dark']) {
      await page.mouse.move(0, 0);
      await page.evaluate(theme => { document.documentElement.className = theme; }, theme);
      let measured;
      await expect.poll(async () => { measured = await button.evaluate(styles, false); return matches(measured); })
        .toEqual({ background: true, foreground: true, radius: '6px' }).catch(error => { throw new Error(`${theme}: ${JSON.stringify(measured)}`, { cause: error }); });
      await button.hover();
      await expect.poll(async () => { measured = await button.evaluate(styles, true); return matches(measured); })
        .toEqual({ background: true, foreground: true, radius: '6px' }).catch(error => { throw new Error(`hover ${theme}: ${JSON.stringify(measured)}`, { cause: error }); });
    }
  }
  const closePane = docked.getByRole('button', { name: 'Fechar painel do lead', exact: true });
  await grayClose(docked, closePane); await closePane.click();
  await expect(docked.getByRole('complementary', { name: 'Dados do contato' })).toHaveCount(0);
  assert.deepEqual(await labels(docked), ['Ver lead', 'Mais ações da conversa', 'Pesquisar nesta conversa', 'Mostrar dados do contato']);

  const mobile = await fixture(t, { width: 390, mobile: true });
  await mobile.getByRole('button', { name: 'Mostrar dados do contato', exact: true }).click();
  const dialog = mobile.getByRole('dialog', { name: 'Dados do contato' }); await expect(dialog).toBeVisible();
  const mobileClose = dialog.getByRole('button', { name: 'Fechar dados do contato', exact: true });
  await grayClose(mobile, mobileClose); await mobileClose.click();
  await expect(dialog).toHaveCount(0);
  await expect(mobile.getByRole('button', { name: 'Mostrar dados do contato', exact: true })).toBeFocused();
  await mobile.getByRole('button', { name: 'Mostrar dados do contato', exact: true }).click();
  await mobile.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(mobile.getByRole('button', { name: 'Mostrar dados do contato', exact: true })).toBeFocused();

  const unregistered = await fixture(t, { mode: 'unregistered-panel' });
  await grayClose(unregistered, unregistered.getByRole('button', { name: 'Fechar painel do contato', exact: true }));

  for (const mobile of [false, true]) {
    const page = await harness(t, 'floating');
    await page.setViewportSize({ width: mobile ? 390 : 1440, height: 900 });
    await page.addStyleTag({ content: css });
    await page.evaluate(({ mobile, conversations }) => {
      const h = window.harness; h.mobile = mobile; h.conversations = conversations;
      h.sessions = [{ ...h.sessions[0], status: 'connected' }]; h.render();
    }, { mobile, conversations: [card('chat-a', 'lead-a'), card('chat-b', 'lead-b')] });
    const consoleErrors = [];
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    for (const active of [false, true]) {
      await page.evaluate(active => {
        const h = window.harness; if (active) h.ctx.openConversation(h.conversations[0]); else h.ctx.openChat();
        h.render();
      }, active);
      const close = page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true });
      await expect(close).toBeVisible().catch(async error => {
        const state = await page.evaluate(() => ({ state: window.harness.ctx.state, mode: window.harness.mode, mobile: window.harness.mobile, permissions: window.harness.permissions, text: document.body.innerHTML.slice(0, 400) }));
        throw new Error(`floating ${mobile}/${active}: ${JSON.stringify(state)} console=${JSON.stringify(consoleErrors)}`, { cause: error });
      });
      await grayClose(page, close); await close.click();
      await expect(close).toHaveCount(0); await page.waitForFunction(() => window.harness.ctx.state.isOpen === false);
    }
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['archive', 'delete', 'link', 'send'].includes(r.kind)).length), 0);
  }
});

test('mobile chat and conversation list share clipped eight-pixel top corners without horizontal overflow', async t => {
  for (const width of [320, 390]) {
    const page = await fixture(t, { width, mobile: true, permissions: ['whatsapp_view'] });
    const surface = page.locator('[data-conversations-mobile-surface]');
    const geometry = node => {
      const style = getComputedStyle(node);
      return { topLeft: style.borderTopLeftRadius, topRight: style.borderTopRightRadius, overflow: style.overflow,
        horizontalOverflow: node.scrollWidth > node.clientWidth };
    };
    await expect(surface).toBeVisible();
    assert.deepEqual(await surface.evaluate(geometry), { topLeft: '8px', topRight: '8px', overflow: 'hidden', horizontalOverflow: false });
    await page.getByRole('button', { name: 'Voltar para a lista de conversas', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Abrir chat-a', exact: true })).toBeVisible();
    assert.deepEqual(await surface.evaluate(geometry), { topLeft: '8px', topRight: '8px', overflow: 'hidden', horizontalOverflow: false });
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['archive', 'delete', 'link', 'send'].includes(r.kind)).length), 0);
  }
});
