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

function normalizeDigits(value: unknown) {
  return normalizeText(value).replace(/\D/g, "");
}

function normalizeJid(value: unknown) {
  const text = normalizeText(value).trim();
  if (!text) return "";
  if (text.includes("@")) return text;
  const digits = normalizeDigits(text);
  return digits ? `${digits}@s.whatsapp.net` : text;
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
  if (sessionId) {
    const { data, error } = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("id", sessionId)
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

async function ensureConversation(session: JsonRecord, remoteJid: string, leadId?: string | null) {
  const { data: existing, error: existingError } = await supabase
    .from("whatsapp_conversations")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("remote_jid", remoteJid)
    .maybeSingle();

  if (existingError) throw existingError;
  if (existing) return existing;

  let lead: JsonRecord | null = null;
  if (leadId) {
    const { data } = await supabase
      .from("leads")
      .select("id, name, phone, whatsapp, assigned_user_id")
      .eq("id", leadId)
      .eq("organization_id", session.organization_id)
      .maybeSingle();
    lead = data;
  }

  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .insert({
      organization_id: session.organization_id,
      session_id: session.id,
      lead_id: lead?.id || null,
      assigned_user_id: lead?.assigned_user_id || session.owner_user_id || null,
      remote_jid: remoteJid,
      contact_name: lead?.name || normalizeDigits(remoteJid),
      contact_phone: normalizeDigits(remoteJid),
      is_group: remoteJid.endsWith("@g.us"),
      unread_count: 0,
      metadata: { source: "whatsapp_notifier" },
    })
    .select("*")
    .single();

  if (error) throw error;
  return data;
}

async function recordOutboundMessage(session: JsonRecord, conversation: JsonRecord, text: string, providerMessageId: string | null) {
  const messageId = providerMessageId || `notifier:${conversation.remote_jid}:${Date.now()}`;
  const sentAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("whatsapp_messages")
    .insert({
      organization_id: session.organization_id,
      conversation_id: conversation.id,
      session_id: session.id,
      lead_id: conversation.lead_id,
      message_id: messageId,
      provider_message_id: messageId,
      from_me: true,
      message_type: "text",
      content: text,
      remote_jid: conversation.remote_jid,
      status: providerMessageId ? "sent" : "pending",
      sent_at: sentAt,
      metadata: { source: "whatsapp_notifier" },
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
    const organizationId = body.organization_id || body.organizationId;
    const text = normalizeText(firstPresent(body.text, body.message, body.content));
    const remoteJid = normalizeJid(firstPresent(body.jid, body.remote_jid, body.remoteJid, body.phone, body.to));

    if (!organizationId) return json({ ok: false, error: "organization_id is required" }, 400);
    if (!remoteJid) return json({ ok: false, error: "phone or jid is required" }, 400);
    if (!text) return json({ ok: false, error: "message text is required" }, 400);

    if (!auth.serviceRole && !await canUseOrganization(auth.userId!, organizationId)) {
      return json({ ok: false, error: "Forbidden" }, 403);
    }

    const session = await selectSession(organizationId, body.session_id || body.sessionId);
    if (!session) return json({ ok: false, error: "No WhatsApp notification session available" }, 404);
    if (session.status !== "connected") return json({ ok: false, error: "WhatsApp session is not connected" }, 409);

    const destination = remoteJid.endsWith("@g.us") ? remoteJid : normalizeDigits(remoteJid);
    const result = await evolutionSendText(session, destination, text);
    const providerMessageId = result.ok ? extractSentMessageId(result.data) : null;
    const conversation = await ensureConversation(session, remoteJid, body.lead_id || body.leadId);
    const message = await recordOutboundMessage(session, conversation, text, providerMessageId);

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
