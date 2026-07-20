import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import {
  type UserActivitySessionStatus,
  type UserPresenceState,
  userActivityAPI,
} from '@/lib/api/user-activity'

type UserActivitySessionHookOptions = {
  enabled?: boolean
  heartbeatMs?: number
  currentPageTitle?: string
  metadata?: Record<string, unknown>
  enablePresence?: boolean
}

type OnlineUsersOptions = {
  organizationId?: string
  activeWithinMinutes?: number
  limit?: number
  enabled?: boolean
}

const DEFAULT_HEARTBEAT_MS = 60_000

function createSessionId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `session_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`
}

function currentPath() {
  if (typeof window === 'undefined') return null
  return `${window.location.pathname}${window.location.search}${window.location.hash}`
}

function currentTitle(fallback?: string) {
  if (fallback) return fallback
  if (typeof document === 'undefined') return null
  return document.title || null
}

function currentStatus(): UserActivitySessionStatus {
  if (typeof document === 'undefined') return 'online'
  return document.visibilityState === 'hidden' ? 'idle' : 'online'
}

function safeStringify(value: unknown) {
  try {
    return JSON.stringify(value ?? {})
  } catch {
    return '{}'
  }
}

function parseMetadata(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function flattenPresenceState(state: UserPresenceState) {
  return Object.values(state).flat()
}

function uniquePresenceUsers(
  presence: Array<UserPresenceState[string][number]>,
) {
  const usersById = new Map<string, UserPresenceState[string][number]>()

  for (const item of presence) {
    const current = usersById.get(item.userId)
    if (!current || item.lastSeenAt > current.lastSeenAt) {
      usersById.set(item.userId, item)
    }
  }

  return Array.from(usersById.values())
}

export function useUserActivitySession(options: UserActivitySessionHookOptions = {}) {
  const { user, profile, organization } = useAuth()
  const organizationId = organization?.id || profile?.organization_id || null
  const userId = user?.id || profile?.id || null
  const [sessionId] = useState(createSessionId)
  const metadataKey = safeStringify(options.metadata)
  const metadata = useMemo(() => parseMetadata(metadataKey), [metadataKey])
  const enabled = options.enabled ?? true
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const currentPageTitle = options.currentPageTitle
  // Durable activity heartbeats are always recorded. Managed Realtime
  // Presence needs an owner-managed policy on realtime.messages, so it stays
  // opt-in until that platform policy is installed.
  const enablePresence = options.enablePresence ?? false

  useEffect(() => {
    if (!enabled || !organizationId || !userId || !sessionId) return

    let closed = false
    let cleanupPresence: (() => void) | undefined

    const buildPayload = (status: UserActivitySessionStatus) => ({
      organizationId,
      userId,
      sessionId,
      status,
      currentPath: currentPath(),
      currentPageTitle: currentTitle(currentPageTitle),
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      metadata,
    })

    const report = (status: UserActivitySessionStatus) => {
      if (closed) return
      void userActivityAPI.touchSession(buildPayload(status)).catch(() => undefined)
    }

    void userActivityAPI.startSession(buildPayload(currentStatus())).catch(() => undefined)

    if (enablePresence) {
      cleanupPresence = userActivityAPI.connectOrganizationPresence({
        ...buildPayload(currentStatus()),
        heartbeatMs,
        getPayload: () => buildPayload(currentStatus()),
        onError: () => undefined,
      })
    }

    const interval = setInterval(() => {
      report(currentStatus())
    }, heartbeatMs)

    const handleVisibilityChange = () => report(currentStatus())
    const handlePageHide = () => {
      void userActivityAPI.endSession(buildPayload('offline')).catch(() => undefined)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pagehide', handlePageHide)
    window.addEventListener('beforeunload', handlePageHide)

    return () => {
      closed = true
      clearInterval(interval)
      cleanupPresence?.()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('beforeunload', handlePageHide)
      void userActivityAPI.endSession(buildPayload('offline')).catch(() => undefined)
    }
  }, [
    enabled,
    heartbeatMs,
    currentPageTitle,
    enablePresence,
    metadata,
    organizationId,
    sessionId,
    userId,
  ])

  return {
    enabled: Boolean(enabled && organizationId && userId && sessionId),
    organizationId,
    userId,
    sessionId,
  }
}

export function useOnlineUsers(options: OnlineUsersOptions = {}) {
  const { organization, profile } = useAuth()
  const organizationId = options.organizationId || organization?.id || profile?.organization_id || null
  const activeWithinMinutes = options.activeWithinMinutes ?? 5
  const limit = options.limit ?? 200

  return useQuery({
    queryKey: ['user-activity', 'online', organizationId, activeWithinMinutes, limit],
    queryFn: () => userActivityAPI.listOnlineSessions({
      organizationId: organizationId!,
      activeWithinMinutes,
      limit,
    }),
    enabled: Boolean(organizationId) && (options.enabled ?? true),
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  })
}

export function useOrganizationPresence(options: UserActivitySessionHookOptions = {}) {
  const { user, profile, organization } = useAuth()
  const organizationId = organization?.id || profile?.organization_id || null
  const userId = user?.id || profile?.id || null
  const [sessionId] = useState(createSessionId)
  const [presenceState, setPresenceState] = useState<UserPresenceState>({})
  const metadataKey = safeStringify(options.metadata)
  const metadata = useMemo(() => parseMetadata(metadataKey), [metadataKey])
  const enabled = options.enabled ?? true
  const heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const currentPageTitle = options.currentPageTitle

  useEffect(() => {
    if (!enabled || !organizationId || !userId || !sessionId) return

    const buildPayload = () => ({
      status: currentStatus(),
      currentPath: currentPath(),
      currentPageTitle: currentTitle(currentPageTitle),
      metadata,
    })

    return userActivityAPI.connectOrganizationPresence({
      organizationId,
      userId,
      sessionId,
      ...buildPayload(),
      userAgent: typeof navigator === 'undefined' ? null : navigator.userAgent,
      heartbeatMs,
      getPayload: buildPayload,
      onSync: setPresenceState,
      onError: () => undefined,
    })
  }, [
    enabled,
    heartbeatMs,
    currentPageTitle,
    metadata,
    organizationId,
    sessionId,
    userId,
  ])

  const presence = useMemo(() => flattenPresenceState(presenceState), [presenceState])
  const onlineUsers = useMemo(() => uniquePresenceUsers(presence), [presence])

  return {
    presence,
    onlineUsers,
    presenceState,
    sessionCount: presence.length,
    onlineCount: onlineUsers.length,
  }
}
