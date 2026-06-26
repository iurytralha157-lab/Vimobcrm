import { vimobAPIRequest } from './vimob-client'

export type UserSummary = {
  id: string
  name: string | null
  avatar_url: string | null
}

type ListResponse<T> = {
  data: T[]
}

export async function getUserSummaries(ids: string[], organizationId?: string | null) {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)))
  if (uniqueIds.length === 0) return []

  const response = await vimobAPIRequest<ListResponse<UserSummary>>('/v1/user-summaries', {
    organizationId,
    query: {
      ids: uniqueIds.join(','),
    },
  })

  return response.data
}
