import assert from 'node:assert/strict'
import test from 'node:test'

import {
  releaseConfirmedPropertyAssetSortOrders,
  reserveNextPropertyAssetSortOrder,
} from './property-asset-order'

test('consecutive asset creations reserve distinct positions while workspace data is stale', () => {
  const staleAssets = [{ asset_type: 'photo', sort_order: 0 }]
  const nextByType = new Map<string, number>()

  assert.equal(reserveNextPropertyAssetSortOrder(staleAssets, 'photo', nextByType), 1)
  assert.equal(reserveNextPropertyAssetSortOrder(staleAssets, 'photo', nextByType), 2)
  assert.equal(reserveNextPropertyAssetSortOrder(staleAssets, 'document', nextByType), 0)
  assert.equal(reserveNextPropertyAssetSortOrder([
    ...staleAssets,
    { asset_type: 'photo', sort_order: 5 },
  ], 'photo', nextByType), 6)
})

test('confirmed orders release the reservation so deletion can reuse a free position', () => {
  const nextByType = new Map<string, number>()
  const initial = [{ asset_type: 'photo', sort_order: 0 }]
  assert.equal(reserveNextPropertyAssetSortOrder(initial, 'photo', nextByType), 1)
  releaseConfirmedPropertyAssetSortOrders(initial, nextByType)
  assert.equal(nextByType.get('photo'), 2)

  const confirmed = [...initial, { asset_type: 'photo', sort_order: 1 }]
  releaseConfirmedPropertyAssetSortOrders(confirmed, nextByType)
  assert.equal(nextByType.has('photo'), false)
  assert.equal(reserveNextPropertyAssetSortOrder(initial, 'photo', nextByType), 1)
})
