import type { z } from 'zod'
import type { Tables } from '@/lib/supabase/types'
import {
  apiPropertyHistoryResponseSchema,
  apiPropertyCreateResponseSchema,
  apiPropertyManagedTermsSchema,
  apiPropertyListResponseSchema,
  apiPropertyResponseSchema,
  apiPropertyStatsSchema,
  parseDomainInput,
  propertyCreateInputSchema,
  propertyDeleteInputSchema,
  propertyListQuerySchema,
  propertyUpdateInputSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

export type PropertyRecord = Tables<'properties'>
export type PropertyManagedTerms = z.output<typeof apiPropertyManagedTermsSchema>
export type PropertyWithCapabilities = PropertyRecord & {
  can_edit: boolean
  managed_terms: PropertyManagedTerms
}
export type PropertyCreateInput = z.input<typeof propertyCreateInputSchema>
export type PropertyUpdateInput = z.input<typeof propertyUpdateInputSchema>
export type PropertyDeleteInput = z.input<typeof propertyDeleteInputSchema>

type PropertyAPIOptions = {
  limit?: number
  offset?: number
  scope?: 'own'
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
  data: PropertyWithCapabilities[]
  total: number
  limit: number
  offset: number
}

export type PropertyStats = {
  total: number
  sale: number
  rental: number
  launches: number
  available: number
  reserved: number
  sold: number
  rented: number
  private: number
}

type PropertyResponse = {
  data: PropertyWithCapabilities
}

type PropertyCreateResponse = {
  data: PropertyRecord
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
    const query = parseDomainInput(propertyListQuerySchema, options ?? {}, 'properties.list')
    const response = await vimobAPIRequest<PropertyListResponse>('/v1/properties', {
      organizationId,
      query: {
        ...query,
      },
    })
    validateDomainResponse(apiPropertyListResponseSchema, response, 'properties.list')

    return {
      data: response.data,
      count: response.total,
      error: null,
      limit: response.limit,
      offset: response.offset,
    }
  },

  async getPropertyStats(organizationId: string, options?: PropertyAPIOptions) {
    const query = parseDomainInput(propertyListQuerySchema, options ?? {}, 'properties.stats')
    const response = await vimobAPIRequest<PropertyStats>('/v1/properties/stats', {
      organizationId,
      query,
    })
    validateDomainResponse(apiPropertyStatsSchema, response, 'properties.stats')
    return response
  },

  async getProperty(propertyId: string, organizationId: string) {
    const response = await vimobAPIRequest<PropertyResponse>(`/v1/properties/${propertyId}`, {
      organizationId,
    })
    validateDomainResponse(apiPropertyResponseSchema, response, 'properties.get')

    return {
      data: response.data,
      error: null,
    }
  },

  async createProperty(organizationId: string, data: PropertyCreateInput) {
    const body = parseDomainInput(propertyCreateInputSchema, data, 'properties.create')
    const response = await vimobAPIRequest<PropertyCreateResponse>('/v1/properties', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyCreateResponseSchema, response, 'properties.create')

    return {
      data: response.data,
      error: null,
    }
  },

  async updateProperty(propertyId: string, data: PropertyUpdateInput, organizationId: string) {
    const body = parseDomainInput(propertyUpdateInputSchema, data, 'properties.update')
    const response = await vimobAPIRequest<PropertyResponse>(`/v1/properties/${propertyId}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyResponseSchema, response, 'properties.update')

    return {
      data: response.data,
      error: null,
    }
  },

  async getPropertyHistory(propertyId: string, organizationId: string) {
    const response = await vimobAPIRequest<PropertyHistoryResponse>(`/v1/properties/${propertyId}/history`, {
      organizationId,
    })
    validateDomainResponse(apiPropertyHistoryResponseSchema, response, 'properties.history')

    return {
      data: response.data,
      error: null,
    }
  },

  async deleteProperty(propertyId: string, expectedUpdatedAt: string, organizationId: string) {
    const body = parseDomainInput(
      propertyDeleteInputSchema,
      { expected_updated_at: expectedUpdatedAt },
      'properties.delete',
    )
    await vimobAPIRequest<null>(`/v1/properties/${propertyId}`, {
      method: 'DELETE',
      organizationId,
      body,
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
