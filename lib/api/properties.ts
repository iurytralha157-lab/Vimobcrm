import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types'
import { vimobAPIRequest } from './vimob-client'

type Property = Tables<'properties'>
type PropertyInsert = TablesInsert<'properties'>
type PropertyUpdate = TablesUpdate<'properties'>
type PropertyMetadataInput = { metadata?: Record<string, unknown> }

type PropertyAPIOptions = {
  limit?: number
  offset?: number
  search?: string
  status?: string
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
  aceita_permuta?: boolean
  aceita_financiamento?: boolean
  published_on_site?: boolean
  owner_id?: string
  condominium_id?: string
  mobilia?: string
  exclusividade?: boolean
  placa_no_local?: boolean
  destaque?: boolean
  vagas_min?: string | number
  area_util_min?: string | number
  area_util_max?: string | number
  area_total_min?: string | number
  area_total_max?: string | number
}

type PropertyListResponse = {
  data: Property[]
  total: number
  limit: number
  offset: number
}

export type PropertyStats = {
  total: number
  sale: number
  rental: number
  available: number
  reserved: number
  sold: number
  rented: number
  private: number
}

type PropertyResponse = {
  data: Property
}

export type PropertyHistoryEvent = {
  id: string
  type: string
  title: string
  metadata: Record<string, unknown>
  created_at: string
}

type PropertyHistoryResponse = {
  data: PropertyHistoryEvent[]
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
        status: options?.status,
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
        aceita_permuta: options?.aceita_permuta,
        aceita_financiamento: options?.aceita_financiamento,
        published_on_site: options?.published_on_site,
        owner_id: options?.owner_id,
        condominium_id: options?.condominium_id,
        mobilia: options?.mobilia,
        exclusividade: options?.exclusividade,
        placa_no_local: options?.placa_no_local,
        destaque: options?.destaque,
        vagas_min: options?.vagas_min,
        area_util_min: options?.area_util_min,
        area_util_max: options?.area_util_max,
        area_total_min: options?.area_total_min,
        area_total_max: options?.area_total_max,
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

  async getPropertyStats(organizationId: string, options?: PropertyAPIOptions) {
    return vimobAPIRequest<PropertyStats>('/v1/properties/stats', {
      organizationId,
      query: {
        search: options?.search,
        status: options?.status,
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
        aceita_permuta: options?.aceita_permuta,
        aceita_financiamento: options?.aceita_financiamento,
        published_on_site: options?.published_on_site,
        owner_id: options?.owner_id,
        condominium_id: options?.condominium_id,
        mobilia: options?.mobilia,
        exclusividade: options?.exclusividade,
        placa_no_local: options?.placa_no_local,
        destaque: options?.destaque,
        vagas_min: options?.vagas_min,
        area_util_min: options?.area_util_min,
        area_util_max: options?.area_util_max,
        area_total_min: options?.area_total_min,
        area_total_max: options?.area_total_max,
      },
    })
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

  async createProperty(organizationId: string, data: Partial<PropertyInsert> & PropertyMetadataInput) {
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

  async updateProperty(propertyId: string, data: PropertyUpdate & PropertyMetadataInput, organizationId: string) {
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

  async getPropertyHistory(propertyId: string, organizationId: string) {
    const response = await vimobAPIRequest<PropertyHistoryResponse>(`/v1/properties/${propertyId}/history`, {
      organizationId,
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
