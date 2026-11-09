import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Actual Screen/Floating/own-start hook/Radix/CSS, closed synthetic transport.
// Entry card/detail handlers and transport authorization have separate tests.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-wa-send-entry-'));
const proof = process.env.WHATSAPP_SEND_ENTRY_PROOF_DIR;
const original = await readFile(join(repository, 'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'), 'utf8');
const boundary = original.indexOf("\nfor (const mode of ['screen', 'floating'])"); assert.ok(boundary > 0);
const injection = `bootstrap=bootstrap
 .replace("usePathname=()=>'/dashboard'", "usePathname=()=>h().path||'/dashboard'")
 .replace("React.createElement('a',{...p,href},children)", "React.createElement('a',{...p,href,onClick:e=>{e.preventDefault();p.onClick?.();window.harness.path=href.split('?')[0];window.harness.navigation.push(href);window.harness.render();}},children)");\n`;
const support = original.slice(0, boundary)
  .replace("import { expect } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace("await writeFile(join(directory, 'bootstrap.mjs'),", `${injection}await writeFile(join(directory, 'bootstrap.mjs'),`);
await writeFile(join(directory, 'support.mjs'), `${support}\nexport {harness,conversation,css,bounds,noOverflow};`);
const supportModule = await import(pathToFileURL(join(directory, 'support.mjs')).href);
after(async () => {
  const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^vimob-wa-send-entry-/);
  await rm(target, { recursive: true, force: true });
});

async function setup(t, mode, width, { grant = true, cold = false, theme = 'light' } = {}) {
  const page = await supportModule.harness(t, mode, { hasTouch: width < 768 }); page.setDefaultTimeout(5000);
  await page.setViewportSize({ width, height: 820 }); await page.emulateMedia({ colorScheme: theme });
  await page.addStyleTag({ content: `${supportModule.css}\nhtml,body,#root{height:100%;margin:0} #root>output{display:none}` });
  await page.evaluate(({ mode, width, grant, cold, theme }) => {
    document.documentElement.className = theme;
    const h = window.harness; h.mobile = width < 768; h.path = '/dashboard'; h.auth.organization = { id: 'org-a' };
    h.own = { ...h.sessions[0], organization_id: 'org-a', status: 'connected', instance_name: 'Meu número A', display_name: 'Meu número A', is_active: true };
    h.ownB = { ...h.own, id: 'session-b', instance_name: 'Meu número B' };
    h.original = { id: 'original', session_id: 'shared', lead_id: 'lead-a', contact_name: 'Marina Sintética',
      contact_phone: '+5511999998888', remote_jid: '5511999998888@s.whatsapp.net', is_group: false, unread_count: 0,
      lead: { id: 'lead-a', name: 'Marina Sintética', assignee: { id: 'user-a' }, tags: [] }, last_message: 'Histórico original' };
    h.owned = { ...h.original, id: 'owned', session_id: h.own.id };
    h.sessions = cold ? [] : [{ ...h.own, id: 'shared', owner_user_id: 'original-owner', can_send: grant, instance_name: 'Número original' }, h.own, h.ownB];
    h.conversations = cold ? [] : [h.original]; h.messages = { ...h.messages, messages: [] };
    h.request = async (kind, params) => {
      h.requests.push({ kind, params });
      if (kind === 'lead-phone') return { id: 'lead-a', name: 'Marina Sintética', phone: '+5511999998888' };
      if (kind === 'lead') return { data: { id: 'lead-a', organization_id: 'org-a', name: 'Marina Sintética', phone: '+5511999998888' } };
      if (kind === 'session') return h.sessions.find(s => s.id === params.id);
      if (kind === 'find') return null;
      if (kind === 'detail') return h.conversations.find(c => c.id === params.id) || h.original;
      if (kind === 'start') {
        if (h.deferStart) await new Promise(resolve => { h.releaseStart = resolve; });
        h.conversations = [h.owned, ...h.conversations.filter(c => c.id !== 'owned')]; h.render(); return h.owned;
      }
      return { status: 'pending' };
    };
    h.render(); if (mode === 'floating' && !cold) h.ctx.openConversation(h.original);
  }, { mode, width, grant, cold, theme });
  if (mode === 'screen' && !cold) await page.getByText('Marina Sintética', { exact: true }).first().click();
  if (proof) await mkdir(proof, { recursive: true });
  return page;
}
const prepared = 'Mensagem preparada sintética';
async function screenshot(page, name) { if (proof) await page.screenshot({ path: join(proof, `${name}.png`), fullPage: true }); }
async function noMutation(page) { assert.equal(await page.evaluate(() => window.harness.requests.filter(r => ['start', 'send', 'link'].includes(r.kind)).length), 0); }

for (const mode of ['screen', 'floating']) for (const width of [320, 390, 1440]) for (const grant of [true, false]) {
  test(`owned choice ${mode} ${width} original grant ${grant}: preserves original route and selects a different physical conversation`, async t => {
    const page = await setup(t, mode, width, { grant, theme: width === 390 ? 'dark' : 'light' });
    const action = page.getByRole('button', { name: 'Iniciar conversa pelo seu WhatsApp', exact: true });
    await expect(action).toBeVisible(); await supportModule.bounds(action, width, 'owned-start action');
    const field = page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true });
    if (grant) { await expect(field).toBeEnabled(); await field.fill('Rascunho original preservado'); }
    else await expect(field).toHaveCount(0);
    await noMutation(page); await screenshot(page, `${mode}-${width}-grant-${grant}-original`); await action.click();
    const dialog = page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Meu número A', exact: true }) });
    await expect(dialog).toBeVisible(); await expect(dialog.getByText('Número original', { exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape'); await expect(action).toBeVisible();
    if (grant) await expect(field).toHaveValue('Rascunho original preservado');
    await noMutation(page); await action.click(); await dialog.getByRole('button', { name: 'Meu número A', exact: true }).click();
    await expect(field).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.harness.requests.filter(r => r.kind === 'start').length)).toBe(1).catch(async error => {
      error.message += JSON.stringify(await page.evaluate(() => ({ requests: window.harness.requests, text: document.body.innerText }))); throw error;
    });
    const starts = await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'start'));
    assert.equal(starts[0].params.sessionId, 'session-a'); assert.equal(starts[0].params.ownSessionOnly, true);
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
    await field.fill('Envio pelo próprio'); await page.getByRole('button', { name: 'Enviar mensagem', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length)).toBe(1);
    const send = await page.evaluate(() => window.harness.requests.find(r => r.kind === 'send').params);
    assert.equal(send.conversation.id, 'owned'); assert.equal(send.conversation.session_id, 'session-a'); assert.equal(send.sendSessionId, 'session-a');
    await screenshot(page, `${mode}-${width}-grant-${grant}-owned`);
  });
}
for (const width of [320, 390, 1440]) {
  test(`cold lead ${width}: clickable integration keeps target and prefill through connection and resumes without automatic send`, async t => {
    const page = await setup(t, 'floating', width, { cold: true, theme: width === 390 ? 'dark' : 'light' });
    await page.evaluate(text => window.harness.ctx.openNewChatWithMessage('+5511999998888', text, 'lead-a', 'Marina Sintética'), prepared);
    const connect = page.getByRole('link', { name: 'Conecte o WhatsApp para iniciar o atendimento deste lead', exact: true });
    await expect(connect).toBeVisible(); await expect(connect).toHaveAttribute('href', '/settings?tab=whatsapp');
    await supportModule.bounds(connect, width, 'connection link');
    const pending = await page.evaluate(() => window.harness.ctx.state);
    assert.equal(pending.pendingLeadId, 'lead-a'); assert.equal(pending.pendingMessage, prepared); await noMutation(page);
    await screenshot(page, `floating-${width}-cold`); await connect.click();
    await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.harness.ctx.state.pendingMessage), prepared);
    await page.evaluate(() => { const h = window.harness; h.sessions = [h.own]; h.render(); });
    const field = page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true });
    await expect(field).toHaveValue(prepared); await expect(field).toBeEnabled();
    assert.equal(await page.evaluate(() => window.harness.ctx.state.activeConversation.id), 'owned');
    assert.equal(await page.evaluate(() => window.harness.requests.filter(r => r.kind === 'send').length), 0);
    await screenshot(page, `floating-${width}-reconnected`);
  });
}
for (const action of ['close', 'tenant-aba', 'new-intent']) test(`cold lead ${action} never revives the obsolete target or prepared text`, async t => {
  const page = await setup(t, 'floating', 390, { cold: true });
  await page.evaluate(text => window.harness.ctx.openNewChatWithMessage('+5511999998888', text, 'lead-a', 'Marina Sintética'), prepared);
  await expect(page.getByRole('link', { name: 'Conecte o WhatsApp para iniciar o atendimento deste lead', exact: true })).toBeVisible();
  if (action === 'close') await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).click();
  else if (action === 'tenant-aba') { await page.evaluate(() => window.harness.tenant('org-b')); await page.evaluate(() => window.harness.tenant('org-a')); }
  else await page.evaluate(() => window.harness.ctx.openNewChatWithMessage('+5511888887777', 'Novo rascunho', 'lead-b', 'Lead B'));
  await page.evaluate(() => { const h = window.harness; h.sessions = [h.own]; h.render(); });
  if (action === 'new-intent') {
    // The fixture's newly prepared canonical route intentionally mismatches B;
    // even so, the old A text must not be resurrected into it.
    await expect.poll(() => page.evaluate(() => window.harness.ctx.state.pendingMessage)).not.toBe(prepared);
  } else {
    assert.equal(await page.evaluate(() => window.harness.ctx.state.activeConversation), null);
    assert.equal(await page.evaluate(() => window.harness.ctx.state.pendingMessage), null);
    await noMutation(page);
  }
});
