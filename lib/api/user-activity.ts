import { supabase } from '@/integrations/supabase/client'
import type { Json } from '@/integrations/supabase/types'
import {
  auditFeedEventPayloadSchema,
  onlineUserActivityListInputSchema,
  parseDomainInput,
  userActivityPresenceSessionInputSchema,
  userActivitySessionMutationInputSchema,
  type userActivitySessionStatusSchema,
} from '@/lib/validation'
import type { z } from 'zod'

type SupabaseError = {
  message: string
  code?: string
  details?: string
  hint?: string
}

export type UserActivitySessionStatus = z.infer<typeof userActivitySessionStatusSchema>

export type UserActivitySession = {
  id: string
  organization_id: string
  user_id: string
  session_id: string
  status: UserActivitySessionStatus
  current_path: string | null
  current_page_title: string | null
  connected_at: string
  last_seen_at: string
  disconnected_at: string | null
  user_agent: string | null
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type OnlineUserActivitySession = UserActivitySession & {
  user?: {
    id: string
    name: string | null
    email: string | null
    avatar_url: string | null
  } | null
}

export type UserPresencePayload = {
  organizationId: string
  userId: string
  sessionId: string
  status: UserActivitySessionStatus
  currentPath?: string | null
  currentPageTitle?: string | null
  metadata?: Record<string, unknown>
  lastSeenAt: string
}

export type UserPresenceState = Record<string, Array<UserPresencePayload & { presence_ref?: string }>>
export type AuditFeedEvent = z.infer<typeof auditFeedEventPayloadSchema>

type SessionMutationInput = z.infer<typeof userActivitySessionMutationInputSchema>

type ConnectAuditFeedOptions = {
  organizationId: string
  onEvent: (event: AuditFeedEvent) => void
  onSubscribed?: () => void
  onError?: (error: unknown) => void
}

type ConnectOrganizationPresenceOptions = SessionMutationInput & {
  onSync?: (state: UserPresenceState) => void
  onError?: (error: unknown) => void
  heartbeatMs?: number
  getPayload?: () => Partial<Pick<
    SessionMutationInput,
    'status' | 'currentPath' | 'currentPageTitle' | 'metadata'
  >>
}

function userActivitySessionsTable() {
  return supabase.from('user_activity_sessions')
}

function throwIfSupabaseError(error: SupabaseError | null) {
  if (error) {
    throw new Error(error.message)
  }
}

function toJson(value: Record<string, unknown>): Json {
  try {
    return JSON.parse(JSON.stringify(value)) as Json
  } catch {
    return {}
  }
}

function sessionInputToRow(input: SessionMutationInput, status: UserActivitySessionStatus) {
  const now = new Date().toISOString()

  return {
    organization_id: input.organizationId,
    user_id: input.userId,
    session_id: input.sessionId,
    status,
    current_path: input.currentPath ?? null,
    current_page_title: input.currentPageTitle ?? null,
    last_seen_at: now,
    disconnected_at: status === 'offline' ? now : null,
    user_agent: input.userAgent ?? null,
    metadata: toJson(input.metadata ?? {}),
  }
}

function normalizePresenceState(state: unknown): UserPresenceState {
  if (!state || typeof state !== 'object') return {}
  return state as UserPresenceState
}

export async function startUserActivitySession(input: SessionMutationInput) {
  const parsed = parseDomainInput(userActivitySessionMutationInputSchema, input, 'user-activity.start')
  const row = {
    ...sessionInputToRow(parsed, parsed.status ?? 'online'),
    connected_at: new Date().toISOString(),
  }

  const { data, error } = await userActivitySessionsTable()
    .upsert(row, { onConflict: 'organization_id,user_id,session_id' })
    .select('*')
    .single()

  throwIfSupabaseError(error)
  return data
}

export async function touchUserActivitySession(input: SessionMutationInput) {
  const parsed = parseDomainInput(userActivitySessionMutationInputSchema, input, 'user-activity.touch')
  const row = sessionInputToRow(parsed, parsed.status ?? 'online')

  const { data, error } = await userActivitySessionsTable()
    .update(row)
    .eq('organization_id', parsed.organizationId)
    .eq('user_id', parsed.userId)
    .eq('session_id', parsed.sessionId)
    .select('*')
    .single()

  throwIfSupabaseError(error)
  return data
}

export async function endUserActivitySession(input: SessionMutationInput) {
  const parsed = parseDomainInput(userActivitySessionMutationInputSchema, input, 'user-activity.end')
  const row = sessionInputToRow({ ...parsed, status: 'offline' }, 'offline')

  const { data, error } = await userActivitySessionsTable()
    .update(row)
    .eq('organization_id', parsed.organizationId)
    .eq('user_id', parsed.userId)
    .eq('session_id', parsed.sessionId)
    .select('*')
    .single()

  throwIfSupabaseError(error)
  return data
}

export async function listOnlineUserActivitySessions(input: {
  organizationId: string
  activeWithinMinutes?: number
  limit?: number
}) {
  const parsed = parseDomainInput(onlineUserActivityListInputSchema, input, 'user-activity.online-list')
  const activeWithinMinutes = parsed.activeWithinMinutes ?? 5
  const cutoff = new Date(Date.now() - activeWithinMinutes * 60_000).toISOString()

  const { data, error } = await userActivitySessionsTable()
    .select(`
      id,
      organization_id,
      user_id,
      session_id,
      status,
      current_path,
      current_page_title,
      connected_at,
      last_seen_at,
      disconnected_at,
      user_agent,
      metadata,
      created_at,
      updated_at,
      user:users(id, name, email, avatar_url)
    `)
    .eq('organization_id', parsed.organizationId)
    .is('disconnected_at', null)
    .gte('last_seen_at', cutoff)
    .order('last_seen_at', { ascending: false })
    .limit(parsed.limit ?? 200)

  throwIfSupabaseError(error)
  return data ?? []
}

export function connectAuditFeed(options: ConnectAuditFeedOptions) {
  const organizationId = parseDomainInput(
    onlineUserActivityListInputSchema.shape.organizationId,
    options.organizationId,
    'user-activity.audit-feed.organization',
  )
  let active = true
  let channel: ReturnType<typeof supabase.channel> | null = null

  void supabase.realtime.setAuth().then(() => {
    if (!active) return

    channel = supabase
      .channel(`audit:${organizationId}:feed`, { config: { private: true } })
      .on('broadcast', { event: 'audit.log.created' }, ({ payload }) => {
        const parsed = auditFeedEventPayloadSchema.safeParse(payload)
        if (parsed.success) {
          options.onEvent(parsed.data)
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          options.onSubscribed?.()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          options.onError?.(new Error(`Audit feed subscription failed: ${status}`))
        }
      })
  }).catch((error) => {
    options.onError?.(error)
  })

  return () => {
    active = false
    if (channel) {
      void supabase.removeChannel(channel)
    }
  }
}

export function connectOrganizationPresence(options: ConnectOrganizationPresenceOptions) {
  let parsed: SessionMutationInput

  try {
    parsed = parseDomainInput(userActivityPresenceSessionInputSchema, options, 'user-activity.presence')
  } catch (error) {
    options.onError?.(error)
    return () => undefined
  }

  const presenceKey = `${parsed.userId}:${parsed.sessionId}`
  let active = true
  let channel: ReturnType<typeof supabase.channel> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let visibilityListenerAttached = false

  const payload = (): UserPresencePayload => {
    const latest = options.getPayload?.() ?? {}

    return {
      organizationId: parsed.organizationId,
      userId: parsed.userId,
      sessionId: parsed.sessionId,
      status: latest.status ?? parsed.status ?? 'online',
      currentPath: latest.currentPath ?? parsed.currentPath ?? null,
      currentPageTitle: latest.currentPageTitle ?? parsed.currentPageTitle ?? null,
      metadata: latest.metadata ?? parsed.metadata ?? {},
      lastSeenAt: new Date().toISOString(),
    }
  }

  const trackPresence = () => {
    if (!active || !channel) return
    void channel.track(payload()).catch(options.onError)
  }

  const handleVisibilityChange = () => trackPresence()

  void supabase.realtime.setAuth().then(() => {
    if (!active) return

    channel = supabase
      .channel(`presence:${parsed.organizationId}:online`, {
        config: {
          private: true,
          presence: { key: presenceKey },
        },
      })
      .on('presence', { event: 'sync' }, () => {
        if (channel) {
          options.onSync?.(normalizePresenceState(channel.presenceState<UserPresencePayload>()))
        }
      })
      .subscribe((status) => {
        if (!channel) return
        if (status === 'SUBSCRIBED') {
          trackPresence()
          if (!heartbeatTimer && options.heartbeatMs && options.heartbeatMs > 0) {
            heartbeatTimer = setInterval(trackPresence, options.heartbeatMs)
          }
          if (typeof document !== 'undefined' && !visibilityListenerAttached) {
            document.addEventListener('visibilitychange', handleVisibilityChange)
            visibilityListenerAttached = true
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          options.onError?.(new Error(`Presence subscription failed: ${status}`))
        }
      })
  }).catch((error) => {
    options.onError?.(error)
  })

  return () => {
    active = false
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
    if (channel) {
      void channel.untrack()
      void supabase.removeChannel(channel)
    }
  }
}

export const userActivityAPI = {
  startSession: startUserActivitySession,
  touchSession: touchUserActivitySession,
  endSession: endUserActivitySession,
  listOnlineSessions: listOnlineUserActivitySessions,
  connectAuditFeed,
  connectOrganizationPresence,
}
