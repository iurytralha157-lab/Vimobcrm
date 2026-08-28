import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const serviceWorkerSource = readFileSync(
  new URL('../../public/sw.js', import.meta.url),
  'utf8',
);

function createHarness() {
  const listeners = new Map();
  const opened = [];
  const shown = [];
  const self = {
    location: { origin: 'https://app.vimobcrm.com.br' },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    skipWaiting: async () => undefined,
    registration: {
      showNotification: async (title, options) => {
        shown.push({ title, options });
      },
    },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async (href) => {
        opened.push(href);
      },
    },
  };

  vm.runInNewContext(serviceWorkerSource, {
    self,
    URL,
    Promise,
    console,
    encodeURIComponent,
  });

  return { listeners, opened, shown };
}

async function clickNotification(harness, data) {
  let work = Promise.resolve();
  harness.listeners.get('notificationclick')({
    notification: { data, close() {} },
    waitUntil(promise) {
      work = Promise.resolve(promise);
    },
  });
  await work;
}

test('notification click rejects external, public and protocol-relative targets', async () => {
  for (const unsafeTarget of [
    'https://attacker.example/phishing',
    '//attacker.example/phishing',
    '/login?redirectTo=/crm',
  ]) {
    const harness = createHarness();
    await clickNotification(harness, { url: unsafeTarget });
    assert.deepEqual(harness.opened, ['https://app.vimobcrm.com.br/notifications']);
  }
});

test('notification click preserves a protected same-origin path and legacy lead route', async () => {
  const protectedHarness = createHarness();
  await clickNotification(protectedHarness, {
    target_url: '/crm/conversas?conversation=session-1#latest',
  });
  assert.deepEqual(protectedHarness.opened, [
    'https://app.vimobcrm.com.br/crm/conversas?conversation=session-1#latest',
  ]);

  const legacyHarness = createHarness();
  await clickNotification(legacyHarness, { url: '/leads', lead_id: 'lead 1' });
  assert.deepEqual(legacyHarness.opened, [
    'https://app.vimobcrm.com.br/crm/pipelines?lead=lead%201',
  ]);
});

test('push handler stores only a sanitized navigation target', async () => {
  const harness = createHarness();
  let work = Promise.resolve();
  harness.listeners.get('push')({
    data: {
      json: () => ({
        notification: {
          title: 'Novo lead',
          url: '/crm/pipelines',
          icon: 'https://attacker.example/tracker.png',
          badge: 'https://attacker.example/tracker.png',
          data: { url: 'https://attacker.example/phishing' },
        },
      }),
    },
    waitUntil(promise) {
      work = Promise.resolve(promise);
    },
  });
  await work;

  assert.equal(harness.shown.length, 1);
  assert.equal(harness.shown[0].options.data.url, '/notifications');
  assert.equal(harness.shown[0].options.icon, '/icons/favicon-laranja.png');
  assert.equal(harness.shown[0].options.badge, '/icons/favicon-laranja.png');
});
