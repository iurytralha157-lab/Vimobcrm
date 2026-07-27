const DOMAIN_VERIFICATION_TOKEN_PLACEHOLDER = '__VIMOB_DOMAIN_VERIFICATION_TOKEN__'

const CLOUDFLARE_WORKER_TEMPLATE = `const SITE_ORIGIN = "https://app.vimobcrm.com.br";
const DOMAIN_VERIFICATION_TOKEN = "${DOMAIN_VERIFICATION_TOKEN_PLACEHOLDER}";
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
`

export function getCloudflareWorkerCode(domainVerificationToken: string) {
  const token = domainVerificationToken.trim()
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    throw new Error('Token de verificação do domínio inválido.')
  }
  return CLOUDFLARE_WORKER_TEMPLATE.replace(DOMAIN_VERIFICATION_TOKEN_PLACEHOLDER, token)
}

export function getCloudflareSetupInstructions(domain: string, workerCode: string) {
  return `Conecte ${domain} ao seu site Vimob:

1. Crie ou acesse sua conta em https://dash.cloudflare.com
2. Adicione ao Cloudflare a zona raiz correspondente a ${domain}.
3. No registrador do domínio, substitua os nameservers pelos valores informados pelo Cloudflare.
4. No painel do Cloudflare, acesse Workers & Pages e crie um Worker.
5. Substitua o código do editor pelo Worker gerado abaixo e publique.
6. Em Workers & Pages > seu Worker > Settings > Domains & Routes, adicione a rota ${domain}/*.
7. Volte ao Vimob e clique em Verificar agora.

Código do Worker:
${workerCode}`
}
