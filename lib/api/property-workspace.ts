import {
  apiPropertyAssetUploadIntentResponseSchema,
  apiPropertyAssetUploadDiscardResponseSchema,
  apiPropertyKeyMovementPageSchema,
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
  propertyAssetUploadDiscardInputSchema,
  propertyAssetUpdateInputSchema,
  propertyAssetUploadIntentInputSchema,
  propertyKeyCreateInputSchema,
  propertyKeyMovementInputSchema,
  propertyKeyMovementListQuerySchema,
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
  type PropertyAssetUploadDiscardInput,
  type PropertyKeyCreateInput,
  type PropertyKeyMovementInput,
  type PropertyKeyMovementListQuery,
  type PropertyOfferType,
  type PropertyOfferUpsertInput,
  type PropertyOwnershipCreateInput,
  type PropertyOwnershipEndInput,
  type PropertyOwnershipUpdateInput,
  type PropertyWorkspacePayload,
} from '@/lib/validation'
import { supabase } from '@/lib/supabase/client'

import { getVimobAPIAccessTokenUserId, getVimobAPIAccessTokenSessionId, vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { capturePropertyMutationIntent } from '@/lib/api/property-mutation-intent'
import { assertPropertyMediaExecution, PropertyMediaScopeChangedError, type PropertyMediaExecutionOptions } from '@/lib/property-media-execution'

function assertAssetExecution(execution?: PropertyMediaExecutionOptions) {
  assertPropertyMediaExecution(execution)
  if (execution?.expectedUserId !== undefined && (
    !execution.expectedUserId || getVimobAPIAccessTokenUserId() !== execution.expectedUserId
  )) throw new PropertyMediaScopeChangedError()
  if (execution?.expectedSessionId !== undefined && (
    !execution.expectedSessionId || getVimobAPIAccessTokenSessionId() !== execution.expectedSessionId
  )) throw new PropertyMediaScopeChangedError()
}

export type PropertyWorkspace = PropertyWorkspacePayload

function createIdempotencyKey() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `property-key-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

// The API verifies each stored photo with two Storage calls before answering.
const PROPERTY_MEDIA_REQUEST_TIMEOUT_MS = 45_000

export const propertyWorkspaceAPI = {
  async getWorkspace(organizationId: string, propertyId: string, execution?: PropertyMediaExecutionOptions) {
    assertAssetExecution(execution)
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/workspace`,
      { organizationId, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
    )
    assertAssetExecution(execution)
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
    intent?: VimobAPIRequestIntent,
  ) {
    const body = parseDomainInput(propertyOfferUpsertInputSchema, input, 'property-workspace.offer.upsert')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/offers/${offerType}`,
      {
        method: 'PUT',
        ...capturePropertyMutationIntent(intent),
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

  /** Custody history across all keys, newest first. Empty unless meta.can_view_key_custody. */
  async listKeyMovements(organizationId: string, propertyId: string, query: PropertyKeyMovementListQuery = {}, intent?: VimobAPIRequestIntent) {
    const parsedQuery = parseDomainInput(propertyKeyMovementListQuerySchema, query, 'property-workspace.key.movements')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/keys/movements`, {
      ...intent,
      organizationId,
      query: parsedQuery,
    })
    return validateDomainResponse(apiPropertyKeyMovementPageSchema, response, 'property-workspace.key.movements')
  },

  async createKey(organizationId: string, propertyId: string, input: PropertyKeyCreateInput, intent?: VimobAPIRequestIntent) {
    const body = parseDomainInput(propertyKeyCreateInputSchema, input, 'property-workspace.key.create')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/keys`, {
      method: 'POST',
      ...capturePropertyMutationIntent(intent),
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
    intent?: VimobAPIRequestIntent,
  ) {
    const body = parseDomainInput(propertyKeyMovementInputSchema, input, 'property-workspace.key.move')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/keys/${keyId}/movements`,
      {
        method: 'POST',
        organizationId,
        body,
        headers: { 'Idempotency-Key': idempotencyKey },
        ...capturePropertyMutationIntent(intent),
      },
    )
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceKeyMovementResponseSchema,
      response,
      'property-workspace.key.move',
    )
    return parsed.data
  },

  async createOwnership(
    organizationId: string,
    propertyId: string,
    input: PropertyOwnershipCreateInput,
    intent?: VimobAPIRequestIntent,
  ) {
    const body = parseDomainInput(
      propertyOwnershipCreateInputSchema,
      input,
      'property-workspace.ownership.create',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships`,
      { ...capturePropertyMutationIntent(intent), method: 'POST', organizationId, body },
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
    intent?: VimobAPIRequestIntent,
  ) {
    const body = parseDomainInput(
      propertyOwnershipUpdateInputSchema,
      input,
      'property-workspace.ownership.update',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships/${ownershipId}`,
      { ...capturePropertyMutationIntent(intent), method: 'PATCH', organizationId, body },
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
    intent?: VimobAPIRequestIntent,
  ) {
    const body = parseDomainInput(
      propertyOwnershipEndInputSchema,
      input,
      'property-workspace.ownership.end',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/ownerships/${ownershipId}/end`,
      { ...capturePropertyMutationIntent(intent), method: 'POST', organizationId, body },
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(propertyAssetCreateInputSchema, input, 'property-workspace.asset.create')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/assets`, {
      method: 'POST',
      timeoutMs: PROPERTY_MEDIA_REQUEST_TIMEOUT_MS,
      organizationId,
      body,
      expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId,
      onRequestStart: () => assertAssetExecution(execution),
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(
      propertyAssetUploadIntentInputSchema,
      input,
      'property-workspace.asset.upload-intent',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/upload-intents`,
      { method: 'POST', timeoutMs: PROPERTY_MEDIA_REQUEST_TIMEOUT_MS, organizationId, body, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const intentInput = parseDomainInput(propertyAssetUploadIntentInputSchema, {
      asset_type: assetType,
      file_name: file.name,
      mime_type: file.type,
      file_size_bytes: file.size,
    }, 'property-workspace.asset.upload-file')
    const intent = await this.createAssetUploadIntent(organizationId, propertyId, intentInput, execution)
    assertAssetExecution(execution)
    const { error } = await supabase.storage
      .from(intent.bucket)
      .uploadToSignedUrl(intent.storage_path, intent.token, file, {
        contentType: file.type || 'application/octet-stream',
      })

    if (error) {
      await this.discardAssetUpload(organizationId, propertyId, {
        storage_path: intent.storage_path,
      }, execution).catch(() => undefined)
      const status = Number((error as { status?: unknown; statusCode?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode)
      throw Object.assign(new Error(`Falha ao enviar arquivo: ${error.message}`),
        Number.isFinite(status) && status > 0 ? { status } : { transient: true })
    }

    return intent
  },

  async discardAssetUpload(
    organizationId: string,
    propertyId: string,
    input: PropertyAssetUploadDiscardInput,
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(
      propertyAssetUploadDiscardInputSchema,
      input,
      'property-workspace.asset.upload-discard',
    )
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/upload-intents`,
      { method: 'DELETE', organizationId, body, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
    )
    const parsed = validateDomainResponse(
      apiPropertyAssetUploadDiscardResponseSchema,
      response,
      'property-workspace.asset.upload-discard',
    )
    return parsed.data
  },

  async updateAsset(
    organizationId: string,
    propertyId: string,
    assetId: string,
    input: PropertyAssetUpdateInput,
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(propertyAssetUpdateInputSchema, input, 'property-workspace.asset.update')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}`,
      { method: 'PATCH', organizationId, body, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
    )
    assertAssetExecution(execution)
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(propertyAssetDeleteInputSchema, input, 'property-workspace.asset.delete')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}`,
      { method: 'DELETE', organizationId, body, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(propertyAssetOrderInputSchema, input, 'property-workspace.asset.order')
    const response = await vimobAPIRequest<unknown>(`/v1/properties/${propertyId}/assets/order`, {
      method: 'PUT',
      organizationId,
      body,
      expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId,
      onRequestStart: () => assertAssetExecution(execution),
    })
    assertAssetExecution(execution)
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
    execution?: PropertyMediaExecutionOptions,
  ) {
    assertAssetExecution(execution)
    const body = parseDomainInput(propertyAssetPrimaryInputSchema, input, 'property-workspace.asset.primary')
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/assets/${assetId}/primary`,
      { method: 'PUT', organizationId, body, expectedUserId: execution?.expectedUserId, expectedSessionId: execution?.expectedSessionId, onRequestStart: () => assertAssetExecution(execution) },
    )
    assertAssetExecution(execution)
    const parsed = validateDomainResponse(
      apiPropertyWorkspaceAssetListResponseSchema,
      response,
      'property-workspace.asset.primary',
    )
    return parsed.data
  },
}
