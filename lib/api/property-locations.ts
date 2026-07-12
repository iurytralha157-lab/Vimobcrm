import { vimobAPIRequest } from './vimob-client'
import { apiPropertyCityListResponseSchema, apiPropertyCityResponseSchema, apiPropertyCondominiumListResponseSchema, apiPropertyCondominiumResponseSchema, apiPropertyNeighborhoodListResponseSchema, apiPropertyNeighborhoodResponseSchema, entityIdSchema, organizationIdSchema, parseDomainInput, propertyCityInputSchema, propertyCondominiumInputSchema, propertyNeighborhoodInputSchema, validateDomainResponse } from '@/lib/validation'

export type PropertyCity = {
  id: string
  organization_id: string
  name: string
  uf: string | null
  is_active: boolean
  created_at: string
}

export type PropertyNeighborhood = {
  id: string
  organization_id: string
  city_id: string | null
  name: string
  is_active: boolean
  created_at: string
  city?: PropertyCity | null
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
  city?: PropertyCity | null
  neighborhood?: PropertyNeighborhood | null
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

export const propertyLocationsAPI = {
  async getCities(organizationId: string) {
    const orgId = parseDomainInput(organizationIdSchema, organizationId, 'property-locations.cities.list.organization')
    const response = await vimobAPIRequest<ListResponse<PropertyCity>>('/v1/property-cities', {
      organizationId: orgId,
    })
    validateDomainResponse(apiPropertyCityListResponseSchema, response, 'property-locations.cities.list')
    return response
  },

  async createCity(organizationId: string, city: { name: string; uf?: string }) {
    const orgId = parseDomainInput(organizationIdSchema, organizationId, 'property-locations.cities.create.organization')
    const body = parseDomainInput(propertyCityInputSchema, city, 'property-locations.cities.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyCity>>('/v1/property-cities', {
      method: 'POST',
      organizationId: orgId,
      body,
    })
    validateDomainResponse(apiPropertyCityResponseSchema, response, 'property-locations.cities.create')
    return response
  },

  async deleteCity(organizationId: string, id: string) {
    const cityId = parseDomainInput(entityIdSchema, id, 'property-locations.cities.delete.id')
    await vimobAPIRequest<null>(`/v1/property-cities/${cityId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getNeighborhoods(organizationId: string, cityId?: string) {
    const queryCityId = cityId ? parseDomainInput(entityIdSchema, cityId, 'property-locations.neighborhoods.list.city-id') : undefined
    const response = await vimobAPIRequest<ListResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      organizationId,
      query: { cityId: queryCityId },
    })
    validateDomainResponse(apiPropertyNeighborhoodListResponseSchema, response, 'property-locations.neighborhoods.list')
    return response
  },

  async createNeighborhood(organizationId: string, neighborhood: { name: string; city_id: string }) {
    const body = parseDomainInput(propertyNeighborhoodInputSchema, neighborhood, 'property-locations.neighborhoods.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyNeighborhoodResponseSchema, response, 'property-locations.neighborhoods.create')
    return response
  },

  async deleteNeighborhood(organizationId: string, id: string) {
    const neighborhoodId = parseDomainInput(entityIdSchema, id, 'property-locations.neighborhoods.delete.id')
    await vimobAPIRequest<null>(`/v1/property-neighborhoods/${neighborhoodId}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getCondominiums(organizationId: string, neighborhoodId?: string) {
    const queryNeighborhoodId = neighborhoodId ? parseDomainInput(entityIdSchema, neighborhoodId, 'property-locations.condominiums.list.neighborhood-id') : undefined
    const response = await vimobAPIRequest<ListResponse<PropertyCondominium>>('/v1/property-condominiums', {
      organizationId,
      query: { neighborhoodId: queryNeighborhoodId },
    })
    validateDomainResponse(apiPropertyCondominiumListResponseSchema, response, 'property-locations.condominiums.list')
    return response
  },

  async createCondominium(
    organizationId: string,
    condominium: CreatePropertyCondominiumInput,
  ) {
    const body = parseDomainInput(propertyCondominiumInputSchema, condominium, 'property-locations.condominiums.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyCondominium>>('/v1/property-condominiums', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyCondominiumResponseSchema, response, 'property-locations.condominiums.create')
    return response
  },

  async deleteCondominium(organizationId: string, id: string) {
    const condominiumId = parseDomainInput(entityIdSchema, id, 'property-locations.condominiums.delete.id')
    await vimobAPIRequest<null>(`/v1/property-condominiums/${condominiumId}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
