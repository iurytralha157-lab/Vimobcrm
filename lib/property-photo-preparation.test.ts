import assert from 'node:assert/strict'
import test from 'node:test'
import { preparePropertyPhoto, propertyPhotoTargetSize, type PropertyPhotoPreparationRuntime } from './property-photo-preparation'

function runtime(width = 4096, height = 3072) {
  const calls: Array<{ width: number; height: number; type: string }> = []
  let closed = false
  const value: PropertyPhotoPreparationRuntime = {
    decode: async () => ({ width, height, source: {} as CanvasImageSource, close: () => { closed = true } }),
    encode: async (_image, w, h, type) => { calls.push({ width: w, height: h, type }); return new Blob(['photo'], { type }) },
  }
  return { value, calls, closed: () => closed }
}

test('photo preparation preserves proportions and never enlarges a small image', () => {
  assert.deepEqual(propertyPhotoTargetSize(4096, 3072), { width: 2048, height: 1536 })
  assert.deepEqual(propertyPhotoTargetSize(300, 100), { width: 300, height: 100 })
  assert.throws(() => propertyPhotoTargetSize(0, 100), /dimensões válidas/)
})

test('PNG stays transparent-capable and file metadata matches encoded bytes', async () => {
  const engine = runtime()
  const result = await preparePropertyPhoto(new File(['png'], 'planta.png', { type: 'image/png' }), engine.value)
  assert.equal(result.type, 'image/webp')
  assert.equal(result.name, 'planta.webp')
  assert.equal(result.size, 5)
  assert.deepEqual(engine.calls, [{ width: 2048, height: 1536, type: 'image/webp' }])
  assert.equal(engine.closed(), true)
})

test('HEIC conversion fails early with an actionable message when the browser cannot decode', async () => {
  const engine = runtime()
  engine.value.decode = async () => { throw new Error('unsupported') }
  await assert.rejects(preparePropertyPhoto(new File(['heic'], 'celular.heic', { type: 'image/heic' }), engine.value), /exporte como JPEG/)
  assert.equal(engine.calls.length, 0)
})

test('animation is preserved byte-for-byte and oversized animation is rejected instead of flattened', async () => {
  const file = new File(['GIF89a'], 'animacao.gif', { type: 'image/gif' })
  const engine = runtime(100, 100)
  assert.equal(await preparePropertyPhoto(file, engine.value), file)
  assert.equal(engine.calls.length, 0)
  const large = runtime()
  await assert.rejects(preparePropertyPhoto(file, large.value), /mantenha a animação/)
  assert.equal(large.closed(), true)
})

test('encoding that cannot meet the byte budget does not stage an oversized photo', async () => {
  const engine = runtime()
  let attempts = 0
  engine.value.encode = async () => { attempts += 1; return new Blob([new Uint8Array(3 * 1024 * 1024)], { type: 'image/jpeg' }) }
  await assert.rejects(preparePropertyPhoto(new File(['jpg'], 'fachada.jpg', { type: 'image/jpeg' }), engine.value), /reduzir a imagem para 2 MB/)
  assert.equal(attempts, 7)
  assert.equal(engine.closed(), true)
})
