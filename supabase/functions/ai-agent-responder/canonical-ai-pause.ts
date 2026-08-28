export type CanonicalAIPauseSnapshot = {
  human_override?: unknown;
  paused_until?: unknown;
};

/**
 * Interprets the canonical Go/CRM takeover state. Unknown or malformed state
 * is blocked deliberately: a privileged legacy responder must never guess
 * that it is safe to speak while the source of truth is inconsistent.
 */
export function canonicalAIPauseReason(
  state: CanonicalAIPauseSnapshot | null | undefined,
  nowMs = Date.now(),
) {
  if (!state) return null;
  if (state.human_override === true) return "human_override";
  if (state.human_override !== false) return "invalid_human_override";

  if (state.paused_until === null) return null;
  if (typeof state.paused_until !== "string" || !state.paused_until.trim()) {
    return "invalid_paused_until";
  }

  const pausedUntilMs = Date.parse(state.paused_until);
  if (!Number.isFinite(pausedUntilMs)) return "invalid_paused_until";
  return pausedUntilMs > nowMs ? "paused_until" : null;
}
