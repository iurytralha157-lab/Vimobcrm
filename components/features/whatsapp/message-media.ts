export type MessageMediaKind = "image" | "video" | "audio" | "document" | "sticker";

export type MessageMediaPolicyPresentation = {
  title: string;
  description: string;
  canRequestDownload: boolean;
  isQueued: boolean;
};

const MAX_MEDIA_URL_LENGTH = 8_192;
const MAX_DATA_MEDIA_URL_LENGTH = 24 * 1024 * 1024;
const MAX_BUFFERED_DOWNLOAD_BYTES = 64 * 1024 * 1024;
export const MAX_OUTBOUND_MESSAGE_MEDIA_BYTES = 5 * 1024 * 1024;
export const MAX_MANUAL_MESSAGE_MEDIA_BYTES = 25 * 1024 * 1024;
const CONTROL_OR_BIDI_CHARACTER = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;
const INVALID_FILENAME_CHARACTER = /[<>:"/\\|?*]/g;

const AUTOMATIC_MEDIA_LIMIT_MIB: Partial<Record<MessageMediaKind, number>> = {
  audio: 25,
  image: 10,
  sticker: 5,
};

const MEDIA_KIND_LABEL: Record<MessageMediaKind, string> = {
  audio: "áudio",
  document: "documento",
  image: "imagem",
  sticker: "figurinha",
  video: "vídeo",
};

const formatMediaSize = (sizeBytes: number) => {
  const sizeMiB = sizeBytes / (1024 * 1024);
  const formatted = sizeMiB.toFixed(1).replace(".", ",").replace(",0", "");
  return `${formatted} MB`;
};

const hasMediaPolicyError = (error: string, code: string) =>
  error.toLowerCase().includes(code);

export function getMessageMediaPolicyPresentation({
  error,
  kind,
  sizeBytes,
}: {
  error: string | null | undefined;
  kind: MessageMediaKind;
  sizeBytes?: number | null;
}): MessageMediaPolicyPresentation | null {
  const normalizedError = String(error || "").trim();
  if (!normalizedError) return null;

  const hasKnownSize = typeof sizeBytes === "number" && Number.isFinite(sizeBytes) && sizeBytes > 0;
  const withinManualLimit = hasKnownSize && sizeBytes <= MAX_MANUAL_MESSAGE_MEDIA_BYTES;
  const mediaLabel = kind === "document" ? "documento" : `arquivo de ${MEDIA_KIND_LABEL[kind]}`;
  const sizeLabel = hasKnownSize ? formatMediaSize(sizeBytes) : null;

  if (
    hasMediaPolicyError(normalizedError, "media_manual_download_queued")
    || hasMediaPolicyError(normalizedError, "media_download_retry_scheduled")
  ) {
    return {
      title: "Download na fila",
      description: "O arquivo aparecerá aqui assim que o processamento terminar.",
      canRequestDownload: false,
      isQueued: true,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_unknown_size")) {
    return {
      title: "Tamanho do arquivo não informado",
      description: `O WhatsApp não informou o tamanho deste ${mediaLabel}. Por segurança, o CRM não pode baixá-lo agora.`,
      canRequestDownload: false,
      isQueued: false,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_too_large")) {
    if (!withinManualLimit) {
      return {
        title: "Arquivo acima do limite",
        description: sizeLabel
          ? `Este ${mediaLabel} tem ${sizeLabel} e ultrapassa o limite máximo de 25 MB do CRM.`
          : `Este ${mediaLabel} ultrapassa o limite máximo de 25 MB do CRM.`,
        canRequestDownload: false,
        isQueued: false,
      };
    }

    const automaticLimitMiB = AUTOMATIC_MEDIA_LIMIT_MIB[kind];
    return {
      title: "Arquivo não baixado automaticamente",
      description: automaticLimitMiB
        ? `Este ${mediaLabel} tem ${sizeLabel}. O download automático é limitado a ${automaticLimitMiB} MB.`
        : `Este ${mediaLabel} tem ${sizeLabel} e precisa ser solicitado manualmente.`,
      canRequestDownload: true,
      isQueued: false,
    };
  }

  if (hasMediaPolicyError(normalizedError, "media_policy_manual_only_type")) {
    if (!withinManualLimit) {
      return {
        title: hasKnownSize ? "Arquivo acima do limite" : "Tamanho do arquivo não informado",
        description: sizeLabel
          ? `Este ${mediaLabel} tem ${sizeLabel} e ultrapassa o limite máximo de 25 MB do CRM.`
          : `O WhatsApp não informou o tamanho deste ${mediaLabel}. Por segurança, o CRM não pode baixá-lo agora.`,
        canRequestDownload: false,
        isQueued: false,
      };
    }

    return {
      title: "Arquivo disponível para download",
      description: `Para proteger as conexões do WhatsApp, este ${mediaLabel} de ${sizeLabel} não foi baixado automaticamente.`,
      canRequestDownload: true,
      isQueued: false,
    };
  }

  return null;
}

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

export function getMessageMediaExtension(mimeType: string, fallback = "bin"): string {
  const normalizedMimeType = String(mimeType || "").split(";")[0]?.trim().toLowerCase();
  return (normalizedMimeType && MIME_EXTENSION[normalizedMimeType]) || fallback;
}

type BlobDataUrlReader = {
  result: string | ArrayBuffer | null;
  onload: ((event?: unknown) => void) | null;
  onerror: ((reason?: unknown) => void) | null;
  readAsDataURL(blob: Blob): void;
};

export function blobToBase64(blob: Blob, reader?: BlobDataUrlReader): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const activeReader = reader || new FileReader();
    activeReader.onload = () => {
      const dataUrl = typeof activeReader.result === "string" ? activeReader.result : "";
      resolve(dataUrl.split(",")[1] || "");
    };
    activeReader.onerror = reject;
    activeReader.readAsDataURL(blob);
  });
}

export type OutboundMessageMediaKind = Exclude<MessageMediaKind, "sticker">;

export function getOutboundMessageMediaKind(mimeType: string): OutboundMessageMediaKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "document";
}

export type OutboundImageCompressionOptions = {
  maxDimension: number;
  minimumSizeBytes: number;
  quality: number;
  pngOutput: "png" | "webp";
  otherImageOutput: "source" | "webp";
  onlyIfSmaller: boolean;
  recoverOnError: boolean;
  fallbackBaseName: string;
};

type LoadedOutboundImage = {
  width: number;
  height: number;
  source: unknown;
};

export type OutboundImageCompressionRuntime = {
  createObjectUrl(blob: Blob): string;
  revokeObjectUrl(url: string): void;
  loadImage(url: string): Promise<LoadedOutboundImage>;
  encodeImage(
    image: LoadedOutboundImage,
    width: number,
    height: number,
    mimeType: string,
    quality: number,
  ): Promise<Blob | null>;
  createFile(blob: Blob, filename: string, mimeType: string): File;
};

const browserOutboundImageRuntime: OutboundImageCompressionRuntime = {
  createObjectUrl: (blob) => URL.createObjectURL(blob),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  async loadImage(url) {
    const image = new Image();
    image.decoding = "async";
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = reject;
    });
    image.src = url;
    await loaded;
    return { width: image.width, height: image.height, source: image };
  },
  async encodeImage(image, width, height, mimeType, quality) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image.source as CanvasImageSource, 0, 0, width, height);
    return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
  },
  createFile: (blob, filename, mimeType) => new File([blob], filename, { type: mimeType }),
};

export const OUTBOUND_IMAGE_COMPRESSION_PROFILES = {
  preservePngEncoding: {
    maxDimension: 1600,
    minimumSizeBytes: 900_000,
    quality: 0.82,
    pngOutput: "png",
    otherImageOutput: "webp",
    onlyIfSmaller: false,
    recoverOnError: false,
    fallbackBaseName: "imagem",
  },
  preferSmallerFile: {
    maxDimension: 1600,
    minimumSizeBytes: 900_000,
    quality: 0.82,
    pngOutput: "webp",
    otherImageOutput: "source",
    onlyIfSmaller: true,
    recoverOnError: true,
    fallbackBaseName: "",
  },
} as const satisfies Record<string, OutboundImageCompressionOptions>;

const resolveOutboundImageMimeType = (
  sourceMimeType: string,
  options: OutboundImageCompressionOptions,
) => {
  if (sourceMimeType === "image/png") {
    return options.pngOutput === "webp" ? "image/webp" : "image/png";
  }
  return options.otherImageOutput === "webp" ? "image/webp" : sourceMimeType;
};

export async function compressOutboundImageFile(
  file: File,
  options: OutboundImageCompressionOptions,
  runtime: OutboundImageCompressionRuntime = browserOutboundImageRuntime,
): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;

  // Object URL creation intentionally remains outside the recovery boundary,
  // matching the previous composers: failure here means the browser cannot
  // safely start processing the selected file.
  const imageUrl = runtime.createObjectUrl(file);
  try {
    const image = await runtime.loadImage(imageUrl);
    const scale = Math.min(1, options.maxDimension / Math.max(image.width, image.height));
    if (scale >= 1 && file.size < options.minimumSizeBytes) return file;

    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const targetMimeType = resolveOutboundImageMimeType(file.type, options);
    const blob = await runtime.encodeImage(
      image,
      width,
      height,
      targetMimeType,
      options.quality,
    );
    if (!blob || (options.onlyIfSmaller && blob.size >= file.size)) return file;

    const sourceBaseName = file.name.replace(/\.[^.]+$/, "");
    const baseName = sourceBaseName || options.fallbackBaseName;
    const extension = getMessageMediaExtension(targetMimeType, "webp");
    return runtime.createFile(blob, `${baseName}.${extension}`, targetMimeType);
  } catch (error) {
    if (options.recoverOnError) return file;
    throw error;
  } finally {
    runtime.revokeObjectUrl(imageUrl);
  }
}

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
