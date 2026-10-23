import { capturePropertyMutationIntent } from '@/lib/api/property-mutation-intent'
import {
  apiPropertyPublicationOverviewResponseSchema,
  mutatePropertyPublicationInputSchema,
  parseDomainInput,
  publishPropertyInputSchema,
  validateDomainResponse,
  type MutatePropertyPublicationInput,
  type PropertyPublicationCommandChannel,
  type PropertyPublicationOverview,
  type PublishPropertyInput,
} from '@/lib/validation'

import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'

export function createPropertyPublicationIdempotencyKey(action: string) {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `property-publication-${action}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function parseOverview(response: unknown, context: string): PropertyPublicationOverview {
  return validateDomainResponse(
    apiPropertyPublicationOverviewResponseSchema,
    response,
    context,
  )
}

const publicationChannelRoute: Record<PropertyPublicationCommandChannel, string> = {
  site: 'site',
  grupo_olx: 'grupo-olx',
}

function publicationCommandContext(
  channel: PropertyPublicationCommandChannel,
  action: 'publish' | 'unpublish' | 'retry',
) {
  return `property-publications.${channel}.${action}`
}

async function publishChannel(
  organizationId: string,
  propertyId: string,
  channel: PropertyPublicationCommandChannel,
  input: PublishPropertyInput,
  idempotencyKey = createPropertyPublicationIdempotencyKey(`${channel}-publish`),
  intent?: VimobAPIRequestIntent,
) {
  intent = capturePropertyMutationIntent(intent);
  const context = publicationCommandContext(channel, 'publish')
  const body = parseDomainInput(publishPropertyInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/publish`,
    {
      ...intent,
      method: 'POST',
      organizationId,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )
  return parseOverview(response, context)
}

async function unpublishChannel(
  organizationId: string,
  propertyId: string,
  channel: PropertyPublicationCommandChannel,
  input: MutatePropertyPublicationInput,
  idempotencyKey = createPropertyPublicationIdempotencyKey(`${channel}-unpublish`),
  intent?: VimobAPIRequestIntent,
) {
  intent = capturePropertyMutationIntent(intent);
  const context = publicationCommandContext(channel, 'unpublish')
  const body = parseDomainInput(mutatePropertyPublicationInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/unpublish`,
    {
      ...intent,
      method: 'POST',
      organizationId,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )
  return parseOverview(response, context)
}

async function retryChannel(
  organizationId: string,
  propertyId: string,
  channel: PropertyPublicationCommandChannel,
  input: MutatePropertyPublicationInput,
  idempotencyKey = createPropertyPublicationIdempotencyKey(`${channel}-retry`),
  intent?: VimobAPIRequestIntent,
) {
  intent = capturePropertyMutationIntent(intent);
  const context = publicationCommandContext(channel, 'retry')
  const body = parseDomainInput(mutatePropertyPublicationInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/retry`,
    {
      ...intent,
      method: 'POST',
      organizationId,
      body,
      headers: { 'Idempotency-Key': idempotencyKey },
    },
  )
  return parseOverview(response, context)
}

export const propertyPublicationsAPI = {
  async getPublications(
    organizationId: string,
    propertyId: string,
    signal?: AbortSignal,
    intent?: VimobAPIRequestIntent,
  ) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/publications`,
      { ...intent, organizationId, signal: signal ?? intent?.signal, retry: false },
    )
    return parseOverview(response, 'property-publications.get')
  },

  publishChannel,
  unpublishChannel,
  retryChannel,

  async publishSite(
    organizationId: string,
    propertyId: string,
    input: PublishPropertyInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('publish'),
    intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return publishChannel(organizationId, propertyId, 'site', input, idempotencyKey, intent)
  },

  async unpublishSite(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('unpublish'),
  intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return unpublishChannel(organizationId, propertyId, 'site', input, idempotencyKey, intent)
  },

  async retrySite(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('retry'),
  intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return retryChannel(organizationId, propertyId, 'site', input, idempotencyKey, intent)
  },

  async publishGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: PublishPropertyInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-publish'),
  intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return publishChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey, intent)
  },

  async unpublishGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-unpublish'),
  intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return unpublishChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey, intent)
  },

  async retryGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-retry'),
  intent?: VimobAPIRequestIntent,
  ) {
  intent = capturePropertyMutationIntent(intent);
    return retryChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey, intent)
  },
}

export type { PropertyPublicationOverview }
