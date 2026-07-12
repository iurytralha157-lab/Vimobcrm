import {
  apiGamificationAdminResponseSchema,
  apiGamificationEventPageResponseSchema,
  apiGamificationManualEntryResponseSchema,
  apiGamificationMissionResponseSchema,
  apiGamificationOverviewResponseSchema,
  apiGamificationRankingResponseSchema,
  apiGamificationParticipantResponseSchema,
  apiGamificationRuleResponseSchema,
  apiGamificationSeasonResponseSchema,
  gamificationDecisionInputSchema,
  gamificationEventListQuerySchema,
  gamificationManualEntryInputSchema,
  gamificationMissionInputSchema,
  gamificationParticipantInputSchema,
  gamificationRuleInputSchema,
  gamificationRankingQuerySchema,
  gamificationSeasonInputSchema,
  parseDomainInput,
  validateDomainResponse,
  type GamificationActionType,
} from '@/lib/validation'
import { vimobAPIRequest } from './vimob-client'

export type { GamificationActionType } from '@/lib/validation'

type Envelope<T> = {
  data: T
}

export interface GamificationRankingEntry {
  userId: string
  name: string
  avatarUrl: string | null
  points: number
  xp: number
  level: number
  rank: string
  streakDays: number
  xpCurrentLevel: number
  xpNextLevel: number
  lastActivityAt: string | null
  position: number
  isCurrentUser: boolean
}

export interface GamificationEvent {
  id: string
  userId: string | null
  userName: string
  eventType: string
  points: number
  createdAt: string | null
  details: string | null
  source: string | null
}

export interface GamificationEventPage {
  events: GamificationEvent[]
  total: number
  nextCursor: string | null
}

export interface GamificationMission {
  id: string
  title: string
  description: string | null
  actionType: GamificationActionType | null
  targetCount: number
  currentProgress: number
  bonusPoints: number
  period: string | null
  isActive: boolean
  targetScope: 'organization' | 'user' | string
  targetUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export interface GamificationPerformanceDay {
  name: string
  points: number
  actions: number
}

export interface GamificationPerformance {
  chartData: GamificationPerformanceDay[]
  metrics: {
    points: number
    growth: number
    avgActionsPerDay: number
    totalActions: number
    efficiency: number
    consistency: number
  }
  distribution: Array<{
    label: string
    value: number
  }>
}

export interface GamificationOverview {
  ranking: GamificationRankingEntry[]
  recentEvents: GamificationEvent[]
  history: GamificationEvent[]
  missions: GamificationMission[]
  performance: GamificationPerformance
  totalPoints: number
  activeUsers: number
  totalEvents: number
  myPosition: number | null
}

export interface GamificationRule {
  id: string
  actionType: GamificationActionType
  points: number
  isActive: boolean
  isTemp: boolean
}

export interface GamificationParticipant {
  userId: string
  name: string
  email: string
  role: string
  isActive: boolean
  participates: boolean
  points: number
}

export interface GamificationSeason {
  id: string
  name: string
  resetReason: string | null
  isActive: boolean
  startedAt: string | null
  endedAt: string | null
  createdAt: string | null
}

export interface GamificationManualEntry {
  id: string
  userId: string
  userName: string
  actionKey: GamificationActionType
  quantity: number
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  approvedBy: string | null
  approvedAt: string | null
  rejectionReason: string | null
  awardedAt: string | null
  awardStatus: 'pending' | 'processing' | 'completed' | 'skipped' | 'dead' | null
  createdAt: string | null
}

export interface GamificationUserOption {
  id: string
  name: string
}

export interface GamificationAdminSnapshot {
  rules: GamificationRule[]
  missions: GamificationMission[]
  participants: GamificationParticipant[]
  seasons: GamificationSeason[]
  myManualEntries: GamificationManualEntry[]
  pendingManualEntries: GamificationManualEntry[]
  users: GamificationUserOption[]
  canManage: boolean
}

export type GamificationMissionInput = {
  title: string
  description?: string | null
  actionType?: GamificationActionType | null
  targetCount: number
  bonusPoints: number
  period?: string | null
  targetScope: 'organization' | 'user'
  targetUserId?: string | null
  isActive?: boolean
}

export type GamificationRankingQuery = {
  from?: string
  to?: string
  actionTypes?: GamificationActionType[]
}

export type GamificationEventListQuery = {
  from?: string
  to?: string
  userId?: string
  limit?: number
  cursor?: string
}

export const gamificationAPI = {
  async getOverview(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationOverview>>('/v1/gamification/overview', {
      organizationId,
    })
    validateDomainResponse(apiGamificationOverviewResponseSchema, response, 'gamification.overview')
    return response.data
  },

  async getRanking(query: GamificationRankingQuery, organizationId?: string | null) {
    const filters = parseDomainInput(gamificationRankingQuerySchema, {
      ...query,
      actionTypes: query.actionTypes ?? [],
    }, 'gamification.ranking')
    const search = new URLSearchParams()
    if (filters.from) search.set('from', filters.from)
    if (filters.to) search.set('to', filters.to)
    for (const actionType of filters.actionTypes) search.append('actionType', actionType)
    const suffix = search.size > 0 ? `?${search.toString()}` : ''
    const response = await vimobAPIRequest<Envelope<GamificationRankingEntry[]>>(
      `/v1/gamification/ranking${suffix}`,
      { organizationId },
    )
    validateDomainResponse(apiGamificationRankingResponseSchema, response, 'gamification.ranking')
    return response.data
  },

  async getEvents(query: GamificationEventListQuery, organizationId?: string | null) {
    const filters = parseDomainInput(gamificationEventListQuerySchema, {
      ...query,
      limit: query.limit ?? 50,
    }, 'gamification.events')
    const search = new URLSearchParams()
    if (filters.from) search.set('from', filters.from)
    if (filters.to) search.set('to', filters.to)
    if (filters.userId) search.set('userId', filters.userId)
    if (filters.cursor) search.set('cursor', filters.cursor)
    search.set('limit', String(filters.limit))
    const response = await vimobAPIRequest<Envelope<GamificationEventPage>>(
      `/v1/gamification/events?${search.toString()}`,
      { organizationId },
    )
    validateDomainResponse(apiGamificationEventPageResponseSchema, response, 'gamification.events')
    return response.data
  },

  async getAdminSnapshot(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationAdminSnapshot>>('/v1/gamification/admin', {
      organizationId,
    })
    validateDomainResponse(apiGamificationAdminResponseSchema, response, 'gamification.admin')
    return response.data
  },

  async upsertRule(actionType: GamificationActionType, input: { points: number; isActive?: boolean }, organizationId?: string | null) {
    const body = parseDomainInput(gamificationRuleInputSchema, input, 'gamification.rules.upsert')
    const response = await vimobAPIRequest<Envelope<GamificationRule>>(
      `/v1/gamification/rules/${encodeURIComponent(actionType)}`,
      {
        method: 'PUT',
        body,
        organizationId,
      },
    )
    validateDomainResponse(apiGamificationRuleResponseSchema, response, 'gamification.rules.upsert')
    return response.data
  },

  async setParticipant(userId: string, participates: boolean, organizationId?: string | null) {
    const body = parseDomainInput(gamificationParticipantInputSchema, { participates }, 'gamification.participants.update')
    const response = await vimobAPIRequest<Envelope<GamificationParticipant>>(
      `/v1/gamification/participants/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body,
        organizationId,
      },
    )
    validateDomainResponse(apiGamificationParticipantResponseSchema, response, 'gamification.participants.update')
    return response.data
  },

  async createMission(input: GamificationMissionInput, organizationId?: string | null) {
    const body = parseDomainInput(gamificationMissionInputSchema, input, 'gamification.missions.create')
    const response = await vimobAPIRequest<Envelope<GamificationMission>>('/v1/gamification/missions', {
      method: 'POST',
      body,
      organizationId,
    })
    validateDomainResponse(apiGamificationMissionResponseSchema, response, 'gamification.missions.create')
    return response.data
  },

  async updateMission(id: string, input: GamificationMissionInput, organizationId?: string | null) {
    const body = parseDomainInput(gamificationMissionInputSchema, input, 'gamification.missions.update')
    const response = await vimobAPIRequest<Envelope<GamificationMission>>(
      `/v1/gamification/missions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body,
        organizationId,
      },
    )
    validateDomainResponse(apiGamificationMissionResponseSchema, response, 'gamification.missions.update')
    return response.data
  },

  async deleteMission(id: string, organizationId?: string | null) {
    await vimobAPIRequest<void>(`/v1/gamification/missions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async createManualEntry(input: { actionKey: GamificationActionType; quantity: number; notes: string }, organizationId?: string | null) {
    const body = parseDomainInput(gamificationManualEntryInputSchema, input, 'gamification.manual-entries.create')
    const response = await vimobAPIRequest<Envelope<GamificationManualEntry>>('/v1/gamification/manual-entries', {
      method: 'POST',
      body,
      organizationId,
    })
    validateDomainResponse(apiGamificationManualEntryResponseSchema, response, 'gamification.manual-entries.create')
    return response.data
  },

  async decideManualEntry(
    id: string,
    input: { status: 'approved' | 'rejected'; reason?: string },
    organizationId?: string | null,
  ) {
    const body = parseDomainInput(gamificationDecisionInputSchema, input, 'gamification.manual-entries.decide')
    const response = await vimobAPIRequest<Envelope<GamificationManualEntry>>(
      `/v1/gamification/manual-entries/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body,
        organizationId,
      },
    )
    validateDomainResponse(apiGamificationManualEntryResponseSchema, response, 'gamification.manual-entries.decide')
    return response.data
  },

  async resetSeason(input: { name: string; reason: string }, organizationId?: string | null) {
    const body = parseDomainInput(gamificationSeasonInputSchema, input, 'gamification.seasons.reset')
    const response = await vimobAPIRequest<Envelope<GamificationSeason>>('/v1/gamification/seasons', {
      method: 'POST',
      body,
      organizationId,
    })
    validateDomainResponse(apiGamificationSeasonResponseSchema, response, 'gamification.seasons.reset')
    return response.data
  },
}
