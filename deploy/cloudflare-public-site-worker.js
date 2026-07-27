const SITE_ORIGIN = "https://app.vimobcrm.com.br";
const DOMAIN_VERIFICATION_TOKEN = "__VIMOB_DOMAIN_VERIFICATION_TOKEN__";
const HTML_CACHE_SECONDS = 300;
const STALE_SECONDS = 86400;

function isHtmlRequest(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return false;

  const accept = request.headers.get("accept") || "";
  return accept.includes("text/html") || accept.includes("*/*");
}

function isVerificationRequest(request) {
  return new URL(request.url).pathname === "/.well-known/vimob-domain-verification";
}

function buildOriginRequest(request) {
  const sourceUrl = new URL(request.url);
  const originUrl = new URL(SITE_ORIGIN);
  const targetUrl = new URL(request.url);

  targetUrl.protocol = originUrl.protocol;
  targetUrl.hostname = originUrl.hostname;
  targetUrl.port = originUrl.port;

  const headers = new Headers(request.headers);
  headers.set("X-Forwarded-Host", sourceUrl.hostname);
  headers.set("X-Forwarded-Proto", "https");
  headers.set("X-Vimob-Public-Site", "1");
  headers.delete("host");

  return new Request(targetUrl.toString(), {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "follow",
  });
}

function withPublicCacheHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set(
    "Cache-Control",
    "public, max-age=60, s-maxage=" + HTML_CACHE_SECONDS + ", stale-while-revalidate=" + STALE_SECONDS + ", stale-if-error=" + STALE_SECONDS,
  );
  headers.set("X-Vimob-Public-Proxy", "cloudflare-worker");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchAndCache(request, cacheKey, cache) {
  const response = await fetch(buildOriginRequest(request));
  const publicResponse = withPublicCacheHeaders(response);

  if (publicResponse.ok && isHtmlRequest(request)) {
    await cache.put(cacheKey, publicResponse.clone());
  }

  return publicResponse;
}

const publicSiteWorker = {
  async fetch(request, env, ctx) {
    if (isVerificationRequest(request)) {
      return new Response(DOMAIN_VERIFICATION_TOKEN, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const cache = caches.default;
    const cacheable = isHtmlRequest(request);
    const cacheKey = cacheable ? new Request(request.url, { headers: request.headers }) : null;

    if (cacheable && cacheKey) {
      const cached = await cache.match(cacheKey);
      if (cached) {
        ctx.waitUntil(fetchAndCache(request, cacheKey, cache).catch(() => undefined));
        return cached;
      }
    }

    try {
      if (!cacheable || !cacheKey) {
        return fetch(buildOriginRequest(request));
      }

      return await fetchAndCache(request, cacheKey, cache);
    } catch {
      if (cacheable && cacheKey) {
        const cached = await cache.match(cacheKey);
        if (cached) return cached;
      }

      return new Response("Site temporariamente indisponivel. Tente novamente em instantes.", {
        status: 503,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }
  },
};

export default publicSiteWorker;
