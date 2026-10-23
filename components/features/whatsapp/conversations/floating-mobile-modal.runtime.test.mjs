import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real FloatingChat, Radix portals, launcher and CSS. Closed auth/transport,
// synthetic background controls and blocked external network; no real session.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-wa-mobile-modal-'));
const proof = process.env.WHATSAPP_MOBILE_MODAL_PROOF_DIR;
const original = await readFile(join(repository, 'components/features/whatsapp/conversations/integrated-surfaces-mobile.runtime.test.mjs'), 'utf8');
const boundary = original.indexOf("\nfor (const mode of ['screen', 'floating'])"); assert.ok(boundary > 0);
const launcher = join(repository, 'components/features/chat/FloatingChatButton.tsx').replaceAll('\\', '/');
const injection = `bootstrap=bootstrap.replace('import{FloatingChat}from','import{FloatingChatButton}from'+${JSON.stringify(JSON.stringify(launcher))}+';import{FloatingChat}from')
 .replace("h.mode==='floating'&&React.createElement(FloatingChat)","h.mode==='floating'&&React.createElement(React.Fragment,null,React.createElement(FloatingChatButton),React.createElement(FloatingChat))")
 .replace("await page.setContent('<div id=\\\"root\\\"></div>')", "await page.setContent('<button id=\\\"before-chat\\\">Fundo anterior</button><div id=\\\"root\\\"></div><button id=\\\"after-chat\\\">Fundo posterior</button>')");\n`;
const support = original.slice(0, boundary)
  .replace("import { expect } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace("await writeFile(join(directory, 'bootstrap.mjs'),", `${injection}await writeFile(join(directory, 'bootstrap.mjs'),`);
await writeFile(join(directory, 'support.mjs'), `${support}\nexport {fixture};`);
const { fixture } = await import(pathToFileURL(join(directory, 'support.mjs')).href);
after(async () => {
  const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-wa-mobile-modal-/); await rm(target, { recursive: true, force: true });
});

for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
  test(`floating focus containment ${width} ${theme}: mobile is modal, desktop stays nonmodal`, async t => {
    const page = await fixture(t, 'floating', width, theme);
    const surface = page.locator('#floating-whatsapp-chat');
    const before = page.locator('#before-chat'); assert.equal(await before.count(), 1, 'background fixture exists');
    if (width < 768) {
      await expect(surface).toHaveAttribute('aria-modal', 'true');
      await expect(before).toHaveAttribute('aria-hidden', 'true');
      const focusables = surface.locator('button:not([disabled]),textarea:not([disabled]),input:not([disabled]),a[href]');
      await focusables.last().focus(); await page.keyboard.press('Tab');
      assert.equal(await surface.evaluate(n => n.contains(document.activeElement)), true, 'Tab stays in fullscreen');
      await focusables.first().focus(); await page.keyboard.press('Shift+Tab');
      assert.equal(await surface.evaluate(n => n.contains(document.activeElement)), true, 'reverse Tab stays in fullscreen');
      await before.evaluate(n => n.focus());
      assert.equal(await surface.evaluate(n => n.contains(document.activeElement)), true, 'programmatic background focus is contained');
      await expect(surface).toHaveCSS('width', `${width}px`);
    } else {
      assert.equal(await surface.getAttribute('aria-modal'), null);
      assert.equal(await before.getAttribute('aria-hidden'), null);
      await before.focus(); await expect(before).toBeFocused();
      await expect(surface).toHaveCSS('border-radius', '8px');
    }
    const text = surface.locator('[data-message-text]');
    await expect(text).toHaveCSS('font-size', '12px'); await expect(text).toHaveCSS('font-weight', '200');
    if (proof) {
      await mkdir(proof, { recursive: true });
      await page.screenshot({ path: join(proof, `open-${width}-${theme}.png`) });
      await writeFile(join(proof, `open-${width}-${theme}.json`), JSON.stringify(await surface.evaluate(n => {
        const r = n.getBoundingClientRect(), s = getComputedStyle(n);
        return { width: r.width, height: r.height, radius: s.borderRadius, background: s.backgroundColor,
          modal: n.getAttribute('aria-modal'), describedBy: n.getAttribute('aria-describedby'),
          backdropHidden: document.getElementById('before-chat').getAttribute('aria-hidden') };
      }), null, 2));
    }
    await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).click();
    await expect(surface).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Abrir chat do WhatsApp', exact: true })).toBeFocused();
    assert.equal(await before.getAttribute('aria-hidden'), null, 'background restored after close');
    await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).toBe('');
    assert.equal(await page.evaluate(() => harness.requests.filter(r => ['send', 'archive', 'delete'].includes(r.kind)).length), 0);
    if (proof) { await mkdir(proof, { recursive: true }); await page.screenshot({ path: join(proof, `closed-${width}-${theme}.png`) }); }
  });
}

for (const width of [320, 390, 1440]) test(`floating modal ${width}: nested menu/dialog, history and layered Escape preserve focus`, async t => {
  const page = await fixture(t, 'floating', width);
  const surface = page.locator('#floating-whatsapp-chat');
  const menu = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
  await menu.click(); await expect(page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
  const details = page.getByRole('dialog', { name: 'Dados da mensagem', exact: true }); await expect(details).toBeVisible();
  assert.equal(await details.evaluate(n => n.closest('[aria-hidden="true"]') === null), true, 'portal remains exposed to assistive technology');
  await page.keyboard.press('Tab'); assert.equal(await details.evaluate(n => n.contains(document.activeElement)), true);
  await page.keyboard.press('Escape'); await expect(details).toHaveCount(0); await expect(menu).toBeFocused();
  await expect(surface.locator('[data-message-bubble]')).toHaveCount(1);
  const search = page.getByRole('button', { name: 'Buscar nesta conversa', exact: true });
  await search.click(); await expect(page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(search).toBeFocused();
  await expect(surface.locator('[data-message-bubble]')).toHaveCount(1);
  await page.keyboard.press('Escape'); await expect(surface.locator('[data-message-bubble]')).toHaveCount(0);
  await expect(surface).toBeFocused();
  await expect(surface).toHaveCount(1); await page.keyboard.press('Escape'); await expect(surface).toHaveCount(0);
});

test('responsive mobile/desktop/mobile transitions preserve the draft and retire/restore modal isolation', async t => {
  const page = await fixture(t, 'floating', 320, 'dark');
  const surface = page.locator('#floating-whatsapp-chat'), before = page.locator('#before-chat');
  await page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true }).fill('Rascunho preservado');
  await page.setViewportSize({ width: 1440, height: 820 });
  await page.evaluate(() => { harness.mobile = false; harness.render(); });
  assert.equal(await surface.getAttribute('aria-modal'), null); await expect(before).not.toHaveAttribute('aria-hidden', 'true');
  await before.focus(); await expect(before).toBeFocused();
  await expect(page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true })).toHaveValue('Rascunho preservado');
  await page.setViewportSize({ width: 390, height: 820 });
  await page.evaluate(() => { harness.mobile = true; harness.render(); });
  await expect(surface).toHaveAttribute('aria-modal', 'true'); await expect(before).toHaveAttribute('aria-hidden', 'true');
  await expect.poll(() => surface.evaluate(n => n.contains(document.activeElement))).toBe(true);
  await expect(page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true })).toHaveValue('Rascunho preservado');
});

test('revoking WhatsApp view retires the mobile modal and restores the background without sending', async t => {
  const page = await fixture(t, 'floating', 390);
  await page.evaluate(() => { harness.permissions = []; harness.render(); });
  await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0);
  const before = page.locator('#before-chat'); await expect(before).not.toHaveAttribute('aria-hidden', 'true');
  await before.focus(); await expect(before).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.pointerEvents)).toBe('');
  assert.equal(await page.evaluate(() => harness.requests.filter(r => r.kind === 'send').length), 0);
});

async function writeFloatingFixProof(name, value, page) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await writeFile(join(proof, `${name}.json`), JSON.stringify(value, null, 2));
  await page.screenshot({ path: join(proof, `${name}.png`) });
}

test('desktop Escape outside the floating chat preserves its conversation and history search', async t => {
  const page = await fixture(t, 'floating', 1440);
  const search = page.getByRole('button', { name: 'Buscar nesta conversa', exact: true });
  await search.click();
  const input = page.getByRole('textbox', { name: 'Buscar mensagem nesta conversa', exact: true });
  await expect(input).toBeFocused();
  await page.locator('#before-chat').focus();
  await page.keyboard.press('Escape');
  await expect(input).toBeVisible();
  assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-a');
  await input.focus(); await page.keyboard.press('Escape');
  await expect(input).toHaveCount(0); await expect(search).toBeFocused();
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation), null);
  await expect(page.locator('#floating-whatsapp-chat')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0);
});

test('Escape in an unrelated desktop modal does not navigate the floating chat', async t => {
  const page = await fixture(t, 'floating', 1440);
  await page.evaluate(() => {
    const dialog = document.createElement('dialog'); dialog.setAttribute('aria-label', 'Modal externo sintético');
    dialog.innerHTML = '<button>Controle externo sintético</button>'; document.body.append(dialog); dialog.showModal(); dialog.querySelector('button').focus();
  });
  await expect(page.getByRole('button', { name: 'Controle externo sintético', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Modal externo sintético', exact: true })).not.toBeVisible();
  assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-a');
  await expect(page.locator('#floating-whatsapp-chat [data-message-bubble]')).toHaveCount(1);
});

for (const width of [320, 390, 1440]) test(`floating extra tags ${width}: keyboard focus exposes names and Escape preserves the thread`, async t => {
  const page = await fixture(t, 'floating', width);
  await page.evaluate(() => {
    const current = harness.conversations[0];
    const tags = ['Primeira sintética', 'Segunda sintética', 'Terceira sintética'].map((name, n) => ({ tag: { id: `tag-${n}`, name, color: '#215583' } }));
    const card = { ...current, lead: { ...current.lead, tags } };
    harness.conversations = [card]; harness.render(); harness.ctx.openConversation(card);
  });
  const indicator = page.getByRole('button', { name: 'Ver mais 2 tags', exact: true });
  await expect(indicator).toHaveAttribute('type', 'button'); await expect(indicator).toHaveAccessibleName('Ver mais 2 tags');
  const geometry = await indicator.evaluate(n => {
    const measure = element => { const r = element.getBoundingClientRect(), s = getComputedStyle(element); return { width: r.width, height: r.height, radius: s.borderRadius, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor }; };
    const legacyBadge = document.createElement('div'); legacyBadge.className = n.className; legacyBadge.textContent = n.textContent; n.parentElement.append(legacyBadge);
    const result = { ...measure(n), legacyBadge: measure(legacyBadge), tabIndex: n.tabIndex }; legacyBadge.remove(); return result;
  });
  assert.equal(geometry.fontSize, '9px'); assert.equal(geometry.fontWeight, '500'); assert.equal(geometry.radius, '4px');
  const { legacyBadge, tabIndex, ...buttonStyle } = geometry; assert.deepEqual(buttonStyle, legacyBadge); assert.equal(tabIndex, 0);
  await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).focus(); await page.keyboard.press('Tab'); await expect(indicator).toBeFocused();
  await expect(page.getByRole('tooltip')).toContainText('Segunda sintética');
  await expect(page.getByRole('tooltip')).toContainText('Terceira sintética');
  await writeFloatingFixProof(`tags-keyboard-${width}`, geometry, page);
  await page.keyboard.press('Escape'); await expect(page.getByRole('tooltip')).toHaveCount(0);
  assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-a');
  await expect(page.locator('#floating-whatsapp-chat [data-message-bubble]')).toHaveCount(1);
  assert.equal(await page.evaluate(() => harness.requests.filter(r => r.kind === 'send').length), 0);
});

for (const width of [320, 390, 1440]) for (const phase of ['GET', 'POST']) {
  test(`floating slow ${phase} ${width}: close remains clickable and a late response cannot replace a new visit`, async t => {
    const page = await fixture(t, 'floating', width);
    const current = await page.evaluate(() => harness.conversations[0]);
    await page.evaluate(() => harness.ctx.openNewChatWithMessage('+5511999997777', 'Texto preparado B', 'lead-b', 'B sintético'));
    await expect(page.getByText('Iniciando conversa...', { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => harness.requests.filter(r => r.kind === 'find').length)).toBe(1);
    if (phase === 'POST') {
      await page.evaluate(() => harness.requests.find(r => r.kind === 'find').resolve(null));
      await expect.poll(() => page.evaluate(() => harness.requests.filter(r => r.kind === 'find').length)).toBe(2);
      await page.evaluate(() => harness.requests.filter(r => r.kind === 'find')[1].resolve(null));
      await expect.poll(() => page.evaluate(() => harness.requests.filter(r => r.kind === 'start').length)).toBe(1);
    }
    const close = page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true });
    await expect(close).toBeEnabled();
    const hit = await close.evaluate(button => { const r = button.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { width: r.width, height: r.height, receivesPoint: top === button || button.contains(top) }; });
    assert.equal(hit.receivesPoint, true); await writeFloatingFixProof(`slow-${phase}-${width}-loading`, hit, page); await close.click();
    await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0);
    await page.evaluate(card => harness.ctx.openConversation({ ...card, id: 'chat-c', lead_id: 'lead-c', lead: { ...card.lead, id: 'lead-c', name: 'C sintético' } }), current);
    const composer = page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true });
    await composer.fill('Rascunho C preservado');
    await page.evaluate(phase => {
      const request = phase === 'GET' ? harness.requests.find(r => r.kind === 'find') : harness.requests.find(r => r.kind === 'start');
      request.resolve({ id: 'chat-b', lead_id: 'lead-b', lead: { id: 'lead-b', name: 'B sintético' }, session_id: 'session-a', contact_phone: '+5511999997777', remote_jid: '5511999997777@s.whatsapp.net', is_group: false, unread_count: 0 });
    }, phase);
    await expect(composer).toHaveValue('Rascunho C preservado');
    assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-c');
    assert.equal(await page.evaluate(() => harness.requests.filter(r => r.kind === 'start').length), phase === 'POST' ? 1 : 0);
    assert.equal(await page.evaluate(() => harness.requests.filter(r => r.kind === 'send').length), 0);
    await writeFloatingFixProof(`slow-${phase}-${width}`, { ...hit, lateResponseIgnored: true, phase, syntheticPostAlreadyRequested: phase === 'POST' }, page);
  });
}
