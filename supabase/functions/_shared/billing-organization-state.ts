function normalizedField(
  value: Record<string, unknown>,
  field: "outcome" | "busy_reason",
) {
  const candidate = value[field];
  return typeof candidate === "string" ? candidate.trim().toLowerCase() : "";
}

const TERMINAL_ORGANIZATION_OUTCOMES = new Set([
  "organization_inactive",
  "organization_not_found",
  "organization_cleanup",
]);

/**
 * Identifies the permanent tenant fence returned by billing RPCs.
 *
 * `organization_inactive` is the canonical terminal outcome. A concurrently
 * removed organization is the same fail-closed condition. The busy reason
 * remains accepted while older database revisions are being drained so an
 * unavailable tenant can never be presented as RECOVERING/retryable.
 */
export function billingOrganizationIsUnavailable(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const record = value as Record<string, unknown>;
  const outcome = normalizedField(record, "outcome");
  const busyReason = normalizedField(record, "busy_reason");

  return TERMINAL_ORGANIZATION_OUTCOMES.has(outcome) ||
    (outcome === "busy" &&
      TERMINAL_ORGANIZATION_OUTCOMES.has(busyReason));
}
