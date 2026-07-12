import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
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
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      
      if (!session || !user?.id) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('Audit log blocked: No authenticated session found.');
        }
        return;
      }
      
      await auditAPI.create({
        action: log.action,
        entity_type: log.entity_type,
        entity_id: log.entity_id,
        old_data: log.old_data,
        new_data: log.new_data,
        organization_id: log.organization_id,
        user_agent: navigator.userAgent,
      }, log.organization_id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['audit-logs'] });
    },
  });
}

// Helper function to log audit actions
export async function logAuditAction(
  action: string,
  entityType: string,
  entityId?: string,
  oldData?: Record<string, unknown>,
  newData?: Record<string, unknown>,
  organizationId?: string
) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;

    // Don't log if no session or user, or if on auth page
    const isAuthPage = window.location.pathname === '/login' || window.location.pathname === '/cadastro';

    if (!session || !user?.id || isAuthPage) {
      return;
    }
    
    await auditAPI.create({
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_data: oldData,
      new_data: newData,
      organization_id: organizationId,
      user_agent: navigator.userAgent,
    }, organizationId);
  } catch (error) {
    // Silent fail for audit logs to prevent breaking the user experience
    // especially during login or critical actions
    if (process.env.NODE_ENV === 'development') {
      console.warn('Audit log suppressed:', error);
    }
  }
}
