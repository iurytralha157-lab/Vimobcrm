import assert from 'node:assert/strict'
import test from 'node:test'

const previewPath = './property-asset-preview.ts'
const { getAssetPreviewSource } = await import(previewPath)

test('fotos protegidas usam apenas a URL assinada do visualizador autorizado', () => {
  assert.equal(getAssetPreviewSource({
    asset_type: 'photo',
    visibility: 'confidential',
    access_url: 'https://storage.example.com/object/sign/photo.jpg?token=abc',
    external_url: 'https://external.example.com/photo.jpg',
  }), 'https://storage.example.com/object/sign/photo.jpg?token=abc')
})

test('link externo interno nunca é solicitado para a prévia', () => {
  assert.equal(getAssetPreviewSource({
    asset_type: 'photo',
    visibility: 'internal',
    access_url: null,
    external_url: 'https://external.example.com/photo.jpg',
  }), null)
})

test('foto pública externa tem prévia e arquivo que não é foto não tem', () => {
  const publicAsset = {
    asset_type: 'photo' as const,
    visibility: 'public' as const,
    access_url: null,
    external_url: 'https://external.example.com/photo.jpg',
  }
  assert.equal(getAssetPreviewSource(publicAsset), publicAsset.external_url)
  assert.equal(getAssetPreviewSource({ ...publicAsset, asset_type: 'document' }), null)
})
