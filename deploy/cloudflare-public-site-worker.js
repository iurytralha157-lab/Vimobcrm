const SITE_ORIGIN = "https://app.vimobcrm.com.br";
const DOMAIN_VERIFICATION_TOKEN = "__VIMOB_DOMAIN_VERIFICATION_TOKEN__";

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

function withSafeHtmlHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete("set-cookie");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Vimob-Public-Proxy", "cloudflare-worker");

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function fetchOrigin(request) {
  const response = await fetch(buildOriginRequest(request));
  return isHtmlRequest(request) ? withSafeHtmlHeaders(response) : response;
}

const publicSiteWorker = {
  async fetch(request) {
    if (isVerificationRequest(request)) {
      return new Response(DOMAIN_VERIFICATION_TOKEN, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    try {
      return await fetchOrigin(request);
    } catch {
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
