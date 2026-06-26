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
}

export interface GamificationMission {
  id: string
  title: string
  description: string | null
  targetCount: number
  currentProgress: number
  bonusPoints: number
  period: string | null
}

export interface GamificationOverview {
  ranking: GamificationRankingEntry[]
  recentEvents: GamificationEvent[]
  missions: GamificationMission[]
  totalPoints: number
  activeUsers: number
  totalEvents: number
  myPosition: number | null
}

export const gamificationAPI = {
  async getOverview(organizationId?: string | null) {
    const response = await vimobAPIRequest<Envelope<GamificationOverview>>('/v1/gamification/overview', {
      organizationId,
    })
    return response.data
  },
}
