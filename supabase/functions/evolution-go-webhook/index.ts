/* eslint-disable @typescript-eslint/no-explicit-any */
// Evolution Go webhook for the Vimob WhatsApp module.
// All writes are scoped by a resolved whatsapp_sessions.id before touching CRM data.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, x-webhook-token, x-evolution-webhook-token, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

declare const EdgeRuntime:
  | {
      waitUntil?: (promise: Promise<unknown>) => void;
    }
  | undefined;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_GO_API_KEY = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
const VIMOB_API_URL = Deno.env.get("VIMOB_API_URL") || Deno.env.get("VIMOB_API_BASE_URL") || "";
const AI_AUTOREPLY_TOKEN = Deno.env.get("AI_AUTOREPLY_TOKEN") || Deno.env.get("INTERNAL_WEBHOOK_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

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
  if (typeof value === "string") return ["true", "1", "yes", "sim"].includes(value.toLowerCase());
  return false;
}

function parseTimestamp(value: unknown) {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number") {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (isRecord(value)) {
    const seconds = firstPresent(value.seconds, value.Seconds, value._seconds);
    if (seconds) return parseTimestamp(Number(seconds));
  }
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
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
  const loggedIn = target.loggedIn === true || target.LoggedIn === true;
  const loggedOut = target.loggedIn === false || target.LoggedIn === false;
  const connected = target.connected === true || target.Connected === true;

  if ((loggedIn || rawState === "open" || rawState === "connected") && !loggedOut) return "connected";
  if (connected || rawState === "qr" || rawState === "qrcode" || extractQr(data)) return "qr_ready";
  if (loggedOut || ["close", "closed", "disconnected", "disconnect", "offline", "logout", "logged_out"].includes(rawState)) {
    return "disconnected";
  }
  return "disconnected";
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
  return {
    sessionId: firstPresent(url.searchParams.get("session_id"), payload.session_id, payload.sessionId, data.session_id, data.sessionId),
    instanceId: firstPresent(
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
    ),
    instanceName: firstPresent(
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
    ),
  };
}

async function resolveSession(payload: any, url: URL) {
  const signals = extractInstanceSignals(payload, url);
  const sessionId = optionalUuid(signals.sessionId);

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

  const filters: string[] = [];
  if (signals.instanceId) filters.push(`instance_id.eq.${signals.instanceId}`, `provider_instance_id.eq.${signals.instanceId}`);
  if (signals.instanceName) filters.push(`instance_name.eq.${signals.instanceName}`, `name.eq.${signals.instanceName}`);

  if (filters.length === 0) return { session: null, reason: "MISSING_SESSION_ID", signals };

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("provider", "evolution_go")
    .or(filters.join(","));

  if (error) throw error;
  if (!data || data.length !== 1) {
    return { session: null, reason: "BLOCKED_STATUS_UPDATE_NO_UNIQUE_SESSION", signals, matches: data?.length || 0 };
  }

  return { session: data[0], reason: null, signals };
}

function validateWebhookAuth(req: Request, url: URL, session: JsonRecord) {
  const expectedWebhookToken = session.advanced_settings?.webhook_token;
  const incomingWebhookToken = firstPresent(
    url.searchParams.get("webhook_token"),
    req.headers.get("x-webhook-token"),
    req.headers.get("x-evolution-webhook-token"),
  );

  if (expectedWebhookToken) {
    return incomingWebhookToken === expectedWebhookToken;
  }

  const incomingKey = firstPresent(
    req.headers.get("apikey"),
    req.headers.get("x-api-key"),
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    url.searchParams.get("apikey"),
  );

  if (EVOLUTION_GO_API_KEY) {
    return incomingKey === EVOLUTION_GO_API_KEY;
  }

  console.warn("Evolution webhook rejected because no session webhook token or provider API key is configured.");
  return false;
}

function validateSessionSignals(session: JsonRecord, signals: JsonRecord) {
  const expected = unique([
    session.instance_id,
    session.instance_name,
    session.provider_instance_id,
    session.name,
  ].map((value) => normalizeText(value)));

  const incoming = unique([
    signals.instanceId,
    signals.instanceName,
  ].map((value) => normalizeText(value)));

  if (incoming.length === 0 || expected.length === 0) return true;
  return incoming.some((value) => expected.includes(value));
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

function extractMessages(payload: any) {
  const data = payload?.data || payload?.Data;
  const candidates = [
    payload?.messages,
    payload?.Messages,
    payload?.message,
    payload?.Message,
    data?.messages,
    data?.Messages,
    data?.message,
    data?.Message,
    data,
    payload,
  ];

  const messages: any[] = [];
  for (const candidate of candidates) {
    for (const item of toArray(candidate)) {
      if (isMessageLike(item)) messages.push(item);
    }
  }

  const seen = new Set<string>();
  return messages.filter((message) => {
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

function firstObject(...values: unknown[]) {
  return values.find(isRecord) as JsonRecord | undefined;
}

function findNestedObject(value: unknown, predicate: (candidate: JsonRecord) => boolean, depth = 0): JsonRecord | null {
  if (!isRecord(value) || depth > 5) return null;
  if (predicate(value)) return value;

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const found = findNestedObject(item, predicate, depth + 1);
        if (found) return found;
      }
      continue;
    }
    const found = findNestedObject(child, predicate, depth + 1);
    if (found) return found;
  }

  return null;
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
  const ctwaClid = cleanText(firstPresent(
    candidate.ctwa_clid,
    candidate.ctwaClid,
    candidate.CTWAClid,
    candidate.click_id,
    candidate.clickId,
  ));
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
  const explicitSourceType = cleanText(firstPresent(candidate.source_type, candidate.sourceType, candidate.SourceType));
  const sourceType = explicitSourceType || (sourceId || sourceUrl || ctwaClid ? "ad" : null);

  if (!sourceUrl && !sourceId && !ctwaClid && !headline && !body && !imageUrl && !videoUrl && !thumbnailUrl) {
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
    explicit_source_type: explicitSourceType,
  };
}

function extractWhatsAppReferral(messageNode: any, message: any, mediaBlock: any) {
  const contextCandidates = [
    message?.referral,
    message?.Referral,
    messageNode?.referral,
    messageNode?.Referral,
    message?.contextInfo,
    message?.ContextInfo,
    messageNode?.contextInfo,
    messageNode?.ContextInfo,
    messageNode?.extendedTextMessage?.contextInfo,
    messageNode?.ExtendedTextMessage?.ContextInfo,
    messageNode?.imageMessage?.contextInfo,
    messageNode?.ImageMessage?.ContextInfo,
    messageNode?.videoMessage?.contextInfo,
    messageNode?.VideoMessage?.ContextInfo,
    mediaBlock?.contextInfo,
    mediaBlock?.ContextInfo,
  ].filter(Boolean);

  for (const candidate of contextCandidates) {
    const normalizedDirect = normalizeReferralCandidate(candidate);
    if (normalizedDirect) return normalizedDirect;

    const container = firstObject(candidate);
    const external = firstObject(
      container?.externalAdReply,
      container?.ExternalAdReply,
      container?.externalAdReplyInfo,
      container?.externalAdReplyMessage,
      container?.quotedAd,
      container?.ad,
      container?.referral,
    );
    const normalizedExternal = normalizeReferralCandidate(external);
    if (normalizedExternal) return normalizedExternal;
  }

  const nested = findNestedObject(message, (candidate) => Boolean(
    candidate.ctwa_clid ||
    candidate.ctwaClid ||
    candidate.source_url ||
    candidate.sourceUrl ||
    candidate.source_id ||
    candidate.sourceId ||
    candidate.externalAdReply ||
    candidate.ExternalAdReply,
  ));
  return normalizeReferralCandidate(firstObject(nested?.externalAdReply, nested?.ExternalAdReply, nested));
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

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function fetchInboundMedia(sourceUrl: string | null) {
  const url = normalizeText(sourceUrl).trim();
  if (!/^https?:\/\//i.test(url)) return null;

  const headerVariants: HeadersInit[] = [
    {},
    EVOLUTION_GO_API_KEY ? { apikey: EVOLUTION_GO_API_KEY, Authorization: `Bearer ${EVOLUTION_GO_API_KEY}` } : {},
  ];

  for (const headers of headerVariants) {
    try {
      const response = await fetch(url, { headers });
      if (!response.ok) continue;

      const declaredSize = Number(response.headers.get("content-length") || 0);
      if (declaredSize > 26 * 1024 * 1024) {
        throw new Error("Arquivo de midia acima do limite de 25MB.");
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > 26 * 1024 * 1024) {
        throw new Error("Arquivo de midia vazio ou acima do limite de 25MB.");
      }

      return {
        bytes,
        contentType: normalizeText(response.headers.get("content-type")).split(";")[0],
        size: bytes.byteLength,
      };
    } catch (error) {
      console.warn("Unable to fetch inbound WhatsApp media", { sourceUrl: url, error });
    }
  }

  return null;
}

async function storeInboundMedia(params: {
  organizationId: string;
  sessionId: string;
  messageId: string;
  type: string;
  mimeType: string;
  base64: string | null;
  sourceUrl?: string | null;
}) {
  const fetched = params.base64
    ? {
      bytes: decodeBase64(params.base64),
      contentType: params.mimeType.split(";")[0] || fallbackMimeType(params.type),
      size: undefined,
    }
    : await fetchInboundMedia(params.sourceUrl || null);

  if (!fetched) return null;

  const contentType = normalizeText(fetched.contentType) || params.mimeType.split(";")[0] || fallbackMimeType(params.type);
  const extension = mediaExtension(contentType, params.type);
  const path = `orgs/${params.organizationId}/sessions/${params.sessionId}/incoming/${params.messageId}.${extension}`;
  const { error } = await supabase.storage
    .from("whatsapp-media")
    .upload(path, fetched.bytes, {
      contentType,
      upsert: true,
    });

  if (error) throw error;
  return path;
}

function normalizeMessage(message: any) {
  const info = firstPresent(message.Info, message.info, {});
  const key = firstPresent(message.key, message.Key, {});
  const messageNode = getMessageNode(message);
  const media = detectMediaBlock(messageNode, message);
  const mediaBlock = media.block || {};
  const isGroupHint = normalizeText(firstPresent(info.IsGroup, message.isGroup, message.is_group)).toLowerCase() === "true";
  const fromMe = parseBoolean(firstPresent(info.IsFromMe, info.fromMe, key.fromMe, message.fromMe, message.from_me));

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
    chatCandidates: [
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
    ],
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

  const timestamp = parseTimestamp(firstPresent(info.Timestamp, info.timestamp, message.messageTimestamp, message.timestamp, message.createdAt));
  const content = normalizeText(extractContent(messageNode, message, mediaBlock)) || null;
  const mediaType = media.type || (content ? "text" : "unknown");
  const messageType = mediaType === "unknown" ? "text" : mediaType;
  const messageId = normalizeText(firstPresent(
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
  )) || `${remoteJid}:${timestamp}:${stableHash(JSON.stringify(message).slice(0, 500))}`;

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

  const mediaUrl = normalizeText(firstPresent(
    mediaBlock.url,
    mediaBlock.URL,
    mediaBlock.mediaUrl,
    mediaBlock.media_url,
    messageNode?.url,
    messageNode?.URL,
    messageNode?.mediaUrl,
    messageNode?.media_url,
    message.media_url,
    message.mediaUrl,
    message.url,
  )) || null;

  const base64 = normalizeBase64(firstPresent(
    message.base64,
    message.Base64,
    message.media,
    message.file,
    message.thumbnail,
    message.thumbnailBase64,
    message.jpegThumbnail,
    messageNode?.base64,
    messageNode?.Base64,
    messageNode?.media,
    messageNode?.file,
    messageNode?.thumbnail,
    messageNode?.thumbnailBase64,
    messageNode?.jpegThumbnail,
    messageNode?.data?.base64,
    messageNode?.Data?.Base64,
    mediaBlock.base64,
    mediaBlock.Base64,
    mediaBlock.media,
    mediaBlock.file,
    mediaBlock.thumbnail,
    mediaBlock.thumbnailBase64,
    mediaBlock.jpegThumbnail,
  ));

  const reaction = firstPresent(messageNode?.reactionMessage, messageNode?.ReactionMessage, message.reaction, null);
  const encryptedReaction = firstPresent(
    messageNode?.encReactionMessage,
    messageNode?.EncReactionMessage,
    message.encReactionMessage,
    message.EncReactionMessage,
    null,
  );
  const isReaction = isRecord(reaction) || isRecord(encryptedReaction);
  const reactionPayload = isRecord(reaction) ? reaction : (isRecord(encryptedReaction) ? encryptedReaction : null);
  const deletedMessageId = extractDeletedMessageId(messageNode, message);
  const referral = extractWhatsAppReferral(messageNode, message, mediaBlock);

  const senderName = normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.senderName, message.notifyName)) || null;
  const directContactName = isGroup
    ? null
    : (fromMe
        ? (normalizeText(firstPresent(message.contactName, message.chatName, message.name, message.contact?.name)) || null)
        : (normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.contactName, message.notifyName)) || null));

  return {
    messageId,
    remoteJid,
    senderJid,
    senderName,
    contactName: directContactName,
    groupName,
    fromMe,
    isGroup,
    sentAt: timestamp,
    messageType: deletedMessageId ? "deleted_event" : (isReaction ? "reaction" : messageType),
    content: deletedMessageId ? null : (isReaction ? normalizeText(firstPresent(reactionPayload?.text, reactionPayload?.emoji)) : content),
    mediaUrl,
    mediaMimeType: mimeType || null,
    mediaBase64: base64,
    mediaSize: Number(firstPresent(mediaBlock.fileLength, mediaBlock.FileLength, message.mediaSize, message.fileSize)) || null,
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

function detectPropertyCode(message: ReturnType<typeof normalizeMessage>) {
  if (!message) return null;
  const referral: JsonRecord = isRecord(message.referral) ? message.referral : {};
  const text = [
    message.content,
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

function campaignLabelForMessage(message: ReturnType<typeof normalizeMessage>, rule?: JsonRecord | null) {
  if (!message) return null;
  return cleanText(firstPresent(
    rule?.campaign_label,
    message.referral?.headline,
    message.referral?.body,
    detectCampaign(message.content),
  ));
}

function whatsappAttribution(message: ReturnType<typeof normalizeMessage>) {
  if (!message?.referral) return null;
  const referral = message.referral;
  const propertyCode = detectPropertyCode(message);
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
    source_referral: referral,
    property_code: propertyCode,
  };

  return Object.fromEntries(
    Object.entries(attribution).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

async function hasVerifiedWhatsAppLeadCreationContext(organizationId: string, message: ReturnType<typeof normalizeMessage>) {
  const referral = message?.referral;
  if (!referral) return false;
  const explicitSourceType = cleanText(referral.explicit_source_type)?.toLowerCase() || "";
  const sourceId = cleanText(referral.source_id) || "";
  if (explicitSourceType !== "ad" || !/^\d{5,40}$/.test(sourceId)) return false;

  const [{ data: insight, error: insightError }, { data: creative, error: creativeError }] = await Promise.all([
    supabase
      .from("meta_campaign_insights")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("ad_id", sourceId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("meta_creative_assets")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("ad_id", sourceId)
      .limit(1)
      .maybeSingle(),
  ]);
  if (insightError) throw insightError;
  if (creativeError) throw creativeError;
  return Boolean(insight?.id || creative?.id);
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
    .order("priority", { ascending: false });

  if (error) throw error;
  return (data || []).find((rule: JsonRecord) => (
    (!rule.session_id || rule.session_id === session.id) && ruleMatches(rule, message)
  )) || null;
}

async function resolveRoundRobinAssignee(rule: JsonRecord | null, organizationId: string) {
  const targetRoundRobinId = optionalUuid(rule?.target_round_robin_id);
  if (!targetRoundRobinId) return null;

  const { data: roundRobin } = await supabase
    .from("round_robins")
    .select("id, current_position")
    .eq("id", targetRoundRobinId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .maybeSingle();

  if (!roundRobin) return null;

  const { data: members, error } = await supabase
    .from("round_robin_members")
    .select("user_id, position")
    .eq("round_robin_id", roundRobin.id)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) throw error;
  if (!members?.length) return null;

  const index = Math.abs(Number(roundRobin.current_position || 0)) % members.length;
  return {
    roundRobinId: roundRobin.id,
    nextPosition: Number(roundRobin.current_position || 0) + 1,
    userId: members[index].user_id,
  };
}

async function findLeadByPhone(organizationId: string, phone: string) {
  const { data, error } = await supabase
    .rpc("find_lead_by_normalized_phone", {
      p_organization_id: organizationId,
      p_phone: phone,
    });

  if (error) throw error;
  return Array.isArray(data) ? data[0] || null : data || null;
}

async function resolvePropertyByCode(organizationId: string, propertyCode: string | null) {
  const code = cleanText(propertyCode);
  if (!code) return null;

  for (const column of ["code", "referencia_alternativa", "external_id", "imoview_codigo", "vista_codigo"]) {
    const { data, error } = await supabase
      .from("properties")
      .select("id, code, title")
      .eq("organization_id", organizationId)
      .eq(column, code)
      .limit(1)
      .maybeSingle();

    if (error) {
      if (error.code === "42703") continue;
      throw error;
    }
    if (data?.id) return data;
  }

  return null;
}

async function ensureLead(session: JsonRecord, message: ReturnType<typeof normalizeMessage>, rule: JsonRecord | null) {
  if (!message || message.isGroup) return null;

  const identity = whatsappIdentityForMessage(message);
  const phone = identity.contactPhone || phoneFromJidLike(message.remoteJid) || phoneFromJidLike(message.senderJid);
  if (!phone) return null;

  const existing = await findLeadByPhone(session.organization_id, phone);
  const now = new Date().toISOString();
  const avatarUrl = message.avatarUrl || existing?.whatsapp_avatar_url || null;
  const attribution = whatsappAttribution(message);
  const propertyCode = detectPropertyCode(message);
  const property = await resolvePropertyByCode(session.organization_id, propertyCode);
  const campaignLabel = campaignLabelForMessage(message, rule);

  if (existing) {
    const update: JsonRecord = {
      last_contact_at: now,
      updated_at: now,
      metadata: {
        ...(existing.metadata || {}),
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
    if ((campaignLabel || attribution?.campaign_name) && !existing.source_detail) {
      update.source_detail = campaignLabel || attribution?.campaign_name;
    }
    await supabase.from("leads").update(update).eq("id", existing.id);
    return { ...existing, ...update, is_new_lead: false };
  }

  if (!(await hasVerifiedWhatsAppLeadCreationContext(session.organization_id, message))) {
    console.debug("[evolution-go-webhook] plain WhatsApp conversation stored without lead auto-creation", {
      session_id: session.id,
      organization_id: session.organization_id,
      remote_jid: identity.remoteJid || message.remoteJid,
      message_id: message.messageId,
    });
    return null;
  }

  const roundRobinAssignee = await resolveRoundRobinAssignee(rule, session.organization_id);
  const targetUserId = optionalUuid(rule?.target_user_id);
  const targetPipelineId = optionalUuid(rule?.target_pipeline_id);
  const targetStageId = optionalUuid(rule?.target_stage_id);
  const targetTeamId = optionalUuid(rule?.target_team_id);
  const targetRoundRobinId = optionalUuid(rule?.target_round_robin_id);
  const ownerUserId = optionalUuid(session.owner_user_id) || optionalUuid(session.created_by);
  const assignedUserId = targetUserId || optionalUuid(roundRobinAssignee?.userId) || ownerUserId;
  const sourceLabel = rule?.source_label || "WhatsApp";

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
      p_metadata: {
        source: "whatsapp",
        whatsapp_session_id: session.id,
        remote_jid: identity.remoteJid || message.remoteJid,
        matched_rule_id: rule?.id || null,
        target_team_id: targetTeamId,
        target_round_robin_id: targetRoundRobinId,
        campaign_label: campaignLabel,
        whatsapp_attribution: attribution,
        property_id: property?.id || null,
      },
    });

  const lead = Array.isArray(upsertedLead) ? upsertedLead[0] : upsertedLead;

  if (error) {
    if (isUniqueViolation(error, "leads_org_phone_unique")) {
      const recovered = await findLeadByPhone(session.organization_id, phone);
      if (recovered?.id) return { ...recovered, is_new_lead: false };
    }
    throw error;
  }

  if (!lead?.id) {
    throw new Error("Lead upsert did not return a lead");
  }

  if (roundRobinAssignee?.roundRobinId && lead.is_new_lead) {
    await supabase
      .from("round_robins")
      .update({ current_position: roundRobinAssignee.nextPosition, updated_at: now })
      .eq("id", roundRobinAssignee.roundRobinId);

    await supabase.from("round_robin_logs").insert({
      organization_id: session.organization_id,
      round_robin_id: roundRobinAssignee.roundRobinId,
      lead_id: lead.id,
      assigned_user_id: roundRobinAssignee.userId,
      reason: "whatsapp_inbound_rule",
      metadata: { whatsapp_session_id: session.id, matched_rule_id: rule?.id || null, whatsapp_attribution: attribution },
    });
  }

  return { ...lead, is_new_lead: Boolean(lead.is_new_lead) };
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
        payload,
        raw_payload: payload,
        updated_at: new Date().toISOString(),
      })
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

  const { data: existing, error: existingError } = await supabase
    .from("lead_entry_events")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("lead_id", lead.id)
    .eq("source", "whatsapp")
    .eq("metadata->>message_id", message.messageId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return;

  const { error } = await supabase.from("lead_entry_events").insert({
    organization_id: session.organization_id,
    lead_id: lead.id,
    source: "whatsapp",
    entry_type: lead.is_new_lead ? "initial" : "reentry",
    property_id: lead.property_id || lead.interest_property_id || null,
    campaign_name: attribution.campaign_name || attribution.ad_name || null,
    utm_source: "facebook",
    utm_medium: "click_to_whatsapp",
    utm_campaign: attribution.campaign_name || null,
    metadata,
  });
  if (error) throw error;
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

  const { data: existing, error: existingError } = await supabase
    .from("activities")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("lead_id", lead.id)
    .eq("type", "meta_creative")
    .eq("metadata->>message_id", message.messageId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.id) return;

  const { error } = await supabase.from("activities").insert({
    organization_id: session.organization_id,
    lead_id: lead.id,
    user_id: null,
    type: "meta_creative",
    content: attribution.creative_name || attribution.ad_name || "Criativo do anuncio",
    metadata,
  });
  if (error) throw error;
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

async function findWhatsAppIdentityAlias(session: JsonRecord, aliases: string[]) {
  const normalizedAliases = unique(aliases.map((alias) => normalizeJid(alias, false)).filter(Boolean));
  if (normalizedAliases.length === 0) return null;

  const { data, error } = await supabase
    .from("whatsapp_contact_identity_aliases")
    .select("alias_jid, canonical_jid, contact_phone, lead_id, metadata")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .in("alias_jid", normalizedAliases)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (["42P01", "42703"].includes(error.code)) return null;
    throw error;
  }

  return data || null;
}

async function upsertWhatsAppIdentityAliases(
  session: JsonRecord,
  identity: ReturnType<typeof whatsappIdentityForMessage>,
  lead: JsonRecord | null,
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
      lead_id: conversation.lead_id || null,
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

async function resolveAttachableLeadId(
  session: JsonRecord,
  conversationId: string | null,
  candidateLeadId: string | null,
) {
  if (!candidateLeadId) return null;

  let query = supabase
    .from("whatsapp_conversations")
    .select("id")
    .eq("organization_id", session.organization_id)
    .eq("lead_id", candidateLeadId)
    .is("deleted_at", null)
    .or("is_group.is.null,is_group.eq.false")
    .limit(1);

  if (conversationId) query = query.neq("id", conversationId);

  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data?.id ? null : candidateLeadId;
}

async function safelyUpsertWhatsAppIdentityAliases(
  session: JsonRecord,
  identity: ReturnType<typeof whatsappIdentityForMessage>,
  lead: JsonRecord | null,
  conversation: JsonRecord,
  extraAliases: unknown[] = [],
) {
  try {
    await upsertWhatsAppIdentityAliases(session, identity, lead, conversation, extraAliases);
  } catch (error) {
    console.warn("[evolution-go-webhook] identity alias update failed; message processing will continue", {
      session_id: session.id,
      conversation_id: conversation.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function ensureConversation(session: JsonRecord, message: ReturnType<typeof normalizeMessage>, lead: JsonRecord | null) {
  if (!message) throw new Error("Missing normalized message");
  const identity = whatsappIdentityForMessage(message);
  let remoteJid = identity.remoteJid || message.remoteJid;
  let contactPhone = message.isGroup ? null : (identity.contactPhone || null);
  let identityAliases = mergeWhatsAppIdentityAliases(identity, [message.remoteJid, remoteJid]);
  let aliasMatch: JsonRecord | null = null;
  try {
    aliasMatch = await findWhatsAppIdentityAlias(session, identityAliases);
  } catch (error) {
    console.warn("[evolution-go-webhook] identity alias lookup failed; direct identity matching will continue", {
      session_id: session.id,
      remote_jid: remoteJid,
      error: error instanceof Error ? error.message : String(error),
    });
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

  if (identityAliases.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("remote_jid", identityAliases)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10);
    if (error) throw error;

    const matches = data || [];
    const canonical = matches.find((conversation) => conversation.remote_jid === remoteJid) || null;
    existing = canonical || matches[0] || null;
    canonicalConflict = Boolean(canonical && existing && canonical.id !== existing.id);
  }

  const phoneVariants = message.isGroup
    ? []
    : phoneMatchVariantsForWhatsApp(contactPhone, remoteJid, message.remoteJid, ...identityAliases);

  if (!existing && !message.isGroup && phoneVariants.length > 0) {
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .select("*")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .in("contact_phone", phoneVariants)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(10);
    if (error) throw error;
    existing = data?.[0] || null;
  }

  if (existing) {
    const attachableLeadId = existing.lead_id || await resolveAttachableLeadId(
      session,
      existing.id,
      lead?.id || null,
    );
    const contactName = message.isGroup
      ? (resolvedGroupName || existing.contact_name || "Grupo WhatsApp")
      : (!message.fromMe && message.contactName ? message.contactName : existing.contact_name);
    const updates: JsonRecord = {
      contact_name: contactName,
      contact_phone: existing.contact_phone || contactPhone,
      contact_picture: message.avatarUrl || existing.contact_picture,
      lead_id: attachableLeadId,
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
        ...(attribution ? { whatsapp_attribution: attribution } : {}),
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

    if (attachableLeadId && !existing.lead_id) {
      await supabase
        .from("whatsapp_messages")
        .update({ lead_id: attachableLeadId })
        .eq("conversation_id", existing.id)
        .is("lead_id", null);
    }

    await safelyUpsertWhatsAppIdentityAliases(session, identity, lead, data, identityAliases);
    return data;
  }

  const attachableLeadId = await resolveAttachableLeadId(session, null, lead?.id || null);

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
        ...(attribution ? { whatsapp_attribution: attribution } : {}),
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
        await safelyUpsertWhatsAppIdentityAliases(session, identity, lead, recovered, identityAliases);
        return recovered;
      }
    }
    throw error;
  }
  await safelyUpsertWhatsAppIdentityAliases(session, identity, lead, data, identityAliases);
  return data;
}

async function insertMessage(session: JsonRecord, conversation: JsonRecord, lead: JsonRecord | null, message: ReturnType<typeof normalizeMessage>) {
  if (!message) return { inserted: false, message: null };

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, media_storage_path, media_status, media_error, status, delivered_at, read_at")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("message_id", message.messageId)
    .maybeSingle();

  if (existingError) throw existingError;

  const mediaStoragePath = await storeInboundMedia({
    organizationId: session.organization_id,
    sessionId: session.id,
    messageId: message.messageId,
    type: message.messageType,
    mimeType: message.mediaMimeType || "application/octet-stream",
    base64: message.mediaBase64,
    sourceUrl: message.mediaUrl,
  });
  const isMedia = ["image", "video", "audio", "document", "sticker"].includes(message.messageType);
  const mediaStatus = isMedia ? (mediaStoragePath ? "ready" : "pending") : null;
  const mediaError = isMedia && !mediaStoragePath ? "media_download_pending" : null;

  const row = {
    organization_id: session.organization_id,
    conversation_id: conversation.id,
    session_id: session.id,
    lead_id: conversation.lead_id || null,
    message_id: message.messageId,
    provider_message_id: message.messageId,
    from_me: message.fromMe,
    message_type: message.messageType,
    content: message.content,
    media_url: message.mediaUrl,
    media_mime_type: message.mediaMimeType,
    media_storage_path: mediaStoragePath,
    media_status: mediaStatus,
    media_error: mediaError,
    media_size: message.mediaSize,
    remote_jid: conversation.remote_jid || message.remoteJid,
    sender_jid: message.senderJid,
    sender_name: message.senderName,
    reaction_to_message_id: message.reactionToMessageId,
    reaction_emoji: message.reactionEmoji,
    reaction_sender_jid: message.senderJid,
    reaction_sender_name: message.senderName,
    status: message.fromMe ? "sent" : "received",
    sent_at: message.sentAt,
    received_at: message.fromMe ? null : new Date().toISOString(),
    metadata: {
      source: "evolution_go_webhook",
      whatsapp_attribution: whatsappAttribution(message),
      whatsapp_referral: message.referral,
      // The durable Go inbox owns raw webhook retention. Keep the raw message
      // only while a media retry still needs provider download fields.
      ...(isMedia && !mediaStoragePath ? { raw: message.raw } : {}),
    },
  };

  if (existing) {
    const movedConversation = existing.conversation_id && existing.conversation_id !== conversation.id;
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .update({
        ...row,
        media_storage_path: mediaStoragePath || existing.media_storage_path || null,
        media_status: mediaStatus || existing.media_status || null,
        media_error: mediaStoragePath ? null : (mediaError || existing.media_error || null),
        status: monotonicMessageStatus(existing.status, row.status),
        delivered_at: existing.delivered_at || undefined,
        read_at: existing.read_at || undefined,
        updated_at: undefined,
      })
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return { inserted: Boolean(movedConversation), message: data };
  }

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert(row)
    .select("*")
    .single();

  if (error) throw error;
  return { inserted: true, message: data };
}

async function markMessageDeleted(session: JsonRecord, message: ReturnType<typeof normalizeMessage>) {
  if (!message?.deletedMessageId) return false;

  const { data: target, error: targetError } = await supabase
    .from("whatsapp_messages")
    .select("id, conversation_id, sent_at, metadata")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("message_id", message.deletedMessageId)
    .maybeSingle();
  if (targetError) throw targetError;
  if (!target) return false;

  const deletedAt = new Date().toISOString();
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
    .eq("id", target.id);
  if (updateError) throw updateError;

  if (target.sent_at) {
    const { error: conversationError } = await supabase
      .from("whatsapp_conversations")
      .update({
        last_message: "Esta mensagem foi apagada",
        last_message_preview: "Esta mensagem foi apagada",
        updated_at: deletedAt,
      })
      .eq("id", target.conversation_id)
      .eq("last_message_at", target.sent_at);
    if (conversationError) throw conversationError;
  }

  return true;
}

async function updateConversationAfterMessage(conversation: JsonRecord, normalized: ReturnType<typeof normalizeMessage>, inserted: boolean) {
  if (!normalized || !inserted || normalized.messageType === "reaction") return;

  await supabase
    .from("whatsapp_conversations")
    .update({
      last_message: previewForMessage(normalized),
      last_message_preview: previewForMessage(normalized),
      last_message_at: normalized.sentAt,
      unread_count: normalized.fromMe ? conversation.unread_count || 0 : Number(conversation.unread_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);
}

async function logInbound(session: JsonRecord, conversation: JsonRecord, lead: JsonRecord | null, rule: JsonRecord | null, message: ReturnType<typeof normalizeMessage>) {
  if (!message || message.fromMe || message.isGroup || message.messageType === "reaction") return;
  await supabase.from("whatsapp_inbound_logs").insert({
    organization_id: session.organization_id,
    session_id: session.id,
    conversation_id: conversation.id,
    lead_id: lead?.id || null,
    matched_rule_id: rule?.id || null,
    assigned_user_id: lead?.assigned_user_id || null,
    match_details: {
      remote_jid: conversation.remote_jid || message.remoteJid,
      message_id: message.messageId,
      match_field: rule?.match_field || null,
      match_value: rule?.match_value || null,
      campaign_label: rule?.campaign_label || detectCampaign(message.content),
      whatsapp_attribution: whatsappAttribution(message),
      property_code: detectPropertyCode(message),
    },
  });
}

async function triggerAutoReply(
  session: JsonRecord,
  conversation: JsonRecord,
  storedMessage: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!VIMOB_API_URL || !AI_AUTOREPLY_TOKEN) {
    console.warn("AI auto-reply skipped: missing VIMOB_API_URL or AI_AUTOREPLY_TOKEN");
    return;
  }
  if (!message || message.fromMe || message.isGroup || message.messageType === "reaction" || !storedMessage?.id) return;
  if (!message.content || !String(message.content).trim()) return;

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
        providerMessageId: message.messageId,
        text: message.content,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      console.warn("AI auto-reply request failed", response.status, body.slice(0, 500));
    } else {
      const body = await response.json().catch(() => null);
      if (body?.skipped) {
        console.warn("AI auto-reply skipped", body.reason || "unknown_reason");
      }
    }
  } catch (error) {
    console.warn("AI auto-reply request failed", error);
  } finally {
    clearTimeout(timeout);
  }
}

function scheduleAutoReply(
  session: JsonRecord,
  conversation: JsonRecord,
  storedMessage: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  const task = triggerAutoReply(session, conversation, storedMessage, message);
  if (typeof EdgeRuntime !== "undefined" && typeof EdgeRuntime.waitUntil === "function") {
    EdgeRuntime.waitUntil(task);
    return;
  }
  task.catch((error) => console.warn("AI auto-reply background task failed", error));
}

async function handleMessages(session: JsonRecord, payload: any) {
  const messages = extractMessages(payload);
  let processed = 0;

  for (const rawMessage of messages) {
    const message = normalizeMessage(rawMessage);
    if (!message) continue;
    if (message.messageType === "deleted_event") {
      if (await markMessageDeleted(session, message)) processed += 1;
      continue;
    }
    if (message.messageType === "reaction" && !message.reactionToMessageId) {
      continue;
    }
    const messageIdentity = whatsappIdentityForMessage(message);
    const diagnosticRemoteJid = messageIdentity.remoteJid || message.remoteJid;

    let rule: JsonRecord | null = null;
    let lead: JsonRecord | null = null;

    const isReactionEvent = message.messageType === "reaction";
    if (!message.fromMe && !message.isGroup && !isReactionEvent) {
      try {
        rule = await findInboundRule(session, message);
      } catch (error) {
        console.warn("[evolution-go-webhook] inbound rule lookup failed; message will still be stored", {
          session_id: session.id,
          remote_jid: diagnosticRemoteJid,
          error: error instanceof Error ? error.message : String(error),
        });
      }

      try {
        lead = await ensureLead(session, message, rule);
      } catch (error) {
        console.warn("[evolution-go-webhook] lead resolution failed; message will still be stored", {
          session_id: session.id,
          remote_jid: diagnosticRemoteJid,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const conversation = await ensureConversation(session, message, lead);
    const attachedLead = conversation.lead_id && conversation.lead_id === lead?.id ? lead : null;
    const result = await insertMessage(session, conversation, attachedLead, message);
    await updateConversationAfterMessage(conversation, message, result.inserted);
    await logInbound(session, conversation, attachedLead, rule, message);
    if (result.inserted && !isReactionEvent) {
      await upsertLeadMetaAttribution(session, conversation, attachedLead, message);
      await logLeadEntryAttribution(session, conversation, attachedLead, message);
      await logCreativeActivity(session, conversation, attachedLead, message);
      scheduleAutoReply(session, conversation, result.message, message);
    }
    processed += 1;
  }

  return processed;
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

function monotonicMessageStatus(currentValue: unknown, incomingValue: unknown) {
  const current = normalizeText(currentValue).toLowerCase();
  const incoming = normalizeText(incomingValue).toLowerCase();
  if (!current) return incoming || "received";
  if (!incoming || current === incoming) return current;
  if (current === "read") return current;
  if (incoming === "read") return incoming;
  if (current === "delivered" && ["queued", "pending", "sent", "received"].includes(incoming)) return current;
  if (current === "failed" && ["queued", "pending", "sent", "received"].includes(incoming)) return current;
  if (incoming === "failed" && ["delivered", "read"].includes(current)) return current;
  return incoming;
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
        && monotonicMessageStatus(target.status, status) === status
      ))
      .map((target: JsonRecord) => target.id);

    if (outboxTargetIds?.length) {
      const outboxUpdate: JsonRecord = { status };
      if (status === "delivered") outboxUpdate.delivered_at = receiptAt;
      if (status === "read") outboxUpdate.read_at = receiptAt;
      if (status === "failed") {
        outboxUpdate.failed_at = receiptAt;
        outboxUpdate.last_error = failureReason;
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
  if (!qrcode) return false;

  await supabase
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
    .eq("id", session.id);

  return true;
}

async function handleConnection(session: JsonRecord, payload: any) {
  const normalizedStatus = normalizeStatus(payload);
  const raw = payload?.data || payload?.Data || payload;
  const rawState = normalizeText(firstPresent(raw.state, raw.State, raw.connectionStatus, raw.status)).toLowerCase();
  const isErrorState = ["error", "failed", "failure"].includes(rawState);
  const jid = firstPresent(raw.jid, raw.JID, raw.phone, raw.Phone, raw.user?.id);
  const update: JsonRecord = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
    last_error: isErrorState ? firstPresent(raw.error, raw.message, "Falha na conexao") : null,
  };

  if (normalizedStatus === "connected") {
    update.last_connected_at = new Date().toISOString();
    if (jid) update.phone_number = normalizeDigits(jid);
    update.profile_name = firstPresent(raw.pushName, raw.name, raw.profileName, session.profile_name);
    update.profile_picture = firstPresent(raw.profilePicture, raw.pictureUrl, session.profile_picture);
  }

  await supabase.from("whatsapp_sessions").update(update).eq("id", session.id);
  return normalizedStatus;
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

    const { data: existing } = await supabase
      .from("whatsapp_labels")
      .select("id")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("remote_label_id", remoteLabelId || name)
      .maybeSingle();

    const row = {
      organization_id: session.organization_id,
      session_id: session.id,
      remote_label_id: remoteLabelId || name,
      name: name || remoteLabelId,
      color: normalizeText(firstPresent(label.color, label.hexColor)) || "#FF4529",
      predefined: parseBoolean(label.predefined),
    };

    if (existing) {
      await supabase.from("whatsapp_labels").update(row).eq("id", existing.id);
    } else {
      await supabase.from("whatsapp_labels").insert(row);
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
    if (conversationUpdateError) {
      console.warn("[evolution-go-webhook] group conversation name sync failed", conversationUpdateError.message);
    }
  }
  return processed;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, service: "evolution-go-webhook" });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const payload = await req.json().catch(() => ({}));
    const event = normalizeText(firstPresent(payload.event, payload.type, payload.action, payload.Event, payload.data?.event)).toLowerCase();
    const resolved = await resolveSession(payload, url);

    if (!resolved.session) {
      return json({ ok: true, ignored: true, reason: resolved.reason, signals: resolved.signals, matches: resolved.matches || 0 });
    }

    if (!validateWebhookAuth(req, url, resolved.session)) {
      return json({ ok: false, error: "Invalid webhook token" }, 403);
    }

    if (!validateSessionSignals(resolved.session, resolved.signals)) {
      return json({ ok: true, ignored: true, reason: "BLOCKED_SESSION_INSTANCE_MISMATCH", signals: resolved.signals });
    }

    if (resolved.session.is_active === false || resolved.session.status === "deleted") {
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
    // Receipt payloads commonly carry a message key/remoteJid but no message
    // body. Treating those as normal messages creates empty ghost rows.
    const messagesProcessed = isMessageStatusEvent ? 0 : await handleMessages(resolved.session, payload);

    return json({
      ok: true,
      session_id: resolved.session.id,
      event,
      qrUpdated,
      connectionStatus,
      messagesProcessed,
      statusUpdated,
      labelsProcessed,
      groupsProcessed,
    });
  } catch (error) {
    console.error("evolution-go-webhook error:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
