import type { Metadata } from "next";
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
import { getPropertyTitle, getSiteTitle } from "./public-site-utils";

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
  domain,
  route,
}: Readonly<{
  domain?: string;
  route: PublicSiteRoute;
}>): Promise<Metadata> {
  const resolved = domain ? await resolvePublicSite(domain) : await resolvePublicSiteFromRequest();
  if (resolved.status !== "found") return {};

  const site = resolved.site;
  const siteTitle = getSiteTitle(site);
  let title = site.seo_title || siteTitle;
  let description = site.seo_description || site.site_description || undefined;
  let image = site.hero_image_url || site.logo_url || site.favicon_url || undefined;

  if (route.kind === "properties") {
    title = `Imoveis - ${siteTitle}`;
  } else if (route.kind === "about") {
    title = `Sobre - ${siteTitle}`;
  } else if (route.kind === "contact") {
    title = `Contato - ${siteTitle}`;
  } else if (route.kind === "favorites") {
    title = `Favoritos - ${siteTitle}`;
  } else if (route.kind === "property") {
    const property = await getPublicProperty(site.organization_id, route.propertyCode);
    if (property) {
      title = `${getPropertyTitle(property)} - ${siteTitle}`;
      description = property.descricao || description;
      image = property.imagem_principal || property.fotos?.[0] || image;
    }
  }

  return {
    title,
    description,
    icons: site.favicon_url || site.logo_url ? { icon: site.favicon_url || site.logo_url || undefined } : undefined,
    openGraph: {
      title,
      description,
      images: image ? [{ url: image }] : undefined,
      siteName: siteTitle,
      type: "website",
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
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
    finalidade: stringQuery(query.finalidade),
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

export function buildMetadataTitle(site: PublicSiteConfig, suffix?: string) {
  const title = getSiteTitle(site);
  return suffix ? `${suffix} - ${title}` : title;
}
