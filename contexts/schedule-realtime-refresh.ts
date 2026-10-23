export type ScheduleRealtimeRefresh = {
  organizationId: string;
  eventIds: Set<string>;
  leadIds: Set<string>;
  refreshAll: boolean;
};

const MAX_SCHEDULE_REFRESH_IDS = 500;

/** Collect the whole burst, including older servers' resource-specific events. */
export function collectScheduleRealtimeRefresh(
  pending: ScheduleRealtimeRefresh | null,
  event: { organizationId: string; data?: Record<string, unknown> },
): ScheduleRealtimeRefresh {
  const batch = pending?.organizationId === event.organizationId
    ? pending
    : { organizationId: event.organizationId, eventIds: new Set<string>(), leadIds: new Set<string>(), refreshAll: false };
  const eventId = typeof event.data?.eventId === "string" ? event.data.eventId : "";
  const leadId = typeof event.data?.leadId === "string" ? event.data.leadId : "";

  // Current servers intentionally send only a generic invalidation so private
  // event/lead/actor IDs never enter an organization-wide stream.
  if (!eventId) batch.refreshAll = true;
  if (!batch.refreshAll) {
    batch.eventIds.add(eventId);
    if (leadId) batch.leadIds.add(leadId);
    if (batch.eventIds.size + batch.leadIds.size > MAX_SCHEDULE_REFRESH_IDS) {
      batch.refreshAll = true;
    }
  }
  if (batch.refreshAll) {
    batch.eventIds.clear();
    batch.leadIds.clear();
  }
  return batch;
}
