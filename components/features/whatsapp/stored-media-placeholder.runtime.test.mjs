import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect } from '@playwright/test';

// Real Bubble, Media, visibility and URL hook; only caller/API/image bytes are
// synthetic. Every external request is blocked, including while visibility pauses.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-stored-placeholder-'));
const source = await readFile(join(repository, 'components/features/whatsapp/media-ui-runtime.test.mjs'), 'utf8');
const boundary = source.indexOf("test('viewer HTTP download failure"); assert.ok(boundary > 0);
const bootstrap = source.slice(0, boundary)
  .replace("import { chromium } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace('resolve: { extensions:', 'resolve: { symlinks: false, extensions:')
  .replace('}, { timeout: 90000 });', '}, { timeout: 300000 });');
assert.ok(!process.env.VIMOB_WHATSAPP_MEDIA_BASELINE && !process.env.VIMOB_MEDIA_DEEP_BASELINE && !process.env.VIMOB_FINAL_AUDIO_BASELINE, 'Current source fixtures cannot silently use historical baselines');
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {bundle,browser};`);
const fixture = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
let css;
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1sAAAAASUVORK5CYII=', 'base64');
const mediaURL = 'https://media.synthetic.invalid/storage/v1/object/sign/whatsapp-media/current.png';
before(async () => {
  const globals = (await readFile(join(repository, 'app/globals.css'), 'utf8')).replace('@import "tailwindcss";', '@import "tailwindcss" source(none);');
  css = (await require('postcss')([require('@tailwindcss/postcss')({ base: repository })]).process(`${globals}\n@source "${join(repository, 'components/features/whatsapp').replaceAll('\\', '/')}";\n@source "${join(repository, 'components/ui').replaceAll('\\', '/')}";`, { from: join(repository, 'app/stored-placeholder-fixture.css') })).css;
}, { timeout: 90000 });
after(async () => { const target = resolve(directory); assert.equal(dirname(target), resolve(tmpdir())); assert.match(basename(target), /^vimob-stored-placeholder-/); await rm(target, { recursive: true, force: true }); });
async function open(t, overrides = {}) {
  const page = await fixture.browser.newPage({ viewport: { width: 320, height: 800 } }); page.setDefaultTimeout(4000);
  const errors = [], external = [], images = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => { const url = route.request().url(); if (url === mediaURL) { images.push(url); return route.fulfill({ status: 200, body: png, contentType: 'image/png' }); } external.push(url); return route.abort(); });
  t.after(async () => { await page.close(); assert.deepEqual(errors, [], 'No uncaught browser failures'); assert.deepEqual(external, [], 'No external network'); });
  await page.setContent(`<style>${css}</style><main class="app-shell" style="padding:12px"><div id="root"></div></main>`);
  await page.evaluate(() => {
    window.process = { env: { NODE_ENV: 'development' } }; window.observers = [];
    window.IntersectionObserver = class {
      constructor(callback, options) { this.callback = callback; this.options = options; this.targets = []; this.disconnected = false; observers.push(this); }
      observe(target) { this.targets.push(target); }
      disconnect() { this.disconnected = true; }
      unobserve() {}
    };
    window.intersect = visible => { for (const observer of observers) if (!observer.disconnected) observer.callback(observer.targets.map(target => ({ target, isIntersecting: visible }))); };
  });
  await page.addScriptTag({ content: fixture.bundle });
  await page.evaluate(overrides => h.render('bubble', { content: 'Legenda sintética', mediaStatus: 'ready', mediaError: null, mediaUrl: null, storedMedia: true, messageId: 'stored-image-one', conversationSessionId: 'session-one', ...overrides }), overrides);
  await page.waitForFunction(() => observers.some(observer => observer.targets.length > 0));
  return { page, images };
}
const waiting = page => page.getByRole('status').filter({ hasText: 'Abrindo mídia armazenada...' });
async function observe(page, visible) { await page.evaluate(visible => intersect(visible), visible); }
async function noFalseFailure(page) { await expect(page.getByText('Mídia não disponível', { exact: true })).toHaveCount(0); await expect(page.getByText('Mídia demorando para chegar', { exact: true })).toHaveCount(0); }

test('stored ready media waits outside the observed viewport without GET or a false failure', async t => {
  const { page, images } = await open(t); await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(waiting(page)).toBeVisible(); await noFalseFailure(page);
  await expect(waiting(page).locator('.animate-spin')).toHaveCSS('animation-name', 'none');
  assert.equal(await page.evaluate(() => h.requests.length), 0); assert.equal(images.length, 0);
  await observe(page, false); await page.waitForTimeout(60); await noFalseFailure(page); await expect(waiting(page)).toBeVisible();
  assert.equal(await page.evaluate(() => h.requests.length), 0);
});

test('visibility pauses a pending stored read without claiming failure; returning resolves one current image', async t => {
  const { page, images } = await open(t); await observe(page, true); await page.waitForFunction(() => h.requests.length === 1); await expect(waiting(page)).toBeVisible();
  await observe(page, false); await page.waitForFunction(() => h.requests[0].options.signal.aborted); await page.evaluate(() => h.requests[0].reject(new DOMException('Paused', 'AbortError')));
  await noFalseFailure(page); await expect(waiting(page)).toBeVisible(); assert.equal(images.length, 0);
  await observe(page, true); await page.waitForFunction(() => h.requests.length === 2); await noFalseFailure(page);
  await page.evaluate(url => h.requests[1].resolve({ url, expiresIn: 60 }), mediaURL);
  await expect(page.locator('[data-message-media-frame="image"] img')).toHaveAttribute('src', mediaURL); await expect(page.locator('[data-message-media-frame="image"] img')).toBeVisible(); await expect(waiting(page)).toHaveCount(0); await noFalseFailure(page);
  assert.equal(images.length, 1); assert.equal(await page.evaluate(() => h.requests.length), 2);
});

test('a real stored URL failure becomes explicit and retries only after a deliberate action', async t => {
  const { page } = await open(t); await observe(page, true); await page.waitForFunction(() => h.requests.length === 1);
  await page.evaluate(() => h.requests[0].reject(new Error('Synthetic storage failure')));
  await expect(page.getByText('Mídia não disponível', { exact: true })).toBeVisible(); await expect(waiting(page)).toHaveCount(0);
  await expect(page.getByText('Não foi possível abrir a mídia. Tente atualizar o link.', { exact: true })).toBeVisible();
  await observe(page, false); await observe(page, true); await page.waitForTimeout(60); assert.equal(await page.evaluate(() => h.requests.length), 1);
  await page.getByRole('button', { name: 'Tentar novamente', exact: true }).click(); await page.waitForFunction(() => h.requests.length === 2); await expect(waiting(page)).toBeVisible();
});

test('a durable capture failure remains a failure even before the visibility observer requests a URL', async t => {
  const { page } = await open(t, { mediaStatus: 'failed', mediaError: 'Falha de captura sintética' });
  await expect(page.getByText('Mídia não disponível', { exact: true })).toBeVisible(); await expect(page.getByText('Falha de captura sintética', { exact: true })).toBeVisible(); await expect(waiting(page)).toHaveCount(0);
  assert.equal(await page.evaluate(() => h.requests.length), 0);
});
