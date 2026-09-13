export const WHATSAPP_MEDIA_MAX_BYTES = 25 * 1024 * 1024;

export type WhatsAppMediaValidationInput = {
  bytes: Uint8Array;
  messageType: string;
  declaredMimeType?: string | null;
  providerMimeType?: string | null;
  declaredSize?: number | null;
  fileSha256?: string | null;
  fileEncSha256?: string | null;
  requirePlaintextSha256?: boolean;
};

export type ValidatedWhatsAppMedia = {
  bytes: Uint8Array;
  contentType: string;
  size: number;
};

export class WhatsAppMediaValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WhatsAppMediaValidationError";
    this.code = code;
  }
}

function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";", 1)[0].trim().toLowerCase();
}

function startsWithBytes(bytes: Uint8Array, expected: number[], offset = 0) {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function startsWithASCII(bytes: Uint8Array, value: string, offset = 0) {
  if (bytes.length < offset + value.length) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (bytes[offset + index] !== value.charCodeAt(index)) return false;
  }
  return true;
}

export function detectWhatsAppMediaMimeType(bytes: Uint8Array, messageType = "") {
  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWithASCII(bytes, "GIF87a") || startsWithASCII(bytes, "GIF89a")) return "image/gif";
  if (startsWithASCII(bytes, "RIFF") && startsWithASCII(bytes, "WEBP", 8)) return "image/webp";
  if (startsWithASCII(bytes, "OggS")) return "audio/ogg";
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) return "audio/aac";
  if (startsWithASCII(bytes, "ID3") || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (startsWithASCII(bytes, "#!AMR\n")) return "audio/amr";
  if (startsWithBytes(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return messageType.toLowerCase() === "audio" ? "audio/webm" : "video/webm";
  }
  if (startsWithASCII(bytes, "ftyp", 4)) {
    return messageType.toLowerCase() === "audio" ? "audio/mp4" : "video/mp4";
  }
  if (startsWithASCII(bytes, "%PDF-")) return "application/pdf";
  if (startsWithBytes(bytes, [0x50, 0x4b, 0x03, 0x04]) || startsWithBytes(bytes, [0x50, 0x4b, 0x05, 0x06])) {
    return "application/zip";
  }
  if (startsWithBytes(bytes, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/x-ole-storage";
  }
  return null;
}

function mediaTypeAcceptsMime(messageType: string, mimeType: string) {
  switch (messageType.trim().toLowerCase()) {
    case "image":
      return mimeType.startsWith("image/");
    case "sticker":
      return mimeType === "image/webp";
    case "audio":
      return mimeType.startsWith("audio/") || mimeType === "application/ogg";
    case "video":
      return mimeType.startsWith("video/");
    case "document":
      // WhatsApp documents are arbitrary attachments and may legitimately be
      // images, audio, plain text, or office containers.
      return Boolean(mimeType);
    default:
      return false;
  }
}

function declaredMimeMatchesDetected(messageType: string, declared: string, detected: string) {
  if (!declared || declared === "application/octet-stream") return true;
  if (declared === detected) return true;
  if (messageType === "audio" && declared === "application/ogg" && detected === "audio/ogg") return true;
  if (messageType === "document" && ["application/zip", "application/x-ole-storage"].includes(detected)) return true;
  return false;
}

function normalizeBase64Payload(value: string) {
  const trimmed = value.trim();
  const comma = trimmed.indexOf(",");
  const raw = trimmed.startsWith("data:") && comma >= 0 ? trimmed.slice(comma + 1) : trimmed;
  return raw.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");
}

export function decodeBoundedWhatsAppMediaBase64(
  value: string,
  maxBytes = WHATSAPP_MEDIA_MAX_BYTES,
) {
  const normalized = normalizeBase64Payload(value);
  if (!normalized) {
    throw new WhatsAppMediaValidationError("media_base64_invalid", "WhatsApp media base64 is empty");
  }
  const maximumEncodedLength = Math.ceil(maxBytes / 3) * 4;
  if (normalized.length > maximumEncodedLength + 4) {
    throw new WhatsAppMediaValidationError("media_too_large", "WhatsApp media base64 exceeds the configured limit");
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new WhatsAppMediaValidationError("media_base64_invalid", "WhatsApp media base64 is invalid");
  }
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new WhatsAppMediaValidationError("media_base64_invalid", "WhatsApp media base64 is invalid");
  }
  if (binary.length === 0 || binary.length > maxBytes) {
    throw new WhatsAppMediaValidationError(
      binary.length === 0 ? "media_empty" : "media_too_large",
      "WhatsApp media is empty or exceeds the configured limit",
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function decodeSHA256(value: string | null | undefined, code: string) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;
  if (/^[0-9a-f]{64}$/i.test(normalized)) {
    return Uint8Array.from(normalized.match(/.{2}/g)!.map((pair) => Number.parseInt(pair, 16)));
  }
  try {
    const base64 = normalized.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    if (binary.length !== 32) throw new Error("invalid digest length");
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new WhatsAppMediaValidationError(code, "WhatsApp media SHA-256 metadata is invalid");
  }
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

export async function validateWhatsAppPlaintextMedia(
  input: WhatsAppMediaValidationInput,
): Promise<ValidatedWhatsAppMedia> {
  const { bytes } = input;
  if (bytes.length === 0) {
    throw new WhatsAppMediaValidationError("media_empty", "WhatsApp media is empty");
  }
  if (bytes.length > WHATSAPP_MEDIA_MAX_BYTES) {
    throw new WhatsAppMediaValidationError("media_too_large", "WhatsApp media exceeds 25 MiB");
  }

  const actualDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const encryptedDigest = decodeSHA256(input.fileEncSha256, "media_encrypted_sha256_invalid");
  if (encryptedDigest && constantTimeEqual(encryptedDigest, actualDigest)) {
    throw new WhatsAppMediaValidationError(
      "media_ciphertext_rejected",
      "Encrypted WhatsApp transport bytes cannot be stored as plaintext media",
    );
  }

  const plaintextDigest = decodeSHA256(input.fileSha256, "media_plaintext_sha256_invalid");
  if (input.requirePlaintextSha256 && !plaintextDigest) {
    throw new WhatsAppMediaValidationError(
      "media_plaintext_sha256_missing",
      "Encrypted WhatsApp media is missing its plaintext SHA-256",
    );
  }
  if (plaintextDigest && !constantTimeEqual(plaintextDigest, actualDigest)) {
    throw new WhatsAppMediaValidationError(
      "media_plaintext_sha256_mismatch",
      "Recovered WhatsApp media does not match the plaintext SHA-256",
    );
  }

  const declaredSize = Number(input.declaredSize || 0);
  if (declaredSize > 0 && (!Number.isSafeInteger(declaredSize) || declaredSize !== bytes.length)) {
    throw new WhatsAppMediaValidationError(
      "media_size_mismatch",
      "Recovered WhatsApp media does not match the declared plaintext size",
    );
  }

  const messageType = String(input.messageType || "").trim().toLowerCase();
  const detectedMimeType = detectWhatsAppMediaMimeType(bytes, messageType);
  if (!detectedMimeType && messageType === "document" && plaintextDigest) {
    const contentType = normalizeMimeType(input.providerMimeType)
      || normalizeMimeType(input.declaredMimeType)
      || "application/octet-stream";
    return { bytes, contentType, size: bytes.length };
  }
  if (!detectedMimeType || !mediaTypeAcceptsMime(messageType, detectedMimeType)) {
    throw new WhatsAppMediaValidationError(
      "media_magic_mismatch",
      "Recovered WhatsApp media magic does not match the message type",
    );
  }
  for (const candidate of [input.declaredMimeType, input.providerMimeType]) {
    const declaredMimeType = normalizeMimeType(candidate);
    if (!declaredMimeMatchesDetected(messageType, declaredMimeType, detectedMimeType)) {
      throw new WhatsAppMediaValidationError(
        "media_mime_mismatch",
        "Recovered WhatsApp media MIME does not match its magic bytes",
      );
    }
  }

  return { bytes, contentType: detectedMimeType, size: bytes.length };
}

export function isEncryptedWhatsAppMediaURL(value: string | null | undefined) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    const hostname = parsed.hostname.toLowerCase();
    return parsed.pathname.toLowerCase().endsWith(".enc")
      || hostname === "whatsapp.net"
      || hostname.endsWith(".whatsapp.net")
      || hostname === "fbcdn.net"
      || hostname.endsWith(".fbcdn.net")
      || hostname === "fbsbx.com"
      || hostname.endsWith(".fbsbx.com");
  } catch {
    return /\.enc(?:$|[?#])/i.test(raw);
  }
}
