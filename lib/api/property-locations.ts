import { vimobAPIRequest } from './vimob-client'

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

export const propertyLocationsAPI = {
  async getCities(organizationId: string) {
    return vimobAPIRequest<ListResponse<PropertyCity>>('/v1/property-cities', {
      organizationId,
    })
  },

  async createCity(organizationId: string, city: { name: string; uf?: string }) {
    return vimobAPIRequest<ItemResponse<PropertyCity>>('/v1/property-cities', {
      method: 'POST',
      organizationId,
      body: city,
    })
  },

  async deleteCity(organizationId: string, id: string) {
    await vimobAPIRequest<null>(`/v1/property-cities/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getNeighborhoods(organizationId: string, cityId?: string) {
    return vimobAPIRequest<ListResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      organizationId,
      query: { cityId },
    })
  },

  async createNeighborhood(organizationId: string, neighborhood: { name: string; city_id: string }) {
    return vimobAPIRequest<ItemResponse<PropertyNeighborhood>>('/v1/property-neighborhoods', {
      method: 'POST',
      organizationId,
      body: neighborhood,
    })
  },

  async deleteNeighborhood(organizationId: string, id: string) {
    await vimobAPIRequest<null>(`/v1/property-neighborhoods/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getCondominiums(organizationId: string, neighborhoodId?: string) {
    return vimobAPIRequest<ListResponse<PropertyCondominium>>('/v1/property-condominiums', {
      organizationId,
      query: { neighborhoodId },
    })
  },

  async createCondominium(
    organizationId: string,
    condominium: {
      name: string
      city_id?: string
      neighborhood_id?: string
      address?: string
      latitude?: number
      longitude?: number
    },
  ) {
    return vimobAPIRequest<ItemResponse<PropertyCondominium>>('/v1/property-condominiums', {
      method: 'POST',
      organizationId,
      body: condominium,
    })
  },

  async deleteCondominium(organizationId: string, id: string) {
    await vimobAPIRequest<null>(`/v1/property-condominiums/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
