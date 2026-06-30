/* eslint-disable @typescript-eslint/no-explicit-any */
// Evolution Go webhook for the Vimob WhatsApp module.
// All writes are scoped by a resolved whatsapp_sessions.id before touching CRM data.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

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

function normalizeDigits(value: unknown) {
  return normalizeText(value).replace(/\D/g, "");
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeJid(value: unknown, forceGroup = false) {
  const raw = normalizeText(value).trim();
  if (!raw) return "";
  if (raw.includes("@")) return raw;
  const digits = normalizeDigits(raw);
  if (!digits) return raw;
  return `${digits}@${forceGroup ? "g.us" : "s.whatsapp.net"}`;
}

function phoneVariants(phone: string) {
  const digits = normalizeDigits(phone);
  const variants = [digits];

  if (digits.startsWith("55")) variants.push(digits.slice(2));
  if (!digits.startsWith("55") && digits.length >= 10) variants.push(`55${digits}`);

  for (const variant of [...variants]) {
    const local = variant.startsWith("55") ? variant.slice(2) : variant;
    if (local.length === 11 && local[2] === "9") {
      variants.push(local.slice(0, 2) + local.slice(3));
      variants.push(`55${local.slice(0, 2)}${local.slice(3)}`);
    }
    if (local.length === 10) {
      variants.push(`${local.slice(0, 2)}9${local.slice(2)}`);
      variants.push(`55${local.slice(0, 2)}9${local.slice(2)}`);
    }
  }

  return unique(variants);
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

  if (signals.sessionId) {
    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("id", signals.sessionId)
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

  if (expectedWebhookToken && incomingWebhookToken !== expectedWebhookToken) {
    return false;
  }

  const incomingKey = firstPresent(
    req.headers.get("apikey"),
    req.headers.get("x-api-key"),
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
    url.searchParams.get("apikey"),
  );

  if (!expectedWebhookToken && EVOLUTION_GO_API_KEY && incomingKey && incomingKey !== EVOLUTION_GO_API_KEY) {
    return false;
  }

  return true;
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

function detectMediaBlock(messageNode: any, message: any) {
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

  const hint = String(firstPresent(message.messageType, message.type, message.mediaType, message.mediatype, message.kind) || "").toLowerCase();
  if (["image", "video", "audio", "document", "sticker"].includes(hint)) {
    return { type: hint, block: message };
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

function decodeBase64(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function storeInboundMedia(params: {
  organizationId: string;
  sessionId: string;
  messageId: string;
  type: string;
  mimeType: string;
  base64: string | null;
}) {
  if (!params.base64) return null;

  const extension = mediaExtension(params.mimeType, params.type);
  const path = `orgs/${params.organizationId}/sessions/${params.sessionId}/incoming/${params.messageId}.${extension}`;
  const { error } = await supabase.storage
    .from("whatsapp-media")
    .upload(path, decodeBase64(params.base64), {
      contentType: params.mimeType.split(";")[0] || "application/octet-stream",
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

  const remoteJid = normalizeJid(firstPresent(
    info.Chat,
    info.chat,
    key.remoteJid,
    key.RemoteJID,
    message.remoteJid,
    message.remote_jid,
    message.chat,
    message.chatId,
    message.from,
    message.to,
    message.jid,
  ), isGroupHint);

  if (!remoteJid) return null;

  const isGroup = remoteJid.endsWith("@g.us") || isGroupHint;
  const fromMe = parseBoolean(firstPresent(info.IsFromMe, info.fromMe, key.fromMe, message.fromMe, message.from_me));
  const senderJid = normalizeJid(firstPresent(
    info.Sender,
    info.sender,
    key.participant,
    key.Participant,
    message.participant,
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
    message.mimetype,
    message.mimeType,
  )) || (messageType === "text" ? "" : "application/octet-stream");

  const mediaUrl = normalizeText(firstPresent(
    mediaBlock.url,
    mediaBlock.URL,
    mediaBlock.mediaUrl,
    message.media_url,
    message.mediaUrl,
    message.url,
  )) || null;

  const base64 = normalizeBase64(firstPresent(
    message.base64,
    message.media,
    message.file,
    mediaBlock.base64,
    mediaBlock.media,
    mediaBlock.file,
  ));

  const reaction = firstPresent(messageNode?.reactionMessage, messageNode?.ReactionMessage, message.reaction, null);
  const isReaction = isRecord(reaction);

  return {
    messageId,
    remoteJid,
    senderJid,
    senderName: normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.senderName, message.notifyName)) || null,
    contactName: normalizeText(firstPresent(info.PushName, info.pushName, message.pushName, message.contactName, message.notifyName)) || null,
    fromMe,
    isGroup,
    sentAt: timestamp,
    messageType: isReaction ? "reaction" : messageType,
    content: isReaction ? normalizeText(firstPresent(reaction.text, reaction.emoji)) : content,
    mediaUrl,
    mediaMimeType: mimeType || null,
    mediaBase64: base64,
    mediaSize: Number(firstPresent(mediaBlock.fileLength, mediaBlock.FileLength, message.mediaSize, message.fileSize)) || null,
    reactionToMessageId: isReaction ? normalizeText(firstPresent(reaction.key?.id, reaction.Key?.ID, reaction.messageId)) : null,
    reactionEmoji: isReaction ? normalizeText(firstPresent(reaction.text, reaction.emoji)) : null,
    avatarUrl: normalizeText(firstPresent(message.profilePicture, message.profilePicUrl, message.avatar, message.pictureUrl)) || null,
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
    campaign: detectCampaign(message.content) || "",
    any: `${message.content || ""} ${message.contactName || ""} ${message.remoteJid}`,
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
  if (!rule?.target_round_robin_id) return null;

  const { data: roundRobin } = await supabase
    .from("round_robins")
    .select("id, current_position")
    .eq("id", rule.target_round_robin_id)
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
  const variants = phoneVariants(phone);
  if (variants.length === 0) return null;

  const filters = variants.flatMap((variant) => [
    `phone.ilike.%${variant}%`,
    `whatsapp.ilike.%${variant}%`,
  ]);

  const { data, error } = await supabase
    .from("leads")
    .select("id, name, assigned_user_id, whatsapp_avatar_url")
    .eq("organization_id", organizationId)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function ensureLead(session: JsonRecord, message: ReturnType<typeof normalizeMessage>, rule: JsonRecord | null) {
  if (!message || message.isGroup) return null;

  const phone = normalizeDigits(message.remoteJid);
  if (!phone) return null;

  const existing = await findLeadByPhone(session.organization_id, phone);
  const now = new Date().toISOString();
  const avatarUrl = message.avatarUrl || existing?.whatsapp_avatar_url || null;

  if (existing) {
    const update: JsonRecord = {
      last_contact_at: now,
      updated_at: now,
    };
    if (avatarUrl && !existing.whatsapp_avatar_url) {
      update.whatsapp_avatar_url = avatarUrl;
      update.whatsapp_avatar_synced_at = now;
    }
    await supabase.from("leads").update(update).eq("id", existing.id);
    return existing;
  }

  const roundRobinAssignee = await resolveRoundRobinAssignee(rule, session.organization_id);
  const assignedUserId = rule?.target_user_id || roundRobinAssignee?.userId || session.owner_user_id || session.created_by || null;
  const campaignLabel = rule?.campaign_label || detectCampaign(message.content);
  const sourceLabel = rule?.source_label || "WhatsApp";

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      organization_id: session.organization_id,
      name: message.contactName || phone,
      phone,
      whatsapp: phone,
      whatsapp_avatar_url: avatarUrl,
      whatsapp_avatar_synced_at: avatarUrl ? now : null,
      source: "whatsapp",
      source_detail: campaignLabel || sourceLabel,
      source_session_id: session.id,
      initial_message: message.content,
      message: message.content,
      assigned_user_id: assignedUserId,
      assigned_at: assignedUserId ? now : null,
      pipeline_id: rule?.target_pipeline_id || null,
      stage_id: rule?.target_stage_id || null,
      created_by: session.owner_user_id || session.created_by || null,
      first_touch_at: now,
      first_touch_channel: "whatsapp",
      last_contact_at: now,
      metadata: {
        source: "whatsapp",
        whatsapp_session_id: session.id,
        remote_jid: message.remoteJid,
        matched_rule_id: rule?.id || null,
        target_team_id: rule?.target_team_id || null,
        target_round_robin_id: rule?.target_round_robin_id || null,
        campaign_label: campaignLabel,
      },
    })
    .select("id, name, assigned_user_id, whatsapp_avatar_url")
    .single();

  if (error) throw error;

  if (roundRobinAssignee?.roundRobinId) {
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
      metadata: { whatsapp_session_id: session.id, matched_rule_id: rule?.id || null },
    });
  }

  return lead;
}

async function ensureConversation(session: JsonRecord, message: ReturnType<typeof normalizeMessage>, lead: JsonRecord | null) {
  if (!message) throw new Error("Missing normalized message");

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("remote_jid", message.remoteJid)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    const updates: JsonRecord = {
      contact_name: message.contactName || existing.contact_name,
      contact_phone: existing.contact_phone || (message.isGroup ? null : normalizeDigits(message.remoteJid)),
      contact_picture: message.avatarUrl || existing.contact_picture,
      lead_id: existing.lead_id || lead?.id || null,
      assigned_user_id: existing.assigned_user_id || lead?.assigned_user_id || session.owner_user_id || null,
      updated_at: new Date().toISOString(),
      metadata: {
        ...(existing.metadata || {}),
        last_webhook_at: new Date().toISOString(),
      },
    };
    const { data, error } = await supabase
      .from("whatsapp_conversations")
      .update(updates)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      organization_id: session.organization_id,
      session_id: session.id,
      lead_id: lead?.id || null,
      assigned_user_id: lead?.assigned_user_id || session.owner_user_id || null,
      remote_jid: message.remoteJid,
      contact_name: message.contactName || (message.isGroup ? "Grupo WhatsApp" : normalizeDigits(message.remoteJid)),
      contact_phone: message.isGroup ? null : normalizeDigits(message.remoteJid),
      contact_picture: message.avatarUrl,
      is_group: message.isGroup,
      unread_count: 0,
      metadata: {
        source: "evolution_go",
        created_from_webhook: true,
      },
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function insertMessage(session: JsonRecord, conversation: JsonRecord, lead: JsonRecord | null, message: ReturnType<typeof normalizeMessage>) {
  if (!message) return { inserted: false, message: null };

  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_messages")
    .select("id")
    .eq("conversation_id", conversation.id)
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
  });

  const row = {
    organization_id: session.organization_id,
    conversation_id: conversation.id,
    session_id: session.id,
    lead_id: lead?.id || conversation.lead_id || null,
    message_id: message.messageId,
    provider_message_id: message.messageId,
    from_me: message.fromMe,
    message_type: message.messageType,
    content: message.content,
    media_url: message.mediaUrl,
    media_mime_type: message.mediaMimeType,
    media_storage_path: mediaStoragePath,
    media_status: ["image", "video", "audio", "document", "sticker"].includes(message.messageType)
      ? (mediaStoragePath || message.mediaUrl ? "ready" : "pending")
      : null,
    media_size: message.mediaSize,
    remote_jid: message.remoteJid,
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
      raw: message.raw,
    },
  };

  if (existing) {
    const { data, error } = await supabase
      .from("whatsapp_messages")
      .update({
        ...row,
        media_storage_path: mediaStoragePath || undefined,
        updated_at: undefined,
      })
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
  if (!message || message.fromMe || message.isGroup) return;
  await supabase.from("whatsapp_inbound_logs").insert({
    organization_id: session.organization_id,
    session_id: session.id,
    conversation_id: conversation.id,
    lead_id: lead?.id || null,
    matched_rule_id: rule?.id || null,
    assigned_user_id: lead?.assigned_user_id || null,
    match_details: {
      remote_jid: message.remoteJid,
      message_id: message.messageId,
      match_field: rule?.match_field || null,
      match_value: rule?.match_value || null,
      campaign_label: rule?.campaign_label || detectCampaign(message.content),
    },
  });
}

async function triggerAutoReply(
  session: JsonRecord,
  conversation: JsonRecord,
  storedMessage: JsonRecord | null,
  message: ReturnType<typeof normalizeMessage>,
) {
  if (!VIMOB_API_URL || !AI_AUTOREPLY_TOKEN) return;
  if (!message || message.fromMe || message.isGroup || !storedMessage?.id) return;
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
    }
  } catch (error) {
    console.warn("AI auto-reply request failed", error);
  } finally {
    clearTimeout(timeout);
  }
}

async function handleMessages(session: JsonRecord, payload: any) {
  const messages = extractMessages(payload);
  let processed = 0;

  for (const rawMessage of messages) {
    const message = normalizeMessage(rawMessage);
    if (!message) continue;

    const rule = !message.fromMe && !message.isGroup ? await findInboundRule(session, message) : null;
    const lead = await ensureLead(session, message, rule);
    const conversation = await ensureConversation(session, message, lead);
    const result = await insertMessage(session, conversation, lead, message);
    await updateConversationAfterMessage(conversation, message, result.inserted);
    await logInbound(session, conversation, lead, rule, message);
    if (result.inserted) {
      await triggerAutoReply(session, conversation, result.message, message);
    }
    processed += 1;
  }

  return processed;
}

function statusFromProvider(value: unknown) {
  const raw = normalizeText(value).toLowerCase();
  if (["read", "played"].includes(raw)) return "read";
  if (["delivered", "delivery"].includes(raw)) return "delivered";
  if (["sent", "server_ack", "serverack"].includes(raw)) return "sent";
  if (["failed", "error"].includes(raw)) return "failed";
  return raw || null;
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
    const messageId = normalizeText(firstPresent(entry.messageId, entry.message_id, entry.id, entry.ID, entry.key?.id, entry.Key?.ID));
    const status = statusFromProvider(firstPresent(entry.status, entry.Status, entry.ack, entry.Ack, entry.type));
    if (!messageId || !status) continue;

    const update: JsonRecord = { status };
    if (status === "delivered") update.delivered_at = new Date().toISOString();
    if (status === "read") update.read_at = new Date().toISOString();
    if (status === "failed") update.error_message = firstPresent(entry.error, entry.message, "Falha no envio");

    const { error } = await supabase
      .from("whatsapp_messages")
      .update(update)
      .eq("session_id", session.id)
      .eq("message_id", messageId);
    if (error) throw error;
    updated += 1;
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
  const jid = firstPresent(raw.jid, raw.JID, raw.phone, raw.Phone, raw.user?.id);
  const update: JsonRecord = {
    status: normalizedStatus,
    updated_at: new Date().toISOString(),
    last_error: normalizedStatus === "error" ? firstPresent(raw.error, raw.message) : null,
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
    const statusUpdated = event.includes("status") || event.includes("receipt") || event.includes("ack")
      ? await handleMessageStatus(resolved.session, payload)
      : 0;
    const messagesProcessed = await handleMessages(resolved.session, payload);

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
