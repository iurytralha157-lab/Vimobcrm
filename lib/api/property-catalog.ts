import { vimobAPIRequest } from './vimob-client'
import { apiPropertyCatalogListResponseSchema, apiPropertyCatalogResponseSchema, organizationIdSchema, parseDomainInput, propertyCatalogCreateInputSchema, propertyCatalogSeedInputSchema, validateDomainResponse } from '@/lib/validation'

export type PropertyCatalogItem = {
  id: string
  organization_id: string
  name: string
  icon?: string | null
  created_at?: string | null
}

type CatalogResponse = {
  data: PropertyCatalogItem[]
}

type CatalogItemResponse = {
  data: PropertyCatalogItem
}

const endpoints = {
  types: '/v1/property-types',
  features: '/v1/property-features',
  proximities: '/v1/property-proximities',
} as const

type CatalogKey = keyof typeof endpoints

async function listCatalog(key: CatalogKey, organizationId: string) {
  const orgId = parseDomainInput(organizationIdSchema, organizationId, `property-catalog.${key}.list.organization`)
  const response = await vimobAPIRequest<CatalogResponse>(endpoints[key], {
    organizationId: orgId,
  })
  validateDomainResponse(apiPropertyCatalogListResponseSchema, response, `property-catalog.${key}.list`)
  return response
}

async function createCatalogItem(key: CatalogKey, organizationId: string, input: { name: string; icon?: string | null }) {
  const orgId = parseDomainInput(organizationIdSchema, organizationId, `property-catalog.${key}.create.organization`)
  const body = parseDomainInput(propertyCatalogCreateInputSchema, input, `property-catalog.${key}.create`)
  const response = await vimobAPIRequest<CatalogItemResponse>(endpoints[key], {
    method: 'POST',
    organizationId: orgId,
    body,
  })
  validateDomainResponse(apiPropertyCatalogResponseSchema, response, `property-catalog.${key}.create`)
  return response
}

async function seedCatalog(key: Exclude<CatalogKey, 'types'>, organizationId: string, names: string[]) {
  const orgId = parseDomainInput(organizationIdSchema, organizationId, `property-catalog.${key}.seed.organization`)
  const body = parseDomainInput(propertyCatalogSeedInputSchema, { names }, `property-catalog.${key}.seed`)
  const response = await vimobAPIRequest<CatalogResponse>(`${endpoints[key]}/seed-defaults`, {
    method: 'POST',
    organizationId: orgId,
    body,
  })
  validateDomainResponse(apiPropertyCatalogListResponseSchema, response, `property-catalog.${key}.seed`)
  return response
}

export const propertyCatalogAPI = {
  async getTypes(organizationId: string) {
    return listCatalog('types', organizationId)
  },

  async createType(organizationId: string, name: string) {
    return createCatalogItem('types', organizationId, { name })
  },

  async getFeatures(organizationId: string) {
    return listCatalog('features', organizationId)
  },

  async createFeature(organizationId: string, name: string) {
    return createCatalogItem('features', organizationId, { name })
  },

  async seedFeatures(organizationId: string, names: string[]) {
    return seedCatalog('features', organizationId, names)
  },

  async getProximities(organizationId: string) {
    return listCatalog('proximities', organizationId)
  },

  async createProximity(organizationId: string, name: string) {
    return createCatalogItem('proximities', organizationId, { name })
  },

  async seedProximities(organizationId: string, names: string[]) {
    return seedCatalog('proximities', organizationId, names)
  },
}
