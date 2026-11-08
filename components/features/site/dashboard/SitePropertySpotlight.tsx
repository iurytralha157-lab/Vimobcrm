import { ExternalLink } from "lucide-react";

import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import { getSitePublicPageUrl } from "@/lib/site/site-publication";

import {
  formatDuration,
  propertyBusinessLabel,
  propertyPriceLabel,
  propertyTitleLine,
  type SiteInsightProperty,
} from "./site-dashboard-format";
import { PropertyPhoto } from "./site-dashboard-ui";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] font-light text-[var(--app-text-secondary)]">{label}</p>
      <p className="whitespace-nowrap text-[14px] font-normal tabular-nums text-[var(--app-text-primary)]">{value}</p>
    </div>
  );
}

/**
 * The property card of the Overview and Imóveis tabs. It stays on the regular
 * light surface: the approved design replaced the prototype's black card.
 */
export function SitePropertySpotlight({
  property,
  badge,
  headline,
  siteBaseUrl,
}: {
  property: SiteInsightProperty;
  badge: string;
  headline: "views" | "conversion";
  siteBaseUrl: string | null;
}) {
  const title = propertyTitleLine(property);
  const price = propertyPriceLabel(property);
  const business = propertyBusinessLabel(property.business_type);
  const siteUrl = getSitePublicPageUrl(siteBaseUrl, property.page_path);
  const conversion = formatPercent(property.conversion_rate);

  return (
    <div className="min-w-0">
      <div className="relative overflow-hidden rounded-[10px]">
        <PropertyPhoto url={property.photo_url} alt={title} className="h-40 w-full" iconClassName="h-8 w-8" />
        <span className="absolute right-2 top-2 rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-primary)]">
          {badge}
        </span>
      </div>
      <p className="mt-3 text-[14px] font-normal text-[var(--app-text-primary)]">{title}</p>
      <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-secondary)]">
        {[property.code || null, business, price].filter(Boolean).join(" · ")}
      </p>
      <div className="mt-3 flex items-baseline justify-between gap-3 border-b border-[var(--app-border)] pb-2.5">
        <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
          {headline === "views" ? "Visualizações" : "Conversão"}
        </span>
        <span className="text-[24px] font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">
          {headline === "views" ? formatCount(property.views) : conversion}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-x-2 gap-y-3">
        {headline === "views" ? null : <Stat label="Visualizações" value={formatCount(property.views)} />}
        <Stat label="Leads" value={formatCount(property.leads)} />
        <Stat label="WhatsApp" value={formatCount(property.whatsapp_clicks)} />
        <Stat label="Formulários" value={formatCount(property.form_submits)} />
        <Stat label="Favoritos" value={formatCount(property.favorites)} />
        {headline === "views" ? <Stat label="Conversão" value={conversion} /> : null}
        <Stat label="Tempo médio" value={formatDuration(property.avg_duration)} />
      </div>
      {siteUrl ? (
        <a
          href={siteUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-10 items-center justify-center gap-1.5 rounded-full bg-primary text-[12px] font-normal text-primary-foreground transition-opacity hover:opacity-90"
        >
          Ver no site
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
