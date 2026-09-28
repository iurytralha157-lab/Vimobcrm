import { z } from 'zod'

import { vimobAPIRequest } from '@/lib/api/vimob-client'
import { buildDashboardQuery, normalizeDashboardFilters, type DashboardAPIFilters } from '@/lib/api/dashboard'
import { dashboardFiltersSchema } from '@/lib/validation'
import { parseDomainInput, uuidSchema, validateDomainResponse } from '@/lib/validation/common'
import {
  dashboardLeadEntryCursorSchema,
  dashboardLeadEntriesResponseSchema,
  type DashboardLeadEntriesPage,
} from '@/lib/validation/dashboard-lead-entries'

const dashboardLeadEntriesLimitSchema = z.number().int().min(1).max(50)

export async function getDashboardLeadEntries(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  cursor?: string | null
  limit?: number
  signal?: AbortSignal
}): Promise<DashboardLeadEntriesPage> {
  const organizationId = parseDomainInput(uuidSchema, params.organizationId, 'dashboard.lead-entries.organization-id')
  const filters = parseDomainInput(
    dashboardFiltersSchema,
    normalizeDashboardFilters(params.filters),
    'dashboard.lead-entries.filters',
  )
  const limit = parseDomainInput(dashboardLeadEntriesLimitSchema, params.limit ?? 25, 'dashboard.lead-entries.limit')
  const cursor = parseDomainInput(dashboardLeadEntryCursorSchema, params.cursor ?? null, 'dashboard.lead-entries.cursor')
  const response = await vimobAPIRequest<unknown>('/v1/dashboard/lead-entries', {
    organizationId,
    query: {
      ...buildDashboardQuery(filters),
      limit,
      cursor: cursor ?? undefined,
    },
    signal: params.signal,
  })
  return validateDomainResponse(
    dashboardLeadEntriesResponseSchema,
    response,
    'dashboard.lead-entries',
  ).data
}
