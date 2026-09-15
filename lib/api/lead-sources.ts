import { vimobAPIRequest } from './vimob-client'
import type { LeadSourceEntry } from '@/hooks/use-lead-sources'
import {
  apiLeadSourceListResponseSchema,
  apiLeadSourceResponseSchema,
  createLeadSourceInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'

type Envelope<T> = {
  data: T
}

type LeadSourcesListOptions = {
  signal?: AbortSignal
}

export const leadSourcesAPI = {
  async list(organizationId?: string | null, options: LeadSourcesListOptions = {}) {
    const response = await vimobAPIRequest<Envelope<LeadSourceEntry[]>>('/v1/lead-sources', {
      organizationId,
      signal: options.signal,
      retry: false,
    })
    validateDomainResponse(apiLeadSourceListResponseSchema, response, 'leadSources.list')
    return response.data
  },

  async create(input: { name: string }, organizationId?: string | null) {
    const body = parseDomainInput(createLeadSourceInputSchema, input, 'leadSources.create')
    const response = await vimobAPIRequest<Envelope<LeadSourceEntry>>('/v1/lead-sources', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiLeadSourceResponseSchema, response, 'leadSources.create')
    return response.data
  },
}
