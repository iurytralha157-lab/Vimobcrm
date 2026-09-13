import {
  normalizeGoogleSiteVerification,
  normalizePublicHTTPSAssetURL,
  normalizePublicSiteDomain,
  PublicSiteRequestError,
  readBoundedJSONObject,
} from "../_shared/public-site-edge.ts";
import {
  fetchPublicSiteConfiguration,
  resolvePublicSiteAPIBaseURL,
} from "../_shared/public-site-api.ts";

const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const jsonHeaders = {
  ...corsHeaders,
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
};

const publicSiteOrigin = "https://app.vimobcrm.com.br";

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, {
      Allow: "POST, OPTIONS",
    });
  }

  try {
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return jsonResponse({ error: "Content-Type must be application/json" }, 415);
    }

    const payload = await readBoundedJSONObject(request);
    if (Object.keys(payload).some((key) => key !== "domain")) {
      return jsonResponse({ error: "Unexpected request field" }, 400);
    }

    const domain = normalizePublicSiteDomain(payload.domain);
    if (!domain || !domain.includes(".")) {
      return jsonResponse({ error: "Invalid domain" }, 400);
    }

    const apiBaseURL = resolvePublicSiteAPIBaseURL(
      Deno.env.get("VIMOB_API_URL") || Deno.env.get("PUBLIC_SITE_API_URL"),
      Deno.env.get("SUPABASE_URL"),
    );
    const data = await fetchPublicSiteConfiguration(apiBaseURL, domain);
    const subdomain = readText(data?.subdomain);
    if (!data || !subdomain) {
      return jsonResponse({ error: "Domain not found" }, 404);
    }

    const image = firstSafeHTTPSURL(
      data.logo_url,
      data.favicon_url,
      data.about_image_url,
      data.hero_image_url,
    );
    const favicon = firstSafeHTTPSURL(data.favicon_url, data.logo_url);
    const verification = normalizeGoogleSiteVerification(
      data.google_search_console_verification,
    );

    return jsonResponse({
      cache_version:
        typeof data.updated_at === "string" ? data.updated_at : null,
      meta: {
        description:
          readText(data.seo_description) || readText(data.site_description),
        favicon,
        google_site_verification: verification,
        image,
        title:
          readText(data.seo_title) ||
          readText(data.site_title) ||
          readText(data.organization_name) ||
          "Site Imobiliário",
      },
      slug: subdomain,
      ssr_url: `${new URL(Deno.env.get("SUPABASE_URL") || request.url).origin}/functions/v1/public-site-ssr`,
      target: new URL(publicSiteOrigin).host,
    });
  } catch (error) {
    if (error instanceof PublicSiteRequestError) {
      return jsonResponse({ error: error.message }, error.status);
    }
    console.error(
      "Worker config lookup failed:",
      error instanceof Error ? error.message : "unknown error",
    );
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});

function jsonResponse(
  payload: Record<string, unknown>,
  status = 200,
  additionalHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...jsonHeaders, ...additionalHeaders },
  });
}

function firstSafeHTTPSURL(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizePublicHTTPSAssetURL(value);
    if (normalized) return normalized;
  }
  return null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
