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
  type PublicProperty,
  type PublicSiteConfig,
} from "@/lib/api/public-site-server";
import { PublicSiteUnavailable } from "@/components/public/PublicSiteUnavailable";
import { PublicSiteShell } from "./PublicSiteShell";
import {
  PublicAboutScreen,
  PublicContactScreen,
  PublicFavoritesScreen,
  PublicHomeScreen,
  PublicNotFoundScreen,
  PublicPrivacyPolicyScreen,
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
  | { kind: "privacy" }
  | { kind: "favorites" }
  | { kind: "not-found" };

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
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Imóveis - ${getSiteTitle(site)}`} site={site}>
        <PublicPropertiesScreen basePath={basePath} data={data} query={route.query} site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "property") {
    const property = await getPublicProperty(site.organization_id, route.propertyCode);
    if (!property) {
      return (
        <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`404 - ${getSiteTitle(site)}`} site={site}>
          <PublicNotFoundScreen basePath={basePath} site={site} />
        </PublicSiteShell>
      );
    }
    const relatedProperties = await getRelatedPublicProperties(site.organization_id, property);

    return (
      <PublicSiteShell
        basePath={basePath}
        menuItems={menuItems}
        pageTitle={`${getPropertyTitle(property)} - ${getSiteTitle(site)}`}
        propertyCode={getPropertyCode(property)}
        propertyId={property.id}
        propertyTitle={getPropertyTitle(property)}
        site={site}
      >
        <PublicPropertyDetailScreen basePath={basePath} property={property} relatedProperties={relatedProperties} site={site} />
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

  if (route.kind === "privacy") {
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`Política de privacidade - ${getSiteTitle(site)}`} site={site}>
        <PublicPrivacyPolicyScreen site={site} />
      </PublicSiteShell>
    );
  }

  if (route.kind === "not-found") {
    return (
      <PublicSiteShell basePath={basePath} menuItems={menuItems} pageTitle={`404 - ${getSiteTitle(site)}`} site={site}>
        <PublicNotFoundScreen basePath={basePath} site={site} />
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
    title = `Imóveis - ${siteTitle}`;
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
  } else if (route.kind === "privacy") {
    title = `Política de privacidade - ${siteTitle}`;
    shareTitle = title;
    description = `Política de privacidade da ${siteTitle}.`;
    canonicalPath = buildSiteHref(basePath, "/politica-de-privacidade");
  } else if (route.kind === "favorites") {
    title = `Favoritos - ${siteTitle}`;
    shareTitle = title;
    canonicalPath = buildSiteHref(basePath, "/favoritos");
  } else if (route.kind === "not-found") {
    title = `404 - ${siteTitle}`;
    shareTitle = title;
    description = "Não encontramos essa página.";
    canonicalPath = buildSiteHref(basePath, "/");
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
  if (segment === "politica-de-privacidade" || segment === "privacidade" || segment === "privacy-policy") {
    return { kind: "privacy" };
  }
  if (segment === "favoritos") return { kind: "favorites" };

  return { kind: "not-found" };
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
    condominio: stringQuery(query.condominio),
    quartos: stringQuery(query.quartos),
    suites: stringQuery(query.suites),
    banheiros: stringQuery(query.banheiros),
    vagas: stringQuery(query.vagas),
    mobilia: stringQuery(query.mobilia),
    area_util_min: stringQuery(query.area_util_min),
    area_util_max: stringQuery(query.area_util_max),
    area_total_min: stringQuery(query.area_total_min),
    area_total_max: stringQuery(query.area_total_max),
    aceita_financiamento: stringQuery(query.aceita_financiamento),
    aceita_permuta: stringQuery(query.aceita_permuta),
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
  if (route.kind === "privacy") return "/politica-de-privacidade";
  if (route.kind === "favorites") return "/favoritos";
  if (route.kind === "property") return `/imoveis/${route.propertyCode}`;
  if (route.kind === "not-found") return "/";
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

async function getRelatedPublicProperties(organizationId: string, property: PublicProperty) {
  const price = getPropertyPrice(property);
  const queries: Array<Record<string, string | number | undefined>> = [
    {
      tipo: property.tipo_imovel || undefined,
      finalidade: property.finalidade || undefined,
      min_price: price ? Math.max(0, Math.round(price * 0.75)) : undefined,
      max_price: price ? Math.round(price * 1.25) : undefined,
      limit: 8,
    },
    {
      tipo: property.tipo_imovel || undefined,
      cidade: property.cidade || undefined,
      limit: 8,
    },
  ];

  const related = new Map<string, PublicProperty>();
  for (const query of queries) {
    if (related.size >= 3) break;
    const data = await getPublicProperties(organizationId, query);
    data.properties
      .filter((item) => item.id !== property.id)
      .forEach((item) => {
        if (!related.has(item.id)) related.set(item.id, item);
      });
  }

  return Array.from(related.values()).slice(0, 3);
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
