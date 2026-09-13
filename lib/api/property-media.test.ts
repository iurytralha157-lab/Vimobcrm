import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PropertyMediaPersistenceError,
  persistStagedPropertyPhotosWithClient,
} from '../property-media-persistence'
import { stagePropertyPhoto } from '../property-media-draft'
import type { PropertyWorkspaceAsset } from '../validation/property-workspace'

const ORGANIZATION_ID = '11111111-1111-4111-8111-111111111111'
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222'

function file(name: string) {
  return { name, size: 1_024, type: 'image/jpeg' } as File
}

function asset(id: string, sortOrder: number): PropertyWorkspaceAsset {
  return {
    id,
    organization_id: ORGANIZATION_ID,
    property_id: PROPERTY_ID,
    asset_type: 'photo',
    visibility: 'public',
    storage_path: `orgs/${ORGANIZATION_ID}/properties/${PROPERTY_ID}/${id}/photo.jpg`,
    external_url: null,
    title: null,
    description: null,
    file_name: 'photo.jpg',
    mime_type: 'image/jpeg',
    file_size_bytes: 1_024,
    sort_order: sortOrder,
    is_primary: sortOrder === 0,
    document_category: null,
    expires_at: null,
    metadata: {},
    created_at: '2026-09-07T12:00:00Z',
    updated_at: '2026-09-07T12:00:00Z',
  }
}

test('property media persistence limits concurrency and maps primary/internal photos', async () => {
  const previews = Array.from({ length: 5 }, (_, index) =>
    stagePropertyPhoto(file(`photo-${index}.jpg`), () => `blob:photo-${index}`),
  )
  let active = 0
  let maximumActive = 0
  const createInputs: Array<Record<string, unknown>> = []
  const client = {
    async uploadAssetFile() {
      active += 1
      maximumActive = Math.max(maximumActive, active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active -= 1
      return { storage_path: `path-${createInputs.length}`, bucket: 'property-private', token: 'token', signed_url: 'https://upload.test', expires_at: '2026-09-07T14:00:00Z' }
    },
    async createAsset(_organizationId: string, _propertyId: string, input: Record<string, unknown>) {
      createInputs.push(input)
      return asset(`00000000-0000-4000-8000-00000000000${createInputs.length}`, Number(input.sort_order))
    },
    async deleteAsset() { return { id: PROPERTY_ID } },
    async discardAssetUpload() { return { storage_path: 'path' } },
  }

  const result = await persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
    mainImage: previews[0],
    galleryImages: previews.slice(1),
    hiddenSiteImages: [previews[2]],
  }, client)

  assert.equal(maximumActive, 3)
  assert.equal(result.length, 5)
  assert.equal(createInputs.find((input) => input.sort_order === 0)?.is_primary, true)
  assert.equal(createInputs.find((input) => input.sort_order === 2)?.visibility, 'internal')
})

test('a single gallery photo becomes the canonical primary asset', async () => {
  const preview = stagePropertyPhoto(file('only.jpg'), () => 'blob:only-photo')
  const createInputs: Array<Record<string, unknown>> = []
  const client = {
    async uploadAssetFile() {
      return { storage_path: 'only.jpg' }
    },
    async createAsset(_organizationId: string, _propertyId: string, input: Record<string, unknown>) {
      createInputs.push(input)
      return asset('00000000-0000-4000-8000-000000000020', Number(input.sort_order))
    },
    async deleteAsset() { return { id: PROPERTY_ID } },
    async discardAssetUpload() { return { storage_path: 'only.jpg' } },
  }

  const result = await persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
    mainImage: '',
    galleryImages: [preview],
  }, client)

  assert.equal(result.length, 1)
  assert.equal(createInputs[0]?.sort_order, 0)
  assert.equal(createInputs[0]?.is_primary, true)
  assert.equal(createInputs[0]?.visibility, 'public')
})

test('property media persistence still rejects more than twenty unique photos', async () => {
  const previews = Array.from({ length: 21 }, (_, index) =>
    stagePropertyPhoto(file(`limit-${index}.jpg`), () => `blob:limit-${index}`),
  )
  let uploadCalls = 0
  const client = {
    async uploadAssetFile() {
      uploadCalls += 1
      return { storage_path: 'unexpected.jpg' }
    },
    async createAsset() { return asset('00000000-0000-4000-8000-000000000021', 0) },
    async deleteAsset() { return { id: PROPERTY_ID } },
    async discardAssetUpload() { return { storage_path: 'unexpected.jpg' } },
  }

  await assert.rejects(
    persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
      mainImage: previews[0],
      galleryImages: previews.slice(1),
    }, client),
    /no máximo 20 fotos/,
  )
  assert.equal(uploadCalls, 0)
})

test('property media persistence compensates completed assets after a batch failure', async () => {
  const previews = [
    stagePropertyPhoto(file('one.jpg'), () => 'blob:rollback-one'),
    stagePropertyPhoto(file('two.jpg'), () => 'blob:rollback-two'),
  ]
  const deleted: string[] = []
  const discarded: string[] = []
  let created = 0
  const client = {
    async uploadAssetFile(_organizationId: string, _propertyId: string, _type: 'photo', selected: File) {
      return { storage_path: selected.name, bucket: 'property-private', token: 'token', signed_url: 'https://upload.test', expires_at: '2026-09-07T14:00:00Z' }
    },
    async createAsset(_organizationId: string, _propertyId: string, input: Record<string, unknown>) {
      created += 1
      if (input.file_name === 'two.jpg') throw new Error('database failed')
      return asset('00000000-0000-4000-8000-000000000001', Number(input.sort_order))
    },
    async deleteAsset(_organizationId: string, _propertyId: string, assetId: string) {
      deleted.push(assetId)
      return { id: assetId }
    },
    async discardAssetUpload(_organizationId: string, _propertyId: string, input: { storage_path: string }) {
      discarded.push(input.storage_path)
      return input
    },
  }

  await assert.rejects(
    persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
      mainImage: previews[0],
      galleryImages: [previews[1]],
    }, client),
    /database failed/,
  )
  assert.equal(created, 2)
  assert.deepEqual(deleted, ['00000000-0000-4000-8000-000000000001'])
  assert.deepEqual(discarded, ['two.jpg'])
})

test('property media rollback removes gallery assets before the primary photo', async () => {
  const previews = [
    stagePropertyPhoto(file('main.jpg'), () => 'blob:rollback-order-main'),
    stagePropertyPhoto(file('gallery.jpg'), () => 'blob:rollback-order-gallery'),
    stagePropertyPhoto(file('failed.jpg'), () => 'blob:rollback-order-failed'),
  ]
  const deletedSortOrders: number[] = []
  const assetsByID = new Map<string, PropertyWorkspaceAsset>()
  const client = {
    async uploadAssetFile(_organizationId: string, _propertyId: string, _type: 'photo', selected: File) {
      return { storage_path: selected.name }
    },
    async createAsset(_organizationId: string, _propertyId: string, input: Record<string, unknown>) {
      if (input.file_name === 'failed.jpg') {
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw new Error('database failed')
      }
      const created = asset(
        `00000000-0000-4000-8000-00000000001${Number(input.sort_order)}`,
        Number(input.sort_order),
      )
      assetsByID.set(created.id, created)
      return created
    },
    async deleteAsset(_organizationId: string, _propertyId: string, assetId: string) {
      deletedSortOrders.push(assetsByID.get(assetId)?.sort_order ?? -1)
      return { id: assetId }
    },
    async discardAssetUpload() {
      return { storage_path: 'failed.jpg' }
    },
  }

  await assert.rejects(
    persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
      mainImage: previews[0],
      galleryImages: previews.slice(1),
    }, client),
    /database failed/,
  )
  assert.deepEqual(deletedSortOrders, [1, 0])
})

test('property media persistence reports an incomplete compensating rollback', async () => {
  const previews = [
    stagePropertyPhoto(file('saved.jpg'), () => 'blob:rollback-saved'),
    stagePropertyPhoto(file('failed.jpg'), () => 'blob:rollback-failed'),
  ]
  const client = {
    async uploadAssetFile(_organizationId: string, _propertyId: string, _type: 'photo', selected: File) {
      return { storage_path: selected.name }
    },
    async createAsset(_organizationId: string, _propertyId: string, input: Record<string, unknown>) {
      if (input.file_name === 'failed.jpg') throw new Error('database failed')
      return asset('00000000-0000-4000-8000-000000000009', Number(input.sort_order))
    },
    async deleteAsset() {
      throw new Error('rollback unavailable')
    },
    async discardAssetUpload() { return { storage_path: 'failed.jpg' } },
  }

  await assert.rejects(
    persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
      mainImage: previews[0],
      galleryImages: [previews[1]],
    }, client),
    (error: unknown) => {
      assert.equal(error instanceof PropertyMediaPersistenceError, true)
      const persistenceError = error as PropertyMediaPersistenceError
      assert.equal(persistenceError.rollbackIncomplete, true)
      assert.deepEqual(persistenceError.rollbackFailedAssetIds, [
        '00000000-0000-4000-8000-000000000009',
      ])
      assert.match(persistenceError.message, /database failed/)
      return true
    },
  )
})

test('property media persistence reports an upload object that could not be discarded', async () => {
  const preview = stagePropertyPhoto(file('orphan.jpg'), () => 'blob:rollback-orphan')
  const client = {
    async uploadAssetFile() {
      return { storage_path: 'pending/orphan.jpg' }
    },
    async createAsset() {
      throw new Error('database failed')
    },
    async deleteAsset() {
      return { id: PROPERTY_ID }
    },
    async discardAssetUpload() {
      throw new Error('storage cleanup unavailable')
    },
  }

  await assert.rejects(
    persistStagedPropertyPhotosWithClient(ORGANIZATION_ID, PROPERTY_ID, {
      mainImage: preview,
      galleryImages: [],
    }, client),
    (error: unknown) => {
      assert.equal(error instanceof PropertyMediaPersistenceError, true)
      const persistenceError = error as PropertyMediaPersistenceError
      assert.equal(persistenceError.rollbackIncomplete, true)
      assert.deepEqual(persistenceError.rollbackFailedAssetIds, [])
      assert.deepEqual(persistenceError.rollbackFailedUploadPaths, [
        'pending/orphan.jpg',
      ])
      return true
    },
  )
})
