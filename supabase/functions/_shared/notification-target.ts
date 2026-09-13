type NotificationVariables = Record<string, unknown>;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SCHEDULE_EVENT_KEYS = new Set([
  "appointment_reminder",
  "appointment_outcome_pending",
]);

export function buildNotificationTargetUrl(
  eventKey: string,
  variables: NotificationVariables,
  leadId: string,
) {
  const scheduleEventId = typeof variables.schedule_event_id === "string"
    ? variables.schedule_event_id.trim()
    : "";

  if (
    SCHEDULE_EVENT_KEYS.has(eventKey.toLowerCase()) &&
    UUID_RE.test(scheduleEventId)
  ) {
    return `/agenda?event=${scheduleEventId.toLowerCase()}`;
  }

  return leadId ? `/crm/conversas?lead=${leadId}` : "/notifications";
}
