import { vimobAPIRequest } from './vimob-client'
import { apiErrorEventListResponseSchema, apiErrorEventResponseSchema, entityIdSchema, errorEventFiltersSchema, parseDomainInput, reportErrorEventInputSchema, validateDomainResponse } from '@/lib/validation'

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
    const validated = parseDomainInput(reportErrorEventInputSchema, input, 'telemetry.report')
    const { organizationId, ...body } = validated

    const response = await vimobAPIRequest<{ data: ErrorEvent }>('/v1/telemetry/errors', {
      method: 'POST',
      body,
      organizationId,
      skipTelemetry: true,
    })
    validateDomainResponse(apiErrorEventResponseSchema, response, 'telemetry.report')
    return response
  },

  async getErrorEvents(filters: ErrorEventFilters = {}) {
    const input = parseDomainInput(errorEventFiltersSchema, filters, 'telemetry.list')
    const response = await vimobAPIRequest<ErrorEventsResponse>('/v1/admin/error-events', {
      query: {
        limit: input.limit,
        offset: input.offset,
        search: input.search,
        severity: input.severity === 'all' ? undefined : input.severity,
        source: input.source === 'all' ? undefined : input.source,
        organizationId: input.organizationId,
        fingerprint: input.fingerprint,
        unresolved: input.unresolved,
      },
      skipTelemetry: true,
    })
    validateDomainResponse(apiErrorEventListResponseSchema, response, 'telemetry.list')
    return response
  },

  async resolveErrorEvent(id: string, note?: string) {
    const eventId = parseDomainInput(entityIdSchema, id, 'telemetry.resolve.id')
    const response = await vimobAPIRequest<{ data: ErrorEvent }>(`/v1/admin/error-events/${eventId}/resolve`, {
      method: 'POST',
      body: { note: note || '' },
      skipTelemetry: true,
    })
    validateDomainResponse(apiErrorEventResponseSchema, response, 'telemetry.resolve')
    return response
  },
}

export function reportErrorEvent(input: ReportErrorEventInput) {
  return telemetryAPI.reportErrorEvent(input)
}
