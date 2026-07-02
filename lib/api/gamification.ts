import { vimobAPIRequest } from './vimob-client'

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

export interface GamificationMission {
  id: string
  title: string
  description: string | null
  actionType: string | null
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
  actionType: string
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
  actionKey: string
  quantity: number
  notes: string | null
  status: 'pending' | 'approved' | 'rejected'
  approvedBy: string | null
  approvedAt: string | null
  rejectionReason: string | null
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
  actionType?: string | null
  targetCount: number
  bonusPoints: number
  period?: string | null
  targetScope: 'organization' | 'user'
  targetUserId?: string | null
  isActive?: boolean
}

export const gamificationAPI = {
  async getOverview(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationOverview>>('/v1/gamification/overview', {
      organizationId,
    })
    return response.data
  },

  async getAdminSnapshot(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationAdminSnapshot>>('/v1/gamification/admin', {
      organizationId,
    })
    return response.data
  },

  async upsertRule(actionType: string, input: { points: number; isActive?: boolean }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationRule>>(
      `/v1/gamification/rules/${encodeURIComponent(actionType)}`,
      {
        method: 'PUT',
        body: input,
        organizationId,
      },
    )
    return response.data
  },

  async setParticipant(userId: string, participates: boolean, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationParticipant>>(
      `/v1/gamification/participants/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        body: { participates },
        organizationId,
      },
    )
    return response.data
  },

  async createMission(input: GamificationMissionInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationMission>>('/v1/gamification/missions', {
      method: 'POST',
      body: input,
      organizationId,
    })
    return response.data
  },

  async updateMission(id: string, input: GamificationMissionInput, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationMission>>(
      `/v1/gamification/missions/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: input,
        organizationId,
      },
    )
    return response.data
  },

  async deleteMission(id: string, organizationId?: string | null) {
    await vimobAPIRequest<void>(`/v1/gamification/missions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      organizationId,
    })
  },

  async createManualEntry(input: { actionKey: string; quantity: number; notes: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationManualEntry>>('/v1/gamification/manual-entries', {
      method: 'POST',
      body: input,
      organizationId,
    })
    return response.data
  },

  async decideManualEntry(
    id: string,
    input: { status: 'approved' | 'rejected'; reason?: string },
    organizationId?: string | null,
  ) {
    const response = await vimobAPIRequest<Envelope<GamificationManualEntry>>(
      `/v1/gamification/manual-entries/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: input,
        organizationId,
      },
    )
    return response.data
  },

  async resetSeason(input: { name: string; reason: string }, organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationSeason>>('/v1/gamification/seasons', {
      method: 'POST',
      body: input,
      organizationId,
    })
    return response.data
  },
}
