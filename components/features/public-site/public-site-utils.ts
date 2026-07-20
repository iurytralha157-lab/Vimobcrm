import type { PublicProperty, PublicSiteConfig, SiteMenuItem } from "@/lib/api/public-site-server";

export const DEFAULT_HERO_IMAGE =
  "https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=1920&h=1080&fit=crop";

export const defaultMenuItems: SiteMenuItem[] = [
  {
    id: "home",
    organization_id: "",
    label: "Home",
    link_type: "internal",
    href: "/",
    position: 0,
    open_in_new_tab: false,
    is_active: true,
  },
  {
    id: "properties",
    organization_id: "",
    label: "Imóveis",
    link_type: "internal",
    href: "/imoveis",
    position: 1,
    open_in_new_tab: false,
    is_active: true,
  },
  {
    id: "about",
    organization_id: "",
    label: "Sobre",
    link_type: "internal",
    href: "/sobre",
    position: 2,
    open_in_new_tab: false,
    is_active: true,
  },
  {
    id: "contact",
    organization_id: "",
    label: "Contato",
    link_type: "internal",
    href: "/contato",
    position: 3,
    open_in_new_tab: false,
    is_active: true,
  },
];

export function getSiteTitle(site: PublicSiteConfig) {
  return site.site_title || site.organization_name || "Site imobiliário";
}

export function getSiteDescription(site: PublicSiteConfig) {
  if (site.site_description?.trim()) return site.site_description.trim();

  const location = [site.city, site.state].filter(Boolean).join(", ");
  if (location) {
    return `${getSiteTitle(site)}: imóveis para comprar e alugar em ${location}, com atendimento especializado.`;
  }

  return `Encontre imóveis para comprar e alugar com a ${getSiteTitle(site)}.`;
}

export function buildSiteHref(basePath: string, href: string) {
  const cleanBase = basePath === "/" ? "" : basePath.replace(/\/+$/, "");
  const cleanHref = href.trim();

  if (!cleanHref || cleanHref === "/") return cleanBase || "/";
  if (/^https?:\/\//i.test(cleanHref) || cleanHref.startsWith("mailto:") || cleanHref.startsWith("tel:")) {
    return cleanHref;
  }

  const [pathname, query = ""] = cleanHref.replace(/^\/+/, "").split("?");
  const path = `${cleanBase}/${pathname}`.replace(/\/{2,}/g, "/");
  return query ? `${path}?${query}` : path;
}

export function getPropertyCode(property: PublicProperty) {
  return property.codigo || property.id;
}

export function getPropertyTitle(property: PublicProperty) {
  return property.titulo || property.tipo_imovel || "Imóvel disponível";
}

export function getPropertyPrice(property: PublicProperty) {
  return property.valor_venda || property.valor_aluguel || null;
}

export function getPropertyPurpose(property: PublicProperty) {
  if (property.valor_aluguel && !property.valor_venda) return "Aluguel";
  if (property.valor_aluguel && property.valor_venda) return "Venda e aluguel";
  return "Venda";
}

export function formatPrice(value: number | null | undefined) {
  if (!value) return "Consulte";
  return value.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export function getPropertyLocation(property: PublicProperty) {
  return [property.bairro, property.cidade, property.estado].filter(Boolean).join(", ");
}

export function getWhatsAppHref(site: PublicSiteConfig, message?: string) {
  const phone = site.whatsapp?.replace(/\D/g, "");
  if (!phone) return null;
  const text = message || `Olá, vim pelo site da ${getSiteTitle(site)}.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function getThemeTokens(site: PublicSiteConfig) {
  const isDark = site.site_theme !== "light";
  return {
    isDark,
    background: site.background_color || (isDark ? "#111827" : "#f8fafc"),
    foreground: site.text_color || (isDark ? "#ffffff" : "#111827"),
    card: site.card_color || (isDark ? "#1f2937" : "#ffffff"),
    primary: site.primary_color || "#d97706",
    secondary: site.secondary_color || (isDark ? "#030712" : "#111827"),
    accent: site.accent_color || site.primary_color || "#0f766e",
  };
}
