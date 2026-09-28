import assert from 'node:assert/strict'
import test from 'node:test'

import { firstPublicationPreviewImages } from './preview-images'

type PreviewAsset = Parameters<typeof firstPublicationPreviewImages>[0][number]

function photo(overrides: Partial<PreviewAsset> = {}): PreviewAsset {
  return {
    id: 'a',
    asset_type: 'photo',
    visibility: 'public',
    storage_path: 'organizations/tenant/private/photo.jpg',
    access_url: 'https://storage.example/signed/photo?token=short-lived',
    external_url: null,
    is_primary: false,
    sort_order: 1,
    ...overrides,
  }
}

test('first publication previews only public canonical photos with safe access URLs', () => {
  const images = firstPublicationPreviewImages([
    photo({ id: 'secondary', access_url: 'https://storage.example/signed/secondary?token=short-lived', sort_order: 2 }),
    photo({ id: 'private', visibility: 'internal', access_url: 'https://storage.example/signed/private?token=short-lived' }),
    photo({ id: 'confidential', visibility: 'confidential', access_url: 'https://storage.example/signed/confidential?token=short-lived' }),
    photo({ id: 'unavailable', access_url: null, external_url: 'https://cdn.example/stale.jpg' }),
    photo({ id: 'primary', access_url: 'https://storage.example/signed/primary?token=short-lived', is_primary: true, sort_order: 9 }),
    photo({ id: 'document', asset_type: 'document', access_url: 'https://storage.example/signed/document?token=short-lived' }),
  ], true, null)

  assert.deepEqual(images, [
    'https://storage.example/signed/primary?token=short-lived',
    'https://storage.example/signed/secondary?token=short-lived',
  ])
  assert.ok(!JSON.stringify(images).includes('organizations/tenant/private'))
})

test('public external photos can preview without a Storage object', () => {
  const images = firstPublicationPreviewImages([
    photo({ id: 'external', storage_path: null, access_url: null, external_url: 'https://cdn.example/fachada.jpg' }),
    photo({ id: 'unsafe', storage_path: null, access_url: null, external_url: 'https://user:password@cdn.example/unsafe.jpg' }),
  ], true, null)
  assert.deepEqual(images, ['https://cdn.example/fachada.jpg'])
})

test('published versions keep their frozen server preview; missing canonical access does not expose legacy photos', () => {
  const assets = [photo({ access_url: null })]
  assert.equal(firstPublicationPreviewImages(assets, true, 1), undefined)
  assert.equal(firstPublicationPreviewImages(assets, false, null), undefined)
  assert.deepEqual(firstPublicationPreviewImages(assets, true, null), [])
})
