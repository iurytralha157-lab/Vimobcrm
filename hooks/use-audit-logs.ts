import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { auditAPI, type AuditLog, type AuditLogFilters } from '@/lib/api/audit';

export type { AuditLog, AuditLogFilters };

export function useAuditLogs(filters?: AuditLogFilters, page = 1, limit = 20) {
  return useQuery({
    queryKey: ['audit-logs', filters, page, limit],
    queryFn: () => auditAPI.list({ filters, page, limit }),
  });
}

export function useCreateAuditLog() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (log: {
      action: string;
      entity_type: string;
      entity_id?: string;
      old_data?: Record<string, unknown>;
      new_data?: Record<string, unknown>;
      organization_id?: string;
    }) => {
      await auditAPI.create({
        ...log,
        user_agent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}

export async function logAuditAction(
  action: string,
  entityType: string,
  entityId?: string,
  oldData?: Record<string, unknown>,
  newData?: Record<string, unknown>,
  organizationId?: string,
) {
  try {
    const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/cadastro';
    if (isAuthPage) return;

    await auditAPI.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_data: oldData,
      new_data: newData,
      organization_id: organizationId,
      user_agent: navigator.userAgent,
    });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.warn('Audit log suppressed:', error);
    }
  }
}
