import { vimobAPIRequest } from './vimob-client'
import { apiPropertyImageResponseSchema, entityIdSchema, parseDomainInput, validateDomainResponse } from '@/lib/validation'

export type PropertyImageUpload = {
  url: string
  path: string
  bucket: string
  contentType: string
  size: number
}

type PropertyImageUploadResponse = {
  data: PropertyImageUpload
}

type UploadPropertyImageOptions = {
  organizationId?: string | null
  propertyId?: string | null
}

export async function uploadPropertyImage(
  file: File,
  options: UploadPropertyImageOptions = {},
) {
  const formData = new FormData()
  formData.append('file', file)

  if (options.propertyId) {
    formData.append('propertyId', parseDomainInput(entityIdSchema, options.propertyId, 'property-images.upload.property-id'))
  }

  const response = await vimobAPIRequest<PropertyImageUploadResponse>('/v1/property-images', {
    method: 'POST',
    organizationId: options.organizationId,
    body: formData,
  })
  validateDomainResponse(apiPropertyImageResponseSchema, response, 'property-images.upload')

  return response.data
}
