import {
  dashboardFiltersSchema,
  parseDomainInput,
  uuidSchema,
  validateDomainResponse,
} from '@/lib/validation'
import {
  dashboardVisitsResponseSchema,
  type DashboardVisits,
} from '@/lib/validation/dashboard-visits'
import { buildDashboardQuery, normalizeDashboardFilters, type DashboardAPIFilters } from '@/lib/api/dashboard'
import { vimobAPIRequest } from '@/lib/api/vimob-client'

export async function getDashboardVisits(params: {
  organizationId?: string | null
  filters?: DashboardAPIFilters
  signal?: AbortSignal
}): Promise<DashboardVisits> {
  const organizationId = parseDomainInput(uuidSchema, params.organizationId, 'dashboard.visits.organization-id')
  const filters = parseDomainInput(
    dashboardFiltersSchema,
    normalizeDashboardFilters(params.filters),
    'dashboard.visits.filters',
  )

  const response = await vimobAPIRequest<unknown>('/v1/dashboard/visits', {
    organizationId,
    query: buildDashboardQuery(filters),
    signal: params.signal,
  })
  return validateDomainResponse(dashboardVisitsResponseSchema, response, 'dashboard.visits').data
}
