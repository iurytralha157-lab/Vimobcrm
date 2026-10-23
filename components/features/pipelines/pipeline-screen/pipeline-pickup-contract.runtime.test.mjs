import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createPickupContractHarness } from './pipeline-pickup-contract-fixture.mjs';

// Physical pointer/keyboard sensors, Board, Card and Tailwind are real. Only
// auth/action services and the query status supplied to the Screen expression
// are synthetic. This suite never contacts an API or changes operational data.
const { openBoard, keyboardReady, expression } = await createPickupContractHarness();
console.info('Screen drag gate under test:', expression);

async function configure(page, options = {}) {
  await page.evaluate(options => {
    window.h.canOperateLeads = options.canOperateLeads !== false;
    window.h.moveContract = { query: { isError: options.contractError === true, error: options.contractError ? { status: 404, code: 'lead_move_contract_unavailable' } : null } };
    // Query cache updates replace identities; mutating the existing lead would
    // bypass the real card memo comparator instead of exercising the pool gate.
    window.h.stages = window.h.stages.map((stage, stageIndex) => stageIndex ? stage : ({
      ...stage, leads: stage.leads.map((lead, index) => index ? lead : ({
        ...lead, ...(options.cardDenied ? { can_operate: false } : {}),
        ...(options.pool ? { queue_pool: { id: 'synthetic-pool' }, assigned_user_id: null } : {}),
      })),
    }));
    window.h.render();
  }, options);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return page.locator('[data-pipeline-drop-column="stage0"] article').first().getByRole('button', { name: /pressione Enter|Abrir detalhes/ });
}

async function pointerPickup(page, handle) {
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 30, { steps: 3 });
}

async function cancelPointerGesture(page) {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !window.h.dragging && !document.querySelector('[inert]'));
  // @dnd-kit/core keeps its document click suppressor for 50ms after detach.
  // Release later to exercise our protection, rather than the vendor's timer.
  await page.waitForTimeout(100);
  await page.mouse.up();
}

for (const contractError of [false, true]) {
  test(`authorized card can be physically picked up and cancelled when capabilities ${contractError ? 'fails with 404' : 'is compatible'}`, { timeout: 20_000 }, async () => {
    const page = await openBoard(1280, 720), requests = [];
    page.on('request', request => requests.push({ method: request.method(), url: request.url() }));
    try {
      const handle = await configure(page, { contractError });
      await pointerPickup(page, handle);
      await page.waitForFunction(() => window.h.dragging, null, { timeout: 1500 });
      assert.equal(await page.locator('[inert]').count(), 1, 'real overlay exists after pickup');
      if (contractError && process.env.PIPELINE_PICKUP_PROOF_PATH) {
        await mkdir(dirname(process.env.PIPELINE_PICKUP_PROOF_PATH), { recursive: true });
        await page.screenshot({ path: process.env.PIPELINE_PICKUP_PROOF_PATH });
      }
      await cancelPointerGesture(page);
      assert.equal(await page.evaluate(() => window.h.opened), 0, 'Escape then pointer release cannot open the lead');
      const state = await page.evaluate(() => ({ drop: window.h.drop, count: window.h.stages[0].leads.length }));
      assert.equal(state.drop.reason, 'CANCEL'); assert.equal(state.drop.destination, null);
      assert.equal(state.count, 6);
      assert.deepEqual(requests, [], 'pickup and cancellation never issue POST or external requests');
      // The previous overlay must not capture the next pointer gesture.
      await pointerPickup(page, handle);
      await page.waitForFunction(() => window.h.dragging, null, { timeout: 1500 });
      await cancelPointerGesture(page);
      assert.equal(await page.evaluate(() => window.h.opened), 0, 'repeated cancellation cannot leak a click');
      assert.deepEqual(requests, [], 'repeated cancelled gestures also issue no requests');
    } finally { await page.close(); }
  });
}

test('keyboard pickup and cancellation work after capabilities fails', { timeout: 20_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const handle = await configure(page, { contractError: true });
    await handle.focus(); await page.keyboard.press('Space');
    await page.waitForFunction(() => window.h.dragging, null, { timeout: 1500 });
    await keyboardReady(page); await page.keyboard.press('Escape');
    await page.waitForFunction(() => !window.h.dragging);
    assert.equal(await page.evaluate(() => window.h.drop.reason), 'CANCEL');
    assert.equal(await page.evaluate(() => window.h.opened), 0, 'keyboard cancellation and keyup cannot open the lead');
    await handle.press('Enter');
    assert.equal(await page.evaluate(() => window.h.opened), 1, 'intentional Enter after cancellation still opens once');
  } finally { await page.close(); }
});

test('after pointer cancellation, quick actions and new intentional click or Enter retain their behavior', { timeout: 20_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const handle = await configure(page, { contractError: true });
    const card = page.locator('[data-pipeline-drop-column="stage0"] article').first();
    // Intercept the actual handlers' external windows, so no dialer, Gmail,
    // external navigation, CRM activity write or provider send can occur.
    await page.evaluate(() => { window.h.externalWindows = []; window.open = url => { window.h.externalWindows.push(url); return null; }; });
    await pointerPickup(page, handle);
    await page.waitForFunction(() => window.h.dragging);
    await cancelPointerGesture(page);
    assert.equal(await page.evaluate(() => window.h.opened), 0);
    await card.getByRole('button', { name: /^Abrir WhatsApp:/ }).click();
    assert.equal(await page.evaluate(() => window.h.chats), 1);
    await card.getByRole('button', { name: /^Ligar para / }).click();
    await card.getByRole('button', { name: /^Enviar e-mail para / }).click();
    const windows = await page.evaluate(() => window.h.externalWindows);
    assert.equal(windows.length, 2); assert.match(windows[0], /^tel:/); assert.match(windows[1], /^https:\/\/mail\.google\.com\//);
    assert.equal(await page.evaluate(() => window.h.dragging), false);
    assert.equal(await page.evaluate(() => window.h.opened), 0, 'quick actions do not open lead details');
    await handle.click();
    assert.equal(await page.evaluate(() => window.h.opened), 1, 'new pointer gesture opens exactly once');
    await handle.press('Enter');
    assert.equal(await page.evaluate(() => window.h.opened), 2, 'intentional Enter opens exactly once');
  } finally { await page.close(); }
});

test('revoking global permission during pickup keeps cancellation safe without restoring DnD activators', { timeout: 20_000 }, async () => {
  const page = await openBoard(1280, 720);
  try {
    const handle = await configure(page);
    await pointerPickup(page, handle);
    await page.waitForFunction(() => window.h.dragging);
    await page.evaluate(() => { window.h.canOperateLeads = false; window.h.render(); });
    await page.waitForFunction(() => !document.querySelector('[data-pipeline-drop-column="stage0"] article [aria-describedby^="DndDescribedBy"]'));
    await cancelPointerGesture(page);
    assert.equal(await page.evaluate(() => window.h.opened), 0, 'revocation cannot remove the residual-click guard');
    assert.equal(await handle.getAttribute('aria-describedby'), null, 'revoked card remains disabled for dragging');
    assert.equal(await page.evaluate(() => window.h.drop.destination), null);
  } finally { await page.close(); }
});

for (const [label, options] of [
  ['global lead permission denied', { canOperateLeads: false }],
  ['card can_operate false', { cardDenied: true }],
  ['unassigned queue pool lead', { pool: true }],
]) {
  test(`${label} still prevents pointer and keyboard pickup`, { timeout: 20_000 }, async () => {
    const page = await openBoard(1280, 720);
    try {
      const handle = await configure(page, { contractError: true, ...options });
      assert.equal(await handle.getAttribute('aria-describedby'), null, 'disabled card has no DnD sensor activator');
      await pointerPickup(page, handle); await page.mouse.up();
      await handle.focus(); await page.keyboard.press('Space');
      assert.equal(await page.evaluate(() => window.h.dragging), false);
      assert.equal(await page.locator('[inert]').count(), 0);
      assert.equal(await page.evaluate(() => window.h.drop ?? null), null);
    } finally { await page.close(); }
  });
}
