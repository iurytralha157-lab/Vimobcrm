import { vimobAPIRequest } from './vimob-client'
import {
  apiAuditLogListResponseSchema,
  auditLogCreateInputSchema,
  auditLogListInputSchema,
  okResponseSchema,
  parseDomainInput,
  validateDomainResponse,
} from '@/lib/validation'

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
  const input = parseDomainInput(auditLogListInputSchema, params, 'audit.list')
  return vimobAPIRequest<{ data: AuditLog[]; count: number; totalPages: number }>('/v1/audit-logs', {
    organizationId: input.organizationId || input.filters?.organizationId,
    query: {
      organizationId: input.filters?.organizationId,
      userId: input.filters?.userId,
      action: input.filters?.action,
      entityType: input.filters?.entityType,
      startDate: input.filters?.startDate,
      endDate: input.filters?.endDate,
      page: input.page,
      limit: input.limit,
    },
  }).then((response) => {
    validateDomainResponse(apiAuditLogListResponseSchema, response, 'audit.list')
    return response
  })
}

export async function createAuditLog(input: AuditLogCreateInput, organizationId?: string | null) {
  const body = parseDomainInput(auditLogCreateInputSchema, input, 'audit.create')
  const response = await vimobAPIRequest<{ ok: boolean }>('/v1/audit-logs', {
    method: 'POST',
    organizationId: organizationId || body.organization_id,
    body,
    skipTelemetry: true,
  })
  validateDomainResponse(okResponseSchema, response, 'audit.create')
}

export const auditAPI = {
  list: listAuditLogs,
  create: createAuditLog,
}
