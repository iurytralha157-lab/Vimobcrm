/* eslint-disable @typescript-eslint/no-explicit-any */
// Restricted WhatsApp history reader.
// Uses service role for joins/storage compatibility, then applies lead/session access in code.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizeRole(role?: string | null) {
  return String(role || "").toLowerCase();
}

async function authenticate(req: Request) {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return null;

  const bearer = authHeader.replace("Bearer ", "").trim();
  const { data, error } = await supabase.auth.getUser(bearer);
  if (error || !data?.user) return null;
  return data.user;
}

async function getRequester(userId: string) {
  const { data, error } = await supabase
    .from("users")
    .select("id, organization_id, role, is_active, name, email")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getOrgMember(userId: string, organizationId: string) {
  const { data, error } = await supabase
    .from("organization_members")
    .select("role, is_active")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function hasPermission(userId: string, organizationId: string, permissionKey: string) {
  const { data: roles, error: rolesError } = await supabase
    .from("user_organization_roles")
    .select("role_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .eq("is_active", true);

  if (rolesError) throw rolesError;
  const roleIds = (roles || []).map((role: JsonRecord) => role.role_id).filter(Boolean);
  if (!roleIds.length) return false;

  const { data, error } = await supabase
    .from("organization_role_permissions")
    .select("id, available_permissions!inner(key)")
    .eq("organization_id", organizationId)
    .in("role_id", roleIds)
    .eq("available_permissions.key", permissionKey)
    .limit(1);

  if (error) throw error;
  return Boolean(data?.length);
}

async function canAccessLead(requester: JsonRecord, lead: JsonRecord) {
  if (!lead) return false;
  if (normalizeRole(requester.role) === "super_admin") return true;
  if (requester.organization_id !== lead.organization_id) return false;
  if (lead.assigned_user_id === requester.id) return true;

  const member = await getOrgMember(requester.id, lead.organization_id);
  const memberRole = normalizeRole(member?.role);
  if (["owner", "admin", "manager"].includes(memberRole)) return true;

  if (await hasPermission(requester.id, lead.organization_id, "lead_view_all")) return true;

  if (lead.assigned_user_id && await hasPermission(requester.id, lead.organization_id, "lead_view_team")) {
    const { data, error } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("organization_id", lead.organization_id)
      .eq("user_id", requester.id)
      .eq("is_active", true)
      .eq("is_leader", true);

    if (error) throw error;
    const teamIds = (data || []).map((row: JsonRecord) => row.team_id);
    if (teamIds.length) {
      const { data: memberMatch, error: memberError } = await supabase
        .from("team_members")
        .select("id")
        .eq("organization_id", lead.organization_id)
        .eq("user_id", lead.assigned_user_id)
        .eq("is_active", true)
        .in("team_id", teamIds)
        .limit(1);

      if (memberError) throw memberError;
      if (memberMatch?.length) return true;
    }
  }

  return false;
}

async function getLead(leadId: string) {
  const { data, error } = await supabase
    .from("leads")
    .select("id, organization_id, assigned_user_id")
    .eq("id", leadId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getConversation(conversationId: string) {
  const { data, error } = await supabase
    .from("whatsapp_conversations")
    .select("*, session:whatsapp_sessions(id, organization_id, owner_user_id, instance_name, display_name, provider, status)")
    .eq("id", conversationId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function canAccessSessionConversation(requester: JsonRecord, conversation: JsonRecord) {
  if (normalizeRole(requester.role) === "super_admin") return true;
  if (requester.organization_id !== conversation.organization_id) return false;

  const session = conversation.session || {};
  if (session.owner_user_id === requester.id) return true;

  const member = await getOrgMember(requester.id, conversation.organization_id);
  const memberRole = normalizeRole(member?.role);
  if (["owner", "admin", "manager"].includes(memberRole)) return true;

  const { data: access, error } = await supabase
    .from("whatsapp_session_access")
    .select("can_view, can_read, can_send, access_mode")
    .eq("session_id", conversation.session_id)
    .eq("user_id", requester.id)
    .maybeSingle();

  if (error) throw error;
  const canView = access?.can_view ?? access?.can_read ?? false;
  if (!canView) return false;
  if (access?.access_mode === "full_inbox") return true;
  if (!conversation.lead_id) return false;

  const lead = await getLead(conversation.lead_id);
  if (!lead) return false;
  return canAccessLead(requester, lead);
}

async function canViewConversation(requester: JsonRecord, conversation: JsonRecord) {
  if (!conversation || conversation.deleted_at) return false;
  if (conversation.lead_id) {
    const lead = await getLead(conversation.lead_id);
    if (lead && await canAccessLead(requester, lead)) return true;
  }

  return canAccessSessionConversation(requester, conversation);
}

async function loadMessages(conversationIds: string[], limit: number) {
  if (!conversationIds.length) return [];
  const { data, error } = await supabase
    .from("whatsapp_messages")
    .select("*")
    .in("conversation_id", conversationIds)
    .order("sent_at", { ascending: true })
    .limit(limit);

  if (error) throw error;
  const messages = data || [];
  const sessionIds = [...new Set(messages.map((message: JsonRecord) => message.session_id).filter(Boolean))];

  const sessionById = new Map<string, JsonRecord>();
  if (sessionIds.length) {
    const { data: sessions } = await supabase
      .from("whatsapp_sessions")
      .select("id, instance_name, display_name, owner_user_id")
      .in("id", sessionIds);
    for (const session of sessions || []) sessionById.set(session.id, session);
  }

  const ownerIds = [...new Set([...sessionById.values()].map((session) => session.owner_user_id).filter(Boolean))];
  const ownerById = new Map<string, JsonRecord>();
  if (ownerIds.length) {
    const { data: owners } = await supabase
      .from("users")
      .select("id, name, email")
      .in("id", ownerIds);
    for (const owner of owners || []) ownerById.set(owner.id, owner);
  }

  return messages.map((message: JsonRecord) => {
    const session = sessionById.get(message.session_id);
    const owner = session?.owner_user_id ? ownerById.get(session.owner_user_id) : null;
    return {
      ...message,
      session_instance_name: session?.display_name || session?.instance_name || null,
      session_owner_name: owner?.name || owner?.email || null,
    };
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const user = await authenticate(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const requester = await getRequester(user.id);
    if (!requester?.is_active) return json({ error: "Usuario sem acesso." }, 403);

    const body = await req.json().catch(() => ({}));
    const leadId = body.leadId || body.lead_id || null;
    const conversationId = body.conversationId || body.conversation_id || null;
    const limit = Math.min(Number(body.limit || (body.allMessages ? 500 : 80)), 1000);

    let conversations: JsonRecord[] = [];

    if (conversationId) {
      const conversation = await getConversation(conversationId);
      if (!conversation || !await canViewConversation(requester, conversation)) {
        return json({ error: "Conversa nao encontrada ou sem permissao." }, 403);
      }
      conversations = [conversation];
    }

    if (leadId) {
      const lead = await getLead(leadId);
      if (!lead || !await canAccessLead(requester, lead)) {
        return json({ error: "Lead nao encontrado ou sem permissao." }, 403);
      }

      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*, session:whatsapp_sessions(id, organization_id, owner_user_id, instance_name, display_name, provider, status)")
        .eq("lead_id", leadId)
        .is("deleted_at", null)
        .order("last_message_at", { ascending: false });

      if (error) throw error;
      const byId = new Map(conversations.map((conversation) => [conversation.id, conversation]));
      for (const conversation of data || []) {
        if (!byId.has(conversation.id) && await canViewConversation(requester, conversation)) {
          byId.set(conversation.id, conversation);
        }
      }
      conversations = [...byId.values()];
    }

    if (!conversationId && !leadId) return json({ error: "conversationId ou leadId e obrigatorio." }, 400);

    const messages = await loadMessages(conversations.map((conversation) => conversation.id), limit);
    return json({
      conversation: conversations[0] || null,
      conversations,
      messages,
    });
  } catch (error) {
    console.error("whatsapp-history-access error:", error);
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
