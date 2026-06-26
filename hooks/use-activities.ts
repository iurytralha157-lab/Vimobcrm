import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@/integrations/supabase/types';
import { activitiesAPI, type Activity } from '@/lib/api/activities';

export type { Activity } from '@/lib/api/activities';

export function useActivities(leadId?: string) {
  return useQuery({
    queryKey: ['activities', leadId],
    queryFn: async () => activitiesAPI.list({ leadId, limit: leadId ? 500 : 100 }),
  });
}

export function useRecentActivities() {
  return useQuery({
    queryKey: ['recent-activities'],
    queryFn: async () => activitiesAPI.list({ limit: 10 }),
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (activity: {
      lead_id: string;
      type: string;
      content?: string;
      metadata?: Json;
    }) => activitiesAPI.create(activity),
    onSuccess: (data: Activity) => {
      queryClient.invalidateQueries({ queryKey: ['activities'] });
      queryClient.invalidateQueries({ queryKey: ['recent-activities'] });
      if (data?.lead_id) {
        queryClient.invalidateQueries({ queryKey: ['lead-history-v2', data.lead_id] });
      }
    },
  });
}
