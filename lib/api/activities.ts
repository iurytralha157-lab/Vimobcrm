import { vimobAPIRequest } from './vimob-client'
import type { Json } from '@/integrations/supabase/types'

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
    const response = await vimobAPIRequest<Envelope<Activity[]>>('/v1/activities', {
      query: {
        leadId: options?.leadId,
        limit: options?.limit,
      },
    })
    return response.data
  },

  async create(activity: {
    lead_id: string
    type: string
    content?: string
    metadata?: Json
  }) {
    const response = await vimobAPIRequest<Envelope<Activity>>('/v1/activities', {
      method: 'POST',
      body: activity,
    })
    return response.data
  },
}
