const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const GOOGLE_CALENDAR_CANARY_CODE = "GOOGLE_CALENDAR_CANARY_NOT_ENABLED";
export const GOOGLE_CALENDAR_CANARY_MESSAGE =
  "Google Agenda ainda nao habilitado para este usuario.";

export function googleCalendarCanaryUserIds(configuredUserIds: unknown): string[] {
  if (typeof configuredUserIds !== "string") return [];
  return [...new Set(configuredUserIds
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID_PATTERN.test(value)))];
}

export function isGoogleCalendarCanaryUser(
  userId: unknown,
  configuredUserIds: unknown,
) {
  if (typeof userId !== "string") {
    return false;
  }
  const requestedId = userId.trim().toLowerCase();
  if (!UUID_PATTERN.test(requestedId)) return false;
  return googleCalendarCanaryUserIds(configuredUserIds)
    .includes(requestedId);
}
