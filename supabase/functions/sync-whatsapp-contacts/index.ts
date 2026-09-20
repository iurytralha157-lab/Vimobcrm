/* eslint-disable @typescript-eslint/no-explicit-any */
// Sync contact names and avatars for one Evolution Go WhatsApp session.
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  assertWhatsAppConversationBindingSnapshot,
  type WhatsAppConversationBindingRow,
  type WhatsAppConversationBindingSnapshot,
  WhatsAppBindingSnapshotError,
} from "../_shared/whatsapp-binding-snapshot.ts";

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
  const normalizedSessionId = optionalUuid(sessionId);
  if (!normalizedSessionId) return null;

  const { data, error } = await supabase
    .from("whatsapp_sessions")
    .select("*")
    .eq("id", normalizedSessionId)
    .eq("provider", "evolution_go")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function assertSessionAccess(session: JsonRecord, userId: string) {
  if (userId === "service_role") return;
  if (session.owner_user_id === userId) return;

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

async function updateConversationContact(
  session: JsonRecord,
  conversation: JsonRecord,
  contact: JsonRecord,
  activeBindings: WhatsAppConversationBindingRow[],
) {
  let snapshot: WhatsAppConversationBindingSnapshot;
  try {
    snapshot = assertWhatsAppConversationBindingSnapshot({
      conversation,
      activeBindings,
      expectedLeadId: optionalUuid(conversation.lead_id),
    });
  } catch (error) {
    const reason = error instanceof WhatsAppBindingSnapshotError
      ? error.code
      : "whatsapp_binding_snapshot_invalid";
    console.warn("Skipping stale WhatsApp contact snapshot", {
      conversation_id: conversation.id,
      reason,
    });
    return false;
  }

  if (!snapshot.conversationUpdatedAt || snapshot.sessionId !== session.id) {
    console.warn("Skipping WhatsApp contact without a current session snapshot", {
      conversation_id: conversation.id,
    });
    return false;
  }

  const jid = normalizeJid(firstPresent(contact.jid, contact.id, contact.remoteJid, contact.number, conversation.remote_jid));
  const name = normalizeText(firstPresent(contact.name, contact.pushName, contact.notifyName, contact.verifiedName));
  const avatar = avatarFromPayload(contact) || await fetchAvatar(session, jid);
  const syncedAt = new Date().toISOString();

  const updates: JsonRecord = {
    contact_name: name || conversation.contact_name,
    contact_picture: avatar || conversation.contact_picture,
    updated_at: syncedAt,
    metadata: {
      ...(conversation.metadata || {}),
      contact_synced_at: syncedAt,
    },
  };

  let updateQuery = supabase
    .from("whatsapp_conversations")
    .update(updates)
    .eq("id", conversation.id)
    .eq("organization_id", session.organization_id)
    .eq("session_id", session.id)
    .eq("updated_at", snapshot.conversationUpdatedAt);
  updateQuery = snapshot.leadId
    ? updateQuery.eq("lead_id", snapshot.leadId)
    : updateQuery.is("lead_id", null);

  const { data: updated, error: updateError } = await updateQuery
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updated?.id) {
    console.warn("Skipped WhatsApp contact update after binding CAS loss", {
      conversation_id: conversation.id,
      binding_id: snapshot.bindingId,
    });
    return false;
  }

  // Do not project a provider avatar into `leads` from this asynchronous
  // snapshot. The physical thread may be rebound immediately after this CAS,
  // and a second REST update cannot atomically prove the same binding. Lead
  // avatar enrichment remains owned by the queue-scoped intake transaction.

  return Boolean(avatar || name);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ success: false, error: "Method not allowed" }, 405);

  try {
    const auth = await authenticate(req);
    if (auth.error) return json({ success: false, error: auth.error }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = optionalUuid(firstPresent(body.session_id, body.sessionId));
    if (!sessionId) return json({ success: false, error: "session_id is required" }, 400);

    const session = await getSession(sessionId);
    if (!session) return json({ success: false, error: "WhatsApp session not found" }, 404);
    await assertSessionAccess(session, auth.userId!);

    const limit = Math.min(Number(body.limit || 100), 500);
    const { data: conversations, error } = await supabase
      .from("whatsapp_conversations")
      .select("id, organization_id, session_id, lead_id, remote_jid, contact_name, contact_picture, metadata, updated_at")
      .eq("organization_id", session.organization_id)
      .eq("session_id", session.id)
      .eq("is_group", false)
      .is("deleted_at", null)
      .limit(limit);

    if (error) throw error;

    const conversationIds = (conversations || []).map((conversation) => conversation.id);
    const activeBindingsByConversation = new Map<string, WhatsAppConversationBindingRow[]>();
    if (conversationIds.length > 0) {
      const { data: activeBindings, error: bindingError } = await supabase
        .from("whatsapp_conversation_lead_bindings")
        .select("id, organization_id, conversation_id, session_id, lead_id, active_to, stale")
        .eq("organization_id", session.organization_id)
        .in("conversation_id", conversationIds)
        .is("active_to", null);
      if (bindingError) throw bindingError;

      for (const binding of activeBindings || []) {
        const list = activeBindingsByConversation.get(binding.conversation_id) || [];
        list.push(binding);
        activeBindingsByConversation.set(binding.conversation_id, list);
      }
    }

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
      if (await updateConversationContact(
        session,
        conversation,
        contact,
        activeBindingsByConversation.get(conversation.id) || [],
      )) updated += 1;
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
