import type { QueryClient } from '@tanstack/react-query';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';

const LEAD_HISTORY_STABILIZE_DELAY_MS = 700;

function eventTime(event: UnifiedHistoryEvent) {
  const time = new Date(event.timestamp).getTime();
  return Number.isFinite(time) ? time : 0;
}

export function appendOptimisticHistoryEvent(
  current: UnifiedHistoryEvent[] | undefined,
  event: UnifiedHistoryEvent,
) {
  if (!Array.isArray(current)) return current;
  if (current.some((item) => item.id === event.id)) return current;

  return [...current, event].sort((a, b) => eventTime(a) - eventTime(b));
}

export function invalidateLeadHistorySoon(
  queryClient: QueryClient,
  leadId?: string | null,
  delayMs = LEAD_HISTORY_STABILIZE_DELAY_MS,
) {
  if (!leadId) return;

  const queryKey = ['lead-history-v2', leadId] as const;
  void queryClient.invalidateQueries({ queryKey, refetchType: 'inactive' });

  const schedule = typeof window !== 'undefined' ? window.setTimeout.bind(window) : setTimeout;
  schedule(() => {
    void queryClient.invalidateQueries({ queryKey });
  }, delayMs);
}
