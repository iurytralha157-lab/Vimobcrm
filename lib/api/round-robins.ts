import type { Json, Tables } from '@/integrations/supabase/types'
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
  userId: string
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

type QueueConditionInput = {
  id?: string
  type: string
  values: string[]
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

export type LegacyRoundRobinMember = RoundRobinMemberRow & {
  user?: UserSummary | null
  is_active?: boolean | null
}

export const roundRobinsAPI = {
  async getRoundRobins(organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobin>>('/v1/round-robins', {
      organizationId,
    })

    return response.data.map(toLegacyRoundRobin)
  },

  async createRoundRobin(input: RoundRobinAPIInput, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobin>>('/v1/round-robins', {
      method: 'POST',
      organizationId,
      body: toAPIRoundRobinBody(input, true),
    })

    return toLegacyRoundRobin(response.data)
  },

  async updateRoundRobin(id: string, input: RoundRobinAPIInput, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobin>>(`/v1/round-robins/${id}`, {
      method: 'PATCH',
      organizationId,
      body: toAPIRoundRobinBody(input, false),
    })

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

    return response.data.map(toLegacyRule)
  },

  async createRule(input: { round_robin_id: string; match_type: string; match_value: string; match?: Json | Record<string, unknown> | null }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinRule>>(`/v1/round-robins/${input.round_robin_id}/rules`, {
      method: 'POST',
      organizationId,
      body: {
        matchType: input.match_type,
        matchValue: input.match_value,
        match: asRecord(input.match),
      },
    })

    return toLegacyRule(response.data)
  },

  async updateRule(id: string, input: { match_type?: string; match_value?: string; match?: Json | Record<string, unknown> | null; priority?: number; is_active?: boolean }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinRule>>(`/v1/round-robin-rules/${id}`, {
      method: 'PATCH',
      organizationId,
      body: {
        matchType: input.match_type,
        matchValue: input.match_value,
        match: input.match === undefined ? undefined : asRecord(input.match),
        priority: input.priority,
        isActive: input.is_active,
      },
    })

    return toLegacyRule(response.data)
  },

  async deleteRule(id: string, organizationId?: string) {
    await vimobAPIRequest<null>(`/v1/round-robin-rules/${id}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async addMember(input: { roundRobinId: string; userId?: string; teamId?: string; weight?: number }, organizationId?: string) {
    const response = await vimobAPIRequest<APIListResponse<APIRoundRobinMember>>(`/v1/round-robins/${input.roundRobinId}/members`, {
      method: 'POST',
      organizationId,
      body: {
        userId: input.userId,
        teamId: input.teamId,
        weight: input.weight,
      },
    })

    return response.data.map(toLegacyMember)
  },

  async updateMember(id: string, input: { weight?: number; position?: number; is_active?: boolean }, organizationId?: string) {
    const response = await vimobAPIRequest<APIItemResponse<APIRoundRobinMember>>(`/v1/round-robin-members/${id}`, {
      method: 'PATCH',
      organizationId,
      body: {
        weight: input.weight,
        position: input.position,
        isActive: input.is_active,
      },
    })

    return toLegacyMember(response.data)
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
    body.members = input.members.map((member) => {
      const type = member.type || (member.team_id ? 'team' : 'user')
      return {
        id: member.id,
        type,
        entityId: member.entityId || member.user_id || member.team_id,
        weight: member.weight,
      }
    })
  }

  return body
}

function toLegacyRoundRobin(item: APIRoundRobin): LegacyRoundRobin {
  return {
    ai_agent_id: null,
    created_at: item.createdAt,
    created_by: item.createdBy || null,
    id: item.id,
    is_active: item.isActive,
    last_assigned_index: item.lastAssignedIndex,
    leads_distributed: item.leadsDistributed,
    name: item.name,
    organization_id: item.organizationId,
    reentry_behavior: item.reentryBehavior || 'redistribute',
    settings: toJsonObject(item.settings),
    strategy: item.strategy || 'simple',
    target_pipeline_id: item.targetPipelineId || null,
    target_stage_id: item.targetStageId || null,
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
    rules: item.rules.map(toLegacyRule),
    members: item.members.map(toLegacyMember),
  }
}

function toLegacyRule(rule: APIRoundRobinRule): LegacyRoundRobinRule {
  return {
    id: rule.id,
    is_active: rule.isActive,
    match: toJsonObject(rule.match),
    match_type: rule.matchType,
    match_value: rule.matchValue,
    priority: rule.priority,
    round_robin_id: rule.roundRobinId,
  }
}

function toLegacyMember(member: APIRoundRobinMember): LegacyRoundRobinMember {
  return {
    id: member.id,
    leads_count: member.leadsCount,
    position: member.position,
    round_robin_id: member.roundRobinId,
    team_id: member.teamId || null,
    user_id: member.userId,
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
