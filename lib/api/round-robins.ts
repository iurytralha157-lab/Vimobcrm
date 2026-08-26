import type { Json, Tables } from '@/integrations/supabase/types'
import {
  addRoundRobinMemberInputSchema,
  apiRoundRobinListResponseSchema,
  apiRoundRobinMemberListResponseSchema,
  apiRoundRobinMemberResponseSchema,
  apiRoundRobinResponseSchema,
  apiRoundRobinRuleListResponseSchema,
  apiRoundRobinRuleResponseSchema,
  apiRoundRobinWhatsAppSessionOptionListResponseSchema,
  createRoundRobinInputSchema,
  createRoundRobinRuleInputSchema,
  parseDomainInput,
  updateRoundRobinInputSchema,
  updateRoundRobinMemberInputSchema,
  updateRoundRobinRuleInputSchema,
  validateDomainResponse,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

type RoundRobinRow = Tables<'round_robins'>
type RoundRobinRuleRow = Tables<'round_robin_rules'>
type RoundRobinMemberRow = Tables<'round_robin_members'>

type UserSummary = {
  id: string
  name?: string | null
  email?: string | null
  avatar_url?: string | null
}

type APIRoundRobin = {
  id: string
  organizationId: string
  name: string
  isActive: boolean
  lastAssignedIndex: number
  createdBy?: string
  createdByUser?: {
    id: string
    name?: string
    email?: string
  }
  strategy: string
  leadsDistributed: number
  targetPipelineId?: string
  targetStageId?: string
  settings?: Record<string, unknown>
  reentryBehavior?: 'redistribute' | 'keep_assignee'
  targetPipeline?: {
    id: string
    name: string
  }
  targetStage?: {
    id: string
    name: string
    color?: string
  }
  rules: APIRoundRobinRule[]
  members: APIRoundRobinMember[]
  createdAt: string
  updatedAt: string
}

type APIRoundRobinRule = {
  id: string
  roundRobinId: string
  matchType: string
  matchValue: string
  match?: Record<string, unknown>
  priority: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

type APIRoundRobinMember = {
  id: string
  roundRobinId: string
  userId?: string | null
  teamId?: string
  position: number
  weight: number
  isActive: boolean
  user?: {
    id: string
    name?: string
    email?: string
    avatarUrl?: string
  }
  leadsCount: number
}

type APIListResponse<T> = {
  data: T[]
}

type APIItemResponse<T> = {
  data: T
}

type APIRoundRobinWhatsAppSessionOption = {
  id: string
  instanceName: string
  displayName?: string
  phoneNumber?: string
  status: string
  provider: 'evolution_go'
  isActive: boolean
}

export type RoundRobinWhatsAppSessionOption = {
  id: string
  instance_name: string
  display_name: string | null
  phone_number: string | null
  status: string
  provider: 'evolution_go'
  is_active: boolean
}

type QueueConditionInput = {
  id?: string
  type: string
  values: string[]
  sessionId?: string
}

type QueueMemberInput = {
  id?: string
  type?: 'user' | 'team'
  entityId?: string
  user_id?: string
  team_id?: string
  weight?: number
  name?: string
}

export type RoundRobinAPIInput = {
  name?: string
  strategy?: string | null
  target_pipeline_id?: string | null
  target_stage_id?: string | null
  is_active?: boolean | null
  settings?: Record<string, unknown> | Json | null
  reentry_behavior?: 'redistribute' | 'keep_assignee' | null
  conditions?: QueueConditionInput[]
  rules?: Array<{
    match_type?: string
    match_value?: string
    match?: Json | Record<string, unknown> | null
    priority?: number | null
    is_active?: boolean | null
  }>
  members?: QueueMemberInput[]
}

export type LegacyRoundRobin = RoundRobinRow & {
  created_by_user?: { id: string; name: string | null; email: string | null } | null
  target_pipeline?: { id: string; name: string } | null
  target_stage?: { id: string; name: string; color: string | null } | null
  rules: LegacyRoundRobinRule[]
  members: LegacyRoundRobinMember[]
}

export type LegacyRoundRobinRule = RoundRobinRuleRow

export type LegacyRoundRobinMember = Omit<RoundRobinMemberRow, 'organization_id'> & {
  organization_id?: string
  user?: UserSummary | null
  is_active?: boolean | null
}

export const roundRobinsAPI = {
  async getWhatsAppSessionOptions(organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobinWhatsAppSessionOption>>(
      '/v1/round-robin-whatsapp-sessions',
      { organizationId },
    )
    validateDomainResponse(
      apiRoundRobinWhatsAppSessionOptionListResponseSchema,
      response,
      'round-robin.whatsapp-sessions.list',
    )

    return response.data.map((session): RoundRobinWhatsAppSessionOption => ({
      id: session.id,
      instance_name: session.instanceName,
      display_name: session.displayName || null,
      phone_number: session.phoneNumber || null,
      status: session.status,
      provider: session.provider,
      is_active: session.isActive,
    }))
  },

  async getRoundRobins(organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobin>>('/v1/round-robins', {
      organizationId,
    })
    validateDomainResponse(apiRoundRobinListResponseSchema, response, 'round-robin.list')

    return response.data.map(toLegacyRoundRobin)
  },

  async createRoundRobin(input: RoundRobinAPIInput, organizationId?: string) {
    const body = parseDomainInput(createRoundRobinInputSchema, toAPIRoundRobinBody(input, true), 'round-robin.create')
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobin>>('/v1/round-robins', {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinResponseSchema, response, 'round-robin.create')

    return toLegacyRoundRobin(response.data)
  },

  async updateRoundRobin(id: string, input: RoundRobinAPIInput, organizationId?: string) {
    const body = parseDomainInput(updateRoundRobinInputSchema, toAPIRoundRobinBody(input, false), 'round-robin.update')
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobin>>(`/v1/round-robins/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinResponseSchema, response, 'round-robin.update')

    return toLegacyRoundRobin(response.data)
  },

  async deleteRoundRobin(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/round-robins/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async getRules(roundRobinId?: string, organizationId?: string) {
    const path = roundRobinId ? `/v1/round-robins/${roundRobinId}/rules` : '/v1/round-robin-rules'
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobinRule>>(path, {
      organizationId,
    })
    validateDomainResponse(apiRoundRobinRuleListResponseSchema, response, 'round-robin.rules.list')

    return response.data.map((rule) => toLegacyRule(rule, organizationId))
  },

  async createRule(input: { round_robin_id: string; match_type: string; match_value: string; match?: Json | Record<string, unknown> | null }, organizationId?: string) {
    const body = parseDomainInput(createRoundRobinRuleInputSchema, {
      matchType: input.match_type,
      matchValue: input.match_value,
      match: asRecord(input.match),
    }, 'round-robin.rules.create')
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinRule>>(`/v1/round-robins/${input.round_robin_id}/rules`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinRuleResponseSchema, response, 'round-robin.rules.create')

    return toLegacyRule(response.data, organizationId)
  },

  async updateRule(id: string, input: { match_type?: string; match_value?: string; match?: Json | Record<string, unknown> | null; priority?: number; is_active?: boolean }, organizationId?: string) {
    const body = parseDomainInput(updateRoundRobinRuleInputSchema, {
      matchType: input.match_type,
      matchValue: input.match_value,
      match: input.match === undefined ? undefined : asRecord(input.match),
      priority: input.priority,
      isActive: input.is_active,
    }, 'round-robin.rules.update')
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinRule>>(`/v1/round-robin-rules/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinRuleResponseSchema, response, 'round-robin.rules.update')

    return toLegacyRule(response.data, organizationId)
  },

  async deleteRule(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/round-robin-rules/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async addMember(input: { roundRobinId: string; userId?: string; teamId?: string; weight?: number }, organizationId?: string) {
    const body = parseDomainInput(addRoundRobinMemberInputSchema, {
      userId: input.userId,
      teamId: input.teamId,
      weight: input.weight,
    }, 'round-robin.members.add')
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobinMember>>(`/v1/round-robins/${input.roundRobinId}/members`, {
      method: 'POST',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinMemberListResponseSchema, response, 'round-robin.members.add')

    return response.data.map((member) => toLegacyMember(member, organizationId))
  },

  async updateMember(id: string, input: { weight?: number; position?: number; is_active?: boolean }, organizationId?: string) {
    const body = parseDomainInput(updateRoundRobinMemberInputSchema, {
      weight: input.weight,
      position: input.position,
      isActive: input.is_active,
    }, 'round-robin.members.update')
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinMember>>(`/v1/round-robin-members/${id}`, {
      method: 'PATCH',
      organizationId,
      body,
    })
    validateDomainResponse(apiRoundRobinMemberResponseSchema, response, 'round-robin.members.update')

    return toLegacyMember(response.data, organizationId)
  },

  async deleteMember(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/round-robin-members/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },
}

function toAPIRoundRobinBody(input: RoundRobinAPIInput, includeRequired: boolean) {
  const body: Record<string, unknown> = {}

  if (includeRequired || input.name !== undefined) body.name = input.name
  if (input.strategy !== undefined) body.strategy = input.strategy || undefined
  if (input.target_pipeline_id !== undefined) body.targetPipelineId = input.target_pipeline_id || null
  if (input.target_stage_id !== undefined) body.targetStageId = input.target_stage_id || null
  if (input.is_active !== undefined) body.isActive = input.is_active
  if (input.settings !== undefined) body.settings = asRecord(input.settings)
  if (input.reentry_behavior !== undefined) body.reentryBehavior = input.reentry_behavior || undefined
  if (input.conditions !== undefined) body.conditions = input.conditions
  if (input.rules !== undefined) {
    body.rules = input.rules.map((rule) => ({
      matchType: rule.match_type,
      matchValue: rule.match_value,
      match: asRecord(rule.match),
      priority: rule.priority ?? undefined,
      isActive: rule.is_active ?? undefined,
    }))
  }
  if (input.members !== undefined) {
    body.members = input.members
      .map((member) => {
        const type = member.type || (member.team_id ? 'team' : 'user')
        const entityId = member.entityId || member.user_id || member.team_id
        return {
          id: member.id,
          type,
          entityId,
          weight: member.weight,
        }
      })
      .filter((member) => (member.type === 'user' || member.type === 'team') && Boolean(member.entityId))
  }

  return body
}

function toLegacyRoundRobin(item: APIRoundRobin): LegacyRoundRobin {
  return {
    ai_agent_id: null,
    created_at: item.createdAt,
    created_by: item.createdBy || null,
    current_position: null,
    id: item.id,
    is_active: item.isActive,
    last_assigned_index: item.lastAssignedIndex,
    leads_distributed: item.leadsDistributed,
    name: item.name,
    organization_id: item.organizationId,
    pipeline_id: null,
    reentry_behavior: item.reentryBehavior || 'redistribute',
    settings: toJsonObject(item.settings),
    strategy: item.strategy || 'simple',
    target_pipeline_id: item.targetPipelineId || null,
    target_stage_id: item.targetStageId || null,
    updated_at: item.updatedAt,
    created_by_user: item.createdByUser
      ? {
          id: item.createdByUser.id,
          name: item.createdByUser.name || null,
          email: item.createdByUser.email || null,
        }
      : null,
    target_pipeline: item.targetPipeline || null,
    target_stage: item.targetStage
      ? {
          id: item.targetStage.id,
          name: item.targetStage.name,
          color: item.targetStage.color || null,
        }
      : null,
    rules: item.rules.map((rule) => toLegacyRule(rule, item.organizationId)),
    members: item.members.map((member) => toLegacyMember(member, item.organizationId)),
  }
}

function toLegacyRule(rule: APIRoundRobinRule, organizationId?: string): LegacyRoundRobinRule {
  return {
    conditions: null,
    created_at: rule.createdAt,
    id: rule.id,
    is_active: rule.isActive,
    match: toJsonObject(rule.match),
    match_type: rule.matchType,
    match_value: rule.matchValue,
    name: null,
    organization_id: organizationId ?? null,
    priority: rule.priority,
    round_robin_id: rule.roundRobinId,
    updated_at: rule.updatedAt,
  }
}

function toLegacyMember(member: APIRoundRobinMember, organizationId?: string): LegacyRoundRobinMember {
  return {
    created_at: null,
    id: member.id,
    leads_count: member.leadsCount,
    organization_id: organizationId,
    position: member.position,
    round_robin_id: member.roundRobinId,
    team_id: member.teamId || null,
    updated_at: null,
    user_id: member.userId || null,
    weight: member.weight,
    is_active: member.isActive,
    user: member.user
      ? {
          id: member.user.id,
          name: member.user.name || null,
          email: member.user.email || null,
          avatar_url: member.user.avatarUrl || null,
        }
      : null,
  }
}

function asRecord(value: Json | Record<string, unknown> | null | undefined): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return undefined
}

function toJsonObject(value: Record<string, unknown> | undefined): Json {
  if (!value) return null
  return value as Json
}
