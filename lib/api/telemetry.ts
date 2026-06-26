import { vimobAPIRequest } from './vimob-client'

export type ErrorEventSeverity = 'debug' | 'info' | 'warning' | 'error' | 'critical'
export type ErrorEventSource = 'frontend' | 'backend' | 'api'

export type ErrorEvent = {
  id: string
  organizationId?: string
  userId?: string
  requestId?: string
  source: ErrorEventSource
  severity: ErrorEventSeverity
  category?: string
  message: string
  errorCode?: string
  httpStatus?: number
  method?: string
  path?: string
  route?: string
  component?: string
  stack?: string
  stackHash?: string
  fingerprint: string
  url?: string
  userAgent?: string
  browserContext: Record<string, unknown>
  metadata: Record<string, unknown>
  createdAt: string
  resolvedAt?: string
  resolvedBy?: string
  resolutionNote?: string
}

export type ReportErrorEventInput = {
  organizationId?: string | null
  requestId?: string
  source?: ErrorEventSource
  severity?: ErrorEventSeverity
  category?: string
  message: string
  errorCode?: string
  httpStatus?: number
  method?: string
  path?: string
  route?: string
  component?: string
  stack?: string
  stackHash?: string
  fingerprint?: string
  url?: string
  userAgent?: string
  browserContext?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export type ErrorEventFilters = {
  limit?: number
  offset?: number
  search?: string
  severity?: ErrorEventSeverity | 'all'
  source?: ErrorEventSource | 'all'
  organizationId?: string
  fingerprint?: string
  unresolved?: boolean
}

export type ErrorEventsResponse = {
  data: ErrorEvent[]
  total: number
  limit: number
  offset: number
}

export const telemetryAPI = {
  async reportErrorEvent(input: ReportErrorEventInput) {
    const { organizationId, ...body } = input

    return vimobAPIRequest<{ data: ErrorEvent }>('/v1/telemetry/errors', {
      method: 'POST',
      body,
      organizationId,
      skipTelemetry: true,
    })
  },

  async getErrorEvents(filters: ErrorEventFilters = {}) {
    return vimobAPIRequest<ErrorEventsResponse>('/v1/admin/error-events', {
      query: {
        limit: filters.limit,
        offset: filters.offset,
        search: filters.search,
        severity: filters.severity === 'all' ? undefined : filters.severity,
        source: filters.source === 'all' ? undefined : filters.source,
        organizationId: filters.organizationId,
        fingerprint: filters.fingerprint,
        unresolved: filters.unresolved,
      },
      skipTelemetry: true,
    })
  },

  async resolveErrorEvent(id: string, note?: string) {
    return vimobAPIRequest<{ data: ErrorEvent }>(`/v1/admin/error-events/${id}/resolve`, {
      method: 'POST',
      body: { note: note || '' },
      skipTelemetry: true,
    })
  },
}

export function reportErrorEvent(input: ReportErrorEventInput) {
  return telemetryAPI.reportErrorEvent(input)
}
