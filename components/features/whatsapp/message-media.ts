export type MessageMediaKind = "image" | "video" | "audio" | "document" | "sticker";

const MAX_MEDIA_URL_LENGTH = 8_192;
const MAX_DATA_MEDIA_URL_LENGTH = 24 * 1024 * 1024;
const MAX_BUFFERED_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_OUTBOUND_MESSAGE_MEDIA_BYTES = 5 * 1024 * 1024;
const CONTROL_OR_BIDI_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const INVALID_FILENAME_CHARACTER = /[<>:"/\\|?*]/g;

const MIME_EXTENSION: Record<string, string> = {
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/zip": "zip",
  "audio/aac": "aac",
  "audio/m4a": "m4a",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/webm": "webm",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "text/csv": "csv",
  "text/plain": "txt",
};

const DEFAULT_FILENAME: Record<MessageMediaKind, string> = {
  image: "Imagem",
  video: "Video",
  audio: "Audio",
  document: "Documento",
  sticker: "Figurinha",
};

const SAFE_DATA_MIME_TYPES: Record<MessageMediaKind, ReadonlySet<string>> = {
  image: new Set(["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"]),
  sticker: new Set(["image/gif", "image/png", "image/webp"]),
  audio: new Set([
    "audio/aac",
    "audio/m4a",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/opus",
    "audio/wav",
    "audio/webm",
  ]),
  video: new Set(["video/mp4", "video/quicktime", "video/webm"]),
  document: new Set([
    "application/msword",
    "application/octet-stream",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/zip",
    "text/csv",
    "text/plain",
  ]),
};

const isHostOrSubdomain = (hostname: string, expected: string) =>
  hostname === expected || hostname.endsWith(`.${expected}`);

const hasEncryptedMediaPath = (pathname: string) => {
  let decodedPathname = pathname;
  try {
    decodedPathname = decodeURIComponent(pathname);
  } catch {
    // An invalid escape sequence is already an untrusted media path.
    return true;
  }

  return decodedPathname
    .toLowerCase()
    .split("/")
    .some((segment) => segment.endsWith(".enc"));
};

/**
 * Accept only browser-loadable remote media URLs. Provider-encrypted WhatsApp
 * endpoints are deliberately rejected because the browser cannot render them.
 */
export function getSafeMessageMediaUrl(
  value: unknown,
  kind: MessageMediaKind,
): string | null {
  if (typeof value !== "string") return null;

  const candidate = value.trim();
  if (candidate.startsWith("data:")) {
    if (candidate.length > MAX_DATA_MEDIA_URL_LENGTH || CONTROL_OR_BIDI_CHARACTER.test(candidate)) {
      CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;
      return null;
    }
    CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;

    const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/]+={0,2})$/i.exec(candidate);
    if (!match || !SAFE_DATA_MIME_TYPES[kind].has(match[1].toLowerCase())) return null;
    return candidate;
  }

  if (
    candidate.length === 0
    || candidate.length > MAX_MEDIA_URL_LENGTH
    || CONTROL_OR_BIDI_CHARACTER.test(candidate)
  ) {
    CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;
    return null;
  }
  CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;

    const hostname = parsed.hostname.toLowerCase();
    if (
      isHostOrSubdomain(hostname, "mmg.whatsapp.net")
      || isHostOrSubdomain(hostname, "pps.whatsapp.net")
      || (kind === "sticker" && isHostOrSubdomain(hostname, "a.whatsapp.net"))
      || hasEncryptedMediaPath(parsed.pathname)
    ) {
      return null;
    }

    // Preserve the original signed query string byte-for-byte after validation.
    return candidate;
  } catch {
    return null;
  }
}

export function getSafeExternalHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const candidate = value.trim();
  if (
    candidate.length === 0
    || candidate.length > MAX_MEDIA_URL_LENGTH
    || CONTROL_OR_BIDI_CHARACTER.test(candidate)
  ) {
    CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;
    return null;
  }
  CONTROL_OR_BIDI_CHARACTER.lastIndex = 0;

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (parsed.username || parsed.password || !parsed.hostname) return null;
    return candidate;
  } catch {
    return null;
  }
}

export const getSafeAvatarUrl = getSafeExternalHttpUrl;

export function sanitizeMediaFilename(value: unknown, fallback = "media"): string {
  const fallbackBasename = String(fallback || "media").split(/[\\/]/).pop() || "media";
  const normalizedFallback = fallbackBasename
    .normalize("NFKC")
    .replace(CONTROL_OR_BIDI_CHARACTER, "")
    .replace(INVALID_FILENAME_CHARACTER, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|[. ]+$/g, "")
    .trim()
    .slice(0, 160) || "media";

  if (typeof value !== "string") return normalizedFallback;

  const basename = value.split(/[\\/]/).pop() || "";
  const sanitized = basename
    .normalize("NFKC")
    .replace(CONTROL_OR_BIDI_CHARACTER, "")
    .replace(INVALID_FILENAME_CHARACTER, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|[. ]+$/g, "")
    .trim()
    .slice(0, 160);

  return sanitized || normalizedFallback;
}

export function buildMessageMediaFilename({
  content,
  kind,
  mimeType,
  sentAt,
}: {
  content: unknown;
  kind: MessageMediaKind;
  mimeType?: string | null;
  sentAt?: string | null;
}): string {
  const parsedDate = sentAt ? new Date(sentAt) : null;
  const timestamp = parsedDate && Number.isFinite(parsedDate.getTime())
    ? [
        parsedDate.getFullYear(),
        String(parsedDate.getMonth() + 1).padStart(2, "0"),
        String(parsedDate.getDate()).padStart(2, "0"),
        "-",
        String(parsedDate.getHours()).padStart(2, "0"),
        String(parsedDate.getMinutes()).padStart(2, "0"),
      ].join("")
    : "sem-data";
  const fallbackBase = `${DEFAULT_FILENAME[kind]}-${timestamp}`;
  const normalizedMimeType = String(mimeType || "").split(";")[0]?.trim().toLowerCase();
  const extension = normalizedMimeType ? MIME_EXTENSION[normalizedMimeType] : undefined;
  const contentCandidate = typeof content === "string" ? content.trim() : "";
  const contentLooksLikeFilename = kind === "document" || /\.[a-z0-9]{1,8}$/i.test(contentCandidate);
  const base = sanitizeMediaFilename(
    contentLooksLikeFilename ? contentCandidate : "",
    fallbackBase,
  );

  if (!extension || /\.[a-z0-9]{1,8}$/i.test(base)) return base;
  return sanitizeMediaFilename(`${base}.${extension}`, fallbackBase);
}

async function readResponseBlobWithLimit(response: Response, maxBytes: number): Promise<Blob> {
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxBytes) {
    throw new Error("MEDIA_TOO_LARGE_TO_BUFFER");
  }

  if (!response.body) {
    const blob = await response.blob();
    if (blob.size > maxBytes) throw new Error("MEDIA_TOO_LARGE_TO_BUFFER");
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new Error("MEDIA_TOO_LARGE_TO_BUFFER");
      }
      chunks.push(value.slice().buffer as ArrayBuffer);
    }
  } finally {
    reader.releaseLock();
  }

  return new Blob(chunks, {
    type: response.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream",
  });
}

function clickDownloadLink(href: string, filename: string, openInNewTab: boolean) {
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  link.referrerPolicy = "no-referrer";
  if (openInNewTab) {
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function createMessageMediaObjectUrl({
  url,
  kind,
  mimeType,
}: {
  url: unknown;
  kind: MessageMediaKind;
  mimeType?: string;
}): Promise<string> {
  const safeUrl = getSafeMessageMediaUrl(url, kind);
  if (!safeUrl) throw new Error("INVALID_MEDIA_URL");

  const response = await fetch(safeUrl, {
    credentials: "same-origin",
    referrerPolicy: "no-referrer",
  });
  if (!response.ok) throw new Error(`MEDIA_REQUEST_FAILED_${response.status}`);

  const sourceBlob = await readResponseBlobWithLimit(response, MAX_BUFFERED_DOWNLOAD_BYTES);
  const blob = mimeType ? sourceBlob.slice(0, sourceBlob.size, mimeType) : sourceBlob;
  return URL.createObjectURL(blob);
}

export type MediaDownloadResult = "downloaded" | "opened";

export async function downloadMessageMedia({
  url,
  kind,
  filename,
}: {
  url: unknown;
  kind: MessageMediaKind;
  filename: unknown;
}): Promise<MediaDownloadResult> {
  const safeUrl = getSafeMessageMediaUrl(url, kind);
  if (!safeUrl) throw new Error("INVALID_MEDIA_URL");
  if (typeof document === "undefined") throw new Error("DOWNLOAD_REQUIRES_BROWSER");

  const safeFilename = sanitizeMediaFilename(filename);

  if (safeUrl.startsWith("data:")) {
    clickDownloadLink(safeUrl, safeFilename, false);
    return "downloaded";
  }

  try {
    const response = await fetch(safeUrl, {
      credentials: "same-origin",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`MEDIA_DOWNLOAD_FAILED_${response.status}`);

    const blob = await readResponseBlobWithLimit(response, MAX_BUFFERED_DOWNLOAD_BYTES);
    const objectUrl = URL.createObjectURL(blob);
    clickDownloadLink(objectUrl, safeFilename, false);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000);
    return "downloaded";
  } catch {
    // Cross-origin servers often disallow fetch. Opening the already-validated
    // URL in an isolated tab is the safe, memory-bounded browser fallback.
    clickDownloadLink(safeUrl, safeFilename, true);
    return "opened";
  }
}
