import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from '@playwright/test';
import ts from 'typescript';

const DATABASE = 'vimob-new-lead-sound-v1';
const origin = 'https://lead-sound-fixture.invalid';
const source = readFileSync(new URL('./lead-sound-coordinator.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const script = `(() => { const exports = {}; ${compiled}
window.claimNewLeadSound = exports.claimNewLeadSound; window.eligible = true;
})();`;
let browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

async function open(t) {
  const context = await browser.newContext(), errors = [];
  const pages = await Promise.all([context.newPage(), context.newPage()]);
  for (const page of pages) {
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.abort());
    await page.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: '<title>Local sound test</title>' }));
    await page.goto(origin);
    await page.addScriptTag({ content: script });
  }
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  return pages;
}
function claim(page, notificationId, now, scope = 'user-a:org-a') {
  return page.evaluate(input => window.claimNewLeadSound(input, () => window.eligible), { scope, notificationId, now });
}
async function stored(page) {
  return page.evaluate(databaseName => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['claims', 'clocks']);
      const claims = tx.objectStore('claims').getAll(), clocks = tx.objectStore('clocks').getAll();
      tx.oncomplete = () => { db.close(); resolve({ claims: claims.result, clocks: clocks.result }); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), DATABASE);
}
async function holdWrites(page) {
  await page.evaluate(databaseName => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['claims', 'clocks'], 'readwrite');
      let active = true;
      const keepAlive = () => {
        const get = tx.objectStore('claims').get(['holder', 'holder']);
        get.onsuccess = () => { if (active) keepAlive(); };
      };
      window.releaseHold = () => { active = false; db.close(); };
      db.onversionchange = window.releaseHold;
      keepAlive(); resolve();
    };
  }), DATABASE);
}
async function queueClaim(page, notificationId, now) {
  await page.evaluate(input => {
    const original = IDBDatabase.prototype.transaction;
    window.transactions = 0;
    IDBDatabase.prototype.transaction = function (...args) { window.transactions++; return original.apply(this, args); };
    window.pendingClaim = window.claimNewLeadSound(input, () => window.eligible);
  }, { scope: 'user-a:org-a', notificationId, now });
  await page.waitForFunction(() => window.transactions > 0);
}

test('two pages in the same browser context atomically elect exactly one winner per race', async t => {
  const pages = await open(t);
  for (let index = 0; index < 8; index++) {
    const results = await Promise.all(pages.map(page => claim(page, `race-${index}`, 10_000 + index * 2100)));
    assert.deepEqual(results.toSorted(), [false, true]);
  }
  const state = await stored(pages[0]);
  assert.equal(state.claims.length, 8);
  assert.equal(state.clocks.length, 1);
});

test('a reload and cross-tab replay cannot sound the same notification again', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'persisted', 10_000), true);
  assert.equal(await claim(second, 'persisted', 13_000), false);
  await first.reload(); await first.addScriptTag({ content: script });
  assert.equal(await claim(first, 'persisted', 20_000), false);
});

test('scope cooldown is two seconds and a suppressed notification stays seen', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'first', 10_000), true);
  assert.equal(await claim(second, 'suppressed', 10_001), false);
  assert.equal(await claim(second, 'suppressed', 15_000), false);
  assert.equal(await claim(second, 'boundary', 12_000), true);
  assert.equal(await claim(first, 'clock-went-back', 11_999), false);
  assert.equal((await stored(first)).claims.length, 4);
});

test('organization and user scopes have independent claims and cooldown clocks', async t => {
  const [first, second] = await open(t);
  const results = await Promise.all([
    claim(first, 'same-id', 10_000, 'user-a:org-a'),
    claim(second, 'same-id', 10_000, 'user-a:org-b'),
    claim(second, 'same-id', 10_000, 'user-b:org-a'),
  ]);
  assert.deepEqual(results, [true, true, true]);
  assert.equal((await stored(first)).clocks.length, 3);
});

test('initial ineligibility does not consume a notification or its scope cooldown', async t => {
  const [first, second] = await open(t);
  await first.evaluate(() => { window.eligible = false; });
  assert.equal(await claim(first, 'muted', 10_000), false);
  assert.equal(await claim(second, 'muted', 10_000), true);
});

test('eligibility lost while a native transaction is queued aborts without consuming its ID', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'seed', 10_000), true);
  await holdWrites(first); await queueClaim(second, 'changed-generation', 13_000);
  await second.evaluate(() => { window.eligible = false; });
  await first.evaluate(() => window.releaseHold());
  assert.equal(await second.evaluate(() => window.pendingClaim), false);
  assert.equal(await claim(first, 'changed-generation', 13_000), true);
});

test('a final eligibility check suppresses a winner after commit', async t => {
  const [first] = await open(t);
  const result = await first.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = original.apply(this, args);
      tx.addEventListener('complete', () => { window.eligible = false; });
      return tx;
    };
    return window.claimNewLeadSound({ scope: 'user-a:org-a', notificationId: 'late-mute', now: 10_000 }, () => window.eligible);
  });
  assert.equal(result, false);
});

test('claims expire at ten minutes and cleanup deletes only a small indexed batch', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'expires', 10_000), true);
  assert.equal(await claim(second, 'expires', 610_000), true);
  await first.evaluate(databaseName => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction(['claims', 'clocks'], 'readwrite');
      for (let index = 0; index < 36; index++) {
        tx.objectStore('claims').put({ scope: 'expired', notificationId: `${index}`, expiresAt: 1 });
        tx.objectStore('clocks').put({ scope: `expired-${index}`, lastPlayedAt: 0, expiresAt: 1 });
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), DATABASE);
  assert.equal(await claim(second, 'cleanup', 620_000, 'other-scope'), true);
  const state = await stored(first);
  assert.equal(state.claims.filter(row => row.scope === 'expired').length, 20);
  assert.equal(state.clocks.filter(row => row.scope.startsWith('expired-')).length, 20);
  assert.equal(await claim(first, 'cleanup', 625_000, 'other-scope'), false);
});

test('a transaction timeout fails closed and cannot commit a late reservation', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'seed', 10_000), true);
  await holdWrites(first); await queueClaim(second, 'timed-out', 13_000);
  assert.equal(await second.evaluate(() => window.pendingClaim), false);
  await first.evaluate(() => window.releaseHold());
  assert.equal(await claim(first, 'timed-out', 13_000), true);
});

test('version changes abort queued coordination and newer incompatible storage fails closed', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'seed', 10_000), true);
  await holdWrites(first); await queueClaim(second, 'version-change', 13_000);
  await first.evaluate(databaseName => new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  }), DATABASE);
  assert.equal(await second.evaluate(() => window.pendingClaim), false);
  assert.equal(await claim(second, 'newer-schema', 16_000), false);
});

test('unavailable, denied, blocked and aborted storage return false without fallback', async t => {
  const [first, second] = await open(t);
  assert.equal(await first.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => undefined });
    return window.claimNewLeadSound({ scope: 'scope', notificationId: 'missing', now: 10_000 }, () => true);
  }), false);
  assert.equal(await second.evaluate(() => {
    Object.defineProperty(window, 'indexedDB', { configurable: true, get: () => { throw new DOMException('Denied', 'SecurityError'); } });
    return window.claimNewLeadSound({ scope: 'scope', notificationId: 'denied', now: 10_000 }, () => true);
  }), false);
  await second.reload(); await second.addScriptTag({ content: script });
  assert.equal(await second.evaluate(() => {
    indexedDB.open = () => {
      const request = {};
      queueMicrotask(() => request.onblocked());
      return request;
    };
    return window.claimNewLeadSound({ scope: 'scope', notificationId: 'blocked', now: 10_000 }, () => true);
  }), false);
  await second.reload(); await second.addScriptTag({ content: script });
  assert.equal(await second.evaluate(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) { const tx = original.apply(this, args); tx.abort(); return tx; };
    return window.claimNewLeadSound({ scope: 'scope', notificationId: 'aborted', now: 10_000 }, () => true);
  }), false);
});

test('invalid input and an eligibility exception never escape or write claims', async t => {
  const [first] = await open(t);
  assert.equal(await claim(first, '', 10_000), false);
  assert.equal(await claim(first, 'bad-clock', Number.NaN), false);
  assert.equal(await first.evaluate(() => window.claimNewLeadSound({ scope: 'scope', notificationId: 'throw', now: 10_000 }, () => { throw Error('stale'); })), false);
});

test('an indexed cleanup failure aborts the reservation without escaping its callback', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'expired-seed', 10_000), true);
  await second.evaluate(() => {
    IDBCursor.prototype.delete = () => { throw new DOMException('Denied', 'InvalidStateError'); };
  });
  assert.equal(await claim(second, 'cleanup-failed', 620_000), false);
  assert.deepEqual((await stored(first)).claims.map(row => row.notificationId), ['expired-seed']);
  assert.equal(await claim(first, 'cleanup-failed', 620_000), true);
});

test('a queued operation retains the input scope and ID captured at invocation', async t => {
  const [first, second] = await open(t);
  assert.equal(await claim(first, 'seed', 10_000), true);
  await holdWrites(first);
  await second.evaluate(() => {
    const input = { scope: 'user-a:org-a', notificationId: 'original', now: 13_000 };
    window.pendingClaim = window.claimNewLeadSound(input, () => true);
    input.scope = 'different'; input.notificationId = 'changed'; input.now = 99_000;
  });
  await first.evaluate(() => window.releaseHold());
  assert.equal(await second.evaluate(() => window.pendingClaim), true);
  assert.equal(await claim(first, 'original', 20_000), false);
  assert.equal((await stored(first)).claims.some(row => row.scope === 'different'), false);
});
