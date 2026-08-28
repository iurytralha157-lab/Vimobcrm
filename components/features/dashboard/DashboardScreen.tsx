"use client";

import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import {
  type LucideIcon,
  Users,
  DollarSign,
  Building2,
  Clock,
  Eye,
  TrendingUp,
  TrendingDown,
  CalendarCheck,
  CircleDot,
  XCircle,
  Trophy,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

import { performanceTracker } from "@/lib/performance";
import { cn } from "@/lib/utils";

// Componentes de Layout e UI
import { AppLayout } from "@/components/shared/layout/AppLayout";

import { KPICards } from "@/components/features/dashboard/KPICards";
import {
  getDashboardKPIValueStyle,
  type DashboardKPIAccent,
} from "@/components/features/dashboard/dashboard-kpi-theme";
import { SalesFunnelWithPipeline } from "@/components/features/dashboard/SalesFunnelWithPipeline";
import { DealsEvolutionChart } from "@/components/features/dashboard/DealsEvolutionChart";
import { LeadSourcesChart } from "@/components/features/dashboard/LeadSourcesChart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// Hooks e Contextos
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { useFilterOptionsPipelineId } from "@/hooks/use-filter-options-pipeline-id";
import {
  type EnhancedDashboardStats,
  useEnhancedDashboardStats,
  useDealsEvolutionData,
  useLeadSourcesData,
  useDashboardQueryScope,
} from "@/hooks/use-dashboard-stats";
import { useIsMobile } from "@/hooks/use-mobile";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { datePresetOptions, sourceLabels } from "@/hooks/use-dashboard-filters";
import {
  getDashboardExtraCounts,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";
import { DASHBOARD_CHART_COLORS } from "@/config/dashboard-chart-colors";

const DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS = 1000 * 60 * 10;
const DASHBOARD_DESKTOP_BREAKPOINT_PX = 1024;
const DIALOG_CHART_INITIAL_DIMENSION = { width: 180, height: 180 };

type KPIFormat = "number" | "currency" | "percent" | "time";

type KPIRateVariant = "negative" | "auto";

type DashboardKPI = {
  title: string;
  value: string | number;
  rate?: number;
  rateLabel?: string;
  rateVariant?: KPIRateVariant;
  trend?: number;
  icon: LucideIcon;
  tooltip: string;
  format: KPIFormat;
  color: DashboardKPIAccent;
  iconColor?: string;
  iconBgColor?: string;
  hideIconOnDesktop?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  compact?: boolean;
  tourTarget: string;
};

function useIsDashboardDesktop() {
  const [isDashboardDesktop, setIsDashboardDesktop] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${DASHBOARD_DESKTOP_BREAKPOINT_PX}px)`,
    );
    const syncDashboardLayout = () => setIsDashboardDesktop(mediaQuery.matches);

    syncDashboardLayout();
    mediaQuery.addEventListener("change", syncDashboardLayout);

    return () => mediaQuery.removeEventListener("change", syncDashboardLayout);
  }, []);

  return isDashboardDesktop;
}

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================
export default function Dashboard() {
  const isMobile = useIsMobile();
  const isDashboardDesktop = useIsDashboardDesktop();
  const router = useRouter();
  const [mobileChartTab, setMobileChartTab] = useState("funnel");
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const dashboardQueryScope = useDashboardQueryScope();
  const activeOrganizationId = dashboardQueryScope.organizationId;
  const filterOptionsPipelineId = useFilterOptionsPipelineId();

  const {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    campaignId,
    setCampaignId,
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    tagId,
    setTagId,
    dealStatus,
    setDealStatus,
    searchQuery,
    setSearchQuery,
    clearFilters,
    hasActiveFilters,
    dynamicSources,
    campaigns,
    adSets,
    ads,
    tags,
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
  } = useSharedFilters({
    loadDynamicOptions: shouldLoadFilterOptions,
    pipelineId: filterOptionsPipelineId,
  });

  // Mapeamento de strings de data para chaves de cache estáveis
  const dateFromStr = filters.dateRange.from.toISOString();
  const dateToStr = filters.dateRange.to.toISOString();

  const dashboardFilters = useMemo<DashboardAPIFilters>(
    () => ({
      dateRange: filters.dateRange,
      teamId: filters.teamId,
      userId: filters.userId,
      source: filters.source,
      campaignId: filters.campaignId,
      adSetId: filters.adSetId,
      adId: filters.adId,
      tagId: filters.tagId,
      dealStatus: filters.dealStatus,
      searchQuery: filters.searchQuery,
    }),
    [filters],
  );

  // Data hooks - Imobiliário
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    refetch: refetchStats,
  } = useEnhancedDashboardStats(dashboardFilters);
  const { data: evolutionData = [], isLoading: evolutionLoading } =
    useDealsEvolutionData(dashboardFilters);
  const { data: sourcesData = [], isLoading: sourcesLoading } =
    useLeadSourcesData(dashboardFilters);
  const hasOrganization = Boolean(activeOrganizationId);

  const {
    data: extraCounts,
    isLoading: extraCountsLoading,
    isError: extraCountsError,
    refetch: refetchExtraCounts,
  } = useQuery({
    queryKey: [
      "dashboard-extra-counts",
      activeOrganizationId,
      dashboardQueryScope.currentUserId,
      dashboardQueryScope.accessSignature,
      dateFromStr,
      dateToStr,
      filters.userId,
      filters.teamId,
      filters.source,
      filters.campaignId,
      filters.adSetId,
      filters.adId,
      filters.tagId,
      filters.dealStatus,
      filters.searchQuery,
    ],
    queryFn: ({ signal }) =>
      getDashboardExtraCounts({
        organizationId: activeOrganizationId,
        filters: dashboardFilters,
        signal,
      }),
    enabled: dashboardQueryScope.isReady,
    staleTime: DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS,
  });

  const propertyCount = extraCounts?.propertyCount ?? 0;
  const siteVisits = extraCounts?.siteVisits ?? 0;
  const scheduledVisitsCount = extraCounts?.scheduledVisits ?? 0;
  const kpisLoading = !hasOrganization || statsLoading || extraCountsLoading;
  const kpisError = statsError || extraCountsError;
  const evolutionDataLoading = !hasOrganization || evolutionLoading;
  const sourcesDataLoading = !hasOrganization || sourcesLoading;

  useEffect(() => {
    if (hasOrganization && !statsLoading && !evolutionLoading) {
      performanceTracker.addMetric(
        "Dashboard Full Load",
        performance.now(),
        "ms",
      );
    }
  }, [hasOrganization, statsLoading, evolutionLoading]);

  const funnelComponent = (
    <SalesFunnelWithPipeline filters={dashboardFilters} />
  );
  const periodLabel =
    datePresetOptions.find((o) => o.value === datePreset)?.label ||
    "Período selecionado";

  const retryKpis = () => {
    void refetchStats();
    void refetchExtraCounts();
  };

  const kpiData: EnhancedDashboardStats = stats || {
    totalLeads: 0,
    leadsInProgress: 0,
    leadsClosed: 0,
    leadsLost: 0,
    openLeads: 0,
    lostLeads: 0,
    conversionRate: 0,
    closedLeads: 0,
    wonAverageConversionDays: null,
    wonConversionBuckets: [],
    wonDeals: [],
    lostReasonBuckets: [],
    lostDeals: [],
    avgResponseTime: "--",
    totalSalesValue: 0,
    pendingCommissions: 0,
    leadsTrend: 0,
    openTrend: 0,
    lostTrend: 0,
    conversionTrend: 0,
    closedTrend: 0,
    totalReceivables: 0,
    totalPayables: 0,
    overdueReceivables: 0,
    overduePayables: 0,
    paidCommissions: 0,
  };

  return (
    <AppLayout title="Dashboard" disableMainScroll={true} borderless>
      <div
        className={cn(
          "dashboard-borderless flex h-full w-full animate-fade-in flex-col gap-3 overflow-hidden pb-1",
          !isMobile ? "flex-1 min-h-0" : "",
        )}
      >
        <div
          className="flex shrink-0 justify-end"
          data-tour="dashboard-filters"
        >
          <SharedFilters
            datePreset={datePreset}
            onDatePresetChange={setDatePreset}
            customDateRange={customDateRange}
            onCustomDateRangeChange={setCustomDateRange}
            teamId={teamId}
            onTeamChange={setTeamId}
            userId={userId}
            onUserChange={setUserId}
            source={source}
            onSourceChange={setSource}
            campaignId={campaignId}
            onCampaignChange={setCampaignId}
            adSetId={adSetId}
            onAdSetChange={setAdSetId}
            adId={adId}
            onAdChange={setAdId}
            tagId={tagId}
            onTagChange={setTagId}
            dealStatus={dealStatus}
            onDealStatusChange={setDealStatus}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
            hideSearch
            dynamicSources={dynamicSources}
            campaigns={campaigns}
            adSets={adSets}
            ads={ads}
            tags={tags}
            isLoadingSources={isLoadingSources}
            isLoadingCampaigns={isLoadingCampaigns}
            isLoadingAdSets={isLoadingAdSets}
            isLoadingAds={isLoadingAds}
            loadDynamicOptions={shouldLoadFilterOptions}
            onFiltersOpenChange={(open) => {
              if (open) setShouldLoadFilterOptions(true);
            }}
            tourPrefix="dashboard"
          />
        </div>

        {isDashboardDesktop === null ? (
          <div className="min-h-[420px] flex-1 rounded-[8px] bg-[var(--app-surface-soft)]" />
        ) : isDashboardDesktop ? (
          <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 overflow-hidden">
            <div className="col-span-8 flex min-h-0 flex-col gap-3">
              <div className="shrink-0">
                {kpisError ? (
                  <DashboardDataError onRetry={retryKpis} />
                ) : (
                  <KPICardsGrid
                    data={kpiData}
                    isLoading={kpisLoading}
                    periodLabel={periodLabel}
                    propertyCount={propertyCount}
                    siteVisits={siteVisits}
                    scheduledVisits={scheduledVisitsCount}
                    layout="top"
                    onLostClick={() => setLostDialogOpen(true)}
                    onWonClick={() => setWonDialogOpen(true)}
                  />
                )}
              </div>

              <div data-tour="dashboard-evolution" className="min-h-0 flex-1">
                <DealsEvolutionChart
                  data={evolutionData}
                  isLoading={evolutionDataLoading}
                />
              </div>
            </div>

            <div className="col-span-4 flex min-h-0 flex-col gap-3">
              <div data-tour="dashboard-funnel" className="h-[48%] min-h-0">
                {funnelComponent}
              </div>
              <div data-tour="dashboard-sources" className="h-[52%] min-h-0">
                <LeadSourcesChart
                  data={sourcesData}
                  isLoading={sourcesDataLoading}
                  selectedSource={source}
                  onSourceChange={setSource}
                />
              </div>
            </div>
          </div>
        ) : (
          <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto pb-5">
            <section>
              {kpisError ? (
                <DashboardDataError onRetry={retryKpis} />
              ) : (
                <KPICards
                  data={kpiData}
                  isLoading={kpisLoading}
                  periodLabel={periodLabel}
                  scheduledVisits={scheduledVisitsCount}
                  propertyCount={propertyCount}
                  siteVisits={siteVisits}
                  onLostClick={() => setLostDialogOpen(true)}
                  onWonClick={() => setWonDialogOpen(true)}
                />
              )}
            </section>

            <section>
              <Tabs value={mobileChartTab} onValueChange={setMobileChartTab}>
                <TabsList className="grid h-10 w-full grid-cols-3 gap-1 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
                  <TabsTrigger
                    value="funnel"
                    className="mx-0 h-8 rounded-[6px] text-[11px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
                  >
                    Funil
                  </TabsTrigger>
                  <TabsTrigger
                    value="evolution"
                    className="mx-0 h-8 rounded-[6px] text-[11px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
                  >
                    Evolução
                  </TabsTrigger>
                  <TabsTrigger
                    value="sources"
                    className="mx-0 h-8 rounded-[6px] text-[11px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
                  >
                    Origem
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="funnel" className="mt-3">
                  <div data-tour="dashboard-funnel" className="h-[390px]">
                    {funnelComponent}
                  </div>
                </TabsContent>
                <TabsContent value="evolution" className="mt-3">
                  <div data-tour="dashboard-evolution" className="h-[390px]">
                    <DealsEvolutionChart
                      data={evolutionData}
                      isLoading={evolutionDataLoading}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="sources" className="mt-3">
                  <div data-tour="dashboard-sources" className="h-[430px]">
                    <LeadSourcesChart
                      data={sourcesData}
                      isLoading={sourcesDataLoading}
                      selectedSource={source}
                      onSourceChange={setSource}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </section>
          </div>
        )}
      </div>

      <LostDealsDialog
        open={lostDialogOpen}
        onOpenChange={setLostDialogOpen}
        data={kpiData}
        periodLabel={periodLabel}
        onViewLead={(leadId) => {
          setLostDialogOpen(false);
          router.push(`/crm/pipelines?lead=${leadId}`);
        }}
      />

      <WonDealsDialog
        open={wonDialogOpen}
        onOpenChange={setWonDialogOpen}
        data={kpiData}
        periodLabel={periodLabel}
        onViewLead={(leadId) => {
          setWonDialogOpen(false);
          router.push(`/crm/pipelines?lead=${leadId}`);
        }}
      />
    </AppLayout>
  );
}

// ==========================================
// HELPER FUNCTIONS & SUB-COMPONENTS
// ==========================================
function formatKPIValue(value: string | number, format: KPIFormat): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "standard",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    default:
      return value.toLocaleString("pt-BR");
  }
}

function DashboardDataError({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardContent className="flex min-h-[96px] flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
            <XCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
              Não foi possível carregar os dados.
            </p>
            <p className="mt-0.5 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              Tente novamente para atualizar os indicadores.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="h-8 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          Tentar novamente
        </button>
      </CardContent>
    </Card>
  );
}

interface KPICardsGridProps {
  data: EnhancedDashboardStats;
  isLoading?: boolean;
  periodLabel: string;
  propertyCount?: number;
  siteVisits?: number;
  scheduledVisits?: number;
  layout?: "top" | "side";
  onLostClick?: () => void;
  onWonClick?: () => void;
}

function KPICardsGrid({
  data,
  isLoading,
  periodLabel,
  propertyCount,
  siteVisits,
  scheduledVisits,
  layout = "top",
  onLostClick,
  onWonClick,
}: KPICardsGridProps) {
  if (isLoading) {
    const isSide = layout === "side";
    const skeletonTours = [
      "dashboard-kpi-leads",
      "dashboard-kpi-open",
      "dashboard-kpi-lost",
      "dashboard-kpi-won",
      "dashboard-kpi-visits",
      "dashboard-kpi-vgv",
      "dashboard-kpi-first-contact",
      "dashboard-kpi-properties",
      "dashboard-kpi-site-visits",
    ];

    return (
      <div className={cn("grid gap-2", isSide ? "grid-cols-2" : "grid-cols-5")}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Card
            key={`skeleton-${i}`}
            data-tour={skeletonTours[i]}
            className={cn(
              "rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none",
              i === 5 && !isSide ? "col-span-2" : "",
            )}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-8 w-8 rounded-[6px]" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const allKpis: DashboardKPI[] = [
    {
      title: "Leads",
      value: data.totalLeads,
      icon: Users,
      tooltip: `Total de leads - ${periodLabel}`,
      format: "number",
      color: "leads",
      tourTarget: "dashboard-kpi-leads",
    },
    {
      title: "Em aberto",
      value: data.openLeads ?? 0,
      rate:
        data.totalLeads > 0
          ? ((data.openLeads ?? 0) / data.totalLeads) * 100
          : 0,
      icon: CircleDot,
      tooltip: `Percentual de leads em aberto dentro do total do período - ${periodLabel}`,
      format: "number",
      color: "open",
      tourTarget: "dashboard-kpi-open",
    },
    {
      title: "Perdidos",
      value: data.lostLeads ?? 0,
      rate:
        data.totalLeads > 0
          ? ((data.lostLeads ?? 0) / data.totalLeads) * 100
          : 0,
      rateVariant: "negative",
      icon: XCircle,
      tooltip: `Percentual de leads perdidos dentro do total do período - ${periodLabel}`,
      format: "number",
      color: "lost",
      onClick: onLostClick,
      interactive: Boolean(onLostClick),
      tourTarget: "dashboard-kpi-lost",
    },
    {
      title: "Ganhos",
      value: data.closedLeads,
      rate: data.conversionRate,
      rateLabel: "conversão",
      rateVariant: "auto",
      icon: Trophy,
      tooltip: `Ganhos fechados no período, independente da data de entrada do lead - ${periodLabel}`,
      format: "number",
      color: "won",
      iconColor: "rgb(16, 185, 129)",
      iconBgColor: "rgba(16, 185, 129, 0.1)",
      onClick: onWonClick,
      interactive: true,
      tourTarget: "dashboard-kpi-won",
    },
    {
      title: "Visitas",
      value: scheduledVisits ?? 0,
      rate:
        data.totalLeads > 0
          ? ((scheduledVisits ?? 0) / data.totalLeads) * 100
          : 0,
      rateVariant: "auto",
      icon: CalendarCheck,
      tooltip: `Visitas e reuniões criadas no período em relação ao total de leads - ${periodLabel}`,
      format: "number",
      color: "visits",
      tourTarget: "dashboard-kpi-visits",
    },
    {
      title: "VGV",
      value: data.totalSalesValue,
      icon: DollarSign,
      tooltip: `Valor em vendas - ${periodLabel}`,
      format: "currency",
      color: "vgv",
      hideIconOnDesktop: true,
      compact: true,
      tourTarget: "dashboard-kpi-vgv",
    },
    {
      title: "1º Contato",
      value: data.avgResponseTime,
      icon: Clock,
      tooltip: "Tempo médio até a primeira ligação ou mensagem",
      format: "time",
      color: "response",
      compact: true,
      tourTarget: "dashboard-kpi-first-contact",
    },
    {
      title: "Imóveis",
      value: propertyCount ?? 0,
      icon: Building2,
      tooltip: "Total de imóveis cadastrados",
      format: "number",
      color: "properties",
      compact: true,
      tourTarget: "dashboard-kpi-properties",
    },
    {
      title: "Visitas no site",
      value: siteVisits ?? 0,
      icon: Eye,
      tooltip: `Visitas ao site no período - ${periodLabel}`,
      format: "number",
      color: "site",
      compact: true,
      tourTarget: "dashboard-kpi-site-visits",
    },
  ];

  const renderKPI = (kpi: DashboardKPI, className?: string) => {
    const Icon = kpi.icon;
    const hasTrend = kpi.trend !== undefined && kpi.trend !== 0;
    const isPositive = (kpi.trend ?? 0) >= 0;
    const isCurrency = kpi.format === "currency";
    const showIcon = !kpi.hideIconOnDesktop || isSide;
    const rateColorClass =
      kpi.rateVariant === "negative"
        ? "text-destructive"
        : kpi.rateVariant === "auto"
          ? (kpi.rate ?? 0) > 0
            ? "text-[var(--lead-status-won-fg)]"
            : "text-destructive"
          : "text-[var(--lead-status-won-fg)]";

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (!kpi.onClick) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        kpi.onClick();
      }
    };

    return (
      <div key={kpi.title} className={cn("h-full", className)}>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Card
                data-tour={kpi.tourTarget}
                className={cn(
                  "group h-full rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none transition-colors",
                  kpi.interactive
                    ? "cursor-pointer hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                    : "cursor-default",
                )}
                role={kpi.interactive ? "button" : undefined}
                tabIndex={kpi.interactive ? 0 : undefined}
                onClick={kpi.onClick}
                onKeyDown={handleKeyDown}
              >
                <CardContent
                  className={cn(
                    "relative h-full p-3 sm:p-4",
                    kpi.compact
                      ? "min-h-[78px] sm:min-h-[82px]"
                      : "min-h-[96px]",
                  )}
                >
                  <div className="min-w-0">
                    <p className="mb-1 truncate pr-9 text-[12px] font-light leading-tight text-[var(--app-text-tertiary)] sm:pr-11">
                      {kpi.title}
                    </p>
                    <p
                      className={cn(
                        "font-normal leading-tight text-[var(--app-text-primary)]",
                        isCurrency
                          ? "text-sm sm:text-lg xl:text-xl break-words"
                          : "text-lg sm:text-2xl truncate",
                      )}
                      style={getDashboardKPIValueStyle(kpi.color)}
                    >
                      {formatKPIValue(kpi.value, kpi.format)}
                    </p>
                    {hasTrend && (
                      <div className="flex items-center gap-0.5 mt-1">
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3 text-[var(--lead-status-won-fg)]" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-destructive" />
                        )}
                        <span
                          className={cn(
                            "text-[10px] font-light",
                            isPositive
                              ? "text-[var(--lead-status-won-fg)]"
                              : "text-destructive",
                          )}
                        >
                          {kpi.trend! > 0 ? "+" : ""}
                          {kpi.trend}%
                        </span>
                      </div>
                    )}
                    {kpi.rate !== undefined && (
                      <div
                        className={cn(
                          "mt-1 max-w-full whitespace-nowrap text-[10px] font-light leading-tight",
                          rateColorClass,
                        )}
                      >
                        {formatKPIValue(kpi.rate, "percent")}
                        {kpi.rateLabel ? ` ${kpi.rateLabel}` : ""}
                      </div>
                    )}
                    {showIcon && (
                      <div
                        className={cn(
                          "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground transition-colors sm:right-4 sm:top-4",
                          kpi.interactive && "group-hover:bg-primary",
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TooltipTrigger>
            <TooltipContent className="app-header-popover rounded-[8px] border-0 text-[var(--app-text-primary)]">
              <p className="text-[11px] font-light leading-snug">
                {kpi.tooltip}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    );
  };

  const isSide = layout === "side";

  return (
    <div className={cn("grid gap-2", isSide ? "grid-cols-2" : "grid-cols-5")}>
      {allKpis.map((kpi) => {
        const isVgv = kpi.title === "VGV";
        return renderKPI(kpi, isVgv && !isSide ? "col-span-2" : undefined);
      })}
    </div>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatConversionDays(days: number | null): string {
  if (days === null) return "--";
  if (days === 0) return "Mesmo dia";
  if (days === 1) return "1 dia";
  if (days < 30) return `${days} dias`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 mês" : `${months} meses`;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function DashboardAssigneeAvatar({ name }: { name?: string | null }) {
  const label = name?.trim() || "Sem responsável";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex w-9 justify-end md:w-[34px]" aria-label={label}>
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-primary/50 text-[9px] font-light text-primary-foreground ring-1 ring-primary/20">
              {name ? getInitials(name) : "--"}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type DistributionChartPoint = {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
};

type DistributionTooltipEntry = {
  value?: string | number;
  color?: string;
  fill?: string;
  payload?: Partial<DistributionChartPoint>;
};

function DistributionTooltip({
  active,
  payload,
  fallbackLabel,
}: {
  active?: boolean;
  payload?: DistributionTooltipEntry[];
  fallbackLabel: string;
}) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const point = entry.payload;
  const count = Number(entry.value || point?.count || 0);
  const leadLabel = count === 1 ? "lead" : "leads";

  return (
    <div className="min-w-[160px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-[var(--app-text-primary)] shadow-none">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-[4px] ring-2 ring-[var(--app-surface-solid)]"
          style={{ backgroundColor: point?.color || entry.color || entry.fill }}
        />
        <span className="truncate text-[11px] font-light text-[var(--app-text-secondary)]">
          {point?.label || fallbackLabel}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
          {count} {leadLabel}
        </span>
        <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-light tabular-nums text-[var(--app-text-primary)]">
          {formatKPIValue(point?.percentage || 0, "percent")}
        </span>
      </div>
    </div>
  );
}

function getSourceLabel(source: string | null | undefined): string {
  const normalizedSource = (source || "").trim();
  const labelKey = normalizedSource.toLowerCase();

  return (
    sourceLabels[labelKey] ||
    sourceLabels[normalizedSource] ||
    normalizedSource ||
    "Origem não informada"
  );
}

function buildWonSourceBuckets(
  wonDeals: EnhancedDashboardStats["wonDeals"],
  totalWon: number,
): DistributionChartPoint[] {
  const groupedSources = new Map<
    string,
    { key: string; label: string; count: number }
  >();

  for (const deal of wonDeals) {
    const source = (deal.source || "").trim();
    const key = source.toLowerCase() || "sem-origem";
    const current = groupedSources.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    groupedSources.set(key, {
      key,
      label: getSourceLabel(source),
      count: 1,
    });
  }

  const percentageBase = totalWon > 0 ? totalWon : wonDeals.length;

  return Array.from(groupedSources.values())
    .sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
    )
    .map((bucket, index) => ({
      ...bucket,
      percentage:
        percentageBase > 0 ? (bucket.count / percentageBase) * 100 : 0,
      color:
        DASHBOARD_CHART_COLORS[(index + 3) % DASHBOARD_CHART_COLORS.length],
    }));
}

function LostDealsDialog({
  open,
  onOpenChange,
  data,
  periodLabel,
  onViewLead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: EnhancedDashboardStats;
  periodLabel: string;
  onViewLead: (leadId: string) => void;
}) {
  const lostDeals = data.lostDeals || [];
  const reasonBuckets = [...(data.lostReasonBuckets || [])]
    .filter((bucket) => bucket.count > 0)
    .sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
    );
  const totalLost = data.lostLeads || lostDeals.length;
  const topReason = reasonBuckets[0];
  const otherBucket = reasonBuckets.find((bucket) => bucket.key === "outros");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="dashboard-lost-dialog"
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <XCircle className="h-3.5 w-3.5" />
            </span>
            <span>Perdidos - Motivos de Perda</span>
          </DialogTitle>
          <DialogDescription className="pl-[42px] text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            {totalLost} perdidos em {periodLabel.toLowerCase()}
            {topReason ? ` | principal motivo: ${topReason.label}` : ""}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Perdidos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums text-destructive">
                  {totalLost}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Motivos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {reasonBuckets.length}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Principal motivo
                </p>
                <p
                  title={topReason?.label || undefined}
                  className="mt-1 line-clamp-2 text-[14px] font-normal leading-5"
                >
                  {topReason?.label || "--"}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Outros
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {otherBucket?.count || 0}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-normal">
                    Distribuição dos motivos
                  </h3>
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    Maiores causas de perda no período filtrado.
                  </p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                  <PieChartIcon className="h-3.5 w-3.5" />
                </span>
              </div>

              {reasonBuckets.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhuma perda registrada nesse período.
                </div>
              ) : (
                <div className="grid min-w-0 gap-3 md:grid-cols-[190px_minmax(0,1fr)] md:items-center">
                  <div className="dashboard-recharts-focusless relative mx-auto h-[150px] w-full max-w-[170px] sm:h-[180px] sm:max-w-[190px]">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={1}
                      minHeight={1}
                      initialDimension={DIALOG_CHART_INITIAL_DIMENSION}
                    >
                      <PieChart>
                        <Pie
                          data={reasonBuckets}
                          cx="50%"
                          cy="50%"
                          innerRadius="58%"
                          outerRadius="92%"
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                          stroke="transparent"
                          strokeWidth={0}
                        >
                          {reasonBuckets.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={
                            <DistributionTooltip fallbackLabel="Motivo" />
                          }
                          cursor={false}
                          wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                        Perdas
                      </span>
                      <span className="text-[30px] font-normal leading-tight text-[var(--app-text-primary)]">
                        {totalLost}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    {reasonBuckets.map((bucket) => (
                      <div
                        key={bucket.key}
                        className="flex min-w-0 items-center gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
                              style={{ backgroundColor: bucket.color }}
                            />
                            <span className="truncate font-light">
                              {bucket.label}
                            </span>
                          </div>
                          <div className="h-2.5 overflow-hidden rounded-[4px] bg-[var(--app-surface-solid)]">
                            <div
                              className="h-full rounded-[4px] transition-[width] duration-200"
                              style={{
                                width: `${Math.max(4, Math.min(100, bucket.percentage || 0))}%`,
                                backgroundColor: bucket.color,
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex min-w-[76px] shrink-0 flex-col items-end gap-0.5 sm:min-w-[118px] sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                          <span className="font-normal tabular-nums">
                            {bucket.count}
                          </span>
                          <span
                            className="font-normal tabular-nums"
                            style={{ color: bucket.color }}
                          >
                            {formatKPIValue(bucket.percentage || 0, "percent")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-light">Perdidos do período</h3>
                <span className="shrink-0 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {lostDeals.length} registros
                </span>
              </div>

              {lostDeals.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum lead perdido nesse período.
                </div>
              ) : (
                <div className="dashboard-dialog-list overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
                  {lostDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="dashboard-dialog-list-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-3 text-[12px] transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-[0.8fr_1.3fr_34px_220px_auto] md:items-center md:gap-y-2"
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                          {deal.name}
                        </p>
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {sourceLabels[deal.source || ""] ||
                            deal.source ||
                            "Origem não informada"}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          Motivo
                        </p>
                        <p className="truncate text-[12px] font-normal text-destructive">
                          {deal.lostReasonGroup}
                        </p>
                        <p className="break-words text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {deal.lostReason}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1 md:flex md:justify-center">
                        <span className="block truncate text-[11px] text-[var(--app-text-secondary)] md:hidden">
                          Responsável:{" "}
                          <span className="font-normal text-[var(--app-text-primary)]">
                            {deal.assignedUserName || "Sem responsável"}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <DashboardAssigneeAvatar
                            name={deal.assignedUserName}
                          />
                        </span>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-1 md:text-right">
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                            Entrada
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--app-text-primary)]">
                            {formatDateTime(deal.createdAt)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-destructive/75">
                            Perda
                          </p>
                          <p className="truncate text-[11px] font-light text-destructive">
                            {formatDateTime(deal.lostAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        aria-label={`Visualizar ${deal.name}`}
                        className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 md:col-span-1 md:h-9"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Visualizar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function WonDealsDialog({
  open,
  onOpenChange,
  data,
  periodLabel,
  onViewLead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: EnhancedDashboardStats;
  periodLabel: string;
  onViewLead: (leadId: string) => void;
}) {
  const wonDeals = data.wonDeals || [];
  const totalWon = data.closedLeads || 0;
  const totalVgv = data.totalSalesValue || 0;
  const averageTicket = totalWon > 0 ? totalVgv / totalWon : 0;
  const averageDays = data.wonAverageConversionDays;
  const sourceBuckets = buildWonSourceBuckets(wonDeals, totalWon);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="dashboard-won-dialog"
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Trophy className="h-3.5 w-3.5" />
            </span>
            <span>Ganhos - Tempo de Conversão</span>
          </DialogTitle>
          <DialogDescription className="pl-[42px] text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            {totalWon} ganhos em {periodLabel.toLowerCase()}
            {averageDays !== null && averageDays !== undefined
              ? ` | média: ${averageDays} dias`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Ganhos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {totalWon}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Conversão
                </p>
                <p
                  className={cn(
                    "mt-1 text-[20px] font-normal leading-tight tabular-nums",
                    data.conversionRate > 0
                      ? "text-[var(--lead-status-won-fg)]"
                      : "text-destructive",
                  )}
                >
                  {formatKPIValue(data.conversionRate || 0, "percent")}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  VGV dos ganhos
                </p>
                <p className="mt-1 truncate text-[18px] font-normal leading-tight tabular-nums text-[var(--lead-status-won-fg)]">
                  {formatCurrency(totalVgv)}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Ticket médio
                </p>
                <p className="mt-1 truncate text-[18px] font-normal leading-tight tabular-nums">
                  {formatCurrency(averageTicket)}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-normal">
                    Origem e tempo dos ganhos
                  </h3>
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    Pizza por origem e tempo até o ganho no período filtrado.
                  </p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                  <PieChartIcon className="h-3.5 w-3.5" />
                </span>
              </div>

              {sourceBuckets.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum ganho fechado nesse período.
                </div>
              ) : (
                <div className="grid min-w-0 gap-3 md:grid-cols-[190px_minmax(0,1fr)] md:items-center">
                  <div className="dashboard-recharts-focusless relative mx-auto h-[150px] w-full max-w-[170px] sm:h-[180px] sm:max-w-[190px]">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={1}
                      minHeight={1}
                      initialDimension={DIALOG_CHART_INITIAL_DIMENSION}
                    >
                      <PieChart>
                        <Pie
                          data={sourceBuckets}
                          cx="50%"
                          cy="50%"
                          innerRadius="52%"
                          outerRadius="76%"
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                          stroke="transparent"
                          strokeWidth={0}
                        >
                          {sourceBuckets.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={
                            <DistributionTooltip fallbackLabel="Origem" />
                          }
                          cursor={false}
                          wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                        Ganhos
                      </span>
                      <span className="text-[30px] font-normal leading-tight text-[var(--app-text-primary)]">
                        {totalWon}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    {data.wonConversionBuckets.map((bucket) => {
                      const hasDeals = bucket.count > 0;
                      const width = hasDeals
                        ? Math.max(4, Math.min(100, bucket.percentage || 0))
                        : 0;

                      return (
                        <div
                          key={bucket.key}
                          className={cn(
                            "grid gap-1.5 text-xs sm:grid-cols-[140px_1fr_70px_70px] sm:items-center sm:gap-3",
                            !hasDeals && "opacity-55",
                          )}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-3 sm:contents">
                            <span
                              className={cn(
                                "min-w-0 truncate text-muted-foreground",
                                !hasDeals && "text-[11px]",
                              )}
                            >
                              {bucket.label}
                            </span>
                            <div className="flex shrink-0 items-center gap-3 sm:contents">
                              <span
                                className={cn(
                                  "text-right font-normal tabular-nums",
                                  !hasDeals && "text-[11px]",
                                )}
                              >
                                {bucket.count}
                              </span>
                              <span
                                className={cn(
                                  "text-right font-normal tabular-nums",
                                  !hasDeals && "text-[11px]",
                                )}
                                style={{ color: bucket.color }}
                              >
                                {formatKPIValue(
                                  bucket.percentage || 0,
                                  "percent",
                                )}
                              </span>
                            </div>
                          </div>
                          <div
                            className={cn(
                              "overflow-hidden rounded-[4px] bg-[var(--app-surface-solid)] sm:col-start-2 sm:row-start-1",
                              hasDeals ? "h-2.5 sm:h-3" : "h-1.5",
                            )}
                          >
                            <div
                              className="h-full rounded-[4px] transition-[width] duration-200"
                              style={{
                                width: `${width}%`,
                                backgroundColor: bucket.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-light">Ganhos do período</h3>
                <span className="shrink-0 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {wonDeals.length} registros
                </span>
              </div>

              {wonDeals.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum ganho fechado nesse período.
                </div>
              ) : (
                <div className="dashboard-dialog-list overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
                  {wonDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="dashboard-dialog-list-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-3 text-[12px] transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-[1fr_34px_220px_0.75fr_auto] md:items-center md:gap-y-2"
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                          {deal.name}
                        </p>
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {sourceLabels[deal.source || ""] ||
                            deal.source ||
                            "Origem não informada"}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1 md:flex md:justify-center">
                        <span className="block truncate text-[11px] text-[var(--app-text-secondary)] md:hidden">
                          Responsável:{" "}
                          <span className="font-normal text-[var(--app-text-primary)]">
                            {deal.assignedUserName || "Sem responsável"}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <DashboardAssigneeAvatar
                            name={deal.assignedUserName}
                          />
                        </span>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-1">
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                            Entrada
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--app-text-primary)]">
                            {formatDateTime(deal.createdAt)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--lead-status-won-fg)] opacity-75">
                            Ganho
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--lead-status-won-fg)]">
                            {formatDateTime(deal.wonAt)}
                          </p>
                        </div>
                      </div>
                      <div className="md:text-right">
                        <p className="text-[12px] font-normal text-[var(--lead-status-won-fg)]">
                          {formatCurrency(deal.value)}
                        </p>
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {formatConversionDays(deal.conversionDays)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        aria-label={`Visualizar ${deal.name}`}
                        className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 md:col-span-1 md:h-9"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Visualizar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
