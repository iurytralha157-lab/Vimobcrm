/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Heart, Mail, MapPin, Menu, MessageCircle, Phone } from "lucide-react";

import type { PublicSiteConfig, SiteMenuItem } from "@/lib/api/public-site-server";
import {
  buildSiteHref,
  defaultMenuItems,
  getPublicEmailHref,
  getPublicPhoneHref,
  getSiteDescription,
  getSiteTitle,
  getThemeTokens,
  normalizePublicExternalUrl,
  normalizePublicImageUrl,
} from "./public-site-utils";
import { PublicSiteTracker } from "./PublicSiteTracker";
import { PublicContactLeadDialog } from "./PublicContactLeadDialog";
import { PublicCookieConsent } from "./PublicCookieConsent";
import { PublicTrackingScripts } from "./PublicTrackingScripts";
import { PublicSiteStructuredData } from "./PublicSiteStructuredData";

export function PublicSiteShell({
  basePath,
  children,
  isHome = false,
  menuItems,
  pageTitle,
  propertyCode,
  propertyId,
  propertyTitle,
  site,
}: Readonly<{
  basePath: string;
  children: ReactNode;
  isHome?: boolean;
  menuItems: SiteMenuItem[];
  pageTitle: string;
  propertyCode?: string;
  propertyId?: string;
  propertyTitle?: string;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const navItems = menuItems.length > 0 ? menuItems : defaultMenuItems;
  const desktopNavItems = buildDesktopNavItems(navItems);
  const title = getSiteTitle(site);
  const logoUrl = normalizePublicImageUrl(site.logo_url);
  const logoWidth = normalizeLogoDimension(site.logo_width, 176);
  const logoHeight = normalizeLogoDimension(site.logo_height, 48);
  const phoneHref = getPublicPhoneHref(site.phone);
  const emailHref = getPublicEmailHref(site.email);
  const isPlenusSite = /plenus/i.test(`${site.organization_name || ""} ${site.custom_domain || ""} ${site.subdomain || ""}`);
  const whatsAppDefaultMessage = buildWhatsAppDefaultMessage(propertyTitle, propertyCode);
  const style = {
    "--site-bg": tokens.background,
    "--site-fg": tokens.foreground,
    "--site-card": tokens.card,
    "--site-card-fg": tokens.cardForeground,
    "--site-primary": tokens.primary,
    "--site-primary-fg": tokens.primaryForeground,
    "--site-secondary": tokens.secondary,
    "--site-secondary-fg": tokens.secondaryForeground,
    "--site-accent": tokens.accent,
    "--site-header": tokens.header,
    "--site-header-hover": tokens.headerHover,
    "--site-header-fg": tokens.headerText,
    "--site-inverse": tokens.inverse,
    "--site-inverse-fg": tokens.inverseForeground,
    "--site-inverse-hover": tokens.inverseHover,
    "--site-modal-overlay": tokens.modalOverlay,
    "--site-on-dark": tokens.onDark,
    "--site-on-dark-muted": tokens.onDarkMuted,
    "--site-on-dark-soft": tokens.onDarkSoft,
    "--site-on-dark-soft-hover": tokens.onDarkSoftHover,
    "--site-overlay": tokens.overlay,
    "--site-overlay-soft": tokens.overlaySoft,
    "--site-overlay-strong": tokens.overlayStrong,
    "--site-whatsapp": tokens.whatsapp,
    "--site-whatsapp-fg": tokens.whatsappForeground,
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-[var(--site-bg)] text-[var(--site-fg)] font-light" style={style}>
      <PublicSiteStructuredData basePath={basePath} isHome={isHome} site={site} />
      <PublicTrackingScripts
        bodyScripts={site.body_scripts}
        googleAdsId={site.google_ads_id}
        googleAnalyticsId={site.google_analytics_id}
        gtmId={site.gtm_id}
        headScripts={site.head_scripts}
        metaPixelId={site.meta_pixel_id}
      />
      <PublicSiteTracker organizationId={site.organization_id} pageTitle={pageTitle} propertyId={propertyId} />

      <a
        href="#public-site-content"
        className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-[6px] bg-[var(--site-card)] px-3 py-2 text-[12px] font-light text-[var(--site-card-fg)] outline-none focus:translate-y-0 focus:ring-2 focus:ring-[var(--site-primary)]"
      >
        Ir para o conteúdo
      </a>

      <header className="fixed inset-x-0 top-3 z-50 px-3 text-[var(--site-header-fg)] sm:top-4 sm:px-4">
        <div className="mx-auto flex min-h-[72px] w-full max-w-7xl items-center justify-between gap-5 rounded-[8px] bg-[var(--site-header)] px-5 sm:px-8 lg:min-h-[86px] lg:px-12">
          <Link href={buildSiteHref(basePath, "/")} className="flex min-w-0 items-center gap-3 rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]" aria-label={`${title}, página inicial`}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={`${title}, página inicial`}
                width={logoWidth}
                height={logoHeight}
                className={[
                  "h-10 w-auto object-contain lg:h-12",
                  isPlenusSite ? "-ml-2 max-w-36 lg:-ml-4 lg:max-w-40" : "max-w-44",
                ].join(" ")}
                decoding="async"
                fetchPriority="high"
              />
            ) : (
              <span className="truncate text-[14px] font-normal">{title}</span>
            )}
          </Link>

          <nav className="hidden items-center justify-center gap-7 lg:flex" aria-label="Menu principal">
            {desktopNavItems.map((item) => {
              return (
                <SiteMenuLink
                  basePath={basePath}
                  className="rounded-[6px] text-[12px] font-light text-[var(--site-on-dark-muted)] outline-none hover:text-[var(--site-header-fg)] focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
                  item={item}
                  key={item.id || item.href}
                />
              );
            })}
          </nav>

          <div className="hidden items-center gap-4 lg:flex">
            <Link
              href={buildSiteHref(basePath, "/favoritos")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[var(--site-header-fg)] opacity-90 outline-none hover:bg-[var(--site-header-hover)] hover:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
              aria-label="Favoritos"
            >
              <Heart className="h-5 w-5" strokeWidth={1.9} />
            </Link>
            <Link
              href={buildSiteHref(basePath, "/contato")}
              className="inline-flex h-11 items-center justify-center rounded-[6px] bg-[var(--site-primary)] px-7 text-[12px] font-light text-[var(--site-primary-fg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
            >
              Contato
            </Link>
          </div>

          <details className="relative lg:hidden">
            <summary className="flex h-10 w-11 cursor-pointer list-none items-center justify-center rounded-[6px] bg-[var(--site-header-hover)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]" aria-label="Abrir menu principal">
              <Menu className="h-5 w-5" strokeWidth={1.7} />
            </summary>
            <div className="absolute right-0 top-12 w-64 rounded-[8px] bg-[var(--site-header)] p-2">
              {navItems.map((item) => (
                <SiteMenuLink
                  basePath={basePath}
                  className="block rounded-[6px] px-3 py-3 text-[12px] font-light text-[var(--site-on-dark-muted)] outline-none hover:bg-[var(--site-header-hover)] hover:text-[var(--site-header-fg)] focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
                  item={item}
                  key={item.id || item.href}
                />
              ))}
              <Link
                href={buildSiteHref(basePath, "/favoritos")}
                className="block rounded-[6px] px-3 py-3 text-[12px] font-light text-[var(--site-on-dark-muted)] outline-none hover:bg-[var(--site-header-hover)] hover:text-[var(--site-header-fg)] focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
              >
                Favoritos
              </Link>
              <Link
                href={buildSiteHref(basePath, "/contato")}
                className="mt-1 flex items-center gap-2 rounded-[6px] bg-[var(--site-primary)] px-3 py-3 text-[12px] font-light text-[var(--site-primary-fg)] outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[var(--site-header-fg)]"
              >
                <MessageCircle className="h-4 w-4" />
                Contato
              </Link>
            </div>
          </details>
        </div>
      </header>

      <main id="public-site-content" tabIndex={-1}>{children}</main>

      {site.whatsapp ? (
        <PublicContactLeadDialog
          defaultMessage={whatsAppDefaultMessage}
          organizationId={site.organization_id}
          primaryColor={tokens.primary}
          privacyHref={buildSiteHref(basePath, "/politica-de-privacidade")}
          propertyCode={propertyCode}
          propertyId={propertyId}
          siteTitle={title}
          triggerLabel="Abrir formulário de WhatsApp"
          variant="floating"
        />
      ) : null}

      <footer className="bg-[var(--site-secondary)] text-[var(--site-secondary-fg)]">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <section>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={title}
                width={logoWidth}
                height={logoHeight}
                className="mb-4 h-10 w-auto max-w-48 object-contain"
                decoding="async"
                loading="lazy"
              />
            ) : (
              <h2 className="mb-3 text-[14px] font-normal">{title}</h2>
            )}
            <p className="text-[12px] font-light leading-6 opacity-70">{getSiteDescription(site)}</p>
          </section>

          <section>
            <h3 className="mb-3 text-[14px] font-normal">Menu</h3>
            <ul className="space-y-2 text-[12px] font-light opacity-70">
              {navItems.map((item) => (
                <li key={item.id || item.href}>
                  <SiteMenuLink basePath={basePath} className="rounded-[4px] outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current" item={item} />
                </li>
              ))}
              <li>
                <Link href={buildSiteHref(basePath, "/politica-de-privacidade")} className="rounded-[4px] outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current">
                  Política de Privacidade
                </Link>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-3 text-[14px] font-normal">Contato</h3>
            <ul className="space-y-3 text-[12px] font-light opacity-70">
              {site.phone && phoneHref ? (
                <li>
                  <a href={phoneHref} className="flex items-center gap-2 rounded-[4px] outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current">
                    <Phone className="h-4 w-4" />
                    {site.phone}
                  </a>
                </li>
              ) : null}
              {site.whatsapp ? (
                <li>
                  <PublicContactLeadDialog
                    defaultMessage={whatsAppDefaultMessage}
                    organizationId={site.organization_id}
                    primaryColor={tokens.primary}
                    privacyHref={buildSiteHref(basePath, "/politica-de-privacidade")}
                    propertyCode={propertyCode}
                    propertyId={propertyId}
                    siteTitle={title}
                    triggerLabel="WhatsApp"
                    variant="footer-line"
                  />
                </li>
              ) : null}
              {site.email && emailHref ? (
                <li>
                  <a href={emailHref} className="flex items-center gap-2 rounded-[4px] outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-current">
                    <Mail className="h-4 w-4" />
                    {site.email}
                  </a>
                </li>
              ) : null}
              {site.address || site.city ? (
                <li className="flex items-start gap-2">
                  <MapPin className="mt-0.5 h-4 w-4" />
                  <span>{[site.address, site.city, site.state].filter(Boolean).join(", ")}</span>
                </li>
              ) : null}
            </ul>
          </section>

          <section>
            <h3 className="mb-3 text-[14px] font-normal">Redes sociais</h3>
            <div className="flex flex-wrap gap-3">
              <SocialLink href={site.instagram} label="Instagram" icon={<InstagramIcon />} />
              <SocialLink href={site.facebook} label="Facebook" icon={<FacebookIcon />} />
              <SocialLink href={site.youtube} label="YouTube" icon={<YouTubeIcon />} />
              <SocialLink href={site.linkedin} label="LinkedIn" icon={<LinkedInIcon />} />
            </div>
          </section>
        </div>

        <div className="border-t border-current/10 px-4 py-5 text-center text-[12px] font-light opacity-60">
          © {new Date().getUTCFullYear()} {site.organization_name || title}. Todos os direitos reservados.
        </div>
      </footer>

      <PublicCookieConsent
        primaryColor={tokens.primary}
        privacyHref={buildSiteHref(basePath, "/politica-de-privacidade")}
        siteTitle={title}
      />
    </div>
  );
}

function buildWhatsAppDefaultMessage(propertyTitle?: string, propertyCode?: string) {
  const title = propertyTitle?.trim();
  const code = propertyCode?.trim();
  if (!title) {
    return "Olá, vim pelo site e gostaria de receber mais informações.";
  }
  return `Olá, vim pelo site e tenho interesse no imóvel ${title}${code ? ` (ref. ${code})` : ""}. Gostaria de receber mais informações.`;
}

function buildDesktopNavItems(items: SiteMenuItem[]) {
  const baseItems = items
    .filter((item) => {
      const href = item.href.toLowerCase();
      const label = item.label.toLowerCase();
      return href !== "/contato" && href !== "contato" && href !== "/favoritos" && label !== "contato" && label !== "favoritos";
    })
    .map((item) => ({ ...item, label: formatDesktopMenuLabel(item.label) }));

  const hasApartments = baseItems.some((item) => item.label.toLowerCase().includes("apart"));
  const hasHouses = baseItems.some((item) => item.label.toLowerCase().includes("casa"));
  const hasRent = baseItems.some((item) => item.label.toLowerCase().includes("aluguel"));

  return [
    ...baseItems,
    ...(!hasApartments
      ? [
          {
            id: "apartments",
            organization_id: "",
            label: "Apartamentos",
            link_type: "internal" as const,
            href: "/imoveis?tipo=Apartamento",
            position: 20,
            open_in_new_tab: false,
            is_active: true,
          },
        ]
      : []),
    ...(!hasHouses
      ? [
          {
            id: "houses",
            organization_id: "",
            label: "Casas",
            link_type: "internal" as const,
            href: "/imoveis?tipo=Casa",
            position: 21,
            open_in_new_tab: false,
            is_active: true,
          },
        ]
      : []),
    ...(!hasRent
      ? [
          {
            id: "rent",
            organization_id: "",
            label: "Aluguel",
            link_type: "internal" as const,
            href: "/imoveis?finalidade=locacao",
            position: 22,
            open_in_new_tab: false,
            is_active: true,
          },
        ]
      : []),
  ];
}

function formatDesktopMenuLabel(label: string) {
  const normalized = label.trim().toLowerCase();
  if (normalized === "imoveis" || normalized === "imóveis" || normalized.startsWith("imÃ")) return "Imóveis";
  return label.trim();
}

function SiteMenuLink({
  basePath,
  className,
  item,
}: Readonly<{
  basePath: string;
  className: string;
  item: SiteMenuItem;
}>) {
  const shouldOpenAsExternal = item.link_type === "external" || /^https?:\/\//i.test(item.href);
  const externalHref = shouldOpenAsExternal
    ? normalizePublicExternalUrl(item.href)
    : null;

  if (externalHref) {
    return (
      <a
        className={className}
        href={externalHref}
        rel={item.open_in_new_tab ? "noopener noreferrer" : undefined}
        target={item.open_in_new_tab ? "_blank" : undefined}
      >
        {item.label}
      </a>
    );
  }

  if (shouldOpenAsExternal) return null;

  return (
    <Link className={className} href={buildSiteHref(basePath, item.href)}>
      {item.label}
    </Link>
  );
}

function FacebookIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M14.2 8.2V6.7c0-.7.5-.9.9-.9h2.2V2.2L14.2 2c-3.1 0-4.9 1.9-4.9 5.2v1H6.2V12h3.1v9.8h4V12h3.1l.5-3.8h-3.6z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M7.8 2h8.4A5.8 5.8 0 0 1 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8A5.8 5.8 0 0 1 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2Zm0 2A3.8 3.8 0 0 0 4 7.8v8.4A3.8 3.8 0 0 0 7.8 20h8.4a3.8 3.8 0 0 0 3.8-3.8V7.8A3.8 3.8 0 0 0 16.2 4H7.8Zm8.7 2.1a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8ZM12 7.4a4.6 4.6 0 1 1 0 9.2 4.6 4.6 0 0 1 0-9.2Zm0 2a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z" />
    </svg>
  );
}

function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M21.6 7.2a3 3 0 0 0-2.1-2.1C17.7 4.6 12 4.6 12 4.6s-5.7 0-7.5.5a3 3 0 0 0-2.1 2.1A31 31 0 0 0 2 12a31 31 0 0 0 .4 4.8 3 3 0 0 0 2.1 2.1c1.8.5 7.5.5 7.5.5s5.7 0 7.5-.5a3 3 0 0 0 2.1-2.1A31 31 0 0 0 22 12a31 31 0 0 0-.4-4.8ZM10 15.4V8.6l5.9 3.4L10 15.4Z" />
    </svg>
  );
}

function LinkedInIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4 fill-current">
      <path d="M5.3 8.9H2.2v12.4h3.1V8.9ZM3.8 3a1.8 1.8 0 1 0 0 3.6A1.8 1.8 0 0 0 3.8 3Zm6.9 5.9h-3v12.4h3v-6.5c0-1.7.8-3.1 2.5-3.1 1.6 0 2.1 1.1 2.1 3v6.6h3.1v-7.2c0-3.6-1.9-5.5-4.5-5.5-2 0-3.1 1.1-3.6 1.9V8.9h.4Z" />
    </svg>
  );
}

function SocialLink({
  href,
  icon,
  label,
}: Readonly<{
  href?: string | null;
  icon: ReactNode;
  label: string;
}>) {
  const safeHref = normalizePublicExternalUrl(href);
  if (!safeHref) return null;

  return (
    <a
      href={safeHref}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--site-on-dark-soft)] text-[var(--site-secondary-fg)] outline-none hover:bg-[var(--site-on-dark-soft-hover)] focus-visible:ring-2 focus-visible:ring-current"
      aria-label={label}
    >
      {icon}
    </a>
  );
}

function normalizeLogoDimension(value: number | null | undefined, fallback: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.max(Math.round(value), 24), 320);
}
