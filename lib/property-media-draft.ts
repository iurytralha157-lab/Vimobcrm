export const PROPERTY_MEDIA_MAX_FILE_BYTES = 10 * 1024 * 1024
export const PROPERTY_MEDIA_MAX_PHOTOS = 20
export const PROPERTY_MEDIA_UPLOAD_CONCURRENCY = 3

export const PROPERTY_MEDIA_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
])

type StagedPropertyPhoto = {
  file: File
  previewURL: string
}

const stagedPhotos = new Map<string, StagedPropertyPhoto>()

type PropertyMediaDraftFields = {
  imagem_principal: string
  fotos: string[]
  hidden_site_image_urls: string[]
}

export function normalizePropertyPhotoSelection(
  galleryImages: readonly string[],
  mainImage: string,
) {
  const requestedMain = mainImage.trim()
  const seen = new Set<string>()
  const normalizedGallery: string[] = []

  if (requestedMain) seen.add(requestedMain)
  for (const candidate of galleryImages) {
    const value = candidate.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    normalizedGallery.push(value)
  }

  if (requestedMain) {
    return { mainImage: requestedMain, galleryImages: normalizedGallery }
  }

  const [fallbackMain = '', ...remainingGallery] = normalizedGallery
  return { mainImage: fallbackMain, galleryImages: remainingGallery }
}

export function getPropertyPhotoCount(
  galleryImages: readonly string[],
  mainImage: string,
) {
  const normalized = normalizePropertyPhotoSelection(galleryImages, mainImage)
  return normalized.galleryImages.length + (normalized.mainImage ? 1 : 0)
}

export function withoutEphemeralPropertyMedia<T extends PropertyMediaDraftFields>(data: T): T {
  return {
    ...data,
    imagem_principal: '',
    fotos: [],
    hidden_site_image_urls: [],
  }
}

export function validatePropertyPhotoFile(file: Pick<File, 'name' | 'size' | 'type'>) {
  if (!PROPERTY_MEDIA_IMAGE_TYPES.has(file.type)) {
    return `${file.name}: use JPEG, PNG, WebP ou GIF.`
  }
  if (file.size <= 0) {
    return `${file.name}: o arquivo está vazio.`
  }
  if (file.size > PROPERTY_MEDIA_MAX_FILE_BYTES) {
    return `${file.name}: o arquivo deve ter no máximo 10 MB.`
  }
  return null
}

export function getRemainingPropertyPhotoSlots(
  galleryImages: readonly string[],
  mainImage: string,
) {
  return Math.max(
    0,
    PROPERTY_MEDIA_MAX_PHOTOS - getPropertyPhotoCount(galleryImages, mainImage),
  )
}

export function validatePropertyMainPhotoCapacity(
  galleryImages: readonly string[],
  mainImage: string,
) {
  if (mainImage.trim() || getRemainingPropertyPhotoSlots(galleryImages, mainImage) > 0) {
    return null
  }
  return `Cada imóvel pode ter no máximo ${PROPERTY_MEDIA_MAX_PHOTOS} fotos. Remova uma foto da galeria ou promova uma existente para principal.`
}

export function stagePropertyPhoto(
  file: File,
  createPreviewURL: (value: Blob) => string = (value) => URL.createObjectURL(value),
) {
  const validationError = validatePropertyPhotoFile(file)
  if (validationError) throw new Error(validationError)

  const previewURL = createPreviewURL(file)
  stagedPhotos.set(previewURL, { file, previewURL })
  return previewURL
}

export function getStagedPropertyPhoto(previewURL: string) {
  return stagedPhotos.get(previewURL) ?? null
}

export function isStagedPropertyPhoto(previewURL: string) {
  return stagedPhotos.has(previewURL)
}

export function releaseStagedPropertyPhoto(
  previewURL: string,
  revokePreviewURL: (value: string) => void = (value) => URL.revokeObjectURL(value),
) {
  if (!stagedPhotos.delete(previewURL)) return false
  revokePreviewURL(previewURL)
  return true
}

export function releaseStagedPropertyPhotos(
  previewURLs: Iterable<string>,
  revokePreviewURL?: (value: string) => void,
) {
  for (const previewURL of previewURLs) {
    releaseStagedPropertyPhoto(previewURL, revokePreviewURL)
  }
}
