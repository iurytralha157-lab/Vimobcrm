import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types'
import { vimobAPIRequest } from './vimob-client'

type LeadInsert = TablesInsert<'leads'>
type LeadUpdate = TablesUpdate<'leads'>
type LeadRow = Tables<'leads'>

type APILead = {
  id: string
  organizationId: string
  name: string
  email?: string
  phone?: string
  source: string
  status: string
  dealStatus: string
  lostReason?: string
  priority: string
  message?: string
  propertyCode?: string
  propertyId?: string
  interestPropertyId?: string
  pipelineId?: string
  stageId?: string
  assignedUserId?: string
  interestValue?: string
  isOwnResource?: boolean
  reentryCount: number
  stage?: {
    id: string
    name: string
    color?: string
    stageKey?: string
  }
  assignee?: {
    id: string
    name: string
    avatarUrl?: string
  }
  createdAt: string
  updatedAt: string
  stageEnteredAt?: string
  lastContactAt?: string
  nextFollowUpAt?: string
  additionalFields?: {
    cargo?: string
    empresa?: string
    profissao?: string
    endereco?: string
    bairro?: string
    numero?: string
    cep?: string
    cidade?: string
    uf?: string
    rendaFamiliar?: string
    faixaValorImovel?: string
  }
}

type APILeadListResponse = {
  data: APILead[]
  total: number
  limit: number
  offset: number
}

type APILeadResponse = {
  data: APILead
  reentry?: boolean
  assignedUserName?: string
}

type APIRoundRobinResponse = {
  success: boolean
  leadId: string
  pipelineId?: string
  stageId?: string
  assignedUserId?: string
  roundRobinUsed: boolean
  roundRobinId?: string
  error?: string
}

type Envelope<T> = {
  data: T
}

type LeadAPIOptions = {
  limit?: number
  offset?: number
  stageId?: string
  assigneeId?: string
  assigned?: 'none'
  search?: string
  dealStatus?: string
}

type LeadCreateInput = Partial<LeadInsert> & {
  tag_ids?: string[]
  conversation_id?: string
}

type LeadMoveStageInput = {
  stageId: string
  isOwnResource?: boolean | null
  stageEnteredAt?: string | null
}

// Leads API functions
export const leadsAPI = {
  async getLeads(organizationId: string, options?: LeadAPIOptions) {
    const response = await vimobAPIRequest<APILeadListResponse>('/v1/leads', {
      organizationId,
      query: {
        limit: options?.limit,
        offset: options?.offset,
        stageId: options?.stageId,
        assignedUserId: options?.assigneeId,
        assigned: options?.assigned,
        search: options?.search,
        dealStatus: options?.dealStatus,
      },
    })

    return {
      data: response.data.map(toLegacyLead),
      count: response.total,
      error: null,
      limit: response.limit,
      offset: response.offset,
    }
  },

  async getLead(leadId: string, organizationId: string) {
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}`, {
      organizationId,
    })

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async createLead(organizationId: string, data: LeadCreateInput) {
    const response = await vimobAPIRequest<APILeadResponse>('/v1/leads', {
      method: 'POST',
      organizationId,
      body: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        source: data.source,
        message: data.message,
        propertyCode: data.property_code,
        propertyId: data.property_id,
        pipelineId: data.pipeline_id,
        stageId: data.stage_id,
        assignedUserId: data.assigned_user_id,
        interestValue: data.valor_interesse == null ? undefined : String(data.valor_interesse),
        dealStatus: data.deal_status,
        lostReason: data.lost_reason,
        isOwnResource: data.is_own_resource,
        conversationId: data.conversation_id,
        tagIds: data.tag_ids,
        cargo: data.cargo,
        empresa: data.empresa,
        profissao: data.profissao,
        endereco: data.endereco,
        bairro: data.bairro,
        numero: data.numero,
        cep: data.cep,
        cidade: data.cidade,
        uf: data.uf,
        rendaFamiliar: data.renda_familiar,
        faixaValorImovel: data.faixa_valor_imovel,
      },
    })

    return {
      data: toLegacyLead(response.data),
      error: null,
      reentry: Boolean(response.reentry),
      assignedUserName: response.assignedUserName,
    }
  },

  async updateLead(leadId: string, data: LeadUpdate, organizationId?: string) {
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}`, {
      method: 'PATCH',
      organizationId,
      body: toAPILeadUpdateBody(data),
    })

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async moveLeadStage(leadId: string, data: LeadMoveStageInput, organizationId?: string) {
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}/move-stage`, {
      method: 'POST',
      organizationId,
      body: {
        stageId: data.stageId,
        isOwnResource: data.isOwnResource,
        stageEnteredAt: data.stageEnteredAt,
      },
    })

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async assignLead(leadId: string, assignedUserId: string | null, organizationId?: string) {
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}/assign`, {
      method: 'POST',
      organizationId,
      body: {
        assignedUserId,
      },
    })

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async redistributeLeadRoundRobin(leadId: string, organizationId?: string) {
    const response = await vimobAPIRequest<APIRoundRobinResponse>(`/v1/leads/${leadId}/redistribute`, {
      method: 'POST',
      organizationId,
    })

    return {
      success: response.success,
      lead_id: response.leadId,
      pipeline_id: response.pipelineId || null,
      stage_id: response.stageId || null,
      assigned_user_id: response.assignedUserId || null,
      round_robin_used: response.roundRobinUsed,
      round_robin_id: response.roundRobinId || null,
      error: response.error,
    }
  },

  async deleteLead(leadId: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/leads/${leadId}`, {
      method: 'DELETE',
      organizationId,
    })

    return { error: null }
  },

  async addLeadTag(leadId: string, tagId: string, organizationId?: string) {
    await vimobAPIRequest<{ ok: boolean }>(`/v1/leads/${leadId}/tags`, {
      method: 'POST',
      organizationId,
      body: { tagId },
    })

    return { error: null }
  },

  async removeLeadTag(leadId: string, tagId: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/leads/${leadId}/tags/${tagId}`, {
      method: 'DELETE',
      organizationId,
    })

    return { error: null }
  },

  async getLeadTimeline<T = unknown>(leadId: string, organizationId?: string) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/leads/${leadId}/timeline`, {
      organizationId,
    })
    return response.data
  },

  async getLeadJourney<T = unknown>(leadId: string, organizationId?: string) {
    const response = await vimobAPIRequest<Envelope<T[]>>(`/v1/leads/${leadId}/journey`, {
      organizationId,
    })
    return response.data
  },

  async getLeadHistoryRaw<T = unknown>(leadId: string, organizationId?: string) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/leads/${leadId}/history-raw`, {
      organizationId,
    })
    return response.data
  },

  async getFirstResponseMetrics<T = unknown>(
    filters: {
      userId?: string
      pipelineId?: string
      dateFrom?: string
      dateTo?: string
      slaSeconds?: number
    } = {},
    organizationId?: string,
  ) {
    const response = await vimobAPIRequest<Envelope<T>>('/v1/lead-analytics/first-response-metrics', {
      organizationId,
      query: filters,
    })
    return response.data
  },

  async getFirstResponseRanking<T = unknown>(
    filters: {
      pipelineId?: string
      dateFrom?: string
      dateTo?: string
      slaSeconds?: number
    } = {},
    organizationId?: string,
  ) {
    const response = await vimobAPIRequest<Envelope<T[]>>('/v1/lead-analytics/first-response-ranking', {
      organizationId,
      query: filters,
    })
    return response.data
  },

  async recordFirstResponse(
    leadId: string,
    params: {
      organizationId?: string
      channel: 'whatsapp' | 'phone' | 'email' | 'message' | 'manual'
      actorUserId?: string | null
      isAutomation?: boolean
    },
  ) {
    const response = await vimobAPIRequest<Envelope<Record<string, unknown>>>(`/v1/leads/${leadId}/first-response`, {
      method: 'POST',
      organizationId: params.organizationId,
      body: {
        lead_id: leadId,
        organization_id: params.organizationId,
        channel: params.channel,
        actor_user_id: params.actorUserId,
        is_automation: params.isAutomation || false,
      },
    })
    return response.data
  },
}

function nullableDecimal(value: number | null | undefined) {
  if (value === undefined) return undefined
  if (value === null) return null
  return String(value)
}

function toAPILeadUpdateBody(data: LeadUpdate) {
  return {
    name: data.name,
    email: data.email,
    phone: data.phone,
    source: data.source,
    message: data.message,
    propertyCode: data.property_code,
    propertyId: data.property_id,
    interestPropertyId: data.interest_property_id,
    pipelineId: data.pipeline_id,
    stageId: data.stage_id,
    assignedUserId: data.assigned_user_id,
    interestValue: nullableDecimal(data.valor_interesse),
    commissionPercentage: nullableDecimal(data.commission_percentage),
    dealStatus: data.deal_status,
    lostReason: data.lost_reason,
    feedback: data.feedback,
    cargo: data.cargo,
    empresa: data.empresa,
    profissao: data.profissao,
    endereco: data.endereco,
    numero: data.numero,
    complemento: data.complemento,
    bairro: data.bairro,
    cep: data.cep,
    cidade: data.cidade,
    uf: data.uf,
    rendaFamiliar: data.renda_familiar,
    faixaValorImovel: data.faixa_valor_imovel,
    finalidadeCompra: data.finalidade_compra,
    trabalha: data.trabalha,
    procuraFinanciamento: data.procura_financiamento,
    isOwnResource: data.is_own_resource,
  }
}

export function toLegacyLead(lead: APILead): LeadRow & {
  stage?: { id: string; name: string; color: string | null; stage_key: string | null }
  assignee?: { id: string; name: string; avatar_url: string | null }
  tags?: []
} {
  return {
    assigned_at: null,
    assigned_user_id: lead.assignedUserId || null,
    bairro: lead.additionalFields?.bairro || null,
    cargo: lead.additionalFields?.cargo || null,
    cep: lead.additionalFields?.cep || null,
    cidade: lead.additionalFields?.cidade || null,
    commission_percentage: null,
    complemento: null,
    created_at: lead.createdAt,
    deal_status: lead.dealStatus,
    email: lead.email || null,
    empresa: lead.additionalFields?.empresa || null,
    endereco: lead.additionalFields?.endereco || null,
    faixa_valor_imovel: lead.additionalFields?.faixaValorImovel || null,
    feedback: null,
    finalidade_compra: null,
    first_response_actor_user_id: null,
    first_response_at: null,
    first_response_channel: null,
    first_response_is_automation: null,
    first_response_seconds: null,
    first_touch_actor_user_id: null,
    first_touch_at: null,
    first_touch_channel: null,
    first_touch_seconds: null,
    id: lead.id,
    initial_message: null,
    interest_plan_id: null,
    interest_property_id: lead.interestPropertyId || null,
    is_own_resource: lead.isOwnResource ?? null,
    last_entry_at: null,
    lost_at: null,
    lost_reason: lead.lostReason || null,
    message: lead.message || null,
    meta_ad_id: null,
    meta_adset_id: null,
    meta_campaign_id: null,
    meta_click_id: null,
    meta_form_id: null,
    meta_lead_id: null,
    name: lead.name,
    numero: lead.additionalFields?.numero || null,
    organization_id: lead.organizationId,
    phone: lead.phone || null,
    pipeline_id: lead.pipelineId || null,
    procura_financiamento: null,
    profissao: lead.additionalFields?.profissao || null,
    property_code: lead.propertyCode || null,
    property_id: lead.propertyId || null,
    redistribution_count: 0,
    reentry_count: lead.reentryCount,
    renda_familiar: lead.additionalFields?.rendaFamiliar || null,
    source: lead.source,
    source_session_id: null,
    source_webhook_id: null,
    stage_entered_at: lead.stageEnteredAt || null,
    stage_id: lead.stageId || null,
    trabalha: null,
    uf: lead.additionalFields?.uf || null,
    updated_at: lead.updatedAt,
    utm_campaign: null,
    utm_content: null,
    utm_medium: null,
    utm_source: null,
    utm_term: null,
    valor_interesse: lead.interestValue ? Number(lead.interestValue) : null,
    visitor_session_id: null,
    whatsapp_avatar_synced_at: null,
    whatsapp_avatar_url: null,
    whatsapp_verified: null,
    won_at: null,
    stage: lead.stage
      ? {
          id: lead.stage.id,
          name: lead.stage.name,
          color: lead.stage.color || null,
          stage_key: lead.stage.stageKey || null,
        }
      : undefined,
    assignee: lead.assignee
      ? {
          id: lead.assignee.id,
          name: lead.assignee.name,
          avatar_url: lead.assignee.avatarUrl || null,
        }
      : undefined,
    tags: [],
  }
}
