import { vimobAPIRequest } from './vimob-client'
import type { Tag } from '@/hooks/use-tags'
import {
  apiTagListResponseSchema,
  apiTagResponseSchema,
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

export const tagsAPI = {
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
    const response = await vimobAPIRequest<Envelope<Tag>>('/v1/tags', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiTagResponseSchema, response, 'tags.create')
    return response.data
  },

  async update(id: string, input: { name: string; color: string; description?: string }, organizationId?: string | null) {
    const body = parseDomainInput(updateTagInputSchema, input, 'tags.update')
    const response = await vimobAPIRequest<Envelope<Tag>>(`/v1/tags/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiTagResponseSchema, response, 'tags.update')
    return response.data
  },

  async delete(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/tags/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
