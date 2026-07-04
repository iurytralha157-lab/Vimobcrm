/* eslint-disable @next/next/no-img-element */

import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { Globe, Heart, Mail, MapPin, Menu, MessageCircle, Phone, Share2, UserRound, Video } from "lucide-react";

import type { PublicSiteConfig, SiteMenuItem } from "@/lib/api/public-site-server";
import { buildSiteHref, defaultMenuItems, getSiteDescription, getSiteTitle, getThemeTokens, getWhatsAppHref } from "./public-site-utils";
import { PublicSiteTracker } from "./PublicSiteTracker";

export function PublicSiteShell({
  basePath,
  children,
  menuItems,
  pageTitle,
  propertyId,
  site,
}: Readonly<{
  basePath: string;
  children: ReactNode;
  menuItems: SiteMenuItem[];
  pageTitle: string;
  propertyId?: string;
  site: PublicSiteConfig;
}>) {
  const tokens = getThemeTokens(site);
  const navItems = menuItems.length > 0 ? menuItems : defaultMenuItems;
  const desktopNavItems = buildDesktopNavItems(navItems);
  const title = getSiteTitle(site);
  const whatsappHref = getWhatsAppHref(site);
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
      <PublicSiteTracker organizationId={site.organization_id} pageTitle={pageTitle} propertyId={propertyId} />

      <header className="fixed inset-x-0 top-3 z-50 px-3 text-white sm:top-4 sm:px-4">
        <div className="mx-auto flex min-h-[72px] w-full max-w-7xl items-center justify-between gap-5 rounded-[14px] bg-[#30332f]/78 px-5 shadow-[0_18px_42px_rgba(0,0,0,0.18)] backdrop-blur-xl sm:px-8 lg:min-h-[86px] lg:px-12">
          <Link href={buildSiteHref(basePath, "/")} className="flex min-w-0 items-center gap-3">
            {site.logo_url ? (
              <img
                src={site.logo_url}
                alt={title}
                className="h-10 w-auto max-w-44 object-contain lg:h-12"
                style={{ width: site.logo_width || undefined }}
              />
            ) : (
              <span className="truncate text-lg font-semibold tracking-wide">{title}</span>
            )}
          </Link>

          <nav className="hidden items-center justify-center gap-7 lg:flex" aria-label="Menu principal">
            {desktopNavItems.map((item) => {
              const href = buildSiteHref(basePath, item.href);
              const isExternal = item.link_type === "external" || /^https?:\/\//i.test(item.href);
              const className = "text-sm font-medium uppercase text-white/76 transition hover:text-white";

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
              className="inline-flex h-11 items-center justify-center rounded-[10px] px-7 text-sm font-medium uppercase text-white transition hover:brightness-110"
              style={{ backgroundColor: tokens.primary }}
            >
              Contato
            </Link>
          </div>

          <details className="relative lg:hidden">
            <summary className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full bg-white/10">
              <Menu className="h-5 w-5" />
            </summary>
            <div className="absolute right-0 top-12 w-64 rounded-[14px] bg-[#30332f]/98 p-2 shadow-2xl">
              {navItems.map((item) => (
                <Link
                  key={item.id || item.href}
                  href={buildSiteHref(basePath, item.href)}
                  className="block rounded-md px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10"
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href={buildSiteHref(basePath, "/favoritos")}
                className="block rounded-md px-3 py-3 text-sm font-medium text-white/80 hover:bg-white/10"
              >
                Favoritos
              </Link>
              <Link
                href={buildSiteHref(basePath, "/contato")}
                className="mt-1 flex items-center gap-2 rounded-md px-3 py-3 text-sm font-semibold text-white"
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

      {whatsappHref ? (
        <a
          href={whatsappHref}
          target="_blank"
          rel="noreferrer"
          className="fixed bottom-5 right-5 z-40 inline-flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] text-white shadow-2xl transition hover:scale-105"
          aria-label="Fale pelo WhatsApp"
        >
          <MessageCircle className="h-7 w-7" />
        </a>
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
                  <a href={whatsappHref || "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:text-white">
                    <MessageCircle className="h-4 w-4" />
                    WhatsApp
                  </a>
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
              <SocialLink href={site.instagram} label="Instagram" icon={<Share2 className="h-4 w-4" />} />
              <SocialLink href={site.facebook} label="Facebook" icon={<Globe className="h-4 w-4" />} />
              <SocialLink href={site.youtube} label="YouTube" icon={<Video className="h-4 w-4" />} />
              <SocialLink href={site.linkedin} label="LinkedIn" icon={<UserRound className="h-4 w-4" />} />
            </div>
          </section>
        </div>

        <div className="border-t border-white/10 px-4 py-5 text-center text-xs text-white/44">
          © {new Date().getFullYear()} {site.organization_name || title}. Todos os direitos reservados.
        </div>
      </footer>
    </div>
  );
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
            href: "/imoveis?finalidade=aluguel",
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
  if (normalized === "imoveis" || normalized === "imóveis") return "IMÓVEIS";
  return label.toUpperCase();
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
