export const EVOLUTION_GO_MESSAGE_EFFECTS_KEY =
  "evolution_go_webhook_effects";
export const EVOLUTION_GO_UNREAD_LEDGER_KEY =
  "evolution_go_unread_effects_v1";
export const EVOLUTION_GO_UNREAD_LEDGER_LIMIT = 512;

/**
 * Code-only crash bridge for the current schema.
 *
 * The canonical message stays `pending` until every required effect succeeds.
 * Conversation unread state and its fingerprint are written together with an
 * optimistic CAS, so a retry can distinguish "already applied" from "not yet
 * applied". The fingerprint is removed only after the canonical message is
 * terminal. More than 512 simultaneous unfinished messages must fail closed;
 * a database transaction/RPC is still required for a formal exactly-once
 * contract across every table and external AI delivery.
 */

type JsonRecord = Record<string, unknown>;

export type EvolutionGoStoredEffectState =
  | "pending"
  | "completed"
  | "untracked"
  | "conflict";

export function storedEvolutionGoEffectState(
  metadata: unknown,
  providerMessageId: string,
): EvolutionGoStoredEffectState {
  const root = asRecord(metadata);
  const marker = asRecord(root?.[EVOLUTION_GO_MESSAGE_EFFECTS_KEY]);
  if (!marker) return "untracked";
  if (
    marker.version !== 1 ||
    normalizedText(marker.provider_message_id) !== providerMessageId.trim()
  ) {
    return "conflict";
  }
  return marker.state === "pending" || marker.state === "completed"
    ? marker.state
    : "conflict";
}

export function pendingEvolutionGoEffectMetadata(
  metadata: unknown,
  providerMessageId: string,
  startedAt = new Date().toISOString(),
) {
  const root = asRecord(metadata) || {};
  const existing = asRecord(root[EVOLUTION_GO_MESSAGE_EFFECTS_KEY]);
  if (
    existing?.version === 1 && existing.state === "completed" &&
    normalizedText(existing.provider_message_id) === providerMessageId.trim()
  ) {
    return root;
  }
  return {
    ...root,
    [EVOLUTION_GO_MESSAGE_EFFECTS_KEY]: {
      version: 1,
      state: "pending",
      provider_message_id: providerMessageId.trim(),
      started_at: normalizedText(existing?.started_at) || startedAt,
    },
  };
}

export function completedEvolutionGoEffectMetadata(
  metadata: unknown,
  providerMessageId: string,
  completedAt = new Date().toISOString(),
) {
  const pending = pendingEvolutionGoEffectMetadata(
    metadata,
    providerMessageId,
    completedAt,
  );
  const marker = asRecord(pending[EVOLUTION_GO_MESSAGE_EFFECTS_KEY]) || {};
  return {
    ...pending,
    [EVOLUTION_GO_MESSAGE_EFFECTS_KEY]: {
      ...marker,
      state: "completed",
      completed_at: completedAt,
    },
  };
}

export function hasConversationUnreadEffect(
  metadata: unknown,
  effectKey: string,
) {
  return conversationUnreadEffectKeys(metadata).includes(effectKey);
}

export function conversationUnreadEffectCount(metadata: unknown) {
  return conversationUnreadEffectKeys(metadata).length;
}

export function appendConversationUnreadEffect(
  metadata: unknown,
  effectKey: string,
) {
  const root = asRecord(metadata) || {};
  const keys = conversationUnreadEffectKeys(root).filter((key) =>
    key !== effectKey
  );
  keys.push(effectKey);
  return {
    ...root,
    [EVOLUTION_GO_UNREAD_LEDGER_KEY]: keys.slice(
      -EVOLUTION_GO_UNREAD_LEDGER_LIMIT,
    ),
  };
}

export function removeConversationUnreadEffect(
  metadata: unknown,
  effectKey: string,
) {
  const root = asRecord(metadata) || {};
  return {
    ...root,
    [EVOLUTION_GO_UNREAD_LEDGER_KEY]: conversationUnreadEffectKeys(root)
      .filter((key) => key !== effectKey),
  };
}

export async function evolutionGoEffectFingerprint(
  organizationId: string,
  sessionId: string,
  providerMessageId: string,
  effect: string,
) {
  const canonical = [organizationId, sessionId, providerMessageId, effect]
    .map((value) => `${value.trim().length}:${value.trim()}`)
    .join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

export async function deterministicEvolutionGoEffectId(
  organizationId: string,
  sessionId: string,
  providerMessageId: string,
  effect: string,
) {
  const fingerprint = await evolutionGoEffectFingerprint(
    organizationId,
    sessionId,
    providerMessageId,
    effect,
  );
  const bytes = Uint8Array.from(
    fingerprint.slice(0, 32).match(/.{2}/g) || [],
    (value) => Number.parseInt(value, 16),
  );
  // UUIDv8 reserves the layout for application-defined deterministic IDs.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${
    hex.slice(16, 20)
  }-${hex.slice(20, 32)}`;
}

function conversationUnreadEffectKeys(metadata: unknown) {
  const root = asRecord(metadata);
  const raw = root?.[EVOLUTION_GO_UNREAD_LEDGER_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map(normalizedText).filter((value) =>
    /^[0-9a-f]{64}$/.test(value)
  ))];
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

function normalizedText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
