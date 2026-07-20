import type { PublicSiteConfig } from "@/lib/api/public-site-server";

import { getSiteDescription, getSiteTitle } from "./public-site-utils";

export function PublicSiteStructuredData({
  basePath,
  isHome,
  site,
}: Readonly<{
  basePath: string;
  isHome?: boolean;
  site: PublicSiteConfig;
}>) {
  const siteTitle = getSiteTitle(site);
  const siteURL = getStructuredDataSiteURL(site, basePath);
  const businessId = `${siteURL}#real-estate-agent`;
  const graph: Record<string, unknown>[] = [];

  if (isHome) {
    graph.push({
      "@type": "WebSite",
      "@id": `${siteURL}#website`,
      url: siteURL,
      name: siteTitle,
      description: getSiteDescription(site),
      publisher: { "@id": businessId },
      inLanguage: "pt-BR",
    });
  }

  graph.push({
    "@type": "RealEstateAgent",
    "@id": businessId,
    name: siteTitle,
    url: siteURL,
    description: getSiteDescription(site),
    logo: absoluteAssetURL(site.logo_url || site.favicon_url, siteURL),
    image: absoluteAssetURL(site.hero_image_url || site.logo_url, siteURL),
    telephone: site.phone || site.whatsapp || undefined,
    email: site.email || undefined,
    address: buildAddress(site),
    sameAs: [site.instagram, site.facebook, site.youtube, site.linkedin].filter(Boolean),
  });

  const payload = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": graph,
  }).replace(/</g, "\\u003c");

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: payload }}
    />
  );
}

function getStructuredDataSiteURL(site: PublicSiteConfig, basePath: string) {
  const customDomain = site.domain_verified !== false ? site.custom_domain?.trim() : "";
  if (customDomain) {
    try {
      return new URL(/^https?:\/\//i.test(customDomain) ? customDomain : `https://${customDomain}`).origin;
    } catch {
      // Fall through to the platform URL when a saved domain is malformed.
    }
  }

  const platformOrigin = (process.env.NEXT_PUBLIC_SITE_URL || "https://app.vimobcrm.com.br").replace(/\/+$/, "");
  return new URL(basePath || "/", `${platformOrigin}/`).toString().replace(/\/+$/, "");
}

function absoluteAssetURL(value: string | null | undefined, siteURL: string) {
  if (!value?.trim()) return undefined;
  try {
    return new URL(value, `${siteURL}/`).toString();
  } catch {
    return undefined;
  }
}

function buildAddress(site: PublicSiteConfig) {
  if (!site.address && !site.city && !site.state) return undefined;

  return {
    "@type": "PostalAddress",
    streetAddress: site.address || undefined,
    addressLocality: site.city || undefined,
    addressRegion: site.state || undefined,
    addressCountry: "BR",
  };
}
