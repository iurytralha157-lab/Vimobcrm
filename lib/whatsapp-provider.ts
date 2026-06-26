import type { WhatsAppSession } from "@/hooks/use-whatsapp-sessions";
import { callEvolutionGo } from "@/hooks/use-evolution-go";

type WhatsAppMediaType = "image" | "video" | "document" | "audio";

interface SendOptions {
  isGroup?: boolean;
  mentions?: string[];
}

interface WhatsAppSendResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

type ProviderRecord = Record<string, unknown>;

function asRecord(value: unknown): ProviderRecord | null {
  return typeof value === "object" && value !== null ? value as ProviderRecord : null;
}

function normalizeGoResponse(result: unknown): WhatsAppSendResult {
  const resultRecord = asRecord(result);
  const data = resultRecord?.data;
  const dataRecord = asRecord(data);
  const nestedDataRecord = asRecord(dataRecord?.data);
  const responseRecord = asRecord(dataRecord?.response);
  const providerSuccessFlag = dataRecord?.success ?? dataRecord?.ok ?? nestedDataRecord?.success ?? nestedDataRecord?.ok;
  const failed = resultRecord?.ok !== true || providerSuccessFlag === false;
  const error =
    resultRecord?.error ||
    (failed
      ? dataRecord?.error ||
        dataRecord?.message ||
        nestedDataRecord?.error ||
        nestedDataRecord?.message ||
        responseRecord?.message ||
        dataRecord?.raw
      : undefined);

  return {
    ok: !failed,
    data,
    error: error ? String(error) : undefined,
  };
}

function normalizeMimeType(mediatype: WhatsAppMediaType, mimetype: string) {
  if (mediatype === "audio") return "audio/ogg";
  if (mediatype === "document" && !mimetype) return "application/octet-stream";
  return mimetype || "application/octet-stream";
}

function isBase64String(s: string): boolean {
  if (!s || s.length < 4) return false;
  // Allow base64 with or without data: prefix
  if (s.startsWith("data:")) return true;
  // Pure base64: only valid base64 chars (may have padding)
  return /^[A-Za-z0-9+/]/.test(s) && !/^https?:\/\//.test(s);
}

/**
 * Provider router: same operation, but routed to the correct backend
 * depending on session.provider.
 *
 * The goal is to keep all UI components provider-agnostic.
 */
export function getWhatsAppClient(session: Pick<WhatsAppSession, "provider" | "id" | "instance_name">) {
  const isGo = session.provider === "evolution_go";

  async function sendText(number: string, text: string, options: SendOptions = {}) {
    if (!isGo) {
      return { ok: false, error: "Evolution legada esta desativada." };
    }
    const result = await callEvolutionGo("send.text", {
      session_id: session.id,
      body: { number, text, mentions: options.mentions || [] },
    });
    return normalizeGoResponse(result);
  }

  async function sendMedia(
    number: string,
    media: string,
    mediatype: WhatsAppMediaType,
    mimetype: string,
    fileName?: string,
    caption?: string,
    options: SendOptions = {},
  ) {
    if (!isGo) {
      return { ok: false, error: "Evolution legada esta desativada." };
    }
    const normalizedMimeType = normalizeMimeType(mediatype, mimetype);
    const isBase64 = isBase64String(media);
    // For audio: always send as base64 so Evolution Go treats it as PTT voice note.
    // For other media: prefer a URL (signed) when possible, fall back to base64.
    const urlField = !isBase64 ? media : undefined;
    const base64Field = isBase64 ? media : undefined;
    const result = await callEvolutionGo(mediatype === "audio" ? "send.audio" : "send.media", {
      session_id: session.id,
      body: {
        number,
        type: mediatype,
        url: urlField,
        media: urlField || base64Field,
        base64: base64Field,
        audio: mediatype === "audio" ? (base64Field || urlField) : undefined,
        mediatype,
        mediaType: mediatype,
        mimetype: normalizedMimeType,
        fileName,
        filename: fileName,
        caption,
        mentions: options.mentions || [],
        mentionedJid: options.mentions || [],
      },
    });
    return normalizeGoResponse(result);
  }

  async function sendAudio(number: string, base64: string, mimetype = "audio/ogg") {
    return sendMedia(number, base64, "audio", mimetype);
  }

  return { sendText, sendMedia, sendAudio, isGo };
}
