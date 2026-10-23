"use client";

import Image from "next/image";
import { Building2, Globe, Mail, Monitor, Phone, Smartphone } from "lucide-react";
import { useState } from "react";

import type { OrganizationSite, SiteMenuItem, SiteSearchFilter } from "@/lib/api/site";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getThemeTokens } from "@/components/features/public-site/public-site-utils";

type SiteFormPreviewProps = {
  values: Partial<OrganizationSite>;
  site: OrganizationSite | null | undefined;
  menuItems: SiteMenuItem[];
  searchFilters: SiteSearchFilter[];
};

/** A passive view of current settings: no public trackers, scripts or contact actions. */
export function SiteFormPreview({ values, site, menuItems, searchFilters }: SiteFormPreviewProps) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const tokens = getThemeTokens({
    site_theme: values.site_theme || "dark",
    background_color: values.background_color ?? null,
    card_color: values.card_color ?? null,
    text_color: values.text_color ?? null,
    primary_color: values.primary_color ?? null,
    secondary_color: values.secondary_color ?? null,
    accent_color: values.accent_color ?? null,
  });
  const foreground = tokens.foreground;
  const background = tokens.background;
  const surface = tokens.card;
  const primary = tokens.primary;
  const activeMenu = menuItems.filter((item) => item.is_active).sort((left, right) => (left.position || 0) - (right.position || 0));
  const activeFilters = searchFilters.filter((item) => item.is_active).sort((left, right) => (left.position || 0) - (right.position || 0));
  const title = values.site_title?.trim() || "Seu site imobiliário";
  const location = [values.city, values.state].filter(Boolean).join(" / ");

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-1">
        <Button type="button" variant="ghost" aria-label="Prévia desktop" aria-pressed={device === "desktop"} onClick={() => setDevice("desktop")} className={cn("h-8 w-8 rounded-[6px] p-0 text-[var(--app-text-secondary)]", device === "desktop" && "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]")}>
          <Monitor className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
        <Button type="button" variant="ghost" aria-label="Prévia celular" aria-pressed={device === "mobile"} onClick={() => setDevice("mobile")} className={cn("h-8 w-8 rounded-[6px] p-0 text-[var(--app-text-secondary)]", device === "mobile" && "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]")}>
          <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
      <div data-site-form-preview className={cn("mx-auto overflow-hidden rounded-[8px]", device === "mobile" && "max-w-[220px]")} style={{ backgroundColor: background, color: foreground }}>
        <header className="space-y-3 p-4" style={{ backgroundColor: surface, color: tokens.cardForeground }}>
          <div className="flex items-center gap-2">
            {site?.logo_url ? <Image src={site.logo_url} alt="" width={100} height={30} unoptimized className="max-h-8 w-auto max-w-[100px] object-contain" /> : <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 break-words text-[12px] font-normal">{title}</span>
          </div>
          {activeMenu.length > 0 && <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] opacity-75">{activeMenu.map((item) => <span key={item.id}>{item.label}</span>)}</div>}
        </header>

        <section className="relative overflow-hidden">
          {site?.hero_image_url && <Image src={site.hero_image_url} alt="Imagem principal do site" width={560} height={340} unoptimized className="aspect-[4/3] w-full object-cover" />}
          <div className="space-y-3 p-4">
            <h3 className="break-words text-[16px] font-normal">{values.hero_title?.trim() || title}</h3>
            {values.hero_subtitle && <p className="whitespace-pre-wrap break-words text-[12px] opacity-75">{values.hero_subtitle}</p>}
            {activeFilters.length > 0 && <div className="flex flex-wrap gap-2 rounded-[6px] p-3 text-[11px]" style={{ backgroundColor: surface, color: tokens.cardForeground }}>{activeFilters.map((filter) => <span key={filter.id}>{filter.label}</span>)}</div>}
          </div>
        </section>

        {values.show_about_on_home && (values.about_title || values.about_text) && <section className="space-y-2 p-4" style={{ backgroundColor: surface, color: tokens.cardForeground }}>
          {values.about_title && <h4 className="text-[13px] font-normal">{values.about_title}</h4>}
          {values.about_text && <p className="whitespace-pre-wrap break-words text-[12px] opacity-75">{values.about_text}</p>}
        </section>}

        <section className="space-y-3 p-4">
          <div className="flex items-center gap-2 text-[12px]"><Building2 className="h-4 w-4 shrink-0" aria-hidden="true" /><span>Imóveis da imobiliária</span></div>
          <div className="h-1 w-8 rounded-full" style={{ backgroundColor: primary }} />
          {location && <p className="text-[12px] opacity-75">{location}</p>}
          {(values.phone || values.whatsapp) && <p className="flex items-center gap-2 break-all text-[12px]"><Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{values.phone || values.whatsapp}</p>}
          {values.email && <p className="flex items-center gap-2 break-all text-[12px]"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{values.email}</p>}
        </section>
      </div>
    </div>
  );
}
