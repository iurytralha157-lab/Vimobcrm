export const GOOGLE_CALENDAR_CONFLICT_MESSAGE =
  "O compromisso mudou no Vimob e no Google Agenda. Revise as duas versoes antes de sincronizar.";

export class GoogleCalendarConflictError extends Error {
  constructor(message = GOOGLE_CALENDAR_CONFLICT_MESSAGE) {
    super(message);
    this.name = "GoogleCalendarConflictError";
  }
}

export function hasUnsyncedVimobChanges(status: unknown): boolean {
  return status === "pending" || status === "error" || status === "conflict";
}

export function googleEventDiffersFromLink(
  storedEtag: unknown,
  incomingEtag: unknown,
): boolean {
  const stored = typeof storedEtag === "string" ? storedEtag.trim() : "";
  const incoming = typeof incomingEtag === "string" ? incomingEtag.trim() : "";
  // Without both versions, an automatic overwrite cannot be proven safe.
  return !stored || !incoming || stored !== incoming;
}

export function decideGooglePullForLocalEvent(
  status: unknown,
  storedEtag: unknown,
  incomingEtag: unknown,
): "apply" | "preserve" | "conflict" {
  if (status === "conflict") return "conflict";
  if (!hasUnsyncedVimobChanges(status)) return "apply";
  return googleEventDiffersFromLink(storedEtag, incomingEtag)
    ? "conflict"
    : "preserve";
}

export function conditionalGoogleWriteHeaders(etag: unknown): {
  "If-Match": string;
} {
  const value = typeof etag === "string" ? etag.trim() : "";
  if (!value) throw new GoogleCalendarConflictError();
  return { "If-Match": value };
}
