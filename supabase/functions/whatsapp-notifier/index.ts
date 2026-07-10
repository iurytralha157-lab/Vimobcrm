/* eslint-disable @typescript-eslint/no-explicit-any */
// Backend WhatsApp notifier for automations and notification dispatchers.
// It chooses an organization-scoped Evolution Go session and records the outbound message.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const EVOLUTION_GO_API_URL = (Deno.env.get("EVOLUTION_GO_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_GO_API_KEY = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
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

function optionalUuid(value: unknown) {
  const text = normalizeText(value).trim();
  return UUID_RE.test(text) ? text : null;
}

function normalizeDigits(value: unknown) {
  return normalizeText(value).replace(/\D/g, "");
}

function phoneMatches(left: unknown, right: unknown) {
  const leftDigits = normalizeDigits(left);
  const rightDigits = normalizeDigits(right);
  if (!leftDigits || !rightDigits) return false;
  return leftDigits === rightDigits || leftDigits.endsWith(rightDigits) || rightDigits.endsWith(leftDigits);
}

function normalizeJid(value: unknown) {
  const text = normalizeText(value).trim();
  if (!text) return "";
  if (text.includes("@")) return text;
  const digits = normalizeDigits(text);
  return digits ? `${digits}@s.whatsapp.net` : text;
}

function notificationText(notification: JsonRecord | undefined) {
  if (!notification) return "";
  const title = normalizeText(notification.title).trim();
  const content = normalizeText(firstPresent(notification.content, notification.message, notification.body)).trim();
  return [title, content].filter(Boolean).join("\n");
}

function truthyFlag(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function nestedNotificationRecord(body: JsonRecord) {
  return body.notification && typeof body.notification === "object"
    ? (body.notification as JsonRecord)
    : {};
}

function hasInternalNotificationFlag(body: JsonRecord) {
  const notification = nestedNotificationRecord(body);
  return [
    body.internal_notification,
    body.internalNotification,
    body.is_internal_notification,
    body.isInternalNotification,
    notification.internal_notification,
    notification.internalNotification,
  ].some(truthyFlag);
}

function isInternalNotificationPayload(body: JsonRecord, text: string, lead: JsonRecord | null) {
  const notification = nestedNotificationRecord(body);

  if (hasInternalNotificationFlag(body)) return true;

  const eventKey = normalizeText(firstPresent(
    body.event_key,
    body.eventKey,
    body.notification_type,
    body.notificationType,
    notification.event_key,
    notification.eventKey,
  )).toLowerCase();
  if (["new_lead_received", "lead_received", "new_lead"].includes(eventKey)) return true;

  if (!lead) return false;

  return /novo lead|lead recebido/i.test(text);
}

async function loadLead(organizationId: string, leadId?: string | null) {
  const normalizedLeadId = optionalUuid(leadId);
  if (!normalizedLeadId) return null;
  const { data, error } = await supabase
    .from("leads")
    .select("id, name, phone, assigned_user_id")
    .eq("id", normalizedLeadId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

function extractSentMessageId(data: any) {
  const paths = [
    "sentMessageId",
    "messageId",
    "messageID",
    "MessageID",
    "id",
    "ID",
    "key.id",
    "Key.ID",
    "data.sentMessageId",
    "data.messageId",
    "data.MessageID",
    "data.id",
    "data.key.id",
    "data.Key.ID",
  ];

  for (const path of paths) {
    const value = path.split(".").reduce((acc, key) => acc?.[key], data);
    if (value) return String(value);
  }
  return null;
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Unauthorized" };
  const bearer = authHeader.replace("Bearer ", "").trim();
  if (bearer === SERVICE_KEY) return { serviceRole: true, userId: "service_role" };

  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data?.user) return { error: "Unauthorized" };
  return { serviceRole: false, userId: data.user.id };
}

async function getRequester(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, role, is_active")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function canUseOrganization(userId: string, organizationId: string) {
  const requester = await getRequester(userId);
  if (!requester?.is_active) return false;
  if (requester.role === "super_admin") return true;

  const { data, error } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function selectSession(organizationId: string, sessionId?: string | null) {
  const normalizedSessionId = optionalUuid(sessionId);
  if (normalizeText(sessionId).trim() && !normalizedSessionId) return null;
  if (normalizedSessionId) {
    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("id", normalizedSessionId)
      .eq("organization_id", organizationId)
      .eq("provider", "evolution_go")
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("provider", "evolution_go")
    .eq("status", "connected")
    .eq("is_active", true)
    .order("is_notification_session", { ascending: false })
    .order("last_connected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

function instanceKey(session: JsonRecord) {
  return firstPresent(
    session.advanced_settings?.evolution_go_resolved_instance_key,
    session.instance_id,
    session.instance_name,
    session.provider_instance_id,
  );
}

function sessionToken(session: JsonRecord) {
  const token = session.advanced_settings?.token;
  return token && token !== "default_token" ? token : EVOLUTION_GO_API_KEY;
}

async function evolutionSendText(session: JsonRecord, numberOrJid: string, text: string) {
  if (!EVOLUTION_GO_API_URL || !EVOLUTION_GO_API_KEY) {
    throw new Error("Evolution Go API configuration missing");
  }

  const response = await fetch(`${EVOLUTION_GO_API_URL}/send/text`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: sessionToken(session),
      instanceId: instanceKey(session),
    },
    body: JSON.stringify({ number: numberOrJid, text }),
  });

  const rawText = await response.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }

  return { ok: response.ok, status: response.status, data, rawText };
}

async function ensureConversation(
  session: JsonRecord,
  remoteJid: string,
  lead: JsonRecord | null,
  metadata: JsonRecord,
  internalNotification: boolean,
) {
  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) {
    if (internalNotification && existing.lead_id) {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .update({
          lead_id: null,
          metadata: {
            ...(existing.metadata || {}),
            ...metadata,
            internal_notification: true,
            notification_lead_id: metadata.notification_lead_id || existing.lead_id,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    }
    return existing;
  }

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      organization_id: session.organization_id,
      session_id: session.id,
      lead_id: internalNotification ? null : lead?.id || null,
      assigned_user_id: optionalUuid(lead?.assigned_user_id) || optionalUuid(session.owner_user_id) || null,
      remote_jid: remoteJid,
      contact_name: internalNotification ? normalizeDigits(remoteJid) : lead?.name || normalizeDigits(remoteJid),
      contact_phone: normalizeDigits(remoteJid),
      is_group: remoteJid.endsWith("@g.us"),
      unread_count: 0,
      metadata: { source: "whatsapp_notifier", ...metadata },
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function recordOutboundMessage(
  session: JsonRecord,
  conversation: JsonRecord,
  text: string,
  providerMessageId: string | null,
  metadata: JsonRecord,
  internalNotification: boolean,
) {
  const messageId = providerMessageId || `notifier:${conversation.remote_jid}:${Date.now()}`;
  const sentAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversation.id,
      session_id: session.id,
      lead_id: internalNotification ? null : optionalUuid(conversation.lead_id),
      message_id: messageId,
      provider_message_id: messageId,
      from_me: true,
      direction: "outbound",
      message_type: "text",
      content: text,
      remote_jid: conversation.remote_jid,
      status: providerMessageId ? "sent" : "pending",
      sent_at: sentAt,
      metadata: { source: "whatsapp_notifier", ...metadata },
    })
    .select("*")
    .single();

  if (error) throw error;

  await supabase
    .from("whatsapp_conversations")
    .update({
      last_message: text,
      last_message_preview: text,
      last_message_at: sentAt,
      updated_at: sentAt,
    })
    .eq("id", conversation.id);

  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  try {
    const auth = await authenticate(req);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const nestedNotification = nestedNotificationRecord(body);
    const organizationId = optionalUuid(firstPresent(body.organization_id, body.organizationId));
    const text = normalizeText(firstPresent(body.text, body.message, body.content, notificationText(nestedNotification)));
    let remoteJid = normalizeJid(firstPresent(body.jid, body.remote_jid, body.remoteJid, body.phone, body.to, body.recipient, body.user?.whatsapp));
    const leadId = firstPresent(body.lead_id, body.leadId, nestedNotification?.lead_id, nestedNotification?.leadId);

    if (!organizationId) return json({ ok: false, error: "organization_id is required" }, 400);
    if (!remoteJid) return json({ ok: false, error: "phone or jid is required" }, 400);
    if (!text) return json({ ok: false, error: "message text is required" }, 400);

    if (!auth.serviceRole && !await canUseOrganization(auth.userId!, organizationId)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const session = await selectSession(organizationId, body.session_id || body.sessionId);
    if (!session) return json({ ok: false, error: "No WhatsApp notification session available" }, 404);
    if (session.status !== "connected") return json({ ok: false, error: "WhatsApp session is not connected" }, 409);

    const lead = await loadLead(organizationId, leadId);
    const internalNotification = isInternalNotificationPayload(body, text, lead);
    if (internalNotification) {
      const userWhatsApp = normalizeJid(body.user && typeof body.user === "object" ? (body.user as JsonRecord).whatsapp : null);
      if (userWhatsApp) remoteJid = userWhatsApp;
    }

    if (internalNotification && lead) {
      const destinationIsLead = [lead.phone, lead.whatsapp].some((phone) => phoneMatches(remoteJid, phone));
      if (destinationIsLead) {
        return json({
          ok: false,
          error: "Internal notification recipient cannot be the lead phone",
        }, 400);
      }
    }

    const internalMetadata = internalNotification
      ? {
          internal_notification: true,
          notification_lead_id: lead?.id || optionalUuid(leadId) || null,
          notification_type: normalizeText(firstPresent(body.event_key, body.eventKey, nestedNotification?.event_key, nestedNotification?.eventKey, nestedNotification?.type)) || "notification",
          notification_recipient_user_id: optionalUuid(firstPresent(body.user_id, body.userId, body.user?.id)) || null,
        }
      : {};

    const destination = remoteJid.endsWith("@g.us") ? remoteJid : normalizeDigits(remoteJid);
    const result = await evolutionSendText(session, destination, text);
    const providerMessageId = result.ok ? extractSentMessageId(result.data) : null;
    const conversation = await ensureConversation(session, remoteJid, lead, internalMetadata, internalNotification);
    const message = await recordOutboundMessage(session, conversation, text, providerMessageId, internalMetadata, internalNotification);

    if (!result.ok) {
      await supabase
        .from("whatsapp_messages")
        .update({ status: "failed", error_message: result.rawText || "Evolution Go send failed" })
        .eq("id", message.id);
    }

    return json({
      ok: result.ok,
      status: result.status,
      data: result.data,
      session_id: session.id,
      conversation_id: conversation.id,
      message_id: message.id,
      provider_message_id: providerMessageId,
      error: result.ok ? undefined : result.rawText,
    }, result.ok ? 200 : 502);
  } catch (error) {
    console.error("whatsapp-notifier error:", error);
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
