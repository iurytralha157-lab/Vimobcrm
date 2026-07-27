import { FEATURES } from "@/config/constants";
import { integrationsAPI } from "@/lib/api/integrations";

export type GoogleCalendarSyncAction = "push_upsert" | "push_delete";

export async function syncScheduleEventWithGoogle(
  action: GoogleCalendarSyncAction,
  eventId: string,
  organizationId?: string | null,
) {
  if (!FEATURES.ENABLE_GOOGLE_CALENDAR_INTEGRATION) return;

  await integrationsAPI.invokeFunction(
    "google-calendar-sync",
    { action, event_id: eventId },
    organizationId,
  );
}
