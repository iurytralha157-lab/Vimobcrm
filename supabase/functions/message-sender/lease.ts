export const OUTBOX_BATCH_SIZE = 10;
export const OUTBOX_LEASE_DURATION_MS = 5 * 60 * 1000;

const LEASE_MARKER_PREFIX = "vimob-message-sender:v1";
const DEFAULT_MAX_ATTEMPTS = 3;
const PROVIDER_REQUEST_ID_PATTERN = /^[0-9A-F]{32}$/;

export type LeaseProvider = "evolution" | "evolution_go";

export type OutboxCandidateSnapshot = {
  id: string;
  attempts: number | null;
  max_attempts: number | null;
  processed_at: string | null;
  error_message: string | null;
};

export type ParsedLeaseMarker =
  | { state: "claimed"; token: string }
  | {
      state: "dispatching" | "outcome-unknown";
      provider: LeaseProvider;
      token: string;
      providerRequestId: string;
    };

function normalizeAttempts(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
}

export function normalizeMaxAttempts(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 1
    ? Math.floor(parsed)
    : DEFAULT_MAX_ATTEMPTS;
}

function validMarkerSegment(value: string) {
  return value.length > 0 && !value.includes(":");
}

export function makeClaimedLeaseMarker(token: string) {
  if (!validMarkerSegment(token)) throw new Error("Invalid outbox lease token");
  return `${LEASE_MARKER_PREFIX}:claimed:${token}`;
}

export function makeDispatchingLeaseMarker(
  provider: LeaseProvider,
  token: string,
  providerRequestId: string,
) {
  if (
    !validMarkerSegment(token) ||
    !PROVIDER_REQUEST_ID_PATTERN.test(providerRequestId)
  ) {
    throw new Error("Invalid outbox dispatch marker");
  }
  return `${LEASE_MARKER_PREFIX}:dispatching:${provider}:${token}:${providerRequestId}`;
}

export function makeOutcomeUnknownLeaseMarker(
  provider: LeaseProvider,
  token: string,
  providerRequestId: string,
) {
  if (
    !validMarkerSegment(token) ||
    !PROVIDER_REQUEST_ID_PATTERN.test(providerRequestId)
  ) {
    throw new Error("Invalid outbox outcome marker");
  }
  return `${LEASE_MARKER_PREFIX}:outcome-unknown:${provider}:${token}:${providerRequestId}`;
}

export function parseLeaseMarker(value: unknown): ParsedLeaseMarker | null {
  if (typeof value !== "string") return null;
  const parts = value.split(":");
  if (parts[0] !== "vimob-message-sender" || parts[1] !== "v1") return null;

  if (
    parts.length === 4 &&
    parts[2] === "claimed" &&
    validMarkerSegment(parts[3])
  ) {
    return { state: "claimed", token: parts[3] };
  }

  const state = parts[2];
  const provider = parts[3];
  if (
    parts.length !== 6 ||
    (
      state !== "dispatching" &&
      state !== "outcome-unknown"
    ) ||
    (provider !== "evolution" && provider !== "evolution_go") ||
    !validMarkerSegment(parts[4]) ||
    !PROVIDER_REQUEST_ID_PATTERN.test(parts[5])
  ) {
    return null;
  }

  return {
    state,
    provider,
    token: parts[4],
    providerRequestId: parts[5],
  };
}

export function planPendingClaim(candidate: OutboxCandidateSnapshot) {
  const attempts = normalizeAttempts(candidate.attempts);
  const maxAttempts = normalizeMaxAttempts(candidate.max_attempts);
  if (attempts >= maxAttempts) {
    return { kind: "quarantine" as const, reason: "attempts-exhausted" as const };
  }
  return { kind: "claim" as const, nextAttempts: attempts + 1 };
}

export function planStaleRecovery(candidate: OutboxCandidateSnapshot) {
  const marker = parseLeaseMarker(candidate.error_message);
  const attempts = normalizeAttempts(candidate.attempts);
  const maxAttempts = normalizeMaxAttempts(candidate.max_attempts);

  if (attempts > maxAttempts) {
    return {
      kind: "quarantine" as const,
      reason: "stale-attempts-exhausted" as const,
    };
  }

  // This marker is persisted before any provider call. Reusing its already
  // reserved attempt is safe even when that attempt is the configured last one.
  if (marker?.state === "claimed") {
    return {
      kind: "recover" as const,
      nextAttempts: attempts,
      reason: "crash-before-provider" as const,
    };
  }

  // A deterministic provider id is a correlation key, not a durable delivery
  // receipt. Once any provider boundary was crossed, automatic retry can still
  // duplicate a message and must fail closed for manual reconciliation.
  return {
    kind: "quarantine" as const,
    reason: marker?.provider === "evolution_go"
      ? "evolution-go-provider-ambiguous" as const
      : marker?.provider === "evolution"
      ? "legacy-provider-ambiguous" as const
      : "unmarked-processing-state" as const,
  };
}

export function planUncertainOutcome(provider: LeaseProvider) {
  return {
    kind: "quarantine" as const,
    reason: provider === "evolution"
      ? "legacy-provider-outcome-unknown" as const
      : "evolution-go-provider-outcome-unknown" as const,
  };
}

export function manualReconciliationMessage(reason: string) {
  return `Manual reconciliation required (${reason}); automatic provider retry disabled`;
}

export function isAmbiguousProviderFailure(statusValue: unknown) {
  const status = Number(statusValue);
  return Number.isFinite(status) && (status === 408 || status >= 500);
}

type ExactFilterBuilder = {
  eq(column: string, value: unknown): unknown;
  is(column: string, value: unknown): unknown;
};

function applyNullableExactFilter<T>(
  query: T,
  column: string,
  value: unknown,
): T {
  const filterable = query as T & ExactFilterBuilder;
  return (value === null || value === undefined
    ? filterable.is(column, null)
    : filterable.eq(column, value)) as T;
}

export function applyOutboxSnapshotFilters<T>(
  query: T,
  candidate: OutboxCandidateSnapshot,
): T {
  let filtered = applyNullableExactFilter(
    query,
    "attempts",
    candidate.attempts,
  );
  filtered = applyNullableExactFilter(
    filtered,
    "max_attempts",
    candidate.max_attempts,
  );
  filtered = applyNullableExactFilter(
    filtered,
    "processed_at",
    candidate.processed_at,
  );
  return applyNullableExactFilter(
    filtered,
    "error_message",
    candidate.error_message,
  );
}
