import { resolvePublicSiteFromRequest, type PublicSiteConfig } from "@/lib/api/public-site-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = await resolvePublicSiteFromRequest();

  if (resolved.status !== "found") {
    return textResponse("User-agent: *\nDisallow: /\n", resolved.status === "unavailable" ? 503 : 200);
  }

  const origin = getSiteOrigin(resolved.site);
  return textResponse([
    "User-agent: *",
    "Allow: /",
    "Disallow: /favoritos",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n"));
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "text/plain; charset=utf-8",
    },
  });
}

function getSiteOrigin(site: PublicSiteConfig) {
  const customDomain = site.domain_verified !== false ? site.custom_domain?.trim() : "";
  if (!customDomain) return (process.env.NEXT_PUBLIC_SITE_URL || "https://app.vimobcrm.com.br").replace(/\/+$/, "");

  try {
    return new URL(/^https?:\/\//i.test(customDomain) ? customDomain : `https://${customDomain}`).origin;
  } catch {
    return (process.env.NEXT_PUBLIC_SITE_URL || "https://app.vimobcrm.com.br").replace(/\/+$/, "");
  }
}
