import { vimobAPIRequest } from './vimob-client'
import { apiLeadVisibilityResponseSchema, validateDomainResponse } from '@/lib/validation'

export type LeadVisibilityResponse = {
  canViewAll: boolean
  teamMemberIds?: string[]
  userId?: string
}

type Envelope<T> = {
  data: T
}

export async function getLeadVisibility(params: {
  organizationId?: string | null
}) {
  const response = await vimobAPIRequest<Envelope<LeadVisibilityResponse>>('/v1/lead-visibility', {
    organizationId: params.organizationId,
  })
  validateDomainResponse(apiLeadVisibilityResponseSchema, response, 'lead-visibility.get')

  return response.data
}
