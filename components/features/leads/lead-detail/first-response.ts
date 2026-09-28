import type { UnifiedHistoryEvent } from '@/hooks/lead-history/types';

type LeadFirstResponse = {
  first_response_at?: string | null;
  first_response_seconds?: number | null;
  first_response_is_automation?: boolean | null;
};

export function resolvedFirstResponse(
  lead: LeadFirstResponse,
  history: readonly UnifiedHistoryEvent[] = [],
) {
  if (lead.first_response_at) {
    return {
      seconds: lead.first_response_seconds ?? null,
      isAutomation: Boolean(lead.first_response_is_automation),
      fromHistory: false,
    };
  }

  // Older lead read endpoints omitted the metric even when the structured
  // first-response event was already persisted in the history endpoint.
  const event = [...history].reverse().find((item) =>
    item.type === 'first_response' &&
    typeof item.firstResponseSeconds === 'number' &&
    Number.isFinite(item.firstResponseSeconds) &&
    item.firstResponseSeconds >= 0 &&
    Number.isFinite(Date.parse(item.timestamp)),
  );
  if (!event) return null;
  return {
    seconds: event.firstResponseSeconds!,
    isAutomation: Boolean(event.isAutomation || event.metadata?.is_automation),
    fromHistory: true,
  };
}
