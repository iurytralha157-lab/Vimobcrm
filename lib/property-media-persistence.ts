import {
  getStagedPropertyPhoto,
  normalizePropertyPhotoSelection,
  PROPERTY_MEDIA_MAX_PHOTOS,
  PROPERTY_MEDIA_UPLOAD_CONCURRENCY,
  releaseStagedPropertyPhotos,
} from './property-media-draft'
import type {
  PropertyAssetCreateInput,
  PropertyAssetDeleteInput,
  PropertyAssetUploadDiscardInput,
  PropertyWorkspaceAsset,
} from './validation/property-workspace'

export type PropertyPhotoSelection = {
  mainImage: string
  galleryImages: string[]
  hiddenSiteImages?: string[]
}

export type PropertyMediaPersistenceClient = {
  uploadAssetFile: (
    organizationId: string,
    propertyId: string,
    assetType: 'photo',
    file: File,
  ) => Promise<{ storage_path: string }>
  createAsset: (
    organizationId: string,
    propertyId: string,
    input: PropertyAssetCreateInput,
  ) => Promise<PropertyWorkspaceAsset>
  deleteAsset: (
    organizationId: string,
    propertyId: string,
    assetId: string,
    input: PropertyAssetDeleteInput,
  ) => Promise<unknown>
  discardAssetUpload: (
    organizationId: string,
    propertyId: string,
    input: PropertyAssetUploadDiscardInput,
  ) => Promise<unknown>
}

export class PropertyMediaPersistenceError extends Error {
  readonly originalError: unknown
  readonly rollbackFailedAssetIds: string[]
  readonly rollbackFailedUploadPaths: string[]

  constructor(
    originalError: unknown,
    rollbackFailedAssetIds: string[],
    rollbackFailedUploadPaths: string[] = [],
  ) {
    super(
      originalError instanceof Error
        ? originalError.message
        : 'Falha ao salvar as fotos do imóvel.',
    )
    this.name = 'PropertyMediaPersistenceError'
    this.originalError = originalError
    this.rollbackFailedAssetIds = rollbackFailedAssetIds
    this.rollbackFailedUploadPaths = rollbackFailedUploadPaths
  }

  get rollbackIncomplete() {
    return this.rollbackFailedAssetIds.length > 0 || this.rollbackFailedUploadPaths.length > 0
  }
}

function uniquePhotoSelection(selection: PropertyPhotoSelection) {
  const { mainImage, galleryImages } = normalizePropertyPhotoSelection(
    selection.galleryImages,
    selection.mainImage,
  )
  const ordered = mainImage ? [mainImage, ...galleryImages] : []

  if (ordered.length === 0) {
    throw new Error('Adicione ao menos uma foto do imóvel.')
  }

  if (ordered.length > PROPERTY_MEDIA_MAX_PHOTOS) {
    throw new Error(`Adicione no máximo ${PROPERTY_MEDIA_MAX_PHOTOS} fotos por imóvel.`)
  }

  return { mainImage, ordered }
}

async function rollbackCreatedAssets(
  client: PropertyMediaPersistenceClient,
  organizationId: string,
  propertyId: string,
  assets: PropertyWorkspaceAsset[],
) {
  const rollbackBatch = async (batch: PropertyWorkspaceAsset[]) => {
    const results = await Promise.allSettled(
      batch.map((asset) => client.deleteAsset(organizationId, propertyId, asset.id, {
        expected_updated_at: asset.updated_at,
      })),
    )
    return results.flatMap((result, index) =>
      result.status === 'rejected' ? [batch[index].id] : [],
    )
  }

  // Deleting the primary photo can promote another photo and update its
  // optimistic-lock version. Remove every non-primary first so compensation
  // does not invalidate the versions it still needs to delete.
  const nonPrimaryAssets = assets.filter((asset) => !asset.is_primary)
  const primaryAssets = assets.filter((asset) => asset.is_primary)
  return [
    ...(await rollbackBatch(nonPrimaryAssets)),
    ...(await rollbackBatch(primaryAssets)),
  ]
}

export async function persistStagedPropertyPhotosWithClient(
  organizationId: string,
  propertyId: string,
  selection: PropertyPhotoSelection,
  client: PropertyMediaPersistenceClient,
) {
  const { mainImage, ordered } = uniquePhotoSelection(selection)
  const hidden = new Set(selection.hiddenSiteImages ?? [])
  const createdAssets: PropertyWorkspaceAsset[] = []
  const completedPreviewURLs: string[] = []
  const rollbackFailedUploadPaths: string[] = []
  let cursor = 0
  let firstError: unknown = null

  const uploadOne = async (previewURL: string, sortOrder: number) => {
    const staged = getStagedPropertyPhoto(previewURL)
    const isPrimary = previewURL === mainImage
    const visibility = isPrimary ? 'public' : hidden.has(previewURL) ? 'internal' : 'public'

    if (!staged) {
      throw new Error('Uma foto selecionada não está mais disponível. Selecione o arquivo novamente.')
    }

    const intent = await client.uploadAssetFile(
      organizationId,
      propertyId,
      'photo',
      staged.file,
    )

    try {
      const asset = await client.createAsset(organizationId, propertyId, {
        asset_type: 'photo',
        visibility,
        storage_path: intent.storage_path,
        external_url: null,
        title: staged.file.name,
        description: null,
        file_name: staged.file.name,
        mime_type: staged.file.type,
        file_size_bytes: staged.file.size,
        sort_order: sortOrder,
        is_primary: isPrimary,
        document_category: null,
        expires_at: null,
        metadata: { source: 'property_form' },
      })
      createdAssets.push(asset)
      completedPreviewURLs.push(previewURL)
    } catch (error) {
      try {
        await client.discardAssetUpload(organizationId, propertyId, {
          storage_path: intent.storage_path,
        })
      } catch {
        rollbackFailedUploadPaths.push(intent.storage_path)
      }
      throw error
    }
  }

  const worker = async () => {
    while (!firstError) {
      const index = cursor
      cursor += 1
      if (index >= ordered.length) return
      try {
        await uploadOne(ordered[index], index)
      } catch (error) {
        firstError = error
      }
    }
  }

  const workerCount = Math.min(PROPERTY_MEDIA_UPLOAD_CONCURRENCY, ordered.length)
  await Promise.all(Array.from({ length: workerCount }, () => worker()))

  if (firstError) {
    const rollbackFailedAssetIds = await rollbackCreatedAssets(
      client,
      organizationId,
      propertyId,
      createdAssets,
    )
    throw new PropertyMediaPersistenceError(
      firstError,
      rollbackFailedAssetIds,
      rollbackFailedUploadPaths,
    )
  }

  releaseStagedPropertyPhotos(completedPreviewURLs)
  return createdAssets.sort((left, right) => left.sort_order - right.sort_order)
}
