import { createClient } from "npm:@supabase/supabase-js@2.110.7";
import { decode } from "https://deno.land/std@0.177.0/encoding/base64.ts";
import {
  claimEvolutionMessageDelivery,
  completeEvolutionMessageDelivery,
  EvolutionMessageClaimError,
  retryEvolutionMessageDelivery,
  type OwnedEvolutionMessageClaim,
} from "./delivery-claim.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
} from "../_shared/supabase-secret-keys.ts";
import {
  authorizeEvolutionWebhookIngressRequest,
  validateEvolutionCallbackSessionToken,
} from "./request-security.ts";

const MAGIC_BYTES: Record<string, string[]> = {
  'image/jpeg': ['FFD8FF'],
  'image/png': ['89504E47'],
  'image/gif': ['47494638'],
  'image/webp': ['52494646'],
  'audio/mpeg': ['494433', 'FFF1', 'FFF9'],
  'audio/ogg': ['4F676753'],
  'audio/mp4': ['000000'],
  'video/mp4': ['000000'],
  'application/pdf': ['25504446'],
};

// ============================================================
// INBOUND RULES — identify & route incoming WhatsApp messages
// ============================================================
type InboundRule = {
  id: string;
  organization_id: string;
  session_id: string | null;
  priority: number;
  is_active: boolean;
  match_type: "contains" | "equals" | "regex" | "utm" | "meta_ctwa" | "any";
  match_value: string | null;
  match_field: string | null;
  target_round_robin_id: string | null;
  target_team_id: string | null;
  target_user_id: string | null;
  target_pipeline_id: string | null;
  target_stage_id: string | null;
  source_label: string | null;
  campaign_label: string | null;
};

type ResolvedWebhookSession = {
  id: string;
  organization_id: string;
  provider?: string | null;
  instance_id?: string | null;
  instance_name?: string | null;
  provider_instance_id?: string | null;
  name?: string | null;
  is_active?: boolean | null;
  status?: string | null;
  advanced_settings?: { webhook_token?: string | null } | null;
  [key: string]: unknown;
};

function extractAdContext(contextInfo: any) {
  const ext = contextInfo?.externalAdReply || {};
  return {
    meta_campaign_id: ext.sourceId || ext.ctwaClid || null,
    meta_ad_id: ext.sourceId || null,
    meta_click_id: ext.ctwaClid || null,
    meta_adset_id: null,
    headline: ext.title || null,
    body: ext.body || null,
    source_url: ext.sourceUrl || null,
  };
}

function extractUtmFromText(text: string) {
  const utm: Record<string, string> = {};
  if (!text) return utm;
  const params = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  for (const p of params) {
    const m = text.match(new RegExp(`${p}=([^\\s&]+)`, "i"));
    if (m) utm[p] = decodeURIComponent(m[1]);
  }
  return utm;
}

async function recordLeadMetaFromWhatsApp(
  supabase: any,
  leadId: string,
  hubCtx: { rule: any | null; adContext: any; utm: Record<string, string> } | null,
  isFromAds: boolean,
  adSource: string | null
) {
  const rule = hubCtx?.rule || null;
  const adCtx = hubCtx?.adContext || {};
  const utm = hubCtx?.utm || {};
  const campaignId = adCtx.meta_campaign_id || utm.utm_campaign || rule?.campaign_label || null;
  const campaignName = rule?.campaign_label || utm.utm_campaign || adCtx.headline || campaignId;

  if (!campaignId && !campaignName && !adCtx.meta_ad_id && !adCtx.meta_click_id && Object.keys(utm).length === 0) {
    return;
  }

  const { error } = await supabase.from("lead_meta").insert({
    lead_id: leadId,
    campaign_id: campaignId,
    campaign_name: campaignName,
    ad_id: adCtx.meta_ad_id || null,
    ad_name: adCtx.headline || null,
    adset_id: adCtx.meta_adset_id || null,
    adset_name: null,
    platform: isFromAds ? "whatsapp_meta" : "whatsapp",
    source_type: "whatsapp",
    utm_source: utm.utm_source || null,
    utm_medium: utm.utm_medium || null,
    utm_campaign: utm.utm_campaign || rule?.campaign_label || null,
    utm_content: utm.utm_content || null,
    utm_term: utm.utm_term || null,
    raw_payload: {
      source: "evolution_webhook",
      from_ads: isFromAds,
      ad_source: adSource,
      ad_context: adCtx,
      utm,
      inbound_rule_id: rule?.id || null,
    },
  });

  if (error) {
    console.error("Error recording WhatsApp lead meta:", error);
  }
}

async function applyInboundRules(
  supabase: any,
  session: any,
  ctx: { content: string; pushName: string; phone: string; adContext: any; utm: Record<string, string> }
): Promise<InboundRule | null> {
  const { data: rules } = await supabase
    .from("whatsapp_inbound_rules")
    .select("*")
    .eq("organization_id", session.organization_id)
    .eq("is_active", true)
    .order("priority", { ascending: true });
  if (!rules || rules.length === 0) return null;

  for (const rule of rules as InboundRule[]) {
    if (rule.session_id && rule.session_id !== session.id) continue;
    const field = (rule.match_field || "message").toLowerCase();
    let haystack = "";
    if (field === "message") haystack = ctx.content || "";
    else if (field === "push_name") haystack = ctx.pushName || "";
    else if (field === "phone") haystack = ctx.phone || "";
    else if (field === "meta_source_id") haystack = ctx.adContext?.meta_campaign_id || "";

    const value = (rule.match_value || "").toString();
    try {
      switch (rule.match_type) {
        case "any":
          return rule;
        case "meta_ctwa":
          if (ctx.adContext?.meta_campaign_id || ctx.adContext?.meta_click_id) return rule;
          break;
        case "utm":
          if (value && (ctx.utm["utm_campaign"] === value || ctx.utm["utm_source"] === value)) return rule;
          break;
        case "contains":
          if (value && haystack.toLowerCase().includes(value.toLowerCase())) return rule;
          break;
        case "equals":
          if (value && haystack.trim().toLowerCase() === value.trim().toLowerCase()) return rule;
          break;
        case "regex":
          if (value && new RegExp(value, "i").test(haystack)) return rule;
          break;
      }
    } catch (e) {
      console.error("[applyInboundRules] rule error", rule.id, e);
    }
  }
  return null;
}


function validateMagicBytes(content: Uint8Array, expectedMime: string): boolean {
  if (content.length < 4) return false;
  const hex = Array.from(content.slice(0, 8))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('').toUpperCase();

  const mimeBase = expectedMime.split(';')[0].toLowerCase();
  
  if (mimeBase === 'image/webp' && hex.startsWith('52494646')) return true;
  if ((mimeBase === 'video/mp4' || mimeBase === 'audio/mp4') && hex.includes('66747970')) return true;

  const expectedSignatures = MAGIC_BYTES[mimeBase];
  if (!expectedSignatures) return true;

  return expectedSignatures.some(sig => hex.startsWith(sig));
}

function normalizeBase64(base64: string): string {
  if (!base64) return "";
  return base64.replace(/^data:.*?;base64,/, '').replace(/[\r\n\s]/g, '');
}

function isValidBase64(str: string): boolean {
  if (!str || str.length % 4 !== 0) return false;
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str);
}

// Robust base64 extractor — checks every common location Evolution may use
function extractBase64FromPayload(
  message: any,
  messageData: any,
  payload: any,
  mediaContainer: any
): string | null {
  const candidates: any[] = [
    mediaContainer?.base64,
    mediaContainer?.mediaBase64,
    mediaContainer?.data,
    message?.base64,
    message?.mediaBase64,
    messageData?.base64,
    messageData?.mediaBase64,
    messageData?.message?.base64,
    payload?.base64,
    payload?.data?.base64,
    payload?.data?.message?.base64,
    payload?.media?.base64,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 100) return c;
  }
  return null;
}

// Convert WhatsApp jpegThumbnail (object with numeric keys or array) to Uint8Array
function jpegThumbnailToBytes(thumbnail: any): Uint8Array | null {
  if (!thumbnail) return null;
  try {
    if (Array.isArray(thumbnail)) return new Uint8Array(thumbnail);
    if (typeof thumbnail === "string") {
      const normalized = thumbnail.replace(/^data:.*?;base64,/, "").replace(/[\r\n\s]/g, "");
      if (normalized.length > 0) return decode(normalized);
    }
    if (typeof thumbnail === "object") {
      const keys = Object.keys(thumbnail).filter((k) => /^\d+$/.test(k));
      if (keys.length === 0) return null;
      const bytes = new Uint8Array(keys.length);
      for (const k of keys) bytes[Number(k)] = thumbnail[k];
      return bytes;
    }
  } catch (_e) {
    return null;
  }
  return null;
}

// Declare EdgeRuntime for background tasks
declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, x-api-key, x-webhook-secret, x-webhook-token, x-evolution-webhook-token, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Helper to normalize remote_jid to standard format
function normalizeRemoteJid(jid: string): string {
  if (!jid) return jid;
  // Groups stay as @g.us
  if (jid.endsWith("@g.us")) return jid;
  // Convert @c.us to @s.whatsapp.net for consistency
  return jid.replace("@c.us", "@s.whatsapp.net");
}

// Helper to extract clean phone number
function extractPhoneNumber(jid: string): string {
  return jid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace("@g.us", "");
}

// Helper to normalize phone number (remove country code 55 if present)
function normalizePhoneNumber(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/\D/g, '');
  // If starts with 55 and has 12+ digits, remove the 55
  if (cleaned.length >= 12 && cleaned.startsWith('55')) {
    return cleaned.substring(2);
  }
  return cleaned;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST, OPTIONS" },
      },
    );
  }

  try {
    // Authenticate before body parsing, privileged client creation or any I/O.
    // The durable Go worker has service auth plus a session-scoped token; a
    // direct callback needs both its global and session-scoped credentials.
    const secretEnvironment = readSupabaseSecretKeyEnvironment();
    const authorization = await authorizeEvolutionWebhookIngressRequest(req, {
      privateWorker: secretEnvironment,
      webhookSecret: Deno.env.get("EVOLUTION_WEBHOOK_SECRET"),
      providerApiKey: Deno.env.get("EVOLUTION_API_KEY"),
    });
    if (!authorization.authorized) {
      const missingServerSecret = authorization.reason === "missing_server_secret";
      console.error(`Evolution webhook authentication rejected: ${authorization.reason}`);
      return new Response(
        JSON.stringify({
          success: false,
          error: missingServerSecret ? "Webhook authentication unavailable" : "Unauthorized",
        }),
        {
          status: missingServerSecret ? 503 : 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // This legacy handler never accepts work leased by the canonical Go inbox
    // worker. That worker must target evolution-go-webhook; accepting its
    // envelope here would replay a different event schema under the wrong
    // processor while still returning a superficially successful response.
    if (authorization.contract === "internal_worker_lease") {
      console.error("Evolution webhook rejected an unsupported worker delivery contract");
      return new Response(
        JSON.stringify({ success: false, error: "Unsupported webhook delivery contract" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ADMIN_KEY = selectSupabaseAdminSecretKey(secretEnvironment);
    if (!SUPABASE_URL || !SUPABASE_ADMIN_KEY) {
      console.error("Evolution webhook rejected because its Supabase environment is incomplete");
      return new Response(
        JSON.stringify({ success: false, error: "Webhook temporarily unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY);

    const payload = await req.json();
    console.log("Evolution webhook received", { event: payload?.event });

    // Evolution API v2 payload format
    const event = payload.event;
    const instanceName = payload.instance;
    const data = payload.data;
    const requestUrl = new URL(req.url);
    const requestedSessionId = requestUrl.searchParams.get("session_id")?.trim() || "";

    // Direct callbacks may provide a session route hint; otherwise a globally
    // unambiguous active Evolution instance name is required.
    let session: ResolvedWebhookSession | null = null;
    let sessionError: unknown = null;
    let ambiguousSession = false;
    if (requestedSessionId) {
      const sessionLookup = await supabase
        .from("whatsapp_sessions")
        .select("*")
        .eq("id", requestedSessionId)
        .eq("provider", "evolution")
        .eq("is_active", true)
        .neq("status", "deleted")
        .maybeSingle();
      session = sessionLookup.data;
      sessionError = sessionLookup.error;
    } else if (typeof instanceName === "string" && instanceName.trim()) {
      const sessionLookup = await supabase
        .from("whatsapp_sessions")
        .select("*")
        .eq("instance_name", instanceName.trim())
        .eq("provider", "evolution")
        .eq("is_active", true)
        .neq("status", "deleted")
        .limit(2);
      sessionError = sessionLookup.error;
      ambiguousSession = Array.isArray(sessionLookup.data) && sessionLookup.data.length > 1;
      session = !ambiguousSession && sessionLookup.data?.length === 1
        ? sessionLookup.data[0]
        : null;
    }

    if (sessionError || !session) {
      console.error("Evolution webhook session could not be resolved uniquely");
      return new Response(
        JSON.stringify({
          success: false,
          error: ambiguousSession ? "Ambiguous webhook session" : "Webhook session not found",
        }),
        {
          status: ambiguousSession ? 409 : 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const callbackTokenBinding = await validateEvolutionCallbackSessionToken(
      req.headers,
      session,
    );
    if (!callbackTokenBinding.valid) {
      console.error(`Evolution callback session token rejected: ${callbackTokenBinding.reason}`);
      return new Response(
        JSON.stringify({ success: false, error: "Webhook session mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const expectedInstanceSignals = new Set(
      [session.instance_id, session.instance_name, session.provider_instance_id, session.name]
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()),
    );
    const suppliedInstanceSignals = [
      requestUrl.searchParams.get("instance_id"),
      typeof instanceName === "string" ? instanceName : "",
    ]
      .filter((value) => typeof value === "string" && value.trim())
      .map((value) => value.trim());
    if (
      expectedInstanceSignals.size === 0 || suppliedInstanceSignals.length === 0 ||
      suppliedInstanceSignals.some((value) => !expectedInstanceSignals.has(value))
    ) {
      console.error("Evolution webhook session/instance binding was rejected");
      return new Response(
        JSON.stringify({ success: false, error: "Webhook session mismatch" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ===== SECURITY: Validate session has organization_id =====
    if (!session.organization_id) {
      console.error(`Session ${session.id} has no organization_id - rejecting`);
      return new Response(
        JSON.stringify({ success: false, error: "Session not configured" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Re-read the session immediately before effects. A callback resolved just
    // before a disconnect/delete/provider migration must fail closed instead
    // of mutating CRM state with a stale privileged snapshot.
    const sessionRevalidation = await supabase
      .from("whatsapp_sessions")
      .select("*")
      .eq("id", session.id)
      .eq("organization_id", session.organization_id)
      .eq("provider", "evolution")
      .eq("is_active", true)
      .neq("status", "deleted")
      .maybeSingle();
    if (sessionRevalidation.error || !sessionRevalidation.data) {
      console.error("Evolution webhook session failed its pre-effect revalidation");
      return new Response(
        JSON.stringify({ success: false, error: "Webhook session unavailable" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    session = sessionRevalidation.data;

    const revalidatedCallbackToken = await validateEvolutionCallbackSessionToken(
      req.headers,
      session,
    );
    if (!revalidatedCallbackToken.valid) {
      console.error(`Evolution callback session token changed before effects: ${revalidatedCallbackToken.reason}`);
      return new Response(
        JSON.stringify({ success: false, error: "Webhook session unavailable" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const revalidatedInstanceSignals = new Set(
      [session.instance_id, session.instance_name, session.provider_instance_id, session.name]
        .filter((value) => typeof value === "string" && value.trim())
        .map((value) => value.trim()),
    );
    if (
      revalidatedInstanceSignals.size === 0 ||
      suppliedInstanceSignals.some((value) => !revalidatedInstanceSignals.has(value))
    ) {
      console.error("Evolution webhook session changed before effects");
      return new Response(
        JSON.stringify({ success: false, error: "Webhook session unavailable" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let messageResult: MessageUpsertResult | null = null;
    switch (event) {
      case "connection.update":
      case "CONNECTION_UPDATE":
        await handleConnectionUpdate(supabase, session, data);
        break;

      case "messages.upsert":
      case "MESSAGES_UPSERT":
        messageResult = await handleMessagesUpsert(
          supabase,
          session,
          data,
          SUPABASE_URL,
          SUPABASE_ADMIN_KEY,
          payload,
        );
        break;

      case "messages.update":
      case "MESSAGES_UPDATE":
        await handleMessagesUpdate(supabase, session, data);
        break;

      case "messages.delete":
      case "MESSAGES_DELETE":
        await handleMessagesDelete(supabase, session, data);
        break;

      case "presence.update":
      case "PRESENCE_UPDATE":
        await handlePresenceUpdate(supabase, session, data);
        break;

      case "send.message":
      case "SEND_MESSAGE":
        await handleSendMessage(supabase, session, data);
        break;

      case "groups.upsert":
      case "GROUPS_UPSERT":
        await handleGroupsUpsert(supabase, session, data);
        break;

      case "groups.update":
      case "GROUP_UPDATE":
        await handleGroupUpdate(supabase, session, data);
        break;

      case "qrcode.updated":
      case "QRCODE_UPDATED":
        console.log("QR Code updated for instance:", instanceName);
        break;

      default:
        console.log(`Unhandled event: ${event}`);
    }

    return new Response(
      JSON.stringify(messageResult
        ? { success: true, result: messageResult }
        : { success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Evolution webhook error:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Webhook processing failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function handleConnectionUpdate(supabase: any, session: any, data: any) {
  // Evolution v2 sends state in data directly or in instance object
  const state = data?.state || data?.instance?.state || data?.status;
  console.log(`Connection update for session ${session.id}: ${state}`, data);

  const previousStatus = session.status;
  const normalizedState = typeof state === "string" ? state.toLowerCase() : "";
  let status = "disconnected";

  // Strictly only "open" means connected in Evolution v2
  if (normalizedState === "open") {
    status = "connected";
  } else if (normalizedState === "connecting" || normalizedState === "qrcode") {
    status = "connecting";
  } else {
    status = "disconnected";
  }

  const updateData: any = { 
    status,
    updated_at: new Date().toISOString(),
  };

  // Set last_connected_at when session becomes connected
  if (status === "connected") {
    updateData.last_connected_at = new Date().toISOString();
  }

  // Extract phone number and profile info if available
  if (data?.instance?.wuid || data?.wuid) {
    updateData.phone_number = (data.instance?.wuid || data.wuid).split("@")[0];
  }
  if (data?.profileName || data?.instance?.profileName) {
    updateData.profile_name = data.profileName || data.instance.profileName;
  }
  if (data?.profilePictureUrl || data?.instance?.profilePictureUrl) {
    updateData.profile_picture = data.profilePictureUrl || data.instance.profilePictureUrl;
  }

  await supabase
    .from("whatsapp_sessions")
    .update(updateData)
    .eq("id", session.id);

  // ===== AUDIT LOG: Log status changes =====
  if (previousStatus !== status) {
    await supabase.from("audit_logs").insert({
      action: `whatsapp.session_${status}`,
      entity_type: "whatsapp_session",
      entity_id: session.id,
      organization_id: session.organization_id,
      new_data: { 
        instance_name: session.instance_name,
        previous_status: previousStatus,
        new_status: status,
        trigger: "webhook"
      }
    });
  }
}

type MessageUpsertResult = {
  accepted: number;
  duplicates: number;
  inProgress: number;
  ignored: number;
  failed: number;
};

class EvolutionMessageBatchError extends Error {
  constructor() {
    super("One or more Evolution messages require retry");
    this.name = "EvolutionMessageBatchError";
  }
}

async function handleMessagesUpsert(
  supabase: any,
  session: any,
  data: any,
  supabaseUrl: string,
  supabaseKey: string,
  payload: any,
): Promise<MessageUpsertResult> {
  // Evolution v2 can send single message or array
  const messages = Array.isArray(data) ? data : (data?.messages || [data]);
  const result: MessageUpsertResult = {
    accepted: 0,
    duplicates: 0,
    inProgress: 0,
    ignored: 0,
    failed: 0,
  };
  let retryRequired = false;

  for (const messageData of messages) {
    let ownedClaim: OwnedEvolutionMessageClaim | null = null;
    try {
      if (!messageData) {
        result.ignored += 1;
        continue;
      }

      const key = messageData.key || {};
      let rawRemoteJid = key.remoteJid;

      if (!rawRemoteJid) {
        console.log("Invalid Evolution message without remote JID, skipping");
        result.ignored += 1;
        continue;
      }

      // Skip status messages
      if (rawRemoteJid === "status@broadcast") {
        result.ignored += 1;
        continue;
      }

      const fromMe = key.fromMe || false;
      const messageId = typeof key.id === "string" ? key.id.trim() : "";
      if (!messageId) {
        console.log("Invalid Evolution message without provider message ID, skipping");
        result.ignored += 1;
        continue;
      }

      const message = messageData.message || {};
      if (message.reactionMessage || message.protocolMessage) {
        result.ignored += 1;
        continue;
      }

      // This is the first mutation in the direct-callback path. The unique
      // inbox key serializes concurrent deliveries before conversation,
      // media, automation, AI, agenda or outbox effects can run.
      const deliveryClaim = await claimEvolutionMessageDelivery(supabase, {
        organizationId: session.organization_id,
        sessionId: session.id,
        providerInstanceId: session.instance_name,
        providerMessageId: messageId,
        eventType: String(payload?.event || "messages.upsert"),
        providerPayload: {
          ...(payload && typeof payload === "object" ? payload : {}),
          data: messageData,
        },
      });
      if (deliveryClaim.outcome === "duplicate") {
        result.duplicates += 1;
        continue;
      }
      if (deliveryClaim.outcome === "in_progress") {
        result.inProgress += 1;
        continue;
      }
      if (deliveryClaim.outcome === "dead") {
        result.failed += 1;
        continue;
      }
      ownedClaim = deliveryClaim;

      // Bootstrap safety for messages persisted before the claim ledger was
      // introduced. This read is safe because the atomic claim above already
      // excluded every competing direct callback. A resumed stale claim may
      // reuse the canonical message after a partial crash.
      const { data: existingAutomationMsg, error: existingMessageError } = await supabase
        .from("whatsapp_messages")
        .select("id, sender_name, client_message_id")
        .eq("session_id", session.id)
        .eq("message_id", messageId)
        .maybeSingle();
      if (existingMessageError) {
        throw new Error("Unable to verify the canonical WhatsApp message claim");
      }
      if (
        existingAutomationMsg?.id && ownedClaim &&
        !ownedClaim.resumed
      ) {
        await completeEvolutionMessageDelivery(supabase, ownedClaim);
        ownedClaim = null;
        result.duplicates += 1;
        continue;
      }

      // ===== FACEBOOK ADS DETECTION =====
      const contextInfo = message.contextInfo || messageData.contextInfo || {};

      const isFromFacebookAds =
        contextInfo.conversionSource === "FB_Ads" ||
        contextInfo.entryPointConversionSource === "ctwa_ad" ||
        !!contextInfo.externalAdReply;
      
      const adSource = isFromFacebookAds 
        ? (contextInfo.entryPointConversionApp || "facebook").toLowerCase()
        : null;
      
      // When from ads, real number might be in "sender" field (remoteJid may be @lid format)
      if (rawRemoteJid.endsWith("@lid") && payload?.sender) {
        console.log(`Facebook Ads detected: using sender ${payload.sender} instead of ${rawRemoteJid}`);
        rawRemoteJid = payload.sender;
      }

      // Normalize remote_jid for consistency
      const remoteJid = normalizeRemoteJid(rawRemoteJid);
      const isGroup = remoteJid.endsWith("@g.us");
      
      // Extract phone number
      const contactPhone = extractPhoneNumber(remoteJid);
      
      // Extract group subject/name if available
      let groupSubject = isGroup 
        ? (messageData.groupMetadata?.subject || messageData.source?.groupMetadata?.subject || null)
        : null;

      // If group has no subject, fetch it from Evolution API
      if (isGroup && (!groupSubject || groupSubject === contactPhone)) {
        const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
        const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
        
        if (EVOLUTION_API_URL && EVOLUTION_API_KEY) {
          try {
            console.log(`Group without name detected, fetching from API: ${remoteJid}`);
            const groupInfoResponse = await fetch(
              `${EVOLUTION_API_URL}/group/findGroupInfos/${session.instance_name}?groupJid=${remoteJid}`,
              {
                method: "GET",
                headers: {
                  "apikey": EVOLUTION_API_KEY,
                },
              }
            );
            
            if (groupInfoResponse.ok) {
              const groupInfo = await groupInfoResponse.json();
              if (groupInfo.subject) {
                groupSubject = groupInfo.subject;
                console.log(`Fetched group name: ${groupInfo.subject}`);
              }
            }
          } catch (error) {
            console.error("Failed to fetch group info:", error);
          }
        }
      }

      // ===== FIX: PROPER CONTACT NAME EXTRACTION =====
      // Only use pushName when message is NOT from us (fromMe = false)
      // When fromMe = true, pushName is OUR name, not the contact's name
      let contactName: string;
      if (isGroup) {
        contactName = groupSubject || contactPhone;
      } else if (fromMe) {
        // Our message: don't use pushName (it's our own name)
        // Use phone number as placeholder - real name will come when they reply
        contactName = contactPhone;
      } else {
        // Received message: use pushName from the contact
        contactName = messageData.pushName || messageData.verifiedBizName || contactPhone;
      }

      // Extract sender info for group messages
      const senderJid = key.participant || null;
      const senderName = isGroup && !fromMe ? messageData.pushName : null;

      // Extract message content - Evolution v2 format
      let content = "";
      let messageType = "text";
      let mediaUrl = "";
      let mediaMimeType = "";
      let base64FromWebhook: string | null = null;
      let jpegThumbnailRaw: any = null;

      if (message.conversation) {
        content = message.conversation;
      } else if (message.extendedTextMessage?.text) {
        content = message.extendedTextMessage.text;
      } else if (message.imageMessage) {
        messageType = "image";
        content = message.imageMessage.caption || "[Imagem]";
        mediaUrl = message.imageMessage.url || "";
        const rawMime = message.imageMessage.mimetype;
        mediaMimeType = (rawMime && rawMime !== "false" && rawMime !== false) ? rawMime : "image/jpeg";
        base64FromWebhook = extractBase64FromPayload(message, messageData, payload, message.imageMessage);
        jpegThumbnailRaw = message.imageMessage.jpegThumbnail || null;
      } else if (message.videoMessage) {
        messageType = "video";
        content = message.videoMessage.caption || "[Vídeo]";
        mediaUrl = message.videoMessage.url || "";
        const rawMime = message.videoMessage.mimetype;
        mediaMimeType = (rawMime && rawMime !== "false" && rawMime !== false) ? rawMime : "video/mp4";
        base64FromWebhook = extractBase64FromPayload(message, messageData, payload, message.videoMessage);
        jpegThumbnailRaw = message.videoMessage.jpegThumbnail || null;
      } else if (message.audioMessage) {
        messageType = "audio";
        content = message.audioMessage.ptt ? "[Áudio]" : "[Gravação]";
        mediaUrl = message.audioMessage.url || "";
        const rawMime = message.audioMessage.mimetype;
        mediaMimeType = (rawMime && rawMime !== "false" && rawMime !== false) ? rawMime : "audio/ogg";
        base64FromWebhook = extractBase64FromPayload(message, messageData, payload, message.audioMessage);
      } else if (message.documentMessage) {
        messageType = "document";
        content = message.documentMessage.fileName || "[Documento]";
        mediaUrl = message.documentMessage.url || "";
        const rawMime = message.documentMessage.mimetype;
        mediaMimeType = (rawMime && rawMime !== "false" && rawMime !== false) ? rawMime : "application/octet-stream";
        base64FromWebhook = extractBase64FromPayload(message, messageData, payload, message.documentMessage);
      } else if (message.stickerMessage) {
        messageType = "sticker";
        content = "[Figurinha]";
        mediaUrl = message.stickerMessage.url || "";
        const rawMime = message.stickerMessage.mimetype;
        mediaMimeType = (rawMime && rawMime !== "false" && rawMime !== false) ? rawMime : "image/webp";
        base64FromWebhook = extractBase64FromPayload(message, messageData, payload, message.stickerMessage);
      }

      // Get timestamp
      const timestamp = messageData.messageTimestamp || Math.floor(Date.now() / 1000);
      const messageDate = new Date(Number(timestamp) * 1000).toISOString();

      // Find or create conversation - search by contact_phone to avoid duplicates
      // eslint-disable-next-line prefer-const
      let { data: conversation, error: convError } = await supabase
        .from("whatsapp_conversations")
        .select("*")
        .eq("session_id", session.id)
        .eq("contact_phone", contactPhone)
        .is("deleted_at", null)
        .maybeSingle();

      if (convError) {
        console.error("Error finding conversation:", convError);
      }

      if (!conversation) {
        // For new conversations, only set name if it's a received message
        const initialContactName = fromMe ? contactPhone : contactName;
        
        // Create new conversation
        const { data: newConv, error: createError } = await supabase
          .from("whatsapp_conversations")
          .insert({
            session_id: session.id,
            remote_jid: remoteJid,
            contact_name: initialContactName,
            contact_phone: contactPhone,
            is_group: isGroup,
            last_message: content,
            last_message_at: messageDate,
            unread_count: fromMe ? 0 : 1,
          })
          .select()
          .single();

        if (createError) {
          console.error("Error creating conversation:", createError);
          throw new Error("Unable to create the WhatsApp conversation");
        }

        conversation = newConv;

        // Fetch and save profile picture for new conversations (non-group)
        if (!isGroup && !fromMe) {
          await fetchAndSaveProfilePicture(supabase, session, conversation.id, contactPhone);
        }

        // ===== HUB: identificação & distribuição inbound =====
        // Cria lead se vier do Meta Ads OU se casar com alguma regra de inbound configurada.
        if (!isGroup && !fromMe) {
          const adContext = extractAdContext(contextInfo);
          const utm = extractUtmFromText(content || "");
          const matchedRule = await applyInboundRules(supabase, session, {
            content: content || "",
            pushName: messageData.pushName || "",
            phone: contactPhone,
            adContext,
            utm,
          });

          if (isFromFacebookAds || matchedRule) {
            await createLeadFromConversation(
              supabase, session, conversation, contactName, contactPhone, content,
              isFromFacebookAds, adSource,
              { rule: matchedRule, adContext, utm }
            );
          } else {
            console.log(`Conversation sem match de regra/ads - sem criação de lead: ${contactPhone}`);
          }
        }

        // ===== AUTO-LINK: Link new conversation to existing lead by phone =====
        if (!isGroup && !conversation.lead_id) {
          try {
            const normalizedPhone = normalizePhoneNumber(contactPhone);
            const { data: matchingLeads } = await supabase
              .from("leads")
              .select("id, phone")
              .eq("organization_id", session.organization_id)
              .not("phone", "is", null);

            const matchingLead = matchingLeads?.find((l: any) => {
              if (!l.phone) return false;
              return normalizePhoneNumber(l.phone) === normalizedPhone;
            });

            if (matchingLead) {
              await supabase
                .from("whatsapp_conversations")
                .update({ lead_id: matchingLead.id })
                .eq("id", conversation.id);
              conversation.lead_id = matchingLead.id;
              console.log(`✅ Auto-linked new conversation to lead ${matchingLead.id} by phone ${contactPhone}`);
            }
          } catch (linkError) {
            console.error("Error auto-linking conversation to lead:", linkError);
          }
        }
      } else {
        // Update existing conversation
        const unreadIncrement = fromMe ? 0 : 1;
        
        // ===== FIX: Only update name if it's a received message with a real name =====
        // Don't overwrite with phone number or our own name
        let updatedContactName = conversation.contact_name;
        
        if (isGroup) {
          // Group: only update if we have actual subject
          if (groupSubject) {
            updatedContactName = groupSubject;
          }
        } else if (!fromMe && contactName && contactName !== contactPhone) {
          // Individual received message with real name: update
          updatedContactName = contactName;
        }
        // If fromMe or contactName is just the phone, keep existing name
        
        await supabase
          .from("whatsapp_conversations")
          .update({
            remote_jid: remoteJid,
            contact_name: updatedContactName,
            last_message: content,
            last_message_at: messageDate,
            unread_count: fromMe ? 0 : (conversation.unread_count || 0) + unreadIncrement,
          })
          .eq("id", conversation.id);
        
        // ===== AUTO-SYNC PROFILE PICTURE =====
        // Fetch profile picture more frequently:
        // (a) no picture yet, (b) every ~10 received messages, (c) picture URL likely expired (>7 days old)
        const shouldFetchPicture = !isGroup && !fromMe && (
          !conversation.contact_picture || 
          ((conversation.unread_count || 0) % 10 === 0) ||
          // If picture URL is a WhatsApp CDN URL (pps.whatsapp.net), it expires - refresh periodically
          (conversation.contact_picture && conversation.contact_picture.includes('pps.whatsapp.net'))
        );
        
        if (shouldFetchPicture) {
          console.log(`Conversation ${conversation.id} - fetching profile picture (current: ${conversation.contact_picture ? 'exists but refreshing' : 'missing'})...`);
          if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime.waitUntil) {
            EdgeRuntime.waitUntil(
              fetchAndSaveProfilePicture(supabase, session, conversation.id, contactPhone)
            );
          } else {
            fetchAndSaveProfilePicture(supabase, session, conversation.id, contactPhone)
              .catch(err => console.log('Background profile picture fetch failed:', err));
          }
        }

        // ===== AUTO-LINK: Link existing conversation to lead if not yet linked =====
        if (!isGroup && !conversation.lead_id) {
          try {
            const normalizedPhone = normalizePhoneNumber(contactPhone);
            const { data: matchingLeads } = await supabase
              .from("leads")
              .select("id, phone")
              .eq("organization_id", session.organization_id)
              .not("phone", "is", null);

            const matchingLead = matchingLeads?.find((l: any) => {
              if (!l.phone) return false;
              return normalizePhoneNumber(l.phone) === normalizedPhone;
            });

            if (matchingLead) {
              await supabase
                .from("whatsapp_conversations")
                .update({ lead_id: matchingLead.id })
                .eq("id", conversation.id);
              conversation.lead_id = matchingLead.id;
              console.log(`✅ Auto-linked existing conversation to lead ${matchingLead.id} by phone ${contactPhone}`);
            }
          } catch (linkError) {
            console.error("Error auto-linking conversation to lead:", linkError);
          }
        }
      }

      // Process media if exists - download and store permanently
      // IMPORTANT: Never save temporary mmg.whatsapp.net URLs - they expire quickly
      let permanentMediaUrl: string | null = null; // Start with null, only set if we get a valid storage URL
      let mediaStatusForInsert: 'pending' | 'ready' | 'failed' | null = null;
      let mediaStoragePath: string | null = null;
      const normalizedMimeType = normalizeMimeType(mediaMimeType);
      
      if (messageType !== "text") {
        try {
          // Log media processing attempt
          console.log(`Processing ${messageType} media: base64=${!!base64FromWebhook}, url=${!!mediaUrl}, mime=${mediaMimeType}, hasThumbnail=${!!jpegThumbnailRaw}`);
          
          // If base64 came directly in webhook, use it directly (faster, most reliable)
          if (base64FromWebhook) {
            console.log(`Using base64 from webhook directly for ${messageType}, length: ${base64FromWebhook.length}`);
            const result = await storeBase64MediaWithPath(
              supabase,
              session,
              conversation.id,
              messageId,
              messageType,
              normalizedMimeType,
              base64FromWebhook
            );
            permanentMediaUrl = result.url;
            mediaStoragePath = result.path;
            mediaStatusForInsert = permanentMediaUrl ? 'ready' : 'pending';
          } else if (mediaUrl && fromMe) {
            // Outgoing media: try to download immediately via Evolution API
            console.log(`Downloading outgoing media from Evolution API for ${messageType}`);
            const result = await downloadAndStoreMediaWithPath(
              supabase,
              supabaseUrl,
              session,
              conversation.id,
              messageId,
              messageType,
              normalizedMimeType,
              key,
              messageData,
              fromMe
            );
            permanentMediaUrl = result.url;
            mediaStoragePath = result.path;
            mediaStatusForInsert = permanentMediaUrl ? 'ready' : 'pending';
          } else {
            // Incoming media without inline base64 — defer to worker
            console.log(`Defer incoming ${messageType} media to worker`);
            mediaStatusForInsert = 'pending';
          }

          // Fallback: if we still don't have a final URL but have a jpegThumbnail,
          // store it as a temporary preview so the UI shows something instead of an empty loader.
          if (!permanentMediaUrl && jpegThumbnailRaw && (messageType === "image" || messageType === "video")) {
            const thumbBytes = jpegThumbnailToBytes(jpegThumbnailRaw);
            if (thumbBytes && thumbBytes.length > 32) {
              try {
                const thumbPath = `orgs/${session.organization_id}/sessions/${session.id}/media/${messageId}_thumb.jpg`;
                const { error: thumbErr } = await supabase.storage
                  .from("whatsapp-media")
                  .upload(thumbPath, thumbBytes, { contentType: "image/jpeg", upsert: true });
                if (!thumbErr) {
                  const { data: thumbUrl } = supabase.storage.from("whatsapp-media").getPublicUrl(thumbPath);
                  permanentMediaUrl = thumbUrl.publicUrl;
                  mediaStoragePath = thumbPath;
                  // Keep status pending — worker will replace with full-size when available
                  console.log(`Stored jpegThumbnail preview: ${permanentMediaUrl}`);
                }
              } catch (thumbStoreErr) {
                console.warn("Failed to store thumbnail preview:", thumbStoreErr);
              }
            }
          }
          
          if (permanentMediaUrl) {
            console.log(`Media stored: ${permanentMediaUrl} (status=${mediaStatusForInsert})`);
          } else {
            console.log(`No media stored yet, marking as ${mediaStatusForInsert} for retry`);
          }
        } catch (mediaError) {
          console.error("Error processing media:", mediaError);
          mediaStatusForInsert = 'pending';
          permanentMediaUrl = null;
        }
      }

      const existingSenderName = normalizeText(existingAutomationMsg?.sender_name || "");
      const existingClientMessageId = String(existingAutomationMsg?.client_message_id || "");
      const isAutomationMessage =
        existingSenderName === "automacao"
        || existingSenderName.includes("jhenny")
        || existingSenderName.includes("jenny")
        || existingSenderName === "ia"
        || existingSenderName === "ai"
        || existingClientMessageId.startsWith("jhenny-");

      // Insert without updating an existing row. Direct callback contenders do
      // not execute effects; only the owner of a resumed stale claim may reuse
      // the canonical row after a partial crash.
      const resumedDelivery = Boolean(ownedClaim?.resumed);
      let insertedMessage = resumedDelivery && existingAutomationMsg?.id
        ? { id: existingAutomationMsg.id }
        : null;
      let msgError = null;
      if (!insertedMessage) {
        const canonicalWrite = await supabase
          .from("whatsapp_messages")
          .upsert({
            conversation_id: conversation.id,
            session_id: session.id,
            organization_id: session.organization_id,
            lead_id: conversation.lead_id || null,
            message_id: messageId,
            from_me: fromMe,
            content,
            message_type: messageType,
            media_url: permanentMediaUrl || null,
            media_mime_type: normalizedMimeType || null,
            media_status: mediaStatusForInsert,
            media_storage_path: mediaStoragePath,
            status: fromMe ? "sent" : "received",
            sent_at: messageDate,
            sender_jid: senderJid,
            sender_name: isAutomationMessage ? "Automação" : senderName,
          }, {
            onConflict: "session_id,message_id",
            ignoreDuplicates: true,
          })
          .select("id")
          .maybeSingle();
        insertedMessage = canonicalWrite.data;
        msgError = canonicalWrite.error;
      }

      if (msgError) {
        console.error("Error inserting message:", msgError);
        throw new Error("Unable to persist the canonical WhatsApp message");
      } else if (!insertedMessage?.id) {
        if (!ownedClaim) {
          throw new EvolutionMessageClaimError();
        }
        await completeEvolutionMessageDelivery(supabase, ownedClaim);
        ownedClaim = null;
        result.duplicates += 1;
      } else {
        result.accepted += 1;
        console.log(`${resumedDelivery ? "Message resumed" : "Message saved"}: ${messageId} in conversation ${conversation.id}`);

        // ===== TIMELINE LOGGING: Log incoming messages to lead_timeline_events =====
        if (!fromMe && conversation.lead_id) {
          try {
            await supabase.from("lead_timeline_events").insert({
              organization_id: session.organization_id,
              lead_id: conversation.lead_id,
              event_type: "whatsapp_message_received",
              channel: "whatsapp",
              metadata: {
                message_id: messageId,
                content: content,
                media_type: messageType,
                contact_name: contactName,
                contact_phone: contactPhone
              }
            });
            console.log(`✅ Incoming message logged to timeline for lead ${conversation.lead_id}`);
          } catch (timelineError) {
            console.error("Error logging incoming message to timeline:", timelineError);
          }
        }
        
        // If media failed to download, create a job for the media-worker
        if (mediaStatusForInsert === 'pending' && insertedMessage?.id) {
          console.log(`Creating media job for message ${insertedMessage.id}`);
          const { error: jobError } = await supabase.from("media_jobs").insert({
            organization_id: session.organization_id,
            session_id: session.id,
            conversation_id: conversation.id,
            message_id: insertedMessage.id,
            message_key: key,
            media_type: messageType,
            media_mime_type: normalizeMimeType(mediaMimeType),
            status: 'pending',
            next_retry_at: new Date().toISOString(),
          });
          
          if (jobError) {
            console.error("Error creating media job:", jobError);
            // Mark message with error so user sees a retry button instead of eternal loading
            await supabase
              .from("whatsapp_messages")
              .update({ 
                media_status: 'failed', 
                media_error: `Falha ao agendar download: ${jobError.message}` 
              })
              .eq("id", insertedMessage.id);
          } else {
            console.log(`Media job created for retry`);
            
            // Trigger media-worker immediately to process the job
            // Use EdgeRuntime.waitUntil to not block the response
            const triggerWorker = async () => {
              try {
                // Small delay to ensure job is committed to database
                await new Promise(resolve => setTimeout(resolve, 3000));
                console.log("Triggering media-worker for immediate processing...");
                const workerResponse = await fetch(`${supabaseUrl}/functions/v1/media-worker`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${supabaseKey}`,
                  },
                  body: JSON.stringify({}),
                });
                console.log(`media-worker triggered: ${workerResponse.status}`);
              } catch (workerError) {
                console.error("Failed to trigger media-worker:", workerError);
              }
            };
            
            // Fire and forget - don't await
            EdgeRuntime.waitUntil(triggerWorker());
          }
        }

        // ===== FIRST RESPONSE TRACKING: Track when broker sends message via native WhatsApp =====
        if (fromMe && !isGroup && conversation.lead_id) {
          // If this is a manual message (fromMe = true and not from automation), stop any active automations
          if (!isAutomationMessage) {
            console.log(`Manual interaction detected for lead ${conversation.lead_id}, checking for automations to stop`);
            await handleStopFollowUpOnReply(supabase, conversation.id, conversation.lead_id, true);
          }

          try {
            console.log(`Tracking first response for lead ${conversation.lead_id} via native WhatsApp (session owner: ${session.owner_user_id})`);
            const response = await fetch(`${supabaseUrl}/functions/v1/calculate-first-response`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${supabaseKey}`,
              },
              body: JSON.stringify({
                lead_id: conversation.lead_id,
                channel: "whatsapp",
                actor_user_id: session.owner_user_id || null,
                is_automation: isAutomationMessage,
                organization_id: session.organization_id,
              }),
            });
            if (!response.ok) {
              throw new Error("First-response calculation was not accepted");
            }
          } catch (firstResponseError) {
            console.error("Error tracking first response:", firstResponseError);
            throw firstResponseError;
          }
        }

        // PUSH NOTIFICATION: Removed automatic WhatsApp/Push on every message per user request


        // The canonical whatsapp_messages INSERT above is the automation
        // trigger. `zz_automation_inbound_message` enqueues the durable event
        // exactly once; the retired event-shaped POST to automation-trigger is
        // intentionally not repeated here (that worker only accepts batch_size).
        if (!fromMe && !isGroup) {
          // ===== AI AGENT: Auto-respond to incoming text messages =====
          if (messageType === 'text' && content) {
            try {
              const { data: activeAgentConversation } = await supabase
                .from("ai_agent_conversations")
                .select("id, status")
                .eq("conversation_id", conversation.id)
                .eq("status", "active")
                .maybeSingle();

              if (activeAgentConversation) {
                await supabase
                  .from("chatbot_conversation_state")
                  .update({
                    automation_enabled: true,
                    agent_status: "active",
                    last_response_id: null,
                    updated_at: new Date().toISOString(),
                  })
                  .eq("organization_id", session.organization_id)
                  .eq("conversation_id", conversation.id);
              }

              if (
                !conversation?.id || !session.id ||
                !session.organization_id || !messageId
              ) {
                throw new Error("AI agent delivery scope is incomplete");
              }

              const aiAgentResponse = await fetch(`${supabaseUrl}/functions/v1/ai-agent-responder`, {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  // Private workers authenticate opaque hosted secrets via
                  // `apikey`; Bearer preserves the legacy service-role path.
                  apikey: supabaseKey,
                  Authorization: `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify({
                  conversation_id: conversation.id,
                  session_id: session.id,
                  organization_id: session.organization_id,
                  provider_message_id: messageId,
                  message: content,
                  contact_name: contactName,
                }),
              });
              if (!aiAgentResponse.ok) {
                throw new Error("AI agent responder was not accepted");
              }
              console.log(`AI agent responded: ${aiAgentResponse.status}`);
            } catch (aiError) {
              console.error("AI agent setup error:", aiError);
              throw aiError;
            }
          }

          // ===== STOP FOLLOW-UP ON REPLY =====
          // Cancel running/waiting automation executions when lead replies
          // Even if conversation has no lead_id, try to find lead by phone
          let leadIdForStop = conversation.lead_id;
          
          if (!leadIdForStop) {
            // Try to find lead by phone number with multiple variations
            // Covers: with/without country code 55, with/without 9th digit
            const cleanPhone = contactPhone.replace(/\D/g, '');
            const basePhone = cleanPhone.startsWith('55') ? cleanPhone.substring(2) : cleanPhone;
            
            // Generate all possible phone variations
            const phoneVariants = new Set<string>();
            
            // Original formats
            phoneVariants.add(cleanPhone);                      // 5522974063727
            phoneVariants.add(basePhone);                       // 22974063727
            phoneVariants.add(`55${basePhone}`);                // 5522974063727
            
            // Handle 9th digit variations for Brazilian mobile numbers
            // DDD (2 digits) + 9 (optional) + number (8 digits)
            if (basePhone.length === 11) {
              // Has 9th digit, create variant without it
              const ddd = basePhone.substring(0, 2);
              const numberPart = basePhone.substring(3); // Skip the 9
              const without9 = `${ddd}${numberPart}`;
              phoneVariants.add(without9);                      // 2297406372
              phoneVariants.add(`55${without9}`);               // 552297406372
            } else if (basePhone.length === 10) {
              // Missing 9th digit, create variant with it
              const ddd = basePhone.substring(0, 2);
              const numberPart = basePhone.substring(2);
              const with9 = `${ddd}9${numberPart}`;
              phoneVariants.add(with9);                         // 22997406372
              phoneVariants.add(`55${with9}`);                  // 5522997406372
            }
            
            const variantsArray = Array.from(phoneVariants);
            console.log(`Stop-on-reply: searching lead with phone variants: ${variantsArray.join(', ')}`);
            
            const { data: matchingLead } = await supabase
              .from("leads")
              .select("id")
              .eq("organization_id", session.organization_id)
              .or(variantsArray.map(p => `phone.eq.${p}`).join(','))
              .limit(1)
              .maybeSingle();
            
            if (matchingLead) {
              leadIdForStop = matchingLead.id;
              console.log(`Found lead ${leadIdForStop} by phone match for stop-on-reply`);
              
              // BONUS: Link the conversation to the lead for future messages
              await supabase
                .from("whatsapp_conversations")
                .update({ lead_id: matchingLead.id })
                .eq("id", conversation.id);
              
              // Update local variable too for notifications below
              conversation.lead_id = matchingLead.id;
            } else {
              console.log(`No lead found for phone variants: ${variantsArray.join(', ')}`);
            }
          }
          
          if (leadIdForStop) {
            await handleStopFollowUpOnReply(supabase, conversation.id, leadIdForStop);
          }

          // ===== WHATSAPP MESSAGE NOTIFICATIONS =====
          // Notifications for WhatsApp messages are handled client-side via Realtime
          // (sound + unread badge on floating chat). No system notification is created
          // to avoid cluttering the notifications dropdown.
        }
      }

      if (ownedClaim) {
        await completeEvolutionMessageDelivery(supabase, ownedClaim);
        ownedClaim = null;
      }
    } catch (error) {
      console.error("Error processing message:", error);
      if (ownedClaim) {
        await retryEvolutionMessageDelivery(supabase, ownedClaim);
        ownedClaim = null;
      } else if (error instanceof EvolutionMessageClaimError) {
        throw error;
      }
      result.failed += 1;
      retryRequired = true;
    }
  }

  if (retryRequired) throw new EvolutionMessageBatchError();

  return result;
}

// Helper to normalize MIME type (remove codec info like ; codecs=opus)
function normalizeMimeType(mime: string | null): string {
  if (!mime) return 'application/octet-stream';
  // Remove codec info: "audio/ogg; codecs=opus" -> "audio/ogg"
  return mime.split(';')[0].trim();
}

// Helper to get file extension from MIME type
function getExtensionFromMime(mediaMimeType: string): string {
  const mimeExtMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/heic": "heic",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "video/quicktime": "mov",
    "audio/ogg": "ogg",
    "audio/ogg; codecs=opus": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "application/pdf": "pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "text/csv": "csv",
  };
  return mimeExtMap[mediaMimeType] || mediaMimeType.split("/")[1]?.split(";")[0] || "bin";
}

// Store base64 media directly (when webhook sends base64) - returns both URL and path
async function storeBase64MediaWithPath(
  supabase: any,
  session: any,
  conversationId: string,
  messageId: string,
  messageType: string,
  mediaMimeType: string,
  base64Content: string
): Promise<{ url: string; path: string | null }> {
  try {
    const extension = getExtensionFromMime(mediaMimeType);
    const filePath = `orgs/${session.organization_id}/sessions/${session.id}/media/${messageId}.${extension}`;
    
    // Normalize and validate base64
    const normalized = normalizeBase64(base64Content);
    if (!isValidBase64(normalized)) {
      console.warn("Invalid base64 provided to storeBase64MediaWithPath");
      return { url: "", path: null };
    }

    // Decode base64 to Uint8Array
    const fileContent = decode(normalized);
    
    // Validate magic bytes
    if (!validateMagicBytes(fileContent, mediaMimeType)) {
      console.warn(`Magic bytes validation failed for ${mediaMimeType} in storeBase64MediaWithPath`);
      return { url: "", path: null };
    }

    console.log(`Storing base64 media: ${filePath}, size: ${fileContent.length} bytes`);

    const { error: uploadError } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, fileContent, {
        contentType: mediaMimeType?.split(";")[0] || "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      console.error("Error uploading base64 media to storage:", uploadError);
      return { url: "", path: null };
    }

    const { data: urlData } = supabase.storage
      .from("whatsapp-media")
      .getPublicUrl(filePath);

    console.log(`Base64 media stored successfully: ${urlData.publicUrl}`);
    return { url: urlData.publicUrl, path: filePath };
  } catch (error) {
    console.error("Error in storeBase64MediaWithPath:", error);
    return { url: "", path: null };
  }
}

async function downloadAndStoreMediaWithPath(
  supabase: any,
  supabaseUrl: string,
  session: any,
  conversationId: string,
  messageId: string,
  messageType: string,
  mediaMimeType: string,
  key: any,
  messageData: any,
  fromMe: boolean = true
): Promise<{ url: string; path: string | null }> {
  const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
  const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");

  if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
    console.log("Evolution API credentials not configured for media download");
    return { url: "", path: null };
  }

  const isDiagnostic = Deno.env.get("DEBUG_MEDIA") === "true";
  console.log(`Attempting to download media: type=${messageType}, mimeType=${mediaMimeType}, instance=${session.instance_name}, fromMe=${fromMe}, diagnostic=${isDiagnostic}`);

  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  const getExtension = (mime: string): string => {
    const mimeExtMap: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/gif": "gif",
      "image/webp": "webp",
      "video/mp4": "mp4",
      "audio/ogg": "ogg",
      "audio/mpeg": "mp3",
      "audio/mp4": "m4a",
      "application/pdf": "pdf",
    };
    return mimeExtMap[mime] || mime.split("/")[1]?.split(";")[0] || "bin";
  };

  let storedPath: string | null = null;
  const uploadToStorage = async (content: Uint8Array): Promise<string> => {
    if (!validateMagicBytes(content, mediaMimeType)) {
      console.warn(`Magic bytes validation failed for ${mediaMimeType}`);
      return "";
    }

    const extension = getExtension(mediaMimeType);
    const filePath = `orgs/${session.organization_id}/sessions/${session.id}/media/${messageId}.${extension}`;

    console.log(`Uploading to storage: ${filePath}, size: ${content.length} bytes`);

    const { error: uploadError } = await supabase.storage
      .from("whatsapp-media")
      .upload(filePath, content, {
        contentType: mediaMimeType?.split(";")[0] || "application/octet-stream",
        upsert: true,
      });

    if (uploadError) {
      console.error("Error uploading to storage:", uploadError);
      return "";
    }

    const { data: urlData } = supabase.storage
      .from("whatsapp-media")
      .getPublicUrl(filePath);

    storedPath = filePath;
    return urlData.publicUrl;
  };

  // === STRATEGY 1: getBase64FromMediaMessage (PRIORITIZED) ===
  const tryGetBase64FromEvolution = async (): Promise<string | null> => {
    if (!fromMe) await delay(3000);
    
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await delay(1000 * attempt);
        const response = await fetch(
          `${EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/${session.instance_name}`,
          {
            method: "POST",
            headers: {
              "apikey": EVOLUTION_API_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              message: { key },
              convertToMp4: messageType === "video",
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.base64) {
            const normalized = normalizeBase64(data.base64);
            if (isValidBase64(normalized)) return normalized;
          }
        }
      } catch (error) {
        console.error(`Strategy 1 attempt ${attempt} error:`, error);
      }
    }
    return null;
  };

  // === DIAGNOSTIC STRATEGIES ===
  const tryDiagnosticStrategies = async (): Promise<Uint8Array | null> => {
    if (!isDiagnostic) return null;

    // Strategy 2: Download by ID
    const endpoints = [
      `${EVOLUTION_API_URL}/chat/downloadMedia/${session.instance_name}`,
      `${EVOLUTION_API_URL}/message/downloadMedia/${session.instance_name}`,
    ];
    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "apikey": EVOLUTION_API_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ message: { key } }),
        });
        if (response.ok) {
          const contentType = response.headers.get("content-type") || "";
          if (!contentType.includes("application/json")) {
            const buffer = await response.arrayBuffer();
            return new Uint8Array(buffer);
          } else {
            const data = await response.json();
            if (data.base64) return decode(normalizeBase64(data.base64));
          }
        }
      } catch (e) { console.log(`S2 failed:`, e); }
    }

    // Strategy 3/5: Direct URL/Path
    const message = messageData.message || {};
    const mediaMessage = message.imageMessage || message.videoMessage || 
                         message.audioMessage || message.documentMessage;
    const mediaUrl = mediaMessage?.url || (mediaMessage?.directPath ? `https://mmg.whatsapp.net${mediaMessage.directPath}` : null);
    
    if (mediaUrl) {
      try {
        const response = await fetch(mediaUrl, { headers: { "User-Agent": "WhatsApp/2.24.1.0" } });
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          if (buffer.byteLength > 100) return new Uint8Array(buffer);
        }
      } catch (e) { console.log(`S3/5 failed:`, e); }
    }
    return null;
  };

  // Main execution flow
  const base64 = await tryGetBase64FromEvolution();
  if (base64) {
    const url = await uploadToStorage(decode(base64));
    if (url) return { url, path: storedPath };
  }

  const binaryContent = await tryDiagnosticStrategies();
  if (binaryContent) {
    const url = await uploadToStorage(binaryContent);
    if (url) return { url, path: storedPath };
  }

  return { url: "", path: null };
}

async function handleMessagesUpdate(supabase: any, session: any, data: any) {
  const updates = Array.isArray(data) ? data : [data];

  for (const update of updates) {
    try {
      const key = update.key || {};
      const messageId = key.id;
      
      if (!messageId) continue;

      // Evolution v2 status format
      const status = update.update?.status || update.status;

      const updateData: any = {};
      
      // Status codes: 0 = error, 1 = pending, 2 = server, 3 = delivery, 4 = read, 5 = played
      if (status === 2 || status === "SERVER_ACK") {
        updateData.status = "sent";
      } else if (status === 3 || status === "DELIVERY_ACK") {
        updateData.status = "delivered";
        updateData.delivered_at = new Date().toISOString();
      } else if (status === 4 || status === "READ") {
        updateData.status = "read";
        updateData.read_at = new Date().toISOString();
      } else if (status === 5 || status === "PLAYED") {
        updateData.status = "played";
        updateData.read_at = new Date().toISOString();
      }

      if (Object.keys(updateData).length > 0) {
        await supabase
          .from("whatsapp_messages")
          .update(updateData)
          .eq("session_id", session.id)
          .eq("message_id", messageId);
        
        console.log(`Message ${messageId} status updated to: ${updateData.status}`);
      }

    } catch (error) {
      console.error("Error updating message status:", error);
    }
  }
}

// Handle MESSAGES_DELETE event - when messages are deleted
async function handleMessagesDelete(supabase: any, session: any, data: any) {
  try {
    const messageId = data?.key?.id || data?.id;
    
    if (!messageId) {
      console.log("Delete event missing message id:", data);
      return;
    }
    
    console.log(`Deleting message ${messageId} from session ${session.id}`);
    
    // Soft delete by updating content or completely remove
    const { error } = await supabase
      .from("whatsapp_messages")
      .update({ 
        content: "[Mensagem apagada]",
        message_type: "deleted"
      })
      .eq("session_id", session.id)
      .eq("message_id", messageId);
      
    if (error) {
      console.error("Error deleting message:", error);
    } else {
      console.log(`Message ${messageId} marked as deleted`);
    }
  } catch (error) {
    console.error("Error in handleMessagesDelete:", error);
  }
}

// Handle PRESENCE_UPDATE event - when contact is typing/recording
async function handlePresenceUpdate(supabase: any, session: any, data: any) {
  try {
    // data format: { id: "5511999999999@s.whatsapp.net", presences: { "5511999999999@s.whatsapp.net": { lastKnownPresence: "composing" } } }
    const contactJid = data?.id;
    const presenceInfo = data?.presences?.[contactJid];
    
    if (!contactJid || !presenceInfo) {
      console.log("Presence update missing data:", data);
      return;
    }
    
    // Possible values: 'composing', 'recording', 'paused', 'available', 'unavailable'
    const presence = presenceInfo.lastKnownPresence;
    const contactPhone = contactJid.replace("@s.whatsapp.net", "").replace("@c.us", "").replace("@g.us", "");
    
    console.log(`Presence update for ${contactPhone}: ${presence}`);
    
    // Only update for active presence states
    if (presence === 'composing' || presence === 'recording') {
      await supabase
        .from("whatsapp_conversations")
        .update({ 
          contact_presence: presence,
          presence_updated_at: new Date().toISOString()
        })
        .eq("session_id", session.id)
        .eq("contact_phone", contactPhone);
    } else {
      // Clear presence after paused/available/unavailable
      await supabase
        .from("whatsapp_conversations")
        .update({ 
          contact_presence: null,
          presence_updated_at: new Date().toISOString()
        })
        .eq("session_id", session.id)
        .eq("contact_phone", contactPhone);
    }
  } catch (error) {
    console.error("Error in handlePresenceUpdate:", error);
  }
}

// Handle SEND_MESSAGE event - confirmation of sent messages
async function handleSendMessage(supabase: any, session: any, data: any) {
  try {
    const key = data?.key || {};
    const messageId = key.id;
    
    if (!messageId) {
      console.log("Send message event missing id:", data);
      return;
    }
    
    console.log(`Send message confirmed: ${messageId}`);
    
    // Update message status to sent
    await supabase
      .from("whatsapp_messages")
      .update({ 
        status: "sent",
        sent_at: new Date().toISOString()
      })
      .eq("session_id", session.id)
      .eq("message_id", messageId);
      
  } catch (error) {
    console.error("Error in handleSendMessage:", error);
  }
}

// Handle GROUPS_UPSERT event - when groups are created or updated
async function handleGroupsUpsert(supabase: any, session: any, data: any) {
  const groups = Array.isArray(data) ? data : [data];
  console.log(`Processing ${groups.length} groups upsert for session ${session.id}`);
  
  for (const group of groups) {
    try {
      const groupId = group.id; // xxxxx@g.us
      const groupSubject = group.subject; // Nome do grupo
      
      if (!groupId || !groupSubject) {
        console.log("Group missing id or subject, skipping:", group);
        continue;
      }
      
      console.log(`Updating group: ${groupId} -> ${groupSubject}`);
      
      // Update existing conversation with real group name
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ contact_name: groupSubject })
        .eq("session_id", session.id)
        .eq("remote_jid", groupId);
        
      if (error) {
        console.error(`Error updating group ${groupId}:`, error);
      } else {
        console.log(`Group name updated: ${groupId} -> ${groupSubject}`);
      }
    } catch (error) {
      console.error("Error processing group upsert:", error);
    }
  }
}

// Handle GROUP_UPDATE event - when group name/description/photo changes
async function handleGroupUpdate(supabase: any, session: any, data: any) {
  const updates = Array.isArray(data) ? data : [data];
  console.log(`Processing ${updates.length} group updates for session ${session.id}`);
  
  for (const update of updates) {
    try {
      const groupId = update.id;
      const newSubject = update.subject; // Novo nome
      
      if (!groupId) {
        console.log("Group update missing id, skipping:", update);
        continue;
      }
      
      if (newSubject) {
        console.log(`Updating group name: ${groupId} -> ${newSubject}`);
        
        const { error } = await supabase
          .from("whatsapp_conversations")
          .update({ contact_name: newSubject })
          .eq("session_id", session.id)
          .eq("remote_jid", groupId);
          
        if (error) {
          console.error(`Error updating group ${groupId}:`, error);
        } else {
          console.log(`Group name updated: ${groupId} -> ${newSubject}`);
        }
      }
    } catch (error) {
      console.error("Error processing group update:", error);
    }
  }
}

async function createLeadFromConversation(
  supabase: any, 
  session: any, 
  conversation: any,
  contactName: string,
  contactPhone: string,
  firstMessage: string,
  isFromAds: boolean = false,
  adSource: string | null = null,
  hubCtx: { rule: any | null; adContext: any; utm: Record<string, string> } | null = null
) {
  try {
    console.log(`Attempting to create lead: phone=${contactPhone}, session_owner=${session.owner_user_id}, org=${session.organization_id}, isFromAds=${isFromAds}, adSource=${adSource}`);
    
    // ===== BUSCAR LEAD EXISTENTE COM TELEFONE NORMALIZADO =====
    const normalizedPhone = normalizePhoneNumber(contactPhone);
    console.log(`Normalized phone: ${normalizedPhone} (original: ${contactPhone})`);
    
    // Buscar todos os leads da organização com telefone
    const { data: allLeads, error: searchError } = await supabase
      .from("leads")
      .select("id, phone")
      .eq("organization_id", session.organization_id)
      .not("phone", "is", null);

    if (searchError) {
      console.error("Error searching for existing leads:", searchError);
    }

    // Verificar se algum lead tem telefone que combina (normalizado)
    const existingLead = allLeads?.find((l: { id: string; phone: string | null }) => {
      if (!l.phone) return false;
      const leadNormalizedPhone = normalizePhoneNumber(l.phone);
      return leadNormalizedPhone === normalizedPhone;
    });

    if (existingLead) {
      // Registrar reentrada via RPC
      const { error: reentryError } = await supabase.rpc('register_lead_reentry', {
        p_lead_id: existingLead.id,
        p_org_id: session.organization_id,
        p_entry_type: 'whatsapp_reentry',
        p_source: 'whatsapp',
        p_campaign_name: hubCtx?.rule?.campaign_label || hubCtx?.utm?.utm_campaign || hubCtx?.adContext?.headline || null,
        p_utm_source: hubCtx?.utm?.utm_source || null,
        p_utm_medium: hubCtx?.utm?.utm_medium || null,
        p_utm_campaign: hubCtx?.utm?.utm_campaign || hubCtx?.rule?.campaign_label || null,
        p_metadata: {
          from_ads: isFromAds,
          ad_source: adSource || null,
          phone: contactPhone,
          first_message: firstMessage,
          ad_context: hubCtx?.adContext || null,
          inbound_rule_id: hubCtx?.rule?.id || null,
        }
      });

      if (reentryError) {
        console.error('Error recording reentry via RPC:', reentryError);
        // Fallback update
        await supabase
          .from('leads')
          .update({
            deal_status: 'open',
            last_entry_at: new Date().toISOString(),
          })
          .eq('id', existingLead.id);
      }
      
      // Link conversation to existing lead
      await supabase
        .from("whatsapp_conversations")
        .update({ lead_id: existingLead.id })
        .eq("id", conversation.id);

      await recordLeadMetaFromWhatsApp(supabase, existingLead.id, hubCtx, isFromAds, adSource);
      
      console.log(`Linked conversation to existing lead: ${existingLead.id}`);
      return;
    }

    // Determinar usuário responsável
    let assignedUserId = session.owner_user_id;
    
    // Se não houver owner_user_id, buscar primeiro usuário admin da organização
    if (!assignedUserId) {
      console.log("No owner_user_id, searching for org admin...");
      const { data: orgUser } = await supabase
        .from("users")
        .select("id")
        .eq("organization_id", session.organization_id)
        .eq("role", "admin")
        .limit(1)
        .maybeSingle();
      
      if (orgUser) {
        assignedUserId = orgUser.id;
        console.log(`Found org admin: ${assignedUserId}`);
      } else {
        // Buscar qualquer usuário da organização
        const { data: anyUser } = await supabase
          .from("users")
          .select("id")
          .eq("organization_id", session.organization_id)
          .limit(1)
          .maybeSingle();
        
        if (anyUser) {
          assignedUserId = anyUser.id;
          console.log(`Found org user: ${assignedUserId}`);
        }
      }
    }

    if (!assignedUserId) {
      console.log("No user found to assign lead, skipping lead creation");
      return;
    }

    // Get default pipeline and first stage
    let pipelineId: string | null = null;
    
    const { data: defaultPipeline, error: pipelineError } = await supabase
      .from("pipelines")
      .select("id")
      .eq("organization_id", session.organization_id)
      .eq("is_default", true)
      .maybeSingle();

    if (pipelineError) {
      console.error("Error finding pipeline:", pipelineError);
    }

    if (defaultPipeline) {
      pipelineId = defaultPipeline.id;
    } else {
      // Tentar buscar qualquer pipeline da organização
      const { data: anyPipeline } = await supabase
        .from("pipelines")
        .select("id")
        .eq("organization_id", session.organization_id)
        .limit(1)
        .maybeSingle();
      
      if (!anyPipeline) {
        console.log("No pipeline found, skipping lead creation");
        return;
      }
      
      console.log(`Using first available pipeline: ${anyPipeline.id}`);
      pipelineId = anyPipeline.id;
    }

    // eslint-disable-next-line prefer-const
    let { data: stage, error: stageError } = await supabase
      .from("stages")
      .select("id")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (stageError) {
      console.error("Error finding stage:", stageError);
    }

    if (!stage) {
      console.log("No stage found, skipping lead creation");
      return;
    }

    // Determine source based on Facebook Ads detection
    let leadSource = "whatsapp";
    if (isFromAds) {
      if (adSource?.includes("instagram")) {
        leadSource = "instagram";
      } else {
        leadSource = "facebook";
      }
    }

    // ===== HUB OVERRIDES (rules) =====
    const rule = hubCtx?.rule || null;
    const adCtx = hubCtx?.adContext || {};
    const utm = hubCtx?.utm || {};

    if (rule?.source_label) leadSource = rule.source_label;
    if (rule?.target_pipeline_id) pipelineId = rule.target_pipeline_id;
    if (rule?.target_stage_id) stage = { id: rule.target_stage_id } as any;
    if (rule?.target_user_id) assignedUserId = rule.target_user_id;
    // round_robin/team-based assignment: deixar trigger handle_lead_intake decidir (não setamos assigned_user_id)
    if (rule?.target_round_robin_id && !rule?.target_user_id) {
      assignedUserId = null;
    }

    // Create new lead
    console.log(`Creating lead: name=${contactName}, phone=${contactPhone}, pipeline=${pipelineId}, stage=${stage.id}, user=${assignedUserId}, source=${leadSource}, rule=${rule?.id || 'none'}`);
    
    const { data: newLead, error: leadError } = await supabase
      .from("leads")
      .insert({
        organization_id: session.organization_id,
        name: contactName,
        phone: contactPhone,
        message: firstMessage,
        initial_message: firstMessage,
        source: leadSource,
        pipeline_id: pipelineId,
        stage_id: stage.id,
        assigned_user_id: assignedUserId,
        source_session_id: session.id,
        // Meta CTWA
        meta_campaign_id: adCtx.meta_campaign_id || null,
        meta_ad_id: adCtx.meta_ad_id || null,
        meta_click_id: adCtx.meta_click_id || null,
        meta_adset_id: adCtx.meta_adset_id || null,
        // UTM
        utm_source: utm.utm_source || null,
        utm_medium: utm.utm_medium || null,
        utm_campaign: utm.utm_campaign || rule?.campaign_label || null,
        utm_content: utm.utm_content || null,
        utm_term: utm.utm_term || null,
      })
      .select()
      .single();

    if (leadError) {
      console.error("Error creating lead:", leadError);
      return;
    }

    // Link conversation to new lead
    const { error: linkError } = await supabase
      .from("whatsapp_conversations")
      .update({ lead_id: newLead.id })
      .eq("id", conversation.id);
    
    if (linkError) {
      console.error("Error linking conversation to lead:", linkError);
    }

    await recordLeadMetaFromWhatsApp(supabase, newLead.id, hubCtx, isFromAds, adSource);

    // Apply Facebook Ads tag if from ads
    if (isFromAds) {
      await applyFacebookAdsTag(supabase, session.organization_id, newLead.id, adSource);
    }

    // Audit log
    try {
      await supabase.from("whatsapp_inbound_logs").insert({
        organization_id: session.organization_id,
        session_id: session.id,
        conversation_id: conversation.id,
        lead_id: newLead.id,
        matched_rule_id: rule?.id || null,
        assigned_user_id: assignedUserId,
        match_details: {
          is_from_ads: isFromAds,
          ad_source: adSource,
          rule_name: rule?.name || null,
          match_type: rule?.match_type || null,
          match_value: rule?.match_value || null,
          meta: adCtx,
          utm,
        },
      });
    } catch (logErr) {
      console.error("Error writing inbound log:", logErr);
    }

    // Create activity
    const activityContent = rule
      ? `Lead criado via regra "${rule.name}" (WhatsApp)`
      : isFromAds 
        ? `Lead criado automaticamente via WhatsApp (Facebook Ads - ${adSource || 'unknown'})`
        : `Lead criado automaticamente via WhatsApp`;
    
    const { error: activityError } = await supabase
      .from("activities")
      .insert({
        lead_id: newLead.id,
        type: "whatsapp",
        content: activityContent,
        user_id: assignedUserId,
      });
    
    if (activityError) {
      console.error("Error creating activity:", activityError);
    }

    console.log(`Created new lead from WhatsApp: ${newLead.id}, isFromAds: ${isFromAds}, rule: ${rule?.id || 'none'}`);

  } catch (error) {
    console.error("Error creating lead from conversation:", error);
  }
}

// Apply "Facebook Ads" tag to a lead
async function applyFacebookAdsTag(
  supabase: any,
  organizationId: string,
  leadId: string,
  adSource: string | null
) {
  try {
    // Tag única "Tráfego" para todos os leads de ads (padrão para todas as organizações)
    const tagName = "Tráfego";
    const tagColor = "#F97316"; // Laranja
    
    // Find or create tag
    let tagId: string | null = null;
    
    const { data: existingTag } = await supabase
      .from("tags")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("name", tagName)
      .maybeSingle();
    
    if (existingTag) {
      tagId = existingTag.id;
    } else {
      // Create tag if not exists
      const { data: newTag, error: tagError } = await supabase
        .from("tags")
        .insert({
          organization_id: organizationId,
          name: tagName,
          color: tagColor,
          description: "Lead originado de tráfego pago (Facebook/Instagram Ads)"
        })
        .select()
        .single();
      
      if (tagError) {
        console.error("Error creating Facebook Ads tag:", tagError);
        return;
      }
      
      if (newTag) {
        tagId = newTag.id;
        console.log(`Created ${tagName} tag: ${tagId}`);
      }
    }
    
    // Check if tag is already applied
    if (tagId) {
      const { data: existingLink } = await supabase
        .from("lead_tags")
        .select("id")
        .eq("lead_id", leadId)
        .eq("tag_id", tagId)
        .maybeSingle();
      
      if (!existingLink) {
        // Link tag to lead
        const { error: linkError } = await supabase
          .from("lead_tags")
          .insert({ lead_id: leadId, tag_id: tagId });
        
        if (linkError) {
          console.error("Error linking Facebook Ads tag to lead:", linkError);
        } else {
          console.log(`Applied ${tagName} tag to lead ${leadId}`);
        }
      }
    }
  } catch (error) {
    console.error("Error applying Facebook Ads tag:", error);
  }
}

// Fetch and save contact profile picture from Evolution API
// Downloads the image and stores permanently in Supabase Storage to avoid expired URLs
async function fetchAndSaveProfilePicture(
  supabase: any,
  session: any,
  conversationId: string,
  phone: string
) {
  try {
    const evolutionUrl = Deno.env.get("EVOLUTION_API_URL");
    const evolutionKey = Deno.env.get("EVOLUTION_API_KEY");

    if (!evolutionUrl || !evolutionKey) {
      console.log("Evolution API not configured for profile picture fetch");
      return;
    }

    const formattedPhone = phone.replace(/\D/g, "");
    console.log(`Fetching profile picture for ${formattedPhone} on instance ${session.instance_name}`);

    const response = await fetch(`${evolutionUrl}/chat/fetchProfilePictureUrl/${session.instance_name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": evolutionKey,
      },
      body: JSON.stringify({ number: formattedPhone }),
    });

    if (!response.ok) {
      console.log(`Could not fetch profile picture for ${formattedPhone}: ${response.status}`);
      return;
    }

    const data = await response.json();
    const pictureUrl = data.profilePictureUrl || data.wpiUrl || null;

    if (!pictureUrl) {
      console.log(`No profile picture available for ${formattedPhone}`);
      return;
    }

    // Download the image and store it permanently in Supabase Storage
    try {
      const imgResponse = await fetch(pictureUrl);
      if (!imgResponse.ok) {
        console.log(`Failed to download profile picture: ${imgResponse.status}`);
        // Fall back to saving the URL directly
        await supabase
          .from("whatsapp_conversations")
          .update({ contact_picture: pictureUrl })
          .eq("id", conversationId);
        return;
      }

      const imgBuffer = await imgResponse.arrayBuffer();
      if (imgBuffer.byteLength < 100) {
        console.log("Downloaded image too small, skipping");
        return;
      }

      const filePath = `orgs/${session.organization_id}/profile-pictures/${formattedPhone}.jpg`;
      
      const { error: uploadError } = await supabase.storage
        .from("whatsapp-media")
        .upload(filePath, new Uint8Array(imgBuffer), {
          contentType: "image/jpeg",
          upsert: true,
        });

      if (uploadError) {
        console.error("Error uploading profile picture:", uploadError);
        // Fall back to saving the URL directly
        await supabase
          .from("whatsapp_conversations")
          .update({ contact_picture: pictureUrl })
          .eq("id", conversationId);
        return;
      }

      const { data: urlData } = supabase.storage
        .from("whatsapp-media")
        .getPublicUrl(filePath);

      const permanentUrl = `${urlData.publicUrl}?t=${Date.now()}`; // Cache bust

      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ contact_picture: permanentUrl })
        .eq("id", conversationId);

      if (error) {
        console.error("Error saving profile picture:", error);
      } else {
        console.log(`Profile picture stored permanently for conversation ${conversationId}: ${filePath}`);
      }
    } catch (downloadError) {
      console.log("Error downloading/storing profile picture, saving URL directly:", downloadError);
      // Fallback: save the temporary URL
      await supabase
        .from("whatsapp_conversations")
        .update({ contact_picture: pictureUrl })
        .eq("id", conversationId);
    }
  } catch (error) {
    console.log("Could not fetch profile picture:", error);
  }
}

// ===== STOP FOLLOW-UP ON REPLY =====
// When a lead responds to a WhatsApp message, cancel any waiting/running automation executions
// and optionally move the lead to a configured stage
async function handleStopFollowUpOnReply(
  supabase: any,
  conversationId: string,
  leadId: string,
  isManualInteraction: boolean = false
) {
  try {
    console.log(`Checking for follow-up automations to stop for lead ${leadId}`);
    
    // Find all running or waiting executions for this lead or conversation
    const { data: executions, error: execError } = await supabase
      .from("automation_executions")
      .select(`
        id,
        lead_id,
        conversation_id,
        organization_id,
        status,
        automation:automations(
          id,
          name,
          trigger_config,
          created_by
        )
      `)
      .or(`lead_id.eq.${leadId},conversation_id.eq.${conversationId}`)
      .in("status", ["running", "waiting"]);
    
    if (execError) {
      console.error("Error fetching automation executions:", execError);
      return;
    }
    
    if (!executions || executions.length === 0) {
      console.log("No running/waiting automations found for this lead");
      return;
    }
    
    console.log(`Found ${executions.length} automation execution(s) to check`);
    
    // Fetch lead info once for all executions
    const { data: leadInfo } = await supabase
      .from("leads")
      .select("id, name, phone, assigned_user_id, organization_id")
      .eq("id", leadId)
      .single();

    const stoppedAutomations = new Set<string>();
    let notifyUserId: string | null = leadInfo?.assigned_user_id;

    for (const exec of executions) {
      const triggerConfig = exec.automation?.trigger_config || {};
      
      // Default behavior: stop on reply UNLESS explicitly disabled (stop_on_reply === false)
      if (!isManualInteraction && triggerConfig.stop_on_reply === false) {
        console.log(`Automation ${exec.automation?.name || exec.id} has stop_on_reply explicitly disabled, skipping`);
        continue;
      }
      
      console.log(`${isManualInteraction ? 'Manual interaction' : 'Lead replied'} during automation "${exec.automation?.name}" - checking for ${isManualInteraction ? 'cancellation' : 'replied branch'}`);
      
      // If it's a manual interaction, we cancel everything and DON'T follow branches or send auto-replies
      if (isManualInteraction) {
        await supabase
          .from("automation_executions")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            error_message: "Cancelado: intervenção humana",
          })
          .eq("id", exec.id);
        
        // Activity log for audit
        if (exec.lead_id) {
          await supabase.from("activities").insert({
            lead_id: exec.lead_id,
            type: "automation_cancelled_manual",
            content: `Automação "${exec.automation?.name}" cancelada: atendimento humano iniciado`,
            metadata: { is_automation: true, execution_id: exec.id, automation_id: exec.automation?.id },
            user_id: null,
          }).then(() => {}, () => {});
        }
        if (exec.automation?.name) stoppedAutomations.add(exec.automation.name);
        console.log(`Automation ${exec.id} cancelled due to manual intervention`);
        continue;
      }
      
      // Keep track of the user to notify (prefer lead owner, fallback to automation creator)
      if (!notifyUserId) {
        notifyUserId = exec.automation?.created_by;
      }
      
      // ===== KEY FIX: Instead of cancelling, check if there's a "replied" branch to continue =====
      // Fetch the full automation with nodes and connections to find the replied branch
      const { data: fullAutomation } = await supabase
        .from("automations")
        .select(`
          id, name, trigger_config,
          nodes:automation_nodes(*),
          connections:automation_connections(*)
        `)
        .eq("id", exec.automation?.id)
        .single();
      
      let continuedViaReplyBranch = false;
      
      if (fullAutomation) {
        // First, get the execution's current state
        const { data: execState } = await supabase
          .from("automation_executions")
          .select("current_node_id")
          .eq("id", exec.id)
          .single();
        
        const currentNodeId = execState?.current_node_id;
        
        if (currentNodeId && fullAutomation.connections && fullAutomation.nodes) {
          // Find which delay node leads to current_node_id via "no_reply"
          const noReplyConn = fullAutomation.connections.find(
            (c: any) => c.target_node_id === currentNodeId && 
                         (c.source_handle === "no_reply" || c.source_handle === "default" || !c.source_handle)
          );
          
          let delayNodeId = noReplyConn?.source_node_id;
          
          if (!delayNodeId) {
            const currentNode = fullAutomation.nodes.find((n: any) => n.id === currentNodeId);
            if (currentNode && (currentNode.node_type === "delay")) {
              delayNodeId = currentNodeId;
            }
          }
          
          if (!delayNodeId) {
            const anyConn = fullAutomation.connections.find(
              (c: any) => c.target_node_id === currentNodeId
            );
            if (anyConn) {
              const sourceNode = fullAutomation.nodes.find((n: any) => n.id === anyConn.source_node_id);
              if (sourceNode && sourceNode.node_type === "delay") {
                delayNodeId = sourceNode.id;
              }
            }
          }
          
          // ===== Per-node stop_on_reply override =====
          // If the delay node explicitly has stop_on_reply === false, keep waiting and
          // skip this execution entirely (no branch, no cancel).
          if (delayNodeId) {
            const delayNode = fullAutomation.nodes.find((n: any) => n.id === delayNodeId);
            const delayCfg = (delayNode?.node_config || delayNode?.config || {}) as Record<string, unknown>;
            if (delayCfg.stop_on_reply === false) {
              console.log(`Delay node ${delayNodeId} has stop_on_reply=false — keeping execution running`);
              continuedViaReplyBranch = true; // prevents the fallback cancel below
            }
          }

          if (delayNodeId && !continuedViaReplyBranch) {
            // Now find the "replied" branch connection from this delay node
            const repliedConn = fullAutomation.connections.find(
              (c: any) => c.source_node_id === delayNodeId && c.source_handle === "replied"
            );
            
            if (repliedConn && repliedConn.target_node_id) {
              console.log(`✅ Found "replied" branch! Continuing flow to node ${repliedConn.target_node_id}`);
              
              // Update execution to continue along the replied branch (NOT cancel!)
              const { error: updateError } = await supabase
                .from("automation_executions")
                .update({
                  status: "running",
                  current_node_id: repliedConn.target_node_id,
                  next_execution_at: null,
                  error_message: null,
                })
                .eq("id", exec.id);
              
              if (!updateError) {
                continuedViaReplyBranch = true;
                
                // Invoke executor to process the next node in the replied branch
                const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
                const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
                
                const resp = await fetch(`${SUPABASE_URL}/functions/v1/automation-executor`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  },
                  body: JSON.stringify({ execution_id: exec.id }),
                });
                console.log(`Executor invoked for replied branch: ${resp.status}`);
              } else {
                console.error(`Error updating execution for replied branch:`, updateError);
              }
            } else {
              console.log(`No "replied" branch found for delay node ${delayNodeId}`);
            }
          } else {
            console.log(`Could not find delay node for current_node_id ${currentNodeId}`);
          }
        }
      }
      
      // If we didn't continue via reply branch, fall back to cancel + legacy behavior
      if (!continuedViaReplyBranch) {
        const { error: updateError } = await supabase
          .from("automation_executions")
          .update({
            status: "cancelled",
            completed_at: new Date().toISOString(),
            error_message: "Cancelado: lead respondeu",
          })
          .eq("id", exec.id);
        
        if (!updateError) {
          console.log(`Falling back to cancel behavior for execution ${exec.id}`);
          if (exec.lead_id) {
            await supabase.from("activities").insert({
              lead_id: exec.lead_id,
              type: "automation_cancelled_reply",
              content: `Automação "${exec.automation?.name}" cancelada: lead respondeu`,
              metadata: { is_automation: true, execution_id: exec.id, automation_id: exec.automation?.id },
              user_id: null,
            }).then(() => {}, () => {});
          }
          if (exec.automation?.name) stoppedAutomations.add(exec.automation.name);
        }
      }

    }

    // ===== CREATE CONSOLIDATED "LEAD RECOVERED" NOTIFICATION =====
    if (stoppedAutomations.size > 0 && notifyUserId) {
      try {
        const leadName = leadInfo?.name || "Lead";
        const automationNames = Array.from(stoppedAutomations).join(", ");
        
        await supabase.from("notifications").insert({
          user_id: notifyUserId,
          organization_id: leadInfo?.organization_id || executions[0].organization_id,
          title: "🎉 Lead Recuperado!",
          content: `"${leadName}" respondeu à automação "${automationNames}"`,
          type: "lead",
          lead_id: leadId,
          is_read: false,
        });
      } catch (notifError) {
        console.error("Error sending lead recovered notification:", notifError);
      }
    }
  } catch (error) {
    console.error("Error in handleStopFollowUpOnReply:", error);
  }
}

function normalizeText(value: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}
