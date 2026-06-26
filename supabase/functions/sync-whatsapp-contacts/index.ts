/* eslint-disable @typescript-eslint/no-explicit-any */
// Sync contact names and avatars for one Evolution Go WhatsApp session.
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

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Unauthorized" };
  const bearer = authHeader.replace("Bearer ", "").trim();
  if (bearer === SERVICE_KEY) return { serviceRole: true, userId: "service_role" };

  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data?.user) return { error: "Unauthorized" };
  return { serviceRole: false, userId: data.user.id };
}

async function getSession(sessionId: string) {
  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("provider", "evolution_go")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function assertSessionAccess(session: JsonRecord, userId: string) {
  if (userId === "service_role") return;
  if (session.owner_user_id === userId) return;

  const { data: member } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", session.organization_id)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (member?.role && ["owner", "admin", "manager"].includes(String(member.role).toLowerCase())) return;

  const { data: access } = await supabase
    .from("whatsapp_session_access")
    .select("can_view, can_read")
    .eq("session_id", session.id)
    .eq("user_id", userId)
    .maybeSingle();

  if (access?.can_view || access?.can_read) return;
  throw new Error("Forbidden");
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

async function evolutionFetch(session: JsonRecord, method: string, path: string, body?: JsonRecord) {
  if (!EVOLUTION_GO_API_URL || !EVOLUTION_GO_API_KEY) {
    throw new Error("Evolution Go API configuration missing");
  }

  const url = new URL(`${EVOLUTION_GO_API_URL}${path}`);
  const key = instanceKey(session);

  const response = await fetch(url.toString(), {
    method,
    headers: {
      "Content-Type": "application/json",
      apikey: sessionToken(session),
      instanceId: key,
    },
    body: body && method !== "GET" ? JSON.stringify(body) : undefined,
  });

  const rawText = await response.text();
  let data: any = null;
  try {
    data = rawText ? JSON.parse(rawText) : null;
  } catch {
    data = { raw: rawText };
  }
  return { ok: response.ok, status: response.status, data };
}

function toContactList(value: any): JsonRecord[] {
  const candidates = [
    value?.contacts,
    value?.data?.contacts,
    value?.data,
    value,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate.filter((item) => typeof item === "object" && item !== null);
  }
  return [];
}

function avatarFromPayload(value: any) {
  return normalizeText(firstPresent(
    value?.picture,
    value?.profilePicture,
    value?.profilePicUrl,
    value?.avatar,
    value?.url,
    value?.data?.picture,
    value?.data?.profilePicture,
    value?.data?.profilePicUrl,
    value?.data?.url,
  )) || null;
}

async function fetchAvatar(session: JsonRecord, jid: string) {
  const number = normalizeDigits(jid);
  if (!number) return null;
  const result = await evolutionFetch(session, "POST", "/user/avatar", { number, preview: true });
  return result.ok ? avatarFromPayload(result.data) : null;
}

async function updateConversationContact(session: JsonRecord, conversation: JsonRecord, contact: JsonRecord) {
  const jid = normalizeJid(firstPresent(contact.jid, contact.id, contact.remoteJid, contact.number, conversation.remote_jid));
  const name = normalizeText(firstPresent(contact.name, contact.pushName, contact.notifyName, contact.verifiedName));
  const avatar = avatarFromPayload(contact) || await fetchAvatar(session, jid);

  const updates: JsonRecord = {
    contact_name: name || conversation.contact_name,
    contact_picture: avatar || conversation.contact_picture,
    updated_at: new Date().toISOString(),
    metadata: {
      ...(conversation.metadata || {}),
      contact_synced_at: new Date().toISOString(),
    },
  };

  await supabase
    .from("whatsapp_conversations")
    .update(updates)
    .eq("id", conversation.id)
    .eq("organization_id", session.organization_id);

  if (conversation.lead_id && avatar) {
    await supabase
      .from("leads")
      .update({
        whatsapp_avatar_url: avatar,
        whatsapp_avatar_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.lead_id)
      .eq("organization_id", session.organization_id);
  }

  return Boolean(avatar || name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const auth = await authenticate(req);
    if (auth.error) return json({ success: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = body.session_id || body.sessionId;
    if (!sessionId) return json({ success: false, error: "session_id is required" }, 400);

    const session = await getSession(sessionId);
    if (!session) return json({ success: false, error: "WhatsApp session not found" }, 404);
    await assertSessionAccess(session, auth.userId!);

    const limit = Math.min(Number(body.limit || 100), 500);
    const { data: conversations, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, organization_id, session_id, lead_id, remote_jid, contact_name, contact_picture, metadata")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("is_group", false)
      .is("deleted_at", null)
      .limit(limit);

    if (error) throw error;

    const contactsResult = await evolutionFetch(session, "GET", "/user/contacts");
    const contacts = toContactList(contactsResult.data);
    const contactByJid = new Map<string, JsonRecord>();
    for (const contact of contacts) {
      const jid = normalizeJid(firstPresent(contact.jid, contact.id, contact.remoteJid, contact.number));
      if (jid) contactByJid.set(jid, contact);
    }

    let updated = 0;
    for (const conversation of conversations || []) {
      const contact = contactByJid.get(conversation.remote_jid) || { jid: conversation.remote_jid };
      if (await updateConversationContact(session, conversation, contact)) updated += 1;
    }

    return json({
      success: true,
      session_id: session.id,
      scanned: conversations?.length || 0,
      contactsFound: contacts.length,
      updated,
    });
  } catch (error) {
    console.error("sync-whatsapp-contacts error:", error);
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
