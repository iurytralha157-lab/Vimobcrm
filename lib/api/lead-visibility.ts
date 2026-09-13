import { vimobAPIRequest } from './vimob-client'
import { apiLeadVisibilityResponseSchema, validateDomainResponse } from '@/lib/validation'
import { PIPELINE_READ_TIMEOUT_MS } from '@/lib/pipeline-reliability'

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
  signal?: AbortSignal
}) {
  const response = await vimobAPIRequest<Envelope<LeadVisibilityResponse>>('/v1/lead-visibility', {
    organizationId: params.organizationId,
    signal: params.signal,
    timeoutMs: PIPELINE_READ_TIMEOUT_MS,
    retry: false,
  })
  validateDomainResponse(apiLeadVisibilityResponseSchema, response, 'lead-visibility.get')

  return response.data
}
