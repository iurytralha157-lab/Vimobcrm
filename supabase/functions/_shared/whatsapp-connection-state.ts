function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Unknown/error responses are observations, never evidence of disconnection. */
export function observedWhatsAppConnection(value: unknown, isGo: boolean): boolean | null {
  const payload = record(value);
  if (!payload || payload.success === false || payload.error) return null;
  const outer = record(payload.data);
  const state = isGo ? record(outer?.data) ?? outer ?? payload : record(payload.instance) ?? payload;
  if (!state || state.success === false || state.error) return null;
  const observations: boolean[] = [];
  if (isGo) {
    for (const key of ["connected", "Connected", "loggedIn", "LoggedIn"]) {
      if (!(key in state)) continue;
      if (typeof state[key] !== "boolean") return null;
      observations.push(state[key]);
    }
  }
  if ("state" in state) {
    if (typeof state.state !== "string") return null;
    switch (state.state.trim().toLowerCase()) {
      case "open": case "connected": observations.push(true); break;
      case "close": case "closed": case "disconnected": observations.push(false); break;
      default: return null;
    }
  }
  if (!observations.length || observations.some(item => item !== observations[0])) return null;
  return observations[0];
}
