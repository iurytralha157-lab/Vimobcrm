"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Megaphone } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardCampaigns } from "@/hooks/use-dashboard-campaigns";
import type { DashboardAPIFilters } from "@/lib/api/dashboard";
import { DashboardChartError } from "@/components/features/dashboard/DashboardChartError";
import { campaignBarHeight, campaignChartRows } from "@/components/features/dashboard/campaign-chart-model";

type CampaignLeadsChartProps = {
  filters: DashboardAPIFilters;
  filtersReady: boolean;
};

function CampaignChartSkeleton() {
  return (
    <div aria-label="Carregando leads por campanha" className="space-y-2 py-1">
      {[76, 58, 87, 42].map((width, index) => (
        <div key={index} className="grid h-[52px] grid-cols-[minmax(96px,24%)_minmax(0,1fr)_auto] items-center gap-3 sm:grid-cols-[minmax(160px,28%)_minmax(0,1fr)_auto]">
          <Skeleton className="h-3 w-4/5" />
          <Skeleton className="h-6 rounded-[6px]" style={{ width: `${width}%` }} />
          <Skeleton className="h-3 w-7" />
        </div>
      ))}
    </div>
  );
}

export function CampaignLeadsChart({ filters, filtersReady }: CampaignLeadsChartProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const [nearViewport, setNearViewport] = useState(false);
  const [expandedCampaignKey, setExpandedCampaignKey] = useState<string | null>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    if (typeof IntersectionObserver === "undefined") {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setNearViewport(true);
      });
      return () => { cancelled = true; };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setNearViewport(true);
        observer.disconnect();
      }
    }, { rootMargin: "320px 0px" });
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  const { data, isPending, isError, refetch } = useDashboardCampaigns(filters, {
    enabled: filtersReady && nearViewport,
  });
  const rows = useMemo(() => campaignChartRows(data?.campaigns ?? []), [data?.campaigns]);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((campaign) => counts.set(campaign.name, (counts.get(campaign.name) ?? 0) + 1));
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [rows]);
  const barHeight = campaignBarHeight(rows.length);
  const loading = !data && (!filtersReady || !nearViewport || isPending);
  const unattributed = data?.unattributed.leadCount ?? 0;

  return (
    <section ref={sectionRef} aria-labelledby="dashboard-campaigns-title" className="h-full min-w-0">
      <Card className="h-full min-w-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-4 pb-2 pt-4">
          <div className="flex items-center justify-between gap-3">
            <CardTitle id="dashboard-campaigns-title" className="flex min-w-0 items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="truncate">Leads por campanha</span>
            </CardTitle>
            {data ? (
              <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">
                {rows.length} {rows.length === 1 ? "campanha" : "campanhas"}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 pt-2">
          {isError && !data ? (
            <DashboardChartError message="Não foi possível carregar os leads por campanha." onRetry={() => void refetch()} />
          ) : loading ? (
            <CampaignChartSkeleton />
          ) : rows.length === 0 ? (
            <p className="py-8 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
              Nenhuma campanha com leads para os filtros selecionados.
            </p>
          ) : (
            <div
              role="region"
              aria-label="Leads por campanha, lista rolável"
              tabIndex={rows.length > 8 ? 0 : undefined}
              className="app-scrollbar max-h-[448px] overflow-y-auto overscroll-contain rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <div role="list" className="space-y-1 pr-4 sm:pr-5">
                {rows.map((campaign, index) => {
                  const rowKey = `${campaign.key}:${index}`;
                  const expanded = expandedCampaignKey === rowKey;
                  return (
                  <div
                    key={rowKey}
                    role="listitem"
                    aria-label={`${campaign.name}${duplicateNames.has(campaign.name) ? `, ID ${campaign.campaignId ?? campaign.key}` : ""}: ${campaign.leadCount} ${campaign.leadCount === 1 ? "lead" : "leads"}`}
                    className={`grid grid-cols-[minmax(96px,24%)_minmax(0,1fr)_auto] gap-3 border-b border-[var(--app-border)] last:border-b-0 sm:grid-cols-[minmax(160px,28%)_minmax(0,1fr)_auto] ${expanded ? "min-h-[52px] items-start py-2" : "h-[52px] items-center"}`}
                    style={rows.length > 40 && !expanded ? { contentVisibility: "auto", containIntrinsicSize: "52px" } : undefined}
                  >
                    <button
                      type="button"
                      title="Ver nome completo da campanha"
                      aria-label={`Ver campanha ${campaign.name}${duplicateNames.has(campaign.name) ? `, ID ${campaign.campaignId ?? campaign.key}` : ""}`}
                      aria-pressed={expanded}
                      onClick={() => setExpandedCampaignKey((current) => current === rowKey ? null : rowKey)}
                      className="min-w-0 text-left text-[11px] font-light leading-[14px] text-[var(--app-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:text-[12px]"
                    >
                      <span className={expanded ? "block break-all" : "line-clamp-2 break-all"}>{campaign.name}</span>
                      {duplicateNames.has(campaign.name) ? (
                        <span className={`block text-[10px] text-[var(--app-text-tertiary)] ${expanded ? "break-all" : "truncate"}`}>
                          ID {expanded
                            ? campaign.campaignId ?? campaign.key
                            : campaign.campaignId ? `…${campaign.campaignId.slice(-8)}` : campaign.key.slice(-8)}
                        </span>
                      ) : null}
                    </button>
                    <span className="block min-w-0 rounded-[6px] bg-[var(--app-surface-soft)]" style={{ height: barHeight, marginTop: expanded ? 4 : undefined }} aria-hidden="true">
                      <span
                        className="block rounded-[6px] bg-primary"
                        style={{
                          height: barHeight,
                          width: `${campaign.barPercent}%`,
                          minWidth: campaign.leadCount > 0 ? 6 : undefined,
                        }}
                      />
                    </span>
                    <span className="min-w-[44px] justify-self-end rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-center text-[11px] font-medium tabular-nums text-[var(--app-text-primary)] sm:text-[12px]">
                      {campaign.leadCount.toLocaleString("pt-BR")}
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>
          )}
          {data && unattributed > 0 ? (
            <p className="mt-3 text-[11px] font-light text-[var(--app-text-secondary)]">
              Sem campanha: <span className="font-medium tabular-nums text-[var(--app-text-primary)]">{unattributed.toLocaleString("pt-BR")} {unattributed === 1 ? "lead" : "leads"}</span>
            </p>
          ) : null}
          {data && rows.length > 0 ? (
            <p className="mt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
              Um lead pode aparecer em campanhas diferentes quando há reentrada.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
