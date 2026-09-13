'use client'

import { useEffect, useMemo, useState } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import {
  type UserActivitySessionStatus,
  userActivityAPI,
} from '@/lib/api/user-activity'
import {
  DEFAULT_ACTIVITY_HEARTBEAT_MS,
  DEFAULT_ACTIVITY_IDLE_AFTER_MS,
  getIdleCheckDelay,
  getUserActivityAttentionStatus,
  isTrustedUserActivityEvent,
  shouldMarkUserActivityOnline,
  USER_ACTIVITY_INPUT_EVENTS,
} from '@/lib/presence/user-activity-state'

type UserActivitySessionHookOptions = {
  enabled?: boolean
  heartbeatMs?: number
  idleAfterMs?: number
  currentPageTitle?: string
  metadata?: Record<string, unknown>
}

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

function monotonicNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
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

export function useUserActivitySession(
  options: UserActivitySessionHookOptions = {},
) {
  const { activeOrganization, user, profile } = useAuth()
  const organizationId = activeOrganization.organizationId || null
  const userId = user?.id || profile?.id || null
  const [sessionId] = useState(createSessionId)
  const metadataKey = safeStringify(options.metadata)
  const metadata = useMemo(() => parseMetadata(metadataKey), [metadataKey])
  const enabled = options.enabled ?? true
  const heartbeatMs = Math.max(
    1_000,
    options.heartbeatMs ?? DEFAULT_ACTIVITY_HEARTBEAT_MS,
  )
  const idleAfterMs = Math.max(
    heartbeatMs,
    options.idleAfterMs ?? DEFAULT_ACTIVITY_IDLE_AFTER_MS,
  )
  const currentPageTitle = options.currentPageTitle

  useEffect(() => {
    if (!enabled || !organizationId || !userId || !sessionId) return

    let closed = false
    let ended = false
    let started = false
    let idleTimer: ReturnType<typeof setTimeout> | undefined
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined
    let lastActivityAt = monotonicNow()
    const getAttentionStatus = () => getUserActivityAttentionStatus(
      document.visibilityState,
      document.hasFocus(),
    )
    let status: UserActivitySessionStatus = getAttentionStatus()
    let writeChain = Promise.resolve()

    const buildPayload = (nextStatus: UserActivitySessionStatus) => ({
      organizationId,
      userId,
      sessionId,
      status: nextStatus,
      currentPath: currentPath(),
      currentPageTitle: currentTitle(currentPageTitle),
      userAgent: navigator.userAgent || null,
      metadata,
    })

    const enqueueWrite = (write: () => Promise<unknown>) => {
      writeChain = writeChain.then(write, write).then(
        () => undefined,
        () => undefined,
      )
    }

    const touch = (nextStatus: UserActivitySessionStatus) => {
      if (closed || ended) return
      status = nextStatus
      enqueueWrite(() => userActivityAPI.touchSession(buildPayload(nextStatus)))
    }

    const clearIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = undefined
    }

    const scheduleIdleCheck = () => {
      clearIdleTimer()
      if (closed || ended || getAttentionStatus() !== 'online') return

      const delay = getIdleCheckDelay(
        lastActivityAt,
        monotonicNow(),
        idleAfterMs,
      )
      idleTimer = setTimeout(() => {
        idleTimer = undefined
        const remaining = getIdleCheckDelay(
          lastActivityAt,
          monotonicNow(),
          idleAfterMs,
        )
        if (remaining > 0) {
          scheduleIdleCheck()
          return
        }
        if (status !== 'idle') touch('idle')
      }, Math.max(1, delay))
    }

    const markIdle = () => {
      clearIdleTimer()
      if (closed || ended || status === 'idle') return
      touch('idle')
    }

    const markActivity = (event: Event) => {
      if (
        closed ||
        ended ||
        !shouldMarkUserActivityOnline({
          isTrusted: event.isTrusted,
          visibilityState: document.visibilityState,
          hasFocus: document.hasFocus(),
        })
      ) return

      lastActivityAt = monotonicNow()
      if (status !== 'online') touch('online')
      if (!idleTimer) scheduleIdleCheck()
    }

    const handleActivityEvent = (event: Event) => {
      markActivity(event)
    }

    const handleVisibilityChange = (event: Event) => {
      if (!isTrustedUserActivityEvent(event)) return
      if (getAttentionStatus() !== 'online') {
        markIdle()
        return
      }
      markActivity(event)
    }

    const handleBlur = (event: FocusEvent) => {
      if (!isTrustedUserActivityEvent(event)) return
      markIdle()
    }

    const endSession = () => {
      if (ended || !started) return
      ended = true
      clearIdleTimer()
      enqueueWrite(() => userActivityAPI.endSession(buildPayload('offline')))
    }

    const handlePageShow = (event: PageTransitionEvent) => {
      if (!isTrustedUserActivityEvent(event)) return
      if (!ended || closed) return
      ended = false
      lastActivityAt = monotonicNow()
      status = getAttentionStatus()
      enqueueWrite(() => userActivityAPI.startSession(buildPayload(status)))
      if (status === 'online') scheduleIdleCheck()
    }

    // Delay the first write one task so React's development effect probe can
    // clean up without racing an offline write against the real mount.
    const startTimer = window.setTimeout(() => {
      if (closed) return
      started = true
      enqueueWrite(() => userActivityAPI.startSession(buildPayload(status)))
      if (status === 'online') scheduleIdleCheck()
      heartbeatTimer = setInterval(() => touch(status), heartbeatMs)
    }, 0)

    document.addEventListener('visibilitychange', handleVisibilityChange)
    for (const eventName of USER_ACTIVITY_INPUT_EVENTS) {
      document.addEventListener(eventName, handleActivityEvent, { passive: true })
    }
    window.addEventListener('focus', handleActivityEvent)
    window.addEventListener('blur', handleBlur)
    window.addEventListener('pagehide', endSession)
    window.addEventListener('beforeunload', endSession)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      closed = true
      clearTimeout(startTimer)
      clearIdleTimer()
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      for (const eventName of USER_ACTIVITY_INPUT_EVENTS) {
        document.removeEventListener(eventName, handleActivityEvent)
      }
      window.removeEventListener('focus', handleActivityEvent)
      window.removeEventListener('blur', handleBlur)
      window.removeEventListener('pagehide', endSession)
      window.removeEventListener('beforeunload', endSession)
      window.removeEventListener('pageshow', handlePageShow)
      endSession()
    }
  }, [
    enabled,
    heartbeatMs,
    currentPageTitle,
    idleAfterMs,
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
