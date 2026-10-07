export type GoogleCalendarConnectRestriction =
  | "GOOGLE_CALENDAR_PILOT_ONLY"
  | "GOOGLE_CALENDAR_CONNECT_DISABLED";

export type GoogleCalendarConnectGate =
  | { allowed: true; restriction: null }
  | { allowed: false; restriction: GoogleCalendarConnectRestriction };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Controls only new OAuth connections. Existing connections keep their status,
 * disconnect action and outbound jobs regardless of the rollout mode.
 */
export function resolveGoogleCalendarConnectGate(
  userId: string,
  modeValue: string | undefined,
  allowedUserIdsValue: string | undefined,
): GoogleCalendarConnectGate {
  const mode = modeValue?.trim().toLowerCase();
  if (mode === "all") return { allowed: true, restriction: null };
  if (mode !== "pilot") {
    return { allowed: false, restriction: "GOOGLE_CALENDAR_CONNECT_DISABLED" };
  }

  const normalizedUserId = userId.trim().toLowerCase();
  const allowedUserIds = (allowedUserIdsValue || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => UUID_PATTERN.test(value));

  return UUID_PATTERN.test(normalizedUserId) &&
      allowedUserIds.includes(normalizedUserId)
    ? { allowed: true, restriction: null }
    : { allowed: false, restriction: "GOOGLE_CALENDAR_PILOT_ONLY" };
}
