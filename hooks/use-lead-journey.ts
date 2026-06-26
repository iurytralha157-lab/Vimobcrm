import { useQuery } from '@tanstack/react-query';
import { leadsAPI } from '@/lib/api/leads';

export interface JourneyEvent {
  id: string;
  event_type: string;
  page_path: string;
  page_title: string | null;
  property_id: string | null;
  created_at: string;
  metadata: Record<string, unknown> | null;
  referrer: string | null;
  device_type: string | null;
  browser: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
}

export function useLeadJourney(leadId: string | undefined) {
  return useQuery({
    queryKey: ['lead-journey', leadId],
    enabled: !!leadId,
    queryFn: async () => {
      if (!leadId) return [];

      return leadsAPI.getLeadJourney<JourneyEvent>(leadId);
    },
  });
}
