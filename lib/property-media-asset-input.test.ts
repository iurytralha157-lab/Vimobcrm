import assert from 'node:assert/strict'
import test from 'node:test'

import { buildPropertyAssetCommonInput } from './property-media-asset-input'

test('an external URL keeps internal channel visibility in the asset payload', () => {
  const payload = {
    ...buildPropertyAssetCommonInput({
      assetType: 'photo',
      visibility: 'internal',
      title: 'Foto de vistoria',
      description: '',
      documentCategory: '',
      expiresAt: '',
    }),
    external_url: 'https://cdn.example.test/vistoria.jpg',
    storage_path: null,
    sort_order: 0,
    is_primary: false,
  }

  assert.equal(payload.visibility, 'internal')
  assert.equal(payload.external_url, 'https://cdn.example.test/vistoria.jpg')
})
