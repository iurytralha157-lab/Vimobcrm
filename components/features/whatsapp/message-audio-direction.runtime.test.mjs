import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Reuse the existing real Bubble/Player and product-CSS bootstrap only.
// No central test is edited or registered here; API, image fetch and playback
// stay closed synthetic fixtures. This is Chromium, not a user's WhatsApp.
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'vimob-outgoing-audio-'));
const source = await readFile(join(repository, 'components/features/whatsapp/message-bubble-experience.runtime.test.mjs'), 'utf8');
const boundary = source.indexOf("test('URL with @");
assert.ok(boundary > 0, 'Existing closed Bubble bootstrap boundary is present');
let bootstrap = source.slice(0, boundary)
  .replace("import { chromium, expect } from '@playwright/test';", `import playwright from ${JSON.stringify(pathToFileURL(require.resolve('@playwright/test')).href)}; const { chromium, expect } = playwright;`)
  .replace('const require = createRequire(import.meta.url);', `const require = createRequire(${JSON.stringify(join(repository, 'package.json'))});`)
  .replace("const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');", `const repository = ${JSON.stringify(repository)};`)
  .replace(/const baseline = [^;]+;/, "const baseline = 'D:/Vimob/tmp/whatsapp-outgoing-audio-20261014/before';")
  .replace("process.env.VIMOB_MAC_BUBBLE_BASELINE==='1'", "process.env.VIMOB_OUTGOING_AUDIO_BASELINE==='1'")
  .replace('candidate=path.join(${JSON.stringify(baseline)},rel);', "candidate=path.join(${JSON.stringify(baseline)},rel.split(path.sep).join('__')+'.before');");
assert.ok(bootstrap.includes('VIMOB_OUTGOING_AUDIO_BASELINE'));
await writeFile(join(directory, 'bootstrap.mjs'), `${bootstrap}\nexport {open,audioURL};`);
const { open, audioURL } = await import(pathToFileURL(join(directory, 'bootstrap.mjs')).href);
after(async () => {
  const target = resolve(directory);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.match(basename(target), /^vimob-outgoing-audio-/);
  await rm(target, { recursive: true, force: true });
});

const ownId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const peerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const otherId = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const ownPhoto = 'https://example.test/synthetic-own-avatar.png';
const nextOwnPhoto = 'https://example.test/synthetic-own-avatar-updated.png';
const peerPhoto = 'https://example.test/synthetic-peer-avatar.png';
const leadPhoto = 'https://example.test/synthetic-lead-avatar.png';
const fixture = (values = {}) => ({
  messageType: 'audio', content: null, mediaUrl: audioURL, mediaMimeType: 'audio/wav', mediaStatus: 'ready',
  mediaError: null, fromMe: true, status: 'sent', senderUserId: ownId, senderName: 'André sintético',
  viewerUserId: ownId, viewerAvatarUrl: ownPhoto, viewerAvatarName: 'André perfil sintético',
  leadName: 'Lead sintético', contactAvatarUrl: leadPhoto, ...values,
});
async function render(page, values) {
  await page.evaluate(props => window.h.render('bubble', props), fixture(values));
}
async function avatarSource(page) {
  return page.getByRole('button', { name: 'Avatar do audio', exact: true }).locator('img').getAttribute('data-actual-src');
}

test('outgoing audio has sender avatar then play and waveform, with the original subdued message clock at the right end', async t => {
  const page = await open(t, fixture());
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    for (const compact of [true, false]) {
      await render(page, { compact });
      assert.equal(await page.getByRole('button', { name: 'Avatar do audio', exact: true }).getAttribute('title'), 'André Perfil Sintético');
      const avatar = await page.getByRole('button', { name: 'Avatar do audio', exact: true }).boundingBox();
      const play = await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).boundingBox();
      const wave = await page.getByRole('slider', { name: 'Posição do áudio', exact: true }).boundingBox();
      assert.ok(avatar && play && wave);
      assert.ok(avatar.x + avatar.width <= play.x, 'sender avatar precedes play');
      assert.ok(play.x + play.width <= wave.x, 'play precedes the normal waveform');
      const metadata = page.locator('[data-message-timestamp-position]');
      assert.equal(await metadata.count(), 1);
      assert.equal(await metadata.getAttribute('data-message-timestamp-position'), 'bottom-right');
      const clock = await metadata.boundingBox();
      assert.ok(clock && clock.x + clock.width >= wave.x + wave.width - 1, 'clock ends at the waveform right edge');
      const outgoingColor = await page.evaluate(() => {
        const reference = document.createElement('span'); reference.className = 'text-primary-foreground/60';
        document.body.append(reference); const value = getComputedStyle(reference).color; reference.remove(); return value;
      });
      assert.deepEqual(await metadata.locator('span').last().evaluate(node => {
        const style = getComputedStyle(node); return { color: style.color, size: style.fontSize };
      }), { color: outgoingColor, size: '10px' });
      assert.equal(await page.getByRole('img', { name: 'Mensagem enviada', exact: true }).count(), 1);
      assert.equal(await avatarSource(page), ownPhoto);
    }
  }
});

test('incoming audio keeps play waveform lead avatar and its existing left clock styling', async t => {
  const page = await open(t, fixture({ fromMe: false, status: 'received', senderName: 'Contato sintético' }));
  const play = await page.getByRole('button', { name: 'Reproduzir áudio', exact: true }).boundingBox();
  const wave = await page.getByRole('slider', { name: 'Posição do áudio', exact: true }).boundingBox();
  const avatar = await page.getByRole('button', { name: 'Avatar do audio', exact: true }).boundingBox();
  assert.ok(play && wave && avatar);
  assert.ok(play.x + play.width <= wave.x);
  assert.ok(wave.x + wave.width <= avatar.x);
  assert.equal(await avatarSource(page), leadPhoto);
  const metadata = page.locator('[data-message-timestamp-position]');
  assert.equal(await metadata.count(), 1);
  assert.equal(await metadata.getAttribute('data-message-timestamp-position'), 'bottom-left');
  const expected = await page.evaluate(() => {
    const reference = document.createElement('span'); reference.style.color = 'var(--app-text-tertiary)';
    document.body.append(reference); const value = getComputedStyle(reference).color; reference.remove(); return value;
  });
  assert.equal(await metadata.evaluate(node => getComputedStyle(node).color), expected);
  assert.equal(await page.getByRole('img', { name: 'Mensagem enviada', exact: true }).count(), 0);
});

test('another CRM author uses only the avatar whose supplied subject matches the canonical author', async t => {
  const page = await open(t, fixture({ senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId: peerId.toUpperCase(), senderAvatarUrl: peerPhoto }));
  assert.equal(await avatarSource(page), peerPhoto);
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).getAttribute('title'), 'Bruno Sintético');
});

test('unknown account-side author never borrows viewer or lead photos or profile identity', async t => {
  const page = await open(t, fixture({ senderUserId: null, senderName: null, senderAvatarUserId: ownId, senderAvatarUrl: ownPhoto }));
  const avatar = page.getByRole('button', { name: 'Avatar do audio' });
  assert.equal(await avatar.locator('img').count(), 0);
  assert.equal(await avatar.getAttribute('title'), 'Conta do WhatsApp');
  assert.equal(await avatar.innerText(), 'C');
});

test('a mismatched or invalid avatar subject fails closed to the recorded author initial', async t => {
  const page = await open(t, fixture({ senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId: otherId, senderAvatarUrl: peerPhoto }));
  for (const senderAvatarUserId of [otherId, 'peer-not-a-uuid', null]) {
    await render(page, { senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId, senderAvatarUrl: peerPhoto });
    const avatar = page.getByRole('button', { name: 'Avatar do audio' });
    assert.equal(await avatar.locator('img').count(), 0);
    assert.equal(await avatar.innerText(), 'B');
  }
  await render(page, { senderUserId: 'peer-not-a-uuid', senderName: 'Bruno sintético', senderAvatarUserId: peerId, senderAvatarUrl: peerPhoto });
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).locator('img').count(), 0);
});

test('avatar URIs still pass the existing media validator even when the author matches', async t => {
  const page = await open(t, fixture({ senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId: peerId, senderAvatarUrl: 'javascript:window.avatarInjected=true' }));
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).locator('img').count(), 0);
  assert.equal(await page.evaluate(() => window.avatarInjected), undefined);
});

test('memo updates a changed viewer photo and removes it immediately when the viewer identity changes', async t => {
  const page = await open(t, fixture());
  assert.equal(await avatarSource(page), ownPhoto);
  await render(page, { viewerAvatarUrl: nextOwnPhoto, viewerAvatarName: 'Nome atualizado sintético' });
  assert.equal(await avatarSource(page), nextOwnPhoto);
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).getAttribute('title'), 'Nome Atualizado Sintético');
  await render(page, { viewerUserId: otherId });
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).locator('img').count(), 0);
});

test('memo revalidates an unchanged cached photo when its supplied author identity changes', async t => {
  const page = await open(t, fixture({ senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId: peerId, senderAvatarUrl: peerPhoto }));
  assert.equal(await avatarSource(page), peerPhoto);
  await render(page, { senderUserId: peerId, senderName: 'Bruno sintético', senderAvatarUserId: otherId, senderAvatarUrl: peerPhoto });
  assert.equal(await page.getByRole('button', { name: 'Avatar do audio' }).locator('img').count(), 0);
});
