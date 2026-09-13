import {
  normalizeGoogleSiteVerification,
  normalizePublicHTTPSAssetURL,
} from "../_shared/public-site-edge.ts";

type PublicSiteMetadata = Record<string, unknown>;

export function buildPublicSiteMetadataHTML(
  site: PublicSiteMetadata,
  organizationName: string,
  canonicalURL: string,
  isHome: boolean,
): string {
  const title = escapeHTML(
    readText(site.seo_title) ||
      readText(site.site_title) ||
      organizationName ||
      "Site Imobiliário",
  );
  const description = escapeHTML(
    readText(site.seo_description) ||
      readText(site.site_description) ||
      (organizationName ? `${organizationName} - Imóveis` : "Imóveis"),
  );
  const siteName = escapeHTML(
    readText(site.site_title) || organizationName || "Site Imobiliário",
  );
  const keywords = readText(site.seo_keywords);
  const image = firstSafeHTTPSURL(
    site.logo_url,
    site.favicon_url,
    site.about_image_url,
    site.hero_image_url,
  );
  const favicon = firstSafeHTTPSURL(site.favicon_url, site.logo_url);
  const verification = isHome
    ? normalizeGoogleSiteVerification(site.google_search_console_verification)
    : null;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <meta name="description" content="${description}">
  ${keywords ? `<meta name="keywords" content="${escapeHTML(keywords)}">` : ""}
  ${verification ? `<meta name="google-site-verification" content="${escapeHTML(verification)}">` : ""}
  <meta property="og:type" content="website">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:url" content="${escapeHTML(canonicalURL)}">
  ${image ? `<meta property="og:image" content="${escapeHTML(image)}">` : ""}
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  ${image ? `<meta name="twitter:image" content="${escapeHTML(image)}">` : ""}
  <link rel="canonical" href="${escapeHTML(canonicalURL)}">
  ${favicon ? `<link rel="icon" href="${escapeHTML(favicon)}">` : ""}
</head>
<body>
  <main>
    <h1>${siteName}</h1>
    <p>${description}</p>
  </main>
</body>
</html>`;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstSafeHTTPSURL(...values: unknown[]): string | null {
  for (const value of values) {
    const normalized = normalizePublicHTTPSAssetURL(value);
    if (normalized) return normalized;
  }
  return null;
}

function escapeHTML(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
