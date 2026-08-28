/* eslint-disable @typescript-eslint/no-explicit-any */
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import {
  applyOutboxSnapshotFilters,
  isAmbiguousProviderFailure,
  makeClaimedLeaseMarker,
  makeDispatchingLeaseMarker,
  manualReconciliationMessage,
  OUTBOX_BATCH_SIZE,
  OUTBOX_LEASE_DURATION_MS,
  planPendingClaim,
  planStaleRecovery,
  planUncertainOutcome,
  type LeaseProvider,
  type OutboxCandidateSnapshot,
} from "./lease.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OUTBOX_MESSAGE_SELECT = `
  *,
  session:whatsapp_sessions!outbox_messages_session_id_fkey(id, organization_id, instance_name, status, provider),
  conversation:whatsapp_conversations!outbox_messages_conversation_id_fkey(id, remote_jid, is_group, organization_id, lead_id)
`;

const OUTBOX_CANDIDATE_SELECT =
  "id, organization_id, attempts, max_attempts, processed_at, error_message";

const PROVIDER_REQUEST_TIMEOUT_MS = 25_000;

type WhatsAppProvider = LeaseProvider;

type AuditableOutboxCandidateSnapshot = OutboxCandidateSnapshot & {
  organization_id?: string | null;
};

type OwnedOutboxMessage = {
  message: any;
  leaseToken: string;
  leaseTimestamp: string;
  leaseMarker: string;
};

class ProviderOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderOutcomeUnknownError";
  }
}

class ClaimOwnershipLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimOwnershipLostError";
  }
}

class ManualReconciliationRequiredError extends Error {
  reason: string;
  uncertain: boolean;

  constructor(reason: string, message: string, uncertain = false) {
    super(message);
    this.name = "ManualReconciliationRequiredError";
    this.reason = reason;
    this.uncertain = uncertain;
  }
}

class HistoryProjectionAfterProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HistoryProjectionAfterProviderError";
  }
}

type ManualReconciliationAuditInput = {
  organizationId: string | null | undefined;
  outboxId: string;
  reason: string;
  provider: WhatsAppProvider | null;
  attempts: unknown;
  maxAttempts: unknown;
  historyCommitted: boolean;
};

function normalizeProvider(value: unknown): WhatsAppProvider {
  return value === "evolution_go" ? "evolution_go" : "evolution";
}

function currentLeaseSnapshot(
  message: any,
  leaseTimestamp: string,
  leaseMarker: string,
): OutboxCandidateSnapshot {
  return {
    id: String(message.id),
    attempts: message.attempts ?? null,
    max_attempts: message.max_attempts ?? null,
    processed_at: leaseTimestamp,
    error_message: leaseMarker,
  };
}

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
  headers: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

async function deterministicProviderMessageId(message: any) {
  const stableKey = String(message?.client_message_id || message?.id || "").trim();
  if (!stableKey) throw new Error("Outbox message has no stable idempotency key");

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(stableKey),
  );
  return Array.from(new Uint8Array(digest).slice(0, 16))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function getSentMessageId(data: any) {
  const paths = [
    "sentMessageId",
    "messageId",
    "messageID",
    "MessageID",
    "id",
    "ID",
    "Id",
    "key.id",
    "key.ID",
    "Key.ID",
    "data.sentMessageId",
    "data.messageId",
    "data.messageID",
    "data.MessageID",
    "data.id",
    "data.ID",
    "data.key.id",
    "data.Key.ID",
    "Data.messageId",
    "Data.MessageID",
    "Data.id",
    "Data.ID",
    "message.key.id",
    "message.Key.ID",
    "data.message.key.id",
    "data.message.Key.ID",
    "response.key.id",
    "response.Key.ID",
  ];
  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => acc?.[key], data);
    if (value) return String(value);
  }
  return null;
}

function isAutomationOutboxMessage(message: any) {
  const clientMessageId = String(message?.client_message_id || "");
  return !message?.created_by || clientMessageId.startsWith("jhenny-") || clientMessageId.startsWith("ai-");
}

function getOutboxSenderName(message: any) {
  const clientMessageId = String(message?.client_message_id || "");
  if (clientMessageId.startsWith("jhenny-") || clientMessageId.startsWith("ai-")) return "Jhenny";
  return null;
}

async function assertDeterministicLogicalOwner(
  supabase: any,
  message: any,
) {
  if (!message.client_message_id) return;

  // Code-only guard for the legacy outbox. The table still lacks a composite
  // unique constraint/index for this logical key; a migration is required to
  // eliminate the residual concurrent-insert race and full scale risk.
  const { data: owner, error } = await supabase
    .from("outbox_messages")
    .select("id")
    .eq("organization_id", message.organization_id)
    .eq("session_id", message.session_id)
    .eq("client_message_id", message.client_message_id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to resolve logical outbox owner: ${error.message}`);
  }
  if (!owner?.id) {
    throw new Error("Logical outbox owner was not found");
  }
  if (owner.id !== message.id) {
    throw new ManualReconciliationRequiredError(
      "duplicate-logical-outbox-owner",
      "Duplicate logical outbox message is not the deterministic owner",
    );
  }
}

async function findMessageHistory(
  supabase: any,
  message: any,
  stableProviderRequestId: string,
) {
  let query = supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, status, message_id, provider_message_id")
    .eq("organization_id", message.organization_id)
    .eq("session_id", message.session_id);

  query = message.client_message_id
    ? query.eq("client_message_id", message.client_message_id)
    : query.eq("message_id", stableProviderRequestId);

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new Error(`Unable to read CRM message history: ${error.message}`);
  }
  return data;
}

function isConfirmedPendingHistory(
  history: any,
  stableProviderRequestId: string,
) {
  return !!history?.id && history.status === "pending" &&
    history.message_id === stableProviderRequestId &&
    !history.provider_message_id;
}

async function ensurePendingMessageHistory(
  supabase: any,
  message: any,
  stableProviderRequestId: string,
) {
  const messageOrganizationId = message.organization_id;
  const messageLeadId = message.lead_id || message.conversation?.lead_id || null;
  const messageRemoteJid = message.conversation?.remote_jid || null;
  const pendingValues = {
    conversation_id: message.conversation_id,
    organization_id: messageOrganizationId,
    lead_id: messageLeadId,
    remote_jid: messageRemoteJid,
    sender_user_id: message.created_by || null,
    message_id: stableProviderRequestId,
    from_me: true,
    direction: "outbound",
    content: message.content,
    message_type: message.message_type,
    media_url: message.media_url,
    media_mime_type: message.media_mime_type,
    sender_name: getOutboxSenderName(message),
    status: "pending",
  };

  let existing = await findMessageHistory(
    supabase,
    message,
    stableProviderRequestId,
  );
  let insertConflict = false;

  if (!existing) {
    const { data: inserted, error: insertError } = await supabase
      .from("whatsapp_messages")
      .insert({
        ...pendingValues,
        session_id: message.session_id,
        client_message_id: message.client_message_id || null,
      })
      .select("id, conversation_id, status, message_id, provider_message_id")
      .maybeSingle();

    if (!insertError && isConfirmedPendingHistory(inserted, stableProviderRequestId)) {
      return inserted;
    }
    if (!insertError && inserted?.id) {
      throw new ManualReconciliationRequiredError(
        "history-pending-write-not-canonical",
        "Pending CRM history did not preserve its canonical provider key",
        true,
      );
    }
    if (insertError?.code !== "23505") {
      throw new Error(
        `Unable to persist pending CRM message history: ${insertError?.message || "write not confirmed"}`,
      );
    }
    insertConflict = true;

    // An optimistic UI insert can win between the read and insert. Re-read the
    // tenant/session key and validate it instead of issuing a second insert.
    existing = await findMessageHistory(
      supabase,
      message,
      stableProviderRequestId,
    );
  }

  if (!existing?.id) {
    if (insertConflict) {
      throw new ManualReconciliationRequiredError(
        "history-provider-key-already-owned",
        "Deterministic provider key is already owned by another CRM history row",
        true,
      );
    }
    throw new Error("Pending CRM message history was not confirmed");
  }
  if (existing.conversation_id !== message.conversation_id) {
    throw new ManualReconciliationRequiredError(
      "history-logical-key-scope-mismatch",
      "Existing CRM history belongs to a different conversation",
      true,
    );
  }
  if (existing.provider_message_id) {
    throw new ManualReconciliationRequiredError(
      "history-provider-outcome-already-recorded",
      "Existing CRM history already has a provider outcome",
      true,
    );
  }
  if (existing.status !== "pending") {
    throw new ManualReconciliationRequiredError(
      "history-state-not-safe-for-dispatch",
      "Existing CRM history is not safely pending",
      true,
    );
  }

  const { data: updated, error: updateError } = await supabase
    .from("whatsapp_messages")
    .update(pendingValues)
    .eq("id", existing.id)
    .eq("organization_id", messageOrganizationId)
    .eq("session_id", message.session_id)
    .eq("status", "pending")
    .select("id, status, message_id, provider_message_id")
    .maybeSingle();
  if (
    updateError ||
    !isConfirmedPendingHistory(updated, stableProviderRequestId)
  ) {
    if (updateError?.code === "23505") {
      throw new ManualReconciliationRequiredError(
        "history-provider-key-already-owned",
        "Deterministic provider key is already owned by another CRM history row",
        true,
      );
    }
    if (!updateError && updated?.id) {
      throw new ManualReconciliationRequiredError(
        "history-pending-write-not-canonical",
        "Pending CRM history did not preserve its canonical provider key",
        true,
      );
    }
    throw new Error(
      `Unable to confirm pending CRM message history: ${updateError?.message || "write not confirmed"}`,
    );
  }
  return updated;
}

async function markMessageHistorySent(
  supabase: any,
  message: any,
  historyId: string,
  sentMessageId: string,
) {
  const sentAt = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from("whatsapp_messages")
    .update({
      status: "sent",
      provider_message_id: sentMessageId,
      sent_at: sentAt,
    })
    .eq("id", historyId)
    .eq("organization_id", message.organization_id)
    .eq("session_id", message.session_id)
    .eq("status", "pending")
    .select("id, status, message_id, provider_message_id")
    .maybeSingle();

  if (updateError) {
    throw new HistoryProjectionAfterProviderError(
      `CRM sent history commit failed: ${updateError.message}`,
    );
  }
  if (
    updated?.id &&
    updated.status === "sent" &&
    updated.provider_message_id === sentMessageId
  ) return updated;

  // A provider callback may win this CAS. Only an already-terminal history
  // row with the same provider id is an acceptable confirmation.
  const { data: current, error: currentError } = await supabase
    .from("whatsapp_messages")
    .select("id, status, message_id, provider_message_id")
    .eq("id", historyId)
    .eq("organization_id", message.organization_id)
    .eq("session_id", message.session_id)
    .maybeSingle();
  const alreadySent = current &&
    ["sent", "delivered", "read"].includes(String(current.status)) &&
    (current.provider_message_id === sentMessageId ||
      current.message_id === sentMessageId);
  if (currentError || !alreadySent) {
    throw new HistoryProjectionAfterProviderError(
      `CRM sent history commit was not confirmed${currentError?.message ? `: ${currentError.message}` : ""}`,
    );
  }
  return current;
}

function normalizedAuditCount(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : null;
}

async function recordManualReconciliationAudit(
  supabase: any,
  input: ManualReconciliationAuditInput,
) {
  if (!input.organizationId || !input.outboxId) return false;

  try {
    const { error } = await supabase.from("audit_logs").insert({
      organization_id: input.organizationId,
      action: "whatsapp.manual_reconciliation_required",
      entity_type: "outbox_message",
      entity_id: input.outboxId,
      source: "message-sender",
      metadata: {
        reason: input.reason,
        provider: input.provider,
        attempts: normalizedAuditCount(input.attempts),
        max_attempts: normalizedAuditCount(input.maxAttempts),
        history_committed: input.historyCommitted,
      },
    });
    if (error) {
      console.error("Unable to persist manual reconciliation audit", {
        outbox_id: input.outboxId,
        error_code: error.code || "unknown",
      });
      return false;
    }
    return true;
  } catch {
    console.error("Unable to persist manual reconciliation audit", {
      outbox_id: input.outboxId,
      error_code: "request_failed",
    });
    return false;
  }
}

function shouldAuditStaleQuarantine(reason: string) {
  return [
    "evolution-go-provider-ambiguous",
    "legacy-provider-ambiguous",
    "unmarked-processing-state",
  ].includes(reason);
}

async function fetchProviderJsonWithTimeout(
  url: string,
  init: RequestInit,
  providerLabel: string,
) {
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    PROVIDER_REQUEST_TIMEOUT_MS,
  );

  try {
    const response = await fetch(url, {
      ...init,
      signal: abortController.signal,
    });
    const rawText = await response.text();
    if (!rawText) return { response, data: null, parsed: false };

    try {
      return { response, data: JSON.parse(rawText), parsed: true };
    } catch {
      return { response, data: null, parsed: false };
    }
  } catch {
    const suffix = abortController.signal.aborted
      ? "timed out after crossing the provider boundary"
      : "request outcome is unknown";
    throw new ProviderOutcomeUnknownError(`${providerLabel} ${suffix}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function sendViaEvolutionGo(
  supabaseUrl: string,
  serviceRoleKey: string,
  sessionId: string,
  isMedia: boolean,
  body: Record<string, unknown>,
  mediaType?: string,
) {
  if (!supabaseUrl || !serviceRoleKey || !sessionId) {
    throw new Error("Evolution Go proxy configuration missing");
  }
  const action = isMedia
    ? mediaType === "audio" ? "send.audio" : "send.media"
    : "send.text";

  let proxyUrl: string;
  try {
    proxyUrl = new URL(
      "/functions/v1/evolution-go-proxy",
      supabaseUrl,
    ).toString();
  } catch {
    throw new Error("Evolution Go proxy URL is invalid");
  }
  const requestBody = JSON.stringify({
    action,
    session_id: sessionId,
    body,
  });

  const { response, data, parsed } = await fetchProviderJsonWithTimeout(
    proxyUrl,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
        "Content-Type": "application/json",
      },
      body: requestBody,
    },
    "Evolution Go proxy",
  );

  if (!parsed) {
    if (response.ok || isAmbiguousProviderFailure(response.status)) {
      throw new ProviderOutcomeUnknownError(
        "Evolution Go accepted the request but returned an unreadable response",
      );
    }
    throw new Error("Evolution Go rejected the request");
  }
  if (!response.ok || !data?.ok) {
    if (data?.effect_not_attempted === true) {
      throw new Error(
        data?.error || "Evolution Go proxy failed before contacting the provider",
      );
    }
    const providerStatus = data?.status ?? response.status;
    if (isAmbiguousProviderFailure(providerStatus)) {
      throw new ProviderOutcomeUnknownError(
        "Evolution Go request crossed the provider boundary without a definitive rejection",
      );
    }
    throw new Error(data?.error || data?.data?.message || data?.message || "Failed to send message via Evolution Go");
  }

  return data?.data || data;
}

async function sendViaEvolutionLegacy(
  evolutionApiUrl: string | undefined,
  evolutionApiKey: string | undefined,
  instanceName: string,
  isMedia: boolean,
  body: Record<string, unknown>,
) {
  if (!evolutionApiUrl || !evolutionApiKey) {
    throw new Error("Evolution API not configured");
  }
  if (!instanceName) {
    throw new Error("Evolution instance not configured");
  }

  let endpoint: string;
  try {
    const baseUrl = evolutionApiUrl.replace(/\/+$/, "");
    const messagePath = isMedia ? "sendMedia" : "sendText";
    endpoint = new URL(
      `${baseUrl}/message/${messagePath}/${encodeURIComponent(instanceName)}`,
    ).toString();
  } catch {
    throw new Error("Evolution API URL is invalid");
  }
  const requestBody = JSON.stringify(body);

  const { response, data, parsed } = await fetchProviderJsonWithTimeout(
    endpoint,
    {
      method: "POST",
      headers: {
        "apikey": evolutionApiKey,
        "Content-Type": "application/json",
      },
      body: requestBody,
    },
    "Evolution legacy provider",
  );

  if (!parsed) {
    if (response.ok || isAmbiguousProviderFailure(response.status)) {
      throw new ProviderOutcomeUnknownError(
        "Evolution accepted the request but returned an unreadable response",
      );
    }
    throw new Error("Evolution rejected the request");
  }
  if (!response.ok || data?.error) {
    if (isAmbiguousProviderFailure(response.status)) {
      throw new ProviderOutcomeUnknownError(
        "Evolution request crossed the provider boundary without a definitive rejection",
      );
    }
    throw new Error(data?.error?.message || data?.message || "Failed to send message");
  }

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse(
      { success: false, error: "Method not allowed" },
      405,
      { "Allow": "POST, OPTIONS" },
    );
  }

  try {
    // Authenticate before parsing a payload, creating an admin client, or
    // touching the global outbox. Missing or malformed credentials fail closed.
    const secretEnvironment = readSupabaseSecretKeyEnvironment();
    if (!authorizePrivateWorkerRequest(req, secretEnvironment)) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
    const SUPABASE_ADMIN_KEY = selectSupabaseAdminSecretKey(
      secretEnvironment,
    );
    const INTERNAL_FUNCTION_KEY = secretEnvironment.SUPABASE_SERVICE_ROLE_KEY ||
      SUPABASE_ADMIN_KEY;
    if (!SUPABASE_URL || !SUPABASE_ADMIN_KEY || !INTERNAL_FUNCTION_KEY) {
      console.error("Message sender configuration unavailable");
      return jsonResponse(
        { success: false, error: "Worker configuration unavailable" },
        500,
      );
    }

    const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
    const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY);

    const summary = {
      claimed: 0,
      recovered: 0,
      sent: 0,
      retried: 0,
      failed: 0,
      uncertain: 0,
      quarantined: 0,
      exhausted: 0,
      duplicates: 0,
      claim_conflicts: 0,
      claim_errors: 0,
      manual_reconciliation_audit_errors: 0,
    };

    const auditManualReconciliation = async (
      input: ManualReconciliationAuditInput,
    ) => {
      const recorded = await recordManualReconciliationAudit(supabase, input);
      if (!recorded) summary.manual_reconciliation_audit_errors += 1;
    };

    const ownedMessages: OwnedOutboxMessage[] = [];
    const staleBefore = new Date(
      Date.now() - OUTBOX_LEASE_DURATION_MS,
    ).toISOString();

    // `processed_at` is the only timestamp available on this legacy table. It
    // is the lease clock while a row is processing, then the terminal timestamp
    // once sent/failed. Stale work is handled before fresh FIFO work so it can
    // never become an invisible, permanently-processing queue tail.
    const { data: staleCandidates, error: staleFetchError } = await supabase
      .from("outbox_messages")
      .select(OUTBOX_CANDIDATE_SELECT)
      .eq("status", "processing")
      .or(`processed_at.is.null,processed_at.lt.${staleBefore}`)
      .order("processed_at", { ascending: true, nullsFirst: true })
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(OUTBOX_BATCH_SIZE);

    if (staleFetchError) {
      console.error("Error fetching stale outbox messages:", staleFetchError);
      return jsonResponse(
        { success: false, error: "Unable to read the outbox" },
        500,
      );
    }

    // Read both deterministic candidate sets before mutating either one. A
    // pending-read failure must not strand freshly recovered stale claims.
    const remainingCapacity = Math.max(
      0,
      OUTBOX_BATCH_SIZE - (staleCandidates?.length || 0),
    );
    let pendingCandidates: AuditableOutboxCandidateSnapshot[] = [];
    if (remainingCapacity > 0) {
      const { data, error: pendingFetchError } = await supabase
        .from("outbox_messages")
        .select(OUTBOX_CANDIDATE_SELECT)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .limit(remainingCapacity);

      if (pendingFetchError) {
        console.error("Error fetching pending outbox messages:", pendingFetchError);
        return jsonResponse(
          { success: false, error: "Unable to read the outbox" },
          500,
        );
      }
      pendingCandidates = (data || []) as AuditableOutboxCandidateSnapshot[];
    }

    const quarantineCandidate = async (
      candidate: AuditableOutboxCandidateSnapshot,
      expectedStatus: "pending" | "processing",
      reason: string,
    ) => {
      const terminalTimestamp = new Date().toISOString();
      let terminalQuery = supabase
        .from("outbox_messages")
        .update({
          status: "failed",
          processed_at: terminalTimestamp,
          error_message: manualReconciliationMessage(reason),
        })
        .eq("id", candidate.id)
        .eq("status", expectedStatus);
      terminalQuery = applyOutboxSnapshotFilters(terminalQuery, candidate);
      const { data: terminalRow, error: terminalError } = await terminalQuery
        .select("id")
        .maybeSingle();

      if (terminalError) {
        summary.claim_errors += 1;
        console.error(
          `Unable to quarantine outbox message ${candidate.id}:`,
          terminalError,
        );
        return false;
      }
      if (!terminalRow) {
        summary.claim_conflicts += 1;
        return false;
      }

      summary.failed += 1;
      summary.quarantined += 1;
      if (reason.includes("attempts-exhausted")) summary.exhausted += 1;
      if (shouldAuditStaleQuarantine(reason)) {
        await auditManualReconciliation({
          organizationId: candidate.organization_id,
          outboxId: candidate.id,
          reason,
          provider: reason.startsWith("evolution-go")
            ? "evolution_go"
            : reason.startsWith("legacy")
            ? "evolution"
            : null,
          attempts: candidate.attempts,
          maxAttempts: candidate.max_attempts,
          historyCommitted: false,
        });
      }
      return true;
    };

    for (
      const candidate of (staleCandidates || []) as AuditableOutboxCandidateSnapshot[]
    ) {
      const recovery = planStaleRecovery(candidate);
      if (recovery.kind === "quarantine") {
        const quarantined = await quarantineCandidate(
          candidate,
          "processing",
          recovery.reason,
        );
        if (quarantined) summary.uncertain += 1;
        continue;
      }

      const leaseToken = crypto.randomUUID();
      const leaseTimestamp = new Date().toISOString();
      const leaseMarker = makeClaimedLeaseMarker(leaseToken);
      let recoveryQuery = supabase
        .from("outbox_messages")
        .update({
          attempts: recovery.nextAttempts,
          processed_at: leaseTimestamp,
          error_message: leaseMarker,
        })
        .eq("id", candidate.id)
        .eq("status", "processing");
      recoveryQuery = applyOutboxSnapshotFilters(recoveryQuery, candidate);
      const { data: message, error: recoveryError } = await recoveryQuery
        .select(OUTBOX_MESSAGE_SELECT)
        .maybeSingle();

      if (recoveryError) {
        summary.claim_errors += 1;
        console.error(
          `Unable to recover stale outbox message ${candidate.id}:`,
          recoveryError,
        );
        continue;
      }
      if (!message) {
        // The unique marker is part of the old-state CAS. Even if two workers
        // choose the same millisecond, only one can replace the prior token.
        summary.claim_conflicts += 1;
        continue;
      }

      summary.claimed += 1;
      summary.recovered += 1;
      ownedMessages.push({
        message,
        leaseToken,
        leaseTimestamp,
        leaseMarker,
      });
    }

    for (const candidate of pendingCandidates) {
      const pendingPlan = planPendingClaim(candidate);
      if (pendingPlan.kind === "quarantine") {
        await quarantineCandidate(candidate, "pending", pendingPlan.reason);
        continue;
      }

      const leaseToken = crypto.randomUUID();
      const leaseTimestamp = new Date().toISOString();
      const leaseMarker = makeClaimedLeaseMarker(leaseToken);
      let claimQuery = supabase
        .from("outbox_messages")
        .update({
          status: "processing",
          attempts: pendingPlan.nextAttempts,
          processed_at: leaseTimestamp,
          error_message: leaseMarker,
        })
        .eq("id", candidate.id)
        .eq("status", "pending");
      claimQuery = applyOutboxSnapshotFilters(claimQuery, candidate);
      const { data: message, error: claimError } = await claimQuery
        .select(OUTBOX_MESSAGE_SELECT)
        .maybeSingle();

      if (claimError) {
        summary.claim_errors += 1;
        console.error(`Unable to claim outbox message ${candidate.id}:`, claimError);
        continue;
      }
      if (!message) {
        summary.claim_conflicts += 1;
        continue;
      }

      summary.claimed += 1;
      ownedMessages.push({
        message,
        leaseToken,
        leaseTimestamp,
        leaseMarker,
      });
    }

    console.log(
      `Owned ${ownedMessages.length} outbox message(s); recovered ${summary.recovered}`,
    );

    for (const owned of ownedMessages) {
      const { message, leaseToken } = owned;
      let leaseTimestamp = owned.leaseTimestamp;
      let leaseMarker = owned.leaseMarker;
      let providerAccepted = false;
      let historyCommitted = false;
      let deliveryCommitted = false;
      let provider: WhatsAppProvider | null = null;
      let pendingHistoryId: string | null = null;
      try {
        // Check session is connected
        if (message.session?.status !== "connected") {
          throw new Error("Session not connected");
        }

        if (
          !message.organization_id ||
          message.session?.organization_id !== message.organization_id ||
          message.conversation?.organization_id !== message.organization_id
        ) {
          throw new Error("Outbox tenant scope mismatch");
        }

        // A client retry can create more than one legacy outbox row. Resolve
        // one deterministic logical owner before either history or provider
        // effects; every non-owner is terminalized by the owned-row CAS.
        await assertDeterministicLogicalOwner(supabase, message);

        // Use full JID for groups, digits-only for personal
        const isGroup = message.conversation?.is_group || message.conversation?.remote_jid?.endsWith("@g.us");
        const phone = isGroup
          ? message.conversation?.remote_jid
          : message.conversation?.remote_jid
              ?.replace("@s.whatsapp.net", "")
              .replace("@c.us", "");

        if (!phone) {
          throw new Error("Invalid conversation remote_jid");
        }

        provider = normalizeProvider(message.session?.provider);
        const isMedia = message.message_type !== "text" && (message.media_url || message.media_base64);

        // Evolution Go's canonical provider contract accepts a deterministic
        // 128-bit uppercase `id`, and the checked-in proxy preserves it for
        // correlation. It is not a durable provider receipt and therefore does
        // not make an ambiguous dispatch safe to retry automatically.
        const stableProviderRequestId = await deterministicProviderMessageId(message);

        // The canonical CRM history must exist durably before crossing the
        // provider boundary. A safe pre-provider retry reuses this pending row.
        const pendingHistory = await ensurePendingMessageHistory(
          supabase,
          message,
          stableProviderRequestId,
        );
        pendingHistoryId = pendingHistory.id;

        // Build request body
        let body: any;
        if (isMedia) {
          // Não enviar caption se for apenas o nome do arquivo (evita exibir nome no WhatsApp)
          const shouldSendCaption = message.content &&
            message.content !== message.media_filename &&
            !message.content.match(/^[a-f0-9-]+\.(png|jpg|jpeg|gif|webp|mp4|mp3|pdf|doc|docx)$/i);

          body = {
            id: stableProviderRequestId,
            number: phone,
            mediatype: message.message_type || "image",
            caption: shouldSendCaption ? message.content : undefined,
            media: message.media_url || message.media_base64,
            fileName: message.media_filename,
            mimetype: message.media_mime_type || undefined,
          };
          if (message.media_base64) {
            body.media = message.media_base64;
          }
        } else {
          body = {
            id: stableProviderRequestId,
            number: phone,
            text: message.content,
          };
        }

        // Persist the provider boundary before the side effect. A crash while
        // the row still has `claimed` proves the provider was never invoked.
        const dispatchTimestamp = new Date().toISOString();
        const dispatchMarker = makeDispatchingLeaseMarker(
          provider,
          leaseToken,
          stableProviderRequestId,
        );
        let dispatchQuery = supabase
          .from("outbox_messages")
          .update({
            processed_at: dispatchTimestamp,
            error_message: dispatchMarker,
          })
          .eq("id", message.id)
          .eq("status", "processing");
        dispatchQuery = applyOutboxSnapshotFilters(
          dispatchQuery,
          currentLeaseSnapshot(message, leaseTimestamp, leaseMarker),
        );
        const { data: dispatchClaim, error: dispatchClaimError } =
          await dispatchQuery.select("id").maybeSingle();
        if (dispatchClaimError || !dispatchClaim) {
          throw new ClaimOwnershipLostError(
            dispatchClaimError
              ? `Unable to confirm provider dispatch lease: ${dispatchClaimError.message}`
              : "Provider dispatch lease is no longer owned",
          );
        }
        leaseTimestamp = dispatchTimestamp;
        leaseMarker = dispatchMarker;

        const data = provider === "evolution_go"
          ? await sendViaEvolutionGo(
              SUPABASE_URL,
              INTERNAL_FUNCTION_KEY,
              message.session_id,
              !!isMedia,
              body,
              message.message_type,
            )
          : await sendViaEvolutionLegacy(
              EVOLUTION_API_URL,
              EVOLUTION_API_KEY,
              message.session.instance_name,
              !!isMedia,
              body,
            );
        providerAccepted = true;
        console.log(`Provider accepted outbox message ${message.id} via ${provider}`);

        const sentMessageId = getSentMessageId(data) || stableProviderRequestId;

        // History is the first durable post-provider commit. The outbox must
        // never become `sent` unless this projection is already confirmed.
        await markMessageHistorySent(
          supabase,
          message,
          pendingHistoryId,
          sentMessageId,
        );
        historyCommitted = true;

        // Commit only the claim this worker still owns. If this write cannot be
        // confirmed after provider acceptance, never requeue automatically: a
        // retry could deliver a duplicate message.
        let sentOutboxQuery = supabase
          .from("outbox_messages")
          .update({
            status: "sent",
            sent_message_id: sentMessageId,
            processed_at: new Date().toISOString(),
            error_message: null,
          })
          .eq("id", message.id)
          .eq("status", "processing");
        sentOutboxQuery = applyOutboxSnapshotFilters(
          sentOutboxQuery,
          currentLeaseSnapshot(message, leaseTimestamp, leaseMarker),
        );
        const { data: sentOutbox, error: sentOutboxError } =
          await sentOutboxQuery.select("id").maybeSingle();

        if (sentOutboxError || !sentOutbox) {
          throw new Error(
            sentOutboxError
              ? `Outbox sent commit failed: ${sentOutboxError.message}`
              : "Outbox sent commit was not confirmed",
          );
        }
        deliveryCommitted = true;

        const messageOrganizationId = message.organization_id;
        // Update conversation
        await supabase
          .from("whatsapp_conversations")
          .update({
            last_message: message.content,
            last_message_at: new Date().toISOString(),
            unread_count: 0,
          })
          .eq("id", message.conversation_id)
          .eq("organization_id", messageOrganizationId);

        // ===== FIRST RESPONSE & FIRST TOUCH TRACKING =====
        // Get the conversation to check if it has a lead_id
        const { data: convData } = await supabase
          .from("whatsapp_conversations")
          .select("lead_id")
          .eq("id", message.conversation_id)
          .eq("organization_id", messageOrganizationId)
          .single();

        if (convData?.lead_id) {
          try {
            console.log(`Triggering first response calculation for lead ${convData.lead_id}`);

            // Mark first_touch_at for pool system (only if not already set)
            await supabase
              .from("leads")
              .update({ first_touch_at: new Date().toISOString() })
              .eq("id", convData.lead_id)
              .eq("organization_id", messageOrganizationId)
              .is("first_touch_at", null);

            console.log(`Marked first touch for lead ${convData.lead_id}`);

            // Call calculate-first-response for SLA tracking
            await fetch(`${SUPABASE_URL}/functions/v1/calculate-first-response`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${INTERNAL_FUNCTION_KEY}`
              },
              body: JSON.stringify({
                lead_id: convData.lead_id,
                channel: "whatsapp",
                actor_user_id: message.created_by,
                is_automation: isAutomationOutboxMessage(message),
                organization_id: message.organization_id
              })
            });
          } catch (firstResponseError) {
            console.error("Error calling first response:", firstResponseError);
            // Don't fail the message send if first response fails
          }

          // ===== STOP AUTOMATIONS ON MANUAL HUMAN REPLY (via internal CRM chat) =====
          // Mirror of evolution-webhook's isManualInteraction path. We cancel all
          // running/waiting executions for this lead so the automation stops the
          // moment the broker takes over the conversation from the app UI.
          if (message.created_by) {
            try {
            const { data: activeExecs } = await supabase
              .from("automation_executions")
              .select("id, automation_id, automations(name)")
              .eq("lead_id", convData.lead_id)
              .eq("organization_id", messageOrganizationId)
              .in("status", ["running", "waiting"]);

            if (activeExecs && activeExecs.length > 0) {
              const ids = activeExecs.map((e: any) => e.id);
              await supabase
                .from("automation_executions")
                .update({
                  status: "cancelled",
                  completed_at: new Date().toISOString(),
                  error_message: "Cancelado: intervenção humana (chat interno)",
                })
                .in("id", ids)
                .eq("organization_id", messageOrganizationId);

              const activityRows = activeExecs.map((e: any) => ({
                organization_id: messageOrganizationId,
                lead_id: convData.lead_id,
                type: "automation_cancelled_manual",
                content: `Automação "${e.automations?.name || ""}" cancelada: atendimento humano iniciado`,
                metadata: { is_automation: true, execution_id: e.id, automation_id: e.automation_id, source: "internal_chat" },
                user_id: null,
              }));
              if (activityRows.length) {
                await supabase.from("activities").insert(activityRows);
              }
              console.log(`Cancelled ${ids.length} active automation(s) due to manual reply via internal chat`);
            }
            } catch (cancelErr) {
              console.error("Error cancelling automations on manual reply:", cancelErr);
            }
          }
        }

        summary.sent += 1;

      } catch (error) {
        console.error(`Error sending message ${message.id}:`, error);

        const errorMessage = error instanceof Error ? error.message : "Unknown error";

        if (deliveryCommitted) {
          // The delivery is durable. Failures in secondary CRM projections must
          // never turn the provider delivery into a retry.
          summary.sent += 1;
          continue;
        }

        if (error instanceof ClaimOwnershipLostError) {
          // No provider call happened after an unconfirmed dispatch-boundary
          // CAS. The surviving row will be recovered from its persisted marker.
          summary.claim_conflicts += 1;
          continue;
        }

        if (error instanceof ManualReconciliationRequiredError) {
          const terminalTimestamp = new Date().toISOString();
          let terminalQuery = supabase
            .from("outbox_messages")
            .update({
              status: "failed",
              processed_at: terminalTimestamp,
              error_message: manualReconciliationMessage(error.reason),
            })
            .eq("id", message.id)
            .eq("status", "processing");
          terminalQuery = applyOutboxSnapshotFilters(
            terminalQuery,
            currentLeaseSnapshot(message, leaseTimestamp, leaseMarker),
          );
          const { data: terminalRow, error: terminalError } =
            await terminalQuery.select("id").maybeSingle();
          if (terminalError || !terminalRow) {
            console.error(
              `Unable to terminalize outbox message ${message.id}:`,
              terminalError || "processing claim no longer owned",
            );
            summary.claim_conflicts += 1;
          } else {
            summary.failed += 1;
            summary.quarantined += 1;
            if (error.reason === "duplicate-logical-outbox-owner") {
              summary.duplicates += 1;
            }
            if (error.uncertain) {
              await auditManualReconciliation({
                organizationId: message.organization_id,
                outboxId: message.id,
                reason: error.reason,
                provider,
                attempts: message.attempts,
                maxAttempts: message.max_attempts,
                historyCommitted,
              });
            }
          }
          if (error.uncertain) summary.uncertain += 1;
          continue;
        }

        if (providerAccepted || error instanceof ProviderOutcomeUnknownError) {
          // The provider accepted the request, but the durable `sent` write was
          // not confirmed, or the transport failed after dispatch and cannot
          // prove rejection. A deterministic id is correlation, not a provider
          // receipt, so ProviderOutcomeUnknownError is terminal for every
          // provider and is never requeued or redispatched.
          const outcomeProvider = provider || "evolution";
          const outcomePlan = planUncertainOutcome(outcomeProvider);
          const outcomeReason = error instanceof HistoryProjectionAfterProviderError
            ? "provider-accepted-history-not-confirmed"
            : historyCommitted
            ? "provider-accepted-outbox-sent-not-confirmed"
            : outcomePlan.reason;
          const outcomeTimestamp = new Date().toISOString();
          const ownedSnapshot = currentLeaseSnapshot(
            message,
            leaseTimestamp,
            leaseMarker,
          );

          let outcomeQuery = supabase
            .from("outbox_messages")
            .update({
              status: "failed",
              processed_at: outcomeTimestamp,
              error_message: manualReconciliationMessage(outcomeReason),
            })
            .eq("id", message.id)
            .eq("status", "processing");
          outcomeQuery = applyOutboxSnapshotFilters(
            outcomeQuery,
            ownedSnapshot,
          );
          const { data: outcomeRow, error: outcomeStateError } =
            await outcomeQuery.select("id").maybeSingle();
          if (outcomeStateError || !outcomeRow) {
            console.error(
              `Unable to record uncertain delivery ${message.id}:`,
              outcomeStateError || "processing claim no longer owned",
            );
            summary.claim_conflicts += 1;
          } else {
            summary.failed += 1;
            summary.quarantined += 1;
            await auditManualReconciliation({
              organizationId: message.organization_id,
              outboxId: message.id,
              reason: outcomeReason,
              provider: outcomeProvider,
              attempts: message.attempts,
              maxAttempts: message.max_attempts,
              historyCommitted,
            });
          }
          summary.uncertain += 1;
          continue;
        }

        const failedAttemptPlan = planPendingClaim(
          currentLeaseSnapshot(message, leaseTimestamp, leaseMarker),
        );
        const isFinalAttempt = failedAttemptPlan.kind === "quarantine";

        let retryStateQuery = supabase
          .from("outbox_messages")
          .update({
            status: isFinalAttempt ? "failed" : "pending",
            error_message: errorMessage,
            processed_at: isFinalAttempt ? new Date().toISOString() : null
          })
          .eq("id", message.id)
          .eq("status", "processing");
        retryStateQuery = applyOutboxSnapshotFilters(
          retryStateQuery,
          currentLeaseSnapshot(message, leaseTimestamp, leaseMarker),
        );
        const { data: retryState, error: retryStateError } =
          await retryStateQuery.select("id").maybeSingle();

        if (retryStateError || !retryState) {
          console.error(
            `Unable to persist failed attempt ${message.id}:`,
            retryStateError || "processing claim no longer owned",
          );
          summary.uncertain += 1;
          continue;
        }

        // If final attempt failed, update the optimistic message status too
        if (isFinalAttempt && pendingHistoryId) {
          await supabase
            .from("whatsapp_messages")
            .update({ status: "failed" })
            .eq("id", pendingHistoryId)
            .eq("organization_id", message.organization_id)
            .eq("session_id", message.session_id)
            .eq("status", "pending");
        } else if (isFinalAttempt && message.client_message_id) {
          await supabase
            .from("whatsapp_messages")
            .update({ status: "failed" })
            .eq("organization_id", message.organization_id)
            .eq("session_id", message.session_id)
            .eq("client_message_id", message.client_message_id);
        }

        if (isFinalAttempt) summary.failed += 1;
        else summary.retried += 1;
      }
    }

    // Deliberately aggregate the response. This worker may process many
    // organizations in one run; callers must never receive another tenant's
    // message ids, provider ids, content, or error details.
    return jsonResponse({
      success: true,
      processed: summary.claimed,
      recovered: summary.recovered,
      sent: summary.sent,
      retried: summary.retried,
      failed: summary.failed,
      uncertain: summary.uncertain,
      quarantined: summary.quarantined,
      exhausted: summary.exhausted,
      duplicates: summary.duplicates,
      claim_conflicts: summary.claim_conflicts,
      claim_errors: summary.claim_errors,
      manual_reconciliation_audit_errors:
        summary.manual_reconciliation_audit_errors,
    });

  } catch (error) {
    console.error("Message sender error:", error);
    return jsonResponse(
      { success: false, error: "Message sender failed" },
      500,
    );
  }
});
