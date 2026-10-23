import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real FloatingChat/Radix/CSS; reuse only the closed synthetic fixture bootstrap.
// Every external request is aborted and asserted absent by that fixture.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-wa-tags-touch-'));
const proof = process.env.WHATSAPP_FLOATING_TAGS_PROOF_DIR;
const modal = await readFile(join(repository, 'components/features/whatsapp/conversations/floating-mobile-modal.runtime.test.mjs'), 'utf8');
const boundary = modal.indexOf('\nfor (const width of [320, 390, 1440])');
assert.ok(boundary > 0, 'fixture bootstrap boundary remains explicit');
const setup = modal.slice(0, boundary)
  .replace("import { expect } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)};const {expect}=playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require=createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');", `const repository=${JSON.stringify(repository)};`)
  .replace('const injection = `bootstrap=bootstrap.replace(', 'const injection = `bootstrap=bootstrap.replace("usePathname=()=>\'/dashboard\'", "usePathname=()=>h().pathname||\'/dashboard\'").replace(');
assert.ok(setup.includes("usePathname=()=>h().pathname||'/dashboard'"), 'route fixture is controllable');
await writeFile(join(directory, 'fixture.mjs'), `${setup}\nexport {fixture};`);
const { fixture } = await import(pathToFileURL(join(directory, 'fixture.mjs')).href);
after(async () => {
  const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-wa-tags-touch-/); await rm(target, { recursive: true, force: true });
});

async function taggedFixture(t, width, theme = 'light') {
  const page = await fixture(t, 'floating', width, theme);
  await page.evaluate(() => {
    const current = harness.conversations[0];
    const tags = ['Primeira sintética', 'Segunda sintética', 'Terceira sintética'].map((name, n) => ({ tag: { id: `tag-${n}`, name, color: '#215583' } }));
    const card = { ...current, lead: { ...current.lead, tags } };
    harness.conversations = [card]; harness.render(); harness.ctx.openConversation(card);
    window.tagPointers = []; document.addEventListener('pointerdown', e => window.tagPointers.push(e.pointerType));
  });
  await expect(page.getByRole('button', { name: 'Ver mais 2 tags', exact: true })).toBeVisible();
  return page;
}
const indicator = page => page.getByRole('button', { name: 'Ver mais 2 tags', exact: true });
async function popupOpen(page) {
  await expect(page.getByRole('tooltip')).toBeVisible({ timeout: 1500 });
  await expect(page.getByRole('tooltip')).toContainText('Segunda sintética');
  await expect(page.getByRole('tooltip')).toContainText('Terceira sintética');
  await expect(indicator(page)).toHaveAttribute('aria-expanded', 'true');
}
async function popupClosed(page) {
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(indicator(page)).toHaveAttribute('aria-expanded', 'false');
}
async function noWrites(page) {
  assert.deepEqual(await page.evaluate(() => harness.requests.filter(r => ['send', 'archive', 'delete', 'link', 'feedback', 'start'].includes(r.kind)).map(r => r.kind)), []);
  await expect(page.locator('#floating-whatsapp-chat [data-message-bubble]')).toHaveCount(1);
}
async function evidence(page, name, data) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await writeFile(join(proof, `${name}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: join(proof, `${name}.png`) });
}

for (const width of [320, 390, 1440]) for (const theme of ['light', 'dark']) {
  test(`floating tags touch/keyboard ${width} ${theme}: toggle, portal dismissal and approved geometry`, async t => {
    const page = await taggedFixture(t, width, theme), trigger = indicator(page);
    const geometry = await trigger.evaluate(n => {
      const measure = node => { const r = node.getBoundingClientRect(), s = getComputedStyle(node); return { width: r.width, height: r.height, radius: s.borderRadius, fontSize: s.fontSize, fontWeight: s.fontWeight, color: s.color, background: s.backgroundColor }; };
      const badge = document.createElement('div'); badge.className = n.className; badge.textContent = n.textContent; n.parentElement.append(badge);
      const result = { current: measure(n), legacy: measure(badge), tabIndex: n.tabIndex }; badge.remove(); return result;
    });
    assert.deepEqual(geometry.current, geometry.legacy);
    assert.equal(geometry.current.fontSize, '9px'); assert.equal(geometry.current.fontWeight, '500');
    assert.equal(geometry.current.radius, '4px'); assert.equal(geometry.tabIndex, 0);
    await expect(trigger).toHaveAttribute('type', 'button');
    if (width < 768) await trigger.tap(); else await trigger.click();
    await popupOpen(page); await expect(trigger).toBeFocused();
    const box = await page.getByRole('tooltip').evaluate(n => {
      const popup = n.closest('[data-radix-popper-content-wrapper]');
      if (!popup) return null;
      const r = popup.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height };
    }); assert.ok(box); assert.ok(box.width > 1, 'measure the visible panel, not Radix accessible text');
    assert.ok(box.x >= -0.5 && box.x + box.width <= width + 0.5, 'extra tags remain inside viewport');
    await evidence(page, `tags-open-${width}-${theme}`, { geometry, popup: box, pointers: await page.evaluate(() => tagPointers) });
    if (width < 768) await trigger.tap(); else await trigger.click();
    await popupClosed(page); await expect(trigger).toBeFocused();
    if (width < 768) assert.ok((await page.evaluate(() => tagPointers)).includes('touch'), 'native touch events exercised');
    for (const key of ['Enter', 'Space']) {
      await page.keyboard.press(key); await popupOpen(page);
      await page.keyboard.press(key); await popupClosed(page); await expect(trigger).toBeFocused();
    }
    await page.keyboard.press('Enter'); await popupOpen(page);
    await page.keyboard.press('Escape'); await popupClosed(page); await expect(trigger).toBeFocused();
    if (width === 1440) { await trigger.hover(); await popupClosed(page); }
    assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-a', 'Escape closes only tags');
    await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).focus();
    await page.keyboard.press('Tab'); await expect(trigger).toBeFocused(); await popupOpen(page);
    if (width < 768) await trigger.tap(); else await trigger.click();
    await popupClosed(page); await expect(trigger).toBeFocused();
    await page.keyboard.press('Enter'); await popupOpen(page);
    // Message actions open a separate Radix portal, outside the tooltip layer.
    const messageMenu = page.getByRole('button', { name: 'Mais opções da mensagem', exact: true });
    await messageMenu.click(); await expect(page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true })).toBeVisible();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Dados da mensagem', exact: true }).click();
    const details = page.getByRole('dialog', { name: 'Dados da mensagem', exact: true }); await expect(details).toBeVisible();
    await page.keyboard.press('Escape'); await expect(details).toHaveCount(0); await expect(messageMenu).toBeFocused();
    await noWrites(page);
  });
}

for (const width of [320, 390, 1440]) test(`floating tags reset ${width}: conversation, route, responsive mode and close retire popup`, async t => {
  const page = await taggedFixture(t, width), showTags = async () => {
    if (width < 768) return indicator(page).tap();
    await page.mouse.move(0, 819); await page.getByRole('textbox', { name: 'Digite sua mensagem', exact: true }).focus();
    await popupClosed(page); return indicator(page).focus();
  };
  await showTags(); await popupOpen(page);
  await page.evaluate(() => { const card = harness.conversations[0]; harness.ctx.openConversation({ ...card, id: 'chat-b', lead_id: 'lead-b', lead: { ...card.lead, id: 'lead-b', name: 'Outra sintética' } }); });
  await popupClosed(page); assert.equal(await page.evaluate(() => harness.ctx.state.activeConversation?.id), 'chat-b');
  await showTags(); await popupOpen(page);
  await page.evaluate(() => { harness.pathname = '/crm/conversas'; harness.render(); });
  await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(() => { harness.pathname = '/dashboard'; harness.render(); });
  await expect(indicator(page)).toBeVisible(); await popupClosed(page);
  await showTags(); await popupOpen(page);
  const otherWidth = width < 768 ? 1440 : 390;
  await page.setViewportSize({ width: otherWidth, height: 820 });
  await page.evaluate(mobile => { harness.mobile = mobile; harness.render(); }, otherWidth < 768);
  await popupClosed(page);
  await indicator(page).click(); await popupOpen(page);
  await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).click();
  await expect(page.locator('#floating-whatsapp-chat')).toHaveCount(0); await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.evaluate(() => harness.ctx.openConversation(harness.conversations[0]));
  await popupClosed(page); await noWrites(page);
});

test('floating tags desktop hover/focus: pointer leave, outside press and Tab retain native tooltip access', async t => {
  const page = await taggedFixture(t, 1440), trigger = indicator(page);
  await trigger.hover(); await popupOpen(page);
  await page.locator('#before-chat').hover();
  // Radix retains its hover grace area until the next native movement.
  await page.mouse.move(1, 1); await popupClosed(page);
  await page.getByRole('button', { name: 'Fechar chat do WhatsApp', exact: true }).focus();
  await page.keyboard.press('Tab'); await expect(trigger).toBeFocused(); await popupOpen(page);
  await page.locator('#before-chat').click(); await popupClosed(page);
  await expect(page.locator('#before-chat')).toBeFocused(); await noWrites(page);
});
