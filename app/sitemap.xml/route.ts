import {
  getPublicProperties,
  resolvePublicSiteFromRequest,
  type PublicProperty,
  type PublicSiteConfig,
} from "@/lib/api/public-site-server";

const SITEMAP_PAGE_SIZE = 60;
const SITEMAP_MAX_PAGES = 100;
const SITEMAP_BATCH_SIZE = 5;

export const dynamic = "force-dynamic";

export async function GET() {
  const resolved = await resolvePublicSiteFromRequest();
  if (resolved.status !== "found") {
    return xmlResponse("<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\" />", resolved.status === "unavailable" ? 503 : 404);
  }

  const origin = getSiteOrigin(resolved.site);
  const properties = await listSitemapProperties(resolved.site.organization_id);
  const staticPaths = ["/", "/imoveis", "/sobre", "/contato", "/politica-de-privacidade"];
  const propertyPaths = properties
    .map((property) => property.codigo || property.id)
    .filter(Boolean)
    .map((code) => `/imoveis/${encodeURIComponent(code)}`);
  const urls = Array.from(new Set([...staticPaths, ...propertyPaths]));
  const body = urls
    .map((path) => `<url><loc>${escapeXML(new URL(path, `${origin}/`).toString())}</loc></url>`)
    .join("");

  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`);
}

async function listSitemapProperties(organizationId: string) {
  const firstPage = await getPublicProperties(organizationId, { page: 1, limit: SITEMAP_PAGE_SIZE });
  const properties = [...firstPage.properties];
  const totalPages = Math.min(firstPage.totalPages || 1, SITEMAP_MAX_PAGES);

  for (let start = 2; start <= totalPages; start += SITEMAP_BATCH_SIZE) {
    const pages = Array.from(
      { length: Math.min(SITEMAP_BATCH_SIZE, totalPages - start + 1) },
      (_, index) => start + index,
    );
    const results = await Promise.all(
      pages.map((page) => getPublicProperties(organizationId, { page, limit: SITEMAP_PAGE_SIZE })),
    );
    results.forEach((result) => properties.push(...result.properties));
  }

  return deduplicateProperties(properties);
}

function deduplicateProperties(properties: PublicProperty[]) {
  return Array.from(new Map(properties.map((property) => [property.id, property])).values());
}

function xmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}

function escapeXML(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
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
