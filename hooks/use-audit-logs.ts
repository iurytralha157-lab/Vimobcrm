import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

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
    queryFn: async () => {
      let query = supabase
        .from('audit_logs')
        .select('*, user:users(id, name, email), organization:organizations(id, name)', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range((page - 1) * limit, page * limit - 1);

      if (filters?.organizationId) {
        query = query.eq('organization_id', filters.organizationId);
      }
      if (filters?.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters?.action) {
        query = query.eq('action', filters.action);
      }
      if (filters?.entityType) {
        query = query.eq('entity_type', filters.entityType);
      }
      if (filters?.startDate) {
        query = query.gte('created_at', filters.startDate);
      }
      if (filters?.endDate) {
        query = query.lte('created_at', filters.endDate);
      }

      const { data, error, count } = await query;

      if (error) throw error;
      return { data: data as AuditLog[], count: count || 0, totalPages: Math.ceil((count || 0) / limit) };
    },
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
      
      const { error } = await supabase.from('audit_logs').insert([{
        user_id: user.id,
        organization_id: log.organization_id,
        action: log.action,
        entity_type: log.entity_type,
        entity_id: log.entity_id,
        old_data: (log.old_data || null) as Json,
        new_data: (log.new_data || null) as Json,
        user_agent: navigator.userAgent,
      }]);

      if (error) throw error;
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
    
    await supabase.from('audit_logs').insert([{
      user_id: user.id,
      organization_id: organizationId,
      action,
      entity_type: entityType,
      entity_id: entityId,
      old_data: (oldData || null) as Json,
      new_data: (newData || null) as Json,
      user_agent: navigator.userAgent,
    }]);
  } catch (error) {
    // Silent fail for audit logs to prevent breaking the user experience
    // especially during login or critical actions
    if (process.env.NODE_ENV === 'development') {
      console.warn('Audit log suppressed:', error);
    }
  }
}
