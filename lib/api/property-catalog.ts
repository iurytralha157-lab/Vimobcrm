import { vimobAPIRequest } from './vimob-client'

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
  return vimobAPIRequest<CatalogResponse>(endpoints[key], {
    organizationId,
  })
}

async function createCatalogItem(key: CatalogKey, organizationId: string, input: { name: string; icon?: string | null }) {
  return vimobAPIRequest<CatalogItemResponse>(endpoints[key], {
    method: 'POST',
    organizationId,
    body: input,
  })
}

async function seedCatalog(key: Exclude<CatalogKey, 'types'>, organizationId: string, names: string[]) {
  return vimobAPIRequest<CatalogResponse>(`${endpoints[key]}/seed-defaults`, {
    method: 'POST',
    organizationId,
    body: { names },
  })
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
