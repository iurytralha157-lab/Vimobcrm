import {
  apiPropertyAssetUploadIntentResponseSchema,
  apiPropertyOwnerOptionListResponseSchema,
  apiPropertyWorkspaceAssetDeleteResponseSchema,
  apiPropertyWorkspaceAssetListResponseSchema,
  apiPropertyWorkspaceAssetResponseSchema,
  apiPropertyWorkspaceKeyMovementResponseSchema,
  apiPropertyWorkspaceKeyResponseSchema,
  apiPropertyWorkspaceOfferResponseSchema,
  apiPropertyWorkspaceOwnershipResponseSchema,
  apiPropertyWorkspaceResponseSchema,
  parseDomainInput,
  propertyAssetCreateInputSchema,
  propertyAssetDeleteInputSchema,
  propertyAssetOrderInputSchema,
  propertyAssetPrimaryInputSchema,
  propertyAssetUpdateInputSchema,
  propertyAssetUploadIntentInputSchema,
  propertyKeyCreateInputSchema,
  propertyKeyMovementInputSchema,
  propertyOfferUpsertInputSchema,
  propertyOwnershipCreateInputSchema,
  propertyOwnershipEndInputSchema,
  propertyOwnershipUpdateInputSchema,
  validateDomainResponse,
  type PropertyAssetCreateInput,
  type PropertyAssetDeleteInput,
  type PropertyAssetOrderInput,
  type PropertyAssetPrimaryInput,
  type PropertyAssetUpdateInput,
  type PropertyAssetUploadIntentInput,
  type PropertyKeyCreateInput,
  type PropertyKeyMovementInput,
  type PropertyOfferType,
  type PropertyOfferUpsertInput,
  type PropertyOwnershipCreateInput,
  type PropertyOwnershipEndInput,
  type PropertyOwnershipUpdateInput,
  type PropertyWorkspacePayload,
} from '@/lib/validation'
import { supabase } from '@/integrations/supabase/client'

import { vimobAPIRequest } from './vimob-client'

export type PropertyWorkspace = PropertyWorkspacePayload

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `property-key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export const propertyWorkspaceAPI = {
  async getWorkspace(organizationId: string, propertyId: string) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/workspace`,
      { organizationId },
    )
    return validateDomainResponse(
      apiPropertyWorkspaceResponseSchema,
      response,
      'property-workspace.get',
    )
  },

  async upsertOffer(
    organizationId: string,
    propertyId: string,
    offerType: PropertyOfferType,
    input: PropertyOfferUpsertInput,
  ) {
    const body = parseDomainInput(propertyOfferUpsertInputSchema, input, 'property-workspace.offer.upsert')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/offers/${offerType}`,
      {
        method: 'PUT',
        organizationId,
        body,
      },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceOfferResponseSchema,
      response,
      'property-workspace.offer.upsert',
    )
    return parsed.data
  },

  async createKey(organizationId: string, propertyId: string, input: PropertyKeyCreateInput) {
    const body = parseDomainInput(propertyKeyCreateInputSchema, input, 'property-workspace.key.create')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/keys`, {
      method: 'POST',
      organizationId,
      body,
    })
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceKeyResponseSchema,
      response,
      'property-workspace.key.create',
    )
    return parsed.data
  },

  async moveKey(
    organizationId: string,
    propertyId: string,
    keyId: string,
    input: PropertyKeyMovementInput,
    idempotencyKey = createIdempotencyKey(),
  ) {
    const body = parseDomainInput(propertyKeyMovementInputSchema, input, 'property-workspace.key.move')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/keys/${keyId}/movements`,
      {
        method: 'POST',
        organizationId,
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
      },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceKeyMovementResponseSchema,
      response,
      'property-workspace.key.move',
    )
    return parsed.data
  },

  async listOwnerOptions(organizationId: string) {
    const response = await vimobAPIRequest<unknown>('/v1/property-owners', { organizationId })
    const parsed = validateDomainResponse(
      apiPropertyOwnerOptionListResponseSchema,
      response,
      'property-workspace.owners.options',
    )
    return parsed.data
  },

  async createOwnership(
    organizationId: string,
    propertyId: string,
    input: PropertyOwnershipCreateInput,
  ) {
    const body = parseDomainInput(
      propertyOwnershipCreateInputSchema,
      input,
      'property-workspace.ownership.create',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships`,
      { method: 'POST', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceOwnershipResponseSchema,
      response,
      'property-workspace.ownership.create',
    )
    return parsed.data
  },

  async updateOwnership(
    organizationId: string,
    propertyId: string,
    ownershipId: string,
    input: PropertyOwnershipUpdateInput,
  ) {
    const body = parseDomainInput(
      propertyOwnershipUpdateInputSchema,
      input,
      'property-workspace.ownership.update',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships/${ownershipId}`,
      { method: 'PATCH', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceOwnershipResponseSchema,
      response,
      'property-workspace.ownership.update',
    )
    return parsed.data
  },

  async endOwnership(
    organizationId: string,
    propertyId: string,
    ownershipId: string,
    input: PropertyOwnershipEndInput,
  ) {
    const body = parseDomainInput(
      propertyOwnershipEndInputSchema,
      input,
      'property-workspace.ownership.end',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships/${ownershipId}/end`,
      { method: 'POST', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceOwnershipResponseSchema,
      response,
      'property-workspace.ownership.end',
    )
    return parsed.data
  },

  async createAsset(
    organizationId: string,
    propertyId: string,
    input: PropertyAssetCreateInput,
  ) {
    const body = parseDomainInput(propertyAssetCreateInputSchema, input, 'property-workspace.asset.create')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/assets`, {
      method: 'POST',
      organizationId,
      body,
    })
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetResponseSchema,
      response,
      'property-workspace.asset.create',
    )
    return parsed.data
  },

  async createAssetUploadIntent(
    organizationId: string,
    propertyId: string,
    input: PropertyAssetUploadIntentInput,
  ) {
    const body = parseDomainInput(
      propertyAssetUploadIntentInputSchema,
      input,
      'property-workspace.asset.upload-intent',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/upload-intents`,
      { method: 'POST', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyAssetUploadIntentResponseSchema,
      response,
      'property-workspace.asset.upload-intent',
    )
    return parsed.data
  },

  async uploadAssetFile(
    organizationId: string,
    propertyId: string,
    assetType: PropertyAssetUploadIntentInput['asset_type'],
    file: File,
  ) {
    const intentInput = parseDomainInput(propertyAssetUploadIntentInputSchema, {
      asset_type: assetType,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    }, 'property-workspace.asset.upload-file')
    const intent = await this.createAssetUploadIntent(organizationId, propertyId, intentInput)
    const { error } = await supabase.storage
      .from(intent.bucket)
      .uploadToSignedUrl(intent.storage_path, intent.token, file, {
        contentType: file.type || 'application/octet-stream',
      })

    if (error) {
      throw new Error(`Falha ao enviar arquivo: ${error.message}`)
    }

    return intent
  },

  async updateAsset(
    organizationId: string,
    propertyId: string,
    assetId: string,
    input: PropertyAssetUpdateInput,
  ) {
    const body = parseDomainInput(propertyAssetUpdateInputSchema, input, 'property-workspace.asset.update')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}`,
      { method: 'PATCH', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetResponseSchema,
      response,
      'property-workspace.asset.update',
    )
    return parsed.data
  },

  async deleteAsset(
    organizationId: string,
    propertyId: string,
    assetId: string,
    input: PropertyAssetDeleteInput,
  ) {
    const body = parseDomainInput(propertyAssetDeleteInputSchema, input, 'property-workspace.asset.delete')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}`,
      { method: 'DELETE', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetDeleteResponseSchema,
      response,
      'property-workspace.asset.delete',
    )
    return parsed.data
  },

  async reorderAssets(
    organizationId: string,
    propertyId: string,
    input: PropertyAssetOrderInput,
  ) {
    const body = parseDomainInput(propertyAssetOrderInputSchema, input, 'property-workspace.asset.order')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/assets/order`, {
      method: 'PUT',
      organizationId,
      body,
    })
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetListResponseSchema,
      response,
      'property-workspace.asset.order',
    )
    return parsed.data
  },

  async setPrimaryAsset(
    organizationId: string,
    propertyId: string,
    assetId: string,
    input: PropertyAssetPrimaryInput,
  ) {
    const body = parseDomainInput(propertyAssetPrimaryInputSchema, input, 'property-workspace.asset.primary')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}/primary`,
      { method: 'PUT', organizationId, body },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetListResponseSchema,
      response,
      'property-workspace.asset.primary',
    )
    return parsed.data
  },
}
