const DURABLE_CURSOR = /^(?:0|[1-9]\d*)$/;

export function nextRealtimeCursor(current: string | null, candidate: string, authoritative = false) {
  const normalized = candidate.trim();
  if (!DURABLE_CURSOR.test(normalized)) return current;
  if (authoritative || !current) return normalized;

  if (normalized.length !== current.length) {
    return normalized.length > current.length ? normalized : current;
  }
  return normalized > current ? normalized : current;
}

export function realtimeReconnectDelay(attempt: number, random = Math.random()) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const retryWidth = Math.min(8_000 * 2 ** safeAttempt, 14_000);
  const safeRandom = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
  // Spread simultaneous reconnects after a replica restart over the whole retry window.
  return 1_000 + Math.round(retryWidth * safeRandom);
}
