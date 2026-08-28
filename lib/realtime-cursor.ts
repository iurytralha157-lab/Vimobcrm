const DURABLE_CURSOR = /^[1-9]\d*$/;

export function nextRealtimeCursor(current: string | null, candidate: string) {
  const normalized = candidate.trim();
  if (!DURABLE_CURSOR.test(normalized)) return current;
  if (!current) return normalized;

  if (normalized.length !== current.length) {
    return normalized.length > current.length ? normalized : current;
  }
  return normalized > current ? normalized : current;
}

export function realtimeReconnectDelay(attempt: number, random = Math.random()) {
  const safeAttempt = Number.isFinite(attempt) ? Math.max(0, Math.floor(attempt)) : 0;
  const baseDelay = Math.min(1_000 * 2 ** safeAttempt, 15_000);
  const safeRandom = Number.isFinite(random) ? Math.min(1, Math.max(0, random)) : 0.5;
  const jitterFactor = 0.75 + safeRandom * 0.5;
  return Math.min(15_000, Math.round(baseDelay * jitterFactor));
}
