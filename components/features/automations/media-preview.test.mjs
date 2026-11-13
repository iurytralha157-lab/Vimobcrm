import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutomationMediaPreviewIndex, restoreAutomationMediaPath, withAutomationMediaPreview } from './media-preview.ts';

const organization = '10000000-0000-4000-8000-000000000001';
const storage = 'https://storage.example.test';

test('recovers canonical paths from known legacy Storage routes without retaining the URL token', () => {
  for (const [type, folder, file] of [
    ['image', 'images', 'uma foto.png'],
    ['audio', 'audios', 'voz.ogg'],
    ['video', 'videos', 'vídeo.mp4'],
  ]) {
    const path = `${organization}/${folder}/${file}`;
    for (const route of ['/object/sign/', '/storage/v1/object/sign/', '/storage/v1/object/public/', '/storage/v1/object/authenticated/']) {
      const legacy = `${storage}${route}automation-media/${organization}/${folder}/${encodeURIComponent(file)}?token=expired`;
      const restored = restoreAutomationMediaPath('', legacy, organization, type, storage);
      assert.equal(restored, path);
      const index = createAutomationMediaPreviewIndex([{ path, publicUrl: 'https://storage.example.test/fresh-signed-preview' }]);
      const node = { type, data: { media_path: restored } };
      assert.equal(withAutomationMediaPreview(node, index).data[`${type}_preview_url`], 'https://storage.example.test/fresh-signed-preview');
      assert.deepEqual(node.data, { media_path: path });
    }
  }
});

test('rejects foreign origins, tenants, folders and noncanonical legacy paths', () => {
  const route = '/storage/v1/object/sign/automation-media/';
  for (const legacy of [
    `https://external.example.test${route}${organization}/images/photo.png`,
    `${storage}/another-page/automation-media/${organization}/images/photo.png`,
    `${storage}${route}10000000-0000-4000-8000-000000000002/images/photo.png`,
    `${storage}${route}${organization}/videos/photo.png`,
    `${storage}${route}${organization}/images/other%2Fphoto.png`,
    `${storage}${route}${organization}/images/photo%5Cname.png`,
    `${storage}${route}${organization}/images/photo%00.png`,
  ]) {
    assert.equal(restoreAutomationMediaPath('', legacy, organization, 'image', storage), '');
  }
});

test('uses the saved path first and keeps its original metadata when a preview is not in the gallery page', () => {
  const savedPath = `${organization}/images/current.png`;
  assert.equal(restoreAutomationMediaPath(savedPath, '', organization, 'image', storage), savedPath);
  assert.equal(restoreAutomationMediaPath(`${organization}/videos/wrong-type.mp4`, '', organization, 'image', storage), '');
  const node = { type: 'image', data: { media_path: savedPath, legacy_media_reference: true } };
  assert.equal(withAutomationMediaPreview(node, new Map()), node);
});
