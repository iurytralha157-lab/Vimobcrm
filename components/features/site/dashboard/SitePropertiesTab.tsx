import { useMemo, useState } from "react";

import { formatCount, formatPercent, percentOf } from "@/components/features/marketing/marketing-format";
import { EmptyNote, KpiRow, Panel } from "@/components/features/marketing/marketing-ui";
import { cn } from "@/lib/utils";

import { SitePropertySpotlight } from "./SitePropertySpotlight";
import {
  businessKind,
  percentDelta,
  propertyBusinessLabel,
  propertyTitleLine,
  type SiteDashboardData,
  type SiteInsightProperty,
} from "./site-dashboard-format";
import { PropertyPhoto, Segmented, SiteKpi } from "./site-dashboard-ui";

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "sale", label: "Venda" },
  { key: "rent", label: "Locação" },
] as const;
type PropertyFilter = (typeof FILTERS)[number]["key"];

function matchesFilter(property: SiteInsightProperty, filter: PropertyFilter) {
  if (filter === "all") return true;
  const kind = businessKind(property.business_type);
  return kind === filter || kind === "both";
}

function PropertyTile({
  property,
  rank,
  selected,
  onSelect,
}: {
  property: SiteInsightProperty;
  rank: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const title = propertyTitleLine(property);
  const business = propertyBusinessLabel(property.business_type);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "min-w-0 overflow-hidden rounded-[12px] bg-[var(--app-surface-solid)] text-left outline-none ring-1 ring-transparent transition-shadow hover:ring-[var(--app-border)] focus-visible:ring-primary/40",
        selected && "ring-2 ring-primary hover:ring-primary",
      )}
    >
      <div className="relative">
        <PropertyPhoto url={property.photo_url} alt={title} className="h-28 w-full sm:h-32" />
        <span className="absolute left-2 top-2 rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-primary)]">
          {rank === 1 ? "1º lugar" : property.code || `${rank}º lugar`}
        </span>
        {business ? (
          <span className="absolute right-2 top-2 rounded-[4px] bg-[var(--app-surface-solid)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-primary)]">
            {business}
          </span>
        ) : null}
      </div>
      <div className="p-3">
        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]" title={title}>{title}</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <div className="min-w-0">
            <p className="truncate text-[10px] font-light text-[var(--app-text-secondary)]">Visualizações</p>
            <p className="text-[14px] font-normal tabular-nums text-[var(--app-text-primary)]">{formatCount(property.views)}</p>
          </div>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-light text-[var(--app-text-secondary)]">Leads</p>
            <p className="text-[14px] font-normal tabular-nums text-[var(--app-text-primary)]">{formatCount(property.leads)}</p>
          </div>
        </div>
        <p className="mt-2 truncate border-t border-[var(--app-border)] pt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {formatCount(property.whatsapp_clicks)} WhatsApp · {formatCount(property.favorites)} favoritos
        </p>
      </div>
    </button>
  );
}

export function SitePropertiesTab({ data }: { data: SiteDashboardData }) {
  const { insights } = data;
  const [filter, setFilter] = useState<PropertyFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const properties = useMemo(() => insights?.properties ?? [], [insights]);
  const visible = properties.filter((property) => matchesFilter(property, filter));
  const selected = visible.find((property) => property.property_id === selectedId) ?? visible[0];
  const viewed = insights?.current.viewed_properties ?? 0;

  return (
    <div className="space-y-3">
      <KpiRow>
        <SiteKpi
          id="imoveis-visualizados"
          label="Imóveis visualizados"
          value={formatCount(insights?.current.viewed_properties)}
          note="Com visitas no período"
        />
        <SiteKpi
          id="visualizacoes-imovel"
          label="Visualizações de imóvel"
          value={formatCount(insights?.current.property_views)}
          note={insights ? `${formatCount(insights.current.property_sessions)} sessões` : undefined}
          delta={percentDelta(insights?.current.property_views, insights?.previous.property_views)}
        />
        <SiteKpi
          id="whatsapp"
          label="Cliques no WhatsApp"
          value={formatCount(insights?.current.whatsapp_clicks)}
          note={insights ? `${formatPercent(percentOf(insights.current.whatsapp_clicks, insights.current.property_views))} das visualizações` : undefined}
          delta={percentDelta(insights?.current.whatsapp_clicks, insights?.previous.whatsapp_clicks)}
        />
        <SiteKpi
          id="favoritos"
          label="Favoritados"
          value={formatCount(insights?.current.favorites)}
          note={insights ? `${formatPercent(percentOf(insights.current.favorites, insights.current.property_views))} das visualizações` : undefined}
          delta={percentDelta(insights?.current.favorites, insights?.previous.favorites)}
        />
      </KpiRow>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segmented label="Tipo de negócio" value={filter} options={FILTERS} onChange={setFilter} />
        <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
          {filter === "all" && viewed > properties.length
            ? `Os ${formatCount(properties.length)} mais vistos de ${formatCount(viewed)} imóveis com visitas`
            : `${formatCount(visible.length)} ${visible.length === 1 ? "imóvel" : "imóveis"} com visitas no período`}
        </span>
      </div>

      {visible.length > 0 && selected ? (
        <div className="grid min-w-0 items-start gap-3 xl:grid-cols-[minmax(0,1fr)_288px]">
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-4">
            {visible.map((property) => (
              <PropertyTile
                key={property.property_id}
                property={property}
                rank={properties.indexOf(property) + 1}
                selected={property.property_id === selected.property_id}
                onSelect={() => setSelectedId(property.property_id)}
              />
            ))}
          </div>
          <Panel title="Detalhe do imóvel">
            <SitePropertySpotlight
              property={selected}
              badge={selected.code || `${properties.indexOf(selected) + 1}º lugar`}
              headline="conversion"
              siteBaseUrl={data.siteBaseUrl}
            />
          </Panel>
        </div>
      ) : (
        <Panel title="Imóveis">
          <EmptyNote>
            {filter === "all" ? "Nenhum imóvel visto no período." : "Nenhum imóvel desse tipo com visitas no período."}
          </EmptyNote>
        </Panel>
      )}
    </div>
  );
}
