import { resolvePublicSiteFromRequest } from "@/lib/api/public-site-server";

const MAX_FAVICON_BYTES = 1024 * 1024;

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = await resolvePublicSiteFromRequest();
  if (resolved.status !== "found" || !resolved.site.favicon_url) {
    return new Response(null, { status: 404 });
  }

  const faviconURL = getAllowedFaviconURL(resolved.site.favicon_url);
  if (!faviconURL) return new Response(null, { status: 404 });

  const upstream = await fetch(faviconURL, {
    next: { revalidate: 86400 },
    signal: AbortSignal.timeout(8000),
  });
  if (!upstream.ok) return new Response(null, { status: 502 });

  const contentType = upstream.headers.get("content-type") || "";
  const contentLength = Number(upstream.headers.get("content-length") || 0);
  if (!contentType.startsWith("image/") || contentLength > MAX_FAVICON_BYTES) {
    return new Response(null, { status: 415 });
  }

  const body = await upstream.arrayBuffer();
  if (body.byteLength > MAX_FAVICON_BYTES) return new Response(null, { status: 413 });

  return new Response(body, {
    headers: {
      "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      "Content-Type": contentType,
      "Content-Length": String(body.byteLength),
    },
  });
}

function getAllowedFaviconURL(value: string) {
  try {
    const url = new URL(value);
    const configuredSupabaseHost = getConfiguredSupabaseHost();
    const isKnownStorageHost = configuredSupabaseHost
      ? url.hostname === configuredSupabaseHost
      : url.hostname.endsWith(".supabase.co");
    const isPublicSiteAsset = url.pathname.startsWith("/storage/v1/object/public/site-images/");

    if (url.protocol !== "https:" || !isKnownStorageHost || !isPublicSiteAsset) return null;
    return url;
  } catch {
    return null;
  }
}

function getConfiguredSupabaseHost() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!value) return null;
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}
