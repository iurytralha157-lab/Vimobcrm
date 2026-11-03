import { z } from 'zod'

import type {
  CreateHomePublicationInput,
  HomePublication,
  UpdateHomePublicationInput,
} from '@/lib/api/home'
import { homePublicationImageFileSchema } from '@/lib/validation/home'

const imageMetadataSchema = z.object({
  type: z.enum(['image/jpeg', 'image/png', 'image/webp'], { error: 'Use uma imagem JPEG, PNG ou WebP.' }),
  size: z.number().max(5 * 1024 * 1024, 'A imagem deve ter no máximo 5 MB.'),
})

export function getHomeSlideImageError(file: File): string | null {
  const validFile = homePublicationImageFileSchema.safeParse(file)
  if (!validFile.success) return validFile.error.issues[0]?.message || 'Selecione uma imagem válida.'
  const metadata = imageMetadataSchema.safeParse({ type: file.type, size: file.size })
  return metadata.success ? null : metadata.error.issues[0]?.message || 'Selecione uma imagem válida.'
}

export function getHomeSlideImageTitle(filename: string): string {
  const title = filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim().slice(0, 120)
  return title.length >= 2 ? title : 'Slide com imagem'
}

export function withHomeSlideImageDefaults(input: CreateHomePublicationInput, hasImage: boolean): CreateHomePublicationInput {
  if (!hasImage) return input
  return {
    ...input,
    body: input.body.trim() || input.title.trim(),
    ctaLabel: 'Saiba mais',
    ctaHref: '/suporte',
    cardSize: 'wide',
  }
}

type DraftOperations = {
  create: (input: CreateHomePublicationInput) => Promise<HomePublication>
  update: (id: string, input: UpdateHomePublicationInput) => Promise<HomePublication>
  upload: (id: string, file: File) => Promise<HomePublication>
  removeImage: (id: string) => Promise<HomePublication>
  uploadMobile: (id: string, file: File) => Promise<HomePublication>
  removeMobileImage: (id: string) => Promise<HomePublication>
  checkpoint: (publication: HomePublication) => void
  imageSaved: (variant: 'desktop' | 'mobile') => void
}

export async function saveHomePublicationDraft({
  input, publication, file, removeImage, mobileFile = null, removeMobileImage = false,
}: {
  input: CreateHomePublicationInput
  publication: HomePublication | null
  file: File | null
  removeImage: boolean
  mobileFile?: File | null
  removeMobileImage?: boolean
}, operations: DraftOperations): Promise<HomePublication> {
  const imageChanged = Boolean(file || removeImage || mobileFile || removeMobileImage)
  const metadata = { ...input, isActive: imageChanged ? false : input.isActive }
  let saved = publication
    ? await operations.update(publication.id, metadata)
    : await operations.create(metadata)
  // Retain the ID before upload: retries must update this draft, not create again.
  operations.checkpoint(saved)
  if (file) {
    saved = await operations.upload(saved.id, file)
    operations.checkpoint(saved)
    operations.imageSaved('desktop')
  } else if (removeImage) {
    saved = await operations.removeImage(saved.id)
    operations.checkpoint(saved)
    operations.imageSaved('desktop')
  }
  if (mobileFile) {
    saved = await operations.uploadMobile(saved.id, mobileFile)
    operations.checkpoint(saved)
    operations.imageSaved('mobile')
  } else if (removeMobileImage) {
    saved = await operations.removeMobileImage(saved.id)
    operations.checkpoint(saved)
    operations.imageSaved('mobile')
  }
  if (imageChanged && input.isActive) {
    saved = await operations.update(saved.id, { isActive: true })
    operations.checkpoint(saved)
  }
  return saved
}

export function getNextHomeSlideOrder(publications: ReadonlyArray<Pick<HomePublication, 'displayOrder'>>): number {
  if (publications.length === 0) return 10
  const used = new Set(publications.map((publication) => publication.displayOrder))
  let maximum = 0
  for (const value of used) maximum = Math.max(maximum, value)
  if (maximum < 10_000) return Math.min(maximum + 10, 10_000)
  // The API rank is bounded; reuse a free slot instead of sending 10010.
  for (let value = 10_000; value >= 0; value -= 1) if (!used.has(value)) return value
  throw new Error('Não há uma posição de ordem livre entre 0 e 10000 para o novo slide.')
}

export function buildAdjacentHomeSlideMove(
  publications: ReadonlyArray<Pick<HomePublication, 'id' | 'displayOrder'>>,
  index: number,
  direction: -1 | 1,
) {
  const target = index + direction
  if (index < 0 || index >= publications.length || target < 0 || target >= publications.length) return []
  let left = Math.min(index, target)
  let right = left + 1
  const first = publications[left]
  const second = publications[right]
  const previous = publications[left - 1]?.displayOrder ?? -1
  const following = publications[right + 1]?.displayOrder ?? 10_001
  if (first.displayOrder > previous && second.displayOrder < following && first.displayOrder < second.displayOrder) {
    return [{ id: second.id, displayOrder: first.displayOrder }, { id: first.id, displayOrder: second.displayOrder }]
  }
  // Normalize only a bounded local window. One API request remains one transaction.
  while (right - left < 100) {
    const count = right - left + 1
    const lower = publications[left - 1]?.displayOrder ?? -1
    const upper = publications[right + 1]?.displayOrder ?? 10_001
    if (upper - lower - 1 >= count) {
      const start = Math.max(lower + 1, Math.min(publications[left].displayOrder, upper - count))
      return Array.from({ length: count }, (_, offset) => {
        const position = left + offset
        const source = position === index ? target : position === target ? index : position
        return { id: publications[source].id, displayOrder: start + offset }
      })
    }
    if (count === 100 || (left === 0 && right === publications.length - 1)) break
    const leftSpace = left > 0 ? upper - (publications[left - 2]?.displayOrder ?? -1) - count - 2 : -Infinity
    const rightSpace = right + 1 < publications.length ? (publications[right + 2]?.displayOrder ?? 10_001) - lower - count - 2 : -Infinity
    if (leftSpace > rightSpace || (leftSpace === rightSpace && left > 0 && left <= publications.length - right - 1)) left -= 1
    else right += 1
  }
  throw new Error('Não há espaço de ordem para mover estes slides em uma única operação de até 100 itens.')
}
