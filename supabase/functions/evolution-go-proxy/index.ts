/* eslint-disable @typescript-eslint/no-explicit-any */
// Evolution Go proxy for the Vimob WhatsApp module.
// Browser callers never receive the Evolution Go API key; every action is scoped
// to a CRM WhatsApp session.
import { createClient } from "npm:@supabase/supabase-js@2";
import { authorizePrivateWorkerRequest } from "../_shared/private-worker-auth.ts";
import {
  readSupabaseSecretKeyEnvironment,
  selectSupabaseAdminSecretKey,
  type SupabaseSecretKeyEnvironment,
} from "../_shared/supabase-secret-keys.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, any>;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const EVOLUTION_GO_API_URL = (Deno.env.get("EVOLUTION_GO_API_URL") || "").replace(/\/+$/, "");
const EVOLUTION_GO_API_KEY = Deno.env.get("EVOLUTION_GO_API_KEY") || "";
const EVOLUTION_GO_REQUEST_TIMEOUT_MS = 20_000;

type SupabaseAdminClient = ReturnType<typeof createClient>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// Mirrors deterministicProviderMessageID in the canonical Go WhatsApp API:
// SHA-256(clientMessageId), truncated to 128 bits and encoded as uppercase hex.
const PROVIDER_MESSAGE_ID_RE = /^[0-9A-F]{32}$/;

class InvalidEvolutionPayloadError extends Error {}

function createSupabaseAdminClient(
  secretEnvironment: SupabaseSecretKeyEnvironment,
) {
  const supabaseAdminKey = selectSupabaseAdminSecretKey(secretEnvironment);
  return SUPABASE_URL && supabaseAdminKey
    ? createClient(SUPABASE_URL, supabaseAdminKey)
    : null;
}

function json(body: JsonRecord, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function getNested(obj: any, path: string) {
  return path.split(".").reduce((acc, key) => acc?.[key], obj);
}

function firstPresent(...values: any[]) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function withoutEmpty(obj: JsonRecord) {
  return Object.fromEntries(
    Object.entries(obj).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  );
}

function optionalUuid(value: any) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return UUID_RE.test(text) ? text : null;
}

function normalizeMentionedJids(value: any) {
  if (!value) return undefined;
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return undefined;
}

function providerMessageId(body: JsonRecord, allowProviderMessageId: boolean) {
  const candidate = firstPresent(body.id, body.messageId, body.clientMessageId);
  if (candidate === undefined) return undefined;
  if (typeof candidate !== "string" || !PROVIDER_MESSAGE_ID_RE.test(candidate)) {
    throw new InvalidEvolutionPayloadError(
      "Evolution Go message id must be 32 uppercase hexadecimal characters",
    );
  }
  return allowProviderMessageId ? candidate : undefined;
}

function normalizeQr(data: any) {
  const paths = [
    "qrcode",
    "Qrcode",
    "qrCode",
    "base64",
    "code",
    "data.qrcode",
    "data.Qrcode",
    "data.base64",
    "data.code",
  ];

  for (const path of paths) {
    const value = getNested(data, path);
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
}

function normalizeStatus(data: any) {
  const target = data?.data || data || {};
  const rawState = String(target.state || target.connectionStatus || "").toLowerCase();
  const rawStatus = String(target.status || "").toLowerCase();
  const loggedIn = target.loggedIn === true || target.LoggedIn === true;
  const loggedOut = target.loggedIn === false || target.LoggedIn === false;
  const connected = target.connected === true || target.Connected === true;

  // Evolution Go/whatsmeow rule: LoggedIn is the only real paired state.
  if ((loggedIn || rawState === "open" || rawStatus === "open") && !loggedOut) {
    return "connected";
  }

  if (connected || rawState === "qr" || rawStatus === "qr" || normalizeQr(data)) {
    return "qr_ready";
  }

  if (
    loggedOut ||
    ["close", "closed", "disconnected", "disconnect", "offline", "logout", "logged_out"].includes(rawState) ||
    ["close", "closed", "disconnected", "offline", "logout", "logged_out"].includes(rawStatus)
  ) {
    return "disconnected";
  }

  return "disconnected";
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
    "key.ID",
    "Info.ID",
    "Info.Id",
    "data.sentMessageId",
    "data.messageId",
    "data.messageID",
    "data.MessageID",
    "data.id",
    "data.ID",
    "data.key.id",
    "data.Key.ID",
    "data.Info.ID",
    "data.Info.Id",
    "message.key.id",
    "data.message.key.id",
    "response.key.id",
  ];

  for (const path of paths) {
    const value = getNested(data, path);
    if (value) return String(value);
  }

  return null;
}

function extractInstanceId(data: any) {
  const paths = [
    "id",
    "uuid",
    "instance.id",
    "instance.uuid",
    "data.id",
    "data.uuid",
    "data.instance.id",
    "data.instance.uuid",
  ];

  for (const path of paths) {
    const value = getNested(data, path);
    if (value) return String(value);
  }

  return null;
}

function sendCommonBody(body: JsonRecord, allowProviderMessageId: boolean) {
  return withoutEmpty({
    id: providerMessageId(body, allowProviderMessageId),
    number: firstPresent(body.number, body.phone, body.jid, body.remoteJid),
    delay: body.delay,
    quoted: body.quoted,
    mentionAll: body.mentionAll,
    mentionedJid: normalizeMentionedJids(firstPresent(body.mentionedJid, body.mentionedJids, body.mentions)),
  });
}

function sendTextBody(body: JsonRecord, allowProviderMessageId: boolean) {
  return withoutEmpty({
    ...sendCommonBody(body, allowProviderMessageId),
    text: firstPresent(body.text, body.message, body.body, body.caption),
  });
}

function sendMediaBody(body: JsonRecord, allowProviderMessageId: boolean, forcedType?: string) {
  const type = firstPresent(forcedType, body.type, body.mediatype, body.mediaType, body.kind);
  const media = firstPresent(body.url, body.mediaUrl, body.media, body.base64, body.path, body.file);
  const filename = firstPresent(body.filename, body.fileName, body.name);

  return withoutEmpty({
    ...sendCommonBody(body, allowProviderMessageId),
    type,
    mediatype: type,
    mediaType: type,
    url: media,
    media,
    base64: body.base64,
    path: media,
    file: media,
    audio: type === "audio" ? media : undefined,
    image: type === "image" ? media : undefined,
    video: type === "video" ? media : undefined,
    document: type === "document" ? media : undefined,
    mimetype: body.mimetype,
    caption: body.caption,
    filename,
    fileName: filename,
    ptt: firstPresent(body.ptt, type === "audio" ? true : undefined),
  });
}

function isSendAction(action: string) {
  return [
    "send.text",
    "send.media",
    "send.audio",
    "send.sticker",
    "send.location",
    "send.contact",
    "send.link",
    "send.poll",
  ].includes(action);
}

function getInstanceCandidates(session: any, payload: any) {
  const settings = session?.advanced_settings || {};
  return Array.from(new Set([
    settings.evolution_go_resolved_instance_key,
    session?.instance_name,
    session?.instance_id,
    payload?.instance_name,
    payload?.instanceName,
    payload?.instance_id,
    payload?.instanceId,
  ].filter(Boolean).map(String)));
}

function getInstanceKey(session: any, payload: any) {
  return getInstanceCandidates(session, payload)[0] || "";
}

function getSessionToken(session: any, payload: any) {
  const token = payload?.token || session?.advanced_settings?.token;
  return token && token !== "default_token" ? token : EVOLUTION_GO_API_KEY;
}

async function authenticate(
  req: Request,
  secretEnvironment: SupabaseSecretKeyEnvironment,
  supabaseAdmin: SupabaseAdminClient,
) {
  if (authorizePrivateWorkerRequest(req, secretEnvironment)) {
    return { serviceRole: true, userId: "service_role" };
  }

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return { error: "Unauthorized" };

  const bearer = authHeader.replace("Bearer ", "").trim();
  const { data, error } = await supabaseAdmin.auth.getUser(bearer);
  if (error || !data?.user) return { error: "Unauthorized" };

  return { serviceRole: false, userId: data.user.id };
}

async function getSession(payload: JsonRecord, supabaseAdmin: SupabaseAdminClient) {
  const sessionId = optionalUuid(firstPresent(payload.session_id, payload.sessionId));
  if (!sessionId) return null;

  const { data, error } = await supabaseAdmin
    .from("whatsapp_sessions")
    .select("*")
    .eq("id", sessionId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

async function assertSessionAccess(session: any, userId: string) {
  if (!session?.id) throw new Error("WhatsApp session is required");
  if (userId === "service_role") return;

  if (session.owner_user_id === userId) return;

  throw new Error("Forbidden");
}

async function evolutionFetch(
  method: string,
  path: string,
  options: {
    body?: any;
    query?: Record<string, string | number | undefined | null>;
    instanceId?: string;
    token?: string;
    markBackendFetchAttempted?: () => void;
  } = {},
) {
  if (!EVOLUTION_GO_API_URL || !EVOLUTION_GO_API_KEY) {
    throw new Error("Evolution Go API configuration missing");
  }

  const url = new URL(`${EVOLUTION_GO_API_URL}${path}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: options.token || EVOLUTION_GO_API_KEY,
  };
  if (options.instanceId) headers.instanceId = options.instanceId;

  const requestBody = options.body !== undefined && method !== "GET" && method !== "HEAD"
    ? JSON.stringify(options.body)
    : undefined;
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), EVOLUTION_GO_REQUEST_TIMEOUT_MS);

  // This is the effect boundary. Errors before this callback prove that the
  // provider was not contacted; errors at or after it are outcome-unknown.
  try {
    options.markBackendFetchAttempted?.();
    const response = await fetch(url.toString(), {
      method,
      headers,
      body: requestBody,
      signal: abortController.signal,
    });

    const rawText = await response.text();
    let data: any = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = { raw: rawText };
    }

    return { ok: response.ok, status: response.status, data, rawText };
  } finally {
    clearTimeout(timeout);
  }
}

async function smartFetch(
  method: string,
  primaryPath: string,
  fallbackPath: string,
  instanceKey: string,
  token: string,
  markBackendFetchAttempted: () => void,
) {
  let result = await evolutionFetch(method, primaryPath, { token, markBackendFetchAttempted });
  let endpointUsed = primaryPath;

  if (result.status === 404) {
    result = await evolutionFetch(method, fallbackPath, {
      token,
      instanceId: instanceKey,
      query: { instanceId: instanceKey },
      markBackendFetchAttempted,
    });
    endpointUsed = fallbackPath;
  }

  return { ...result, endpointUsed };
}

function endpointFor(
  action: string,
  body: JsonRecord,
  instanceKey: string,
  allowProviderMessageId = false,
) {
  switch (action) {
    case "instance.create":
      return {
        method: "POST",
        path: "/instance/create",
        body: {
          name: firstPresent(body.name, body.instanceName, instanceKey),
          instanceName: firstPresent(body.instanceName, body.name, instanceKey),
          token: body.token || "default_token",
          webhookUrl: firstPresent(body.webhookUrl, body.webhook_url, body.url),
          webhook_url: firstPresent(body.webhook_url, body.webhookUrl, body.url),
          subscribe: body.subscribe,
          events: body.events,
          advancedSettings: {
            rejectCall: false,
            groupsIgnore: false,
            alwaysOnline: true,
            readMessages: false,
            readStatus: false,
            syncFullHistory: false,
            ...(body.advancedSettings || {}),
          },
        },
      };
    case "instance.connect":
      return {
        method: "POST",
        path: "/instance/connect",
        query: { instanceId: instanceKey },
        body,
      };
    case "instance.delete":
      return { method: "DELETE", path: `/instance/delete/${encodeURIComponent(instanceKey)}` };
    case "instance.disconnect":
      return { method: "POST", path: "/instance/disconnect", query: { instanceId: instanceKey } };
    case "instance.logout":
      return { method: "DELETE", path: "/instance/logout", query: { instanceId: instanceKey } };
    case "send.text":
      return { method: "POST", path: "/send/text", body: sendTextBody(body, allowProviderMessageId) };
    case "send.media":
      return { method: "POST", path: "/send/media", body: sendMediaBody(body, allowProviderMessageId) };
    case "send.audio":
      return { method: "POST", path: "/send/media", body: sendMediaBody(body, allowProviderMessageId, "audio") };
    case "send.sticker":
      return { method: "POST", path: "/send/sticker", body };
    case "message.delete":
      return { method: "POST", path: "/message/delete", body };
    case "message.edit":
      return { method: "POST", path: "/message/edit", body };
    case "message.react":
      return { method: "POST", path: "/message/react", body };
    case "message.markread":
      if (body.allowWhatsAppReadReceipt !== true) {
        return { skipped: true, reason: "read_receipts_disabled" };
      }
      return { method: "POST", path: "/message/markread", body: withoutEmpty({
        jid: firstPresent(body.jid, body.remoteJid, body.number),
        messageIds: body.messageIds,
        messageId: body.messageId,
      }) };
    case "chat.archive":
      return { method: "POST", path: "/chat/archive", body };
    case "chat.mute":
      return { method: "POST", path: "/chat/mute", body };
    case "chat.pin":
      return { method: "POST", path: "/chat/pin", body };
    case "chat.historySync":
      return { method: "POST", path: "/chat/historySync", body };
    case "label.list":
      return { method: "GET", path: "/label" };
    case "label.addChat":
      return { method: "POST", path: "/label/chat", body };
    case "label.removeChat":
      return { method: "POST", path: "/unlabel/chat", body };
    case "group.myAll":
      return { method: "GET", path: "/group/myall" };
    case "group.info":
      return { method: "POST", path: "/group/info", body };
    case "group.inviteLink":
      return { method: "POST", path: "/group/invitelink", body };
    case "group.setName":
      return { method: "POST", path: "/group/name", body };
    case "group.setDescription":
      return { method: "POST", path: "/group/description", body };
    case "group.setPhoto":
      return { method: "POST", path: "/group/photo", body };
    case "user.avatar":
      return { method: "POST", path: "/user/avatar", body };
    case "user.check":
      return { method: "POST", path: "/user/check", body };
    case "user.contacts":
      return { method: "GET", path: "/user/contacts" };
    default:
      throw new Error(`Unsupported Evolution Go action: ${action}`);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  let backendFetchAttempted = false;
  const markBackendFetchAttempted = () => {
    backendFetchAttempted = true;
  };

  try {
    const secretEnvironment = readSupabaseSecretKeyEnvironment();
    const supabaseAdmin = createSupabaseAdminClient(secretEnvironment);
    if (!supabaseAdmin) {
      console.error("Evolution Go proxy configuration unavailable");
      return json({
        ok: false,
        error: "Worker configuration unavailable",
        effect_not_attempted: true,
      }, 500);
    }

    const auth = await authenticate(req, secretEnvironment, supabaseAdmin);
    if (auth.error) return json({ ok: false, error: auth.error }, 401);

    const payload = await req.json().catch(() => ({}));
    const action = String(payload.action || "");
    if (!action) return json({ ok: false, error: "Missing action" }, 400);

    const session = await getSession(payload, supabaseAdmin);
    const body = payload.body || {};
    const instanceKey = getInstanceKey(session, payload);
    const token = getSessionToken(session, payload);

    if (action !== "instance.create" && action !== "instance.all" && !instanceKey) {
      return json({ ok: false, error: "Evolution Go instance key missing" });
    }

    if (session) {
      await assertSessionAccess(session, auth.userId!);
    } else if (!auth.serviceRole) {
      return json({ ok: false, error: "WhatsApp session is required" }, 400);
    }

    if (action === "instance.status") {
      const result = await smartFetch(
        "GET",
        `/instance/${encodeURIComponent(instanceKey)}/status`,
        "/instance/status",
        instanceKey,
        token,
        markBackendFetchAttempted,
      );
      const normalizedStatus = result.ok ? normalizeStatus(result.data) : null;

      if (session?.id && normalizedStatus) {
        const update: JsonRecord = {
          status: normalizedStatus,
          updated_at: new Date().toISOString(),
        };
        const jid = firstPresent(result.data?.jid, result.data?.data?.jid);
        if (normalizedStatus === "connected") {
          update.last_connected_at = new Date().toISOString();
          if (jid) update.phone_number = String(jid).split("@")[0];
        }

        await supabaseAdmin.from("whatsapp_sessions").update(update).eq("id", session.id);
      }

      return json({
        ok: result.ok,
        status: result.status,
        normalizedStatus,
        error: result.ok ? undefined : "Unable to read WhatsApp status",
      });
    }

    if (action === "instance.qr") {
      const result = await smartFetch(
        "GET",
        `/instance/${encodeURIComponent(instanceKey)}/qrcode`,
        "/instance/qr",
        instanceKey,
        token,
        markBackendFetchAttempted,
      );
      const qrcode = normalizeQr(result.data);

      if (session?.id && qrcode) {
        await supabaseAdmin
          .from("whatsapp_sessions")
          .update({
            status: "qr_ready",
            advanced_settings: {
              ...(session.advanced_settings || {}),
              qr_code: qrcode,
              qr_updated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.id);
      }

      return json({
        ok: result.ok && !!qrcode,
        status: result.status,
        data: qrcode ? { qrcode } : undefined,
        error: qrcode ? undefined : "QR Code ainda nao disponivel.",
      });
    }

    // Only the private worker may choose the deterministic provider stanza ID.
    // Browser calls keep their historical send behavior, but cannot inject an
    // ID that could collide with a different provider message.
    const allowProviderMessageId = auth.serviceRole === true && !!session?.id;
    const endpoint = endpointFor(action, body, instanceKey, allowProviderMessageId);
    if ("skipped" in endpoint) return json({ ok: true, ...endpoint });

    const result = await evolutionFetch(endpoint.method!, endpoint.path!, {
      body: endpoint.body,
      query: endpoint.query,
      instanceId: instanceKey,
      token,
      markBackendFetchAttempted,
    });

    const sentMessageId = isSendAction(action) ? extractSentMessageId(result.data) : null;
    const responseData = sentMessageId
      ? { ...(typeof result.data === "object" && result.data ? result.data : { data: result.data }), sentMessageId, messageId: sentMessageId }
      : result.data;

    if (session?.id && action === "instance.create" && result.ok) {
      const instanceId = extractInstanceId(result.data);
      if (instanceId) {
        await supabaseAdmin
          .from("whatsapp_sessions")
          .update({ instance_id: instanceId, updated_at: new Date().toISOString() })
          .eq("id", session.id);
      }
    }

    if (session?.id && ["instance.delete", "instance.logout", "instance.disconnect"].includes(action) && result.ok) {
      await supabaseAdmin
        .from("whatsapp_sessions")
        .update({ status: "disconnected", updated_at: new Date().toISOString() })
        .eq("id", session.id);
    }

    const semanticFailure =
      result.data?.success === false ||
      result.data?.ok === false ||
      result.data?.data?.success === false ||
      result.data?.data?.ok === false;
    const ok = result.ok && !semanticFailure;

    return json({
      ok,
      status: result.status,
      data: ok ? responseData : undefined,
      error: ok ? undefined : "WhatsApp provider request failed",
    });
  } catch (error) {
    console.error("evolution-go-proxy error:", error);
    const status = error instanceof InvalidEvolutionPayloadError ? 400 : 500;
    return json(
      {
        ok: false,
        error: error instanceof InvalidEvolutionPayloadError
          ? error.message
          : "Internal worker error",
        ...(status >= 500 && !backendFetchAttempted
          ? { effect_not_attempted: true }
          : {}),
      },
      status,
    );
  }
});
