"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Megaphone, Search } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDashboardCampaigns } from "@/hooks/use-dashboard-campaigns";
import { getDashboardFiltersQueryKey, type DashboardAPIFilters } from "@/lib/api/dashboard";
import { DashboardChartError } from "@/components/features/dashboard/DashboardChartError";
import { campaignBarHeight, campaignChartPage, campaignChartRows, campaignChartSearchRows } from "@/components/features/dashboard/campaign-chart-model";
import { getDashboardStatsErrorDescription, getDashboardStatsFailureState } from "@/components/features/dashboard/dashboard-stats-error";

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
  const filterScope = JSON.stringify(getDashboardFiltersQueryKey(filters));
  const [view, setView] = useState({ scope: filterScope, search: "", page: 1 });
  const search = view.scope === filterScope ? view.search : "";
  const deferredSearch = useDeferredValue(search);
  const activeSearch = view.scope === filterScope ? deferredSearch : "";

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

  const { data, isPending, isError, isAccessBlocked, error, refetch } = useDashboardCampaigns(filters, {
    enabled: filtersReady && nearViewport,
  });
  const failureState = isAccessBlocked ? "unavailable" : getDashboardStatsFailureState(data !== undefined, isError, error);
  const visibleData = failureState === "unavailable" ? undefined : data;
  const rows = useMemo(() => campaignChartRows(visibleData?.campaigns ?? []), [visibleData?.campaigns]);
  const filteredRows = useMemo(() => campaignChartSearchRows(rows, activeSearch), [rows, activeSearch]);
  const page = campaignChartPage(filteredRows, view.scope === filterScope ? view.page : 1);
  const duplicateNames = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((campaign) => counts.set(campaign.name, (counts.get(campaign.name) ?? 0) + 1));
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
  }, [rows]);
  const barHeight = campaignBarHeight(rows.length);
  const loading = !visibleData && (!filtersReady || !nearViewport || isPending);
  const unattributed = visibleData?.unattributed.leadCount ?? 0;

  return (
    <section ref={sectionRef} aria-labelledby="dashboard-campaigns-title" className="h-full min-w-0">
      <Card className="h-full min-w-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardHeader className="px-3 pb-2 pt-3">
          <div className="flex items-center justify-between gap-3">
            <CardTitle id="dashboard-campaigns-title" className="flex min-w-0 items-center gap-2 text-[13px] font-light text-[var(--app-text-primary)]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="truncate">Leads por campanha</span>
            </CardTitle>
            {visibleData ? (
              <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">
                {rows.length.toLocaleString("pt-BR")} {rows.length === 1 ? "campanha" : "campanhas"}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-1">
          {failureState === "stale" ? <p role="status" className="mb-2 text-[11px] text-[var(--app-text-secondary)]">Não foi possível atualizar. Exibindo a última consulta. <button type="button" className="text-primary underline" onClick={() => void refetch()}>Tentar novamente</button></p> : null}
          {visibleData && rows.length > 25 ? (
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2 top-2 h-3.5 w-3.5 text-[var(--app-text-tertiary)]" aria-hidden="true" />
              <Input aria-label="Buscar campanha pelo nome ou ID" placeholder="Buscar campanha" value={search} maxLength={180} onChange={(event) => setView({ scope: filterScope, search: event.target.value, page: 1 })} className="h-8 pl-7 text-[11px]" />
            </div>
          ) : null}
          {failureState === "unavailable" ? (
            <DashboardChartError message={getDashboardStatsErrorDescription(error)} onRetry={() => void refetch()} />
          ) : loading ? (
            <CampaignChartSkeleton />
          ) : filteredRows.length === 0 ? (
            <p className="py-8 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
              {rows.length > 0 ? "Nenhuma campanha encontrada nessa busca." : "Nenhuma campanha com leads para os filtros selecionados."}
            </p>
          ) : (
            <div
              role="region"
              aria-label="Leads por campanha, lista rolável"
              tabIndex={page.items.length > 7 ? 0 : undefined}
              className="app-scrollbar max-h-[330px] overflow-y-auto overscroll-contain rounded-[6px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
            >
              <div role="list" className="space-y-1 pr-4 sm:pr-5">
                {page.items.map((campaign) => {
                  const rowKey = campaign.key;
                  const expanded = expandedCampaignKey === rowKey;
                  return (
                  <div
                    key={rowKey}
                    role="listitem"
                    aria-label={`${campaign.name}${duplicateNames.has(campaign.name) ? `, ID ${campaign.campaignId ?? campaign.key}` : ""}: ${campaign.leadCount} ${campaign.leadCount === 1 ? "lead" : "leads"}`}
                    className={`grid grid-cols-[minmax(80px,26%)_minmax(0,1fr)_auto] gap-2 border-b border-[var(--app-border)] last:border-b-0 sm:grid-cols-[minmax(120px,30%)_minmax(0,1fr)_auto] ${expanded ? "min-h-[44px] items-start py-2" : "h-[44px] items-center"}`}
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
          {visibleData && filteredRows.length > 0 && page.pageCount > 1 ? (
            <div className="mt-2 flex items-center justify-between gap-2 text-[10px] text-[var(--app-text-secondary)]">
              <span role="status">{page.start}–{page.end} de {page.total.toLocaleString("pt-BR")}</span>
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Campanhas anteriores" disabled={page.page === 1} onClick={() => setView({ scope: filterScope, search, page: page.page - 1 })}><ChevronLeft className="h-3.5 w-3.5" /></Button>
                <span>{page.page}/{page.pageCount}</span>
                <Button type="button" variant="ghost" size="icon" className="h-7 w-7" aria-label="Próximas campanhas" disabled={page.page === page.pageCount} onClick={() => setView({ scope: filterScope, search, page: page.page + 1 })}><ChevronRight className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          ) : null}
          {visibleData && unattributed > 0 ? (
            <p className="mt-3 text-[11px] font-light text-[var(--app-text-secondary)]">
              Sem campanha: <span className="font-medium tabular-nums text-[var(--app-text-primary)]">{unattributed.toLocaleString("pt-BR")} {unattributed === 1 ? "lead" : "leads"}</span>
            </p>
          ) : null}
          {visibleData && rows.length > 0 ? (
            <p className="mt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
              Um lead pode aparecer em campanhas diferentes quando há reentrada.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}
