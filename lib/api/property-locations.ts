import { vimobAPIRequest } from './vimob-client'
import { apiPropertyCityListResponseSchema, apiPropertyCityResponseSchema, apiPropertyCondominiumListResponseSchema, apiPropertyCondominiumResponseSchema, apiPropertyNeighborhoodListResponseSchema, apiPropertyNeighborhoodResponseSchema, entityIdSchema, organizationIdSchema, parseDomainInput, propertyCatalogDeleteInputSchema, propertyCityInputSchema, propertyCityUpdateInputSchema, propertyCondominiumInputSchema, propertyCondominiumUpdateInputSchema, propertyNeighborhoodInputSchema, propertyNeighborhoodUpdateInputSchema, validateDomainResponse } from '@/lib/validation'

export type PropertyCity = {
  id: string
  organization_id: string
  name: string
  uf: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  /** `property` is a read-only value discovered in legacy property records. */
  catalog_source?: 'catalog' | 'property'
  /** Number of property records that supplied a read-only legacy value. */
  property_count?: number
}

export type PropertyNeighborhood = {
  id: string
  organization_id: string
  city_id: string | null
  name: string
  is_active: boolean
  created_at: string
  updated_at: string
  city?: PropertyCity | null
  catalog_source?: 'catalog' | 'property'
  property_count?: number
}

export type PropertyCondominium = {
  id: string
  organization_id: string
  city_id: string | null
  neighborhood_id: string | null
  name: string
  address: string | null
  photo_url: string | null
  cep: string | null
  number: string | null
  complement: string | null
  default_condominium_fee: number | null
  has_concierge: boolean | null
  concierge_type: string | null
  notes: string | null
  latitude: number | null
  longitude: number | null
  is_active: boolean
  created_at: string
  updated_at: string
  city?: PropertyCity | null
  neighborhood?: PropertyNeighborhood | null
  catalog_source?: 'catalog' | 'property'
  property_count?: number
}

type ListResponse<T> = {
  data: T[]
}

type ItemResponse<T> = {
  data: T
}

export type CreatePropertyCondominiumInput = {
  name: string
  city_id?: string
  neighborhood_id?: string
  address?: string
  photo_url?: string
  cep?: string
  number?: string
  complement?: string
  default_condominium_fee?: number
  has_concierge?: boolean
  concierge_type?: string
  notes?: string
  latitude?: number
  longitude?: number
}

export type UpdatePropertyCityInput = {
  name?: string
  uf?: string | null
  expected_updated_at: string
}

export type UpdatePropertyNeighborhoodInput = {
  name?: string
  city_id?: string
  expected_updated_at: string
}

export type UpdatePropertyCondominiumInput = {
  name?: string
  city_id?: string | null
  neighborhood_id?: string | null
  address?: string | null
  photo_url?: string | null
  cep?: string | null
  number?: string | null
  complement?: string | null
  default_condominium_fee?: number | null
  has_concierge?: boolean
  concierge_type?: string | null
  notes?: string | null
  latitude?: number | null
  longitude?: number | null
  expected_updated_at: string
}

function parseOrganizationId(organizationId: string, context: string) {
  return parseDomainInput(organizationIdSchema, organizationId, `${context}.organization`)
}

export const propertyLocationsAPI = {
  async getCities(organizationId: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.cities.list')
    const response = await vimobAPIRequest<ListResponse<PropertyCity>>('/v1/property-cities', {
      organizationId: orgId,
    })
    validateDomainResponse(apiPropertyCityListResponseSchema, response, 'property-locations.cities.list')
    return response
  },

  async createCity(organizationId: string, city: { name: string; uf?: string }) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.cities.create')
    const body = parseDomainInput(propertyCityInputSchema, city, 'property-locations.cities.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyCity>>('/v1/property-cities', {
      method: 'POST',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyCityResponseSchema, response, 'property-locations.cities.create')
    return response
  },

  async updateCity(organizationId: string, id: string, city: UpdatePropertyCityInput) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.cities.update')
    const cityId = parseDomainInput(entityIdSchema, id, 'property-locations.cities.update.id')
    const body = parseDomainInput(propertyCityUpdateInputSchema, city, 'property-locations.cities.update')
    const response = await vimobAPIRequest<ItemResponse<PropertyCity>>(`/v1/property-cities/${cityId}`, {
      method: 'PATCH',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyCityResponseSchema, response, 'property-locations.cities.update')
    return response
  },

  async deleteCity(organizationId: string, id: string, expectedUpdatedAt: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.cities.delete')
    const cityId = parseDomainInput(entityIdSchema, id, 'property-locations.cities.delete.id')
    const body = parseDomainInput(propertyCatalogDeleteInputSchema, {
      expected_updated_at: expectedUpdatedAt,
    }, 'property-locations.cities.delete')
    await vimobAPIRequest<null>(`/v1/property-cities/${cityId}`, {
      method: 'DELETE',
      organizationId: orgId,
      body,
    })
  },

  async getNeighborhoods(organizationId: string, cityId?: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.neighborhoods.list')
    const queryCityId = cityId ? parseDomainInput(entityIdSchema, cityId, 'property-locations.neighborhoods.list.city-id') : undefined
    const response = await vimobAPIRequest<ListResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      organizationId: orgId,
      query: { cityId: queryCityId },
    })
    validateDomainResponse(apiPropertyNeighborhoodListResponseSchema, response, 'property-locations.neighborhoods.list')
    return response
  },

  async createNeighborhood(organizationId: string, neighborhood: { name: string; city_id: string }) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.neighborhoods.create')
    const body = parseDomainInput(propertyNeighborhoodInputSchema, neighborhood, 'property-locations.neighborhoods.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      method: 'POST',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyNeighborhoodResponseSchema, response, 'property-locations.neighborhoods.create')
    return response
  },

  async updateNeighborhood(organizationId: string, id: string, neighborhood: UpdatePropertyNeighborhoodInput) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.neighborhoods.update')
    const neighborhoodId = parseDomainInput(entityIdSchema, id, 'property-locations.neighborhoods.update.id')
    const body = parseDomainInput(propertyNeighborhoodUpdateInputSchema, neighborhood, 'property-locations.neighborhoods.update')
    const response = await vimobAPIRequest<ItemResponse<PropertyNeighborhood>>(`/v1/property-neighborhoods/${neighborhoodId}`, {
      method: 'PATCH',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyNeighborhoodResponseSchema, response, 'property-locations.neighborhoods.update')
    return response
  },

  async deleteNeighborhood(organizationId: string, id: string, expectedUpdatedAt: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.neighborhoods.delete')
    const neighborhoodId = parseDomainInput(entityIdSchema, id, 'property-locations.neighborhoods.delete.id')
    const body = parseDomainInput(propertyCatalogDeleteInputSchema, {
      expected_updated_at: expectedUpdatedAt,
    }, 'property-locations.neighborhoods.delete')
    await vimobAPIRequest<null>(`/v1/property-neighborhoods/${neighborhoodId}`, {
      method: 'DELETE',
      organizationId: orgId,
      body,
    })
  },

  async getCondominiums(organizationId: string, neighborhoodId?: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.condominiums.list')
    const queryNeighborhoodId = neighborhoodId ? parseDomainInput(entityIdSchema, neighborhoodId, 'property-locations.condominiums.list.neighborhood-id') : undefined
    const response = await vimobAPIRequest<ListResponse<PropertyCondominium>>('/v1/property-condominiums', {
      organizationId: orgId,
      query: { neighborhoodId: queryNeighborhoodId },
    })
    validateDomainResponse(apiPropertyCondominiumListResponseSchema, response, 'property-locations.condominiums.list')
    return response
  },

  async createCondominium(
    organizationId: string,
    condominium: CreatePropertyCondominiumInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.condominiums.create')
    const body = parseDomainInput(propertyCondominiumInputSchema, condominium, 'property-locations.condominiums.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyCondominium>>('/v1/property-condominiums', {
      method: 'POST',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyCondominiumResponseSchema, response, 'property-locations.condominiums.create')
    return response
  },

  async updateCondominium(
    organizationId: string,
    id: string,
    condominium: UpdatePropertyCondominiumInput,
  ) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.condominiums.update')
    const condominiumId = parseDomainInput(entityIdSchema, id, 'property-locations.condominiums.update.id')
    const body = parseDomainInput(propertyCondominiumUpdateInputSchema, condominium, 'property-locations.condominiums.update')
    const response = await vimobAPIRequest<ItemResponse<PropertyCondominium>>(`/v1/property-condominiums/${condominiumId}`, {
      method: 'PATCH',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyCondominiumResponseSchema, response, 'property-locations.condominiums.update')
    return response
  },

  async deleteCondominium(organizationId: string, id: string, expectedUpdatedAt: string) {
    const orgId = parseOrganizationId(organizationId, 'property-locations.condominiums.delete')
    const condominiumId = parseDomainInput(entityIdSchema, id, 'property-locations.condominiums.delete.id')
    const body = parseDomainInput(propertyCatalogDeleteInputSchema, {
      expected_updated_at: expectedUpdatedAt,
    }, 'property-locations.condominiums.delete')
    await vimobAPIRequest<null>(`/v1/property-condominiums/${condominiumId}`, {
      method: 'DELETE',
      organizationId: orgId,
      body,
    })
  },
}
