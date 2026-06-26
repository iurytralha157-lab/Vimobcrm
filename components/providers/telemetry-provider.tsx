'use client'

import { useEffect, useRef } from 'react'

import { reportErrorEvent } from '@/lib/api/telemetry'

function getReasonMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message
  if (typeof reason === 'string') return reason
  return 'Unhandled promise rejection'
}

function getReasonStack(reason: unknown) {
  if (reason instanceof Error) return reason.stack
  return undefined
}

export function TelemetryProvider() {
  const recentFingerprints = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const shouldSkipDuplicate = (fingerprint: string) => {
      const now = Date.now()
      const previous = recentFingerprints.current.get(fingerprint)
      recentFingerprints.current.set(fingerprint, now)

      return Boolean(previous && now - previous < 30_000)
    }

    const report = (payload: {
      category: string
      message: string
      stack?: string
      component?: string
      metadata?: Record<string, unknown>
    }) => {
      const fingerprint = `${payload.category}:${payload.message}:${window.location.pathname}`
      if (shouldSkipDuplicate(fingerprint)) return

      void reportErrorEvent({
        source: 'frontend',
        severity: 'error',
        category: payload.category,
        message: payload.message,
        stack: payload.stack,
        component: payload.component,
        fingerprint,
        url: window.location.href,
        userAgent: navigator.userAgent,
        browserContext: {
          pathname: window.location.pathname,
          search: window.location.search,
          origin: window.location.origin,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
        },
        metadata: payload.metadata,
      }).catch(() => undefined)
    }

    const handleWindowError = (event: ErrorEvent) => {
      report({
        category: 'window_error',
        message: event.message || 'Unhandled window error',
        stack: event.error instanceof Error ? event.error.stack : undefined,
        metadata: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      })
    }

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      report({
        category: 'unhandled_rejection',
        message: getReasonMessage(event.reason),
        stack: getReasonStack(event.reason),
        metadata: {
          reasonType: typeof event.reason,
        },
      })
    }

    window.addEventListener('error', handleWindowError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    return () => {
      window.removeEventListener('error', handleWindowError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [])

  return null
}
