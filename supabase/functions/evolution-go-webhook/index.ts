/* eslint-disable @typescript-eslint/no-explicit-any */
// Evolution Go webhook for the Vimob WhatsApp module.
// All writes are scoped by a resolved whatsapp_sessions.id before touching CRM data.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  monotonicWhatsAppMessageStatus as monotonicMessageStatus,
  monotonicWhatsAppOutboxStatus as monotonicOutboxStatus,
} from "../_shared/whatsapp-message-status.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import { whatsappCTWAConfirmationMethod } from "../_shared/whatsapp-ctwa.ts";
import {
  claimEvolutionMessageDelivery,
  completeEvolutionMessageDelivery,
  retryEvolutionMessageDelivery,
  type OwnedEvolutionMessageClaim,
} from "../evolution-webhook/delivery-claim.ts";
import {
  authorizeEvolutionGoWebhookIngress,
  readBoundedJsonBody,
  validateEvolutionGoSessionBinding,
  WebhookRequestBodyError,
  type EvolutionGoWebhookAuthorization,
} from "./request-security.ts";
import {
  appendConversationUnreadEffect,
  completedEvolutionGoEffectMetadata,
  conversationUnreadEffectCount,
  deterministicEvolutionGoEffectId,
  EVOLUTION_GO_UNREAD_LEDGER_LIMIT,
  evolutionGoEffectFingerprint,
  hasConversationUnreadEffect,
  pendingEvolutionGoEffectMetadata,
  removeConversationUnreadEffect,
  storedEvolutionGoEffectState,
} from "./message-effects.ts";
import {
  decodeBoundedWhatsAppMediaBase64,
  isEncryptedWhatsAppMediaURL,
  validateWhatsAppPlaintextMedia,
  WHATSAPP_MEDIA_MAX_BYTES,
  WhatsAppMediaValidationError,
} from "./media-security.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, x-webhook-secret, x-webhook-token, x-evolution-webhook-token, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

type WhatsAppMessageCaptureState = "legacy" | "captured" | "suppressed";

type WhatsAppAttendanceCaptureDecision = {
  captureState: WhatsAppMessageCaptureState;
  reason: string;
  bindingId: string | null;
  attendanceEntryId: string | null;
  ingressSequence: number | null;
  inboxCreatedAt: string | null;
  messageFingerprint: string;
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const EVOLUTION_GO_API_URL = (Deno.env.get("EVOLUTION_GO_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_GO_API_KEY = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
const EVOLUTION_WEBHOOK_SECRET = Deno.env.get("EVOLUTION_WEBHOOK_SECRET") || "";
const VIMOB_API_URL = Deno.env.get("VIMOB_API_URL") || Deno.env.get("VIMOB_API_BASE_URL") || "";
const AI_AUTOREPLY_TOKEN = Deno.env.get("AI_AUTOREPLY_TOKEN") || Deno.env.get("INTERNAL_WEBHOOK_TOKEN") || "";
// Stay below Evolution's callback retry window; failures persist as pending.
const EVOLUTION_GO_MEDIA_TIMEOUT_MS = 20_000;
const EVOLUTION_GO_MEDIA_RESPONSE_MAX_BYTES = Math.ceil(WHATSAPP_MEDIA_MAX_BYTES / 3) * 4 + 1024 * 1024;
const CANONICAL_INTAKE_PROOF_V1 = "canonical_intake_v1:";

let supabase: any;

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toArray<T = any>(value: unknown): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value as T[] : [value as T];
}

function getNested(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function firstPresent(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstDefined(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null);
}

function normalizeText(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function cleanText(value: unknown) {
  const text = normalizeText(value).trim();
  return text || null;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function redactLogText(value: unknown) {
  const text = value instanceof Error ? value.message : String(value ?? "");
  return text
    .replace(/([?&](?:webhook_token|apikey|token|access_token|signature)=)[^&\s"']+/gi, "$1[REDACTED]")
    .replace(/((?:webhook_token|instanceToken|instance_token|apikey|api_key|token|access_token|authorization|signature)["']?\s*[:=]\s*["']?)[^"',}\s&]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~-]+/gi, "$1[REDACTED]")
    .slice(0, 1000);
}

function optionalUuid(value: unknown) {
  const text = normalizeText(value).trim();
  if (!text) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)
    ? text.toLowerCase()
    : null;
}

function isUniqueViolation(error: any, constraintName?: string) {
  if (error?.code !== "23505") return false;
  if (!constraintName) return true;
  return normalizeText(error.message).includes(constraintName);
}

function isAmbiguousWhatsAppLeadPhone(error: any) {
  return error?.code === "23505"
    && normalizeText(error.message).includes("whatsapp_lead_phone_ambiguous");
}

function quarantinedWhatsAppLeadResolution(reason: string): JsonRecord {
  return {
    __whatsapp_lead_resolution_quarantined: true,
    __whatsapp_lead_resolution_reason: reason,
  };
}

function isQuarantinedWhatsAppLeadResolution(value: unknown): value is JsonRecord {
  return isRecord(value) && value.__whatsapp_lead_resolution_quarantined === true;
}

function terminalLeadResolutionQuarantineReason(metadata: unknown) {
  if (!isRecord(metadata)) return null;
  const quarantine = metadata.lead_resolution_quarantine;
  if (
    !isRecord(quarantine)
    || quarantine.terminal !== true
    || quarantine.retryable !== false
  ) return null;
  return cleanText(quarantine.reason) || "whatsapp_lead_resolution_ambiguous";
}

function persistedWhatsAppMessageCaptureState(
  storedMessage: JsonRecord | null | undefined,
): WhatsAppMessageCaptureState | null {
  if (!storedMessage) return null;
  const value = cleanText(storedMessage.capture_state);
  if (!value) return "legacy";
  if (["legacy", "captured", "suppressed"].includes(value)) {
    return value as WhatsAppMessageCaptureState;
  }
  throw new Error("whatsapp_message_capture_state_invalid");
}

function attendanceCaptureMetadata(
  decision: WhatsAppAttendanceCaptureDecision,
) {
  return {
    version: 1,
    state: decision.captureState,
    reason: decision.reason,
    binding_id: decision.bindingId,
    attendance_entry_id: decision.attendanceEntryId,
    ingress_sequence: decision.ingressSequence,
    inbox_created_at: decision.inboxCreatedAt,
    message_fingerprint: decision.messageFingerprint,
  };
}

function redactedSuppressedMessageMetadata(
  metadata: unknown,
  providerMessageId: string,
  decision: WhatsAppAttendanceCaptureDecision | null = null,
  completed = false,
) {
  const root = isRecord(metadata) ? metadata : {};
  const existingCapture = isRecord(root.whatsapp_attendance_capture)
    ? root.whatsapp_attendance_capture
    : null;
  const quarantine = isRecord(root.lead_resolution_quarantine)
    ? root.lead_resolution_quarantine
    : null;
  const safeMetadata = {
    source: "evolution_go_webhook",
    whatsapp_event_binding_is_current: false,
    whatsapp_attendance_capture: decision
      ? attendanceCaptureMetadata(decision)
      : (existingCapture || {
        version: 1,
        state: "suppressed",
        reason: "persisted_suppression",
      }),
    ...(quarantine ? { lead_resolution_quarantine: quarantine } : {}),
  };
  const existingState = storedEvolutionGoEffectState(metadata, providerMessageId);
  return completed || existingState === "completed"
    ? completedEvolutionGoEffectMetadata(safeMetadata, providerMessageId)
    : pendingEvolutionGoEffectMetadata(safeMetadata, providerMessageId);
}

function normalizeDigits(value: unknown) {
  return normalizeText(value).replace(/\D/g, "");
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeJid(value: unknown, forceGroup = false) {
  const raw = normalizeText(value).trim();
  if (!raw) return "";
  if (raw.includes("@")) {
    const [left, domain] = raw.split("@", 2);
    const normalizedLeft = /^\d+:\d+$/.test(left) ? left.split(":")[0] : left;
    const normalizedDomain = domain === "c.us" ? "s.whatsapp.net" : domain;
    return `${normalizedLeft}@${normalizedDomain}`;
  }
  const digits = normalizeDigits(raw);
  if (!digits) return raw;
  return `${digits}@${forceGroup ? "g.us" : "s.whatsapp.net"}`;
}

function isGroupJid(value: string) {
  return value.endsWith("@g.us");
}

function isLidJid(value: string) {
  return value.endsWith("@lid");
}

function isNewsletterJid(value: string) {
  return value.endsWith("@newsletter");
}

function isBroadcastJid(value: string) {
  return value.endsWith("@broadcast");
}

function isStatusJid(value: string) {
  return value.endsWith("@status");
}

function isOpaqueJid(value: string) {
  const lower = value.toLowerCase();
  return isLidJid(lower) || isNewsletterJid(lower) || isBroadcastJid(lower) || isStatusJid(lower);
}

function normalizeJidList(values: unknown[], forceGroup = false) {
  return unique(values.map((value) => normalizeJid(value, forceGroup)).filter(Boolean));
}

function phoneFromJidLike(value: unknown) {
  const raw = normalizeText(value).trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();
  if (
    lower.includes("@g.us") ||
    lower.includes("@lid") ||
    lower.includes("@newsletter") ||
    lower.includes("@broadcast") ||
    lower.includes("@status")
  ) {
    return "";
  }

  const hasDomain = lower.includes("@");
  let left = raw;
  if (hasDomain) left = raw.split("@", 1)[0];
  if (left.includes(":")) left = left.split(":", 1)[0];

  const digits = normalizeDigits(left);
  if (digits.length < 8) return "";
  if (hasDomain) return digits;
  if (digits.startsWith("55")) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

function phoneMatchVariantsForWhatsApp(...values: unknown[]) {
  const variants: string[] = [];
  for (const value of values) {
    const raw = normalizeText(value).trim().toLowerCase();
    const phone = phoneFromJidLike(value);
    const rawDigits = (
      raw.includes("@g.us") ||
      raw.includes("@lid") ||
      raw.includes("@newsletter") ||
      raw.includes("@broadcast") ||
      raw.includes("@status")
    ) ? "" : normalizeDigits(value);

    for (const candidate of [phone, rawDigits]) {
      if (!candidate || candidate.length < 8) continue;
      variants.push(candidate);
      if (candidate.startsWith("55")) variants.push(candidate.slice(2));
      if (!candidate.startsWith("55") && (candidate.length === 10 || candidate.length === 11)) {
        variants.push(`55${candidate}`);
      }
      if (candidate.startsWith("55") && candidate.length === 13) {
        variants.push(`55${candidate.slice(2, 4)}${candidate.slice(5)}`);
      }
      if (candidate.startsWith("55") && candidate.length === 12) {
        variants.push(`55${candidate.slice(2, 4)}9${candidate.slice(4)}`);
      }
    }
  }
  return unique(variants.filter((value) => value.length >= 8));
}

function firstPhoneJid(values: string[]) {
  for (const value of values) {
    const phone = phoneFromJidLike(value);
    if (phone) return `${phone}@s.whatsapp.net`;
  }
  return "";
}

function whatsappIdentityForMessage(message: any) {
  if (!message) {
    return {
      remoteJid: "",
      contactPhone: "",
      isGroup: false,
      remoteAliases: [] as string[],
      phoneVariants: [] as string[],
    };
  }

  if (message.isGroup) {
    const groupJid = normalizeJid(message.remoteJid, true);
    return {
      remoteJid: groupJid,
      contactPhone: "",
      isGroup: true,
      remoteAliases: unique([groupJid, message.remoteJid].filter(Boolean)),
      phoneVariants: [] as string[],
    };
  }

  const rawInfo = firstPresent(message.raw?.Info, message.raw?.info, {});
  const rawDeviceSentMeta = firstPresent(rawInfo?.DeviceSentMeta, rawInfo?.deviceSentMeta, {});
  const contactSideJids = message.fromMe
    ? [
        message.remoteJid,
        rawInfo?.RecipientPN,
        rawInfo?.recipientPN,
        rawInfo?.RecipientPn,
        rawInfo?.Recipient,
        rawInfo?.recipient,
        rawInfo?.RecipientAlt,
        rawInfo?.recipientAlt,
        rawInfo?.Chat,
        rawInfo?.chat,
        rawDeviceSentMeta?.DestinationJID,
        rawDeviceSentMeta?.destinationJID,
      ]
    : [
        message.remoteJid,
        message.senderJid,
        rawInfo?.SenderPN,
        rawInfo?.senderPN,
        rawInfo?.SenderPn,
        rawInfo?.Sender,
        rawInfo?.sender,
        rawInfo?.SenderAlt,
        rawInfo?.senderAlt,
        rawInfo?.Chat,
        rawInfo?.chat,
      ];
  const contactPhone = contactSideJids.map(phoneFromJidLike).find(Boolean) || "";
  const remoteJid = contactPhone ? `${contactPhone}@s.whatsapp.net` : normalizeJid(message.remoteJid, false);
  const remoteAliases = unique([
    remoteJid,
    contactPhone ? `${contactPhone}@c.us` : "",
    ...contactSideJids.map((value) => normalizeJid(value, false)),
    ...contactSideJids.map((value) => normalizeText(value)),
  ].filter(Boolean));

  return {
    remoteJid,
    contactPhone,
    isGroup: false,
    remoteAliases,
    phoneVariants: phoneMatchVariantsForWhatsApp(contactPhone, ...contactSideJids),
  };
}

function firstStableJid(values: string[], options: { allowGroup?: boolean; allowOpaque?: boolean } = {}) {
  for (const value of values) {
    if (!value) continue;
    if (!options.allowGroup && isGroupJid(value)) continue;
    if (!options.allowOpaque && isOpaqueJid(value)) continue;
    return value;
  }
  return "";
}

function resolveRemoteJid(params: {
  fromMe: boolean;
  isGroupHint: boolean;
  chatCandidates: unknown[];
  inboundCandidates: unknown[];
  outboundCandidates: unknown[];
}) {
  const chatJids = normalizeJidList(params.chatCandidates, params.isGroupHint);
  const inboundJids = normalizeJidList(params.inboundCandidates, false);
  const outboundJids = normalizeJidList(params.outboundCandidates, false);

  const groupJid = firstStableJid(
    [...chatJids, ...outboundJids, ...inboundJids].filter(isGroupJid),
    { allowGroup: true },
  );
  if (params.isGroupHint || groupJid) {
    return groupJid || firstStableJid(chatJids, { allowGroup: true });
  }

  if (params.fromMe) {
    return (
      firstPhoneJid(outboundJids) ||
      firstPhoneJid(chatJids) ||
      firstPhoneJid(inboundJids) ||
      firstStableJid(outboundJids) ||
      firstStableJid(chatJids) ||
      firstStableJid(inboundJids) ||
      firstStableJid(outboundJids, { allowOpaque: true }) ||
      firstStableJid(chatJids, { allowOpaque: true })
    );
  }

  return (
    firstPhoneJid(chatJids) ||
    firstPhoneJid(inboundJids) ||
    firstPhoneJid(outboundJids) ||
    firstStableJid(chatJids) ||
    firstStableJid(inboundJids) ||
    firstStableJid(outboundJids) ||
    firstStableJid(chatJids, { allowOpaque: true }) ||
    firstStableJid(inboundJids, { allowOpaque: true })
  );
}

function parseBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value === "string") return ["true", "1", "yes", "sim"].includes(value.trim().toLowerCase());
  return false;
}

function sessionAllowsLifecycleUpdates(session: JsonRecord) {
  if (session.is_active === false) return false;
  const status = normalizeText(session.status).trim().toLowerCase();
  if (["deleted", "disabled"].includes(status)) return false;
  const enabled = session.advanced_settings?.auto_reconnect_enabled;
  return enabled !== false && normalizeText(enabled).trim().toLowerCase() !== "false";
}

function parseProviderTimestamp(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const parsed = new Date(value < 10_000_000_000 ? value * 1000 : value);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  if (isRecord(value)) {
    const seconds = firstPresent(value.seconds, value.Seconds, value._seconds);
    if (seconds !== null && seconds !== undefined && seconds !== "") {
      return parseProviderTimestamp(Number(seconds));
    }
  }
  if (typeof value === "string" && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    return parseProviderTimestamp(Number(value.trim()));
  }
  const parsed = new Date(String(value));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function stableHash(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) - hash) + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function normalizeStatus(data: any) {
  const target = data?.data || data || {};
  const rawState = String(firstPresent(target.state, target.State, target.connectionStatus, target.status) || "").toLowerCase();
  const loggedInPresent = target.loggedIn !== undefined || target.LoggedIn !== undefined;
  const connectedPresent = target.connected !== undefined || target.Connected !== undefined;
  const loggedIn = target.loggedIn === true || target.LoggedIn === true;
  const loggedOut = target.loggedIn === false || target.LoggedIn === false;
  const connected = target.connected === true || target.Connected === true;

  if (loggedInPresent && connectedPresent) {
    if (loggedIn && connected) return "connected";
    if (!loggedIn && connected) return "qr_ready";
    return "disconnected";
  }
  if (loggedIn) return "connected";
  if (loggedOut) return "disconnected";
  if (connected) return "connected";
  if (connectedPresent) return "disconnected";
  if ((rawState === "open" || rawState === "connected") && !loggedOut) return "connected";
  if (["qr", "qrcode", "qr_ready", "pairing", "connecting"].includes(rawState) || extractQr(data)) return "qr_ready";
  if (loggedOut || ["close", "closed", "disconnected", "disconnect", "offline", "logout", "logged_out"].includes(rawState)) {
    return "disconnected";
  }
  return null;
}

function extractQr(payload: any) {
  const paths = [
    "qrcode",
    "Qrcode",
    "qrCode",
    "base64",
    "code",
    "data.qrcode",
    "data.Qrcode",
    "data.qrCode",
    "data.base64",
    "data.code",
  ];

  for (const path of paths) {
    const value = getNested(payload, path);
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return null;
}

function extractInstanceSignals(payload: any, url: URL) {
  const data = payload?.data || payload?.Data || {};
  const sessionIds = unique([
    url.searchParams.get("session_id"),
    payload.session_id,
    payload.sessionId,
    data.session_id,
    data.sessionId,
  ].map((value) => normalizeText(value).trim()).filter(Boolean));
  const instanceIds = unique([
    url.searchParams.get("instance_id"),
    payload.instance_id,
    payload.instanceId,
    payload.instanceID,
    payload.InstanceID,
    data.instance_id,
    data.instanceId,
    data.instanceID,
    data.InstanceID,
    data.instance?.id,
    data.instance?.uuid,
  ].map((value) => normalizeText(value).trim()).filter(Boolean));
  const instanceNames = unique([
    url.searchParams.get("instance_name"),
    payload.instance_name,
    payload.instanceName,
    payload.instance,
    payload.Name,
    data.instance_name,
    data.instanceName,
    data.instance,
    data.Name,
    data.name,
  ].map((value) => normalizeText(value).trim()).filter(Boolean));
  return {
    sessionIds,
    instanceIds,
    instanceNames,
  };
}

async function resolveSession(payload: any, url: URL) {
  const signals = extractInstanceSignals(payload, url);
  if (signals.sessionIds.length > 1) {
    return { session: null, reason: "CONFLICTING_SESSION_IDS", signals };
  }
  if (signals.instanceIds.length > 1 || signals.instanceNames.length > 1) {
    return { session: null, reason: "CONFLICTING_INSTANCE_SIGNALS", signals };
  }
  const suppliedSessionId = signals.sessionIds[0] || "";
  const sessionId = optionalUuid(suppliedSessionId);
  if (suppliedSessionId && !sessionId) {
    return { session: null, reason: "INVALID_SESSION_ID", signals };
  }

  if (sessionId) {
    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("provider", "evolution_go")
      .maybeSingle();

    if (error) throw error;
    if (!data) return { session: null, reason: "SESSION_NOT_FOUND", signals };
    return { session: data, reason: null, signals };
  }

  const lookups: Array<[string, string]> = [];
  for (const instanceId of signals.instanceIds) {
    lookups.push(["instance_id", instanceId], ["provider_instance_id", instanceId]);
  }
  for (const instanceName of signals.instanceNames) {
    lookups.push(["instance_name", instanceName], ["name", instanceName]);
  }
  if (lookups.length === 0) {
    return { session: null, reason: "MISSING_SESSION_SIGNAL", signals };
  }

  const matches = new Map<string, JsonRecord>();
  for (const [column, value] of lookups) {
    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("provider", "evolution_go")
      .eq(column, value)
      .limit(2);
    if (error) throw error;
    for (const candidate of data || []) matches.set(candidate.id, candidate);
  }
  if (matches.size !== 1) {
    return {
      session: null,
      reason: matches.size === 0 ? "SESSION_NOT_FOUND" : "AMBIGUOUS_SESSION",
      signals,
      matches: matches.size,
    };
  }

  return { session: [...matches.values()][0], reason: null, signals };
}

function isMessageLike(value: any) {
  if (!isRecord(value)) return false;
  return Boolean(
    value.key ||
    value.Key ||
    value.Info ||
    value.info ||
    value.message ||
    value.Message ||
    value.messageType ||
    value.type ||
    value.text ||
    value.body ||
    value.content ||
    value.message_id ||
    value.messageId ||
    value.ID,
  );
}

function wrapsEvolutionMessage(value: any) {
  if (!isRecord(value)) return false;
  const hasStructuralIdentity = (candidate: any) => [
    candidate?.Info,
    candidate?.info,
    candidate?.key,
    candidate?.Key,
  ].some((identity) => isRecord(identity) && Object.keys(identity).length > 0);
  // A scalar ID may identify the Evolution instance/envelope. Structural
  // message identity (Info/key) is the deciding signal so the envelope is not
  // normalized as a second message.
  if (hasStructuralIdentity(value)) {
    return false;
  }
  return toArray(firstPresent(value.message, value.Message)).some((nested) => (
    isRecord(nested) && hasStructuralIdentity(nested)
  ));
}

function inboundEnvelopeContactCandidates(envelope: any) {
  if (!isRecord(envelope)) return [];
  return [
    envelope.SenderPN,
    envelope.senderPN,
    envelope.SenderPn,
    envelope.senderJid,
    envelope.sender_jid,
    envelope.senderPhone,
    envelope.sender_phone,
    envelope.phone,
    envelope.number,
    envelope.sender,
  ];
}

function extractMessages(payload: any) {
  const data = payload?.data || payload?.Data;
  const dataMessage = firstPresent(data?.message, data?.Message);
  const dataMessageEnvelope = isRecord(dataMessage) ? data : null;
  const candidates = [
    { value: payload?.messages, envelope: null },
    { value: payload?.Messages, envelope: null },
    { value: payload?.message, envelope: null },
    { value: payload?.Message, envelope: null },
    // A shared data envelope is ambiguous for a batch. Every item in
    // data.messages must carry its own identity and referral.
    { value: data?.messages, envelope: null },
    { value: data?.Messages, envelope: null },
    { value: dataMessage, envelope: dataMessageEnvelope },
    { value: data, envelope: null },
    { value: payload, envelope: null },
  ];

  const messages: Array<{ rawMessage: any; envelope: JsonRecord | null }> = [];
  for (const candidate of candidates) {
    for (const item of toArray(candidate.value)) {
      if (isMessageLike(item) && !wrapsEvolutionMessage(item)) {
        messages.push({ rawMessage: item, envelope: isRecord(candidate.envelope) ? candidate.envelope : null });
      }
    }
  }

  const seen = new Set<string>();
  return messages.filter(({ rawMessage: message }) => {
    const key = JSON.stringify([
      firstPresent(message?.Info?.ID, message?.info?.id, message?.key?.id, message?.Key?.ID, message?.id, message?.messageId),
      firstPresent(message?.Info?.Chat, message?.key?.remoteJid, message?.remoteJid, message?.from, message?.to),
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getMessageNode(message: any) {
  return firstPresent(message.message, message.Message, message.data?.message, message.Data?.Message, {});
}

function firstUrl(...values: unknown[]) {
  for (const value of values) {
    const text = cleanText(value);
    if (text && /^https?:\/\//i.test(text)) return text;
  }
  return null;
}

function mediaTypeLabel(value: unknown) {
  const raw = cleanText(value)?.toLowerCase() || "";
  if (!raw) return null;
  if (raw.includes("video") || raw === "2") return "video";
  if (raw.includes("image") || raw.includes("photo") || raw === "1") return "image";
  if (raw.includes("carousel")) return "carousel";
  return raw;
}

function normalizeProviderProofText(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return { value: null, invalid: false };
  }
  if (typeof value !== "string") {
    return { value: null, invalid: true };
  }
  return { value: cleanText(value), invalid: false };
}

function normalizeProviderOptionalBoolean(value: unknown) {
  if (value === undefined || value === null) {
    return { value: null, invalid: false };
  }
  if (typeof value === "boolean") return { value, invalid: false };
  if (typeof value === "number") {
    if (value === 0 || value === 1) return { value: value === 1, invalid: false };
    return { value: null, invalid: true };
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim"].includes(normalized)) return { value: true, invalid: false };
    if (["false", "0", "no", "nao", "não"].includes(normalized)) return { value: false, invalid: false };
  }
  return { value: null, invalid: true };
}

function normalizeReferralCandidate(candidate: JsonRecord | null | undefined) {
  if (!candidate) return null;

  const sourceUrl = firstUrl(
    candidate.source_url,
    candidate.sourceUrl,
    candidate.SourceURL,
    candidate.source,
    candidate.url,
    candidate.link,
  );
  const sourceId = cleanText(firstPresent(
    candidate.source_id,
    candidate.sourceId,
    candidate.SourceID,
    candidate.ad_id,
    candidate.adId,
    candidate.AdID,
  ));
  const ctwaClidProof = normalizeProviderProofText(firstPresent(
    candidate.ctwa_clid,
    candidate.ctwaClid,
    candidate.CTWAClid,
    candidate.click_id,
    candidate.clickId,
  ));
  const ctwaClid = ctwaClidProof.value;
  const entryPointProof = normalizeProviderProofText(firstPresent(
    candidate.entry_point_conversion_source,
    candidate.entryPointConversionSource,
    candidate.EntryPointConversionSource,
  ));
  const entryPointConversionSource = entryPointProof.value;
  const entryPointConversionApp = cleanText(firstPresent(
    candidate.entry_point_conversion_app,
    candidate.entryPointConversionApp,
    candidate.EntryPointConversionApp,
  ));
  const conversionSource = cleanText(firstPresent(
    candidate.conversion_source,
    candidate.conversionSource,
    candidate.ConversionSource,
  ));
  const sourceApp = cleanText(firstPresent(
    candidate.source_app,
    candidate.sourceApp,
    candidate.SourceApp,
  ));
  const rawShowAdAttribution = firstDefined(
    candidate.show_ad_attribution,
    candidate.showAdAttribution,
    candidate.ShowAdAttribution,
  );
  const showAdAttributionProof = normalizeProviderOptionalBoolean(rawShowAdAttribution);
  const showAdAttribution = showAdAttributionProof.value;
  const headline = cleanText(firstPresent(candidate.headline, candidate.title, candidate.Title));
  const body = cleanText(firstPresent(candidate.body, candidate.description, candidate.text, candidate.Body));
  const mediaType = mediaTypeLabel(firstPresent(candidate.media_type, candidate.mediaType, candidate.MediaType));
  const thumbnailUrl = firstUrl(
    candidate.thumbnail_url,
    candidate.thumbnailUrl,
    candidate.ThumbnailURL,
    candidate.preview_url,
    candidate.jpegThumbnail,
  );
  const imageUrl = firstUrl(candidate.image_url, candidate.imageUrl, candidate.ImageURL, candidate.picture, thumbnailUrl);
  const rawVideoUrl = firstUrl(candidate.video_url, candidate.videoUrl, candidate.VideoURL, candidate.media_url, candidate.mediaUrl);
  const videoUrl = mediaType === "video" ? rawVideoUrl : firstUrl(candidate.video_url, candidate.videoUrl, candidate.VideoURL);
  const explicitSourceTypeProof = normalizeProviderProofText(firstPresent(
    candidate.explicit_source_type,
    candidate.source_type,
    candidate.sourceType,
    candidate.SourceType,
  ));
  const explicitSourceType = explicitSourceTypeProof.value;
  const sourceType = explicitSourceType || (sourceId || sourceUrl || ctwaClid ? "ad" : null);
  const proofConflict = entryPointProof.invalid
    || explicitSourceTypeProof.invalid
    || ctwaClidProof.invalid
    || (candidate.ctwa_proof_conflict !== undefined
    && candidate.ctwa_proof_conflict !== null
    && candidate.ctwa_proof_conflict !== false);
  const showAdAttributionInvalid = showAdAttributionProof.invalid
    || (candidate.ctwa_show_ad_attribution_invalid !== undefined
    && candidate.ctwa_show_ad_attribution_invalid !== null
    && candidate.ctwa_show_ad_attribution_invalid !== false);

  if (
    !sourceUrl && !sourceId && !ctwaClid && !entryPointConversionSource
    && !entryPointConversionApp && !conversionSource && !sourceApp
    && rawShowAdAttribution === undefined
    && !headline && !body && !imageUrl && !videoUrl && !thumbnailUrl
    && !explicitSourceType && !proofConflict && !showAdAttributionInvalid
  ) {
    return null;
  }

  return {
    source_url: sourceUrl,
    source_id: sourceId,
    source_type: sourceType,
    headline,
    body,
    media_type: mediaType,
    image_url: imageUrl,
    video_url: videoUrl,
    thumbnail_url: thumbnailUrl,
    ctwa_clid: ctwaClid,
    entry_point_conversion_source: entryPointConversionSource,
    entry_point_conversion_app: entryPointConversionApp,
    conversion_source: conversionSource,
    source_app: sourceApp,
    show_ad_attribution: showAdAttribution,
    explicit_source_type: explicitSourceType,
    ctwa_proof_conflict: proofConflict || null,
    ctwa_show_ad_attribution_invalid: showAdAttributionInvalid || null,
  };
}

function normalizePersistedReferralCandidate(candidate: JsonRecord | null | undefined) {
  if (!candidate) return null;
  const normalized = normalizeReferralCandidate(candidate);
  // Persisted source_type may have been inferred from a click id. Only the
  // canonical explicit_source_type field retains provider provenance on retry.
  const explicitSourceType = cleanText(candidate.explicit_source_type);
  const proofConflict = candidate.ctwa_proof_conflict !== undefined
    && candidate.ctwa_proof_conflict !== null
    && candidate.ctwa_proof_conflict !== false;
  const showAdAttributionInvalid = candidate.ctwa_show_ad_attribution_invalid !== undefined
    && candidate.ctwa_show_ad_attribution_invalid !== null
    && candidate.ctwa_show_ad_attribution_invalid !== false;
  if (!normalized && !explicitSourceType && !proofConflict && !showAdAttributionInvalid) return null;
  return {
    ...(normalized || {}),
    source_type: normalized?.source_type || explicitSourceType || null,
    explicit_source_type: explicitSourceType,
    ctwa_proof_conflict: proofConflict || normalized?.ctwa_proof_conflict || null,
    ctwa_show_ad_attribution_invalid: showAdAttributionInvalid
      || normalized?.ctwa_show_ad_attribution_invalid
      || null,
  };
}

const referralProofKeys = [
  "entry_point_conversion_source",
  "explicit_source_type",
  "ctwa_clid",
  "show_ad_attribution",
] as const;

function normalizedReferralProofValue(candidate: JsonRecord, key: typeof referralProofKeys[number]) {
  const value = candidate[key];
  if (value === undefined || value === null || value === "") return null;
  if (key === "show_ad_attribution") return value;
  const text = cleanText(value);
  if (!text) return null;
  return key === "ctwa_clid" ? text : text.toLowerCase();
}

function mergeReferralCandidates(...candidates: Array<JsonRecord | null | undefined>) {
  const merged: JsonRecord = {};
  let found = false;
  let proofConflict = false;
  for (const candidate of candidates) {
    if (!candidate) continue;
    found = true;
    if (
      candidate.ctwa_proof_conflict !== undefined
      && candidate.ctwa_proof_conflict !== null
      && candidate.ctwa_proof_conflict !== false
    ) {
      proofConflict = true;
    }
    for (const key of referralProofKeys) {
      const current = normalizedReferralProofValue(merged, key);
      const next = normalizedReferralProofValue(candidate, key);
      if (current !== null && next !== null && current !== next) {
        proofConflict = true;
      }
    }
    for (const [key, value] of Object.entries(candidate)) {
      if (merged[key] === undefined || merged[key] === null || merged[key] === "") {
        merged[key] = value;
      }
    }
  }
  if (proofConflict) merged.ctwa_proof_conflict = true;
  return found ? merged : null;
}

function extractWhatsAppReferral(messageNode: any, message: any, mediaBlock: any, currentEnvelope: any = null) {
  const normalizedCandidates: JsonRecord[] = [];
  const seenContainers = new Set<JsonRecord>();
  const appendNormalizedContainer = (candidate: unknown) => {
    if (!isRecord(candidate) || seenContainers.has(candidate)) return;
    seenContainers.add(candidate);
    const normalized = normalizeReferralCandidate(candidate);
    if (normalized) normalizedCandidates.push(normalized);
  };

  const appendExternalAdReplies = (container: unknown) => {
    if (!isRecord(container)) return;
    for (const candidate of [
      container.externalAdReply,
      container.ExternalAdReply,
      container.external_ad_reply,
      container.externalAdReplyInfo,
      container.ExternalAdReplyInfo,
      container.externalAdReplyMessage,
      container.ExternalAdReplyMessage,
    ]) {
      appendNormalizedContainer(candidate);
    }
  };

  const appendReferral = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    appendNormalizedContainer(candidate);
    appendExternalAdReplies(candidate);
  };

  const appendContextInfo = (candidate: unknown) => {
    if (!isRecord(candidate)) return;
    appendNormalizedContainer(candidate);
    appendExternalAdReplies(candidate);
    appendReferral(candidate.referral);
    appendReferral(candidate.Referral);
  };

  const appendStructuredContainers = (container: unknown) => {
    if (!isRecord(container)) return;
    appendReferral(container.referral);
    appendReferral(container.Referral);
    appendContextInfo(container.contextInfo);
    appendContextInfo(container.ContextInfo);
    appendContextInfo(container.context_info);
    appendExternalAdReplies(container);
  };

  appendStructuredContainers(message);
  appendStructuredContainers(messageNode);
  appendStructuredContainers(firstPresent(message?.Info, message?.info));

  const messageBlocks = [
    messageNode?.extendedTextMessage,
    messageNode?.ExtendedTextMessage,
    messageNode?.imageMessage,
    messageNode?.ImageMessage,
    messageNode?.videoMessage,
    messageNode?.VideoMessage,
    messageNode?.documentMessage,
    messageNode?.DocumentMessage,
    messageNode?.audioMessage,
    messageNode?.AudioMessage,
    messageNode?.stickerMessage,
    messageNode?.StickerMessage,
  ];
  for (const block of messageBlocks) {
    appendStructuredContainers(block);
  }
  appendStructuredContainers(mediaBlock);
  // The current message owns descriptive attribution. Its immediate envelope
  // may fill gaps, while proof-field conflicts are retained fail-closed.
  appendStructuredContainers(currentEnvelope);

  return mergeReferralCandidates(...normalizedCandidates);
}

function detectMediaBlock(messageNode: any, message: any) {
  const info = firstPresent(message.Info, message.info, {});
  const blocks = [
    ["image", messageNode.imageMessage || messageNode.ImageMessage],
    ["video", messageNode.videoMessage || messageNode.VideoMessage],
    ["audio", messageNode.audioMessage || messageNode.AudioMessage],
    ["document", messageNode.documentMessage || messageNode.DocumentMessage],
    ["sticker", messageNode.stickerMessage || messageNode.StickerMessage],
  ] as const;

  for (const [type, block] of blocks) {
    if (isRecord(block)) return { type, block };
  }

  const hint = String(firstPresent(
    message.messageType,
    message.type,
    message.mediaType,
    message.mediatype,
    message.kind,
    info.MediaType,
    info.mediaType,
    info.MessageType,
    info.messageType,
  ) || "").toLowerCase();
  if (["image", "video", "audio", "document", "sticker"].includes(hint)) {
    return { type: hint, block: isRecord(messageNode) ? messageNode : message };
  }

  return { type: "", block: null };
}

function evolutionProviderMediaMessage(type: string, block: JsonRecord | null) {
  const blockNames: Record<string, string> = {
    image: "imageMessage",
    video: "videoMessage",
    audio: "audioMessage",
    document: "documentMessage",
    sticker: "stickerMessage",
  };
  const blockName = blockNames[type];
  return blockName && isRecord(block) ? { [blockName]: block } : null;
}

function hasEncryptedMediaDescriptor(block: JsonRecord | null) {
  if (!isRecord(block)) return false;
  return [
    block.mediaKey,
    block.MediaKey,
    block.directPath,
    block.DirectPath,
    block.fileSha256,
    block.fileSHA256,
    block.FileSHA256,
    block.FileSha256,
    block.fileEncSha256,
    block.fileEncSHA256,
    block.FileEncSHA256,
    block.FileEncSha256,
  ].some((value) => value !== undefined && value !== null && value !== "");
}

function extractContent(messageNode: any, message: any, mediaBlock: any) {
  return firstPresent(
    typeof messageNode === "string" ? messageNode : null,
    messageNode?.conversation,
    messageNode?.Conversation,
    messageNode?.extendedTextMessage?.text,
    messageNode?.ExtendedTextMessage?.Text,
    mediaBlock?.caption,
    mediaBlock?.Caption,
    message?.text,
    message?.body,
    message?.content,
    message?.caption,
    message?.message,
    message?.Message,
  ) || null;
}

function extractDeletedMessageId(messageNode: any, message: any) {
  const protocol = firstPresent(
    messageNode?.protocolMessage,
    messageNode?.ProtocolMessage,
    message?.protocolMessage,
    message?.ProtocolMessage,
  );
  if (!isRecord(protocol)) return null;

  const targetMessageId = normalizeText(firstPresent(
    protocol.key?.id,
    protocol.key?.ID,
    protocol.Key?.id,
    protocol.Key?.ID,
    protocol.messageId,
    protocol.message_id,
  ));
  if (!targetMessageId) return null;

  const protocolType = normalizeText(firstPresent(
    protocol.type,
    protocol.Type,
    protocol.protocolType,
    protocol.protocol_type,
  )).toLowerCase();
  const revokeTypes = ["0", "revoke", "message_revoke", "message-revoke", "delete", "deleted"];
  return revokeTypes.includes(protocolType) ? targetMessageId : null;
}

function normalizeBase64(value: unknown) {
  const text = normalizeText(value).trim();
  if (!text) return null;
  if (text.startsWith("http://") || text.startsWith("https://")) return null;
  const commaIndex = text.indexOf(",");
  return commaIndex >= 0 ? text.slice(commaIndex + 1) : text;
}

function mediaExtension(mimeType: string, type: string) {
  const mime = mimeType.split(";")[0].toLowerCase();
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/ogg": "ogg",
    "audio/webm": "webm",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "application/pdf": "pdf",
  };
  return map[mime] || (type === "document" ? "bin" : type);
}

function fallbackMimeType(type: string) {
  const map: Record<string, string> = {
    image: "image/jpeg",
    video: "video/mp4",
    audio: "audio/ogg",
    document: "application/octet-stream",
    sticker: "image/webp",
  };
  return map[type] || "application/octet-stream";
}

type InboundMediaStoreResult = {
  path: string | null;
  status: "ready" | "pending";
  error: string | null;
  contentType: string | null;
  size: number | null;
};

class InboundMediaRecoveryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "InboundMediaRecoveryError";
    this.code = code;
  }
}

function providerMediaInstanceKey(session: JsonRecord) {
  return normalizeText(firstPresent(
    session.advanced_settings?.evolution_go_resolved_instance_key,
    session.instance_id,
    session.provider_instance_id,
    session.instance_name,
  )).trim();
}

function providerMediaToken(session: JsonRecord) {
  const sessionToken = normalizeText(session.advanced_settings?.token).trim();
  return sessionToken && sessionToken !== "default_token" ? sessionToken : EVOLUTION_GO_API_KEY;
}

function dataURLMimeType(value: string) {
  const match = value.trim().match(/^data:([^;,]+)(?:;[^,]*)?,/i);
  return match?.[1]?.trim().toLowerCase() || null;
}

async function readBoundedEvolutionMediaJSON(response: Response) {
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > EVOLUTION_GO_MEDIA_RESPONSE_MAX_BYTES) {
    throw new InboundMediaRecoveryError("media_too_large", "Evolution Go media response exceeds the configured limit");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > EVOLUTION_GO_MEDIA_RESPONSE_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new InboundMediaRecoveryError("media_too_large", "Evolution Go media response exceeds the configured limit");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new InboundMediaRecoveryError("media_provider_response_invalid", "Evolution Go returned invalid media JSON");
  }
}

function evolutionMediaResponseBase64(response: any) {
  return normalizeText(firstPresent(
    response?.data?.data?.base64,
    response?.data?.base64,
    response?.base64,
    response?.data?.data?.data?.base64,
  )).trim();
}

async function downloadInboundMediaViaEvolution(
  session: JsonRecord,
  providerMessage: JsonRecord,
) {
  const instanceKey = providerMediaInstanceKey(session);
  const token = providerMediaToken(session);
  if (!EVOLUTION_GO_API_URL || !instanceKey || !token) {
    throw new InboundMediaRecoveryError(
      "media_provider_config_missing",
      "Evolution Go media recovery is not configured for this session",
    );
  }

  const request = async (path: "/message/downloadmedia" | "/message/downloadimage") => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVOLUTION_GO_MEDIA_TIMEOUT_MS);
    try {
      const response = await fetch(`${EVOLUTION_GO_API_URL}${path}`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: token,
          instanceId: instanceKey,
        },
        body: JSON.stringify({ message: providerMessage }),
        signal: controller.signal,
      });
      const body = await readBoundedEvolutionMediaJSON(response);
      return { ok: response.ok, status: response.status, body };
    } catch (error) {
      if (error instanceof InboundMediaRecoveryError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new InboundMediaRecoveryError("media_provider_timeout", "Evolution Go media recovery timed out");
      }
      throw new InboundMediaRecoveryError("media_provider_unavailable", "Evolution Go media recovery request failed");
    } finally {
      clearTimeout(timeout);
    }
  };

  let response = await request("/message/downloadmedia");
  if (!response.ok && (response.status === 404 || response.status === 405)) {
    response = await request("/message/downloadimage");
  }
  if (!response.ok) {
    const code = response.status === 401 || response.status === 403
      ? "media_provider_auth_failed"
      : (response.status === 413 ? "media_too_large" : "media_provider_rejected");
    throw new InboundMediaRecoveryError(code, `Evolution Go media recovery failed with status ${response.status}`);
  }

  const encoded = evolutionMediaResponseBase64(response.body);
  if (!encoded) {
    throw new InboundMediaRecoveryError("media_provider_response_invalid", "Evolution Go media response has no base64 data");
  }
  return {
    bytes: decodeBoundedWhatsAppMediaBase64(encoded),
    contentType: dataURLMimeType(encoded),
  };
}

function inboundMediaErrorCode(error: unknown) {
  if (error instanceof WhatsAppMediaValidationError || error instanceof InboundMediaRecoveryError) return error.code;
  return "media_storage_upload_failed";
}

async function storeInboundMedia(params: {
  session: JsonRecord;
  message: NonNullable<ReturnType<typeof normalizeMessage>>;
}): Promise<InboundMediaStoreResult> {
  const { session, message } = params;
  try {
    let recovered: { bytes: Uint8Array; contentType: string | null };
    if (message.mediaBase64) {
      recovered = {
        bytes: decodeBoundedWhatsAppMediaBase64(message.mediaBase64),
        contentType: dataURLMimeType(message.mediaBase64),
      };
    } else if (message.providerMediaMessage) {
      recovered = await downloadInboundMediaViaEvolution(session, message.providerMediaMessage);
    } else {
      throw new InboundMediaRecoveryError(
        "media_descriptor_missing",
        "WhatsApp media has no provider descriptor or decrypted base64",
      );
    }

    const validated = await validateWhatsAppPlaintextMedia({
      bytes: recovered.bytes,
      messageType: message.messageType,
      declaredMimeType: message.mediaMimeType,
      providerMimeType: recovered.contentType,
      declaredSize: message.mediaSize,
      fileSha256: message.mediaFileSha256,
      fileEncSha256: message.mediaFileEncSha256,
      requirePlaintextSha256: message.hasEncryptedMediaDescriptor,
    });
    const extension = mediaExtension(validated.contentType, message.messageType);
    const path = `orgs/${session.organization_id}/sessions/${session.id}/incoming/${message.messageId}.${extension}`;
    const { error } = await supabase.storage
      .from("whatsapp-media")
      .upload(path, validated.bytes, {
        contentType: validated.contentType,
        upsert: true,
      });
    if (error) throw error;

    return {
      path,
      status: "ready",
      error: null,
      contentType: validated.contentType,
      size: validated.size,
    };
  } catch (error) {
    const code = inboundMediaErrorCode(error);
    console.warn("Inbound WhatsApp media remains pending", {
      session_id: session.id,
      message_id: message.messageId,
      media_error: code,
    });
    return {
      path: null,
      status: "pending",
      error: code,
      contentType: message.mediaMimeType || null,
      size: message.mediaSize || null,
    };
  }
}

// A completed managed lifecycle is immutable, but an exact provider retry may
// carry the media bytes needed to finish a previously persisted placeholder.
// Reconcile transport fields on that existing inbound row only; never create a
// conversation/message or rerun lead, routing, attribution or auto-reply work.
async function reconcileHandledWhatsAppMessageTransport(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!message || message.fromMe || !["image", "video", "audio", "document", "sticker"].includes(message.messageType)) {
    return;
  }

  let existing: JsonRecord | null = null;
  for (const providerIdentityColumn of ["message_id", "provider_message_id"]) {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select("id, conversation_id, lead_id, message_id, capture_state, metadata, media_url, media_mime_type, media_storage_path, media_status, media_error, media_size")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq(providerIdentityColumn, message.messageId)
      .eq("from_me", false)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) {
      existing = data;
      break;
    }
  }
  if (!existing?.id) return;
  if (persistedWhatsAppMessageCaptureState(existing) === "suppressed") {
    await redactSuppressedStoredMessage(
      session,
      existing,
      message.messageId,
    );
    return;
  }

  const existingStoragePath = normalizeText(existing.media_storage_path).trim() || null;
  if (existingStoragePath) return;
  const media = await storeInboundMedia({ session, message });

  if (media.path) {
    const mediaStoragePath = media.path;
    const { error: readyUpdateError } = await supabase
      .from("whatsapp_messages")
      .update({
        media_url: existing.media_url || message.mediaUrl || null,
        media_mime_type: media.contentType || existing.media_mime_type || message.mediaMimeType || null,
        media_storage_path: mediaStoragePath,
        media_status: "ready",
        media_error: null,
        media_size: media.size || existing.media_size || message.mediaSize || null,
      })
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", existing.id)
      .eq("from_me", false);
    if (readyUpdateError) throw readyUpdateError;
    return;
  }

  const { error: updateError } = await supabase
    .from("whatsapp_messages")
    .update({
      media_url: existing.media_url || message.mediaUrl || null,
      media_mime_type: media.contentType || existing.media_mime_type || message.mediaMimeType || null,
      media_storage_path: null,
      media_status: "pending",
      media_error: media.error,
      media_size: media.size || existing.media_size || message.mediaSize || null,
    })
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", existing.id)
    .eq("from_me", false);
  if (updateError) throw updateError;
}

function normalizeMessage(message: any, currentEnvelope: JsonRecord | null = null) {
  const info = firstPresent(message.Info, message.info, {});
  const key = firstPresent(message.key, message.Key, {});
  const messageNode = getMessageNode(message);
  const media = detectMediaBlock(messageNode, message);
  const mediaBlock = media.block || {};
  const isGroupHint = normalizeText(firstPresent(info.IsGroup, message.isGroup, message.is_group)).toLowerCase() === "true";
  const fromMe = parseBoolean(firstPresent(info.IsFromMe, info.fromMe, key.fromMe, message.fromMe, message.from_me));

  const chatCandidates = [
    key.remoteJid,
    key.RemoteJID,
    message.remoteJid,
    message.remote_jid,
    message.chat,
    message.chatId,
    message.chatJid,
    message.chat_jid,
    info.Chat,
    info.chat,
    info.JID,
    info.jid,
    message.jid,
  ];
  const hasLidInboundChat = !fromMe && normalizeJidList(chatCandidates, isGroupHint).some(isLidJid);
  const receivedFallbackJids = [
    info.SenderPN,
    info.senderPN,
    info.SenderPn,
    info.Sender,
    info.sender,
    info.SenderAlt,
    info.senderAlt,
    message.sender,
    message.senderJid,
    message.from,
    message.phone,
    message.number,
    ...(hasLidInboundChat ? inboundEnvelopeContactCandidates(currentEnvelope) : []),
  ];
  const sentFallbackJids = [
    info.RecipientPN,
    info.recipientPN,
    info.RecipientPn,
    info.Recipient,
    info.recipient,
    info.RecipientAlt,
    info.recipientAlt,
    message.recipient,
    message.recipientJid,
    message.to,
    message.phone,
    message.number,
  ];

  const remoteJid = resolveRemoteJid({
    fromMe,
    isGroupHint,
    chatCandidates,
    inboundCandidates: receivedFallbackJids,
    outboundCandidates: sentFallbackJids,
  });

  if (!remoteJid) return null;

  const isGroup = remoteJid.endsWith("@g.us") || isGroupHint;
  const groupInfo = firstPresent(
    message.groupData,
    message.GroupData,
    message.group_data,
    message.group,
    message.Group,
    message.groupInfo,
    message.GroupInfo,
    message.chatInfo,
    message.ChatInfo,
    {},
  );
  const groupName = isGroup
    ? (normalizeText(firstPresent(
        info.GroupName,
        info.groupName,
        info.GroupSubject,
        info.groupSubject,
        message.groupName,
        message.group_name,
        message.groupSubject,
        message.group_subject,
        isRecord(groupInfo) ? firstPresent(groupInfo.Name, groupInfo.name, groupInfo.Subject, groupInfo.subject, groupInfo.Topic, groupInfo.topic) : null,
      )).trim() || null)
    : null;
  const senderJid = normalizeJid(firstPresent(
    isGroup ? firstPresent(key.participant, key.Participant, message.participant) : null,
    info.SenderPN,
    info.senderPN,
    info.SenderPn,
    info.Sender,
    info.sender,
    message.sender,
    message.senderJid,
    fromMe ? null : remoteJid,
  ), false);

  const providerOccurredAt = parseProviderTimestamp(firstPresent(
    info.Timestamp,
    info.timestamp,
    message.messageTimestamp,
    message.timestamp,
    message.createdAt,
  ));
  const timestamp = providerOccurredAt || new Date().toISOString();
  // PostgreSQL text cannot contain NUL. Preserve every other byte-equivalent
  // character, including leading/trailing whitespace used by the lifecycle
  // fingerprint, while matching the native Go parser's sanitation.
  const content = normalizeText(extractContent(messageNode, message, mediaBlock)).replace(/\u0000/g, "") || null;
  const mediaType = media.type || (content ? "text" : "unknown");
  const messageType = mediaType === "unknown" ? "text" : mediaType;
  const providerMessageId = [
    info.ID,
    info.Id,
    info.id,
    key.id,
    key.ID,
    message.id,
    message.ID,
    message.messageId,
    message.message_id,
    message.provider_message_id,
  ]
    .map((value) => normalizeText(value).replace(/\u0000/g, "").trim())
    .find(Boolean) || "";
  const providerMessageIdSynthetic = !providerMessageId;
  const messageId = providerMessageId || `${remoteJid}:${timestamp}:${stableHash(JSON.stringify(message).slice(0, 500))}`;

  const mimeType = normalizeText(firstPresent(
    mediaBlock.mimetype,
    mediaBlock.Mimetype,
    mediaBlock.mimeType,
    messageNode?.mimetype,
    messageNode?.Mimetype,
    messageNode?.mimeType,
    message.mimetype,
    message.mimeType,
  )) || (messageType === "text" ? "" : fallbackMimeType(messageType));

  // URL/URL on imageMessage/audioMessage/etc. points to WhatsApp's encrypted
  // transport object. Only provider-promoted top-level media URLs are metadata;
  // media recovery itself always uses decrypted base64 or downloadmedia below.
  const promotedMediaUrl = normalizeText(firstPresent(
    messageNode?.mediaUrl,
    messageNode?.media_url,
    message.media_url,
    message.mediaUrl,
  )).trim() || null;
  const mediaUrl = promotedMediaUrl && !isEncryptedWhatsAppMediaURL(promotedMediaUrl)
    ? promotedMediaUrl
    : null;

  const base64 = normalizeBase64(firstPresent(
    message.base64,
    message.Base64,
    message.media,
    message.file,
    messageNode?.base64,
    messageNode?.Base64,
    messageNode?.media,
    messageNode?.file,
    messageNode?.data?.base64,
    messageNode?.Data?.Base64,
  ));
  const providerMediaMessage = evolutionProviderMediaMessage(messageType, isRecord(mediaBlock) ? mediaBlock : null);
  const encryptedMediaDescriptor = hasEncryptedMediaDescriptor(isRecord(mediaBlock) ? mediaBlock : null);

  const reaction = firstPresent(messageNode?.reactionMessage, messageNode?.ReactionMessage, message.reaction, null);
  const encryptedReaction = firstPresent(
    messageNode?.encReactionMessage,
    messageNode?.EncReactionMessage,
    message.encReactionMessage,
    message.EncReactionMessage,
    null,
  );
  const isReaction = isRecord(reaction) || isRecord(encryptedReaction);
  const reactionPayload = isRecord(reaction)
    ? reaction
    : (isRecord(encryptedReaction) ? encryptedReaction : null);
  const deletedMessageId = extractDeletedMessageId(messageNode, message);
  const referral = extractWhatsAppReferral(messageNode, message, mediaBlock, currentEnvelope);

  const senderName = normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.senderName, message.notifyName)) || null;
  const directContactName = isGroup
    ? null
    : (fromMe
        ? (normalizeText(firstPresent(message.contactName, message.chatName, message.name, message.contact?.name)) || null)
        : (normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.contactName, message.notifyName)) || null));

  return {
    messageId,
    providerMessageIdSynthetic,
    remoteJid,
    senderJid,
    senderName,
    contactName: directContactName,
    groupName,
    fromMe,
    isGroup,
    sentAt: timestamp,
    providerOccurredAt,
    messageType: deletedMessageId ? "deleted_event" : (isReaction ? "reaction" : messageType),
    content: deletedMessageId ? null : (isReaction ? normalizeText(firstPresent(reactionPayload?.text, reactionPayload?.emoji)) : content),
    mediaUrl,
    mediaMimeType: mimeType || null,
    mediaBase64: base64,
    mediaSize: Number(firstPresent(mediaBlock.fileLength, mediaBlock.FileLength, message.mediaSize, message.fileSize)) || null,
    mediaFileSha256: normalizeText(firstPresent(
      mediaBlock.fileSha256,
      mediaBlock.fileSHA256,
      mediaBlock.FileSHA256,
      mediaBlock.FileSha256,
    )).trim() || null,
    mediaFileEncSha256: normalizeText(firstPresent(
      mediaBlock.fileEncSha256,
      mediaBlock.fileEncSHA256,
      mediaBlock.FileEncSHA256,
      mediaBlock.FileEncSha256,
    )).trim() || null,
    providerMediaMessage,
    hasEncryptedMediaDescriptor: encryptedMediaDescriptor,
    reactionToMessageId: isReaction ? normalizeText(firstPresent(
      reactionPayload?.key?.id,
      reactionPayload?.key?.ID,
      reactionPayload?.Key?.id,
      reactionPayload?.Key?.ID,
      reactionPayload?.messageId,
      reactionPayload?.messageID,
    )) : null,
    reactionEmoji: isReaction ? normalizeText(firstPresent(reactionPayload?.text, reactionPayload?.emoji)) : null,
    deletedMessageId,
    avatarUrl: normalizeText(firstPresent(message.profilePicture, message.profilePicUrl, message.avatar, message.pictureUrl)) || null,
    referral,
    raw: message,
  };
}

function previewForMessage(message: ReturnType<typeof normalizeMessage>) {
  if (!message) return "";
  if (message.content) return message.content;
  const labels: Record<string, string> = {
    image: "Imagem",
    video: "Video",
    audio: "Audio",
    document: "Documento",
    sticker: "Figurinha",
    reaction: "Reacao",
  };
  return labels[message.messageType] || "Mensagem";
}

function detectCampaign(content: string | null) {
  if (!content) return null;
  const match = content.match(/campanha\s+([^.,;\n]+)/i) || content.match(/vim\s+(?:pela|da)\s+([^.,;\n]+)/i);
  return match?.[1]?.trim() || null;
}

function detectPropertyCode(
  message: ReturnType<typeof normalizeMessage>,
  includeMessageContent = true,
) {
  if (!message) return null;
  const referral: JsonRecord = isRecord(message.referral) ? message.referral : {};
  const text = [
    includeMessageContent ? message.content : null,
    referral.headline,
    referral.body,
    referral.source_url,
  ].filter(Boolean).join(" ");

  const url = cleanText(referral.source_url);
  if (url) {
    try {
      const parsed = new URL(url);
      for (const key of ["property_code", "codigo", "cod", "imovel", "imóvel", "ref", "utm_content"]) {
        const value = cleanText(parsed.searchParams.get(key));
        if (value) return value.slice(0, 80);
      }
    } catch {
      // ignore malformed ad URLs
    }
  }

  const match = text.match(/\b(?:cod(?:igo)?|im[oó]vel|ref)\s*[:#-]?\s*([a-z0-9][a-z0-9._/-]{1,40})\b/i);
  return match?.[1]?.trim() || null;
}

function campaignLabelForMessage(
  message: ReturnType<typeof normalizeMessage>,
  rule?: JsonRecord | null,
  includeMessageContent = true,
) {
  if (!message) return null;
  return cleanText(firstPresent(
    rule?.campaign_label,
    message.referral?.headline,
    message.referral?.body,
    includeMessageContent ? detectCampaign(message.content) : null,
  ));
}

function clickToWhatsAppAdConfirmationMethod(message: ReturnType<typeof normalizeMessage>) {
  if (!message || message.fromMe || message.isGroup) return null;
  const referral = message.referral;
  if (!referral) return null;
  return whatsappCTWAConfirmationMethod({
    fromMe: message.fromMe,
    isGroup: message.isGroup,
    providerMessageIdSynthetic: message.providerMessageIdSynthetic,
    entryPointConversionSource: referral.entry_point_conversion_source,
    explicitSourceType: referral.explicit_source_type,
    ctwaClid: referral.ctwa_clid,
    showAdAttribution: referral.show_ad_attribution,
    showAdAttributionInvalid: referral.ctwa_show_ad_attribution_invalid,
    proofConflict: referral.ctwa_proof_conflict,
  });
}

function whatsappAttribution(message: ReturnType<typeof normalizeMessage>) {
  if (!message?.referral) return null;
  const referral = message.referral;
  // Attribution is persisted on browser-visible lead/activity projections.
  // Never derive one of its fields from pre-attendance message plaintext.
  const propertyCode = detectPropertyCode(message, false);
  const confirmationMethod = clickToWhatsAppAdConfirmationMethod(message);
  const attribution = {
    source: "whatsapp",
    source_type: "whatsapp_click_to_message",
    platform: "meta",
    ad_id: referral.source_id,
    ad_name: referral.headline,
    campaign_name: referral.headline,
    creative_name: referral.headline,
    creative_type: referral.media_type,
    creative_url: referral.image_url || referral.thumbnail_url,
    creative_video_url: referral.video_url,
    creative_link_url: referral.source_url,
    creative_destination_url: referral.source_url,
    ctwa_clid: referral.ctwa_clid,
    source_id: referral.source_id,
    source_url: referral.source_url,
    source_app: referral.source_app,
    source_referral_title: referral.headline,
    source_referral_body: referral.body,
    conversion_source: referral.conversion_source,
    entry_point_conversion_source: referral.entry_point_conversion_source,
    entry_point_conversion_app: referral.entry_point_conversion_app,
    show_ad_attribution: referral.show_ad_attribution,
    ctwa_proof_conflict: referral.ctwa_proof_conflict === true ? true : null,
    ctwa_show_ad_attribution_invalid: referral.ctwa_show_ad_attribution_invalid === true ? true : null,
    ctwa_confirmation_method: confirmationMethod,
    source_referral: referral,
    property_code: propertyCode,
  };

  return Object.fromEntries(
    Object.entries(attribution).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function isConfirmedClickToWhatsAppAd(message: ReturnType<typeof normalizeMessage>) {
  return Boolean(clickToWhatsAppAdConfirmationMethod(message));
}

function whatsappAttributionUtmSource(message: ReturnType<typeof normalizeMessage>) {
  const sourceApp = cleanText(firstPresent(
    message?.referral?.source_app,
    message?.referral?.entry_point_conversion_app,
  ))?.toLowerCase();
  if (sourceApp === "instagram" || sourceApp === "facebook") return sourceApp;
  return "meta";
}

function ruleMatches(rule: JsonRecord, message: ReturnType<typeof normalizeMessage>) {
  if (!message) return false;
  const rawMatchType = normalizeText(rule.match_type || "contains").toLowerCase();
  if (rawMatchType === "all") return true;

  const field = normalizeText(rule.match_field || "message").toLowerCase();
  const value = normalizeText(firstPresent(rule.match_value, rule.conditions?.value, rule.conditions?.keyword, rule.conditions?.text)).toLowerCase();
  if (!value) return rawMatchType === "all";

  const sourceByField: Record<string, string> = {
    message: message.content || "",
    text: message.content || "",
    phone: normalizeDigits(message.remoteJid),
    name: message.contactName || "",
    contact_name: message.contactName || "",
    campaign: campaignLabelForMessage(message) || "",
    ad: message.referral?.source_id || "",
    ad_id: message.referral?.source_id || "",
    source_id: message.referral?.source_id || "",
    source_url: message.referral?.source_url || "",
    ctwa_clid: message.referral?.ctwa_clid || "",
    property_code: detectPropertyCode(message) || "",
    creative: `${message.referral?.headline || ""} ${message.referral?.body || ""}`,
    any: `${message.content || ""} ${message.contactName || ""} ${message.remoteJid} ${message.referral?.source_id || ""} ${message.referral?.source_url || ""} ${message.referral?.headline || ""} ${message.referral?.body || ""} ${message.referral?.ctwa_clid || ""} ${detectPropertyCode(message) || ""}`,
  };
  const haystack = normalizeText(sourceByField[field] ?? sourceByField.any).toLowerCase();

  if (rawMatchType === "exact") return haystack === value;
  if (rawMatchType === "starts_with") return haystack.startsWith(value);
  if (rawMatchType === "regex") {
    try {
      return new RegExp(value, "i").test(haystack);
    } catch {
      return false;
    }
  }

  return haystack.includes(value);
}

async function findInboundRule(session: JsonRecord, message: ReturnType<typeof normalizeMessage>) {
  const { data, error } = await supabase
    .from("whatsapp_inbound_rules")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("is_active", true)
    .order("priority", { ascending: false })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  const matchingRules = (data || []).filter((rule: JsonRecord) => (
    (!rule.session_id || rule.session_id === session.id) && ruleMatches(rule, message)
  ));
  if (matchingRules.length === 0) return null;

  const confirmedCtwaAd = isConfirmedClickToWhatsAppAd(message);
  let firstManualRule: JsonRecord | null = null;
  for (const rule of matchingRules) {
    const targetsSessionQueue = Boolean(optionalUuid(rule?.target_round_robin_id))
      && optionalUuid(rule?.session_id) === session.id;
    const managed = await isManagedWhatsAppMessageDistributionRule(
      rule,
      session.organization_id,
      session.id,
    );
    if (managed && confirmedCtwaAd) {
      // CTWA lead intake always uses the canonical queue mirror when one
      // matches, even if an older manual inbound rule has a higher priority.
      return { ...rule, __managed_whatsapp_message_distribution: true };
    }
    if (!targetsSessionQueue && !firstManualRule) firstManualRule = rule;
  }

  // Managed mirrors are lead-distribution rules, not generic WhatsApp rules.
  // A normal conversation may still match a manual rule, but never becomes a
  // lead merely because its text happens to match a queue keyword.
  return firstManualRule
    ? { ...firstManualRule, __managed_whatsapp_message_distribution: false }
    : null;
}

async function lookupManagedWhatsAppLeadEntry(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!message) return null;

  const { data, error } = await supabase.rpc("lookup_managed_whatsapp_lead_entry", {
    p_organization_id: session.organization_id,
    p_session_id: session.id,
    p_provider_message_id: message.messageId,
    p_message: message.content,
  });
  if (error) throw error;
  if (!isRecord(data)) {
    throw new Error("managed_whatsapp_entry_lookup_invalid_result");
  }

  if (data.quarantine === true || data.quarantined === true || data.incomplete === true) {
    const reason = normalizeText(data.reason).trim() || "managed_whatsapp_provider_event_requires_quarantine";
    throw new Error(`managed_whatsapp_entry_lookup_${reason}`);
  }

  if (data.handled === true) {
    if (data.pending === true) {
      throw new Error("managed_whatsapp_entry_lookup_handled_pending_conflict");
    }
    if (data.legacy_non_managed_retry === true) {
      return { ...data, handled: true, pending: false, legacy_non_managed_retry: true };
    }

    const leadId = optionalUuid(data.lead_id);
    const matchedRuleId = optionalUuid(data.matched_rule_id);
    const targetRoundRobinId = optionalUuid(data.target_round_robin_id);
    if (!leadId || !matchedRuleId || !targetRoundRobinId) {
      throw new Error("managed_whatsapp_entry_lookup_handled_context_invalid");
    }
    return {
      ...data,
      handled: true,
      pending: false,
      lead_id: leadId,
      matched_rule_id: matchedRuleId,
      target_round_robin_id: targetRoundRobinId,
    };
  }
  if (data.legacy_non_managed_retry === true) {
    throw new Error("managed_whatsapp_entry_lookup_legacy_retry_invalid");
  }
  if (data.pending !== true) return null;

  const leadId = optionalUuid(data.lead_id);
  const matchedRuleId = optionalUuid(data.matched_rule_id);
  const targetRoundRobinId = optionalUuid(data.target_round_robin_id);
  if (!leadId || !matchedRuleId || !targetRoundRobinId) {
    throw new Error("managed_whatsapp_entry_lookup_pending_context_invalid");
  }

  return {
    ...data,
    handled: false,
    pending: true,
    lead_id: leadId,
    matched_rule_id: matchedRuleId,
    target_round_robin_id: targetRoundRobinId,
  };
}

async function loadPendingManagedWhatsAppLead(
  session: JsonRecord,
  lookup: JsonRecord,
) {
  const leadId = optionalUuid(lookup.lead_id);
  if (!leadId) throw new Error("managed_whatsapp_entry_lookup_lead_invalid");

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error("managed_whatsapp_entry_lookup_lead_not_found");

  return {
    ...data,
    is_new_lead: true,
    is_managed_whatsapp_message_distribution: true,
  };
}

function validateNewWhatsAppLeadProviderEvent(
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!message || message.providerMessageIdSynthetic) {
    throw new Error("managed_whatsapp_distribution_requires_provider_message_id");
  }

  const providerMessageId = normalizeText(message.messageId);
  const providerMessageIdCharacters = Array.from(providerMessageId).length;
  if (providerMessageIdCharacters < 1 || providerMessageIdCharacters > 500) {
    throw new Error("managed_whatsapp_distribution_provider_message_id_invalid");
  }

  const content = normalizeText(message.content);
  if (!content.trim()) {
    throw new Error("managed_whatsapp_distribution_message_required");
  }
  if (new TextEncoder().encode(content).byteLength > 65_536) {
    throw new Error("managed_whatsapp_distribution_message_too_large");
  }
}

async function isManagedWhatsAppMessageDistributionRule(
  rule: JsonRecord | null,
  organizationId: string,
  sessionId: string,
) {
  const ruleId = optionalUuid(rule?.id);
  const targetRoundRobinId = optionalUuid(rule?.target_round_robin_id);
  const boundSessionId = optionalUuid(rule?.session_id);
  if (!ruleId || !targetRoundRobinId || !boundSessionId || boundSessionId !== sessionId) return false;

  const [{ data: persistedRule, error: ruleError }, { data: queue, error: queueError }] = await Promise.all([
    supabase
      .from("round_robin_rules")
      .select("id, match_type, match_value, match, conditions, name, is_active")
      .eq("id", ruleId)
      .eq("organization_id", organizationId)
      .eq("round_robin_id", targetRoundRobinId)
      .or("is_active.is.null,is_active.eq.true")
      .maybeSingle(),
    supabase
      .from("round_robins")
      .select("id, is_active, settings")
      .eq("id", targetRoundRobinId)
      .eq("organization_id", organizationId)
      .or("is_active.is.null,is_active.eq.true")
      .maybeSingle(),
  ]);

  if (ruleError) throw ruleError;
  if (queueError) throw queueError;
  if (!persistedRule?.id || !queue?.id || parseBoolean(queue.settings?.require_checkin)) return false;

  const conditions = isRecord(persistedRule.conditions) ? persistedRule.conditions : {};
  const directMatch = isRecord(persistedRule.match) ? persistedRule.match : {};
  const conditionMatch = isRecord(conditions.match) ? conditions.match : {};
  const inboundMatchType = normalizeText(rule?.match_type).trim().toLowerCase();
  const inboundMatchField = normalizeText(rule?.match_field ?? "message").trim().toLowerCase();
  const inboundMatchValue = normalizeText(rule?.match_value).trim();
  const persistedMatchType = persistedRule.match_type !== null
      && persistedRule.match_type !== undefined
      && persistedRule.match_type !== ""
    ? normalizeText(persistedRule.match_type)
    : conditions.match_type !== null && conditions.match_type !== undefined
    ? normalizeText(conditions.match_type)
    : normalizeText(persistedRule.name);
  const persistedSessionId = optionalUuid(firstPresent(
    cleanText(directMatch.whatsapp_session_id),
    cleanText(conditionMatch.whatsapp_session_id),
  ));
  const persistedMatchValue = persistedRule.match_value !== null
      && persistedRule.match_value !== undefined
      && persistedRule.match_value !== ""
    ? normalizeText(persistedRule.match_value)
    : normalizeText(conditions.match_value);

  return inboundMatchType === "contains"
    && inboundMatchField === "message"
    && Boolean(inboundMatchValue)
    && persistedMatchType === "whatsapp_message_contains"
    && persistedSessionId === sessionId
    && inboundMatchValue.toLowerCase() === persistedMatchValue.trim().toLowerCase();
}

async function findLeadByPhone(
  organizationId: string,
  phone: string,
  originRoundRobinId?: string | null,
) {
  const parameters: JsonRecord = {
    p_organization_id: organizationId,
    p_phone: phone,
  };
  if (originRoundRobinId !== undefined) {
	// Supplying the third argument selects the queue-scoped overload. The
	// database requires a concrete queue UUID; unscoped callers omit it and use
	// the two-argument compatibility lookup, which fails closed on ambiguity.
	if (!originRoundRobinId) throw new Error("lead_origin_round_robin_required");
    parameters.p_origin_round_robin_id = originRoundRobinId;
  }
  const { data, error } = await supabase
    .rpc("find_lead_by_normalized_phone", parameters);

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function resolveActiveSessionOwner(session: JsonRecord) {
  // The creator is not necessarily the current owner of this connection.
  // Never assign a campaign lead to a different person as a fallback. A
  // durable campaign event may be processed after the session disconnects;
  // that must not erase the active owner's assignment on a no-queue card.
  // Automatic attendance is separately proved by the database RPC.
  const ownerUserId = optionalUuid(session.owner_user_id);
  if (
    !ownerUserId
    || session.is_active === false
    || ["disabled", "deleted"].includes(normalizeText(session.status).trim().toLowerCase())
    || normalizeText(session.provider).trim().toLowerCase() !== "evolution_go"
  ) return null;

  const [{ data: user, error: userError }, { data: membership, error: membershipError }] = await Promise.all([
    supabase
      .from("users")
      .select("id")
      .eq("id", ownerUserId)
      .or("is_active.is.null,is_active.eq.true")
      .maybeSingle(),
    supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", session.organization_id)
      .eq("user_id", ownerUserId)
      .or("is_active.is.null,is_active.eq.true")
      .maybeSingle(),
  ]);
  if (userError) throw userError;
  if (membershipError) throw membershipError;
  return user?.id && membership?.user_id ? ownerUserId : null;
}

async function loadScopedWhatsAppLead(
  session: JsonRecord,
  leadId: unknown,
  missingIsNull = false,
) {
  const scopedLeadId = optionalUuid(leadId);
  if (!scopedLeadId) return null;

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("id", scopedLeadId)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) {
    if (missingIsNull) return null;
    throw new Error("whatsapp_conversation_lead_not_found_in_organization");
  }
  return data;
}

async function findEstablishedWhatsAppConversationLead(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  identity: ReturnType<typeof whatsappIdentityForMessage>,
) {
  if (!message || message.isGroup) return null;

  const aliases = mergeWhatsAppIdentityAliases(identity, [message.remoteJid, message.senderJid]);
  let conversations: JsonRecord[] = [];
  if (aliases.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, lead_id, remote_jid, contact_phone, last_message_at")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("remote_jid", aliases)
      .not("lead_id", "is", null)
      .is("deleted_at", null)
      .or("is_group.is.null,is_group.eq.false")
	  .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    conversations = data || [];
  }

  if (conversations.length === 0) {
    const phoneVariants = phoneMatchVariantsForWhatsApp(
      identity.contactPhone,
      identity.remoteJid,
      message.remoteJid,
      ...aliases,
    );
    if (phoneVariants.length > 0) {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("id, lead_id, remote_jid, contact_phone, last_message_at")
        .eq("organization_id", session.organization_id)
        .eq("session_id", session.id)
        .in("contact_phone", phoneVariants)
        .not("lead_id", "is", null)
        .is("deleted_at", null)
        .or("is_group.is.null,is_group.eq.false")
		.order("last_message_at", { ascending: false, nullsFirst: false });
      if (error) throw error;
      conversations = data || [];
    }
  }

  const leadIds = unique(conversations.map((conversation) => optionalUuid(conversation.lead_id)).filter(Boolean));
  if (leadIds.length > 1) {
    throw new Error("whatsapp_conversation_lead_ambiguous");
  }
  return leadIds.length === 1 ? loadScopedWhatsAppLead(session, leadIds[0]) : null;
}

async function resolvePropertyByCode(organizationId: string, propertyCode: string | null) {
  const code = cleanText(propertyCode);
  if (!code) return null;

  const matches = new Map<string, JsonRecord>();
  for (const column of ["code", "referencia_alternativa", "external_id", "imoview_codigo", "vista_codigo"]) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, code, title")
      .eq("organization_id", organizationId)
      .eq(column, code)
      .limit(2);

    if (error) {
      if (error.code === "42703") continue;
      throw error;
    }
    for (const property of data || []) {
      const propertyId = optionalUuid(property?.id);
      if (!propertyId) continue;
      matches.set(propertyId, property as JsonRecord);
      if (matches.size > 1) {
        console.warn("[evolution-go-webhook] ambiguous property code; leaving lead unlinked", {
          organization_id: organizationId,
          property_code: code,
        });
        return null;
      }
    }
  }

  return matches.size === 1 ? [...matches.values()][0] : null;
}

async function ensureLead(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  rule: JsonRecord | null,
  managedMessageDistribution: boolean,
  expectedCurrentLeadId?: string | null,
  providerEventLeadId?: string | null,
  ingressRoutingSnapshot?: WhatsAppIngressRoutingSnapshot | null,
) {
  if (!message || message.isGroup) return null;

  // The provider ledger is older and more authoritative than every mutable
  // phone/alias/conversation lookup. A retry must request that exact card so
  // the CAS RPC can return the original current or stale event assignment.
  if (providerEventLeadId) {
    const exactLead = await loadScopedWhatsAppLead(
      session,
      providerEventLeadId,
      Boolean(ingressRoutingSnapshot),
    );
    if (!exactLead && ingressRoutingSnapshot) {
      return quarantinedWhatsAppLeadResolution("whatsapp_ingress_snapshot_lead_deleted");
    }
    return exactLead;
  }

  // A v1 organic snapshot with no card is an immutable unlinked decision. A
  // backlog worker must not discover a card or alias that appeared only after
  // the provider callback was durably accepted.
  if (
    ingressRoutingSnapshot
    && ingressRoutingSnapshot.contextKind === "organic"
    && ingressRoutingSnapshot.state === "unlinked"
  ) {
    return null;
  }

  const identity = whatsappIdentityForMessage(message);
  const ctwaConfirmationMethod = clickToWhatsAppAdConfirmationMethod(message);
  const confirmedCtwaAd = Boolean(ctwaConfirmationMethod);
	const canonicalNonManagedIntake = confirmedCtwaAd && !managedMessageDistribution;
	if (
	  canonicalNonManagedIntake
	  && (
	    !ingressRoutingSnapshot
	    || !ingressRoutingSnapshot.contextProof?.startsWith(CANONICAL_INTAKE_PROOF_V1)
	  )
	) {
	  throw new Error("nonmanaged_whatsapp_canonical_intake_snapshot_required");
	}
  const targetRoundRobinId = managedMessageDistribution
    ? optionalUuid(rule?.target_round_robin_id)
	: canonicalNonManagedIntake
	  ? optionalUuid(ingressRoutingSnapshot?.originRoundRobinId)
	  : null;
	if (managedMessageDistribution && !targetRoundRobinId) {
	  throw new Error("managed_whatsapp_origin_round_robin_required");
	}
  let phone = identity.contactPhone || phoneFromJidLike(message.remoteJid) || phoneFromJidLike(message.senderJid);
  let existing: JsonRecord | null = null;

  if (confirmedCtwaAd) {
    // A new CTWA context is resolved by its intake scope before the existing
    // conversation binding is considered. This is what permits one phone to
    // own independent cards in different queues.
    if (!phone) {
      const aliasLookup = await findWhatsAppIdentityAlias(
        session,
        mergeWhatsAppIdentityAliases(identity, [message.remoteJid, message.senderJid]),
      );
      if (aliasLookup.quarantineReason) {
        return quarantinedWhatsAppLeadResolution(aliasLookup.quarantineReason);
      }
      const alias = aliasLookup.match;
      phone = normalizeDigits(alias?.contact_phone || phoneFromJidLike(alias?.canonical_jid));
    }
    if (!phone) return null;
    try {
	  // A canonical no-queue scope is `unscoped`, not a global phone lookup.
	  // Let the transactional upsert resolve that scope so existing cards from
	  // other queues cannot make this event ambiguous or become its target.
	  existing = canonicalNonManagedIntake && !targetRoundRobinId
	    ? null
	    : targetRoundRobinId
	      ? await findLeadByPhone(session.organization_id, phone, targetRoundRobinId)
	      : await findLeadByPhone(session.organization_id, phone);
    } catch (error) {
      if (isAmbiguousWhatsAppLeadPhone(error)) {
        console.warn("[evolution-go-webhook] ambiguous scoped WhatsApp lead phone; quarantining terminally", {
          session_id: session.id,
          organization_id: session.organization_id,
          remote_jid: identity.remoteJid || message.remoteJid,
          target_round_robin_id: targetRoundRobinId,
        });
        return quarantinedWhatsAppLeadResolution("whatsapp_lead_phone_ambiguous_in_intake_scope");
      }
      throw error;
    }
  } else {
    // Organic traffic inherits the binding snapshot captured before lead
    // resolution. Re-reading the mutable conversation here would let a newer
    // operator relink retroactively change the event's card.
    let aliasLead: JsonRecord | null = expectedCurrentLeadId
      ? await loadScopedWhatsAppLead(session, expectedCurrentLeadId)
      : null;
    if (!aliasLead) {
      try {
        aliasLead = await findEstablishedWhatsAppConversationLead(session, message, identity);
      } catch (error) {
        if (normalizeText(error instanceof Error ? error.message : error).includes("whatsapp_conversation_lead_ambiguous")) {
          console.warn("[evolution-go-webhook] ambiguous WhatsApp conversation binding; quarantining terminally", {
            session_id: session.id,
            organization_id: session.organization_id,
            remote_jid: identity.remoteJid || message.remoteJid,
          });
          return quarantinedWhatsAppLeadResolution("whatsapp_conversation_lead_ambiguous");
        }
        throw error;
      }
    }
    if (!aliasLead) {
      const aliasLookup = await findWhatsAppIdentityAlias(
        session,
        mergeWhatsAppIdentityAliases(identity, [message.remoteJid, message.senderJid]),
      );
      if (aliasLookup.quarantineReason) {
        return quarantinedWhatsAppLeadResolution(aliasLookup.quarantineReason);
      }
      const alias = aliasLookup.match;
      if (!phone) {
        phone = normalizeDigits(alias?.contact_phone || phoneFromJidLike(alias?.canonical_jid));
      }
      if (alias?.lead_id) aliasLead = await loadScopedWhatsAppLead(session, alias.lead_id);
    }
    if (!phone && !aliasLead) return null;
    existing = aliasLead;
    if (!existing) {
      try {
        // The two-argument overload is intentionally limited to an organic
        // message with no active binding. It rejects rather than choosing one
        // of several scoped cards for the same phone.
        existing = await findLeadByPhone(session.organization_id, phone);
      } catch (error) {
        if (isAmbiguousWhatsAppLeadPhone(error)) {
          console.warn("[evolution-go-webhook] ambiguous organic WhatsApp lead phone; storing conversation unlinked", {
            session_id: session.id,
            organization_id: session.organization_id,
            remote_jid: identity.remoteJid || message.remoteJid,
          });
          return quarantinedWhatsAppLeadResolution("whatsapp_lead_phone_ambiguous");
        }
        throw error;
      }
    }
  }

  if (!phone && !existing) return null;
  if (!phone) {
    const aliasLookup = await findWhatsAppIdentityAlias(
      session,
      mergeWhatsAppIdentityAliases(identity, [message.remoteJid, message.senderJid]),
    );
    if (aliasLookup.quarantineReason) {
      return quarantinedWhatsAppLeadResolution(aliasLookup.quarantineReason);
    }
    const alias = aliasLookup.match;
    phone = normalizeDigits(alias?.contact_phone || phoneFromJidLike(alias?.canonical_jid));
  }
  const now = new Date().toISOString();
  const avatarUrl = message.avatarUrl || existing?.whatsapp_avatar_url || null;
  const attribution = whatsappAttribution(message);
  const ctwaClid = cleanText(message.referral?.ctwa_clid);
  // Lead/card projections may exist before anyone enters attendance. Only
  // referral evidence, never message body text, may populate these fields.
  const propertyCode = detectPropertyCode(message, false);
  const property = await resolvePropertyByCode(session.organization_id, propertyCode);
  const campaignLabel = campaignLabelForMessage(
    message,
    managedMessageDistribution ? rule : null,
    false,
  );
  if (existing) {
    if (managedMessageDistribution) {
      if (ctwaClid && !existing.meta_click_id) {
        const { error: clickIdError } = await supabase
          .from("leads")
          .update({ meta_click_id: ctwaClid })
          .eq("organization_id", session.organization_id)
          .eq("id", existing.id)
          .is("meta_click_id", null);
        if (clickIdError) throw clickIdError;
      }
      // The transactional intake RPC owns last_contact/reentry/distribution.
      // Returning here without a lead update makes an exact provider retry a
      // true no-op while a different message id becomes a real reentry.
      return {
        ...existing,
        is_new_lead: false,
        is_managed_whatsapp_message_distribution: true,
      };
    }
    const existingMetadata = isRecord(existing.metadata) ? existing.metadata : {};
    const update: JsonRecord = {
      last_contact_at: now,
      updated_at: now,
      metadata: {
        ...existingMetadata,
        ...(attribution ? { whatsapp_attribution: attribution } : {}),
        last_whatsapp_session_id: session.id,
        last_whatsapp_remote_jid: identity.remoteJid || message.remoteJid,
      },
    };
    if (avatarUrl && !existing.whatsapp_avatar_url) {
      update.whatsapp_avatar_url = avatarUrl;
      update.whatsapp_avatar_synced_at = now;
    }
    if (propertyCode && !existing.property_code) update.property_code = propertyCode;
    if (property?.id && !existing.property_id) update.property_id = property.id;
    if (property?.id && !existing.interest_property_id) update.interest_property_id = property.id;
    if (ctwaClid && !existing.meta_click_id) update.meta_click_id = ctwaClid;
    if ((campaignLabel || attribution?.campaign_name) && !existing.source_detail) {
      update.source_detail = campaignLabel || attribution?.campaign_name;
    }
    const { error: updateError } = await supabase
      .from("leads")
      .update(update)
      .eq("organization_id", session.organization_id)
      .eq("id", existing.id);
    if (updateError) throw updateError;
    const isInitialProviderRetry = confirmedCtwaAd
      && cleanText(existing.metadata?.whatsapp_initial_provider_event_id) === `${session.id}:${message.messageId}`;
    const resolvedExistingLead = {
      ...existing,
      ...update,
      is_new_lead: isInitialProviderRetry,
      is_managed_whatsapp_message_distribution: false,
    };
	return canonicalNonManagedIntake
	  ? await processCanonicalNonManagedWhatsAppDistribution(
	    session,
	    resolvedExistingLead,
	    message,
	    targetRoundRobinId,
	  )
	  : resolvedExistingLead;
  }

  if (!confirmedCtwaAd) {
    console.debug("[evolution-go-webhook] WhatsApp conversation stored without CTWA lead auto-creation", {
      session_id: session.id,
      organization_id: session.organization_id,
      remote_jid: identity.remoteJid || message.remoteJid,
      message_id: message.messageId,
    });
    return null;
  }

  // The Go ingress already froze the canonical intake queue. Queue-scoped
  // cards stay unassigned until the canonical distributor runs; a deliberate
  // no-queue decision retains the connection-owner fallback. Legacy inbound
  // rule targets never bypass schedules, tags or redistribution.
  const targetPipelineId = null;
  const targetStageId = null;
  const targetTeamId = null;
  const ownerUserId = await resolveActiveSessionOwner(session);
  if (!ownerUserId) {
    throw new Error("ctwa_session_owner_unavailable");
  }
  const assignedUserId = managedMessageDistribution || targetRoundRobinId ? null : ownerUserId;
  const sourceLabel = "WhatsApp Meta Ads";

  const { data: upsertedLead, error } = await supabase
    .rpc("upsert_whatsapp_webhook_lead", {
      p_organization_id: session.organization_id,
      p_name: message.contactName || phone,
      p_phone: phone,
      p_whatsapp: phone,
      p_whatsapp_avatar_url: avatarUrl,
      p_whatsapp_avatar_synced_at: avatarUrl ? now : null,
      p_source_detail: campaignLabel || sourceLabel,
      p_source_session_id: session.id,
      // The database validates the managed keyword against these transient
      // values, then its late BEFORE INSERT guard removes both before storage.
      p_initial_message: message.content,
      p_message: message.content,
      p_property_code: propertyCode,
      p_property_id: property?.id || null,
      p_interest_property_id: property?.id || null,
      p_assigned_user_id: assignedUserId,
      p_assigned_at: assignedUserId ? now : null,
      p_pipeline_id: targetPipelineId,
      p_stage_id: targetStageId,
      p_created_by: ownerUserId,
      p_first_touch_at: now,
      p_first_touch_channel: "whatsapp",
      p_last_contact_at: now,
      p_origin_round_robin_id: targetRoundRobinId,
      p_metadata: {
        source: "whatsapp",
        whatsapp_lead_creation_contract: "ctwa_ad_v2",
        ctwa_confirmation_method: ctwaConfirmationMethod,
        whatsapp_session_id: session.id,
        remote_jid: identity.remoteJid || message.remoteJid,
        matched_rule_id: rule?.id || null,
        managed_whatsapp_message_distribution: managedMessageDistribution,
        managed_whatsapp_initial_provider_event_id: managedMessageDistribution
          ? `${session.id}:${message.messageId}`
          : null,
        whatsapp_initial_provider_event_id: `${session.id}:${message.messageId}`,
        target_team_id: targetTeamId,
        target_round_robin_id: targetRoundRobinId,
		...(!managedMessageDistribution
		  ? { distribution_deferred: true }
		  : {}),
        campaign_label: campaignLabel,
        ctwa_ad_confirmed: true,
        whatsapp_attribution: attribution,
        property_id: property?.id || null,
      },
    });

  let lead = Array.isArray(upsertedLead) ? upsertedLead[0] : upsertedLead;

  if (error) {
    let recovered: JsonRecord | null = null;
    let compatibilityFallback = false;
    try {
      if (isUniqueViolation(error, "leads_org_scope_phone_unique")) {
		recovered = targetRoundRobinId
		  ? await findLeadByPhone(session.organization_id, phone, targetRoundRobinId)
		  : await findLeadByPhone(session.organization_id, phone);
      } else if (isUniqueViolation(error, "leads_org_phone_unique")) {
        // Code-first rollout compatibility: while the legacy global index is
        // still present, deterministically reuse its sole card and let the
        // normal reentry path record the event. Once that index is removed,
        // the scoped upsert creates the queue-specific card instead.
        recovered = await findLeadByPhone(session.organization_id, phone);
        compatibilityFallback = Boolean(recovered?.id);
      }
    } catch (recoveryError) {
      if (isAmbiguousWhatsAppLeadPhone(recoveryError)) {
        return quarantinedWhatsAppLeadResolution("whatsapp_lead_phone_ambiguous_during_upsert_recovery");
      }
      throw recoveryError;
    }
    if (recovered?.id) {
      if (compatibilityFallback) {
        const existingMetadata = isRecord(recovered.metadata) ? recovered.metadata : {};
        const compatibility = {
          mode: "legacy_global_phone_unique",
          requested_origin_round_robin_id: targetRoundRobinId,
          provider_message_id: message.messageId,
          recorded_at: now,
        };
        const { error: compatibilityError } = await supabase
          .from("leads")
          .update({
            metadata: {
              ...existingMetadata,
              whatsapp_queue_scope_compatibility: compatibility,
            },
          })
          .eq("organization_id", session.organization_id)
          .eq("id", recovered.id);
        if (compatibilityError) throw compatibilityError;
        recovered = {
          ...recovered,
          metadata: {
            ...existingMetadata,
            whatsapp_queue_scope_compatibility: compatibility,
          },
          __lead_scope_compatibility_fallback: true,
        };
      }
      const isInitialProviderRetry = !managedMessageDistribution
        && confirmedCtwaAd
        && cleanText(recovered.metadata?.whatsapp_initial_provider_event_id) === `${session.id}:${message.messageId}`;
      const resolvedRecoveredLead = {
        ...recovered,
        is_new_lead: isInitialProviderRetry,
        is_managed_whatsapp_message_distribution: managedMessageDistribution,
      };
	  return canonicalNonManagedIntake
	    ? await processCanonicalNonManagedWhatsAppDistribution(
	      session,
	      resolvedRecoveredLead,
	      message,
	      targetRoundRobinId,
	    )
	    : resolvedRecoveredLead;
    }
    throw error;
  }

  if (!lead?.id) {
    throw new Error("Lead upsert did not return a lead");
  }

  if (ctwaClid && !lead.meta_click_id) {
    const { error: clickIdError } = await supabase
      .from("leads")
      .update({ meta_click_id: ctwaClid })
      .eq("organization_id", session.organization_id)
      .eq("id", lead.id)
      .is("meta_click_id", null);
    if (clickIdError) throw clickIdError;
    lead = { ...lead, meta_click_id: ctwaClid };
  }

  if (managedMessageDistribution && lead.is_new_lead) {
    const { data: refreshedLead, error: refreshError } = await supabase
      .from("leads")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("id", lead.id)
      .single();
    if (refreshError) throw refreshError;
    lead = { ...lead, ...refreshedLead, is_new_lead: true };
  }

	if (canonicalNonManagedIntake) {
	  lead = await processCanonicalNonManagedWhatsAppDistribution(
	    session,
	    lead,
	    message,
	    targetRoundRobinId,
	  );
	}

  return {
    ...lead,
    is_new_lead: Boolean(lead.is_new_lead),
    is_managed_whatsapp_message_distribution: managedMessageDistribution,
  };
}

async function processCanonicalNonManagedWhatsAppDistribution(
  session: JsonRecord,
  lead: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  targetRoundRobinId: string | null,
) {
  const leadId = optionalUuid(lead?.id);
  const queueId = optionalUuid(targetRoundRobinId);
  if (!leadId || !message) {
    throw new Error("nonmanaged_whatsapp_distribution_context_invalid");
  }

  const { data: persistedLead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("id", leadId)
    .single();
  if (leadError) throw leadError;

  const expectedScopeKey = queueId ? `queue:${queueId}` : "unscoped";
  const persistedScopeKey = cleanText(persistedLead?.intake_scope_key)?.toLowerCase();
  if (persistedScopeKey !== expectedScopeKey) {
    // While A1/A2 retain the legacy global-phone index, a queue-B event can be
    // forced onto a pre-existing queue-A card. Record the compatibility event,
    // clear the trigger fence, and never redistribute or relabel that card.
    const persistedMetadata = isRecord(persistedLead?.metadata) ? persistedLead.metadata : {};
    const metadataWithoutFence = { ...persistedMetadata };
    delete metadataWithoutFence.distribution_deferred;
    const compatibility = {
      mode: "legacy_global_phone_unique",
      requested_origin_round_robin_id: queueId,
      provider_message_id: message.messageId,
      recorded_at: new Date().toISOString(),
    };
    const { data: compatibleLead, error: compatibilityError } = await supabase
      .from("leads")
      .update({
        metadata: {
          ...metadataWithoutFence,
          whatsapp_queue_scope_compatibility: compatibility,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", session.organization_id)
      .eq("id", leadId)
      .select("*")
      .single();
    if (compatibilityError) throw compatibilityError;
    return {
      ...lead,
      ...compatibleLead,
      __lead_scope_compatibility_fallback: true,
    };
  }

  if (!queueId) {
    const persistedMetadata = isRecord(persistedLead?.metadata) ? persistedLead.metadata : {};
    const metadataWithoutFence = { ...persistedMetadata };
    delete metadataWithoutFence.distribution_deferred;
    if (!("distribution_deferred" in persistedMetadata)) {
      return {
        ...lead,
        ...persistedLead,
        is_new_lead: Boolean(lead.is_new_lead),
        is_managed_whatsapp_message_distribution: false,
      };
    }
    const { data: finalizedLead, error: finalizeError } = await supabase
      .from("leads")
      .update({ metadata: metadataWithoutFence })
      .eq("organization_id", session.organization_id)
      .eq("id", leadId)
      .select("*")
      .single();
    if (finalizeError) throw finalizeError;
    return {
      ...lead,
      ...finalizedLead,
      is_new_lead: Boolean(lead.is_new_lead),
      is_managed_whatsapp_message_distribution: false,
    };
  }

  const { data: queue, error: queueError } = await supabase
    .from("round_robins")
    .select("id, is_active, reentry_behavior, rules")
    .eq("organization_id", session.organization_id)
    .eq("id", queueId)
    .maybeSingle();
  if (queueError) throw queueError;
  if (!queue?.id) {
    throw new Error("nonmanaged_whatsapp_frozen_queue_unavailable");
  }

  const queueRules = isRecord(queue.rules) ? queue.rules : {};
  const reentryBehavior = cleanText(queue.reentry_behavior || queueRules.reentry_behavior)?.toLowerCase() === "keep_assignee"
    ? "keep_assignee"
    : "redistribute";
  const reentry = !Boolean(lead.is_new_lead);
  const preserveAssignee = !reentry || reentryBehavior !== "redistribute";
  // Go's encoding/json escapes these five characters before hashing. Provider
  // ids normally do not contain them, but matching it here keeps retries
  // idempotent even for an unusual yet valid provider identifier.
  const stableKeyPayload = JSON.stringify([normalizeText(session.id), message.messageId])
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const idempotencyKey = `whatsapp-native:${await sha256Hex(stableKeyPayload)}`;
  const { data: distributionResult, error: distributionError } = await supabase
    .rpc("distribute_lead_from_backend", {
      p_organization_id: session.organization_id,
      p_lead_id: leadId,
      p_idempotency_key: idempotencyKey,
      p_round_robin_id: queueId,
      p_preserve_assignee: preserveAssignee,
      p_source: "whatsapp",
      p_now: message.sentAt,
    });
  if (distributionError) throw distributionError;
  const reason = cleanText(distributionResult?.reason);
  if (!reason || !["assigned", "already_assigned", "no_matching_queue", "no_available_members"].includes(reason)) {
    throw new Error(`nonmanaged_whatsapp_distribution_rejected:${reason || "invalid_result"}`);
  }

  const { data: refreshedLead, error: refreshError } = await supabase
    .from("leads")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("id", leadId)
    .single();
  if (refreshError) throw refreshError;
  return {
    ...lead,
    ...refreshedLead,
    is_new_lead: Boolean(lead.is_new_lead),
    is_managed_whatsapp_message_distribution: false,
  };
}

async function processManagedWhatsAppLeadEntry(
  session: JsonRecord,
  lead: JsonRecord | null,
  rule: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
  suppressLeadMessage: boolean,
) {
  if (!lead?.id || !message || !rule?.id) return null;

  const { data, error } = await supabase.rpc("process_managed_whatsapp_lead_entry_attendance", {
    p_organization_id: session.organization_id,
    p_lead_id: lead.id,
    p_session_id: session.id,
    p_rule_id: rule.id,
    p_provider_message_id: message.messageId,
    p_message: message.content,
    p_occurred_at: message.sentAt,
    p_suppress_lead_message: suppressLeadMessage,
  });
  if (error) throw error;
  if (!data?.handled) {
    throw new Error(`Managed WhatsApp intake was not handled: ${normalizeText(data?.reason || "unknown")}`);
  }
  return data;
}

async function upsertLeadMetaAttribution(
  session: JsonRecord,
  conversation: JsonRecord,
  lead: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!lead?.id || !message) return;
  const attribution = whatsappAttribution(message);
  if (!attribution) return;
  const utmSource = whatsappAttributionUtmSource(message);
  const instagramUrl = utmSource === "instagram" ? (attribution.source_url || null) : null;

  const payload = {
    ...attribution,
    channel: "whatsapp",
    source: "whatsapp",
    source_type: "whatsapp_click_to_message",
    message_id: message.messageId,
    remote_jid: conversation.remote_jid || message.remoteJid,
    whatsapp_session_id: session.id,
    received_at: message.sentAt,
    property_id: lead.property_id || lead.interest_property_id || null,
  };

  const { data: existing, error: existingError } = await supabase
    .from("lead_meta")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("lead_id", lead.id)
    .maybeSingle();
  if (existingError) throw existingError;

  if (existing?.id) {
    const { error } = await supabase
      .from("lead_meta")
      .update({
        platform: "meta",
        source_type: "whatsapp_click_to_message",
        ad_id: attribution.ad_id,
        ad_name: attribution.ad_name,
        campaign_name: attribution.campaign_name,
        creative_url: attribution.creative_url,
        creative_video_url: attribution.creative_video_url,
        creative_instagram_url: instagramUrl,
        utm_source: utmSource,
        utm_medium: "click_to_whatsapp",
        utm_campaign: attribution.campaign_name || null,
        payload,
        raw_payload: payload,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", session.organization_id)
      .eq("id", existing.id)
      .or("source_type.is.null,source_type.eq.whatsapp_click_to_message,platform.eq.whatsapp");
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("lead_meta").insert({
    organization_id: session.organization_id,
    lead_id: lead.id,
    platform: "meta",
    source_type: "whatsapp_click_to_message",
    ad_id: attribution.ad_id || null,
    ad_name: attribution.ad_name || null,
    campaign_name: attribution.campaign_name || null,
    creative_url: attribution.creative_url || null,
    creative_video_url: attribution.creative_video_url || null,
    creative_instagram_url: instagramUrl,
    utm_source: utmSource,
    utm_medium: "click_to_whatsapp",
    utm_campaign: attribution.campaign_name || null,
    payload,
    raw_payload: payload,
  });
  if (error) throw error;
}

async function logLeadEntryAttribution(
  session: JsonRecord,
  conversation: JsonRecord,
  lead: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!lead?.id || !message || message.fromMe || message.isGroup) return;
  const attribution = whatsappAttribution(message);
  if (!attribution) return;
  const providerEventId = `${session.id}:${message.messageId}`;
  const nonManagedProviderEventId = `nonmanaged:${providerEventId}`;
  const utmSource = whatsappAttributionUtmSource(message);

  const metadata = {
    ...attribution,
    source: "whatsapp",
    source_type: "whatsapp_click_to_message",
    channel: "whatsapp",
    message_id: message.messageId,
    conversation_id: conversation.id,
    whatsapp_session_id: session.id,
    provider_event_id: providerEventId,
    remote_jid: conversation.remote_jid || message.remoteJid,
    property_id: lead.property_id || lead.interest_property_id || null,
  };
  const entryAttribution = {
    source: "whatsapp",
    provider: "whatsapp",
    provider_event_id: nonManagedProviderEventId,
    occurred_at: message.sentAt,
    is_countable: true,
    source_detail: "whatsapp_click_to_message",
    property_id: lead.property_id || lead.interest_property_id || null,
    campaign_name: attribution.campaign_name || attribution.ad_name || null,
    ad_id: attribution.source_id || attribution.ad_id || null,
    ad_name: attribution.ad_name || null,
    utm_source: utmSource,
    utm_medium: "click_to_whatsapp",
    utm_campaign: attribution.campaign_name || null,
    metadata,
    payload: metadata,
  };

  const updateEntryAttribution = async (entry: JsonRecord) => {
    const existingMetadata = isRecord(entry.metadata) ? entry.metadata : {};
    const existingPayload = isRecord(entry.payload) ? entry.payload : {};
    const { error } = await supabase
      .from("lead_entry_events")
      .update({
        ...entryAttribution,
        metadata: { ...existingMetadata, ...metadata },
        payload: { ...existingPayload, ...metadata },
      })
      .eq("organization_id", session.organization_id)
      .eq("lead_id", lead.id)
      .eq("id", entry.id);
    return error;
  };

  const loadProviderEntry = async () => {
    const { data, error } = await supabase
      .from("lead_entry_events")
      .select("id, lead_id, metadata, payload")
      .eq("organization_id", session.organization_id)
      .eq("provider", "whatsapp")
      .eq("provider_event_id", nonManagedProviderEventId)
      .eq("is_countable", true)
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    if (data?.id && data.lead_id !== lead.id) {
      throw new Error("nonmanaged_whatsapp_provider_event_lead_collision");
    }
    return data;
  };

  const recoverProviderEntry = async (uniqueError: unknown) => {
    const recovered = await loadProviderEntry();
    if (!recovered?.id) throw uniqueError;
    const recoveryError = await updateEntryAttribution(recovered);
    if (recoveryError) throw recoveryError;
  };

  const updateOrRecoverProviderEntry = async (entry: JsonRecord) => {
    const updateError = await updateEntryAttribution(entry);
    if (!updateError) return;
    if (!isUniqueViolation(updateError)) throw updateError;
    await recoverProviderEntry(updateError);
  };

  const existingProviderEntry = await loadProviderEntry();
  if (existingProviderEntry?.id) {
    await updateOrRecoverProviderEntry(existingProviderEntry);
    return;
  }

  // Backfill an event written by a release that kept the provider identifier
  // only in metadata. The column namespace becomes the concurrency guard.
  const { data: legacyEntry, error: legacyError } = await supabase
    .from("lead_entry_events")
    .select("id, lead_id, metadata, payload")
    .eq("organization_id", session.organization_id)
    .eq("lead_id", lead.id)
    .eq("source", "whatsapp")
    .eq("metadata->>provider_event_id", providerEventId)
    .limit(1)
    .maybeSingle();
  if (legacyError) throw legacyError;
  if (legacyEntry?.id) {
    await updateOrRecoverProviderEntry(legacyEntry);
    return;
  }

  const initialProviderEventId = cleanText(lead.metadata?.whatsapp_initial_provider_event_id);
  if (lead.is_new_lead || initialProviderEventId === providerEventId) {
    const { data: initialEntry, error: initialError } = await supabase
      .from("lead_entry_events")
      .select("id, metadata, payload")
      .eq("organization_id", session.organization_id)
      .eq("lead_id", lead.id)
      .eq("entry_type", "initial")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (initialError) throw initialError;
    if (initialEntry?.id) {
      await updateOrRecoverProviderEntry(initialEntry);
      return;
    }
  }

  const { error } = await supabase.from("lead_entry_events").insert({
    organization_id: session.organization_id,
    lead_id: lead.id,
    entry_type: lead.is_new_lead ? "initial" : "reentry",
    ...entryAttribution,
  });
  if (!error) return;
  if (!isUniqueViolation(error)) throw error;
  await recoverProviderEntry(error);
}

async function enrichManagedWhatsAppLeadEntryAttribution(
  session: JsonRecord,
  leadId: string | null | undefined,
  message: ReturnType<typeof normalizeMessage>,
  options: { allowMissing?: boolean } = {},
) {
  if (!leadId || !message) return false;
  if (!isConfirmedClickToWhatsAppAd(message)) return false;
  const { data, error } = await supabase.rpc("enrich_whatsapp_lead_entry_attribution", {
    p_organization_id: session.organization_id,
    p_lead_id: leadId,
    p_session_id: session.id,
    p_provider_message_id: message.messageId,
  });
  if (error) throw error;
  if (data === true) return true;
  if (options.allowMissing) return false;
  throw new Error("managed_whatsapp_entry_attribution_not_found");
}

async function logCreativeActivity(
  session: JsonRecord,
  conversation: JsonRecord,
  lead: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!lead?.id || !message || message.fromMe || message.isGroup) return;
  const attribution = whatsappAttribution(message);
  if (!attribution) return;

  const metadata = {
    ...attribution,
    source: "whatsapp",
    source_type: "whatsapp_click_to_message",
    channel: "whatsapp",
    message_id: message.messageId,
    conversation_id: conversation.id,
    whatsapp_session_id: session.id,
    remote_jid: conversation.remote_jid || message.remoteJid,
    property_id: lead.property_id || lead.interest_property_id || null,
  };

  const activityId = await deterministicEvolutionGoEffectId(
    session.organization_id,
    session.id,
    message.messageId,
    "meta_creative_activity",
  );
  const { error } = await supabase.from("activities").insert({
    id: activityId,
    organization_id: session.organization_id,
    lead_id: lead.id,
    user_id: null,
    type: "meta_creative",
    content: attribution.creative_name || attribution.ad_name || "Criativo do anuncio",
    metadata,
  });
  if (error && !isUniqueViolation(error, "activities_pkey")) throw error;
}

async function reconcileRecoveredConversationAfterMessage(
  session: JsonRecord,
  conversation: JsonRecord,
  expectedLeadId: string,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!message || message.messageType === "reaction") return;
  const currentLastMessageAt = cleanText(conversation.last_message_at);
  const currentTimestamp = currentLastMessageAt ? Date.parse(currentLastMessageAt) : Number.NaN;
  const messageTimestamp = Date.parse(message.sentAt);
  if (
    currentLastMessageAt
    && Number.isFinite(currentTimestamp)
    && Number.isFinite(messageTimestamp)
    && currentTimestamp >= messageTimestamp
  ) {
    return;
  }

  let update = supabase
    .from("whatsapp_conversations")
    .update({
      last_message: previewForMessage(message),
      last_message_preview: previewForMessage(message),
      last_message_at: message.sentAt,
      unread_count: message.fromMe
        ? Number(conversation.unread_count || 0)
        : Number(conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", conversation.id)
    .eq("lead_id", expectedLeadId);
  update = currentLastMessageAt
    ? update.eq("last_message_at", currentLastMessageAt)
    : update.is("last_message_at", null);
  const { error } = await update;
  if (error) throw error;
}

async function recoverPersistedNonManagedWhatsAppMessage(
  session: JsonRecord,
  lookup: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!message) return;

  let { data: storedMessage, error: messageError } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, lead_id, provider_message_id, message_id, capture_state, content, sent_at, received_at, created_at, remote_jid, sender_jid, sender_name, from_me, direction, message_type, metadata")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("message_id", message.messageId)
    .maybeSingle();
  if (messageError) throw messageError;
  if (!storedMessage) {
    ({ data: storedMessage, error: messageError } = await supabase
      .from("whatsapp_messages")
      .select("id, conversation_id, lead_id, provider_message_id, message_id, capture_state, content, sent_at, received_at, created_at, remote_jid, sender_jid, sender_name, from_me, direction, message_type, metadata")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("provider_message_id", message.messageId)
      .maybeSingle());
    if (messageError) throw messageError;
  }
  if (!storedMessage?.conversation_id) return;
  if (persistedWhatsAppMessageCaptureState(storedMessage) === "suppressed") {
    await redactSuppressedStoredMessage(
      session,
      storedMessage,
      message.messageId,
    );
    return;
  }

  const { data: conversation, error: conversationError } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", storedMessage.conversation_id)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation?.id) return;

  const persistedProviderMessageId = cleanText(firstPresent(
    storedMessage.provider_message_id,
    storedMessage.message_id,
  ));
  const persistedSentAt = cleanText(firstPresent(
    storedMessage.sent_at,
    storedMessage.received_at,
    storedMessage.created_at,
  ));
  if (
    !persistedProviderMessageId
    || persistedProviderMessageId !== message.messageId
    || !persistedSentAt
    || storedMessage.from_me === true
    || normalizeText(storedMessage.direction).toLowerCase() === "outbound"
  ) {
    throw new Error("legacy_whatsapp_retry_persisted_message_invalid");
  }

  const storedMetadata = isRecord(storedMessage.metadata) ? storedMessage.metadata : {};
  const storedAttribution = isRecord(storedMetadata.whatsapp_attribution)
    ? storedMetadata.whatsapp_attribution
    : {};
  const storedSourceReferral = isRecord(storedAttribution.source_referral)
    ? storedAttribution.source_referral
    : null;
  const storedReferral = isRecord(storedMetadata.whatsapp_referral)
    ? storedMetadata.whatsapp_referral
    : null;
  const attributionReferral = normalizeReferralCandidate({
    source_id: firstPresent(storedAttribution.source_id, storedAttribution.ad_id),
    source_url: firstPresent(
      storedAttribution.source_url,
      storedAttribution.creative_link_url,
      storedAttribution.creative_destination_url,
    ),
    // Only the provider's raw source type may authorize the CTWA v2 fallback.
    // source_type can be inferred from ctwa_clid during normalization.
    source_type: storedSourceReferral?.explicit_source_type,
    headline: firstPresent(
      storedAttribution.source_referral_title,
      storedAttribution.campaign_name,
      storedAttribution.ad_name,
      storedAttribution.creative_name,
    ),
    ctwa_clid: storedAttribution.ctwa_clid,
    entry_point_conversion_source: storedAttribution.entry_point_conversion_source,
    entry_point_conversion_app: storedAttribution.entry_point_conversion_app,
    conversion_source: storedAttribution.conversion_source,
    source_app: storedAttribution.source_app,
    show_ad_attribution: storedAttribution.show_ad_attribution,
    ctwa_proof_conflict: storedAttribution.ctwa_proof_conflict,
    ctwa_show_ad_attribution_invalid: storedAttribution.ctwa_show_ad_attribution_invalid,
  });
  const persistedReferral = mergeReferralCandidates(
    normalizePersistedReferralCandidate(storedReferral),
    normalizePersistedReferralCandidate(storedSourceReferral),
    attributionReferral,
  );
  const persistedMessage = {
    ...message,
    messageId: persistedProviderMessageId,
    content: normalizeText(storedMessage.content),
    sentAt: persistedSentAt,
    remoteJid: cleanText(storedMessage.remote_jid) || cleanText(conversation.remote_jid) || "",
    senderJid: cleanText(storedMessage.sender_jid),
    senderName: cleanText(storedMessage.sender_name),
    fromMe: false,
    isGroup: false,
    messageType: cleanText(storedMessage.message_type) || "text",
    referral: persistedReferral,
    raw: {},
  };

  const lookupLeadId = optionalUuid(lookup.lead_id);
	const storedLeadId = optionalUuid(storedMessage.lead_id);
  if (lookupLeadId && storedLeadId && lookupLeadId !== storedLeadId) {
    throw new Error("legacy_whatsapp_retry_lead_collision");
  }
	if (lookupLeadId && !storedLeadId) {
	  throw new Error("legacy_whatsapp_retry_immutable_lead_missing");
	}
	if (!storedLeadId) {
	  // A quarantined/unbound inbound message has no business effects to
	  // recover. Its replay is a handled no-op as long as the managed lookup
	  // also remains leadless; a lookup that asserts a lead fails above.
	  return;
	}
	const leadId = storedLeadId;
  let lead: JsonRecord | null = null;
  if (leadId) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("id", leadId)
      .maybeSingle();
    if (error) throw error;
    lead = data || null;
  }

  // The original non-managed attempt may have persisted the message before its
  // audit log. Recreate only that transport audit; never re-evaluate current
  // mutable routing rules for an already consumed provider delivery.
  await logInbound(session, conversation, lead, null, persistedMessage);
	if (optionalUuid(conversation.lead_id) === leadId) {
	  await reconcileRecoveredConversationAfterMessage(session, conversation, leadId, persistedMessage);
	}

  if (!lead?.id || !isConfirmedClickToWhatsAppAd(persistedMessage)) return;
  const providerEventId = `${session.id}:${persistedMessage.messageId}`;
  const recoveredLead = {
    ...lead,
    is_new_lead: cleanText(lead.metadata?.whatsapp_initial_provider_event_id) === providerEventId,
  };
  await upsertLeadMetaAttribution(session, conversation, recoveredLead, persistedMessage);
  await logLeadEntryAttribution(session, conversation, recoveredLead, persistedMessage);
  await logCreativeActivity(session, conversation, recoveredLead, persistedMessage);
}

async function resolveGroupName(session: JsonRecord, remoteJid: string, incomingName?: string | null) {
  if (incomingName?.trim()) return incomingName.trim();

  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("name, subject")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (error) {
    console.warn("[evolution-go-webhook] group name lookup failed", error.message);
    return null;
  }

  return cleanText(data?.name) || cleanText(data?.subject) || null;
}

function isUsableCanonicalJid(value: unknown) {
  const normalized = normalizeJid(value, false);
  if (!normalized) return false;
  if (isGroupJid(normalized)) return true;
  if (isOpaqueJid(normalized)) return false;
  return Boolean(phoneFromJidLike(normalized));
}

function mergeWhatsAppIdentityAliases(identity: ReturnType<typeof whatsappIdentityForMessage>, extraAliases: unknown[] = []) {
  return unique([
    identity.remoteJid,
    ...identity.remoteAliases,
    identity.contactPhone ? `${identity.contactPhone}@s.whatsapp.net` : "",
    identity.contactPhone ? `${identity.contactPhone}@c.us` : "",
    ...extraAliases.map((alias) => normalizeJid(alias, identity.isGroup)),
    ...extraAliases.map((alias) => normalizeText(alias)),
  ].filter(Boolean));
}

type WhatsAppIdentityAliasLookup = {
  match: JsonRecord | null;
  quarantineReason: string | null;
};

function resolveWhatsAppIdentityAliasRows(
  rows: JsonRecord[],
  normalizedAliases: string[],
): WhatsAppIdentityAliasLookup {
  if (rows.length === 0) return { match: null, quarantineReason: null };

  const leadIds = unique(rows.map((row) => optionalUuid(row.lead_id)).filter(Boolean));
  const canonicalJids = unique(rows
    .map((row) => normalizeJid(row.canonical_jid, false))
    .filter(Boolean));
  const contactPhones = unique(rows
    .map((row) => normalizeDigits(row.contact_phone))
    .filter(Boolean));
  if (leadIds.length > 1 || canonicalJids.length > 1 || contactPhones.length > 1) {
    return {
      match: null,
      quarantineReason: "whatsapp_identity_alias_ambiguous",
    };
  }

  // Prefer the provider's alias order, not mutable last_seen_at. Compatible
  // rows are collapsed so a safe lead/phone present on a sibling alias is not
  // lost merely because the first row has a legacy NULL field.
  const match = normalizedAliases
    .map((alias) => rows.find((row) => normalizeJid(row.alias_jid, false) === alias))
    .find(Boolean) || rows[0];
  if (!match) return { match: null, quarantineReason: null };
  return {
    match: {
      ...match,
      canonical_jid: canonicalJids[0] || match.canonical_jid || null,
      contact_phone: contactPhones[0] || null,
      lead_id: leadIds[0] || null,
    },
    quarantineReason: null,
  };
}

async function findWhatsAppIdentityAlias(
  session: JsonRecord,
  aliases: string[],
): Promise<WhatsAppIdentityAliasLookup> {
  const normalizedAliases = unique(aliases.map((alias) => normalizeJid(alias, false)).filter(Boolean));
  if (normalizedAliases.length === 0) return { match: null, quarantineReason: null };

  const { data, error } = await supabase
    .from("whatsapp_contact_identity_aliases")
    .select("alias_jid, canonical_jid, contact_phone, lead_id, metadata")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .in("alias_jid", normalizedAliases)
    .limit(normalizedAliases.length);

  if (error) {
    if (["42P01", "42703"].includes(error.code)) {
      return { match: null, quarantineReason: null };
    }
    throw error;
  }

  return resolveWhatsAppIdentityAliasRows(data || [], normalizedAliases);
}

async function upsertWhatsAppIdentityAliases(
  session: JsonRecord,
  identity: ReturnType<typeof whatsappIdentityForMessage>,
  conversation: JsonRecord,
  extraAliases: unknown[] = [],
) {
  const preferredCanonical = isUsableCanonicalJid(identity.remoteJid)
    ? identity.remoteJid
    : (conversation.remote_jid || identity.remoteJid);
  const canonicalJid = normalizeJid(preferredCanonical, identity.isGroup);
  if (!canonicalJid || !isUsableCanonicalJid(canonicalJid)) return;

  const contactPhone = identity.isGroup
    ? null
    : (identity.contactPhone || conversation.contact_phone || phoneFromJidLike(canonicalJid) || null);
  const aliases = mergeWhatsAppIdentityAliases(identity, [
    canonicalJid,
    conversation.remote_jid,
    conversation.contact_phone ? `${conversation.contact_phone}@s.whatsapp.net` : "",
    conversation.contact_phone ? `${conversation.contact_phone}@c.us` : "",
    ...extraAliases,
  ]);
  const now = new Date().toISOString();
  const rowsByAlias = new Map<string, JsonRecord>();
  for (const alias of aliases) {
    const aliasJid = normalizeJid(alias, identity.isGroup);
    if (!aliasJid) continue;
    rowsByAlias.set(aliasJid, {
      organization_id: session.organization_id,
      session_id: session.id,
      alias_jid: aliasJid,
      canonical_jid: canonicalJid,
      contact_phone: contactPhone,
      is_group: identity.isGroup,
      last_seen_at: now,
      metadata: {
        source: "evolution_go_webhook",
        conversation_id: conversation.id,
      },
    });
  }

  const rows = Array.from(rowsByAlias.values());

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("whatsapp_contact_identity_aliases")
    .upsert(rows, { onConflict: "organization_id,session_id,alias_jid" });

  if (error) {
    if (["42P01", "42703"].includes(error.code)) return;
    throw error;
  }
}

async function safelyUpsertWhatsAppIdentityAliases(
  session: JsonRecord,
  identity: ReturnType<typeof whatsappIdentityForMessage>,
  conversation: JsonRecord,
  extraAliases: unknown[] = [],
) {
  try {
    // Generic identity discovery must never rewrite card ownership. The
    // row-locked conversation binding RPC is the sole writer of alias.lead_id;
    // otherwise a delayed provider event can overwrite a newer binding.
    await upsertWhatsAppIdentityAliases(session, identity, conversation, extraAliases);
  } catch (error) {
    console.warn("[evolution-go-webhook] identity alias update failed; message processing will continue", {
      session_id: session.id,
      conversation_id: conversation.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

type WhatsAppConversationBindingSnapshot = {
  conversationId: string | null;
  currentLeadId: string | null;
  activeBindingId: string | null;
  leadResolutionQuarantineReason: string | null;
};

type WhatsAppIngressRoutingSnapshot = WhatsAppConversationBindingSnapshot & {
  state: "bound" | "lead_match" | "unlinked" | "quarantine" | "contextual_intake" | "provider_replay" | "predecessor_inherit";
  eventLeadId: string | null;
  providerMessageId: string;
  inboxEventKey: string;
  processingLane: "live" | "backlog";
  contextKind: "organic" | "contextual_intake";
  contextProof: string | null;
  ruleId: string | null;
  originRoundRobinId: string | null;
  managedMessageDistribution: boolean;
  managedEventPending: boolean;
  managedEventHandled: boolean;
  routingKey: string;
  bindingEligible: boolean;
  targetMode: "snapshot" | "inherit_predecessor";
  ingressSequence: number;
  predecessorProviderMessageId: string | null;
  predecessorInboxEventKey: string | null;
  predecessorProcessingLane: "live" | "backlog" | null;
};

function ingressRoutingSnapshotForMessage(
  payload: unknown,
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  authorization: AuthorizedEvolutionGoWebhook,
): WhatsAppIngressRoutingSnapshot | null {
  if (!message) throw new Error("whatsapp_ingress_snapshot_message_required");
  if (authorization.contract !== "internal_worker_lease") {
    // Direct provider callbacks cannot atomically freeze DB routing before an
    // ACK and must retry through the durable Go ingress. In particular they
    // may never assert a provider-controlled __vimob_ingress object.
    throw new Error("whatsapp_durable_ingress_required");
  }
  const root = isRecord(payload) ? payload : {};
  const ingress = isRecord(root.__vimob_ingress) ? root.__vimob_ingress : {};
  const envelope = isRecord(ingress.routing_snapshot) ? ingress.routing_snapshot : null;
  if (!envelope) {
    // A1-to-B1 compatibility only. B1 proves every active legacy inbox row is
    // drained or quarantined and then rejects every new active row without v1.
    return null;
  }
  if (Number(envelope.version) !== 1 || !Array.isArray(envelope.messages)) {
    throw new Error("whatsapp_ingress_snapshot_envelope_invalid");
  }
  const matches = envelope.messages.filter((candidate: unknown) =>
    isRecord(candidate) && cleanText(candidate.provider_message_id) === message.messageId
  );
  if (matches.length !== 1) {
    throw new Error(matches.length === 0
      ? "whatsapp_ingress_snapshot_message_missing"
      : "whatsapp_ingress_snapshot_message_ambiguous");
  }
  const row = matches[0] as JsonRecord;
  if (
    Number(row.version) !== 1
    || optionalUuid(row.organization_id) !== optionalUuid(session.organization_id)
    || optionalUuid(row.session_id) !== optionalUuid(session.id)
  ) {
    throw new Error("whatsapp_ingress_snapshot_scope_invalid");
  }
  const state = cleanText(row.state) as WhatsAppIngressRoutingSnapshot["state"] | null;
  if (!state || ![
    "bound",
    "lead_match",
    "unlinked",
    "quarantine",
    "contextual_intake",
    "provider_replay",
    "predecessor_inherit",
  ].includes(state)) {
    throw new Error("whatsapp_ingress_snapshot_state_invalid");
  }
  const conversationId = optionalUuid(row.conversation_id);
  const eventLeadId = optionalUuid(row.event_lead_id);
  const currentLeadId = optionalUuid(row.current_lead_id);
  const activeBindingId = optionalUuid(row.active_binding_id);
  const quarantineReason = cleanText(row.quarantine_reason);
  const contextKind = cleanText(row.context_kind) as "organic" | "contextual_intake" | null;
  const contextProof = cleanText(row.context_proof);
  const ruleId = optionalUuid(row.rule_id);
  const originRoundRobinId = optionalUuid(row.origin_round_robin_id);
  const inboxEventKey = cleanText(row.inbox_event_key);
  const processingLane = cleanText(row.processing_lane) as "live" | "backlog" | null;
  const managedMessageDistribution = row.managed_message_distribution === true;
  const managedEventPending = row.managed_event_pending === true;
  const managedEventHandled = row.managed_event_handled === true;
  const routingKey = cleanText(row.routing_key);
  const bindingEligible = row.binding_eligible === true;
  const targetMode = cleanText(row.target_mode) as "snapshot" | "inherit_predecessor" | null;
  const ingressSequence = Number(row.ingress_sequence);
  const predecessorProviderMessageId = cleanText(row.predecessor_provider_message_id);
  const predecessorInboxEventKey = cleanText(row.predecessor_inbox_event_key);
  const predecessorProcessingLane = cleanText(row.predecessor_processing_lane) as "live" | "backlog" | null;
  if (
    !contextKind || !["organic", "contextual_intake"].includes(contextKind)
    || !inboxEventKey
    || !processingLane || !["live", "backlog"].includes(processingLane)
    || !routingKey
    || typeof row.binding_eligible !== "boolean"
    || typeof row.managed_message_distribution !== "boolean"
    || typeof row.managed_event_pending !== "boolean"
    || typeof row.managed_event_handled !== "boolean"
    || !targetMode || !["snapshot", "inherit_predecessor"].includes(targetMode)
    || !Number.isSafeInteger(ingressSequence) || ingressSequence <= 0
    || (activeBindingId && (!conversationId || !currentLeadId))
    || (state === "quarantine" && (!quarantineReason || eventLeadId))
    || (state !== "quarantine" && quarantineReason)
    || (["bound", "lead_match", "provider_replay"].includes(state) && !eventLeadId)
    || (state === "unlinked" && eventLeadId)
    || (state === "predecessor_inherit" && eventLeadId)
    || (managedMessageDistribution && (!ruleId || !originRoundRobinId || contextKind !== "contextual_intake"))
    || (managedMessageDistribution !== (contextProof === "managed_rule"))
    || (managedEventPending && managedEventHandled)
    || (contextKind === "contextual_intake" && !contextProof)
    || (bindingEligible && routingKey === "__session__")
    || (targetMode === "inherit_predecessor" && (
      state !== "predecessor_inherit"
      || contextKind !== "organic"
      || !bindingEligible
      || !predecessorProviderMessageId
      || !predecessorInboxEventKey
      || !predecessorProcessingLane
    ))
    || (targetMode === "snapshot" && state === "predecessor_inherit")
    || (!predecessorProviderMessageId && (predecessorInboxEventKey || predecessorProcessingLane))
  ) {
    throw new Error("whatsapp_ingress_snapshot_contract_invalid");
  }
  return {
    state,
    conversationId,
    eventLeadId,
    currentLeadId,
    activeBindingId,
    leadResolutionQuarantineReason: quarantineReason,
    providerMessageId: message.messageId,
    inboxEventKey,
    processingLane,
    contextKind,
    contextProof,
    ruleId,
    originRoundRobinId,
    managedMessageDistribution,
    managedEventPending,
    managedEventHandled,
    routingKey,
    bindingEligible,
    targetMode,
    ingressSequence,
    predecessorProviderMessageId,
    predecessorInboxEventKey,
    predecessorProcessingLane,
  };
}

function orderMessagesByIngressRoutingSnapshot(
  payload: unknown,
  session: JsonRecord,
  messages: ReturnType<typeof extractMessages>,
  authorization: AuthorizedEvolutionGoWebhook,
) {
  const ordered = messages.map((message, originalIndex) => ({
    message,
    originalIndex,
    snapshot: ingressRoutingSnapshotForMessage(payload, session, message, authorization),
  }));
  const sequenced = ordered.filter((entry) => entry.snapshot !== null);
  if (sequenced.length === 0) return messages;
  if (sequenced.length !== ordered.length) {
    throw new Error("whatsapp_ingress_snapshot_batch_incomplete");
  }
  const seen = new Set<number>();
  for (const entry of sequenced) {
    const sequence = entry.snapshot!.ingressSequence;
    if (seen.has(sequence)) throw new Error("whatsapp_ingress_snapshot_sequence_ambiguous");
    seen.add(sequence);
  }
  return ordered
    .sort((left, right) =>
      left.snapshot!.ingressSequence - right.snapshot!.ingressSequence
      || left.originalIndex - right.originalIndex
    )
    .map((entry) => entry.message);
}

type WhatsAppProviderEventBinding = {
  bindingId: string;
  conversationId: string;
  leadId: string;
  stale: boolean;
};

async function findWhatsAppProviderEventBinding(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
): Promise<WhatsAppProviderEventBinding | null> {
  if (!message?.messageId) return null;
  const { data, error } = await supabase
    .from("whatsapp_conversation_lead_bindings")
    .select("id, conversation_id, lead_id, stale")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("provider_message_id", message.messageId)
    .limit(2);
  if (error) throw error;
  if ((data || []).length > 1) {
    throw new Error("whatsapp_provider_event_binding_ambiguous");
  }
  const row = data?.[0];
  if (!row) return null;
  const bindingId = optionalUuid(row.id);
  const conversationId = optionalUuid(row.conversation_id);
  const leadId = optionalUuid(row.lead_id);
  if (!bindingId || !conversationId || !leadId || typeof row.stale !== "boolean") {
    throw new Error("whatsapp_provider_event_binding_invalid");
  }
  return { bindingId, conversationId, leadId, stale: row.stale };
}

type WhatsAppInheritedRoutingTarget = {
  ready: boolean;
  terminal: boolean;
  reason: string | null;
  conversationId: string | null;
  leadId: string | null;
  activeBindingId: string | null;
};

async function resolveWhatsAppInheritedRoutingTarget(
  session: JsonRecord,
  snapshot: WhatsAppIngressRoutingSnapshot,
): Promise<WhatsAppInheritedRoutingTarget> {
  if (snapshot.targetMode !== "inherit_predecessor") {
    throw new Error("whatsapp_inherited_target_route_invalid");
  }
  const { data, error } = await supabase.rpc(
    "resolve_whatsapp_webhook_inherited_routing_target",
    {
      p_organization_id: session.organization_id,
      p_session_id: session.id,
      p_provider_message_id: snapshot.providerMessageId,
    },
  );
  if (error) throw error;
  if (!isRecord(data) || typeof data.ready !== "boolean" || typeof data.terminal !== "boolean") {
    throw new Error("whatsapp_inherited_target_result_invalid");
  }
  const reason = cleanText(data.reason);
  if (!data.ready) {
    if (!data.terminal || !reason) throw new Error("whatsapp_inherited_target_result_incomplete");
    return {
      ready: false,
      terminal: true,
      reason,
      conversationId: null,
      leadId: null,
      activeBindingId: null,
    };
  }
  const conversationId = optionalUuid(data.conversation_id);
  const leadId = optionalUuid(data.lead_id);
  const activeBindingId = optionalUuid(data.active_binding_id);
  if (data.terminal || reason || !conversationId || !leadId || !activeBindingId) {
    throw new Error("whatsapp_inherited_target_result_incomplete");
  }
  return {
    ready: true,
    terminal: false,
    reason: null,
    conversationId,
    leadId,
    activeBindingId,
  };
}

function parseWhatsAppConversationBindingSnapshot(
  conversation: JsonRecord | null,
): WhatsAppConversationBindingSnapshot {
  if (!conversation) {
    return {
      conversationId: null,
      currentLeadId: null,
      activeBindingId: null,
      leadResolutionQuarantineReason: null,
    };
  }
  const conversationId = optionalUuid(conversation.id);
  if (!conversationId) throw new Error("whatsapp_conversation_binding_snapshot_invalid");
  const activeBindings = Array.isArray(conversation.active_bindings)
    ? conversation.active_bindings.filter((binding) => isRecord(binding) && binding.active_to == null)
    : (isRecord(conversation.active_bindings) && conversation.active_bindings.active_to == null
      ? [conversation.active_bindings]
      : []);
  if (activeBindings.length > 1) {
    throw new Error("whatsapp_conversation_active_binding_ambiguous");
  }
  const currentLeadId = optionalUuid(conversation.lead_id);
  const activeBindingId = optionalUuid(activeBindings[0]?.id);
  const activeBindingLeadId = optionalUuid(activeBindings[0]?.lead_id);
  if (activeBindings.length === 1 && (!activeBindingId || activeBindingLeadId !== currentLeadId)) {
    throw new Error("whatsapp_conversation_binding_snapshot_inconsistent");
  }
  return {
    conversationId,
    currentLeadId,
    activeBindingId,
    leadResolutionQuarantineReason: null,
  };
}

async function captureWhatsAppConversationBindingSnapshot(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  storedConversationId?: unknown,
): Promise<WhatsAppConversationBindingSnapshot> {
  if (!message) throw new Error("Missing normalized message");
  const requiredConversationId = optionalUuid(storedConversationId);
  if (storedConversationId && !requiredConversationId) {
    throw new Error("whatsapp_stored_conversation_identity_invalid");
  }
  const snapshotSelect = "id, lead_id, remote_jid, active_bindings:whatsapp_conversation_lead_bindings(id, lead_id, active_to)";
  if (requiredConversationId) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select(snapshotSelect)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", requiredConversationId)
      .is("active_bindings.active_to", null)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("whatsapp_stored_conversation_missing");
    return parseWhatsAppConversationBindingSnapshot(data);
  }
  const identity = whatsappIdentityForMessage(message);
  let remoteJid = identity.remoteJid || message.remoteJid;
  let contactPhone = message.isGroup ? null : (identity.contactPhone || null);
  let identityAliases = mergeWhatsAppIdentityAliases(identity, [message.remoteJid, remoteJid]);
  const aliasLookup = await findWhatsAppIdentityAlias(session, identityAliases);
  if (aliasLookup.quarantineReason) {
    return {
      conversationId: null,
      currentLeadId: null,
      activeBindingId: null,
      leadResolutionQuarantineReason: aliasLookup.quarantineReason,
    };
  }
  const aliasMatch = aliasLookup.match;
  if (aliasMatch) {
    if (!message.isGroup) {
      contactPhone = contactPhone || aliasMatch.contact_phone || phoneFromJidLike(aliasMatch.canonical_jid) || null;
    }
    if (!isUsableCanonicalJid(remoteJid) || isOpaqueJid(normalizeJid(remoteJid, false))) {
      remoteJid = normalizeJid(aliasMatch.canonical_jid, message.isGroup) || remoteJid;
    }
    identityAliases = mergeWhatsAppIdentityAliases(identity, [
      ...identityAliases,
      aliasMatch.alias_jid,
      aliasMatch.canonical_jid,
      aliasMatch.contact_phone ? `${aliasMatch.contact_phone}@s.whatsapp.net` : "",
      aliasMatch.contact_phone ? `${aliasMatch.contact_phone}@c.us` : "",
    ]);
  }

  let existing: JsonRecord | null = null;
  if (identityAliases.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select(snapshotSelect)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("remote_jid", identityAliases)
      .is("deleted_at", null)
      .is("active_bindings.active_to", null)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    const matches = data || [];
    const canonical = matches.find((conversation: JsonRecord) => conversation.remote_jid === remoteJid) || null;
    if (!canonical && matches.length > 1) {
      throw new Error("whatsapp_conversation_identity_ambiguous");
    }
    existing = canonical || matches[0] || null;
  }

  const phoneVariants = message.isGroup
    ? []
    : phoneMatchVariantsForWhatsApp(contactPhone, remoteJid, message.remoteJid, ...identityAliases);
  if (!existing && phoneVariants.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select(snapshotSelect)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("contact_phone", phoneVariants)
      .is("deleted_at", null)
      .is("active_bindings.active_to", null)
      .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
    if ((data || []).length > 1) {
      throw new Error("whatsapp_conversation_phone_ambiguous");
    }
    existing = data?.[0] || null;
  }
  return parseWhatsAppConversationBindingSnapshot(existing);
}

async function ensureConversation(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  lead: JsonRecord | null,
  storedConversationId?: unknown,
  knownLeadResolutionQuarantineReason?: string | null,
) {
  if (!message) throw new Error("Missing normalized message");
  const identity = whatsappIdentityForMessage(message);
  let remoteJid = identity.remoteJid || message.remoteJid;
  let contactPhone = message.isGroup ? null : (identity.contactPhone || null);
  let identityAliases = mergeWhatsAppIdentityAliases(identity, [message.remoteJid, remoteJid]);
  const requiredConversationId = optionalUuid(storedConversationId);
  if (storedConversationId && !requiredConversationId) {
    throw new Error("whatsapp_stored_conversation_identity_invalid");
  }
  let leadResolutionQuarantineReason = cleanText(knownLeadResolutionQuarantineReason) || null;
  let aliasMatch: JsonRecord | null = null;
  if (!requiredConversationId && !leadResolutionQuarantineReason) {
    const aliasLookup = await findWhatsAppIdentityAlias(session, identityAliases);
    aliasMatch = aliasLookup.match;
    leadResolutionQuarantineReason = aliasLookup.quarantineReason;
  }
  if (leadResolutionQuarantineReason) {
    // Conflicting aliases are evidence, not routing input. Restrict the
    // physical lookup to the provider's primary JID and never update the
    // winning alias/conversation merely because it was seen most recently.
    identityAliases = unique([normalizeJid(remoteJid, message.isGroup)].filter(Boolean));
  }

  if (aliasMatch) {
    if (!message.isGroup) {
      contactPhone = contactPhone || aliasMatch.contact_phone || phoneFromJidLike(aliasMatch.canonical_jid) || null;
    }
    if (!isUsableCanonicalJid(remoteJid) || isOpaqueJid(normalizeJid(remoteJid, false))) {
      remoteJid = normalizeJid(aliasMatch.canonical_jid, message.isGroup) || remoteJid;
    }
    identityAliases = mergeWhatsAppIdentityAliases(identity, [
      ...identityAliases,
      aliasMatch.alias_jid,
      aliasMatch.canonical_jid,
      aliasMatch.contact_phone ? `${aliasMatch.contact_phone}@s.whatsapp.net` : "",
      aliasMatch.contact_phone ? `${aliasMatch.contact_phone}@c.us` : "",
    ]);
  }

  const attribution = whatsappAttribution(message);
  const resolvedGroupName = message.isGroup ? await resolveGroupName(session, remoteJid, message.groupName) : null;
  const conversationOwnerUserId = optionalUuid(session.owner_user_id);

  let existing: JsonRecord | null = null;
  let canonicalConflict = false;

  if (requiredConversationId) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", requiredConversationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("whatsapp_stored_conversation_missing");
    existing = data;
  }

  if (!existing && identityAliases.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("remote_jid", identityAliases)
	  .is("deleted_at", null)
	  .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;

    const matches = data || [];
    const canonical = matches.find((conversation: JsonRecord) =>
      conversation.remote_jid === remoteJid
    ) || null;
	if (!canonical && matches.length > 1) {
	  throw new Error("whatsapp_conversation_identity_ambiguous");
	}
	existing = canonical || matches[0] || null;
	canonicalConflict = Boolean(canonical && matches.some((candidate: JsonRecord) => candidate.id !== canonical.id));
  }

  const phoneVariants = message.isGroup
    ? []
    : phoneMatchVariantsForWhatsApp(contactPhone, remoteJid, message.remoteJid, ...identityAliases);

  if (!existing && !leadResolutionQuarantineReason && !message.isGroup && phoneVariants.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("contact_phone", phoneVariants)
	  .is("deleted_at", null)
	  .order("last_message_at", { ascending: false, nullsFirst: false });
    if (error) throw error;
	if ((data || []).length > 1) {
	  throw new Error("whatsapp_conversation_phone_ambiguous");
	}
	existing = data?.[0] || null;
  }

  if (existing) {
    if (leadResolutionQuarantineReason) {
      return {
        ...existing,
        __whatsapp_identity_alias_quarantine_reason: leadResolutionQuarantineReason,
      };
    }
    // Conversation ownership changes only through the binding RPC. Preserve
    // the current lead here so a new queue context can never write a message
    // into the previous card before the locked activation succeeds.
    const attachableLeadId = existing.lead_id || null;
    const contactName = message.isGroup
      ? (resolvedGroupName || existing.contact_name || "Grupo WhatsApp")
      : (!message.fromMe && message.contactName ? message.contactName : existing.contact_name);
    const updates: JsonRecord = {
      contact_name: contactName,
      contact_phone: existing.contact_phone || contactPhone,
      contact_picture: message.avatarUrl || existing.contact_picture,
      assigned_user_id: existing.assigned_user_id || (attachableLeadId ? optionalUuid(lead?.assigned_user_id) : null) || conversationOwnerUserId,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(existing.metadata || {}),
        last_webhook_at: new Date().toISOString(),
        whatsapp_identity: {
          canonical_jid: remoteJid,
          aliases: identityAliases,
          contact_phone: contactPhone,
        },
        ...(message.isGroup && resolvedGroupName ? { group_name: resolvedGroupName } : {}),
        ...(!leadResolutionQuarantineReason && attribution ? { whatsapp_attribution: attribution } : {}),
      },
    };

    const existingRemote = normalizeText(existing.remote_jid);
    const existingRemoteCanonical = normalizeJid(existingRemote, message.isGroup);
    const shouldPromoteRemote = !canonicalConflict &&
      remoteJid &&
      existingRemote !== remoteJid &&
      isUsableCanonicalJid(remoteJid) &&
      (existingRemoteCanonical === remoteJid || !isUsableCanonicalJid(existingRemote) || isOpaqueJid(existingRemote.toLowerCase()));

    if (shouldPromoteRemote) {
      updates.remote_jid = remoteJid;
    }

    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;

    await safelyUpsertWhatsAppIdentityAliases(session, identity, data, identityAliases);
    return data;
  }

  const attachableLeadId = null;

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      organization_id: session.organization_id,
      session_id: session.id,
      lead_id: attachableLeadId,
      assigned_user_id: (attachableLeadId ? optionalUuid(lead?.assigned_user_id) : null) || conversationOwnerUserId,
      remote_jid: remoteJid,
      contact_name: message.isGroup
        ? (resolvedGroupName || "Grupo WhatsApp")
        : (message.contactName || cleanText(lead?.name) || contactPhone || "Contato WhatsApp"),
      contact_phone: contactPhone,
      contact_picture: message.avatarUrl,
      is_group: message.isGroup,
      unread_count: 0,
      metadata: {
        source: "evolution_go",
        created_from_webhook: true,
        whatsapp_identity: {
          canonical_jid: remoteJid,
          aliases: identityAliases,
          contact_phone: contactPhone,
        },
        ...(message.isGroup && resolvedGroupName ? { group_name: resolvedGroupName } : {}),
        ...(!leadResolutionQuarantineReason && attribution ? { whatsapp_attribution: attribution } : {}),
      },
    })
    .select("*")
    .single();

  if (error) {
    if (isUniqueViolation(error, "whatsapp_conversations_session_id_remote_jid_key")) {
      const { data: recovered, error: recoveryError } = await supabase
        .from("whatsapp_conversations")
        .select("*")
        .eq("organization_id", session.organization_id)
        .eq("session_id", session.id)
        .eq("remote_jid", remoteJid)
        .maybeSingle();
      if (recoveryError) throw recoveryError;
      if (recovered) {
        if (!leadResolutionQuarantineReason) {
          await safelyUpsertWhatsAppIdentityAliases(session, identity, recovered, identityAliases);
        }
        return leadResolutionQuarantineReason
          ? {
              ...recovered,
              __whatsapp_identity_alias_quarantine_reason: leadResolutionQuarantineReason,
            }
          : recovered;
      }
    }
    throw error;
  }
  if (!leadResolutionQuarantineReason) {
    await safelyUpsertWhatsAppIdentityAliases(session, identity, data, identityAliases);
  }
  return leadResolutionQuarantineReason
    ? {
        ...data,
        __whatsapp_identity_alias_quarantine_reason: leadResolutionQuarantineReason,
      }
    : data;
}

async function activateWhatsAppConversationLeadBinding(
  session: JsonRecord,
  conversation: JsonRecord,
  lead: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  expected: WhatsAppConversationBindingSnapshot,
) {
  if (!message || !conversation?.id || !lead?.id) {
    throw new Error("whatsapp_conversation_lead_binding_context_invalid");
  }
  if (expected.conversationId && optionalUuid(conversation.id) !== expected.conversationId) {
    throw new Error("whatsapp_conversation_binding_snapshot_changed");
  }
  const { data, error } = await supabase.rpc("activate_whatsapp_conversation_lead_binding_if_current", {
    p_organization_id: session.organization_id,
    p_conversation_id: conversation.id,
    p_lead_id: lead.id,
    p_provider_message_id: message.messageId || null,
    p_expected_active_binding_id: expected.activeBindingId,
    p_expected_current_lead_id: expected.currentLeadId,
  });
  if (error) throw error;
  if (
    !isRecord(data)
    || data.success !== true
    || optionalUuid(data.conversation_id) !== optionalUuid(conversation.id)
    || optionalUuid(data.lead_id) !== optionalUuid(lead.id)
    || !optionalUuid(data.binding_id)
    || typeof data.stale !== "boolean"
    || typeof data.is_current !== "boolean"
    || (data.is_current === true && (
      data.stale === true
      || optionalUuid(data.active_lead_id) !== optionalUuid(lead.id)
    ))
    || (data.stale === true && data.is_current === true)
  ) {
    throw new Error("whatsapp_conversation_lead_binding_incomplete");
  }
  if (data.is_current !== true && !cleanText(message.messageId)) {
    throw new Error("whatsapp_historical_conversation_binding_without_provider_identity");
  }

  const boundConversation = {
    ...conversation,
    lead_id: optionalUuid(data.active_lead_id),
  };
  await safelyUpsertWhatsAppIdentityAliases(
    session,
    whatsappIdentityForMessage(message),
    boundConversation,
    [message.remoteJid, message.senderJid],
  );
  return {
    conversation: boundConversation,
    eventLeadId: optionalUuid(data.lead_id),
    isCurrent: data.is_current === true,
  };
}

async function resolveWhatsAppAttendanceCapture(
  session: JsonRecord,
  conversation: JsonRecord,
  eventLeadId: string | null,
  eventBindingIsCurrent: boolean,
  ingress: WhatsAppIngressRoutingSnapshot | null,
  message: ReturnType<typeof normalizeMessage>,
  resolvedLead: JsonRecord | null,
  storedMessage: JsonRecord | null,
): Promise<WhatsAppAttendanceCaptureDecision> {
  const derivedMessageFingerprint = await sha256Hex(
    `${session.organization_id}\u001f${session.id}\u001f${message?.messageId || ""}\u001f${message?.content || ""}`,
  );
  const persistedFingerprint = cleanText(
    storedMessage?.metadata?.whatsapp_attendance_capture?.message_fingerprint,
  );
  const messageFingerprint = persistedFingerprint
    && /^[0-9a-f]{64}$/.test(persistedFingerprint)
    ? persistedFingerprint
    : derivedMessageFingerprint;

  // An already persisted classification is permanent. In particular, an
  // attendance entry created after a suppressed delivery must never make its
  // retry rehydrate content, metadata, preview or media.
  const persistedState = persistedWhatsAppMessageCaptureState(storedMessage);
  if (persistedState) {
    return {
      captureState: persistedState,
      reason: `persisted_${persistedState}`,
      bindingId: null,
      attendanceEntryId: null,
      ingressSequence: ingress?.ingressSequence || null,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }

  if (!eventBindingIsCurrent || !eventLeadId || !conversation?.id) {
    return {
      captureState: "suppressed",
      reason: "current_binding_not_proven",
      bindingId: null,
      attendanceEntryId: null,
      ingressSequence: ingress?.ingressSequence || null,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }
  if (!ingress?.inboxEventKey || !Number.isSafeInteger(ingress.ingressSequence)) {
    return {
      captureState: "suppressed",
      reason: "durable_ingress_fence_missing",
      bindingId: null,
      attendanceEntryId: null,
      ingressSequence: ingress?.ingressSequence || null,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }
  // sentAt has an operational fallback for legacy storage/id generation. The
  // attendance fence may use only an actual, valid provider timestamp.
  const providerOccurredAt = cleanText(message?.providerOccurredAt);
  if (!providerOccurredAt || !Number.isFinite(Date.parse(providerOccurredAt))) {
    return {
      captureState: "suppressed",
      reason: "provider_occurrence_time_missing",
      bindingId: null,
      attendanceEntryId: null,
      ingressSequence: ingress.ingressSequence,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }

  const { data: activeBinding, error: bindingError } = await supabase
    .from("whatsapp_conversation_lead_bindings")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("conversation_id", conversation.id)
    .eq("session_id", session.id)
    .eq("lead_id", eventLeadId)
    .eq("stale", false)
    .is("active_to", null)
    .maybeSingle();
  if (bindingError) throw bindingError;
  const bindingId = optionalUuid(activeBinding?.id);
  if (
    !bindingId
    || (
      ingress.activeBindingId
      && ingress.activeBindingId !== bindingId
      // A new contextual card deliberately replaces the ingress-time binding.
      // The CAS result and the exact active lead/binding above prove the new
      // destination; organic traffic must still match the old binding.
      && ingress.contextKind !== "contextual_intake"
    )
  ) {
    return {
      captureState: "suppressed",
      reason: "active_binding_changed",
      bindingId,
      attendanceEntryId: null,
      ingressSequence: ingress.ingressSequence,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }

  const { data: inbox, error: inboxError } = await supabase
    .from("whatsapp_webhook_inbox")
    .select("created_at")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("event_key", ingress.inboxEventKey)
    .maybeSingle();
  if (inboxError) throw inboxError;
  const inboxCreatedAt = cleanText(inbox?.created_at);
  if (!inboxCreatedAt || !Number.isFinite(Date.parse(inboxCreatedAt))) {
    return {
      captureState: "suppressed",
      reason: "durable_inbox_time_missing",
      bindingId,
      attendanceEntryId: null,
      ingressSequence: ingress.ingressSequence,
      inboxCreatedAt: null,
      messageFingerprint,
    };
  }
  if (
    Date.parse(providerOccurredAt)
      > Date.parse(inboxCreatedAt)
  ) {
    return {
      captureState: "suppressed",
      reason: "provider_occurrence_after_ingress",
      bindingId,
      attendanceEntryId: null,
      ingressSequence: ingress.ingressSequence,
      inboxCreatedAt,
      messageFingerprint,
    };
  }

  // Attendance belongs to the current owner of this connection, not merely
  // to someone who owned it when they entered. Re-read after the ingress and
  // binding checks so an ownership transfer or offboarding does not let the
  // previous attendee capture the new owner's traffic. A disconnected but
  // still active session is valid for delayed inbox processing.
  const { data: currentSession, error: currentSessionError } = await supabase
    .from("whatsapp_sessions")
    .select("owner_user_id, is_active, provider, status")
    .eq("organization_id", session.organization_id)
    .eq("id", session.id)
    .maybeSingle();
  if (currentSessionError) throw currentSessionError;
  const attendanceOwnerId = currentSession
    ? await resolveActiveSessionOwner({ ...session, ...currentSession })
    : null;
  if (!attendanceOwnerId) {
    return {
      captureState: "suppressed",
      reason: "current_session_owner_inactive_or_missing",
      bindingId,
      attendanceEntryId: null,
      ingressSequence: ingress.ingressSequence,
      inboxCreatedAt,
      messageFingerprint,
    };
  }

  const initialProviderEventId = cleanText(
    resolvedLead?.metadata?.whatsapp_initial_provider_event_id,
  );
  if (
    eventLeadId === optionalUuid(resolvedLead?.id)
    && !message.fromMe
    && !message.isGroup
    && message.messageType !== "reaction"
    && !message.providerMessageIdSynthetic
    && isConfirmedClickToWhatsAppAd(message)
    && ingress.contextKind === "contextual_intake"
    && initialProviderEventId === `${session.id}:${message.messageId}`
  ) {
    // A lead created by this CTWA provider event starts attendance on the
    // receiving WhatsApp automatically. The service-only RPC checks private
    // lead-insert provenance, the durable ingress and the current binding;
    // mutable metadata by itself never authorizes capture. Retries are safe.
    const { data: autoEntryId, error: autoEntryError } = await supabase.rpc(
      "auto_enter_whatsapp_ctwa_attendance",
      {
        p_organization_id: session.organization_id,
        p_conversation_id: conversation.id,
        p_session_id: session.id,
        p_lead_id: eventLeadId,
        p_binding_id: bindingId,
        p_provider_message_id: message.messageId,
        p_ingress_sequence: ingress.ingressSequence,
        p_provider_occurred_at: providerOccurredAt,
      },
    );
    if (autoEntryError) throw autoEntryError;
    if (autoEntryId !== null && !optionalUuid(autoEntryId)) {
      throw new Error("whatsapp_ctwa_auto_attendance_result_invalid");
    }
  }

  const attendanceScope = () => supabase
    .from("whatsapp_attendance_entries")
    .select("id, bootstrap_provider_message_id, bootstrap_ingress_sequence")
    .eq("organization_id", session.organization_id)
    .eq("conversation_id", conversation.id)
    .eq("session_id", session.id)
    .eq("lead_id", eventLeadId)
    .eq("binding_id", bindingId)
    .eq("user_id", attendanceOwnerId);
  const [manualResult, autoResult] = await Promise.all([
    attendanceScope()
      .eq("entry_source", "manual")
      .lte("joined_at", inboxCreatedAt)
      .lte("joined_at", providerOccurredAt)
      .lt("ingress_sequence_cutoff", ingress.ingressSequence)
      .order("joined_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    attendanceScope()
      .eq("entry_source", "ctwa_auto")
      .lte("bootstrap_ingress_sequence", ingress.ingressSequence)
      .lte("bootstrap_provider_occurred_at", providerOccurredAt)
      .lte("bootstrap_inbox_created_at", inboxCreatedAt)
      .order("bootstrap_ingress_sequence", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  if (manualResult.error) throw manualResult.error;
  if (autoResult.error) throw autoResult.error;
  const autoEntry = autoResult.data;
  const autoEntryId = optionalUuid(autoEntry?.id);
  const autoEntryEffective = Boolean(autoEntryId) && (
    Number(autoEntry?.bootstrap_ingress_sequence) < ingress.ingressSequence
    || (
      Number(autoEntry?.bootstrap_ingress_sequence) === ingress.ingressSequence
      && cleanText(autoEntry?.bootstrap_provider_message_id) === message.messageId
    )
  );
  const attendanceEntryId = optionalUuid(manualResult.data?.id)
    || (autoEntryEffective ? autoEntryId : null);

  return {
    captureState: attendanceEntryId ? "captured" : "suppressed",
    reason: attendanceEntryId
      ? "attendance_entry_effective_for_ingress"
      : "attendance_entry_not_effective",
    bindingId,
    attendanceEntryId,
    ingressSequence: ingress.ingressSequence,
    inboxCreatedAt,
    messageFingerprint,
  };
}

async function findStoredMessage(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
) {
  return await findMessageByProviderIdentity(
    session,
    message,
    "id, conversation_id, lead_id, capture_state, metadata",
  );
}

async function findMessageByProviderIdentity(
  session: JsonRecord,
  message: ReturnType<typeof normalizeMessage>,
  columns: string,
) {
  if (!message) return null;
  const matches = new Map<string, JsonRecord>();
  for (const identityColumn of ["message_id", "provider_message_id"] as const) {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .select(columns)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq(identityColumn, message.messageId)
      .maybeSingle();
    if (error) throw error;
    if (data?.id) matches.set(String(data.id), data);
  }
  if (matches.size > 1) {
    throw new Error("whatsapp_message_provider_identity_conflict");
  }
  return matches.values().next().value || null;
}

async function redactSuppressedStoredMessage(
  session: JsonRecord,
  storedMessage: JsonRecord,
  providerMessageId: string,
  decision: WhatsAppAttendanceCaptureDecision | null = null,
  completed = false,
) {
  if (
    !storedMessage?.id
    || persistedWhatsAppMessageCaptureState(storedMessage) !== "suppressed"
  ) {
    return storedMessage;
  }
  const metadata = redactedSuppressedMessageMetadata(
    storedMessage.metadata,
    providerMessageId,
    decision,
    completed,
  );
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .update({
      content: null,
      media_url: null,
      media_mime_type: null,
      media_storage_path: null,
      media_status: null,
      media_error: null,
      media_size: null,
      sender_jid: null,
      sender_name: null,
      sender_user_id: null,
      reaction_to_message_id: null,
      reaction_emoji: null,
      reaction_sender_jid: null,
      reaction_sender_name: null,
      metadata,
    })
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", storedMessage.id)
    .eq("capture_state", "suppressed")
    .select("id, conversation_id, lead_id, capture_state, metadata")
    .maybeSingle();
  if (error || !data?.id) {
    throw error || new Error("suppressed_whatsapp_message_redaction_lost_ownership");
  }
  return { ...storedMessage, ...data };
}

async function insertMessage(
  session: JsonRecord,
  conversation: JsonRecord,
  lead: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
  captureDecision: WhatsAppAttendanceCaptureDecision,
  leadResolutionQuarantineReason: string | null = null,
  allowMediaEffects = true,
) {
  if (!message) return { inserted: false, message: null };
  const eventLeadId = leadResolutionQuarantineReason
    ? null
    : optionalUuid(lead?.id || conversation.lead_id);

  const existing = await findMessageByProviderIdentity(
    session,
    message,
    "id, conversation_id, lead_id, capture_state, media_storage_path, media_status, media_error, metadata",
  );
  const existingCaptureState = persistedWhatsAppMessageCaptureState(existing);
  const captureState = existingCaptureState || captureDecision.captureState;
  if (!existing && captureState === "legacy") {
    throw new Error("new_whatsapp_message_cannot_be_legacy");
  }
  const captureSuppressed = captureState === "suppressed";
  const existingCaptureMetadata = isRecord(existing?.metadata?.whatsapp_attendance_capture)
    ? existing.metadata.whatsapp_attendance_capture
    : null;
  const captureAudit = existingCaptureMetadata
    || attendanceCaptureMetadata(captureDecision);

  // Quarantine persists only neutral provider evidence. It must never start a
  // media download/storage side effect for whichever card currently owns the
  // physical conversation.
  const isMedia = !captureSuppressed && allowMediaEffects && !leadResolutionQuarantineReason
    && ["image", "video", "audio", "document", "sticker"].includes(message.messageType);
  const media = isMedia && !existing?.media_storage_path
    ? await storeInboundMedia({ session, message })
    : null;
  const mediaStoragePath = captureSuppressed
    ? null
    : (media?.path || existing?.media_storage_path || null);
  const mediaStatus = isMedia
    ? (mediaStoragePath ? "ready" : (media?.status || "pending"))
    : null;
  const mediaError = isMedia && !mediaStoragePath
    ? (media?.error || "media_download_pending")
    : null;

  const capturedMetadata = pendingEvolutionGoEffectMetadata({
    source: "evolution_go_webhook",
    whatsapp_event_binding_is_current: allowMediaEffects
      && !leadResolutionQuarantineReason,
    whatsapp_attendance_capture: captureAudit,
    ...(leadResolutionQuarantineReason
      ? {
        lead_resolution_quarantine: {
          reason: leadResolutionQuarantineReason,
          terminal: true,
          retryable: false,
          recorded_at: new Date().toISOString(),
        },
      }
      : {}),
    whatsapp_attribution: whatsappAttribution(message),
    whatsapp_referral: message.referral,
    raw: message.raw,
  }, message.messageId);
  // Suppressed payloads must be safe at the first INSERT boundary. A later
  // UPDATE cannot undo Realtime/logical-replication disclosure or a crash
  // between requests, so raw/referral/content/media never enter this row.
  const persistedMetadata = captureSuppressed
    ? redactedSuppressedMessageMetadata(
      {
        source: "evolution_go_webhook",
        whatsapp_event_binding_is_current: false,
        whatsapp_attendance_capture: captureAudit,
        ...(leadResolutionQuarantineReason
          ? {
            lead_resolution_quarantine: {
              reason: leadResolutionQuarantineReason,
              terminal: true,
              retryable: false,
              recorded_at: new Date().toISOString(),
            },
          }
          : {}),
      },
      message.messageId,
      captureDecision,
    )
    : capturedMetadata;
  const row = {
    organization_id: session.organization_id,
    conversation_id: conversation.id,
    session_id: session.id,
    lead_id: eventLeadId,
    capture_state: captureState,
    message_id: message.messageId,
    provider_message_id: message.messageId,
    from_me: message.fromMe,
    message_type: message.messageType,
    content: captureSuppressed ? null : message.content,
    media_url: captureSuppressed || !allowMediaEffects || leadResolutionQuarantineReason ? null : message.mediaUrl,
    media_mime_type: captureSuppressed || !allowMediaEffects || leadResolutionQuarantineReason ? null : (media?.contentType || message.mediaMimeType),
    media_storage_path: mediaStoragePath,
    media_status: mediaStatus,
    media_error: mediaError,
    media_size: captureSuppressed || !allowMediaEffects || leadResolutionQuarantineReason ? null : (media?.size || message.mediaSize),
    remote_jid: conversation.remote_jid || message.remoteJid,
    sender_jid: captureSuppressed ? null : message.senderJid,
    sender_name: captureSuppressed ? null : message.senderName,
    reaction_to_message_id: captureSuppressed ? null : message.reactionToMessageId,
    reaction_emoji: captureSuppressed ? null : message.reactionEmoji,
    reaction_sender_jid: captureSuppressed ? null : message.senderJid,
    reaction_sender_name: captureSuppressed ? null : message.senderName,
    status: message.fromMe ? "sent" : "received",
    sent_at: message.sentAt,
    received_at: message.fromMe ? null : new Date().toISOString(),
    metadata: persistedMetadata,
  };

  if (existing) {
	const existingConversationId = optionalUuid(existing.conversation_id);
	const requestedConversationId = optionalUuid(conversation.id);
	const existingLeadId = optionalUuid(existing.lead_id);
	if (!existingConversationId || existingConversationId !== requestedConversationId) {
	  throw new Error("whatsapp_message_conversation_identity_conflict");
	}
	if (existingLeadId && existingLeadId !== eventLeadId) {
	  throw new Error("whatsapp_message_lead_identity_conflict");
	}
	if (!eventLeadId && existingLeadId) {
	  throw new Error("whatsapp_message_quarantine_identity_conflict");
	}
    const update = captureSuppressed
      ? {
        lead_id: existingLeadId || eventLeadId,
        capture_state: "suppressed",
        media_url: null,
        media_mime_type: null,
        media_storage_path: null,
        media_status: null,
        media_error: null,
        media_size: null,
        sender_jid: null,
        sender_name: null,
        sender_user_id: null,
        reaction_to_message_id: null,
        reaction_emoji: null,
        reaction_sender_jid: null,
        reaction_sender_name: null,
        // Never copy content/raw/referral from a retry. This also repairs a row
        // written by an interrupted older invocation before doing more work.
        content: null,
        metadata: redactedSuppressedMessageMetadata(
          existing.metadata,
          message.messageId,
          captureDecision,
        ),
        updated_at: undefined,
      }
      : {
        // Provider replay is immutable identity-wise. A legacy NULL may be
        // filled only with the event's ledgered card; a non-NULL identity is
        // never moved to another conversation/card.
        lead_id: existingLeadId || eventLeadId,
        metadata: pendingEvolutionGoEffectMetadata({
          ...(isRecord(existing.metadata) ? existing.metadata : {}),
          source: "evolution_go_webhook",
          whatsapp_attendance_capture: captureAudit,
          ...(leadResolutionQuarantineReason
            ? {
              lead_resolution_quarantine: {
                reason: leadResolutionQuarantineReason,
                terminal: true,
                retryable: false,
                recorded_at: new Date().toISOString(),
              },
            }
            : {}),
          whatsapp_attribution: whatsappAttribution(message),
          whatsapp_referral: message.referral,
          raw: message.raw,
        }, message.messageId),
        media_storage_path: mediaStoragePath || existing.media_storage_path || null,
        media_status: mediaStatus || existing.media_status || null,
        media_error: mediaStoragePath ? null : (mediaError || existing.media_error || null),
        updated_at: undefined,
      };
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .update(update)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return { inserted: false, message: data };
  }

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return { inserted: true, message: data };
}

async function completeStoredMessageEffects(
  session: JsonRecord,
  storedMessage: JsonRecord | null,
  providerMessageId: string,
) {
  if (!storedMessage?.id) throw new Error("Stored message is missing");
  if (persistedWhatsAppMessageCaptureState(storedMessage) === "suppressed") {
    await redactSuppressedStoredMessage(
      session,
      storedMessage,
      providerMessageId,
      null,
      true,
    );
    return;
  }
  const metadata = completedEvolutionGoEffectMetadata(
    storedMessage.metadata,
    providerMessageId,
  );
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .update({ metadata })
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", storedMessage.id)
    .eq("message_id", providerMessageId)
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    throw error || new Error("Stored message effect completion lost ownership");
  }
}

async function markMessageDeleted(session: JsonRecord, message: ReturnType<typeof normalizeMessage>) {
  if (!message?.deletedMessageId) return false;

  const { data: target, error: targetError } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, lead_id, message_id, sent_at, capture_state, metadata")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("message_id", message.deletedMessageId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return false;

  const deletedAt = new Date().toISOString();
  if (persistedWhatsAppMessageCaptureState(target) === "suppressed") {
    const safeBase = await redactSuppressedStoredMessage(
      session,
      target,
      message.deletedMessageId,
    );
    const { error: suppressedDeleteError } = await supabase
      .from("whatsapp_messages")
      .update({
        message_type: "deleted",
        metadata: {
          ...(isRecord(safeBase.metadata) ? safeBase.metadata : {}),
          deleted: true,
          deleted_at: deletedAt,
          // Provider identity is operational; raw deletion payload is never
          // retained for a suppressed target.
          deletion_event: { message_id: message.messageId },
        },
      })
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", target.id)
      .eq("capture_state", "suppressed");
    if (suppressedDeleteError) throw suppressedDeleteError;
    return true;
  }
  const originalMetadata = isRecord(target.metadata) ? target.metadata : {};
  const { error: updateError } = await supabase
    .from("whatsapp_messages")
    .update({
      content: "Esta mensagem foi apagada",
      message_type: "deleted",
      media_url: null,
      media_storage_path: null,
      media_status: null,
      media_error: null,
      media_mime_type: null,
      media_size: null,
      metadata: {
        ...originalMetadata,
        deleted: true,
        deleted_at: deletedAt,
        deletion_event: {
          message_id: message.messageId,
          raw: message.raw,
        },
      },
    })
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", target.id);
  if (updateError) throw updateError;

  if (target.sent_at) {
    let conversationUpdate = supabase
      .from("whatsapp_conversations")
      .update({
        last_message: "Esta mensagem foi apagada",
        last_message_preview: "Esta mensagem foi apagada",
        updated_at: deletedAt,
      })
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", target.conversation_id)
      .eq("last_message_at", target.sent_at);
    conversationUpdate = target.lead_id
      ? conversationUpdate.eq("lead_id", target.lead_id)
      : conversationUpdate.is("lead_id", null);
    const { error: conversationError } = await conversationUpdate;
    if (conversationError) throw conversationError;
  }

  return true;
}

async function updateConversationAfterMessage(
  session: JsonRecord,
  conversation: JsonRecord,
  expectedLeadId: string | null,
  normalized: ReturnType<typeof normalizeMessage>,
) {
  if (!normalized || normalized.messageType === "reaction") {
    return await isConversationLeadBindingCurrent(session, conversation.id, expectedLeadId);
  }
  const effectKey = await evolutionGoEffectFingerprint(
    session.organization_id,
    session.id,
    normalized.messageId,
    "conversation_unread",
  );
  let current = conversation;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    if (optionalUuid(current.lead_id) !== expectedLeadId) return false;
    if (hasConversationUnreadEffect(current.metadata, effectKey)) return true;
    if (
      conversationUnreadEffectCount(current.metadata) >=
        EVOLUTION_GO_UNREAD_LEDGER_LIMIT
    ) {
      // At capacity, absence is ambiguous: the key might have been evicted by
      // an older implementation. Fail closed instead of incrementing twice.
      throw new Error("Conversation webhook effect ledger is saturated");
    }
    const currentLastAt = Date.parse(normalizeText(current.last_message_at));
    const messageAt = Date.parse(normalized.sentAt);
    const shouldAdvancePreview = !Number.isFinite(currentLastAt) ||
      !Number.isFinite(messageAt) || currentLastAt <= messageAt;
    const previousUpdatedAt = normalizeText(current.updated_at).trim();
    const candidateUpdatedAt = new Date().toISOString();
    const updatedAt = previousUpdatedAt && candidateUpdatedAt <= previousUpdatedAt
      ? new Date(Date.parse(previousUpdatedAt) + 1).toISOString()
      : candidateUpdatedAt;
    const update: JsonRecord = {
      metadata: appendConversationUnreadEffect(current.metadata, effectKey),
      unread_count: normalized.fromMe
        ? Number(current.unread_count || 0)
        : Number(current.unread_count || 0) + 1,
      updated_at: updatedAt,
    };
    if (shouldAdvancePreview) {
      update.last_message = previewForMessage(normalized);
      update.last_message_preview = previewForMessage(normalized);
      update.last_message_at = normalized.sentAt;
    }

    let updateQuery = supabase
      .from("whatsapp_conversations")
      .update(update)
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", current.id);
    updateQuery = expectedLeadId
      ? updateQuery.eq("lead_id", expectedLeadId)
      : updateQuery.is("lead_id", null);
    updateQuery = previousUpdatedAt
      ? updateQuery.eq("updated_at", previousUpdatedAt)
      : updateQuery.is("updated_at", null);
    const { data, error } = await updateQuery
      .select("*")
      .maybeSingle();
    if (error) throw error;
    if (data?.id) return true;

    const { data: refreshed, error: refreshError } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", current.id)
      .maybeSingle();
    if (refreshError) throw refreshError;
    if (!refreshed) throw new Error("Conversation disappeared during webhook processing");
    if (optionalUuid(refreshed.lead_id) !== expectedLeadId) return false;
    current = refreshed;
  }
  throw new Error("Conversation webhook effect remained contended");
}

async function isConversationLeadBindingCurrent(
  session: JsonRecord,
  conversationId: unknown,
  expectedLeadId: string | null,
) {
  let query = supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("id", conversationId);
  query = expectedLeadId
    ? query.eq("lead_id", expectedLeadId)
    : query.is("lead_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return Boolean(data?.id);
}

async function releaseConversationMessageEffect(
  session: JsonRecord,
  conversationId: string,
  providerMessageId: string,
) {
  const effectKey = await evolutionGoEffectFingerprint(
    session.organization_id,
    session.id,
    providerMessageId,
    "conversation_unread",
  );

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { data: current, error: readError } = await supabase
      .from("whatsapp_conversations")
      .select("id, metadata, updated_at")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", conversationId)
      .maybeSingle();
    if (readError) throw readError;
    if (!current) throw new Error("Conversation effect ledger target disappeared");
    if (!hasConversationUnreadEffect(current.metadata, effectKey)) return;

    const previousUpdatedAt = normalizeText(current.updated_at).trim();
    const candidateUpdatedAt = new Date().toISOString();
    const updatedAt = previousUpdatedAt && candidateUpdatedAt <= previousUpdatedAt
      ? new Date(Date.parse(previousUpdatedAt) + 1).toISOString()
      : candidateUpdatedAt;
    let updateQuery = supabase
      .from("whatsapp_conversations")
      .update({
        metadata: removeConversationUnreadEffect(current.metadata, effectKey),
        updated_at: updatedAt,
      })
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("id", conversationId);
    updateQuery = previousUpdatedAt
      ? updateQuery.eq("updated_at", previousUpdatedAt)
      : updateQuery.is("updated_at", null);
    const { data, error } = await updateQuery.select("id").maybeSingle();
    if (error) throw error;
    if (data?.id) return;
  }
  throw new Error("Conversation webhook effect cleanup remained contended");
}

async function logInbound(session: JsonRecord, conversation: JsonRecord, lead: JsonRecord | null, rule: JsonRecord | null, message: ReturnType<typeof normalizeMessage>) {
  if (!message || message.fromMe || message.isGroup || message.messageType === "reaction") return;
  const logId = await deterministicEvolutionGoEffectId(
    session.organization_id,
    session.id,
    message.messageId,
    "inbound_log",
  );
  const managedMessageDistribution = rule?.__managed_whatsapp_message_distribution === true;
  const messageFingerprint = await sha256Hex(
    `${session.organization_id}\u001f${session.id}\u001f${message.messageId}\u001f${message.content || ""}`,
  );
  const details = {
    remote_jid: conversation.remote_jid || message.remoteJid,
    message_id: message.messageId,
    match_field: rule?.match_field || null,
    match_value: rule?.match_value || null,
    managed_whatsapp_message_distribution: managedMessageDistribution,
    target_round_robin_id: managedMessageDistribution ? (rule?.target_round_robin_id || null) : null,
    message_fingerprint: messageFingerprint,
    campaign_label: campaignLabelForMessage(message, rule, false),
    whatsapp_attribution: whatsappAttribution(message),
    property_code: detectPropertyCode(message, false),
  };
  const { data: existing, error: lookupError } = await supabase
    .from("whatsapp_inbound_logs")
    .select("id, lead_id, matched_rule_id, assigned_user_id, match_details")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("conversation_id", conversation.id)
    .eq("match_details->>message_id", message.messageId)
    .limit(1)
    .maybeSingle();
  if (lookupError) throw lookupError;

  if (existing?.id) {
	const existingLeadId = optionalUuid(existing.lead_id);
	const eventLeadId = optionalUuid(lead?.id);
	if (existingLeadId && existingLeadId !== eventLeadId) {
	  throw new Error("whatsapp_inbound_log_lead_identity_conflict");
	}
    const nonNullDetails = Object.fromEntries(
      Object.entries(details).filter(([, value]) => value !== null && value !== undefined),
    );
    const { error: updateError } = await supabase
      .from("whatsapp_inbound_logs")
      .update({
		lead_id: existingLeadId || eventLeadId,
        matched_rule_id: existing.matched_rule_id || rule?.id || null,
        assigned_user_id: existing.assigned_user_id || lead?.assigned_user_id || null,
        match_details: {
          ...(isRecord(existing.match_details) ? existing.match_details : {}),
          ...nonNullDetails,
        },
      })
      .eq("id", existing.id);
    if (updateError) throw updateError;
    return;
  }

  const { error } = await supabase.from("whatsapp_inbound_logs").insert({
    id: logId,
    organization_id: session.organization_id,
    session_id: session.id,
    conversation_id: conversation.id,
    lead_id: lead?.id || null,
    matched_rule_id: rule?.id || null,
    assigned_user_id: lead?.assigned_user_id || null,
    match_details: details,
  });
  const insertError = error;
  if (insertError && isUniqueViolation(insertError, "whatsapp_inbound_logs_pkey")) return;
  if (insertError) throw insertError;
}

async function triggerAutoReply(
  session: JsonRecord,
  conversation: JsonRecord,
  storedMessage: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
  expectedLeadId: string,
) {
  if (
    !message || message.fromMe || message.isGroup ||
    message.messageType === "reaction" || !storedMessage?.id
  ) return;
  if (!message.content || !String(message.content).trim()) return;
  if (!VIMOB_API_URL || !AI_AUTOREPLY_TOKEN) {
    throw new Error("AI auto-reply service is not configured");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${VIMOB_API_URL.replace(/\/$/, "")}/v1/internal/whatsapp/auto-reply`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Token": AI_AUTOREPLY_TOKEN,
      },
      body: JSON.stringify({
        organizationId: session.organization_id,
        sessionId: session.id,
        conversationId: conversation.id,
        messageId: storedMessage.id,
        expectedLeadId,
        providerMessageId: message.messageId,
        text: message.content,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`AI auto-reply request failed with status ${response.status}`);
    } else {
      const body = await response.json().catch(() => null);
      if (body?.skipped) {
        console.warn("AI auto-reply skipped", body.reason || "unknown_reason");
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

type AuthorizedEvolutionGoWebhook = Extract<
  EvolutionGoWebhookAuthorization,
  { authorized: true }
>;

async function handleMessages(
  session: JsonRecord,
  payload: any,
  event: string,
  authorization: AuthorizedEvolutionGoWebhook,
) {
  let messages = extractMessages(payload);
  if (messages.length > 0 && authorization.contract !== "internal_worker_lease") {
    // Message callbacks must enter through the Go API, which captures routing
    // provenance in the same transaction as the durable inbox insert. Edge
    // cannot provide that atomicity for a direct provider request, so it
    // returns a retryable failure instead of acknowledging weaker provenance.
    throw new Error("whatsapp_durable_ingress_required");
  }
  if (messages.length > 1) {
    messages = orderMessagesByIngressRoutingSnapshot(payload, session, messages, authorization);
  }
  let processed = 0;
  let duplicates = 0;
  let inProgress = 0;

  for (const { rawMessage, envelope } of messages) {
    const message = normalizeMessage(rawMessage, envelope);
    if (!message) throw new Error("Unsupported message-like Evolution payload");
    if (message.messageType === "reaction" && !message.reactionToMessageId) {
      throw new Error("Evolution reaction is missing its target message");
    }
    const messageIdentity = whatsappIdentityForMessage(message);
    const diagnosticRemoteJid = messageIdentity.remoteJid || message.remoteJid;
    let ownedClaim: OwnedEvolutionMessageClaim | null = null;
    if (authorization.contract !== "internal_worker_lease") {
      const deliveryClaim = await claimEvolutionMessageDelivery(supabase, {
        organizationId: session.organization_id,
        sessionId: session.id,
        providerInstanceId: normalizeText(firstPresent(
          session.provider_instance_id,
          session.instance_id,
          session.instance_name,
        )) || null,
        providerMessageId: message.messageId,
        eventType: event || "messages.upsert",
        providerPayload: {
          event: event || "messages.upsert",
          instance: firstPresent(
            session.provider_instance_id,
            session.instance_id,
            session.instance_name,
          ),
          data: rawMessage,
        },
      });
      if (deliveryClaim.outcome === "duplicate") {
        duplicates += 1;
        continue;
      }
      if (deliveryClaim.outcome === "in_progress") {
        inProgress += 1;
        continue;
      }
      if (deliveryClaim.outcome === "dead") {
        throw new Error("Evolution message delivery is dead-lettered");
      }
      ownedClaim = deliveryClaim;
    }

    try {
      if (message.messageType === "deleted_event") {
        if (!(await markMessageDeleted(session, message))) {
          throw new Error("Evolution deletion target is not available yet");
        }
        if (ownedClaim) {
          await completeEvolutionMessageDelivery(supabase, ownedClaim);
        }
        processed += 1;
        continue;
      }

      let storedBeforeProcessing = await findStoredMessage(session, message);
      if (storedBeforeProcessing) {
        const state = storedEvolutionGoEffectState(
          storedBeforeProcessing.metadata,
          message.messageId,
        );
        if (state === "completed") {
          if (persistedWhatsAppMessageCaptureState(storedBeforeProcessing) === "suppressed") {
            storedBeforeProcessing = await redactSuppressedStoredMessage(
              session,
              storedBeforeProcessing,
              message.messageId,
              null,
              true,
            );
          }
          await reconcileHandledWhatsAppMessageTransport(session, message);
          if (storedBeforeProcessing.conversation_id) {
            await releaseConversationMessageEffect(
              session,
              storedBeforeProcessing.conversation_id,
              message.messageId,
            );
          }
          if (ownedClaim) {
            await completeEvolutionMessageDelivery(supabase, ownedClaim);
          }
          duplicates += 1;
          continue;
        }
        if (state !== "pending") {
          // Rows created before this ledger cannot prove whether unread, CRM
          // attribution, or auto-reply already ran. Never guess and duplicate
          // those effects; keep the durable caller retrying for remediation.
          throw new Error("Stored Evolution message has no recoverable effect ledger");
        }
      }

      const providerEventBinding = await findWhatsAppProviderEventBinding(session, message);
      const storedConversationId = optionalUuid(storedBeforeProcessing?.conversation_id);
      const storedLeadId = optionalUuid(storedBeforeProcessing?.lead_id);
      const ingressRoutingSnapshot = ingressRoutingSnapshotForMessage(
        payload,
        session,
        message,
        authorization,
      );
      let inheritedRoutingTarget: WhatsAppInheritedRoutingTarget | null = null;
      let inheritedRoutingQuarantineReason: string | null = null;
      if (
        ingressRoutingSnapshot?.targetMode === "inherit_predecessor"
        && !providerEventBinding
        && !storedLeadId
      ) {
        inheritedRoutingTarget = await resolveWhatsAppInheritedRoutingTarget(
          session,
          ingressRoutingSnapshot,
        );
        if (!inheritedRoutingTarget.ready) {
          inheritedRoutingQuarantineReason = inheritedRoutingTarget.reason;
        } else if (
          ingressRoutingSnapshot.conversationId
          && ingressRoutingSnapshot.conversationId !== inheritedRoutingTarget.conversationId
        ) {
          throw new Error("whatsapp_inherited_target_conversation_conflict");
        }
      }
      if (
        providerEventBinding
        && (
          (storedConversationId && storedConversationId !== providerEventBinding.conversationId)
          || (storedLeadId && storedLeadId !== providerEventBinding.leadId)
        )
      ) {
        throw new Error("whatsapp_provider_event_persistence_identity_conflict");
      }
      if (
        ingressRoutingSnapshot
        && (
          (providerEventBinding && (
            (ingressRoutingSnapshot.conversationId
              && providerEventBinding.conversationId !== ingressRoutingSnapshot.conversationId)
            || (ingressRoutingSnapshot.eventLeadId
              && providerEventBinding.leadId !== ingressRoutingSnapshot.eventLeadId)
          ))
          || (storedConversationId && ingressRoutingSnapshot.conversationId
            && storedConversationId !== ingressRoutingSnapshot.conversationId)
          || (storedLeadId && ingressRoutingSnapshot.eventLeadId
            && storedLeadId !== ingressRoutingSnapshot.eventLeadId)
        )
      ) {
        throw new Error("whatsapp_ingress_snapshot_persistence_identity_conflict");
      }

      // Freeze the physical conversation's binding version before any lead or
      // routing resolution. The later row-locked CAS records a losing event as
      // historical instead of letting a slow webhook undo a newer relink.
      const conversationBindingSnapshot = ingressRoutingSnapshot || ((
        !message.fromMe
        && !message.isGroup
        && message.messageType !== "reaction"
      )
        ? await captureWhatsAppConversationBindingSnapshot(
          session,
          message,
          storedConversationId || providerEventBinding?.conversationId,
        )
        : {
            conversationId: null,
            currentLeadId: null,
            activeBindingId: null,
            leadResolutionQuarantineReason: null,
          });

      let rule: JsonRecord | null = null;
      let lead: JsonRecord | null = null;
      let managedRuleMatched = false;
      let managedEntryWasPending = false;
      let managedEntryAlreadyHandled = false;
      let leadResolutionQuarantineReason: string | null =
        terminalLeadResolutionQuarantineReason(storedBeforeProcessing?.metadata)
        || conversationBindingSnapshot.leadResolutionQuarantineReason
        || inheritedRoutingQuarantineReason;
      const confirmedCtwaAd = isConfirmedClickToWhatsAppAd(message);
      const isReactionEvent = message.messageType === "reaction";
      if (!message.fromMe && !message.isGroup && !isReactionEvent && !leadResolutionQuarantineReason) {
        let managedEntryLookup: JsonRecord | null = null;
        try {
          managedEntryLookup = await lookupManagedWhatsAppLeadEntry(session, message);
        } catch (error) {
          console.warn("[evolution-go-webhook] managed intake lookup failed; durable delivery will retry", {
            session_id: session.id,
            remote_jid: diagnosticRemoteJid,
            error: redactLogText(error),
          });
          throw error;
        }
        if (
          ingressRoutingSnapshot
          && managedEntryLookup
          && (managedEntryLookup.handled === true || managedEntryLookup.pending === true)
        ) {
          const lookupLeadId = optionalUuid(managedEntryLookup.lead_id);
          const lookupRuleId = optionalUuid(managedEntryLookup.matched_rule_id);
          const lookupQueueId = optionalUuid(managedEntryLookup.target_round_robin_id);
          if (
            (lookupLeadId && lookupLeadId !== ingressRoutingSnapshot.eventLeadId)
            || (lookupRuleId && lookupRuleId !== ingressRoutingSnapshot.ruleId)
            || (lookupQueueId && lookupQueueId !== ingressRoutingSnapshot.originRoundRobinId)
          ) {
            throw new Error("whatsapp_ingress_snapshot_managed_ledger_conflict");
          }
        }

        if (managedEntryLookup?.handled === true) {
          if (managedEntryLookup.legacy_non_managed_retry === true) {
            await recoverPersistedNonManagedWhatsAppMessage(session, managedEntryLookup, message);
          } else {
            await enrichManagedWhatsAppLeadEntryAttribution(
              session,
              optionalUuid(managedEntryLookup.lead_id),
              message,
              { allowMissing: true },
            );
          }
          await reconcileHandledWhatsAppMessageTransport(session, message);
          if (managedEntryLookup.legacy_non_managed_retry === true || !storedBeforeProcessing) {
            if (storedBeforeProcessing) {
              await completeStoredMessageEffects(session, storedBeforeProcessing, message.messageId);
              if (storedBeforeProcessing.conversation_id) {
                await releaseConversationMessageEffect(
                  session,
                  storedBeforeProcessing.conversation_id,
                  message.messageId,
                );
              }
            }
            if (ownedClaim) {
              await completeEvolutionMessageDelivery(supabase, ownedClaim);
            }
            processed += 1;
            continue;
          }

          managedEntryAlreadyHandled = true;
          rule = {
            id: managedEntryLookup.matched_rule_id,
            session_id: session.id,
            target_round_robin_id: managedEntryLookup.target_round_robin_id,
            __managed_whatsapp_message_distribution: true,
          };
          managedRuleMatched = true;
          try {
            lead = await loadPendingManagedWhatsAppLead(session, managedEntryLookup);
          } catch (error) {
            console.warn("[evolution-go-webhook] handled managed lead lookup failed; durable delivery will retry", {
              session_id: session.id,
              remote_jid: diagnosticRemoteJid,
              error: redactLogText(error),
            });
            throw error;
          }
        } else if (managedEntryLookup?.pending === true) {
          managedEntryWasPending = true;
          rule = {
            id: managedEntryLookup.matched_rule_id,
            session_id: session.id,
            target_round_robin_id: managedEntryLookup.target_round_robin_id,
            __managed_whatsapp_message_distribution: true,
          };
          managedRuleMatched = true;
          try {
            lead = await loadPendingManagedWhatsAppLead(session, managedEntryLookup);
          } catch (error) {
            console.warn("[evolution-go-webhook] pending managed lead lookup failed; durable delivery will retry", {
              session_id: session.id,
              remote_jid: diagnosticRemoteJid,
              error: redactLogText(error),
            });
            throw error;
          }
        } else {
          if (ingressRoutingSnapshot) {
            managedRuleMatched = ingressRoutingSnapshot.managedMessageDistribution;
            managedEntryWasPending = ingressRoutingSnapshot.managedEventPending;
            managedEntryAlreadyHandled = ingressRoutingSnapshot.managedEventHandled;
            rule = ingressRoutingSnapshot.contextKind === "contextual_intake"
              ? {
                  id: ingressRoutingSnapshot.ruleId,
                  session_id: session.id,
                  target_round_robin_id: ingressRoutingSnapshot.originRoundRobinId,
                  __managed_whatsapp_message_distribution: managedRuleMatched,
                }
              : null;
          } else {
            try {
              rule = await findInboundRule(session, message);
              managedRuleMatched = Boolean(rule?.__managed_whatsapp_message_distribution);
            } catch (error) {
              console.warn("[evolution-go-webhook] inbound rule lookup failed; durable delivery will retry", {
                session_id: session.id,
                remote_jid: diagnosticRemoteJid,
                error: redactLogText(error),
              });
              throw error;
            }
          }

          if (managedRuleMatched || confirmedCtwaAd) {
            // Keep invalid new provider events outside every lead/conversation/log
            // write for both managed and owner-fallback CTWA intake. Pending or
            // completed managed events were recovered above from immutable
            // database provenance and therefore are not revalidated here.
            validateNewWhatsAppLeadProviderEvent(message);
          }

          try {
            lead = await ensureLead(
              session,
              message,
              rule,
              managedRuleMatched,
              conversationBindingSnapshot.currentLeadId,
              providerEventBinding?.leadId
                || inheritedRoutingTarget?.leadId
                || ingressRoutingSnapshot?.eventLeadId,
              ingressRoutingSnapshot,
            );
            if (isQuarantinedWhatsAppLeadResolution(lead)) {
              leadResolutionQuarantineReason = cleanText(lead.__whatsapp_lead_resolution_reason)
                || "whatsapp_lead_resolution_ambiguous";
              lead = null;
            }
          } catch (error) {
            console.warn("[evolution-go-webhook] lead resolution failed; durable delivery will retry", {
              session_id: session.id,
              remote_jid: diagnosticRemoteJid,
              error: redactLogText(error),
            });
            throw error;
          }
        }
      }

      let conversation = await ensureConversation(
        session,
        message,
        lead,
        storedConversationId
          || providerEventBinding?.conversationId
          || inheritedRoutingTarget?.conversationId
          || ingressRoutingSnapshot?.conversationId,
        leadResolutionQuarantineReason,
      );
      const conversationAliasQuarantineReason = cleanText(
        conversation.__whatsapp_identity_alias_quarantine_reason,
      );
      if (conversationAliasQuarantineReason) {
        leadResolutionQuarantineReason = conversationAliasQuarantineReason;
        lead = null;
      }
      let eventLeadId = storedLeadId
        || providerEventBinding?.leadId
        || ingressRoutingSnapshot?.eventLeadId
        || null;
      let bindingResultIsCurrent: boolean | null = null;
      // Every inbound one-to-one event with a resolved card gets an immutable
      // provider ledger row, even when the target equals the current binding.
      // A retry can therefore recover the original card without inheriting a
      // later mutable conversation owner.
      if (lead?.id) {
        const binding = await activateWhatsAppConversationLeadBinding(
          session,
          conversation,
          lead,
          message,
          conversationBindingSnapshot,
        );
        conversation = binding.conversation;
        if (eventLeadId && eventLeadId !== binding.eventLeadId) {
          throw new Error("whatsapp_message_binding_ledger_identity_conflict");
        }
        eventLeadId = binding.eventLeadId;
        bindingResultIsCurrent = binding.isCurrent;
      }
      if (!eventLeadId && !leadResolutionQuarantineReason) {
        eventLeadId = optionalUuid(lead?.id || (ingressRoutingSnapshot ? null : conversation.lead_id));
      }
      if (leadResolutionQuarantineReason) {
        // Terminal routing evidence is retained without a dangling or guessed
        // card FK. This includes a card deleted after the pre-ACK snapshot.
        eventLeadId = null;
      }
      const activeConversationLeadId = optionalUuid(conversation.lead_id);
      let eventBindingIsCurrent = bindingResultIsCurrent ?? (eventLeadId
        ? eventLeadId === activeConversationLeadId
        : !activeConversationLeadId);
      if (
        ingressRoutingSnapshot
        && ingressRoutingSnapshot.state === "unlinked"
        && activeConversationLeadId
        && !leadResolutionQuarantineReason
      ) {
        // The physical row was linked after this provider event was accepted.
        // Persist neutral evidence, but never let the old event inherit or
        // trigger effects for the new card.
        leadResolutionQuarantineReason = "whatsapp_ingress_unlinked_after_binding_change";
        eventBindingIsCurrent = false;
      }
      const attachedLead = eventLeadId
        ? (optionalUuid(lead?.id) === eventLeadId ? lead : { id: eventLeadId })
        : null;
      const captureDecision = await resolveWhatsAppAttendanceCapture(
        session,
        conversation,
        eventLeadId,
        eventBindingIsCurrent,
        ingressRoutingSnapshot,
        message,
        lead,
        storedBeforeProcessing,
      );
      const captureSuppressed = captureDecision.captureState === "suppressed";
      // Persist the selected rule before the message write. A managed retry can
      // then recover the immutable lead and queue context after later failures.
      if (!leadResolutionQuarantineReason && eventBindingIsCurrent) {
        await logInbound(session, conversation, attachedLead, rule, message);
      }
      const result = await insertMessage(
        session,
        conversation,
        attachedLead,
        message,
        captureDecision,
        leadResolutionQuarantineReason,
        eventBindingIsCurrent,
      );
      if (!result.message?.id) throw new Error("Evolution message was not stored");
      const persistedState = storedEvolutionGoEffectState(
        result.message.metadata,
        message.messageId,
      );
      if (persistedState === "completed") {
        await releaseConversationMessageEffect(
          session,
          result.message.conversation_id || conversation.id,
          message.messageId,
        );
        if (ownedClaim) {
          await completeEvolutionMessageDelivery(supabase, ownedClaim);
        }
        duplicates += 1;
        continue;
      }
      if (persistedState !== "pending") {
        throw new Error("Evolution message effect ledger is invalid");
      }

      if (leadResolutionQuarantineReason || !eventBindingIsCurrent) {
        // Quarantine remains NULL-lead evidence; a CAS-losing or historical
        // provider event remains attached to its immutable event card. Neither
        // may touch the current preview, unread, logs, media/CRM attribution,
        // distribution, automations, or AI for the active card.
        await completeStoredMessageEffects(session, result.message, message.messageId);
        await releaseConversationMessageEffect(
          session,
          result.message.conversation_id || conversation.id,
          message.messageId,
        );
        if (ownedClaim) {
          await completeEvolutionMessageDelivery(supabase, ownedClaim);
        }
        processed += 1;
        continue;
      }

      if (!captureSuppressed) {
        eventBindingIsCurrent = eventBindingIsCurrent
          && await updateConversationAfterMessage(session, conversation, eventLeadId, message);
      }
      if (managedRuleMatched && !attachedLead?.id) {
        throw new Error("managed_whatsapp_lead_identity_unresolved");
      }
      const managedMessageDistribution = managedRuleMatched
        && Boolean(attachedLead?.is_managed_whatsapp_message_distribution);
      const shouldPersistAttribution = confirmedCtwaAd && (
        result.inserted
        || (managedMessageDistribution && managedEntryWasPending)
      );

      if (shouldPersistAttribution && !isReactionEvent) {
        await upsertLeadMetaAttribution(session, conversation, attachedLead, message);
        if (!managedMessageDistribution && result.inserted) {
          await logLeadEntryAttribution(session, conversation, attachedLead, message);
        }
        await logCreativeActivity(session, conversation, attachedLead, message);
      }

      let autoReplyTriggered = false;
      if (
        !captureSuppressed
        && eventBindingIsCurrent
        && eventLeadId
        && result.inserted
        && !managedMessageDistribution
        && !isReactionEvent
      ) {
        await triggerAutoReply(session, conversation, result.message, message, eventLeadId);
        autoReplyTriggered = true;
      }

      if (managedMessageDistribution) {
        if (!managedEntryAlreadyHandled || managedEntryWasPending) {
          await processManagedWhatsAppLeadEntry(
            session,
            attachedLead,
            rule,
            message,
            captureSuppressed,
          );
        }
        await enrichManagedWhatsAppLeadEntryAttribution(session, attachedLead?.id, message);
      }
      // Keep the local durability contract: the API request is awaited and its
      // idempotent queue write must succeed before the message ledger is final.
      if (!captureSuppressed && eventBindingIsCurrent && eventLeadId && !autoReplyTriggered) {
        await triggerAutoReply(session, conversation, result.message, message, eventLeadId);
      }
      await completeStoredMessageEffects(
        session,
        result.message,
        message.messageId,
      );
      await releaseConversationMessageEffect(
        session,
        result.message.conversation_id || conversation.id,
        message.messageId,
      );
      if (ownedClaim) {
        await completeEvolutionMessageDelivery(supabase, ownedClaim);
      }
      processed += 1;
    } catch (error) {
      if (ownedClaim) {
        try {
          await retryEvolutionMessageDelivery(supabase, ownedClaim);
        } catch {
          console.error("evolution-go-webhook failed to release direct delivery");
        }
      }
      throw error;
    }
  }

  return { processed, duplicates, inProgress };
}

function statusFromProvider(value: unknown) {
  const raw = normalizeText(value).toLowerCase();
  if (["3", "4", "read", "played"].includes(raw)) return "read";
  if (["2", "delivered", "delivery", "device_ack", "deviceack"].includes(raw)) return "delivered";
  if (["1", "sent", "server_ack", "serverack"].includes(raw)) return "sent";
  if (["0", "queued", "pending"].includes(raw)) return "pending";
  if (["-1", "failed", "error"].includes(raw)) return "failed";
  return null;
}

async function handleMessageStatus(session: JsonRecord, payload: any) {
  const data = payload?.data || payload?.Data || payload;
  const entries = [
    ...toArray(data?.statuses),
    ...toArray(data?.status),
    ...toArray(data?.receipts),
    data,
  ].filter(isRecord);

  let updated = 0;
  for (const entry of entries) {
    const messageIds = unique([
      ...toArray(firstPresent(entry.MessageIDs, entry.messageIds, entry.message_ids)),
      firstPresent(entry.messageId, entry.message_id, entry.id, entry.ID, entry.key?.id, entry.Key?.ID),
    ].map((value) => normalizeText(value)).filter(Boolean));
    const status = statusFromProvider(firstPresent(
      entry.status,
      entry.Status,
      entry.state,
      entry.State,
      entry.ack,
      entry.Ack,
      entry.type,
      entry.Type,
      payload.state,
      payload.State,
    ));
    if (messageIds.length === 0 || !status) continue;

    const { data: targets, error: targetError } = await supabase
      .from("whatsapp_messages")
      .select("id, message_id, status, delivered_at, read_at")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("message_id", messageIds);
    if (targetError) throw targetError;

    const targetIds = targets
      ?.filter((target: JsonRecord) => (
        normalizeText(target.status).toLowerCase() !== status
        && monotonicMessageStatus(target.status, status) === status
      ))
      .map((target: JsonRecord) => target.id);
    const receiptAt = new Date().toISOString();
    const failureReason = normalizeText(firstPresent(entry.error, entry.message, "Falha no envio"));

    const update: JsonRecord = { status };
    if (status === "delivered") update.delivered_at = receiptAt;
    if (status === "read") update.read_at = receiptAt;

    if (targetIds?.length) {
      const { error } = await supabase
        .from("whatsapp_messages")
        .update(update)
        .eq("organization_id", session.organization_id)
        .eq("session_id", session.id)
        .in("id", targetIds);
      if (error) throw error;
    }

    const { data: outboxTargets, error: outboxTargetError } = await supabase
      .from("whatsapp_outbox")
      .select("id, provider_message_id, status")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("provider_message_id", messageIds);
    if (outboxTargetError) throw outboxTargetError;

    const outboxTargetIds = outboxTargets
      ?.filter((target: JsonRecord) => (
        normalizeText(target.status).toLowerCase() !== status
        && monotonicOutboxStatus(target.status, status) === status
      ))
      .map((target: JsonRecord) => target.id);

    if (outboxTargetIds?.length) {
      const outboxUpdate: JsonRecord = { status };
      if (status === "sent") outboxUpdate.sent_at = receiptAt;
      if (status === "delivered") outboxUpdate.delivered_at = receiptAt;
      if (status === "read") outboxUpdate.read_at = receiptAt;
      if (status === "failed") {
        outboxUpdate.failed_at = receiptAt;
        outboxUpdate.last_error = failureReason;
      } else if (["sent", "delivered", "read"].includes(status)) {
        outboxUpdate.last_error = null;
      }
      if (["sent", "delivered", "read", "failed"].includes(status)) {
        outboxUpdate.locked_at = null;
        outboxUpdate.locked_by = null;
      }
      const { error: outboxError } = await supabase
        .from("whatsapp_outbox")
        .update(outboxUpdate)
        .eq("organization_id", session.organization_id)
        .eq("session_id", session.id)
        .in("id", outboxTargetIds);
      if (outboxError) throw outboxError;
    }

    const matchedMessageIds = new Set([
      ...(targets || []).map((target: JsonRecord) => normalizeText(target.message_id)),
      ...(outboxTargets || []).map((target: JsonRecord) => normalizeText(target.provider_message_id)),
    ].filter(Boolean));
    const missingMessageIds = messageIds.filter((messageId) => !matchedMessageIds.has(messageId));
    if (missingMessageIds.length > 0) {
      throw new Error(`MESSAGE_STATUS_TARGET_NOT_FOUND:${missingMessageIds.join(",")}`);
    }
    updated += targetIds?.length || 0;
  }
  return updated;
}

async function handleQr(session: JsonRecord, payload: any) {
  const qrcode = extractQr(payload);
  if (!qrcode || !sessionAllowsLifecycleUpdates(session)) return false;

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .update({
      status: "qr_ready",
      qr_code: qrcode,
      advanced_settings: {
        ...(session.advanced_settings || {}),
        qr_code: qrcode,
        qr_updated_at: new Date().toISOString(),
      },
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", session.organization_id)
    .eq("id", session.id)
    .eq("provider", "evolution_go")
    .eq("updated_at", session.updated_at)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data);
}

async function handleConnection(session: JsonRecord, payload: any) {
  if (!sessionAllowsLifecycleUpdates(session)) return null;
  const normalizedStatus = normalizeStatus(payload);
  const raw = payload?.data || payload?.Data || payload;
  const rawState = normalizeText(firstPresent(raw.state, raw.State, raw.connectionStatus, raw.status)).toLowerCase();
  const isErrorState = ["error", "failed", "failure"].includes(rawState);
  if (!normalizedStatus && !isErrorState) return null;
  const jid = firstPresent(raw.jid, raw.JID, raw.phone, raw.Phone, raw.user?.id);
  const update: JsonRecord = {
    updated_at: new Date().toISOString(),
    last_error: isErrorState ? firstPresent(raw.error, raw.message, "Falha na conexao") : null,
  };

  if (normalizedStatus) update.status = normalizedStatus;

  if (normalizedStatus === "connected") {
    update.last_connected_at = new Date().toISOString();
    if (jid) update.phone_number = normalizeDigits(jid);
    update.profile_name = firstPresent(raw.pushName, raw.name, raw.profileName, session.profile_name);
    update.profile_picture = firstPresent(raw.profilePicture, raw.pictureUrl, session.profile_picture);
  }

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .update(update)
    .eq("organization_id", session.organization_id)
    .eq("id", session.id)
    .eq("provider", "evolution_go")
    .eq("updated_at", session.updated_at)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data ? normalizedStatus : null;
}

function extractNamedList(payload: any, names: string[]) {
  const data = payload?.data || payload?.Data || {};
  const values = names.flatMap((name) => [
    payload?.[name],
    payload?.[name[0].toUpperCase() + name.slice(1)],
    data?.[name],
    data?.[name[0].toUpperCase() + name.slice(1)],
  ]);
  return values.flatMap((value) => toArray(value)).filter(isRecord);
}

async function upsertLabels(session: JsonRecord, payload: any) {
  const labels = extractNamedList(payload, ["labels", "label"]);
  let processed = 0;
  for (const label of labels) {
    const remoteLabelId = normalizeText(firstPresent(label.id, label.ID, label.labelId, label.LabelID));
    const name = normalizeText(firstPresent(label.name, label.Name, label.text, label.label));
    if (!remoteLabelId && !name) continue;

    const { data: existing, error: lookupError } = await supabase
      .from("whatsapp_labels")
      .select("id")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("remote_label_id", remoteLabelId || name)
      .maybeSingle();
    if (lookupError) throw lookupError;

    const row = {
      organization_id: session.organization_id,
      session_id: session.id,
      remote_label_id: remoteLabelId || name,
      name: name || remoteLabelId,
      color: normalizeText(firstPresent(label.color, label.hexColor)) || "#FF4529",
      predefined: parseBoolean(label.predefined),
    };

    if (existing) {
      const { error } = await supabase
        .from("whatsapp_labels")
        .update(row)
        .eq("organization_id", session.organization_id)
        .eq("session_id", session.id)
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await supabase.from("whatsapp_labels").insert(row);
      if (error) throw error;
    }
    processed += 1;
  }
  return processed;
}

async function upsertGroups(session: JsonRecord, payload: any) {
  const groups = extractNamedList(payload, ["groups", "group"]);
  let processed = 0;
  for (const group of groups) {
    const groupJid = normalizeJid(firstPresent(group.id, group.jid, group.groupJid, group.remoteJid), true);
    if (!groupJid) continue;

    const row = {
      organization_id: session.organization_id,
      session_id: session.id,
      remote_jid: groupJid,
      group_jid: groupJid,
      name: normalizeText(firstPresent(group.name, group.subject, group.Subject)) || "Grupo WhatsApp",
      subject: normalizeText(firstPresent(group.subject, group.Subject, group.name)) || "Grupo WhatsApp",
      description: normalizeText(firstPresent(group.description, group.desc)) || null,
      picture_url: normalizeText(firstPresent(group.pictureUrl, group.profilePicture, group.avatar)) || null,
      invite_link: normalizeText(firstPresent(group.inviteLink, group.invite_link)) || null,
      participants: Array.isArray(group.participants) ? group.participants : [],
      owner_jid: normalizeJid(firstPresent(group.owner, group.ownerJid), false) || null,
      is_announce: parseBoolean(firstPresent(group.isAnnounce, group.announce)),
      metadata: { raw: group },
    };

    const { error } = await supabase
      .from("whatsapp_groups")
      .upsert(row, { onConflict: "organization_id,session_id,remote_jid" });
    if (error) throw error;
    processed += 1;

    const { error: conversationUpdateError } = await supabase
      .from("whatsapp_conversations")
      .update({
        contact_name: row.name,
        contact_picture: row.picture_url,
      })
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("remote_jid", groupJid)
      .eq("is_group", true);
    if (conversationUpdateError) throw conversationUpdateError;
  }
  return processed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  const authorization = authorizeEvolutionGoWebhookIngress(req, {
    privateWorker: readSupabaseSecretKeyEnvironment(),
    webhookSecret: EVOLUTION_WEBHOOK_SECRET,
    providerApiKey: EVOLUTION_GO_API_KEY,
  });
  if (authorization.authorized === false) {
    const reason = authorization.reason;
    const status = reason === "query_credential_forbidden"
      ? 400
      : reason === "missing_server_secret"
      ? 503
      : reason === "missing_credential" || reason === "missing_session_token"
      ? 401
      : 403;
    return json({ ok: false, error: "Webhook authentication failed" }, status);
  }

  try {
    const url = new URL(req.url);
    const serviceKeyEnvironment = readSupabaseSecretKeyEnvironment();
    const serviceKey = selectSupabaseAdminSecretKey(serviceKeyEnvironment);
    if (!SUPABASE_URL || !serviceKey) {
      return json({ ok: false, error: "Webhook service is unavailable" }, 503);
    }
    // Authentication above is deliberately complete before this privileged
    // client exists or the request body is consumed.
    supabase = createClient(SUPABASE_URL, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const payload = await readBoundedJsonBody<any>(req);
    const event = normalizeText(firstPresent(
      payload.event,
      payload.type,
      payload.action,
      payload.Event,
      payload.data?.event,
    )).trim().toLowerCase().slice(0, 160);
    const resolved = await resolveSession(payload, url);

    if (!resolved.session) {
      const status = resolved.reason === "SESSION_NOT_FOUND"
        ? 404
        : resolved.reason === "AMBIGUOUS_SESSION" ||
            resolved.reason === "CONFLICTING_SESSION_IDS" ||
            resolved.reason === "CONFLICTING_INSTANCE_SIGNALS"
        ? 409
        : 400;
      return json({ ok: false, error: "Webhook session could not be resolved" }, status);
    }

    const binding = validateEvolutionGoSessionBinding(
      req,
      resolved.session,
      resolved.signals,
    );
    if (binding.valid === false) {
      const reason = binding.reason;
      const status = reason === "missing_session_token"
        ? 503
        : reason === "invalid_session_token"
        ? 403
        : 409;
      return json({ ok: false, error: "Webhook session binding failed" }, status);
    }

    const resolvedSessionStatus = normalizeText(resolved.session.status).trim().toLowerCase();
    if (
      resolved.session.is_active === false
      || ["deleted", "disabled"].includes(resolvedSessionStatus)
    ) {
      return json({
        ok: true,
        ignored: true,
        reason: "INACTIVE_SESSION",
        session_id: resolved.session.id,
      });
    }

    const qrUpdated = event.includes("qr") || extractQr(payload) ? await handleQr(resolved.session, payload) : false;
    const connectionStatus = (
      event.includes("connection") ||
      event.includes("connect") ||
      event.includes("logout") ||
      payload.data?.LoggedIn !== undefined ||
      payload.data?.connected !== undefined ||
      payload.LoggedIn !== undefined
    ) ? await handleConnection(resolved.session, payload) : null;

    const labelsProcessed = event.includes("label") ? await upsertLabels(resolved.session, payload) : 0;
    const groupsProcessed = event.includes("group") ? await upsertGroups(resolved.session, payload) : 0;
    const isMessageStatusEvent = event.includes("status") || event.includes("receipt") || event.includes("ack");
    const statusUpdated = isMessageStatusEvent
      ? await handleMessageStatus(resolved.session, payload)
      : 0;
    const messageResult = isMessageStatusEvent
      ? { processed: 0, duplicates: 0, inProgress: 0 }
      : await handleMessages(
        resolved.session,
        payload,
        event,
        authorization,
      );

    return json({
      ok: true,
      session_id: resolved.session.id,
      qrUpdated,
      connectionStatus,
      messagesProcessed: messageResult.processed,
      messageDuplicates: messageResult.duplicates,
      messagesInProgress: messageResult.inProgress,
      statusUpdated,
      labelsProcessed,
      groupsProcessed,
    }, messageResult.inProgress > 0 ? 202 : 200);
  } catch (error) {
    if (error instanceof WebhookRequestBodyError) {
      return json({ ok: false, error: error.code }, error.status);
    }
    console.error("evolution-go-webhook processing failed", {
      name: error instanceof Error ? error.name : "UnknownError",
    });
    return json({ ok: false, error: "Webhook processing failed" }, 500);
  }
});
