import {
  buildPublicSiteHTTPSURL,
  isPublicSiteCrawler,
  normalizePublicSiteDomain,
  normalizePublicSitePath,
} from "../_shared/public-site-edge.ts";
import {
  fetchPublicSiteConfiguration,
  resolvePublicSiteAPIBaseURL,
} from "../_shared/public-site-api.ts";
import { buildPublicSiteMetadataHTML } from "./render.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const securityHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store",
  "Content-Security-Policy":
    "default-src 'none'; img-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
};

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: { ...securityHeaders, Allow: "GET, HEAD, OPTIONS" },
    });
  }

  try {
    const url = new URL(request.url);
    const domain = normalizePublicSiteDomain(url.searchParams.get("domain"));
    const path = normalizePublicSitePath(url.searchParams.get("path") || "/");
    if (!domain || !path) {
      return new Response("Invalid domain or path", {
        status: 400,
        headers: securityHeaders,
      });
    }

    const canonicalURL = buildPublicSiteHTTPSURL(domain, path);
    if (!canonicalURL) {
      return new Response("Invalid public URL", {
        status: 400,
        headers: securityHeaders,
      });
    }

    const apiBaseURL = resolvePublicSiteAPIBaseURL(
      Deno.env.get("VIMOB_API_URL") || Deno.env.get("PUBLIC_SITE_API_URL"),
      Deno.env.get("SUPABASE_URL"),
    );
    const site = await fetchPublicSiteConfiguration(apiBaseURL, domain);
    if (!site) {
      return new Response("Site not found", {
        status: 404,
        headers: securityHeaders,
      });
    }

    const userAgent = request.headers.get("user-agent") || "";
    if (!isPublicSiteCrawler(userAgent)) {
      return new Response(null, {
        status: 307,
        headers: { ...securityHeaders, Location: canonicalURL },
      });
    }

    const html = buildPublicSiteMetadataHTML(
      site,
      typeof site.organization_name === "string" ? site.organization_name : "",
      canonicalURL,
      new URL(canonicalURL).pathname === "/",
    );

    return new Response(request.method === "HEAD" ? null : html, {
      headers: {
        ...securityHeaders,
        "Content-Type": "text/html; charset=utf-8",
      },
    });
  } catch (error) {
    console.error(
      "Public site SSR failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return new Response("Internal server error", {
      status: 500,
      headers: securityHeaders,
    });
  }
});
