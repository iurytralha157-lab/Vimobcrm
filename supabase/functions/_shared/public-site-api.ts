import {
  normalizePublicSiteDomain,
  publicSiteDomainCandidates,
} from "./public-site-edge.ts";

const DEFAULT_PUBLIC_SITE_API_BASE_URL = "https://api.vimobcrm.com.br";
const MAX_PUBLIC_SITE_RESPONSE_BYTES = 256 * 1024;
const PUBLIC_SITE_API_TIMEOUT_MS = 5_000;

export class PublicSiteUpstreamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicSiteUpstreamError";
  }
}

export function resolvePublicSiteAPIBaseURL(
  configuredValue: unknown,
  supabaseURL: unknown,
): string {
  if (typeof configuredValue === "string" && configuredValue.trim()) {
    const configured = normalizeAPIBaseURL(configuredValue);
    if (!configured) throw new PublicSiteUpstreamError("Invalid public site API URL");
    return configured;
  }

  if (typeof supabaseURL === "string") {
    try {
      const hostname = new URL(supabaseURL).hostname.toLowerCase();
      if (["127.0.0.1", "localhost", "kong"].includes(hostname)) {
        return "http://host.docker.internal:8081";
      }
    } catch {
      // The canonical HTTPS API remains the safe fallback.
    }
  }

  return DEFAULT_PUBLIC_SITE_API_BASE_URL;
}

export async function fetchPublicSiteConfiguration(
  apiBaseURL: string,
  domain: string,
  fetchImplementation: typeof fetch = fetch,
): Promise<Record<string, unknown> | null> {
  const normalizedDomain = normalizePublicSiteDomain(domain);
  const normalizedBaseURL = normalizeAPIBaseURL(apiBaseURL);
  if (!normalizedDomain || !normalizedBaseURL) {
    throw new PublicSiteUpstreamError("Invalid public site lookup configuration");
  }

  const url = new URL("/v1/public/site/resolve", `${normalizedBaseURL}/`);
  url.searchParams.set("domain", normalizedDomain);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PUBLIC_SITE_API_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetchImplementation(url, {
      cache: "no-store",
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: controller.signal,
    });
  } catch {
    throw new PublicSiteUpstreamError("Public site API is unavailable");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new PublicSiteUpstreamError(`Public site API returned ${response.status}`);
  }

  const payload = await readBoundedResponseJSON(response);
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PublicSiteUpstreamError("Public site API returned an invalid envelope");
  }

  const envelope = payload as Record<string, unknown>;
  if (envelope.found === false) return null;
  if (envelope.found !== true || !isJSONObject(envelope.site_config)) {
    throw new PublicSiteUpstreamError("Public site API returned an invalid site");
  }

  const site = envelope.site_config;
  if (site.is_active !== true) return null;

  if (normalizedDomain.includes(".")) {
    const customDomain = normalizePublicSiteDomain(site.custom_domain);
    if (
      site.domain_verified !== true ||
      !customDomain ||
      !publicSiteDomainCandidates(normalizedDomain).includes(customDomain)
    ) {
      return null;
    }
  } else if (normalizePublicSiteDomain(site.subdomain) !== normalizedDomain) {
    return null;
  }

  return site;
}

function normalizeAPIBaseURL(value: string): string | null {
  try {
    const url = new URL(value.trim());
    const localHTTP =
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "host.docker.internal"].includes(
        url.hostname.toLowerCase(),
      );
    if (
      (url.protocol !== "https:" && !localHTTP) ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

async function readBoundedResponseJSON(response: Response): Promise<unknown> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && /^\d+$/.test(contentLength)) {
    if (Number(contentLength) > MAX_PUBLIC_SITE_RESPONSE_BYTES) {
      throw new PublicSiteUpstreamError("Public site API response is too large");
    }
  }

  const reader = response.body?.getReader();
  if (!reader) throw new PublicSiteUpstreamError("Public site API response is empty");

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_PUBLIC_SITE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new PublicSiteUpstreamError("Public site API response is too large");
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

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new PublicSiteUpstreamError("Public site API returned invalid JSON");
  }
}

function isJSONObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
