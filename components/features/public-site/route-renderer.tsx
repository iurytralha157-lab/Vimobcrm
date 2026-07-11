import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  getPublicHomeData,
  getPublicMenuItems,
  getPublicProperties,
  getPublicProperty,
  getPublicSearchFilters,
  resolvePublicSite,
  resolvePublicSiteFromRequest,
  type PublicSiteConfig,
} from "@/lib/api/public-site-server";
import { PublicSiteUnavailable } from "@/components/public/PublicSiteUnavailable";
import { PublicSiteShell } from "./PublicSiteShell";
import {
  PublicAboutScreen,
  PublicContactScreen,
  PublicFavoritesScreen,
  PublicHomeScreen,
  PublicPropertiesScreen,
  PublicPropertyDetailScreen,
} from "./PublicSiteScreens";
import {
  buildSiteHref,
  formatPrice,
  getPropertyCode,
  getPropertyLocation,
  getPropertyPrice,
  getPropertyTitle,
  getSiteTitle,
} from "./public-site-utils";

export type PublicSiteRoute =
  | { kind: "home" }
  | { kind: "properties"; query: Record<string, string | string[] | undefined> }
  | { kind: "property"; propertyCode: string }
  | { kind: "about" }
  | { kind: "contact" }
  | { kind: "favorites" };

export async function renderPublicSiteRoute({
  basePath = "",
  domain,
  missing = "not-found",
  route,
}: Readonly<{
  basePath?: string;
  domain?: string;
  missing?: "not-found" | "redirect-login" | "unavailable";
  route: PublicSiteRoute;
}>) {
  const resolved = domain ? await resolvePublicSite(domain) : await resolvePublicSiteFromRequest();

  if (resolved.status === "unavailable") {
    return <PublicSiteUnavailable />;
  }

  if (resolved.status === "not-found") {
    if (missing === "redirect-login") redirect("/login");
    if (missing === "unavailable") return <PublicSiteUnavailable />;
    notFound();
  }

  const site = resolved.site;
  const [menuItems, searchFilters] = await Promise.all([
    getPublicMenuItems(site.organization_id),
    getPublicSearchFilters(site.organization_id),
  ]);

  if (route.kind === "home") {
    const data = await getPublicHomeData(site.organization_id);
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={getSiteTitle(site)} site={site}>
        <PublicHomeScreen basePath={basePath} data={data} searchFilters={searchFilters} site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "properties") {
    const query = normalizePropertiesQuery(route.query);
    const data = await getPublicProperties(site.organization_id, query);
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Imoveis - ${getSiteTitle(site)}`} site={site}>
        <PublicPropertiesScreen basePath={basePath} data={data} query={route.query} site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "property") {
    const property = await getPublicProperty(site.organization_id, route.propertyCode);
    if (!property) notFound();

    return (
      <PublicSiteShell
        basePath={basePath}
        menuItems={menuItems}
        pageTitle={`${getPropertyTitle(property)} - ${getSiteTitle(site)}`}
        propertyId={property.id}
        site={site}
      >
        <PublicPropertyDetailScreen basePath={basePath} property={property} site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "about") {
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Sobre - ${getSiteTitle(site)}`} site={site}>
        <PublicAboutScreen basePath={basePath} site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "contact") {
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Contato - ${getSiteTitle(site)}`} site={site}>
        <PublicContactScreen basePath={basePath} site={site} />
      </PublicSiteShell>
    );
  }

  return (
    <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Favoritos - ${getSiteTitle(site)}`} site={site}>
      <PublicFavoritesScreen basePath={basePath} site={site} />
    </PublicSiteShell>
  );
}

export async function generatePublicSiteMetadata({
  basePath = "",
  domain,
  route,
}: Readonly<{
  basePath?: string;
  domain?: string;
  route: PublicSiteRoute;
}>): Promise<Metadata> {
  const resolved = domain ? await resolvePublicSite(domain) : await resolvePublicSiteFromRequest();
  if (resolved.status !== "found") return {};

  const site = resolved.site;
  const siteTitle = getSiteTitle(site);
  let title = site.seo_title || siteTitle;
  let shareTitle = title;
  let description = site.seo_description || site.site_description || undefined;
  let image = site.hero_image_url || site.logo_url || site.favicon_url || undefined;
  let imageAlt = siteTitle;
  let canonicalPath = buildRouteCanonicalPath(route);

  if (route.kind === "properties") {
    title = `Imoveis - ${siteTitle}`;
    shareTitle = title;
    canonicalPath = buildSiteHref(basePath, "/imoveis");
  } else if (route.kind === "about") {
    title = `Sobre - ${siteTitle}`;
    shareTitle = title;
    canonicalPath = buildSiteHref(basePath, "/sobre");
  } else if (route.kind === "contact") {
    title = `Contato - ${siteTitle}`;
    shareTitle = title;
    canonicalPath = buildSiteHref(basePath, "/contato");
  } else if (route.kind === "favorites") {
    title = `Favoritos - ${siteTitle}`;
    shareTitle = title;
    canonicalPath = buildSiteHref(basePath, "/favoritos");
  } else if (route.kind === "property") {
    const property = await getPublicProperty(site.organization_id, route.propertyCode);
    if (property) {
      const propertyTitle = getPropertyTitle(property);
      title = `${propertyTitle} - ${siteTitle}`;
      shareTitle = propertyTitle;
      description = buildPropertyShareDescription(property) || description;
      image = property.imagem_principal || property.fotos?.[0] || image;
      imageAlt = propertyTitle;
      canonicalPath = buildSiteHref(basePath, `/imoveis/${getPropertyCode(property)}`);
    }
  }

  const metadataOrigin = await getRequestOrigin();
  const canonicalURL = absolutizeURL(canonicalPath, metadataOrigin);
  const absoluteImage = image ? absolutizeURL(image, metadataOrigin) : undefined;

  return {
    metadataBase: new URL(metadataOrigin),
    title,
    description,
    alternates: {
      canonical: canonicalURL,
    },
    icons: site.favicon_url || site.logo_url ? { icon: absolutizeURL(site.favicon_url || site.logo_url || "", metadataOrigin) } : undefined,
    openGraph: {
      title: shareTitle,
      description,
      url: canonicalURL,
      images: absoluteImage ? [{ url: absoluteImage, width: 1200, height: 630, alt: imageAlt }] : undefined,
      siteName: siteTitle,
      type: "website",
    },
    twitter: {
      card: absoluteImage ? "summary_large_image" : "summary",
      title: shareTitle,
      description,
      images: absoluteImage ? [{ url: absoluteImage, alt: imageAlt }] : undefined,
    },
  };
}

export function parsePublicSitePath(path?: string[]): PublicSiteRoute {
  const [segment, second] = path || [];

  if (!segment) return { kind: "home" };
  if (segment === "imoveis" && second) return { kind: "property", propertyCode: second };
  if (segment === "imovel" && second) return { kind: "property", propertyCode: second };
  if (segment === "imoveis") return { kind: "properties", query: {} };
  if (segment === "sobre") return { kind: "about" };
  if (segment === "contato") return { kind: "contact" };
  if (segment === "favoritos") return { kind: "favorites" };

  notFound();
}

function normalizePropertiesQuery(query: Record<string, string | string[] | undefined>) {
  return {
    page: stringQuery(query.page) || 1,
    limit: 12,
    search: stringQuery(query.search),
    tipo: stringQuery(query.tipo),
    finalidade: normalizePurposeQuery(stringQuery(query.finalidade)),
    cidade: stringQuery(query.cidade),
    bairro: stringQuery(query.bairro),
    quartos: stringQuery(query.quartos),
    suites: stringQuery(query.suites),
    banheiros: stringQuery(query.banheiros),
    vagas: stringQuery(query.vagas),
    mobilia: stringQuery(query.mobilia),
    min_price: stringQuery(query.min_price) || stringQuery(query.minPrice),
    max_price: stringQuery(query.max_price) || stringQuery(query.maxPrice),
  };
}

function stringQuery(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

function normalizePurposeQuery(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return "";
  if (["aluguel", "locacao", "locação", "rent"].includes(normalized)) return "locacao";
  if (["venda e aluguel", "venda locacao", "venda locação", "venda/locacao", "venda/locação", "venda/aluguel", "venda_locacao"].includes(normalized)) {
    return "venda_locacao";
  }
  if (["temporada", "season"].includes(normalized)) return "temporada";
  if (["venda", "sale"].includes(normalized)) return "venda";
  return normalized;
}

function buildRouteCanonicalPath(route: PublicSiteRoute) {
  if (route.kind === "home") return "/";
  if (route.kind === "about") return "/sobre";
  if (route.kind === "contact") return "/contato";
  if (route.kind === "favorites") return "/favoritos";
  if (route.kind === "property") return `/imoveis/${route.propertyCode}`;
  return "/imoveis";
}

function buildPropertyShareDescription(property: Awaited<ReturnType<typeof getPublicProperty>>) {
  if (!property) return "";
  const location = getPropertyLocation(property);
  const price = formatPrice(getPropertyPrice(property));
  const parts = [location, price && price !== "Consulte" ? price : "", cleanMetadataText(property.descricao || "").slice(0, 120)]
    .filter(Boolean);
  return cleanMetadataText(parts.join(" | ")).slice(0, 180);
}

async function getRequestOrigin() {
  const headerStore = await headers();
  const proto = headerStore.get("x-forwarded-proto") || "https";
  const host = headerStore.get("x-forwarded-host") || headerStore.get("host");
  if (host) return `${proto}://${host}`.replace(/\/+$/, "");
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://app.vimobcrm.com.br").replace(/\/+$/, "");
}

function absolutizeURL(value: string, origin: string) {
  const cleaned = value.trim();
  if (!cleaned) return origin;
  try {
    return new URL(cleaned, origin).toString();
  } catch {
    return origin;
  }
}

function cleanMetadataText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function buildMetadataTitle(site: PublicSiteConfig, suffix?: string) {
  const title = getSiteTitle(site);
  return suffix ? `${suffix} - ${title}` : title;
}
