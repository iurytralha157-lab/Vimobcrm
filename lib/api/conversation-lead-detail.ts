import { vimobAPIRequest } from './vimob-client'

export type ConversationLeadDetail = {
  id: string
  name: string
  phone: string | null
  email: string | null
  cidade: string | null
  uf: string | null
  source: string | null
  created_at: string
  valor_interesse: number | null
  property_id: string | null
  interest_property_id: string | null
  stage_id: string | null
  pipeline_id: string | null
  deal_status: string
  assigned_user_id: string | null
  commission_percentage: number | null
  stage: {
    id: string
    name: string
    color: string | null
  } | null
  pipeline: {
    id: string
    name: string
  } | null
  tags: Array<{
    tag: {
      id: string
      name: string
      color: string
    }
  }>
  meta: {
    ad_name: string | null
    campaign_name: string | null
    contact_notes: string | null
    creative_url: string | null
    creative_video_url: string | null
    form_name: string | null
    utm_campaign: string | null
    utm_medium: string | null
    utm_source: string | null
  } | null
}

type ConversationLeadDetailResponse = {
  data: ConversationLeadDetail
}

export const conversationLeadDetailAPI = {
  async get(leadId: string, organizationId?: string | null) {
    const response = await vimobAPIRequest<ConversationLeadDetailResponse>(`/v1/leads/${leadId}/conversation-detail`, {
      organizationId,
    })

    return response.data
  },
}
