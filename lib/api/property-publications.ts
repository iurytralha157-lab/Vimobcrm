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

import { vimobAPIRequest } from './vimob-client'

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
) {
  const context = publicationCommandContext(channel, 'publish')
  const body = parseDomainInput(publishPropertyInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/publish`,
    {
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
) {
  const context = publicationCommandContext(channel, 'unpublish')
  const body = parseDomainInput(mutatePropertyPublicationInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/unpublish`,
    {
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
) {
  const context = publicationCommandContext(channel, 'retry')
  const body = parseDomainInput(mutatePropertyPublicationInputSchema, input, context)
  const response = await vimobAPIRequest<unknown>(
    `/v1/properties/${propertyId}/publications/${publicationChannelRoute[channel]}/retry`,
    {
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
  ) {
    const response = await vimobAPIRequest<unknown>(
      `/v1/properties/${propertyId}/publications`,
      { organizationId, signal, retry: false },
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
  ) {
    return publishChannel(organizationId, propertyId, 'site', input, idempotencyKey)
  },

  async unpublishSite(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('unpublish'),
  ) {
    return unpublishChannel(organizationId, propertyId, 'site', input, idempotencyKey)
  },

  async retrySite(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('retry'),
  ) {
    return retryChannel(organizationId, propertyId, 'site', input, idempotencyKey)
  },

  async publishGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: PublishPropertyInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-publish'),
  ) {
    return publishChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey)
  },

  async unpublishGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-unpublish'),
  ) {
    return unpublishChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey)
  },

  async retryGrupoOLX(
    organizationId: string,
    propertyId: string,
    input: MutatePropertyPublicationInput,
    idempotencyKey = createPropertyPublicationIdempotencyKey('grupo-olx-retry'),
  ) {
    return retryChannel(organizationId, propertyId, 'grupo_olx', input, idempotencyKey)
  },
}

export type { PropertyPublicationOverview }
