import { vimobAPIRequest } from './vimob-client'
import { apiPropertyOwnerPageResponseSchema, apiPropertyOwnerResponseSchema, entityIdSchema, organizationIdSchema, parseDomainInput, propertyCatalogDeleteInputSchema, propertyOwnerCatalogUpdateInputSchema, propertyOwnerInputSchema, propertyOwnerPageQuerySchema, validateDomainResponse } from '@/lib/validation'

export type PropertyOwnerProperty = {
  id: string
  code: string | null
  title: string | null
  tipo_de_negocio: string | null
  bairro: string | null
  cidade: string | null
}

export type PropertyOwner = {
  id: string
  organization_id: string
  name: string
  phone_residential: string | null
  phone_commercial: string | null
  cellphone: string | null
  email: string | null
  media_source: string | null
  notify_email: boolean
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
  property_count?: number
  properties?: PropertyOwnerProperty[]
}

export type PropertyOwnerInput = {
  name: string
  phone_residential?: string
  phone_commercial?: string
  cellphone?: string
  email?: string
  media_source?: string
  notify_email?: boolean
  notes?: string
}

export type PropertyOwnerUpdateInput = PropertyOwnerInput & {
  expected_updated_at: string
}

type ListResponse<T> = {
  data: T[]
}

type PageResponse<T> = ListResponse<T> & {
  next_cursor?: string | null
  total_count?: number
}

type ItemResponse<T> = {
  data: T
}

export type PropertyOwnerPage = {
  owners: PropertyOwner[]
  nextCursor: string | null
  totalCount: number
  legacyOwners?: PropertyOwner[]
}

export const propertyOwnersAPI = {
  async getOwnersPage(
    organizationId: string,
    params: { search?: string; limit: number; cursor?: string | null; signal?: AbortSignal },
  ): Promise<PropertyOwnerPage> {
    const orgId = parseDomainInput(organizationIdSchema, organizationId, 'property-owners.page.organization')
    const query = parseDomainInput(propertyOwnerPageQuerySchema, {
      search: params.search,
      limit: params.limit,
      cursor: params.cursor,
    }, 'property-owners.page.query')
    const response = await vimobAPIRequest<PageResponse<PropertyOwner>>('/v1/property-owners', {
      organizationId: orgId,
      query: {
        search: query.search,
        limit: query.limit,
        cursor: query.cursor || undefined,
      },
      signal: params.signal,
    })
    validateDomainResponse(apiPropertyOwnerPageResponseSchema, response, 'property-owners.page')

    const hasServerPagination = typeof response.total_count === 'number'
    return {
      owners: hasServerPagination ? response.data : response.data.slice(0, query.limit),
      nextCursor: hasServerPagination ? response.next_cursor || null : null,
      totalCount: response.total_count ?? response.data.length,
      legacyOwners: hasServerPagination ? undefined : response.data,
    }
  },

  async createOwner(organizationId: string, owner: PropertyOwnerInput) {
    const body = parseDomainInput(propertyOwnerInputSchema, owner, 'property-owners.create')
    const response = await vimobAPIRequest<ItemResponse<PropertyOwner>>('/v1/property-owners', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyOwnerResponseSchema, response, 'property-owners.create')
    return response
  },

  async updateOwner(organizationId: string, ownerId: string, owner: PropertyOwnerUpdateInput) {
    const id = parseDomainInput(entityIdSchema, ownerId, 'property-owners.update.id')
    const body = parseDomainInput(propertyOwnerCatalogUpdateInputSchema, owner, 'property-owners.update')
    const response = await vimobAPIRequest<ItemResponse<PropertyOwner>>(`/v1/property-owners/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiPropertyOwnerResponseSchema, response, 'property-owners.update')
    return response
  },

  async deactivateOwner(organizationId: string, ownerId: string, expectedUpdatedAt: string) {
    const id = parseDomainInput(entityIdSchema, ownerId, 'property-owners.deactivate.id')
    const body = parseDomainInput(propertyCatalogDeleteInputSchema, {
      expected_updated_at: expectedUpdatedAt,
    }, 'property-owners.deactivate')
    await vimobAPIRequest<null>(`/v1/property-owners/${id}`, {
      method: 'DELETE',
      organizationId,
      body,
    })
  },
}
