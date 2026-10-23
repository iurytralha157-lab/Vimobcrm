import type { Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/types'
import {
  apiCreateLeadResponseSchema,
  apiLeadListResponseSchema,
  apiLeadResponseSchema,
  apiLeadRoundRobinResponseSchema,
	apiLeadSensitiveProfileResponseSchema,
  leadAssignInputSchema,
  queuePoolClaimInputSchema,
  uuidSchema,
  leadCreateInputSchema,
  leadListQuerySchema,
  leadMoveStageInputSchema,
  leadRedistributeInputSchema,
  leadTagInputSchema,
  leadUpdateInputSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest, type VimobAPIRequestIntent } from './vimob-client'
import type { LeadDistributionOutcome } from '@/lib/lead-distribution-outcome'
import { captureCurrentLeadRequestIntent } from '@/lib/api/lead-request-intent'
import { VimobAPIError } from '@/lib/api/vimob-error'
import {
  assertLeadMoveStageContractCurrent, getLeadMoveStageContract, invalidateLeadMoveStageContract,
  LeadMoveContractError, type LeadMoveStageContract,
} from '@/lib/api/lead-move-contract'
import { leadHistoryLegacyResponseSchema, leadHistoryPageInputSchema, leadHistoryPageResponseSchema } from '@/lib/validation/lead-history-pagination'
import { toQueuePool } from '@/lib/queue-pool'
import type { APIQueuePool, QueuePool, QueuePoolClaimInput } from '@/lib/validation/queue-runtime'

type LeadInsert = TablesInsert<'leads'>
export type LeadUpdateInput = TablesUpdate<'leads'> & {
  expectedUpdatedAt?: string
  team_id?: string | null
  interest_property_ids?: string[]
  profile?: {
    personType?: 'individual' | 'company'
    gender?: 'male' | 'female' | 'other'
    socialName?: string
    birthDate?: string
    cpf?: string
    rg?: string
    cnpj?: string
    corporateName?: string
    tradeName?: string
    stateRegistration?: string
  }
}
export type LeadSensitiveProfile = {
	cpf?: string
	rg?: string
}
type LeadRow = Tables<'leads'>

type APILead = {
  id: string
  organizationId: string
  canOperate?: boolean
  financialReviewRequired?: boolean
  queuePool?: APIQueuePool | null
  tags?: Array<{ id: string; name: string | null; color: string | null }> | null
  name: string
  email?: string
  phone?: string
  whatsappAvatarUrl?: string
  whatsappAvatarSyncedAt?: string
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
  teamId?: string
  interestValue?: string
  commissionPercentage?: string
  feedback?: string
  finalidadeCompra?: string
  trabalha?: boolean
  procuraFinanciamento?: boolean
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
  boardOrderAt?: string
  lastContactAt?: string
  nextFollowUpAt?: string
  firstResponseAt?: string
  firstResponseSeconds?: number
  firstResponseChannel?: string
  firstResponseIsAutomation?: boolean
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
    personType?: 'individual' | 'company'
    gender?: 'male' | 'female' | 'other'
    socialName?: string
    birthDate?: string
	hasCPF?: boolean
	hasRG?: boolean
    cnpj?: string
    corporateName?: string
    tradeName?: string
    stateRegistration?: string
    interestPropertyIds?: string[]
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
  distributionOutcome?: LeadDistributionOutcome
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
  expected_previous_lead_id?: string
  confirm_history_link?: true
  import_mode?: boolean
  import_request_key?: string
  auto_distribute?: boolean
  round_robin_id?: string
  team_id?: string
  feedback?: string
  interest_property_ids?: string[]
  profile?: {
    personType?: 'individual' | 'company'
    gender?: 'male' | 'female' | 'other'
    socialName?: string
    birthDate?: string
    cpf?: string
    rg?: string
    cnpj?: string
    corporateName?: string
    tradeName?: string
    stateRegistration?: string
  }
}

type LeadMoveStageInput = {
  stageId: string
  expectedStageId?: string | null
  expectedUpdatedAt?: string
  isOwnResource?: boolean | null
  boardOrderAt?: string | null
  lostReason?: string | null
}

// Leads API functions
export const leadsAPI = {
  async getLeads(organizationId: string, options?: LeadAPIOptions) {
    const query = parseDomainInput(leadListQuerySchema, options ?? {}, 'leads.list')
    const response = await vimobAPIRequest<APILeadListResponse>('/v1/leads', {
      organizationId,
      query: {
        limit: query.limit,
        offset: query.offset,
        stageId: query.stageId,
        assignedUserId: query.assigneeId,
        assigned: query.assigned,
        search: query.search,
        dealStatus: query.dealStatus,
      },
    })
    validateDomainResponse(apiLeadListResponseSchema, response, 'leads.list')

    return {
      data: response.data.map(toLegacyLead),
      count: response.total,
      error: null,
      limit: response.limit,
      offset: response.offset,
    }
  },

  async getLead(leadId: string, organizationId: string, signal?: AbortSignal, options: VimobAPIRequestIntent & { retry?: boolean } = {}) {
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}`, {
      ...options,
      organizationId,
      cache: 'no-store',
      signal,
      retry: options.retry,
    })
    validateDomainResponse(apiLeadResponseSchema, response, 'leads.get')

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

	async getSensitiveProfile(leadId: string, organizationId: string, intent?: VimobAPIRequestIntent) {
		const response = await vimobAPIRequest<{ data: LeadSensitiveProfile }>(`/v1/leads/${leadId}/sensitive-profile`, {
			...intent,
			organizationId,
		})
		validateDomainResponse(apiLeadSensitiveProfileResponseSchema, response, 'leads.sensitive-profile')
		return response.data
	},

  async createLead(organizationId: string, data: LeadCreateInput, intent?: VimobAPIRequestIntent) {
    const body = parseDomainInput(leadCreateInputSchema, {
      name: data.name,
      email: data.email,
      phone: data.phone,
      source: data.source,
      message: data.message,
      feedback: data.feedback,
      propertyCode: data.property_code,
      propertyId: data.property_id,
      interestPropertyIds: data.interest_property_ids,
      pipelineId: data.pipeline_id,
      stageId: data.stage_id,
      assignedUserId: data.assigned_user_id,
      teamId: data.team_id,
      interestValue: data.valor_interesse == null ? undefined : String(data.valor_interesse),
      dealStatus: data.deal_status,
      lostReason: data.lost_reason,
      isOwnResource: data.is_own_resource,
      conversationId: data.conversation_id,
      expectedPreviousLeadId: data.expected_previous_lead_id,
      confirmHistoryLink: data.confirm_history_link,
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
      profile: data.profile,
      importMode: data.import_mode,
      importRequestKey: data.import_request_key,
      autoDistribute: data.auto_distribute,
      roundRobinId: data.round_robin_id,
    }, 'leads.create')
    const payload = await vimobAPIRequest<unknown>('/v1/leads', {
      method: 'POST',
      organizationId,
      body,
      ...intent,
    })
    const response = validateDomainResponse(apiCreateLeadResponseSchema, payload, 'leads.create')

    return {
      data: response.data ? toLegacyLead(response.data) : null,
      leadId: response.leadId,
      leadVisible: response.leadVisible,
      error: null,
      reentry: Boolean(response.reentry),
      assignedUserName: 'assignedUserName' in response ? response.assignedUserName : undefined,
      distributionOutcome: response.distributionOutcome,
    }
  },

  async updateLead(leadId: string, data: LeadUpdateInput, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(leadUpdateInputSchema, toAPILeadUpdateBody(data), 'leads.update')
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}`, {
      method: 'PATCH',
      organizationId,
      body,
      ...requestIntent,
    })
    validateDomainResponse(apiLeadResponseSchema, response, 'leads.update')

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async moveLeadStage(leadId: string, data: LeadMoveStageInput, organizationId?: string, intent?: VimobAPIRequestIntent, preparedContract?: LeadMoveStageContract) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(leadMoveStageInputSchema, data, 'leads.move-stage')
    if (!body.expectedUpdatedAt) throw new VimobAPIError('Atualize o lead antes de mudar de etapa.', { code: 'lead_move_revision_required', status: 409 })
    const contract = preparedContract ?? await getLeadMoveStageContract(organizationId || '', requestIntent)
    assertLeadMoveStageContractCurrent(contract, organizationId || '', requestIntent)
    let response: APILeadResponse
    try {
      response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}/move-stage`, {
        method: 'POST', ...requestIntent, organizationId, body, retry: false,
        onRequestStart: () => {
          assertLeadMoveStageContractCurrent(contract, organizationId || '', requestIntent)
          requestIntent.onRequestStart?.()
        },
      })
    } catch (error) {
      if (error instanceof VimobAPIError && ((error.status === 400 && error.code === 'invalid_json')
        || (error.status === 404 && ['api_error', 'not_found', 'route_not_found'].includes(error.code)))) {
        invalidateLeadMoveStageContract(contract)
        throw new LeadMoveContractError(error.requestId)
      }
      throw error
    }
    validateDomainResponse(apiLeadResponseSchema, response, 'leads.move-stage')

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async claimQueuePool(leadId: string, input: QueuePoolClaimInput, idempotencyKey: string, organizationId: string, intent: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(queuePoolClaimInputSchema, input, 'leads.queue-pool.claim')
    const key = parseDomainInput(uuidSchema, idempotencyKey, 'leads.queue-pool.claim-key')
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}/claim-queue-pool`, {
      method: 'POST', ...requestIntent, organizationId, body, retry: false,
      headers: { 'Idempotency-Key': key },
    })
    validateDomainResponse(apiLeadResponseSchema, response, 'leads.queue-pool.claim')
    if (response.data.id !== leadId || response.data.organizationId !== organizationId) throw new Error('Não foi possível confirmar o lead assumido. Atualize os dados.')
    return { data: toLegacyLead(response.data), error: null }
  },

  async assignLead(leadId: string, assignedUserId: string | null, organizationId?: string, intent?: VimobAPIRequestIntent, expectedUpdatedAt?: string) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(leadAssignInputSchema, { assignedUserId, expectedUpdatedAt }, 'leads.assign')
    const response = await vimobAPIRequest<APILeadResponse>(`/v1/leads/${leadId}/assign`, {
      method: 'POST',
      ...requestIntent,
      organizationId,
      body,
      retry: false,
    })
    validateDomainResponse(apiLeadResponseSchema, response, 'leads.assign')

    return {
      data: toLegacyLead(response.data),
      error: null,
    }
  },

  async redistributeLeadRoundRobin(
    leadId: string,
    organizationId?: string,
    options?: { expectedUnassigned: boolean },
    intent?: VimobAPIRequestIntent,
  ) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const response = await vimobAPIRequest<APIRoundRobinResponse>(`/v1/leads/${leadId}/redistribute`, {
      method: 'POST',
      ...requestIntent,
      organizationId,
      ...(options ? { body: parseDomainInput(leadRedistributeInputSchema, options, 'leads.redistribute') } : {}),
    })
    validateDomainResponse(apiLeadRoundRobinResponseSchema, response, 'leads.redistribute')

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

  async deleteLead(leadId: string, organizationId?: string, intent?: VimobAPIRequestIntent) {
    await vimobAPIRequest<null>(`/v1/leads/${leadId}`, {
      method: 'DELETE',
      organizationId,
      ...intent,
    })

    return { error: null }
  },

  async addLeadTag(leadId: string, tagId: string, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const body = parseDomainInput(leadTagInputSchema, { tagId }, 'leads.add-tag')
    await vimobAPIRequest<{ ok: boolean }>(`/v1/leads/${leadId}/tags`, {
      method: 'POST',
      ...requestIntent,
      organizationId,
      body,
    })

    return { error: null }
  },

  async removeLeadTag(leadId: string, tagId: string, organizationId?: string, intent?: VimobAPIRequestIntent) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    await vimobAPIRequest<null>(`/v1/leads/${leadId}/tags/${tagId}`, {
      method: 'DELETE',
      ...requestIntent,
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

  async getLeadHistoryRaw<T = unknown>(leadId: string, organizationId?: string, options: { signal?: AbortSignal } = {}) {
    const response = await vimobAPIRequest<Envelope<T>>(`/v1/leads/${leadId}/history-raw`, {
      organizationId,
      signal: options.signal,
    })
    return response.data
  },

  async getLeadHistoryPage<T = unknown>(
    leadId: string,
    organizationId: string,
    options: { signal?: AbortSignal; pageSize?: number; cursor?: string; allowLegacy?: boolean } = {},
  ): Promise<{ data: T; pagination: { nextCursor: string | null; hasOlder: boolean; snapshotAt: string }; legacy?: false }
    | { data: T; legacy: true; pagination?: undefined }> {
    const query = parseDomainInput(leadHistoryPageInputSchema, {
      pageSize: options.pageSize ?? 100, cursor: options.cursor,
    }, 'lead history pagination')
    const response = await vimobAPIRequest<unknown>(`/v1/leads/${leadId}/history-raw`, {
      organizationId, query, signal: options.signal,
    })
    if (options.allowLegacy === true && !query.cursor) {
      const legacy = leadHistoryLegacyResponseSchema.safeParse(response)
      if (legacy.success && legacy.data.data.lead.id === leadId) {
        return { data: legacy.data.data as T, legacy: true }
      }
    }
    const validated = validateDomainResponse(leadHistoryPageResponseSchema, response, 'lead history page')
    return { data: validated.data as T, pagination: validated.pagination }
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
    intent?: VimobAPIRequestIntent,
  ) {
    const requestIntent = captureCurrentLeadRequestIntent(intent)
    const response = await vimobAPIRequest<Envelope<Record<string, unknown>>>(`/v1/leads/${leadId}/first-response`, {
      method: 'POST',
      ...requestIntent,
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

function toAPILeadUpdateBody(data: LeadUpdateInput) {
  return {
    expectedUpdatedAt: data.expectedUpdatedAt,
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
    teamId: data.team_id,
    interestPropertyIds: data.interest_property_ids,
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
    profile: data.profile,
  }
}

export function toLegacyLead(lead: APILead): LeadRow & {
  queue_pool: QueuePool | null
  can_operate?: boolean
  financial_review_required?: boolean
  stage?: { id: string; name: string; color: string | null; stage_key: string | null }
  assignee?: { id: string; name: string; avatar_url: string | null }
  tags?: Array<{ id: string; name: string; color: string }>
} {
  return {
    queue_pool: toQueuePool(lead.queuePool),
    ...(typeof lead.canOperate === 'boolean' ? { can_operate: lead.canOperate } : {}),
    financial_review_required: lead.financialReviewRequired === true,
    assigned_at: null,
    assigned_user_id: lead.assignedUserId || null,
    attention_eligible: false,
    attention_enrolled_at: null,
    bairro: lead.additionalFields?.bairro || null,
    cargo: lead.additionalFields?.cargo || null,
    cep: lead.additionalFields?.cep || null,
    cidade: lead.additionalFields?.cidade || null,
    commission_percentage: lead.commissionPercentage ? Number(lead.commissionPercentage) : null,
    complemento: null,
    created_at: lead.createdAt,
    created_by: null,
    deal_status: lead.dealStatus,
    email: lead.email || null,
    empresa: lead.additionalFields?.empresa || null,
    endereco: lead.additionalFields?.endereco || null,
    faixa_valor_imovel: lead.additionalFields?.faixaValorImovel || null,
    feedback: lead.feedback || null,
    finalidade_compra: lead.finalidadeCompra || null,
    first_response_actor_user_id: null,
    first_response_at: lead.firstResponseAt ?? null,
    first_response_channel: lead.firstResponseChannel ?? null,
    first_response_is_automation: lead.firstResponseIsAutomation ?? null,
    first_response_seconds: lead.firstResponseSeconds ?? null,
    first_touch_actor_user_id: null,
    first_touch_at: null,
    first_touch_channel: null,
    first_touch_seconds: null,
    id: lead.id,
    initial_message: null,
    interest_plan_id: null,
    interest_property_id: lead.interestPropertyId || null,
    is_own_resource: lead.isOwnResource ?? null,
    last_contact_at: lead.lastContactAt || null,
    last_entry_at: null,
    last_redistributed_at: null,
    lost_at: null,
    lost_reason: lead.lostReason || null,
    message: lead.message || null,
    meta_ad_id: null,
    meta_adset_id: null,
    meta_campaign_id: null,
    meta_click_id: null,
    meta_form_id: null,
    meta_lead_id: null,
    metadata: lead.additionalFields || null,
    name: lead.name,
    next_follow_up_at: lead.nextFollowUpAt || null,
    numero: lead.additionalFields?.numero || null,
    organization_id: lead.organizationId,
    owner_last_activity_at: null,
    owner_last_activity_user_id: null,
    phone: lead.phone || null,
    pipeline_id: lead.pipelineId || null,
    priority: lead.priority || null,
    procura_financiamento: lead.procuraFinanciamento ?? null,
    profissao: lead.additionalFields?.profissao || null,
    property_code: lead.propertyCode || null,
    property_id: lead.propertyId || null,
    redistribution_count: 0,
    redistribution_warning_sent_at: null,
    reentry_count: lead.reentryCount,
    renda_familiar: lead.additionalFields?.rendaFamiliar || null,
    sla_last_checked_at: null,
    sla_notified_overdue_at: null,
    sla_notified_warning_at: null,
    sla_seconds_elapsed: null,
    sla_status: null,
    source: lead.source,
    source_detail: null,
    source_session_id: null,
    source_webhook_id: null,
    board_order_at: lead.boardOrderAt || null,
    stage_entered_at: lead.stageEnteredAt || null,
    stage_id: lead.stageId || null,
    status: lead.status || null,
    team_id: lead.teamId || null,
    trabalha: lead.trabalha ?? null,
    uf: lead.additionalFields?.uf || null,
    updated_at: lead.updatedAt,
    utm_campaign: null,
    utm_content: null,
    utm_medium: null,
    utm_source: null,
    utm_term: null,
    valor_interesse: lead.interestValue ? Number(lead.interestValue) : null,
    visitor_session_id: null,
    whatsapp_avatar_storage_path: null,
    whatsapp_avatar_synced_at: lead.whatsappAvatarSyncedAt ?? null,
    whatsapp_avatar_url: lead.whatsappAvatarUrl ?? null,
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
    ...(Array.isArray(lead.tags) ? { tags: lead.tags.map(tag => ({
      id: tag.id, name: tag.name ?? '', color: tag.color ?? '',
    })) } : {}),
  }
}
