import { useQuery } from '@tanstack/react-query';
import { auditAPI } from '@/lib/api/audit';

export interface AuditLog {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  diff?: Record<string, unknown> | null;
  source?: string | null;
  metadata?: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  user?: { id: string; name: string; email: string } | null;
  organization?: { id: string; name: string } | null;
}

export interface AuditLogFilters {
  organizationId?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  startDate?: string;
  endDate?: string;
}

export function useAuditLogs(organizationId: string | null, filters?: AuditLogFilters, page = 1, limit = 20) {
  return useQuery({
    queryKey: ['audit-logs', organizationId, filters, page, limit],
    queryFn: () => auditAPI.list({ organizationId, filters, page, limit }),
  });
}
