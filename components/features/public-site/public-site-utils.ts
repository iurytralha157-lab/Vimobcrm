import type { PublicProperty, PublicSiteConfig, SiteMenuItem } from "@/lib/api/public-site-server";

const HEX_COLOR_PATTERN = /^#(?:[\da-f]{3}|[\da-f]{6})$/i;
const YOUTUBE_VIDEO_ID_PATTERN = /^[\w-]{6,20}$/;

const PUBLIC_SITE_DEFAULTS = {
  dark: {
    background: "#111827",
    card: "#1f2937",
    foreground: "#ffffff",
    secondary: "#030712",
  },
  light: {
    background: "#f8fafc",
    card: "#ffffff",
    foreground: "#111827",
    secondary: "#111827",
  },
  accent: "#0f766e",
  darkForeground: "#111827",
  lightForeground: "#ffffff",
  primary: "#d97706",
  whatsapp: "#25d366",
} as const;

const PUBLIC_SITE_SURFACES = {
  header: "rgb(48 51 47 / 0.94)",
  headerHover: "rgb(255 255 255 / 0.1)",
  headerText: "#ffffff",
  inverse: "rgb(255 255 255 / 0.94)",
  inverseForeground: "#18181b",
  inverseHover: "#ffffff",
  modalOverlay: "rgb(0 0 0 / 0.72)",
  overlay: "rgb(0 0 0 / 0.58)",
  overlaySoft: "rgb(0 0 0 / 0.38)",
  overlayStrong: "rgb(0 0 0 / 0.94)",
  onDark: "#ffffff",
  onDarkMuted: "rgb(255 255 255 / 0.7)",
  onDarkSoft: "rgb(255 255 255 / 0.12)",
  onDarkSoftHover: "rgb(255 255 255 / 0.18)",
} as const;

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

export function normalizePublicImageUrl(value?: string | null, fallback = "") {
  const normalized = value?.trim();
  if (!normalized) return fallback;

  const storagePath = normalizeStorageImagePath(normalized);
  if (storagePath) return storagePath;

  if (normalized.startsWith("/") && !normalized.startsWith("//")) {
    try {
      const localUrl = new URL(normalized, "https://public-site.invalid");
      return localUrl.origin === "https://public-site.invalid"
        ? `${localUrl.pathname}${localUrl.search}${localUrl.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }

  try {
    const url = new URL(normalized);
    if (url.username || url.password) return fallback;
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStorageImagePath(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("//")) return null;

  const storageObjectMatch = /^\/?(storage\/v1\/object\/public\/.+)$/i.exec(trimmed);
  if (storageObjectMatch?.[1]) return `/${storageObjectMatch[1]}`;

  const publicObjectMatch = /^\/?(object\/public\/.+)$/i.exec(trimmed);
  if (publicObjectMatch?.[1]) return `/storage/v1/${publicObjectMatch[1]}`;

  return null;
}

export function normalizePublicExternalUrl(value?: string | null) {
  const normalized = value?.trim();
  if (!normalized) return null;

  const candidate = /^[\w.-]+\.[a-z]{2,}(?:[/?#].*)?$/i.test(normalized)
    ? `https://${normalized}`
    : normalized;

  try {
    const url = new URL(candidate);
    if (url.username || url.password) return null;
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function getPublicEmailHref(value?: string | null) {
  const email = value?.trim();
  if (!email || email.length > 254 || !/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(email)) return null;
  return `mailto:${email}`;
}

export function getPublicPhoneHref(value?: string | null) {
  const phone = value?.trim();
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `tel:${phone.startsWith("+") ? "+" : ""}${digits}`;
}

export function getPublicMediaEmbedUrl(videoValue?: string | null, tourValue?: string | null) {
  const youtubeEmbed = getYouTubeEmbedUrl(videoValue);
  if (youtubeEmbed) return youtubeEmbed;

  const youtubeTourEmbed = getYouTubeEmbedUrl(tourValue);
  if (youtubeTourEmbed) return youtubeTourEmbed;

  const tourUrl = normalizePublicExternalUrl(tourValue);
  if (!tourUrl) return "";

  try {
    const parsed = new URL(tourUrl);
    return parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

export function getYouTubeEmbedUrl(value?: string | null) {
  const normalized = normalizePublicExternalUrl(value);
  if (!normalized) return "";

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    let videoId = "";

    if (host === "youtu.be") videoId = parsed.pathname.split("/").filter(Boolean)[0] || "";
    if (["youtube.com", "m.youtube.com", "music.youtube.com", "youtube-nocookie.com"].includes(host)) {
      if (parsed.pathname.startsWith("/embed/")) videoId = parsed.pathname.split("/")[2] || "";
      if (!videoId) videoId = parsed.searchParams.get("v") || "";
      if (!videoId && parsed.pathname.startsWith("/shorts/")) videoId = parsed.pathname.split("/")[2] || "";
    }

    return YOUTUBE_VIDEO_ID_PATTERN.test(videoId)
      ? `https://www.youtube-nocookie.com/embed/${videoId}`
      : "";
  } catch {
    return "";
  }
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
  if (!value || value <= 0 || !Number.isFinite(value)) return "Consulte";
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
  if (!phone || phone.length < 8 || phone.length > 15) return null;
  const text = message || `Olá, vim pelo site da ${getSiteTitle(site)}.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

export function getThemeTokens(site: PublicSiteConfig) {
  const isDark = site.site_theme !== "light";
  const defaults = isDark ? PUBLIC_SITE_DEFAULTS.dark : PUBLIC_SITE_DEFAULTS.light;
  const background = normalizeThemeColor(site.background_color, defaults.background);
  const card = normalizeThemeColor(site.card_color, defaults.card);
  const preferredForeground = normalizeThemeColor(site.text_color, defaults.foreground);
  const primary = normalizeThemeColor(site.primary_color, PUBLIC_SITE_DEFAULTS.primary);
  const secondary = normalizeThemeColor(site.secondary_color, defaults.secondary);
  const accent = normalizeThemeColor(site.accent_color || site.primary_color, PUBLIC_SITE_DEFAULTS.accent);

  return {
    isDark,
    accent,
    background,
    card,
    cardForeground: getReadableForeground(card, preferredForeground),
    foreground: getReadableForeground(background, preferredForeground),
    header: PUBLIC_SITE_SURFACES.header,
    headerHover: PUBLIC_SITE_SURFACES.headerHover,
    headerText: PUBLIC_SITE_SURFACES.headerText,
    inverse: PUBLIC_SITE_SURFACES.inverse,
    inverseForeground: PUBLIC_SITE_SURFACES.inverseForeground,
    inverseHover: PUBLIC_SITE_SURFACES.inverseHover,
    modalOverlay: PUBLIC_SITE_SURFACES.modalOverlay,
    onDark: PUBLIC_SITE_SURFACES.onDark,
    onDarkMuted: PUBLIC_SITE_SURFACES.onDarkMuted,
    onDarkSoft: PUBLIC_SITE_SURFACES.onDarkSoft,
    onDarkSoftHover: PUBLIC_SITE_SURFACES.onDarkSoftHover,
    overlay: PUBLIC_SITE_SURFACES.overlay,
    overlaySoft: PUBLIC_SITE_SURFACES.overlaySoft,
    overlayStrong: PUBLIC_SITE_SURFACES.overlayStrong,
    primary,
    primaryForeground: getReadableForeground(primary),
    secondary,
    secondaryForeground: getReadableForeground(secondary),
    whatsapp: PUBLIC_SITE_DEFAULTS.whatsapp,
    whatsappForeground: getReadableForeground(PUBLIC_SITE_DEFAULTS.whatsapp),
  };
}

function normalizeThemeColor(value: string | null | undefined, fallback: string) {
  const normalized = value?.trim();
  return normalized && HEX_COLOR_PATTERN.test(normalized) ? expandHexColor(normalized) : fallback;
}

function expandHexColor(value: string) {
  if (value.length !== 4) return value.toLowerCase();
  return `#${value
    .slice(1)
    .split("")
    .map((character) => `${character}${character}`)
    .join("")}`.toLowerCase();
}

function getReadableForeground(background: string, preferred?: string) {
  if (preferred && contrastRatio(background, preferred) >= 4.5) return preferred;

  const darkContrast = contrastRatio(background, PUBLIC_SITE_DEFAULTS.darkForeground);
  const lightContrast = contrastRatio(background, PUBLIC_SITE_DEFAULTS.lightForeground);
  return darkContrast >= lightContrast
    ? PUBLIC_SITE_DEFAULTS.darkForeground
    : PUBLIC_SITE_DEFAULTS.lightForeground;
}

function contrastRatio(left: string, right: string) {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

function relativeLuminance(color: string) {
  const hexadecimal = expandHexColor(color).slice(1);
  const channels = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(hexadecimal.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}
