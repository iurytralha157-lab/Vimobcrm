import { PROPERTY_MEDIA_MAX_FILE_BYTES, validatePropertyPhotoFile } from './property-media-draft'

export const PROPERTY_PHOTO_MAX_DIMENSION = 2048
export const PROPERTY_PHOTO_TARGET_BYTES = 2 * 1024 * 1024
export const PROPERTY_PHOTO_MAX_SOURCE_BYTES = 30 * 1024 * 1024
export const PROPERTY_PHOTO_DECODE_TIMEOUT_MS = 10_000
export const PROPERTY_PHOTO_PICKER_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,.heic,.heif'
const SOURCE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

type DecodedPhoto = { width: number; height: number; source: CanvasImageSource; close: () => void }
export type PropertyPhotoPreparationRuntime = {
  decode: (file: File) => Promise<DecodedPhoto>
  encode: (image: DecodedPhoto, width: number, height: number, type: string, quality: number) => Promise<Blob>
}

export function propertyPhotoTargetSize(width: number, height: number, limit = PROPERTY_PHOTO_MAX_DIMENSION) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('A imagem não possui dimensões válidas.')
  }
  const scale = Math.min(1, limit / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function isAnimatedPropertyPhoto(file: File) {
  if (file.type === 'image/gif') return true
  if (file.type !== 'image/webp' && file.type !== 'image/png') return false
  const header = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const text = new TextDecoder('latin1').decode(header)
  // Animation control chunks precede image data; preserve the original frames.
  return file.type === 'image/webp' ? text.includes('ANIM') : text.includes('acTL')
}

const browserRuntime: PropertyPhotoPreparationRuntime = {
  async decode(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const image = await createImageBitmap(file, { imageOrientation: 'from-image' })
        return { width: image.width, height: image.height, source: image, close: () => image.close() }
      } catch { /* A browser may decode HEIC through its image element instead. */ }
    }
    const url = URL.createObjectURL(file)
    const image = new Image()
    try {
      image.src = url
      await image.decode()
      return { width: image.naturalWidth, height: image.naturalHeight, source: image, close: () => URL.revokeObjectURL(url) }
    } catch (error) {
      URL.revokeObjectURL(url)
      throw error
    }
  },
  async encode(image, width, height, type, quality) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Não foi possível preparar a imagem neste navegador.')
    context.drawImage(image.source, 0, 0, width, height)
    try {
      return await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível converter a imagem.')),
        type, quality,
      ))
    } finally {
      canvas.width = 0
      canvas.height = 0
    }
  },
}

/** Prepare before staging/upload so every saved byte and MIME matches the preview. */
export async function preparePropertyPhoto(file: File, runtime = browserRuntime): Promise<File> {
  const sourceType = file.type || (/\.hei[cf]$/i.test(file.name) ? 'image/heic' : '')
  if (!SOURCE_TYPES.has(sourceType)) throw new Error(`${file.name}: use JPEG, PNG, WebP, GIF ou HEIC compatível com o navegador.`)
  if (file.size <= 0) throw new Error(`${file.name}: o arquivo está vazio.`)
  if (file.size > PROPERTY_PHOTO_MAX_SOURCE_BYTES) throw new Error(`${file.name}: selecione uma imagem com até 30 MB.`)
  const animated = await isAnimatedPropertyPhoto(file)
  let image: DecodedPhoto
  let waitingForDecode = true
  let decodeTimer: ReturnType<typeof setTimeout> | undefined
  try {
    image = await Promise.race([
      runtime.decode(file).then((decoded) => {
        if (!waitingForDecode) decoded.close()
        return decoded
      }),
      new Promise<never>((_resolve, reject) => {
        decodeTimer = setTimeout(() => reject(new Error('image_decode_timeout')), PROPERTY_PHOTO_DECODE_TIMEOUT_MS)
      }),
    ])
  } catch {
    throw new Error(`${file.name}: este navegador não consegue abrir a imagem. Para HEIC/HEIF, exporte como JPEG ou use a opção de formato compatível no celular.`)
  } finally {
    waitingForDecode = false
    if (decodeTimer) clearTimeout(decodeTimer)
  }
  try {
    let { width, height } = propertyPhotoTargetSize(image.width, image.height)
    if (animated) {
      if (file.size > PROPERTY_MEDIA_MAX_FILE_BYTES || Math.max(image.width, image.height) > PROPERTY_PHOTO_MAX_DIMENSION) {
        throw new Error(`${file.name}: mantenha a animação em até 2048 pixels e 10 MB, ou envie uma foto JPEG/WebP.`)
      }
      const error = validatePropertyPhotoFile(file)
      if (error) throw new Error(error)
      return file
    }
    // WebP preserves alpha for PNG/WebP sources; never flatten transparent files to JPEG.
    const type = sourceType === 'image/png' || sourceType === 'image/webp' ? 'image/webp' : 'image/jpeg'
    let output: Blob | undefined
    for (let attempt = 0; attempt < 7; attempt += 1) {
      output = await runtime.encode(image, width, height, type, Math.max(0.55, 0.86 - attempt * 0.05))
      if (type === 'image/webp' && output.type === 'image/jpeg') {
        throw new Error(`${file.name}: a conversão não preservou a transparência. Envie PNG ou WebP.`)
      }
      if (output.size <= PROPERTY_PHOTO_TARGET_BYTES) break
      width = Math.max(1, Math.round(width * 0.8))
      height = Math.max(1, Math.round(height * 0.8))
    }
    if (!output || output.size > PROPERTY_PHOTO_TARGET_BYTES) throw new Error(`${file.name}: não foi possível reduzir a imagem para 2 MB.`)
    const extension = output.type === 'image/webp' ? 'webp' : output.type === 'image/png' ? 'png' : 'jpg'
    const prepared = new File([output], `${file.name.replace(/\.[^.]+$/, '')}.${extension}`, { type: output.type, lastModified: file.lastModified })
    const error = validatePropertyPhotoFile(prepared)
    if (error) throw new Error(error)
    return prepared
  } finally {
    image.close()
  }
}
