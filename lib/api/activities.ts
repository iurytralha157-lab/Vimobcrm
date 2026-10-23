import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent'
import type { Json } from '@/lib/supabase/types'
import {
  activityListQuerySchema,
  apiActivityListResponseSchema,
  apiActivityResponseSchema,
  createActivityInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'

export type Activity = {
  id: string
  organization_id: string
  lead_id: string
  user_id: string | null
  type: string
  content: string | null
  metadata: Json
  created_at: string
  user?: { id: string; name: string }
  lead?: { id: string; name: string }
}

type Envelope<T> = {
  data: T
}

export const activitiesAPI = {
  async list(options?: { leadId?: string; limit?: number }) {
    const query = parseDomainInput(activityListQuerySchema, options ?? {}, 'activities.list')
    const response = await vimobAPIRequest<Envelope<Activity[]>>('/v1/activities', {
      query,
    })
    validateDomainResponse(apiActivityListResponseSchema, response, 'activities.list')
    return response.data
  },

  async create(activity: {
    lead_id: string
    type: string
    content?: string | null
    metadata?: Json
  }, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(createActivityInputSchema, activity, 'activities.create')
    const response = await vimobAPIRequest<Envelope<Activity>>('/v1/activities', {
      method: 'POST',
      organizationId,
      ...requestIntent,
      body,
    })
    validateDomainResponse(apiActivityResponseSchema, response, 'activities.create')
    return response.data
  },
}
