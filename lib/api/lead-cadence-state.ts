import {
  apiLeadCadenceStateResponseSchema,
  parseDomainInput,
  uuidSchema,
  validateDomainResponse,
  type LeadCadenceState,
} from '@/lib/validation'

import { vimobAPIRequest } from './vimob-client'

type Envelope<T> = {
  data: T
}

export const leadCadenceStateAPI = {
  async get(leadId: string, organizationId?: string | null) {
    const id = parseDomainInput(uuidSchema, leadId, 'lead-cadence-state.get.id')
    const response = await vimobAPIRequest<Envelope<LeadCadenceState>>(
      `/v1/leads/${id}/cadence-state`,
      { organizationId },
    )
    validateDomainResponse(
      apiLeadCadenceStateResponseSchema,
      response,
      'lead-cadence-state.get',
    )
    return response.data
  },
}
