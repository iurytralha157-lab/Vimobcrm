import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  BarChart3,
  Building2,
  FileText,
  LayoutDashboard,
  RefreshCw,
  Route,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useSiteDashboardUrl } from "@/hooks/site";
import { DatePreset, getDateRangeFromPreset } from "@/hooks/use-dashboard-filters";
import { siteAnalyticsRangeQuery, useLeadAnalytics } from "@/hooks/use-lead-analytics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSiteAnalytics, useSiteAnalyticsDetailed } from "@/hooks/use-site-analytics";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { describeSiteAnalyticsFreshness, getSiteAnalyticsFreshness } from "@/lib/site/analytics-freshness";
import { cn } from "@/lib/utils";
import { DomainValidationError } from "@/lib/validation";

import { SiteJourneysTab } from "./dashboard/SiteJourneysTab";
import { SiteOriginsTab } from "./dashboard/SiteOriginsTab";
import { SiteOverviewTab } from "./dashboard/SiteOverviewTab";
import { SitePagesTab } from "./dashboard/SitePagesTab";
import { SitePropertiesTab } from "./dashboard/SitePropertiesTab";
import { formatCollectedAgo, type SiteDashboardData } from "./dashboard/site-dashboard-format";
import { SITE_TABS, type SiteTab, type SiteTabHrefs } from "./dashboard/site-dashboard-tabs";

const TAB_ICONS: Record<SiteTab, LucideIcon> = {
  overview: LayoutDashboard,
  pages: FileText,
  properties: Building2,
  origins: Share2,
  journeys: Route,
};

const FRESHNESS_DOT = {
  fresh: "bg-emerald-500",
  delayed: "bg-amber-500",
  stale: "bg-amber-500",
  unavailable: "bg-[var(--app-text-tertiary)]",
};

function getSiteAnalyticsErrorDescription(error: unknown) {
  if (
    (error instanceof DomainValidationError && error.direction === "input") ||
    (error instanceof VimobAPIError && error.code === "invalid_analytics_filters")
  ) {
    return "O período selecionado não é válido. Escolha datas entre o mesmo dia e 366 dias.";
  }
  if (error instanceof DomainValidationError && error.direction === "response") {
    return "A API respondeu em um formato incompatível. Nenhuma métrica foi estimada.";
  }
  return error instanceof Error ? error.message : "Não foi possível carregar os dados do site agora.";
}

function SiteDashboardSkeleton() {
  return (
    <div className="space-y-3" aria-label="Carregando dados do site">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[1, 2, 3, 4].map((item) => (
          <Skeleton key={item} className="h-[108px] rounded-[12px] bg-[var(--app-surface-solid)]" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-[12px] bg-[var(--app-surface-solid)]" />
    </div>
  );
}

function SiteTabContent({
  activeTab,
  tabHrefs,
  data,
  journeyQuery,
}: {
  activeTab: SiteTab;
  tabHrefs: SiteTabHrefs;
  data: SiteDashboardData;
  journeyQuery: ReturnType<typeof useLeadAnalytics>;
}) {
  switch (activeTab) {
    case "pages":
      return <SitePagesTab data={data} />;
    case "properties":
      return <SitePropertiesTab data={data} />;
    case "origins":
      return <SiteOriginsTab data={data} journeyQuery={journeyQuery} />;
    case "journeys":
      return <SiteJourneysTab data={data} journeyQuery={journeyQuery} />;
    default:
      return <SiteOverviewTab data={data} tabHrefs={tabHrefs} />;
  }
}

export function SiteAnalyticsTab({ activeTab, tabHrefs }: { activeTab: SiteTab; tabHrefs: SiteTabHrefs }) {
  const [datePreset, setDatePreset] = useState<DatePreset>("last30days");
  const [, refreshRelativeDates] = useState(0);
  const [customDateRange, setCustomDateRange] = useState<{ from: Date; to: Date } | null>(null);
  const siteBaseUrl = useSiteDashboardUrl();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (datePreset === "custom") return;

    let timeout: number;
    const scheduleNextDay = () => {
      const now = new Date();
      const nextDay = new Date(now);
      nextDay.setHours(24, 0, 1, 0);
      timeout = window.setTimeout(
        () => {
          refreshRelativeDates((version) => version + 1);
          scheduleNextDay();
        },
        Math.max(1_000, nextDay.getTime() - now.getTime()),
      );
    };

    scheduleNextDay();
    return () => window.clearTimeout(timeout);
  }, [datePreset]);

  const range =
    datePreset === "custom" && customDateRange ? customDateRange : getDateRangeFromPreset(datePreset);
  const summaryQuery = useSiteAnalytics(range.from, range.to);
  const detailedQuery = useSiteAnalyticsDetailed(range.from, range.to);
  const journeyQuery = useLeadAnalytics(range.from, range.to);
  const summary = summaryQuery.data;
  const detailed = detailedQuery.data;
  const query = siteAnalyticsRangeQuery(range.from, range.to);

  const blockingError = !summary || !detailed ? summaryQuery.error || detailedQuery.error : null;
  const hasStaleError = Boolean(summary && detailed) && (summaryQuery.isError || detailedQuery.isError);
  const isRefetching = summaryQuery.isFetching || detailedQuery.isFetching || journeyQuery.isFetching;
  const handleRetry = () => {
    void summaryQuery.refetch();
    void detailedQuery.refetch();
    void journeyQuery.refetch();
  };

  const freshness = getSiteAnalyticsFreshness(summary?.lastCollectedAt);
  const hasData = Boolean(
    summary &&
      detailed &&
      (summary.uniqueSessions > 0 ||
        summary.totalPages > 0 ||
        detailed.totalSessions > 0 ||
        detailed.siteLeads > 0 ||
        detailed.liveVisitors > 0 ||
        detailed.dailyViews.length > 0),
  );
  const data: SiteDashboardData | null =
    summary && detailed && query.dateFrom && query.dateTo
      ? {
          summary,
          detailed,
          insights: detailed.insights,
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          siteBaseUrl,
        }
      : null;

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-row items-center gap-2">
        <div className="app-responsive-tab-list min-w-0 flex-1">
          <nav
            aria-label="Seções de análise do site"
            data-responsive-tab-scroll
            className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex min-w-max gap-1">
              {SITE_TABS.map((tab) => {
                const Icon = TAB_ICONS[tab.key];
                const isActive = tab.key === activeTab;
                return (
                  <Link
                    key={tab.key}
                    href={tabHrefs[tab.key]}
                    scroll={false}
                    aria-current={isActive ? "page" : undefined}
                    aria-label={tab.label}
                    data-responsive-tab
                    title={tab.description}
                    className={cn(
                      "mx-0 inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:text-[12px]",
                      isActive &&
                        "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-solid)] hover:text-[var(--app-text-primary)]",
                    )}
                  >
                    <Icon className="h-3 w-3" aria-hidden="true" />
                    <span className="app-responsive-tab-label">{tab.label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>
        </div>

        {summary ? (
          <span
            role="status"
            title={describeSiteAnalyticsFreshness(freshness)}
            className="hidden shrink-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)] md:inline-flex"
          >
            <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", FRESHNESS_DOT[freshness.status])} />
            {formatCollectedAgo(summary.lastCollectedAt) ?? "Nenhuma coleta registrada"}
          </span>
        ) : null}

        {data && isRefetching && !hasStaleError ? (
          <span
            role="status"
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light text-[var(--app-text-tertiary)]"
          >
            <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            <span className="hidden sm:inline">Atualizando</span>
            <span className="sr-only sm:hidden">Atualizando dados do site</span>
          </span>
        ) : null}

        <DateFilterPopover
          datePreset={datePreset}
          onDatePresetChange={(preset) => setDatePreset(preset || "last30days")}
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          defaultPreset="last30days"
          align="end"
          triggerDataTour="site-dashboard-date-filter"
          triggerClassName="h-8 w-auto shrink-0 justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/25 focus-visible:ring-offset-0 sm:text-[12px]"
          iconOnly={isMobile}
        />
      </div>

      {freshness.status === "delayed" || freshness.status === "stale" ? (
        <p role="status" className="rounded-[8px] bg-amber-500/[0.08] px-3.5 py-2.5 text-[11px] font-light text-[var(--app-text-secondary)]">
          {describeSiteAnalyticsFreshness(freshness)}. Confira se o site publicado segue com a coleta do Vimob ativa.
        </p>
      ) : null}

      {hasStaleError ? (
        <div role="status" className="flex flex-col gap-3 rounded-[8px] bg-amber-500/[0.08] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            Os últimos dados válidos continuam visíveis, mas a atualização falhou.
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-xs shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={handleRetry}
            disabled={isRefetching}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", isRefetching && "animate-spin")} aria-hidden="true" />
            {isRefetching ? "Atualizando" : "Tentar novamente"}
          </Button>
        </div>
      ) : null}

      {data && !data.insights ? (
        <p role="status" className="rounded-[8px] bg-[var(--app-surface-soft)] px-3.5 py-2.5 text-[11px] font-light text-[var(--app-text-secondary)]">
          O detalhamento por página, imóvel e origem está indisponível agora. Os totais continuam válidos e nada foi estimado.
        </p>
      ) : null}

      {blockingError ? (
        <div role="alert" className="flex min-h-[240px] flex-col items-center justify-center rounded-[12px] bg-[var(--app-surface-solid)] p-6 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-red-500/[0.08] text-red-500">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="mt-3 text-sm font-normal text-[var(--app-text-primary)]">Não foi possível carregar o dashboard do site</p>
          <p className="mt-1 max-w-lg text-xs font-light leading-5 text-[var(--app-text-tertiary)]">
            {getSiteAnalyticsErrorDescription(blockingError)}
          </p>
          <Button
            type="button"
            size="sm"
            onClick={handleRetry}
            disabled={isRefetching}
            className="mt-4 h-9 rounded-[6px] px-4 text-xs shadow-none"
          >
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isRefetching && "animate-spin")} aria-hidden="true" />
            {isRefetching ? "Carregando" : "Tentar novamente"}
          </Button>
        </div>
      ) : !data ? (
        <SiteDashboardSkeleton />
      ) : !hasData ? (
        <div className="rounded-[12px] bg-[var(--app-surface-solid)] p-6 text-center">
          <BarChart3 className="mx-auto mb-3 h-10 w-10 text-[var(--app-text-tertiary)]" aria-hidden="true" />
          <p className="mb-1 text-sm font-normal text-[var(--app-text-primary)]">
            {data.summary.lastCollectedAt ? "Sem dados no período selecionado" : "Nenhuma coleta registrada"}
          </p>
          <p className="text-xs font-light leading-5 text-[var(--app-text-tertiary)]">
            {data.summary.lastCollectedAt
              ? "Existem eventos no histórico deste site. Amplie ou altere o período para consultar a atividade já coletada."
              : "O dashboard ainda não recebeu eventos reais. Verifique se o site publicado está com a coleta do Vimob configurada."}
          </p>
        </div>
      ) : (
        <SiteTabContent activeTab={activeTab} tabHrefs={tabHrefs} data={data} journeyQuery={journeyQuery} />
      )}
    </div>
  );
}
