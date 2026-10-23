import assert from 'node:assert/strict'
import test from 'node:test'
import { createPropertyAssetWithRecovery } from './property-asset-create-recovery'
import type { PropertyWorkspaceAsset } from '@/lib/validation/property-workspace'

const actorId = '10000000-0000-4000-8000-000000000001'
const organizationId = '20000000-0000-4000-8000-000000000001'
const propertyId = '30000000-0000-4000-8000-000000000001'
const file = new File(['synthetic-file-bytes'], 'photo.jpg', { type: 'image/jpeg' })

function fixture() {
  const rows = new Map<string, string>()
  const storage = { getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => { rows.set(key, value) }, removeItem: (key: string) => { rows.delete(key) } }
  const assets: PropertyWorkspaceAsset[] = []
  const state = { uploads: 0, creates: 0, discards: 0, commitLoseResponse: false, failBeforeCommit: false,
    reconciliationUnavailable: false, current: true }
  const client = {
    async getWorkspace() {
      if (state.reconciliationUnavailable) throw new Error('GET timeout')
      return { data: { assets } }
    },
    async uploadAssetFile() { state.uploads++; return { storage_path: `${organizationId}/${propertyId}/photo-${state.uploads}.jpg` } },
    async createAsset(_org: string, _property: string, input: Parameters<typeof createPropertyAssetWithRecovery>[0]['input']) {
      state.creates++
      if (state.failBeforeCommit) throw new Error('POST response unknown')
      const fullInput = input as Parameters<typeof createPropertyAssetWithRecovery>[0]['input'] & { storage_path: string }
      const asset: PropertyWorkspaceAsset = {
        id: `40000000-0000-4000-8000-${String(assets.length + 1).padStart(12, '0')}`, organization_id: organizationId,
        property_id: propertyId, asset_type: 'photo', visibility: 'public', storage_path: fullInput.storage_path,
        external_url: null, title: 'Original title', description: null, file_name: file.name, mime_type: file.type,
        file_size_bytes: file.size, sort_order: 0, is_primary: true, document_category: null, expires_at: null,
        metadata: {}, created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
      }
      assets.push(asset)
      if (state.commitLoseResponse) throw new Error('Lost POST response after commit')
      return asset
    },
    async discardAssetUpload() { state.discards++ },
  }
  const run = (otherScope: { actor?: string; organization?: string; property?: string } = {}) => createPropertyAssetWithRecovery({
    client, organizationId: otherScope.organization ?? organizationId, propertyId: otherScope.property ?? propertyId,
    input: { asset_type: 'photo', visibility: 'public', title: 'Original title' }, file, storage,
    execution: { expectedUserId: otherScope.actor ?? actorId, canContinue: () => state.current },
  })
  return { state, assets, rows, client, storage, run }
}

test('lost response after commit reconciles one asset without another upload or discard', async () => {
  const f = fixture(); f.state.commitLoseResponse = true
  const asset = await f.run()
  assert.equal(asset.id, f.assets[0].id)
  assert.equal(f.assets.length, 1); assert.equal(f.state.uploads, 1); assert.equal(f.state.creates, 1)
  assert.equal(f.state.discards, 0); assert.equal(f.rows.size, 0)
})

test('failed reconciliation survives dialog remount/reload and resolves the original committed path', async () => {
  const f = fixture(); f.state.commitLoseResponse = true; f.state.reconciliationUnavailable = true
  await assert.rejects(f.run())
  assert.equal(f.rows.size, 1)
  f.state.reconciliationUnavailable = false
  const asset = await f.run()
  assert.equal(asset.id, f.assets[0].id)
  assert.equal(f.assets.length, 1); assert.equal(f.state.uploads, 1); assert.equal(f.state.creates, 1)
  assert.equal(f.state.discards, 0); assert.equal(f.rows.size, 0)
})

test('unknown POST before commit retries the immutable path without uploading again', async () => {
  const f = fixture(); f.state.failBeforeCommit = true
  await assert.rejects(f.run())
  assert.equal(f.state.discards, 0); assert.equal(f.rows.size, 1)
  const original = JSON.parse([...f.rows.values()][0]).input
  f.state.failBeforeCommit = false
  await f.run()
  assert.equal(f.state.uploads, 1); assert.equal(f.assets.length, 1)
  assert.equal(f.assets[0].storage_path, original.storage_path)
})

test('durable-record failure prevents a create POST and compensates only the uncommitted upload', async () => {
  const f = fixture(); f.storage.setItem = () => { throw new Error('Storage quota exceeded') }
  await assert.rejects(f.run(), /quota/)
  assert.equal(f.state.creates, 0); assert.equal(f.state.discards, 1); assert.equal(f.assets.length, 0)
})

test('corrupt nonempty intent fails closed instead of uploading a duplicate', async () => {
  const f = fixture(); f.state.failBeforeCommit = true; await assert.rejects(f.run())
  const key = [...f.rows.keys()][0]; f.rows.set(key, 'corrupt')
  await assert.rejects(f.run(), /inválido/)
  assert.equal(f.state.uploads, 1); assert.equal(f.state.creates, 1)
})

test('actor and tenant recovery keys do not reuse another scope pending body', async () => {
  const f = fixture(); f.state.failBeforeCommit = true; await assert.rejects(f.run())
  await assert.rejects(f.run({ actor: 'another-actor', organization: 'another-org', property: 'another-property' }))
  assert.equal(f.state.uploads, 2); assert.equal(f.rows.size, 2)
})

test('scope loss during reconciliation preserves the path and does not discard or retry the POST', async () => {
  const f = fixture(); f.state.failBeforeCommit = true
  f.client.getWorkspace = async () => { f.state.current = false; return { data: { assets: [] } } }
  await assert.rejects(f.run())
  assert.equal(f.rows.size, 1); assert.equal(f.state.uploads, 1); assert.equal(f.state.creates, 1); assert.equal(f.state.discards, 0)
})

test('two simultaneous attempts for identical bytes cannot create two uploads', async () => {
  const f = fixture()
  const results = await Promise.allSettled([f.run(), f.run()])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(f.state.uploads, 1); assert.equal(f.assets.length, 1)
})

test('changing public to confidential after unknown POST cannot replay the old public body', async () => {
  const f = fixture(); f.state.failBeforeCommit = true; await assert.rejects(f.run())
  f.state.failBeforeCommit = false
  await assert.rejects(createPropertyAssetWithRecovery({
    client: f.client, organizationId, propertyId, file, storage: f.storage,
    input: { asset_type: 'photo', visibility: 'confidential', title: 'Changed title' },
    execution: { expectedUserId: actorId, canContinue: () => true },
  }), /novas alterações não foram aplicadas/)
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1); assert.equal(f.assets.length, 0); assert.equal(f.rows.size, 1)
})

test('lost committed response cannot silently claim changed retry privacy/title was saved', async () => {
  const f = fixture(); f.state.commitLoseResponse = true; f.state.reconciliationUnavailable = true; await assert.rejects(f.run())
  f.state.reconciliationUnavailable = false
  await assert.rejects(createPropertyAssetWithRecovery({
    client: f.client, organizationId, propertyId, file, storage: f.storage,
    input: { asset_type: 'photo', visibility: 'confidential', title: 'Changed title' },
    execution: { expectedUserId: actorId, canContinue: () => true },
  }), /novas alterações não foram aplicadas/)
  assert.equal(f.state.creates, 1); assert.equal(f.state.uploads, 1); assert.equal(f.assets.length, 1); assert.equal(f.rows.size, 1)
})

test('refreshed display order does not turn an otherwise unchanged pending attempt into another upload', async () => {
  const f = fixture(); f.state.failBeforeCommit = true; await assert.rejects(f.run()); f.state.failBeforeCommit = false
  await createPropertyAssetWithRecovery({
    client: f.client, organizationId, propertyId, file, storage: f.storage,
    input: { asset_type: 'photo', visibility: 'public', title: 'Original title', sort_order: 4 },
    execution: { expectedUserId: actorId, canContinue: () => true },
  })
  assert.equal(f.state.uploads, 1); assert.equal(f.assets.length, 1)
})
