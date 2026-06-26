import { vimobAPIRequest } from './vimob-client'
import type { Json } from '@/integrations/supabase/types'

export interface LeadMeta {
  id: string
  lead_id: string
  page_id: string | null
  form_id: string | null
  ad_id: string | null
  adset_id: string | null
  campaign_id: string | null
  ad_name: string | null
  adset_name: string | null
  campaign_name: string | null
  platform: string | null
  raw_payload: Json
  created_at: string
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
  form_name: string | null
  source_type: 'meta' | 'webhook' | string | null
  contact_notes: string | null
  creative_url: string | null
  creative_video_url: string | null
  creative_instagram_url?: string | null
}

type LeadMetaResponse = {
  data: LeadMeta | null
}

export const leadMetaAPI = {
  async get(leadId: string) {
    const response = await vimobAPIRequest<LeadMetaResponse>('/v1/lead-meta', {
      query: { leadId },
    })
    return response.data
  },
}
