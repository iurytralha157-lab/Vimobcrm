import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types'
import { vimobAPIRequest } from './vimob-client'

type Property = Tables<'properties'>
type PropertyInsert = TablesInsert<'properties'>
type PropertyUpdate = TablesUpdate<'properties'>

type PropertyAPIOptions = {
  limit?: number
  offset?: number
  search?: string
  tipo_de_negocio?: string
  tipo_de_imovel?: string
  cidade?: string
  bairro?: string
  responsavel_id?: string
  quartos_min?: string | number
  suites_min?: string | number
  banheiros_min?: string | number
  valor_min?: string | number
  valor_max?: string | number
}

type PropertyListResponse = {
  data: Property[]
  total: number
  limit: number
  offset: number
}

type PropertyResponse = {
  data: Property
}

// Properties API functions
export const propertiesAPI = {
  async getProperties(organizationId: string, options?: PropertyAPIOptions) {
    const response = await vimobAPIRequest<PropertyListResponse>('/v1/properties', {
      organizationId,
      query: {
        limit: options?.limit,
        offset: options?.offset,
        search: options?.search,
        tipo_de_negocio: options?.tipo_de_negocio,
        tipo_de_imovel: options?.tipo_de_imovel,
        cidade: options?.cidade,
        bairro: options?.bairro,
        responsavel_id: options?.responsavel_id,
        quartos_min: options?.quartos_min,
        suites_min: options?.suites_min,
        banheiros_min: options?.banheiros_min,
        valor_min: options?.valor_min,
        valor_max: options?.valor_max,
      },
    })

    return {
      data: response.data,
      count: response.total,
      error: null,
      limit: response.limit,
      offset: response.offset,
    }
  },

  async getProperty(propertyId: string, organizationId: string) {
    const response = await vimobAPIRequest<PropertyResponse>(`/v1/properties/${propertyId}`, {
      organizationId,
    })

    return {
      data: response.data,
      error: null,
    }
  },

  async createProperty(organizationId: string, data: Partial<PropertyInsert>) {
    const response = await vimobAPIRequest<PropertyResponse>('/v1/properties', {
      method: 'POST',
      organizationId,
      body: data,
    })

    return {
      data: response.data,
      error: null,
    }
  },

  async updateProperty(propertyId: string, data: PropertyUpdate, organizationId: string) {
    const response = await vimobAPIRequest<PropertyResponse>(`/v1/properties/${propertyId}`, {
      method: 'PATCH',
      organizationId,
      body: data,
    })

    return {
      data: response.data,
      error: null,
    }
  },

  async deleteProperty(propertyId: string, organizationId: string) {
    await vimobAPIRequest<null>(`/v1/properties/${propertyId}`, {
      method: 'DELETE',
      organizationId,
    })

    return {
      error: null,
    }
  },

  async searchProperties(organizationId: string, query: string) {
    const response = await propertiesAPI.getProperties(organizationId, {
      search: query,
      limit: 50,
    })

    return {
      data: response.data,
      error: null,
    }
  },
}
