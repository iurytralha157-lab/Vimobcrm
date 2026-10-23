'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { scheduleAPI } from '@/lib/api/schedule';
import { useAuth } from '@/contexts/AuthContext';

export function useLeadSchedulePreview(leadId: string | null, enabled: boolean) {
  const { activeOrganization } = useAuth();
  const organizationId = activeOrganization.organizationId;
  const query = useInfiniteQuery({
    queryKey: ['schedule-events', organizationId, { leadId, preview: true }],
    enabled: Boolean(organizationId && leadId && enabled),
    initialPageParam: 0,
    queryFn: ({ pageParam, signal }) => {
      if (!organizationId || !leadId) throw new Error('Selecione um lead e uma organização.');
      return scheduleAPI.getLeadSchedulePage({ organizationId, leadId, offset: pageParam, signal });
    },
    getNextPageParam: (page, _pages, offset) => page.pagination?.has_more ? offset + page.data.length : undefined,
    staleTime: 60_000,
    refetchOnMount: 'always',
  });
  const events = new Map(query.data?.pages.flatMap((page) => page.data).map((event) => [event.id, event]));
  return { ...query, events: [...events.values()] };
}
