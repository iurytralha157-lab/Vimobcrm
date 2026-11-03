import assert from 'node:assert/strict'
import test from 'node:test'

import { apiHomePublicationSchema, createHomePublicationInputSchema } from '@/lib/validation/home'
import {
  buildAdjacentHomeSlideMove,
  getHomeSlideImageError,
  getHomeSlideImageTitle,
  getNextHomeSlideOrder,
  saveHomePublicationDraft,
  withHomeSlideImageDefaults,
} from '@/lib/home/publication-draft'

const input = createHomePublicationInputSchema.parse({
  title: 'Arte da campanha', body: 'Texto existente', ctaLabel: 'Abrir ajuda', ctaHref: '/suporte',
  displayOrder: 20, isActive: true, startsAt: '2026-11-04T00:00:00Z', targetType: 'roles', targetRoles: ['admin'],
})
const image = new File(['image'], 'campanha-nova.webp', { type: 'image/webp' })
const initial = () => apiHomePublicationSchema.parse({
  ...input, id: '11111111-1111-4111-8111-111111111111', imageUrl: null,
  createdAt: '2026-11-03T00:00:00Z', updatedAt: '2026-11-03T00:00:00Z',
})

function fixture() {
  let record = initial()
  let retained = record
  const calls: Array<{ operation: string; id?: string; active?: boolean }> = []
  const failures = { upload: false, mobileUpload: false, activation: false }
  let savedImages = 0
  const savedVariants: Array<'desktop' | 'mobile'> = []
  const operations: Parameters<typeof saveHomePublicationDraft>[1] = {
    create: async (value) => { calls.push({ operation: 'create', active: value.isActive }); record = { ...record, ...value }; return record },
    update: async (id, value) => {
      calls.push({ operation: 'update', id, active: value.isActive })
      if (value.isActive && failures.activation) throw new Error('activation failed')
      record = { ...record, ...value }; return record
    },
    upload: async (id) => {
      calls.push({ operation: 'upload', id })
      assert.equal(retained.id, id, 'ID must be retained before upload starts')
      assert.equal(record.isActive, false)
      if (failures.upload) throw new Error('upload failed')
      record = { ...record, imageUrl: 'https://cdn.example.test/slide.webp' }; return record
    },
    removeImage: async (id) => { calls.push({ operation: 'remove', id }); record = { ...record, imageUrl: null }; return record },
    uploadMobile: async (id) => {
      calls.push({ operation: 'uploadMobile', id })
      assert.equal(retained.id, id)
      assert.equal(record.isActive, false)
      if (failures.mobileUpload) throw new Error('mobile upload failed')
      record = { ...record, mobileImageUrl: 'https://cdn.example.test/mobile.webp' }; return record
    },
    removeMobileImage: async (id) => { calls.push({ operation: 'removeMobile', id }); record = { ...record, mobileImageUrl: null }; return record },
    checkpoint: (value) => { retained = value },
    imageSaved: (variant) => { savedImages += 1; savedVariants.push(variant) },
  }
  return { operations, calls, failures, retained: () => retained, savedImages: () => savedImages, savedVariants }
}

test('image filenames and optional text produce valid internal metadata while preserving audience and period', () => {
  assert.equal(getHomeSlideImageTitle('Minha_arte-final.PNG'), 'Minha arte final')
  assert.equal(getHomeSlideImageTitle('a.png'), 'Slide com imagem')
  const result = withHomeSlideImageDefaults({ ...input, body: '' }, true)
  assert.equal(createHomePublicationInputSchema.safeParse(result).success, true)
  assert.equal(result.body, input.title)
  assert.equal(result.ctaHref, '/suporte')
  assert.deepEqual(result.targetRoles, input.targetRoles)
  assert.equal(result.startsAt, input.startsAt)
  assert.equal(withHomeSlideImageDefaults(input, false), input)
})

test('only nonempty JPEG PNG or WebP up to 5 MiB can be selected', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
    assert.equal(getHomeSlideImageError(new File(['x'], 'arte', { type })), null)
  }
  assert.match(getHomeSlideImageError(new File(['svg'], 'arte.svg', { type: 'image/svg+xml' })) || '', /JPEG, PNG ou WebP/)
  assert.match(getHomeSlideImageError(new File([], 'vazia.png', { type: 'image/png' })) || '', /válido/)
  assert.equal(getHomeSlideImageError(new File([new Uint8Array(5 * 1024 * 1024)], 'max.png', { type: 'image/png' })), null)
  assert.match(getHomeSlideImageError(new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'grande.png', { type: 'image/png' })) || '', /5 MB/)
})

test('a new image slide creates inactive, retains its ID, uploads and only then activates', async () => {
  const state = fixture()
  const result = await saveHomePublicationDraft({ input, publication: null, file: image, removeImage: false }, state.operations)
  assert.deepEqual(state.calls.map((call) => [call.operation, call.active]), [['create', false], ['upload', undefined], ['update', true]])
  assert.equal(result.isActive, true)
  assert.ok(result.imageUrl)
  assert.equal(state.savedImages(), 1)
})

test('upload failure preserves the inactive draft and retry updates the same ID without another create', async () => {
  const state = fixture()
  state.failures.upload = true
  await assert.rejects(saveHomePublicationDraft({ input, publication: null, file: image, removeImage: false }, state.operations), /upload failed/)
  const draft = state.retained()
  assert.equal(draft.isActive, false)
  assert.equal(state.savedImages(), 0)
  assert.equal(state.calls.some((call) => call.active === true), false)
  state.failures.upload = false
  await saveHomePublicationDraft({ input, publication: draft, file: image, removeImage: false }, state.operations)
  assert.equal(state.calls.filter((call) => call.operation === 'create').length, 1)
  assert.ok(state.calls.filter((call) => call.id).every((call) => call.id === draft.id))
})

test('activation failure retains the uploaded image so metadata retry does not upload again', async () => {
  const state = fixture()
  state.failures.activation = true
  await assert.rejects(saveHomePublicationDraft({ input, publication: null, file: image, removeImage: false }, state.operations), /activation failed/)
  assert.equal(state.savedImages(), 1)
  assert.ok(state.retained().imageUrl)
  assert.equal(state.retained().isActive, false)
  state.failures.activation = false
  await saveHomePublicationDraft({ input, publication: state.retained(), file: null, removeImage: false }, state.operations)
  assert.equal(state.calls.filter((call) => call.operation === 'upload').length, 1)
  assert.equal(state.retained().isActive, true)
})

test('an explicitly paused image slide stays paused after upload', async () => {
  const state = fixture()
  await saveHomePublicationDraft({ input: { ...input, isActive: false }, publication: null, file: image, removeImage: false }, state.operations)
  assert.equal(state.retained().isActive, false)
  assert.deepEqual(state.calls.map((call) => call.operation), ['create', 'upload'])
})

test('text slides keep legacy metadata without image requests', async () => {
  const state = fixture()
  await saveHomePublicationDraft({ input, publication: null, file: null, removeImage: false }, state.operations)
  assert.deepEqual(state.calls.map((call) => call.operation), ['create'])
  assert.equal(state.retained().body, input.body)
  assert.equal(state.retained().isActive, true)
})

test('image removal is performed only by save and activation follows removal', async () => {
  const state = fixture()
  const publication = { ...initial(), imageUrl: 'https://cdn.example.test/old.png' }
  await saveHomePublicationDraft({ input, publication, file: null, removeImage: true }, state.operations)
  assert.deepEqual(state.calls.map((call) => [call.operation, call.active]), [['update', false], ['remove', undefined], ['update', true]])
  assert.equal(state.retained().imageUrl, null)
})

test('moving in a collection larger than 100 sends only the two adjacent IDs and preserves every other rank', () => {
  const publications = Array.from({ length: 150 }, (_, index) => ({ id: `slide-${index}`, displayOrder: index * 10 }))
  const changes = buildAdjacentHomeSlideMove(publications, 120, 1)
  assert.deepEqual(changes, [{ id: 'slide-121', displayOrder: 1200 }, { id: 'slide-120', displayOrder: 1210 }])
  assert.equal(publications[120].displayOrder, 1200)
  assert.deepEqual(buildAdjacentHomeSlideMove(publications, 0, -1), [])
})

test('tied adjacent ranks use an available gap without changing neighbors', () => {
  const rows = [{ id: 'a', displayOrder: 10 }, { id: 'b', displayOrder: 20 }, { id: 'c', displayOrder: 20 }, { id: 'd', displayOrder: 30 }]
  assert.deepEqual(buildAdjacentHomeSlideMove(rows, 1, 1), [{ id: 'c', displayOrder: 20 }, { id: 'b', displayOrder: 21 }])
})

test('a short tied cluster is normalized atomically while preserving the requested neighbor move', () => {
  const rows = [{ id: 'a', displayOrder: 0 }, { id: 'b', displayOrder: 0 }, { id: 'c', displayOrder: 0 }]
  const changes = buildAdjacentHomeSlideMove(rows, 0, 1)
  assert.ok(changes.length <= 3)
  const ranks = new Map(changes.map((item) => [item.id, item.displayOrder]))
  const result = rows.map((item) => ({ ...item, displayOrder: ranks.get(item.id) ?? item.displayOrder })).sort((a, b) => a.displayOrder - b.displayOrder)
  assert.deepEqual(result.map((item) => item.id), ['b', 'a', 'c'])
  assert.ok(result.every((item) => item.displayOrder >= 0 && item.displayOrder <= 10_000))
})

test('a tied collection larger than 100 uses one bounded suffix when possible and never sends partial batches', () => {
  const rows = Array.from({ length: 150 }, (_, index) => ({ id: `slide-${index}`, displayOrder: 0 }))
  const changes = buildAdjacentHomeSlideMove(rows, 120, 1)
  assert.ok(changes.length <= 100)
  const ranks = new Map(changes.map((item) => [item.id, item.displayOrder]))
  const result = rows.map((item) => ({ ...item, displayOrder: ranks.get(item.id) ?? item.displayOrder })).sort((a, b) => a.displayOrder - b.displayOrder)
  const expected = rows.map((item) => item.id)
  ;[expected[120], expected[121]] = [expected[121], expected[120]]
  assert.deepEqual(result.map((item) => item.id), expected)
  assert.throws(() => buildAdjacentHomeSlideMove(Array.from({ length: 300 }, (_, index) => ({ id: `slide-${index}`, displayOrder: 0 })), 149, 1), /única operação de até 100/)
})

test('new slide ranks stay within the API ceiling and reuse an unoccupied position at the limit', () => {
  assert.equal(getNextHomeSlideOrder([]), 10)
  assert.equal(getNextHomeSlideOrder([{ displayOrder: 20 }]), 30)
  assert.equal(getNextHomeSlideOrder([{ displayOrder: 9_995 }]), 10_000)
  assert.equal(getNextHomeSlideOrder([{ displayOrder: 10_000 }, { displayOrder: 9_999 }]), 9_998)
  assert.throws(() => getNextHomeSlideOrder(Array.from({ length: 10_001 }, (_, displayOrder) => ({ displayOrder }))), /posição de ordem livre/)
})

test('two image variants upload desktop then mobile and only activate after both checkpoints', async () => {
  const state = fixture()
  await saveHomePublicationDraft({ input, publication: null, file: image, mobileFile: image, removeImage: false }, state.operations)
  assert.deepEqual(state.calls.map((call) => [call.operation, call.active]), [['create', false], ['upload', undefined], ['uploadMobile', undefined], ['update', true]])
  assert.deepEqual(state.savedVariants, ['desktop', 'mobile'])
  assert.ok(state.retained().imageUrl)
  assert.ok(state.retained().mobileImageUrl)
})

test('mobile upload failure retains desktop and retries the same ID without reuploading desktop', async () => {
  const state = fixture()
  state.failures.mobileUpload = true
  await assert.rejects(saveHomePublicationDraft({ input, publication: null, file: image, mobileFile: image, removeImage: false }, state.operations), /mobile upload failed/)
  assert.ok(state.retained().imageUrl)
  assert.equal(state.retained().isActive, false)
  assert.deepEqual(state.savedVariants, ['desktop'])
  state.failures.mobileUpload = false
  await saveHomePublicationDraft({ input, publication: state.retained(), file: null, mobileFile: image, removeImage: false }, state.operations)
  assert.equal(state.calls.filter((call) => call.operation === 'create').length, 1)
  assert.equal(state.calls.filter((call) => call.operation === 'upload').length, 1)
  assert.equal(state.calls.filter((call) => call.operation === 'uploadMobile').length, 2)
  assert.equal(state.retained().isActive, true)
})

test('desktop upload failure never starts mobile upload or activation', async () => {
  const state = fixture()
  state.failures.upload = true
  await assert.rejects(saveHomePublicationDraft({ input, publication: null, file: image, mobileFile: image, removeImage: false }, state.operations), /upload failed/)
  assert.deepEqual(state.calls.map((call) => call.operation), ['create', 'upload'])
  assert.deepEqual(state.savedVariants, [])
})

test('a mobile-only draft uses its own endpoint and metadata retry after activation failure uploads neither variant', async () => {
  const state = fixture()
  state.failures.activation = true
  await assert.rejects(saveHomePublicationDraft({ input, publication: null, file: null, mobileFile: image, removeImage: false }, state.operations), /activation failed/)
  assert.equal(state.retained().imageUrl, null)
  assert.ok(state.retained().mobileImageUrl)
  assert.deepEqual(state.savedVariants, ['mobile'])
  state.failures.activation = false
  await saveHomePublicationDraft({ input, publication: state.retained(), file: null, removeImage: false }, state.operations)
  assert.equal(state.calls.filter((call) => call.operation === 'uploadMobile').length, 1)
  assert.equal(state.calls.filter((call) => call.operation === 'upload').length, 0)
  assert.equal(state.retained().isActive, true)
})

test('variant removals run independently and an unchanged variant is never deleted', async () => {
  for (const variant of ['desktop', 'mobile'] as const) {
    const state = fixture()
    await saveHomePublicationDraft({ input, publication: { ...initial(), imageUrl: 'https://cdn.example.test/desktop.webp', mobileImageUrl: 'https://cdn.example.test/mobile.webp' }, file: null, removeImage: variant === 'desktop', removeMobileImage: variant === 'mobile' }, state.operations)
    assert.deepEqual(state.savedVariants, [variant])
    assert.deepEqual(state.calls.map((call) => call.operation), ['update', variant === 'desktop' ? 'remove' : 'removeMobile', 'update'])
  }
})
