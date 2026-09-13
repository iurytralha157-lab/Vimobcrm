import { format } from "date-fns";

import type { MessageMediaKind } from "../message-media";

export type MessageBubbleMediaKind = MessageMediaKind | "text" | "reaction" | "deleted";

export function generateMessageWaveform(seed: string, count = 40): number[] {
  const bars: number[] = [];
  let hash = 0;

  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index);
    hash &= hash;
  }

  for (let index = 0; index < count; index += 1) {
    const value = Math.abs(
      Math.sin(hash * (index + 1) * 0.1) * Math.cos(hash * (index + 1) * 0.05),
    );
    bars.push(0.2 + value * 0.8);
  }

  return bars;
}

export function toSafeMessageText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return "[conteúdo indisponível]";
  }
}

export function cleanMessageMimeType(value: string | null | undefined): string {
  const mimeType = String(value || "").split(";")[0]?.trim().toLowerCase();
  return mimeType || "";
}

export function getEffectiveMessageMediaKind(
  messageType: string,
  mediaMimeType: string | null,
  mediaUrl: string | null,
): MessageBubbleMediaKind {
  const type = String(messageType || "text").toLowerCase();
  const mimeType = cleanMessageMimeType(mediaMimeType);

  if (type === "deleted") return "deleted";
  if (type === "reaction") return "reaction";
  if (type === "sticker") return "sticker";
  if (type === "audio" || type === "video" || type === "image") return type;

  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType === "image/webp") return "sticker";
  if (mimeType.startsWith("image/")) return "image";

  if (type === "document") return "document";
  if (mediaUrl && type !== "text") return "document";
  return "text";
}

export function normalizeMessageMediaMimeType(
  mediaMimeType: string | null,
  mediaKind: MessageBubbleMediaKind,
): string | undefined {
  const mimeType = cleanMessageMimeType(mediaMimeType);
  if (mimeType && mimeType !== "application/octet-stream") return mimeType;

  switch (mediaKind) {
    case "audio":
      return "audio/ogg";
    case "video":
      return "video/mp4";
    case "sticker":
      return "image/webp";
    case "image":
      return "image/jpeg";
    case "document":
      return "application/octet-stream";
    default:
      return undefined;
  }
}

export function toCanonicalMessageMediaKind(
  mediaKind: MessageBubbleMediaKind,
): MessageMediaKind {
  switch (mediaKind) {
    case "image":
    case "video":
    case "audio":
    case "document":
    case "sticker":
      return mediaKind;
    default:
      return "document";
  }
}

export function formatMessageTime(date: string): string {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return format(parsed, "HH:mm");
}

export function formatMessageAudioDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds) || isNaN(seconds)) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

export function formatMessageFileSize(bytes: number | null | undefined): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getNextReactionEmoji(currentEmoji: string | null, selectedEmoji: string): string {
  return currentEmoji === selectedEmoji ? "" : selectedEmoji;
}
