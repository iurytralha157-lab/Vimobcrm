import { vimobAPIRequest } from './vimob-client'
import type { Tag } from '@/hooks/use-tags'

type Envelope<T> = {
  data: T
}

export const tagsAPI = {
  async list(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Tag[]>>('/v1/tags', {
      organizationId,
    })
    return response.data
  },

  async create(input: { name: string; color: string; description?: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Tag>>('/v1/tags', {
      method: 'POST',
      organizationId,
      body: input,
    })
    return response.data
  },

  async update(id: string, input: { name?: string; color?: string; description?: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<Tag>>(`/v1/tags/${id}`, {
      method: 'PATCH',
      organizationId,
      body: input,
    })
    return response.data
  },

  async delete(id: string, organizationId?: string | null) {
    await vimobAPIRequest<null>(`/v1/tags/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}
