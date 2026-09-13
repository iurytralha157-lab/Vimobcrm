export const PUBLIC_SITE_CONFIG_MAX_BODY_BYTES = 4 * 1024;

const HOST_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const GOOGLE_SITE_VERIFICATION_PATTERN = /^[A-Za-z0-9_-]{10,255}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

export class PublicSiteRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "PublicSiteRequestError";
    this.status = status;
  }
}

export function normalizePublicSiteDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase().replace(/\.$/, "");
  if (
    !normalized ||
    normalized.length > 253 ||
    CONTROL_CHARACTER_PATTERN.test(normalized) ||
    /[\s/\\?#@:%\[\],()'"=]/.test(normalized)
  ) {
    return null;
  }

  const labels = normalized.split(".");
  if (labels.some((label) => !HOST_LABEL_PATTERN.test(label))) return null;
  if (labels.length === 4 && labels.every((label) => /^\d{1,3}$/.test(label))) {
    return null;
  }

  return normalized;
}

export function publicSiteDomainCandidates(domain: string): string[] {
  const normalized = normalizePublicSiteDomain(domain);
  if (!normalized) return [];

  const withoutWWW = normalized.startsWith("www.")
    ? normalized.slice(4)
    : normalized;

  return Array.from(
    new Set([normalized, withoutWWW, `www.${withoutWWW}`]),
  ).filter((candidate) => normalizePublicSiteDomain(candidate) !== null);
}

export function normalizePublicSitePath(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim() || "/";
  if (
    normalized.length > 2_048 ||
    !normalized.startsWith("/") ||
    normalized.startsWith("//") ||
    normalized.includes("\\") ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    return null;
  }

  try {
    const parsed = new URL(normalized, "https://public-site.invalid");
    if (parsed.origin !== "https://public-site.invalid") return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function buildPublicSiteHTTPSURL(
  domain: string,
  path: string,
): string | null {
  const normalizedDomain = normalizePublicSiteDomain(domain);
  const normalizedPath = normalizePublicSitePath(path);
  if (!normalizedDomain || !normalizedPath) return null;

  try {
    const url = new URL(normalizedPath, `https://${normalizedDomain}`);
    if (
      url.protocol !== "https:" ||
      url.hostname !== normalizedDomain ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizePublicHTTPSAssetURL(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim();
  if (!normalized || normalized.length > 2_048 || CONTROL_CHARACTER_PATTERN.test(normalized)) {
    return null;
  }

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeGoogleSiteVerification(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return GOOGLE_SITE_VERIFICATION_PATTERN.test(normalized) ? normalized : null;
}

export function isPublicSiteCrawler(userAgent: string): boolean {
  const normalized = userAgent.toLowerCase();
  return [
    "baiduspider",
    "bingbot",
    "developers.google.com",
    "discordbot",
    "duckduckbot",
    "embedly",
    "facebookexternalhit",
    "facebot",
    "googlebot",
    "linkedinbot",
    "pinterestbot",
    "redditbot",
    "slackbot",
    "telegrambot",
    "twitterbot",
    "whatsapp",
    "yandexbot",
  ].some((crawler) => normalized.includes(crawler));
}

export async function readBoundedJSONObject(
  request: Request,
  maxBytes = PUBLIC_SITE_CONFIG_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("maxBytes must be a positive safe integer");
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && !/^\d+$/.test(contentLength.trim())) {
    throw new PublicSiteRequestError("Invalid Content-Length", 400);
  }
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new PublicSiteRequestError("Request body is too large", 413);
  }

  const reader = request.body?.getReader();
  if (!reader) throw new PublicSiteRequestError("JSON body is required", 400);

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new PublicSiteRequestError("Request body is too large", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    parsed = JSON.parse(text);
  } catch {
    throw new PublicSiteRequestError("Invalid JSON body", 400);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PublicSiteRequestError("JSON object is required", 400);
  }

  return parsed as Record<string, unknown>;
}
