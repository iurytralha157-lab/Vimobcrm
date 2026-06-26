import { vimobAPIRequest } from './vimob-client'
import type { Tag } from '@/hooks/use-tags'

type Envelope<T> = {
  data: T
}

export const tagsAPI = {
  async list() {
    const response = await vimobAPIRequest<Envelope<Tag[]>>('/v1/tags')
    return response.data
  },

  async create(input: { name: string; color: string; description?: string }) {
    const response = await vimobAPIRequest<Envelope<Tag>>('/v1/tags', {
      method: 'POST',
      body: input,
    })
    return response.data
  },

  async update(id: string, input: { name?: string; color?: string; description?: string }) {
    const response = await vimobAPIRequest<Envelope<Tag>>(`/v1/tags/${id}`, {
      method: 'PATCH',
      body: input,
    })
    return response.data
  },

  async delete(id: string) {
    await vimobAPIRequest<null>(`/v1/tags/${id}`, {
      method: 'DELETE',
    })
  },
}
