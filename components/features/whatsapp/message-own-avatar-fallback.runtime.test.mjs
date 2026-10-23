import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Actual Bubble/Media/Player and product CSS, with closed image/media transport.
// The existing bootstrap maps image URLs to data pixels and records their source.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-own-avatar-fallback-'));
const source = await readFile(join(repository, 'components/features/whatsapp/message-bubble-experience.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf("test('URL with @");
assert.ok(boundary > 0);
const bootstrap = source.slice(0, boundary)
  .replace(/import\s*\{([^}]*\bchromium\b[^}]*)\}\s*from\s*['"]@playwright\/test['"];?/, (_, names) => `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { ${names} } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace(/const baseline = [^;]+;/, "const baseline = 'D:/Vimob/tmp/whatsapp-avatar-reuse-20261014/root/baseline';")
  .replace("process.env.VIMOB_MAC_BUBBLE_BASELINE==='1'", "process.env.VIMOB_USER_AVATAR_BASELINE==='1'");
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {open,audioURL};`);
const { open, audioURL } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
after(async () => {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-own-avatar-fallback-/);
  await rm(target, { recursive: true, force: true });
});

const own = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const profilePhoto = 'https://avatar.synthetic.invalid/profile.png';
const summaryPhoto = 'https://avatar.synthetic.invalid/summary.png';
const leadPhoto = 'https://avatar.synthetic.invalid/lead.png';
const fixture = (values = {}) => ({
  messageType: 'audio', mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready', mediaError: null,
  fromMe: true, status: 'sent', senderUserId: own, viewerUserId: own, senderName: 'Autor sintético',
  viewerAvatarName: 'Perfil sintético', viewerAvatarUrl: profilePhoto, senderAvatarUserId: own,
  senderAvatarUrl: summaryPhoto, contactAvatarUrl: leadPhoto, contactAvatarFallbackUrl: leadPhoto, ...values,
});
const image = page => page.getByRole('button', { name: 'Avatar do audio', exact: true }).locator('img');
const actualSource = page => image(page).getAttribute('data-actual-src');
async function imageError(page) { await image(page).dispatchEvent('error'); }

for (const profile of [null, '', 'not-an-avatar-url']) test(`same persisted author uses the authorized summary when profile URL is ${JSON.stringify(profile)}`, async t => {
  const page = await open(t, fixture({ viewerAvatarUrl: profile }));
  assert.equal(await actualSource(page), summaryPhoto);
});

test('profile photo stays preferred, then image error falls back to the summary of the same author', async t => {
  const page = await open(t, fixture());
  assert.equal(await actualSource(page), profilePhoto);
  await imageError(page);
  await page.waitForFunction(expected => document.querySelector('[aria-label="Avatar do audio"] img')?.dataset.actualSrc === expected, summaryPhoto);
  assert.equal(await actualSource(page), summaryPhoto);
});

test('foreign summary cannot replace a missing viewer photo or a failed viewer image', async t => {
  const page = await open(t, fixture({ viewerAvatarUrl: null, senderAvatarUserId: other }));
  assert.equal(await image(page).count(), 0);
  await page.evaluate(props => h.render('bubble', props), fixture({ senderAvatarUserId: other }));
  assert.equal(await actualSource(page), profilePhoto);
  await imageError(page);
  assert.equal(await image(page).count(), 0);
});

test('missing author never borrows viewer, responsible-user summary or lead picture', async t => {
  const page = await open(t, fixture({ senderUserId: null }));
  assert.equal(await image(page).count(), 0);
  await page.evaluate(props => h.render('bubble', props), fixture({ senderUserId: 'invalid', senderAvatarUserId: 'invalid' }));
  assert.equal(await image(page).count(), 0);
});

test('another persisted author keeps their summary and never the viewer or lead image', async t => {
  const page = await open(t, fixture({ senderUserId: other, senderAvatarUserId: other }));
  assert.equal(await actualSource(page), summaryPhoto);
  await imageError(page);
  assert.equal(await image(page).count(), 0);
});

test('retiring the authorized summary removes the visible fallback immediately', async t => {
  const page = await open(t, fixture());
  await imageError(page);
  await page.waitForFunction(expected => document.querySelector('[aria-label="Avatar do audio"] img')?.dataset.actualSrc === expected, summaryPhoto);
  await page.evaluate(props => h.render('bubble', props), fixture({ viewerAvatarUrl: null, senderAvatarUrl: null, senderAvatarUserId: null }));
  assert.equal(await image(page).count(), 0);
});

test('a stale image error cannot switch the new author to the former fallback', async t => {
  const page = await open(t, fixture());
  await image(page).evaluate(node => { window.previousAvatar = node; });
  await page.evaluate(props => h.render('bubble', props), fixture({ senderUserId: other, senderAvatarUserId: other, senderAvatarUrl: leadPhoto }));
  await page.evaluate(() => window.previousAvatar.dispatchEvent(new Event('error')));
  assert.equal(await actualSource(page), leadPhoto);
});

test('received audio still uses only the lead candidate and its contact fallback', async t => {
  const page = await open(t, fixture({ fromMe: false, status: 'received', contactAvatarUrl: leadPhoto,
    contactAvatarFallbackUrl: 'https://avatar.synthetic.invalid/contact.png' }));
  assert.equal(await actualSource(page), leadPhoto);
  await imageError(page);
  assert.equal(await actualSource(page), 'https://avatar.synthetic.invalid/contact.png');
});
