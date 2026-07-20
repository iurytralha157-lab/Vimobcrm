/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Heart, Mail, MapPin, Menu, MessageCircle, Phone } from "lucide-react";

import type { PublicSiteConfig, SiteMenuItem } from "@/lib/api/public-site-server";
import { buildSiteHref, defaultMenuItems, getSiteDescription, getSiteTitle, getThemeTokens } from "./public-site-utils";
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
  const isPlenusSite = /plenus/i.test(`${site.organization_name || ""} ${site.custom_domain || ""} ${site.subdomain || ""}`);
  const whatsAppDefaultMessage = buildWhatsAppDefaultMessage(propertyTitle, propertyCode);
  const style = {
    "--site-bg": tokens.background,
    "--site-fg": tokens.foreground,
    "--site-card": tokens.card,
    "--site-primary": tokens.primary,
    "--site-secondary": tokens.secondary,
    "--site-accent": tokens.accent,
  } as CSSProperties;

  return (
    <div className="min-h-screen bg-[var(--site-bg)] text-[var(--site-fg)]" style={style}>
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

      <header className="fixed inset-x-0 top-3 z-50 px-3 text-white sm:top-4 sm:px-4">
        <div className="mx-auto flex min-h-[72px] w-full max-w-7xl items-center justify-between gap-5 rounded-[14px] bg-[#30332f]/78 px-5 backdrop-blur-xl sm:px-8 lg:min-h-[86px] lg:px-12">
          <Link href={buildSiteHref(basePath, "/")} className="flex min-w-0 items-center gap-3">
            {site.logo_url ? (
              <img
                src={site.logo_url}
                alt={title}
                className={[
                  "h-10 w-auto object-contain lg:h-12",
                  isPlenusSite ? "-ml-2 max-w-36 lg:-ml-4 lg:max-w-40" : "max-w-44",
                ].join(" ")}
                style={{ width: site.logo_width || undefined }}
              />
            ) : (
              <span className="truncate text-lg font-light tracking-wide">{title}</span>
            )}
          </Link>

          <nav className="hidden items-center justify-center gap-7 lg:flex" aria-label="Menu principal">
            {desktopNavItems.map((item) => {
              const href = buildSiteHref(basePath, item.href);
              const isExternal = item.link_type === "external" || /^https?:\/\//i.test(item.href);
              const className = "text-sm font-light uppercase text-white/76 transition hover:text-white";

              return isExternal ? (
                <a
                  key={item.id || item.href}
                  href={href}
                  target={item.open_in_new_tab ? "_blank" : undefined}
                  rel={item.open_in_new_tab ? "noreferrer" : undefined}
                  className={className}
                >
                  {item.label}
                </a>
              ) : (
                <Link key={item.id || item.href} href={href} className={className}>
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-4 lg:flex">
            <Link
              href={buildSiteHref(basePath, "/favoritos")}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/88 transition hover:bg-white/10 hover:text-white"
              aria-label="Favoritos"
            >
              <Heart className="h-5 w-5" strokeWidth={1.9} />
            </Link>
            <Link
              href={buildSiteHref(basePath, "/contato")}
              className="inline-flex h-11 items-center justify-center rounded-[10px] px-7 text-sm font-light uppercase text-white transition hover:brightness-110"
              style={{ backgroundColor: tokens.primary }}
            >
              Contato
            </Link>
          </div>

          <details className="relative lg:hidden">
            <summary className="flex h-10 w-11 cursor-pointer list-none items-center justify-center rounded-[10px] bg-white/10">
              <Menu className="h-5 w-5" strokeWidth={1.7} />
            </summary>
            <div className="absolute right-0 top-12 w-64 rounded-[14px] bg-[#30332f]/98 p-2">
              {navItems.map((item) => (
                <Link
                  key={item.id || item.href}
                  href={buildSiteHref(basePath, item.href)}
                  className="block rounded-md px-3 py-3 text-sm font-extralight text-white/80 hover:bg-white/10"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href={buildSiteHref(basePath, "/favoritos")}
                className="block rounded-md px-3 py-3 text-sm font-extralight text-white/80 hover:bg-white/10"
              >
                Favoritos
              </Link>
              <Link
                href={buildSiteHref(basePath, "/contato")}
                className="mt-1 flex items-center gap-2 rounded-md px-3 py-3 text-sm font-extralight text-white"
                style={{ backgroundColor: tokens.primary }}
              >
                <MessageCircle className="h-4 w-4" />
                Contato
              </Link>
            </div>
          </details>
        </div>
      </header>

      <main>{children}</main>

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

      <footer className="bg-[var(--site-secondary)] text-white">
        <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-2 lg:grid-cols-4 lg:px-8">
          <section>
            {site.logo_url ? (
              <img src={site.logo_url} alt={title} className="mb-4 h-10 w-auto max-w-48 object-contain" />
            ) : (
              <h2 className="mb-3 text-lg font-semibold">{title}</h2>
            )}
            <p className="text-sm leading-6 text-white/64">{getSiteDescription(site)}</p>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/90">Menu</h3>
            <ul className="space-y-2 text-sm text-white/64">
              {navItems.map((item) => (
                <li key={item.id || item.href}>
                  <Link href={buildSiteHref(basePath, item.href)} className="hover:text-white">
                    {item.label}
                  </Link>
                </li>
              ))}
              <li>
                <Link href={buildSiteHref(basePath, "/politica-de-privacidade")} className="hover:text-white">
                  Política de Privacidade
                </Link>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/90">Contato</h3>
            <ul className="space-y-3 text-sm text-white/64">
              {site.phone ? (
                <li>
                  <a href={`tel:${site.phone}`} className="flex items-center gap-2 hover:text-white">
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
              {site.email ? (
                <li>
                  <a href={`mailto:${site.email}`} className="flex items-center gap-2 hover:text-white">
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
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-white/90">Redes sociais</h3>
            <div className="flex flex-wrap gap-3">
              <SocialLink href={site.instagram} label="Instagram" icon={<InstagramIcon />} />
              <SocialLink href={site.facebook} label="Facebook" icon={<FacebookIcon />} />
              <SocialLink href={site.youtube} label="YouTube" icon={<YouTubeIcon />} />
              <SocialLink href={site.linkedin} label="LinkedIn" icon={<LinkedInIcon />} />
            </div>
          </section>
        </div>

        <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-white/44">
          © {new Date().getFullYear()} {site.organization_name || title}. Todos os direitos reservados.
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

  const hasApartments = baseItems.some((item) => item.label.includes("APART"));
  const hasHouses = baseItems.some((item) => item.label.includes("CASA"));
  const hasRent = baseItems.some((item) => item.label.includes("ALUGUEL"));

  return [
    ...baseItems,
    ...(!hasApartments
      ? [
          {
            id: "apartments",
            organization_id: "",
            label: "APARTAMENTOS",
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
            label: "CASAS",
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
            label: "ALUGUEL",
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
  if (normalized === "imoveis" || normalized === "imóveis" || normalized.startsWith("imÃ")) return "IMÓVEIS";
  return label.toUpperCase();
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
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition hover:bg-white/20"
      aria-label={label}
    >
      {icon}
    </a>
  );
}
