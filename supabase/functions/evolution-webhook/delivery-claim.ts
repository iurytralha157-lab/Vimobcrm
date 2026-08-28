type ClaimRow = {
  id: string;
  organization_id: string;
  session_id: string;
  provider: string;
  status: "pending" | "processing" | "retry" | "processed" | "dead";
  attempts: number;
  max_attempts: number;
  locked_at: string | null;
  locked_by: string | null;
  next_attempt_at: string;
};

type ClaimError = { code?: string; message?: string };
type ClaimResult<T = ClaimRow> = { data: T | null; error: ClaimError | null };

type ClaimSingleBuilder<T> = {
  maybeSingle(): Promise<ClaimResult<T>>;
};

type ClaimFilterBuilder<T> = {
  eq(column: string, value: unknown): ClaimFilterBuilder<T>;
  lt(column: string, value: unknown): ClaimFilterBuilder<T>;
  lte(column: string, value: unknown): ClaimFilterBuilder<T>;
  select(columns: string): ClaimSingleBuilder<T>;
  maybeSingle(): Promise<ClaimResult<T>>;
};

type ClaimTable = {
  upsert(
    row: Record<string, unknown>,
    options: { onConflict: "event_key"; ignoreDuplicates: true },
  ): {
    select(columns: "id"): ClaimSingleBuilder<{ id: string }>;
  };
  select(columns: string): ClaimFilterBuilder<ClaimRow>;
  update(row: Record<string, unknown>): ClaimFilterBuilder<{ id: string }>;
};

export type EvolutionWebhookClaimClient = {
  from(table: "whatsapp_webhook_inbox"): ClaimTable;
};

export type EvolutionMessageClaimScope = {
  organizationId: string;
  sessionId: string;
  providerInstanceId?: string | null;
  providerMessageId: string;
  eventType: string;
  providerPayload: unknown;
};

export type EvolutionMessageClaim =
  | { outcome: "claimed"; claimId: string; ownerId: string; resumed: boolean }
  | { outcome: "duplicate" }
  | { outcome: "in_progress" }
  | { outcome: "dead" };

export type OwnedEvolutionMessageClaim = Extract<
  EvolutionMessageClaim,
  { outcome: "claimed" }
>;

export class EvolutionMessageClaimError extends Error {
  constructor() {
    super("Unable to establish the Evolution webhook delivery claim");
    this.name = "EvolutionMessageClaimError";
  }
}

type ClaimOptions = {
  now?: Date;
  ownerId?: string;
  leaseMs?: number;
};

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 12;

/**
 * Acquire a recoverable lease in the existing durable webhook inbox.
 *
 * A new event is inserted directly as `processing`. A conflicting event is
 * never handled from a read alone: pending/retry/stale-processing rows must be
 * won by a compare-and-set update. Fresh processing returns `in_progress`, and
 * processed rows are terminal duplicates.
 *
 * Unlike a terminal claim before effects, a crash does not lose the message:
 * the existing Go inbox worker resets the same five-minute stale lease and can
 * deliver the stored single-message provider payload. Partial effects remain
 * at-least-once across a process crash; downstream effects must therefore keep
 * their provider-message idempotency keys.
 */
export async function claimEvolutionMessageDelivery(
  client: EvolutionWebhookClaimClient,
  scope: EvolutionMessageClaimScope,
  options: ClaimOptions = {},
): Promise<EvolutionMessageClaim> {
  const eventKey = await buildEvolutionMessageEventKey(scope);
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const ownerId = options.ownerId?.trim() || `evolution-edge:${crypto.randomUUID()}`;
  const leaseMs = normalizeLease(options.leaseMs);
  const provider = "evolution_go";
  const organizationId = requireScopeValue(scope.organizationId);
  const sessionId = requireScopeValue(scope.sessionId);
  const eventType = requireScopeValue(scope.eventType);

  const { data: inserted, error: insertError } = await client
    .from("whatsapp_webhook_inbox")
    .upsert(
      {
        organization_id: organizationId,
        session_id: sessionId,
        provider,
        provider_instance_id: normalizeOptional(scope.providerInstanceId),
        event_key: eventKey,
        event_type: eventType,
        payload: sanitizeProviderPayload(scope.providerPayload),
        status: "processing",
        attempts: 1,
        max_attempts: MAX_ATTEMPTS,
        next_attempt_at: nowIso,
        locked_at: nowIso,
        locked_by: ownerId,
      },
      { onConflict: "event_key", ignoreDuplicates: true },
    )
    .select("id")
    .maybeSingle();

  if (insertError) throw new EvolutionMessageClaimError();
  if (inserted?.id) {
    return { outcome: "claimed", claimId: inserted.id, ownerId, resumed: false };
  }

  const { data: existing, error: readError } = await client
    .from("whatsapp_webhook_inbox")
    .select(
      "id, organization_id, session_id, provider, status, attempts, max_attempts, locked_at, locked_by, next_attempt_at",
    )
    .eq("event_key", eventKey)
    .maybeSingle();
  if (readError || !existing) throw new EvolutionMessageClaimError();
  if (
    existing.organization_id !== organizationId ||
    existing.session_id !== sessionId ||
    existing.provider !== provider
  ) {
    throw new EvolutionMessageClaimError();
  }

  if (existing.status === "processed") return { outcome: "duplicate" };
  if (existing.status === "dead" || existing.attempts >= existing.max_attempts) {
    return { outcome: "dead" };
  }

  const leaseCutoff = new Date(now.getTime() - leaseMs).toISOString();
  if (existing.status === "processing") {
    const lockedAt = parseClaimTimestamp(existing.locked_at);
    if (lockedAt >= now.getTime() - leaseMs) {
      return { outcome: "in_progress" };
    }
  } else {
    const nextAttemptAt = parseClaimTimestamp(existing.next_attempt_at);
    if (nextAttemptAt > now.getTime()) return { outcome: "in_progress" };
  }

  let takeover = client
    .from("whatsapp_webhook_inbox")
    .update({
      status: "processing",
      attempts: existing.attempts + 1,
      locked_at: nowIso,
      locked_by: ownerId,
      last_error: null,
      processed_at: null,
    })
    .eq("id", existing.id)
    .eq("status", existing.status);

  if (existing.status === "processing") {
    takeover = takeover
      .eq("locked_by", existing.locked_by)
      .lt("locked_at", leaseCutoff);
  } else {
    takeover = takeover.lte("next_attempt_at", nowIso);
  }

  const { data: resumed, error: takeoverError } = await takeover
    .select("id")
    .maybeSingle();
  if (takeoverError) throw new EvolutionMessageClaimError();
  if (!resumed?.id) return { outcome: "in_progress" };

  return { outcome: "claimed", claimId: resumed.id, ownerId, resumed: true };
}

export async function completeEvolutionMessageDelivery(
  client: EvolutionWebhookClaimClient,
  claim: OwnedEvolutionMessageClaim,
  now = new Date(),
) {
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await client
    .from("whatsapp_webhook_inbox")
    .update({
      status: "processed",
      processed_at: now.toISOString(),
      expires_at: expiresAt,
      locked_at: null,
      locked_by: null,
      last_error: null,
    })
    .eq("id", claim.claimId)
    .eq("status", "processing")
    .eq("locked_by", claim.ownerId)
    .select("id")
    .maybeSingle();

  if (error || !data?.id) throw new EvolutionMessageClaimError();
}

export async function retryEvolutionMessageDelivery(
  client: EvolutionWebhookClaimClient,
  claim: OwnedEvolutionMessageClaim,
  now = new Date(),
) {
  const { data, error } = await client
    .from("whatsapp_webhook_inbox")
    .update({
      status: "retry",
      next_attempt_at: now.toISOString(),
      locked_at: null,
      locked_by: null,
      last_error: "legacy_webhook_processing_failed",
    })
    .eq("id", claim.claimId)
    .eq("status", "processing")
    .eq("locked_by", claim.ownerId)
    .select("id")
    .maybeSingle();

  if (error || !data?.id) throw new EvolutionMessageClaimError();
}

export async function buildEvolutionMessageEventKey(
  scope: Pick<
    EvolutionMessageClaimScope,
    "organizationId" | "sessionId" | "providerMessageId"
  >,
) {
  const organizationId = requireScopeValue(scope.organizationId);
  const sessionId = requireScopeValue(scope.sessionId);
  const providerMessageId = requireScopeValue(scope.providerMessageId);
  const canonicalScope = [organizationId, sessionId, providerMessageId]
    .map((value) => `${value.length}:${value}`)
    .join("|");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonicalScope),
  );
  const fingerprint = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");

  return `evolution_go:message:${organizationId}:${sessionId}:${fingerprint}`;
}

function requireScopeValue(value: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new EvolutionMessageClaimError();
  return normalized;
}

function normalizeOptional(value: string | null | undefined) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}

function normalizeLease(value: number | undefined) {
  if (value === undefined) return DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EvolutionMessageClaimError();
  }
  return value;
}

function parseClaimTimestamp(value: string | null) {
  const timestamp = typeof value === "string" ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp)) throw new EvolutionMessageClaimError();
  return timestamp;
}

function sanitizeProviderPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizeProviderPayload);
  if (!value || typeof value !== "object") return value;

  const sanitized: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "");
    if (
      normalizedKey === "instancetoken" ||
      normalizedKey === "webhooktoken" ||
      normalizedKey === "apikey" ||
      normalizedKey === "accesstoken" ||
      normalizedKey === "authorization" ||
      normalizedKey === "signature"
    ) {
      continue;
    }
    sanitized[key] = sanitizeProviderPayload(nested);
  }
  return sanitized;
}
