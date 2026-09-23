// Evolution callbacks can encode Unix provider time in seconds or milliseconds.
// An absent, malformed or out-of-range value must never be replaced by the
// callback arrival time when deciding whether a message predates attendance.
export function normalizeEvolutionProviderOccurredAt(value: unknown): string | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const milliseconds = timestamp >= 1_000_000_000_000
    ? timestamp
    : timestamp * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0 || milliseconds > 8.64e15) {
    return null;
  }
  return new Date(milliseconds).toISOString();
}

export function providerOccurredByInboxAcceptance(
  providerOccurredAt: string | null,
  inboxAcceptedAt: string | null,
): boolean {
  const providerMillis = providerOccurredAt ? Date.parse(providerOccurredAt) : NaN;
  const inboxMillis = inboxAcceptedAt ? Date.parse(inboxAcceptedAt) : NaN;
  return Number.isFinite(providerMillis) && Number.isFinite(inboxMillis) &&
    providerMillis <= inboxMillis;
}
