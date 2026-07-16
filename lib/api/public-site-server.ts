import "server-only";

import { headers } from "next/headers";
import {
  publicDomainSchema,
  publicHomeDataSchema,
  publicMenuItemListEnvelopeSchema,
  publicPropertiesDataSchema,
  publicPropertyDataSchema,
  publicSearchFilterListEnvelopeSchema,
  publicSiteResolveServerSchema,
  validateDomainResponse,
} from "@/lib/validation";
import type { ZodTypeAny } from "zod";

const DEFAULT_API_URL = "http://localhost:8081";
const PUBLIC_SITE_REVALIDATE_SECONDS = 60;
const PUBLIC_SITE_STALE_FALLBACK_MS = 1000 * 60 * 60 * 24;

type PublicSiteQuery = Record<string, string | number | boolean | null | undefined>;

export interface PublicSiteConfig {
  id: string;
  organization_id: string;
  organization_name?: string | null;
  is_active: boolean;
  subdomain: string | null;
  custom_domain: string | null;
  domain_verified?: boolean | null;
  site_title: string | null;
  site_description: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  whatsapp: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  instagram: string | null;
  facebook: string | null;
  youtube: string | null;
  linkedin: string | null;
  about_title: string | null;
  about_text: string | null;
  about_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  seo_keywords: string | null;
  google_analytics_id?: string | null;
  hero_image_url: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  page_banner_url: string | null;
  logo_width: number | null;
  logo_height: number | null;
  watermark_enabled: boolean | null;
  watermark_opacity: number | null;
  watermark_logo_url: string | null;
  watermark_size: number | null;
  watermark_position: string | null;
  site_theme: string | null;
  background_color: string | null;
  text_color: string | null;
  card_color: string | null;
  show_about_on_home: boolean | null;
  about_subtitle: string | null;
  about_stats: PublicSiteStat[] | null;
  about_checkmarks: string[] | null;
  about_features: PublicSiteFeature[] | null;
  gtm_id?: string | null;
  meta_pixel_id?: string | null;
  google_ads_id?: string | null;
  head_scripts?: string | null;
  body_scripts?: string | null;
}

export interface PublicSiteStat {
  value: string;
  label: string;
}

export interface PublicSiteFeature {
  title: string;
  description: string;
  icon: string;
}

export interface PublicProperty {
  id: string;
  codigo: string;
  titulo: string | null;
  descricao: string | null;
  tipo_imovel: string | null;
  finalidade?: string | null;
  valor_venda: number | null;
  valor_aluguel: number | null;
  valor_condominio?: number | null;
  iptu?: number | null;
  taxa_de_servico?: number | null;
  valor_itr?: number | null;
  seguro_incendio?: number | null;
  valor_venda_avaliado?: number | null;
  valor_locacao_avaliado?: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  area_total: number | null;
  area_construida: number | null;
  andar?: number | null;
  bairro: string | null;
  cidade: string | null;
  estado: string | null;
  imagem_principal: string | null;
  fotos: string[] | null;
  image_urls?: string[] | null;
  detalhes_extras?: string[] | null;
  proximidades?: string[] | null;
  video_imovel?: string | null;
  tour_virtual?: string | null;
  aceita_financiamento?: boolean | null;
  aceita_permuta?: boolean | null;
  usou_fgts?: boolean | null;
  exclusividade?: boolean | null;
  destaque: boolean | null;
  status: string | null;
  mobiliado?: boolean | null;
}

export interface SiteMenuItem {
  id: string;
  organization_id: string;
  label: string;
  link_type: string;
  href: string;
  position: number;
  open_in_new_tab: boolean;
  is_active: boolean;
}

export interface SiteSearchFilter {
  id?: string;
  organization_id?: string;
  filter_key: string;
  label: string;
  position: number;
  is_active?: boolean;
}

export interface PublicHomeData {
  featured: PublicProperty[];
  exclusive: PublicProperty[];
  latest: PublicProperty[];
  types: string[];
  cities: string[];
}

export interface PublicPropertiesData {
  properties: PublicProperty[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  types: string[];
  cities: string[];
  neighborhoods: string[];
  condominiums: string[];
  purposes: string[];
}

export type PublicSiteResolution =
  | { status: "found"; site: PublicSiteConfig }
  | { status: "not-found" }
  | { status: "unavailable" };

type ResolveResponse = {
  found?: boolean;
  site_config?: PublicSiteConfig;
};

type Envelope<T> = {
  data?: T;
};

type FallbackCacheEntry = {
  value: unknown;
  updatedAt: number;
};

const emptyHomeData: PublicHomeData = {
  featured: [],
  exclusive: [],
  latest: [],
  types: [],
  cities: [],
};

const publicSiteFallbackCache = new Map<string, FallbackCacheEntry>();

export function getAPIBaseURL() {
  return (process.env.VIMOB_API_URL || process.env.NEXT_PUBLIC_VIMOB_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

export async function getRequestPublicDomain() {
  const headerStore = await headers();
  const forwardedHost = headerStore.get("x-forwarded-host") || headerStore.get("host") || "";
  return normalizePublicDomain(forwardedHost);
}

export async function resolvePublicSiteFromRequest() {
  return resolvePublicSite(await getRequestPublicDomain());
}

export async function resolvePublicSite(domain: string): Promise<PublicSiteResolution> {
  const domainResult = publicDomainSchema.safeParse(normalizePublicDomain(domain));
  const normalized = domainResult.success ? domainResult.data : "";
  if (!normalized) return { status: "not-found" };

  const candidates = normalized.startsWith("www.")
    ? [normalized, normalized.slice(4)]
    : [normalized, `www.${normalized}`];
  const uniqueCandidates = Array.from(new Set(candidates));

  try {
    for (const candidate of uniqueCandidates) {
      const response = await requestPublicAPI<ResolveResponse>("/v1/public/site/resolve", {
        query: { domain: candidate },
        tags: [`public-site-domain:${candidate}`],
      }, publicSiteResolveServerSchema, "public-site-server.resolve");

      if (response.found && response.site_config?.organization_id) {
        const site = normalizeSiteConfig(response.site_config);
        rememberResolvedSite(uniqueCandidates, site);
        return { status: "found", site };
      }
    }

    return { status: "not-found" };
  } catch {
    const cachedSite = getCachedResolvedSite(uniqueCandidates);
    if (cachedSite) {
      return { status: "found", site: cachedSite };
    }

    return { status: "unavailable" };
  }
}

export async function getPublicHomeData(organizationId: string) {
  return safePublicData<PublicHomeData>(
    organizationId,
    "home",
    {},
    emptyHomeData,
    publicHomeDataSchema,
  );
}

export async function getPublicProperties(
  organizationId: string,
  query: PublicSiteQuery,
): Promise<PublicPropertiesData> {
  const data = await safePublicData<PublicPropertiesData>(
    organizationId,
    "properties",
    query,
    {
      properties: [],
      total: 0,
      page: Number(query.page) || 1,
      limit: Number(query.limit) || 12,
      totalPages: 0,
      types: [],
      cities: [],
      neighborhoods: [],
      condominiums: [],
      purposes: [],
    },
    publicPropertiesDataSchema,
  );

  return {
    ...data,
    types: Array.isArray(data.types) ? data.types : [],
    cities: Array.isArray(data.cities) ? data.cities : [],
    neighborhoods: Array.isArray(data.neighborhoods) ? data.neighborhoods : [],
    condominiums: Array.isArray(data.condominiums) ? data.condominiums : [],
    purposes: Array.isArray(data.purposes) ? data.purposes : [],
  };
}

export async function getPublicProperty(organizationId: string, propertyCode: string) {
  const data = await safePublicData<{ property: PublicProperty | null }>(
    organizationId,
    "property",
    { property_code: propertyCode },
    { property: null },
    publicPropertyDataSchema,
  );
  return data.property;
}

export async function getPublicMenuItems(organizationId: string) {
  const cacheKey = publicCacheKey(["menu", organizationId]);

  try {
    const response = await requestPublicAPI<Envelope<SiteMenuItem[]>>("/v1/public/site/menu-items", {
      query: { organization_id: organizationId },
      tags: [`public-site:${organizationId}:menu`],
    }, publicMenuItemListEnvelopeSchema, "public-site-server.menu");
    const items = response.data || [];
    writeFallbackCache(cacheKey, items);
    return items;
  } catch {
    return readFallbackCache<SiteMenuItem[]>(cacheKey) || [];
  }
}

export async function getPublicSearchFilters(organizationId: string) {
  const cacheKey = publicCacheKey(["filters", organizationId]);

  try {
    const response = await requestPublicAPI<Envelope<SiteSearchFilter[]>>("/v1/public/site/search-filters", {
      query: { organization_id: organizationId },
      tags: [`public-site:${organizationId}:filters`],
    }, publicSearchFilterListEnvelopeSchema, "public-site-server.filters");
    const filters = response.data || [];
    writeFallbackCache(cacheKey, filters);
    return filters;
  } catch {
    return readFallbackCache<SiteSearchFilter[]>(cacheKey) || [];
  }
}

async function safePublicData<T>(
  organizationId: string,
  endpoint: string,
  query: PublicSiteQuery,
  fallback: T,
  schema: ZodTypeAny,
) {
  const cacheKey = publicCacheKey(["data", organizationId, endpoint, stableQueryKey(query)]);

  try {
    const data = await requestPublicAPI<T>("/v1/public/site/data", {
      query: {
        organization_id: organizationId,
        endpoint,
        ...query,
      },
      tags: [`public-site:${organizationId}`, `public-site:${organizationId}:${endpoint}`],
    }, schema, `public-site-server.data.${endpoint}`);
    writeFallbackCache(cacheKey, data);
    return data;
  } catch {
    return readFallbackCache<T>(cacheKey) ?? fallback;
  }
}

async function requestPublicAPI<T>(
  path: string,
  options: {
    query?: PublicSiteQuery;
    tags?: string[];
  } = {},
  schema?: ZodTypeAny,
  context = "public-site-server.request",
) {
  const response = await fetch(buildAPIURL(path, options.query), {
    headers: {
      Accept: "application/json",
    },
    next: {
      revalidate: PUBLIC_SITE_REVALIDATE_SECONDS,
      tags: options.tags,
    },
  });

  if (!response.ok) {
    throw new Error(`Vimob public API failed with ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (schema) validateDomainResponse(schema, payload, context);
  return payload as T;
}

function buildAPIURL(path: string, query?: PublicSiteQuery) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${getAPIBaseURL()}${normalizedPath}`);

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

function normalizeSiteConfig(site: PublicSiteConfig): PublicSiteConfig {
  return {
    ...site,
    site_title: site.site_title || site.organization_name || "Site imobiliario",
    primary_color: site.primary_color || "#d97706",
    secondary_color: site.secondary_color || "#111827",
    accent_color: site.accent_color || site.primary_color || "#0f766e",
    site_theme: site.site_theme || "light",
    background_color: site.background_color || "#f8fafc",
    text_color: site.text_color || "#111827",
    card_color: site.card_color || "#ffffff",
  };
}

function rememberResolvedSite(candidates: string[], site: PublicSiteConfig) {
  const domains = new Set(
    [
      ...candidates,
      site.custom_domain || "",
      site.subdomain || "",
    ]
      .map(normalizePublicDomain)
      .filter(Boolean),
  );

  domains.forEach((domain) => writeFallbackCache(publicCacheKey(["resolve", domain]), site));
}

function getCachedResolvedSite(candidates: string[]) {
  for (const candidate of candidates) {
    const site = readFallbackCache<PublicSiteConfig>(
      publicCacheKey(["resolve", normalizePublicDomain(candidate)]),
    );

    if (site) return site;
  }

  return null;
}

function publicCacheKey(parts: Array<string | number | boolean | null | undefined>) {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map(String)
    .join("|");
}

function stableQueryKey(query: PublicSiteQuery) {
  return JSON.stringify(
    Object.entries(query || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function writeFallbackCache(key: string, value: unknown) {
  publicSiteFallbackCache.set(key, {
    value,
    updatedAt: Date.now(),
  });
}

function readFallbackCache<T>(key: string): T | null {
  const entry = publicSiteFallbackCache.get(key);
  if (!entry) return null;

  if (Date.now() - entry.updatedAt > PUBLIC_SITE_STALE_FALLBACK_MS) {
    publicSiteFallbackCache.delete(key);
    return null;
  }

  return entry.value as T;
}

export function normalizePublicDomain(value: string) {
  let cleaned = value.trim().toLowerCase();
  cleaned = cleaned.replace(/^https?:\/\//, "");
  cleaned = cleaned.split("/")[0] || "";
  cleaned = cleaned.split(":")[0] || "";
  return cleaned.replace(/^\.+|\.+$/g, "");
}
