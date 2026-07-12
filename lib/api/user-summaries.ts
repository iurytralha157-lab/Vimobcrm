import { vimobAPIRequest } from './vimob-client'
import { apiUserSummaryListResponseSchema, parseDomainInput, uuidListSchema, validateDomainResponse } from '@/lib/validation'

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
  const userIds = parseDomainInput(uuidListSchema, uniqueIds, 'user-summaries.list.ids')

  const response = await vimobAPIRequest<ListResponse<UserSummary>>('/v1/user-summaries', {
    organizationId,
    query: {
      ids: userIds.join(','),
    },
  })
  validateDomainResponse(apiUserSummaryListResponseSchema, response, 'user-summaries.list')

  return response.data
}
