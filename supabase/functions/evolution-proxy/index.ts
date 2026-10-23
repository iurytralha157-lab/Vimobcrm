import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { enforceRateLimit } from "../_shared/rate-limit.ts";
import { constantTimeTextEqual } from "../_shared/asaas-webhook.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface EvolutionResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

type EvolutionParams = Record<string, unknown>;

type EvolutionSupabaseClient = SupabaseClient;

type ConnectedSession = { id: string; instance_name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SESSION_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isSendAction(action: unknown): boolean {
  return action === "sendMessage" || action === "sendFile";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || "";
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ success: false, error: "Evolution service is unavailable" }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const authHeader = req.headers.get("Authorization");
    const bearerToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
    // This legacy endpoint is server-only. Reject before consuming an
    // untrusted body, logging its contents or constructing a privileged client.
    if (!bearerToken || !constantTimeTextEqual(bearerToken, SUPABASE_SERVICE_ROLE_KEY)) {
      return new Response(
        JSON.stringify({ success: false, error: "Evolution legada desativada" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const EVOLUTION_API_URL = Deno.env.get("EVOLUTION_API_URL");
    const EVOLUTION_API_KEY = Deno.env.get("EVOLUTION_API_KEY");
    const EVOLUTION_WEBHOOK_SECRET = Deno.env.get("EVOLUTION_WEBHOOK_SECRET")?.trim() || "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

    if (!EVOLUTION_API_URL || !EVOLUTION_API_KEY) {
      console.error("Evolution API not configured - EVOLUTION_API_URL:", !!EVOLUTION_API_URL, "EVOLUTION_API_KEY:", !!EVOLUTION_API_KEY);
      return new Response(
        JSON.stringify({ success: false, error: "Evolution API not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestBody: unknown = await req.json();
    if (requestBody === null || requestBody === undefined) {
      throw new TypeError("Request body cannot be null");
    }
    const requestParams: EvolutionParams = isRecord(requestBody) ? requestBody : Object(requestBody);
    const { action, ...params } = requestParams;

    // Initialize Supabase client for actions that need it
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    let webhookSessionToken = "";
    if (action === "createInstance" || action === "setWebhook") {
      if (!EVOLUTION_WEBHOOK_SECRET) {
        console.error("Evolution webhook provisioning secret is not configured");
        return new Response(
          JSON.stringify({ success: false, error: "Webhook provisioning unavailable" }),
          { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      webhookSessionToken = await resolveWebhookSessionToken(supabase, params);
      if (!webhookSessionToken) {
        console.error("Evolution webhook provisioning session token is unavailable");
        return new Response(
          JSON.stringify({ success: false, error: "Webhook session unavailable" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    let rateLimitIdentifier: string | undefined;
    let role = "";

    if (authHeader?.startsWith("Bearer ")) {
      const { data: claims } = await supabase.auth.getClaims(authHeader.replace("Bearer ", ""));
      rateLimitIdentifier = claims?.claims?.sub ? String(claims.claims.sub) : undefined;
      role = claims?.claims?.role ? String(claims.claims.role) : "";
    }

    if (isSendAction(action) && role !== "service_role") {
      const rateLimit = await enforceRateLimit(
        supabase,
        req,
        "evolution-proxy:whatsapp-send",
        [
          { name: "per_second", limit: 2, windowSeconds: 1 },
          { name: "per_minute", limit: 20, windowSeconds: 60 },
        ],
        corsHeaders,
        rateLimitIdentifier ? { identifier: rateLimitIdentifier } : {},
      );

      if (rateLimit.response) return rateLimit.response;
    }

    let result: EvolutionResponse;

    switch (action) {
      case "createInstance":
        result = await createInstance(
          EVOLUTION_API_URL,
          EVOLUTION_API_KEY,
          SUPABASE_URL,
          EVOLUTION_WEBHOOK_SECRET,
          webhookSessionToken,
          params,
        );
        break;

      case "getQRCode":
        result = await getQRCode(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName);
        break;

      case "getConnectionStatus":
      case "checkConnection":
        result = await getConnectionStatus(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName);
        break;

      case "sendMessage":
        result = await sendMessage(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "sendFile":
        result = await sendMedia(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "fetchChats":
        result = await fetchChats(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName);
        break;

      case "fetchMessages":
        result = await fetchMessages(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "deleteInstance":
      case "deleteSession":
        result = await deleteInstance(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName || params.sessionName);
        break;

      case "logoutInstance":
      case "logout":
        result = await logoutInstance(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName || params.sessionName);
        break;

      case "setWebhook":
        result = await setWebhook(
          EVOLUTION_API_URL,
          EVOLUTION_API_KEY,
          EVOLUTION_WEBHOOK_SECRET,
          webhookSessionToken,
          params,
        );
        break;

      case "sendSeen":
        result = await sendSeen(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "fetchProfilePicture":
        result = await fetchProfilePicture(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "updateSettings":
        result = await updateInstanceSettings(EVOLUTION_API_URL, EVOLUTION_API_KEY, params);
        break;

      case "fetchGroupInfo":
        result = await fetchGroupInfo(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName, params.groupJid);
        break;

      case "fetchAllGroups":
        result = await fetchAllGroups(EVOLUTION_API_URL, EVOLUTION_API_KEY, params.instanceName);
        break;

      case "fetchBulkProfilePictures":
        result = await fetchBulkProfilePictures(EVOLUTION_API_URL, EVOLUTION_API_KEY, supabase, params);
        break;

      default:
        result = { success: false, error: `Unknown action: ${action}` };
    }

    return new Response(
      JSON.stringify(result),
      { 
        status: 200, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );

  } catch (error: unknown) {
    console.error("Evolution proxy request failed");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function resolveWebhookSessionToken(supabase: EvolutionSupabaseClient, params: EvolutionParams): Promise<string> {
  const requestedSessionId = String(params?.session_id || params?.sessionId || "").trim();
  const requestedInstanceName = String(params?.instanceName || params?.sessionName || "").trim();

  const query = supabase
    .from("whatsapp_sessions")
    .select("id, advanced_settings")
    .eq("provider", "evolution")
    .eq("is_active", true)
    .neq("status", "deleted");

  if (SESSION_UUID_PATTERN.test(requestedSessionId)) {
    const { data, error } = await query.eq("id", requestedSessionId).maybeSingle();
    if (error) throw error;
    const token = data?.advanced_settings?.webhook_token;
    return typeof token === "string" ? token.trim() : "";
  }
  if (!requestedInstanceName) return "";

  const { data, error } = await query
    .eq("instance_name", requestedInstanceName)
    .limit(2);
  if (error) throw error;
  if (!Array.isArray(data) || data.length !== 1) return "";
  const token = data[0]?.advanced_settings?.webhook_token;
  return typeof token === "string" ? token.trim() : "";
}

function evolutionWebhookHeaders(
  webhookSecret: string,
  sessionToken: string,
): Record<string, string> {
  const normalizedSecret = webhookSecret.trim();
  const normalizedSessionToken = sessionToken.trim();
  if (!normalizedSecret || !normalizedSessionToken) {
    throw new Error("Evolution webhook provisioning credentials are not configured");
  }
  return {
    "x-webhook-secret": normalizedSecret,
    "x-webhook-token": normalizedSessionToken,
  };
}

function safeEvolutionWebhookUrl(value: string): string {
  const webhookUrl = new URL(value);
  for (const key of webhookUrl.searchParams.keys()) {
    const normalizedKey = key.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
    if ([
      "secret",
      "token",
      "apikey",
      "authorization",
      "signature",
      "accesstoken",
      "webhooksecret",
      "webhooktoken",
      "xwebhooksecret",
      "xwebhooktoken",
      "xevolutionwebhooktoken",
    ].includes(normalizedKey)) {
      throw new Error("Evolution webhook credentials are not allowed in the URL");
    }
  }
  return webhookUrl.toString();
}

async function createInstance(
  apiUrl: string,
  apiKey: string,
  supabaseUrl: string,
  webhookSecret: string,
  sessionToken: string,
  params: EvolutionParams,
): Promise<EvolutionResponse> {
  try {
    const webhookUrl = safeEvolutionWebhookUrl(`${supabaseUrl}/functions/v1/evolution-webhook`);
    
    const response = await fetch(`${apiUrl}/instance/create`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        instanceName: params.instanceName,
        qrcode: true,
        integration: "WHATSAPP-BAILEYS",
        reject_call: false,
        groupsIgnore: false,
        alwaysOnline: false,
        readMessages: false,
        readStatus: false,
        syncFullHistory: false,
        webhook: {
          url: webhookUrl,
          byEvents: false,
          base64: true,
          headers: evolutionWebhookHeaders(webhookSecret, sessionToken),
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
            "PRESENCE_UPDATE",
            "SEND_MESSAGE"
          ]
        }
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || data.error || "Failed to create instance" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution instance creation failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function getQRCode(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    // Try primary endpoint (v2 standard)
    let response = await fetch(`${apiUrl}/instance/connect/${instanceName}`, {
      method: "GET",
      headers: { "apikey": apiKey },
    });

    let data = await response.json();

    // Fallback if 404 or specific error for /instance/qr (whatsmeow style)
    if (!response.ok) {
      console.log("v2 connect failed, trying /instance/qr...");
      const fallbackRes = await fetch(`${apiUrl}/instance/qr?instanceName=${instanceName}`, {
        method: "GET",
        headers: { "apikey": apiKey },
      });
      if (fallbackRes.ok) {
        response = fallbackRes;
        data = await response.json();
      }
    }

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to get QR code" };
    }

    // Normalize qrcode string from various possible fields
    const qrcode = data.base64 || data.code || data.qrcode?.base64 || data.qrcode || (data.data?.qrcode) || (data.data?.Qrcode);
    
    return { success: true, data: { qrcode, base64: qrcode, ...data } };
  } catch (error: unknown) {
    console.error("Evolution QR request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function getConnectionStatus(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    let response = await fetch(`${apiUrl}/instance/connectionState/${instanceName}`, {
      method: "GET",
      headers: { "apikey": apiKey },
    });

    let data = await response.json();
    
    // Fallback to /instance/status?instanceName=...
    if (!response.ok) {
      const fallbackRes = await fetch(`${apiUrl}/instance/status?instanceName=${instanceName}`, {
        method: "GET",
        headers: { "apikey": apiKey },
      });
      if (fallbackRes.ok) {
        response = fallbackRes;
        data = await response.json();
      }
    }


    if (response.status === 404) {
      return { 
        success: true, 
        data: { 
          state: "close",
          status: false,
          connected: false,
          instanceNotFound: true,
          message: "A instância não existe."
        } 
      };
    }

    if (!response.ok) {
      return { 
        success: true, 
        data: { 
          state: "close",
          status: false,
          connected: false,
          error: data.message || "Falha ao verificar conexão"
        } 
      };
    }

    // Map various provider status formats
    const state = data.instance?.state || data.state || (data.Connected || data.connected ? "open" : "close");
    const isConnected = state === "open" || data.Connected === true || data.connected === true;
    
    return { 
      success: true, 
      data: { 
        ...data, 
        state: isConnected ? "open" : "close",
        status: isConnected,
        connected: isConnected
      } 
    };
  } catch {
    console.error("Evolution connection status request failed");
    return { 
      success: true, 
      data: { state: "close", status: false, connected: false } 
    };
  }
}

async function sendMessage(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { instanceName, number, text, phone, message, sessionName, mentions } = params;
    const instance = instanceName || sessionName;
    const phoneNumber = number || phone;
    const messageText = text || message;

    // Format phone number for Evolution (just digits for personal, full JID for groups)
    if (typeof phoneNumber !== "string") throw new TypeError("number or phone must be a string");
    const formattedPhone = (phoneNumber.includes("@") || params.isGroup) ? phoneNumber : phoneNumber.replace(/\D/g, "");

    const response = await fetch(`${apiUrl}/message/sendText/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        number: formattedPhone,
        text: messageText,
        mentions: mentions || [],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Check if the error is about number not existing on WhatsApp
      if (data.response?.message && Array.isArray(data.response.message)) {
        const messages: unknown[] = data.response.message;
        const notFoundNumbers = messages.filter((m): m is { exists: false; number?: unknown } => isRecord(m) && m.exists === false);
        if (notFoundNumbers.length > 0) {
          return { 
            success: false, 
            error: `Número ${notFoundNumbers[0].number} não está registrado no WhatsApp` 
          };
        }
      }
      return { success: false, error: data.message || data.error || "Failed to send message" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution text request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function sendMedia(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { 
      instanceName, number, phone, path, filename, caption, sessionName, 
      mediaUrl, mediaType, text, base64, mimetype, mentions 
    } = params;
    const instance = instanceName || sessionName;
    const phoneNumber = number || phone;
    
    // Não usar como caption se for apenas o nome do arquivo
    const rawCaption = caption || text || "";
    const isJustFilename = rawCaption && (
      rawCaption === filename || 
      /\.(png|jpg|jpeg|gif|webp|bmp|tiff|svg|mp4|mp3|pdf|doc|docx|ogg|wav|m4a|avi|mov|mkv|xlsx|xls|pptx|ppt|zip|rar)$/i.test(String(rawCaption))
    );
    const mediaCaption = isJustFilename ? "" : rawCaption;

    // Format phone number for Evolution (just digits for personal, full JID for groups)
    if (typeof phoneNumber !== "string") throw new TypeError("number or phone must be a string");
    const formattedPhone = (phoneNumber.includes("@") || params.isGroup) ? phoneNumber : phoneNumber.replace(/\D/g, "");

    // Prefer base64 if available (more reliable), fallback to URL
    const mediaContent = base64 || mediaUrl || path;
    if (mediaContent != null && typeof mediaContent !== "string") {
      throw new TypeError("media content must be a string");
    }
    

    // Determine the correct endpoint and body based on media type
    let endpoint = "sendMedia";
    let body: { number: string; media?: unknown; [key: string]: unknown };

    if (mediaType === "image") {
      endpoint = "sendMedia";
      body = {
        number: formattedPhone,
        mediatype: "image",
        mimetype: mimetype || "image/jpeg",
        caption: mediaCaption,
        fileName: filename || "image.jpg",
        media: mediaContent,
        mentions: mentions || [],
      };
    } else if (mediaType === "video") {
      endpoint = "sendMedia";
      body = {
        number: formattedPhone,
        mediatype: "video",
        mimetype: mimetype || "video/mp4",
        caption: mediaCaption,
        fileName: filename || "video.mp4",
        media: mediaContent,
        mentions: mentions || [],
      };
    } else if (mediaType === "audio") {
      endpoint = "sendWhatsAppAudio";
      body = {
        number: formattedPhone,
        audio: mediaContent,
        mentions: mentions || [],
      };
    } else if (mediaType === "document") {
      endpoint = "sendMedia";
      body = {
        number: formattedPhone,
        mediatype: "document",
        mimetype: mimetype || "application/octet-stream",
        caption: mediaCaption,
        fileName: filename || "document",
        media: mediaContent,
        mentions: mentions || [],
      };
    } else {
      // Generic fallback
      endpoint = "sendMedia";
      body = {
        number: formattedPhone,
        mediatype: mediaType || "image",
        mimetype: mimetype || "application/octet-stream",
        caption: mediaCaption,
        fileName: filename || "file",
        media: mediaContent,
        mentions: mentions || [],
      };
    }


    let response = await fetch(`${apiUrl}/message/${endpoint}/${instance}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify(body),
    });

    let data = await response.json();

    // If failed, try alternative endpoints
    if (!response.ok) {
      console.log("First endpoint failed, trying specific endpoints...");
      
      // Try specific endpoints for each type
      let altEndpoint = "";
      let altBody: Record<string, unknown> | null = null;

      if (mediaType === "image") {
        altEndpoint = "sendImage";
        altBody = {
          number: formattedPhone,
          image: mediaContent,
          caption: mediaCaption,
          mentions: mentions || [],
        };
      } else if (mediaType === "video") {
        altEndpoint = "sendVideo";
        altBody = {
          number: formattedPhone,
          video: mediaContent,
          caption: mediaCaption,
          mentions: mentions || [],
        };
      } else if (mediaType === "document") {
        altEndpoint = "sendDocument";
        altBody = {
          number: formattedPhone,
          document: mediaContent,
          fileName: filename || "document",
          caption: mediaCaption,
          mentions: mentions || [],
        };
      } else if (mediaType === "audio") {
        altEndpoint = "sendAudio";
        altBody = {
          number: formattedPhone,
          audio: mediaContent,
          mentions: mentions || [],
        };
      }

      if (altEndpoint && altBody) {
        response = await fetch(`${apiUrl}/message/${altEndpoint}/${instance}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "apikey": apiKey,
          },
          body: JSON.stringify(altBody),
        });
        data = await response.json();
      }
    }

    if (!response.ok) {
      // Extract error message from various response formats
      const errorMsg = data.response?.message?.[0] || data.message || data.error || "Failed to send media";
      return { success: false, error: typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg) };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution media request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchChats(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    const response = await fetch(`${apiUrl}/chat/findChats/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to fetch chats" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution chat request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchMessages(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { instanceName, remoteJid, count = 50 } = params;

    const response = await fetch(`${apiUrl}/chat/findMessages/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        where: {
          key: {
            remoteJid,
          },
        },
        limit: count,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to fetch messages" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution history request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function deleteInstance(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    // Try /instance/delete/name (v2)
    let response = await fetch(`${apiUrl}/instance/delete/${instanceName}`, {
      method: "DELETE",
      headers: { "apikey": apiKey },
    });

    // Fallback to /instance/delete?instanceName=... if needed
    if (!response.ok && response.status !== 404) {
      const fallbackRes = await fetch(`${apiUrl}/instance/delete?instanceName=${instanceName}`, {
        method: "DELETE",
        headers: { "apikey": apiKey },
      });
      if (fallbackRes.ok || fallbackRes.status === 404) response = fallbackRes;
    }

    let data: { message?: string } = {};
    try { data = await response.json(); } catch {
      // noop
    }

    if (!response.ok && response.status !== 404) {
      return { success: false, error: data.message || "Failed to delete instance" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution instance deletion failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function logoutInstance(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    const response = await fetch(`${apiUrl}/instance/logout/${instanceName}`, {
      method: "DELETE",
      headers: {
        "apikey": apiKey,
      },
    });

    let data: { message?: string } = {};
    try {
      data = await response.json();
    } catch {
      // Empty response is OK
    }

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to logout instance" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution logout request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function setWebhook(
  apiUrl: string,
  apiKey: string,
  webhookSecret: string,
  sessionToken: string,
  params: EvolutionParams,
): Promise<EvolutionResponse> {
  try {
    const { instanceName, webhookUrl } = params;
    if (typeof webhookUrl !== "string") throw new TypeError("webhookUrl must be a string");
    const safeWebhookUrl = safeEvolutionWebhookUrl(webhookUrl);

    const response = await fetch(`${apiUrl}/webhook/set/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        webhook: {
          enabled: true,
          url: safeWebhookUrl,
          headers: evolutionWebhookHeaders(webhookSecret, sessionToken),
          webhookByEvents: false,
          webhookBase64: true,
          events: [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "MESSAGES_DELETE",
            "CONNECTION_UPDATE",
            "QRCODE_UPDATED",
            "PRESENCE_UPDATE",
            "SEND_MESSAGE",
          ],
        },
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to set webhook" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution webhook configuration failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function sendSeen(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { instanceName, sessionName, phone, number, isGroup } = params;
    const instance = instanceName || sessionName;
    const phoneNumber = phone || number;
    
    if (typeof phoneNumber !== "string") throw new TypeError("phone or number must be a string");
    const formattedPhone = phoneNumber.replace(/\D/g, "");
    const remoteJid = isGroup ? `${formattedPhone}@g.us` : `${formattedPhone}@s.whatsapp.net`;

    const response = await fetch(`${apiUrl}/chat/markMessageAsRead/${instance}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        readMessages: [{ remoteJid }],
      }),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      // Empty response is OK
    }

    // Don't fail if this doesn't work - it's not critical
    return { success: true, data };
  } catch {
    console.error("Evolution read receipt request failed");
    // Return success anyway - marking as read is not critical
    return { success: true, data: {} };
  }
}

async function fetchProfilePicture(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { instanceName, number } = params;
    if (!instanceName || !number) {
      return { success: false, error: "instanceName and number are required" };
    }

    if (typeof number !== "string") throw new TypeError("number must be a string");
    const formattedPhone = number.replace(/\D/g, "");

    const response = await fetch(`${apiUrl}/chat/fetchProfilePictureUrl/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({ number: formattedPhone }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to fetch profile picture" };
    }

    return { 
      success: true, 
      data: { 
        profilePictureUrl: data.profilePictureUrl || data.wpiUrl || null 
      } 
    };
  } catch (error: unknown) {
    console.error("Evolution profile picture request failed");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}

async function updateInstanceSettings(apiUrl: string, apiKey: string, params: EvolutionParams): Promise<EvolutionResponse> {
  try {
    const { instanceName, settings } = params;
    
    if (!instanceName) {
      return { success: false, error: "instanceName is required" };
    }
    if (settings != null && !isRecord(settings)) {
      throw new TypeError("settings must be an object");
    }

    const response = await fetch(`${apiUrl}/settings/set/${instanceName}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": apiKey,
      },
      body: JSON.stringify({
        rejectCall: false,
        readMessages: false,
        readStatus: false,
        ...(isRecord(settings) ? settings : {})
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to update settings" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution settings request failed");
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: errorMessage };
  }
}

async function fetchGroupInfo(apiUrl: string, apiKey: string, instanceName: unknown, groupJid: unknown): Promise<EvolutionResponse> {
  try {
    const response = await fetch(`${apiUrl}/group/findGroupInfos/${instanceName}?groupJid=${groupJid}`, {
      method: "GET",
      headers: {
        "apikey": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to fetch group info" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution group information request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchAllGroups(apiUrl: string, apiKey: string, instanceName: unknown): Promise<EvolutionResponse> {
  try {
    const response = await fetch(`${apiUrl}/group/fetchAllGroups/${instanceName}`, {
      method: "GET",
      headers: {
        "apikey": apiKey,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return { success: false, error: data.message || "Failed to fetch groups" };
    }

    return { success: true, data };
  } catch (error: unknown) {
    console.error("Evolution group listing request failed");
    return { success: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

async function fetchBulkProfilePictures(apiUrl: string, apiKey: string, supabase: EvolutionSupabaseClient, params: EvolutionParams): Promise<EvolutionResponse> {
  const { organizationId, limit: requestedLimit = 50 } = params;
  if (typeof organizationId !== "string" || !organizationId) return { success: false, error: "organizationId is required" };
  if (typeof requestedLimit !== "number" && (typeof requestedLimit !== "string" || !requestedLimit.trim())) {
    return { success: false, error: "limit must be a number" };
  }
  const limit = Number(requestedLimit);
  if (!Number.isFinite(limit)) return { success: false, error: "limit must be a number" };


  const { data: rawSessions } = await supabase
    .from("whatsapp_sessions")
    .select("id, instance_name")
    .eq("organization_id", organizationId)
    .eq("status", "connected");

  const sessionRows: unknown[] = Array.isArray(rawSessions) ? rawSessions : [];
  const sessions = sessionRows.filter((session): session is ConnectedSession =>
    isRecord(session) && typeof session.id === "string" && typeof session.instance_name === "string"
  );
  if (!sessions?.length) return { success: true, data: { updated: 0, message: "No connected sessions" } };

  const sessionIds = sessions.map((s) => s.id);
  const { data: conversations } = await supabase
    .from("whatsapp_conversations")
    .select("id, contact_phone, session_id")
    .in("session_id", sessionIds)
    .is("contact_picture", null)
    .eq("is_group", false)
    .not("contact_phone", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  if (!conversations?.length) return { success: true, data: { updated: 0, message: "All have pictures" } };

  const sessionMap = new Map(sessions.map((s) => [s.id, s.instance_name] as const));
  let updated = 0;

  for (const conv of conversations) {
    const instanceName = sessionMap.get(conv.session_id);
    if (!instanceName) continue;
    const formattedPhone = conv.contact_phone.replace(/\D/g, "");
    try {
      const response = await fetch(`${apiUrl}/chat/fetchProfilePictureUrl/${instanceName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: apiKey },
        body: JSON.stringify({ number: formattedPhone }),
      });
      if (response.ok) {
        const data = await response.json();
        const pictureUrl = data.profilePictureUrl || data.wpiUrl;
        if (pictureUrl) {
          await supabase.from("whatsapp_conversations").update({ contact_picture: pictureUrl }).eq("id", conv.id);
          updated++;
        }
      }
    } catch { console.log("Evolution bulk profile picture item failed"); }
    await new Promise((r) => setTimeout(r, 100));
  }

  console.log("Updated", updated, "profile pictures");
  return { success: true, data: { updated, total: conversations.length } };
}
