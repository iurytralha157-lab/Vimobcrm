import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getRemainingPropertyPhotoSlots,
  getPropertyPhotoCount,
  getStagedPropertyPhoto,
  isStagedPropertyPhoto,
  normalizePropertyPhotoSelection,
  releaseStagedPropertyPhoto,
  stagePropertyPhoto,
  validatePropertyPhotoFile,
  validatePropertyMainPhotoCapacity,
  withoutEphemeralPropertyMedia,
} from './property-media-draft'

const imageFile = {
  name: 'fachada.webp',
  size: 2_048,
  type: 'image/webp',
} as File

test('property media draft validates type, emptiness and the 10 MB ceiling', () => {
  assert.equal(validatePropertyPhotoFile(imageFile), null)
  assert.match(validatePropertyPhotoFile({ ...imageFile, type: 'image/svg+xml' }) ?? '', /JPEG/)
  assert.match(validatePropertyPhotoFile({ ...imageFile, size: 0 }) ?? '', /vazio/)
  assert.match(validatePropertyPhotoFile({ ...imageFile, size: 10 * 1024 * 1024 + 1 }) ?? '', /10 MB/)
})

test('property media draft keeps the File only in memory and revokes its preview', () => {
  const previewURL = stagePropertyPhoto(imageFile, () => 'blob:property-photo-test')
  assert.equal(isStagedPropertyPhoto(previewURL), true)
  assert.equal(getStagedPropertyPhoto(previewURL)?.file, imageFile)

  const revoked: string[] = []
  assert.equal(releaseStagedPropertyPhoto(previewURL, (value) => revoked.push(value)), true)
  assert.deepEqual(revoked, [previewURL])
  assert.equal(getStagedPropertyPhoto(previewURL), null)
})

test('property draft never serializes browser-only media references', () => {
  const draft = withoutEphemeralPropertyMedia({
    title: 'Casa',
    imagem_principal: 'blob:main',
    fotos: ['blob:gallery'],
    hidden_site_image_urls: ['blob:gallery'],
  })

  assert.deepEqual(draft, {
    title: 'Casa',
    imagem_principal: '',
    fotos: [],
    hidden_site_image_urls: [],
  })
})

test('a full gallery cannot receive a twenty-first photo as the main image', () => {
  const fullGallery = Array.from({ length: 20 }, (_, index) => `blob:gallery-${index}`)

  assert.equal(getRemainingPropertyPhotoSlots(fullGallery, ''), 0)
  assert.match(
    validatePropertyMainPhotoCapacity(fullGallery, '') ?? '',
    /promova uma existente para principal/,
  )
  assert.equal(
    validatePropertyMainPhotoCapacity(fullGallery.slice(0, 19), ''),
    null,
  )
  assert.equal(
    validatePropertyMainPhotoCapacity(fullGallery, 'blob:current-main'),
    null,
  )
})

test('a gallery-only selection promotes its first unique photo and preserves order', () => {
  assert.deepEqual(
    normalizePropertyPhotoSelection(
      [' blob:first ', 'blob:first', '', 'blob:second'],
      '',
    ),
    {
      mainImage: 'blob:first',
      galleryImages: ['blob:second'],
    },
  )
  assert.equal(getPropertyPhotoCount(['blob:only'], ''), 1)
  assert.equal(getRemainingPropertyPhotoSlots(['blob:only'], ''), 19)
})

test('normalization keeps an explicit main photo and removes its gallery duplicate', () => {
  assert.deepEqual(
    normalizePropertyPhotoSelection(
      ['blob:gallery', 'blob:main', 'blob:second'],
      'blob:main',
    ),
    {
      mainImage: 'blob:main',
      galleryImages: ['blob:gallery', 'blob:second'],
    },
  )
})
