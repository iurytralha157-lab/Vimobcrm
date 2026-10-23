import { managementAPIRequest } from '@/lib/api/management-request'
import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { tagCatalogResponseSchema, type TagCatalog } from '@/lib/validation/tag-catalog'
import type { Tag } from '@/hooks/use-tags'
import {
  apiTagListResponseSchema,
  apiTagResponseSchema,
  apiTagUsageResponseSchema,
  createTagInputSchema,
  parseDomainInput,
  updateTagInputSchema,
  validateDomainResponse,
} from '@/lib/validation'

type Envelope<T> = {
  data: T
}

type TagsListOptions = {
  signal?: AbortSignal
}

export type TagUsage = {
  updated_at: string
  lead_count: number
  usages: { kind: string; count: number }[]
}

export const tagsAPI = {
  async catalog(organizationId: string, options: VimobAPIRequestIntent = {}): Promise<TagCatalog[]> {
    const response = await vimobAPIRequest<Envelope<TagCatalog[]>>('/v1/tags', {
      ...options,
      organizationId,
      query: { view: 'catalog' },
      retry: false,
    })
    const parsed = validateDomainResponse(tagCatalogResponseSchema, response, 'tags.catalog')
    if (parsed.data.some(tag => tag.organization_id !== organizationId)) {
      throw new Error('O catálogo de tags pertence a outra organização.')
    }
    return parsed.data
  },

  async list(organizationId?: string | null, options: TagsListOptions = {}) {
    const response = await vimobAPIRequest<Envelope<Tag[]>>('/v1/tags', {
      organizationId,
      signal: options.signal,
      retry: false,
    })
    validateDomainResponse(apiTagListResponseSchema, response, 'tags.list')
    return response.data
  },

  async create(input: { name: string; color: string; description?: string }, organizationId?: string | null) {
    const body = parseDomainInput(createTagInputSchema, input, 'tags.create')
    const response = await managementAPIRequest<Envelope<Tag>>('/v1/tags', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiTagResponseSchema, response, 'tags.create')
    return response.data
  },

  async update(id: string, input: { name: string; color: string; description?: string; expected_updated_at: string }, organizationId?: string | null) {
    const body = parseDomainInput(updateTagInputSchema, input, 'tags.update')
    const response = await managementAPIRequest<Envelope<Tag>>(`/v1/tags/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiTagResponseSchema, response, 'tags.update')
    return response.data
  },

  async usage(id: string, organizationId?: string | null, signal?: AbortSignal) {
    const response = await vimobAPIRequest<Envelope<TagUsage>>(`/v1/tags/${id}/usage`, { organizationId, signal, retry: false })
    return validateDomainResponse(apiTagUsageResponseSchema, response, 'tags.usage').data
  },

  async delete(id: string, expectedUpdatedAt: string, organizationId?: string | null) {
    await managementAPIRequest<null>(`/v1/tags/${id}`, {
      method: 'DELETE',
      organizationId,
      headers: { 'If-Match': `"${expectedUpdatedAt}"` },
      retry: false,
    })
  },
}
