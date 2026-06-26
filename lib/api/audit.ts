import { vimobAPIRequest } from './vimob-client'

export type AuditLog = {
  id: string
  organization_id: string | null
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
  ip_address: string | null
  user_agent: string | null
  created_at: string
  user?: { id: string; name: string; email: string } | null
  organization?: { id: string; name: string } | null
}

export type AuditLogFilters = {
  organizationId?: string
  userId?: string
  action?: string
  entityType?: string
  startDate?: string
  endDate?: string
}

export type AuditLogCreateInput = {
  action: string
  entity_type: string
  entity_id?: string
  old_data?: Record<string, unknown>
  new_data?: Record<string, unknown>
  organization_id?: string
  user_agent?: string
}

export async function listAuditLogs(params: {
  filters?: AuditLogFilters
  page?: number
  limit?: number
  organizationId?: string | null
}) {
  return vimobAPIRequest<{ data: AuditLog[]; count: number; totalPages: number }>('/v1/audit-logs', {
    organizationId: params.organizationId || params.filters?.organizationId,
    query: {
      organizationId: params.filters?.organizationId,
      userId: params.filters?.userId,
      action: params.filters?.action,
      entityType: params.filters?.entityType,
      startDate: params.filters?.startDate,
      endDate: params.filters?.endDate,
      page: params.page,
      limit: params.limit,
    },
  })
}

export async function createAuditLog(input: AuditLogCreateInput, organizationId?: string | null) {
  await vimobAPIRequest<{ ok: boolean }>('/v1/audit-logs', {
    method: 'POST',
    organizationId: organizationId || input.organization_id,
    body: input,
    skipTelemetry: true,
  })
}

export const auditAPI = {
  list: listAuditLogs,
  create: createAuditLog,
}
