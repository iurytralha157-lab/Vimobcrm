"use client";

import { type KeyboardEvent, useState, useEffect } from "react";
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
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RechartsTooltip } from "recharts";

import { performanceTracker } from "@/lib/performance";
import { cn } from "@/lib/utils";

// Componentes de Layout e UI
import { AppLayout } from "@/components/shared/layout/AppLayout";

import { KPICards } from "@/components/features/dashboard/KPICards";
import { SalesFunnelWithPipeline } from "@/components/features/dashboard/SalesFunnelWithPipeline";
import { DealsEvolutionChart } from "@/components/features/dashboard/DealsEvolutionChart";
import { LeadSourcesChart } from "@/components/features/dashboard/LeadSourcesChart";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// Hooks e Contextos
import { useSharedFilters } from "@/hooks/use-shared-filters";
import {
  type EnhancedDashboardStats,
  useEnhancedDashboardStats,
  useDealsEvolutionData,
  useLeadSourcesData,
} from "@/hooks/use-dashboard-stats";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { datePresetOptions, sourceLabels } from "@/hooks/use-dashboard-filters";
import { getDashboardExtraCounts } from "@/lib/api/dashboard";

const DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS = 1000 * 60 * 10;

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
  color: string;
  iconColor?: string;
  iconBgColor?: string;
  hideIconOnDesktop?: boolean;
  onClick?: () => void;
  interactive?: boolean;
  compact?: boolean;
  tourTarget: string;
};

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================
export default function Dashboard() {
  const isMobile = useIsMobile();
  const router = useRouter();
  const [mobileChartTab, setMobileChartTab] = useState("funnel");
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const { organization } = useAuth();

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
  } = useSharedFilters({ loadDynamicOptions: shouldLoadFilterOptions });

  // Mapeamento de strings de data para chaves de cache estáveis
  const dateFromStr = filters.dateRange.from.toISOString();
  const dateToStr = filters.dateRange.to.toISOString();

  // Data hooks - Imobiliário
  const { data: stats, isLoading: statsLoading } = useEnhancedDashboardStats(filters);
  const { data: evolutionData = [], isLoading: evolutionLoading } = useDealsEvolutionData(filters);
  const { data: sourcesData = [], isLoading: sourcesLoading } = useLeadSourcesData(filters);
  const hasOrganization = Boolean(organization?.id);

  const { data: extraCounts, isLoading: extraCountsLoading } = useQuery({
    queryKey: [
      "dashboard-extra-counts",
      organization?.id,
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
    queryFn: () => getDashboardExtraCounts({ organizationId: organization?.id, filters }),
    enabled: !!organization?.id,
    staleTime: DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS,
  });

  const propertyCount = extraCounts?.propertyCount ?? 0;
  const siteVisits = extraCounts?.siteVisits ?? 0;
  const scheduledVisitsCount = extraCounts?.scheduledVisits ?? 0;
  const kpisLoading = !hasOrganization || statsLoading || extraCountsLoading;
  const evolutionDataLoading = !hasOrganization || evolutionLoading;
  const sourcesDataLoading = !hasOrganization || sourcesLoading;

  useEffect(() => {
    if (hasOrganization && !statsLoading && !evolutionLoading) {
      performanceTracker.addMetric("Dashboard Full Load", performance.now(), "ms");
    }
  }, [hasOrganization, statsLoading, evolutionLoading]);

  const funnelComponent = <SalesFunnelWithPipeline filters={filters} />;
  const periodLabel = datePresetOptions.find((o) => o.value === datePreset)?.label || "Período selecionado";

  const kpiData: EnhancedDashboardStats = stats || {
    totalLeads: 0,
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
          "dashboard-borderless flex flex-col gap-2 md:gap-3 animate-fade-in h-full w-full",
          !isMobile ? "flex-1 min-h-0 overflow-hidden" : "",
        )}
      >
        <div data-tour="dashboard-filters">
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
            onFiltersOpenChange={(open) => {
              if (open) setShouldLoadFilterOptions(true);
            }}
            tourPrefix="dashboard"
          />
        </div>

        {/* ===== DESKTOP LAYOUT ===== */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-2 md:gap-3 flex-1 min-h-0 overflow-y-auto app-scrollbar">
          <div className="col-span-8 flex flex-col gap-3 min-h-0">
            <div className="flex-shrink-0">
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
            </div>

            <div data-tour="dashboard-evolution" className="flex-1 min-h-0">
              <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} />
            </div>
          </div>

          <div className="col-span-4 min-h-0 flex flex-col gap-3">
            <div data-tour="dashboard-funnel" className="h-[48%] min-h-0">{funnelComponent}</div>
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

        {/* ===== MOBILE LAYOUT ===== */}
        <div className={cn("scrollbar-hidden lg:hidden flex flex-col gap-4 overflow-y-auto", !isMobile ? "flex-1 min-h-0" : "")}>
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

          <Tabs
            value={mobileChartTab}
            onValueChange={setMobileChartTab}
            className={cn(!isMobile ? "flex-1 flex flex-col min-h-0" : "")}
          >
            <TabsList className="w-full grid grid-cols-3 gap-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)]">
              <TabsTrigger value="funnel" className="mx-0 rounded-[6px] text-xs data-[state=active]:shadow-none">
                Funil
              </TabsTrigger>
              <TabsTrigger value="evolution" className="mx-0 rounded-[6px] text-xs data-[state=active]:shadow-none">
                Evolução
              </TabsTrigger>
              <TabsTrigger value="sources" className="mx-0 rounded-[6px] text-xs data-[state=active]:shadow-none">
                Origem
              </TabsTrigger>
            </TabsList>
            <TabsContent value="funnel" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-funnel" className="h-[400px]">{funnelComponent}</div>
            </TabsContent>
            <TabsContent value="evolution" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-evolution" className="h-[400px]">
                <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} />
              </div>
            </TabsContent>
            <TabsContent value="sources" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-sources" className="h-[450px]">
                <LeadSourcesChart
                  data={sourcesData}
                  isLoading={sourcesDataLoading}
                  selectedSource={source}
                  onSourceChange={setSource}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
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
      <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-5")}>
        {Array.from({ length: 9 }).map((_, i) => (
          <Card
            key={`skeleton-${i}`}
            data-tour={skeletonTours[i]}
            className={cn(i === 5 && !isSide ? "col-span-2" : "")}
          >
            <CardContent className="p-4">
              <div className="flex items-start justify-between">
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-12" />
                  <Skeleton className="h-3 w-10" />
                </div>
                <Skeleton className="h-9 w-9 rounded-lg" />
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
      color: "primary",
      tourTarget: "dashboard-kpi-leads",
    },
    {
      title: "Em aberto",
      value: data.openLeads ?? 0,
      rate: data.totalLeads > 0 ? ((data.openLeads ?? 0) / data.totalLeads) * 100 : 0,
      icon: CircleDot,
      tooltip: `Percentual de leads em aberto dentro do total do período - ${periodLabel}`,
      format: "number",
      color: "chart-1",
      tourTarget: "dashboard-kpi-open",
    },
    {
      title: "Perdidos",
      value: data.lostLeads ?? 0,
      rate: data.totalLeads > 0 ? ((data.lostLeads ?? 0) / data.totalLeads) * 100 : 0,
      rateVariant: "negative",
      icon: XCircle,
      tooltip: `Percentual de leads perdidos dentro do total do período - ${periodLabel}`,
      format: "number",
      color: "destructive",
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
      color: "success",
      iconColor: "rgb(16, 185, 129)",
      iconBgColor: "rgba(16, 185, 129, 0.1)",
      onClick: onWonClick,
      interactive: true,
      tourTarget: "dashboard-kpi-won",
    },
    {
      title: "Visitas",
      value: scheduledVisits ?? 0,
      rate: data.totalLeads > 0 ? ((scheduledVisits ?? 0) / data.totalLeads) * 100 : 0,
      rateVariant: "auto",
      icon: CalendarCheck,
      tooltip: `Visitas agendadas em relação ao total de leads - ${periodLabel}`,
      format: "number",
      color: "chart-4",
      tourTarget: "dashboard-kpi-visits",
    },
    {
      title: "VGV",
      value: data.totalSalesValue,
      icon: DollarSign,
      tooltip: `Valor em vendas - ${periodLabel}`,
      format: "currency",
      color: "chart-5",
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
      color: "chart-4",
      compact: true,
      tourTarget: "dashboard-kpi-first-contact",
    },
    {
      title: "Imóveis",
      value: propertyCount ?? 0,
      icon: Building2,
      tooltip: "Total de imóveis cadastrados",
      format: "number",
      color: "chart-1",
      compact: true,
      tourTarget: "dashboard-kpi-properties",
    },
    {
      title: "Visitas no site",
      value: siteVisits ?? 0,
      icon: Eye,
      tooltip: `Visitas ao site no período - ${periodLabel}`,
      format: "number",
      color: "chart-2",
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
            ? "text-emerald-500"
            : "text-destructive"
          : "text-emerald-500";

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
                "app-card card-hover h-full border-0 transition-colors",
                kpi.interactive
                  ? "cursor-pointer hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  : "cursor-default",
              )}
              role={kpi.interactive ? "button" : undefined}
              tabIndex={kpi.interactive ? 0 : undefined}
              onClick={kpi.onClick}
              onKeyDown={handleKeyDown}
            >
              <CardContent className={cn("relative h-full p-3 sm:p-4", kpi.compact ? "min-h-[78px] sm:min-h-[82px]" : "min-h-[96px]")}>
                <div className="min-w-0">
                    <p className="mb-1 truncate pr-9 text-[10px] font-medium uppercase leading-tight tracking-wider text-muted-foreground sm:pr-11 sm:text-xs">
                      {kpi.title}
                    </p>
                    <p
                      className={cn(
                        "font-bold leading-tight",
                        isCurrency ? "text-sm sm:text-lg xl:text-xl break-words" : "text-lg sm:text-2xl truncate",
                      )}
                    >
                      {formatKPIValue(kpi.value, kpi.format)}
                    </p>
                    {hasTrend && (
                      <div className="flex items-center gap-0.5 mt-1">
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-destructive" />
                        )}
                        <span
                          className={cn(
                            "text-[10px] sm:text-xs font-medium",
                            isPositive ? "text-emerald-500" : "text-destructive",
                          )}
                        >
                          {kpi.trend! > 0 ? "+" : ""}
                          {kpi.trend}%
                        </span>
                      </div>
                    )}
                    {kpi.rate !== undefined && (
                      <div className={cn("mt-1 max-w-full whitespace-nowrap text-[10px] font-medium leading-tight sm:text-xs", rateColorClass)}>
                        {formatKPIValue(kpi.rate, "percent")}{kpi.rateLabel ? ` ${kpi.rateLabel}` : ""}
                      </div>
                    )}
                  {showIcon && (
                    <div
                      className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 sm:right-4 sm:top-4 sm:h-9 sm:w-9"
                    >
                      <Icon className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent>
            <p className="text-xs">{kpi.tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      </div>
    );
  };

  const isSide = layout === "side";

  return (
    <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-5")}>
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
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatConversionDays(days: number | null): string {
  if (days === null) return "--";
  if (days === 0) return "Mesmo dia";
  if (days === 1) return "1 dia";
  if (days < 30) return `${days} dias`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 mês" : `${months} meses`;
}

type LostReasonChartPoint = {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
};

type LostReasonTooltipEntry = {
  value?: string | number;
  color?: string;
  fill?: string;
  payload?: Partial<LostReasonChartPoint>;
};

function LostReasonTooltip({ active, payload }: { active?: boolean; payload?: LostReasonTooltipEntry[] }) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const point = entry.payload;
  const count = Number(entry.value || point?.count || 0);
  const leadLabel = count === 1 ? "lead" : "leads";

  return (
    <div className="min-w-[160px] rounded-xl border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-[var(--app-text-primary)] shadow-[0_8px_20px_rgba(0,0,0,0.22)]">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-full ring-2 ring-[var(--app-surface-solid)]"
          style={{ backgroundColor: point?.color || entry.color || entry.fill }}
        />
        <span className="truncate text-xs font-semibold text-foreground">{point?.label || "Motivo"}</span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-[11px] text-muted-foreground">
          {count} {leadLabel}
        </span>
        <span className="rounded-full bg-white/[0.055] px-2 py-0.5 text-[11px] font-bold tabular-nums text-foreground">
          {formatKPIValue(point?.percentage || 0, "percent")}
        </span>
      </div>
    </div>
  );
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
  const reasonBuckets = (data.lostReasonBuckets || []).filter((bucket) => bucket.count > 0);
  const totalLost = data.lostLeads || lostDeals.length;
  const topReason = reasonBuckets[0];
  const otherBucket = reasonBuckets.find((bucket) => bucket.key === "outros");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-tour="dashboard-lost-dialog" className="app-card max-h-[82dvh] w-[calc(100vw-24px)] max-w-[980px] overflow-hidden rounded-[12px] p-0 shadow-2xl backdrop-blur-xl sm:w-[92vw] sm:rounded-xl">
        <DialogHeader className="px-4 pb-3 pt-4 text-left sm:px-5 sm:pt-5">
          <DialogTitle className="flex items-start gap-2 pr-8 text-[15px] font-semibold leading-snug sm:items-center sm:text-base">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive sm:mt-0" />
            <span>Perdidos - Motivos de Perda</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 sm:text-sm">
            {totalLost} perdidos em {periodLabel.toLowerCase()}
            {topReason ? ` | principal motivo: ${topReason.label}` : ""}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(82dvh-88px)] overflow-x-hidden">
          <div className="space-y-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:px-5 sm:pb-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Perdidos</p>
                <p className="mt-1 text-2xl font-bold text-destructive">{totalLost}</p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Motivos</p>
                <p className="mt-1 text-2xl font-bold">{reasonBuckets.length}</p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Principal motivo</p>
                <p className="mt-1 truncate text-xl font-bold">{topReason?.label || "--"}</p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Outros</p>
                <p className="mt-1 text-2xl font-bold">{otherBucket?.count || 0}</p>
              </div>
            </div>

            <div className="app-card-soft overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Distribuição dos motivos</h3>
                  <p className="text-xs text-muted-foreground">Maiores causas de perda no período filtrado.</p>
                </div>
                <PieChartIcon className="h-4 w-4 shrink-0 text-destructive" />
              </div>

              {reasonBuckets.length === 0 ? (
                <div className="rounded-lg bg-white/[0.035] p-4 text-center text-sm text-muted-foreground">
                  Nenhuma perda registrada nesse período.
                </div>
              ) : (
                <div className="grid min-w-0 gap-4 xl:grid-cols-[280px_minmax(0,1fr)]">
                  <div className="dashboard-recharts-focusless relative mx-auto h-[210px] w-full max-w-[240px] sm:h-[240px] sm:max-w-[280px]">
                    <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
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
                          content={<LostReasonTooltip />}
                          cursor={false}
                          wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground/70">Perdas</span>
                      <span className="text-4xl font-black leading-tight text-foreground">{totalLost}</span>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    {reasonBuckets.map((bucket) => (
                      <div key={bucket.key} className="flex min-w-0 items-center gap-3 text-xs">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: bucket.color }} />
                            <span className="truncate font-semibold">{bucket.label}</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-white/[0.045]">
                            <div
                              className="h-full rounded-full transition-all"
                              style={{ width: `${Math.max(4, Math.min(100, bucket.percentage || 0))}%`, backgroundColor: bucket.color }}
                            />
                          </div>
                        </div>
                        <div className="flex min-w-[76px] shrink-0 flex-col items-end gap-0.5 sm:min-w-[118px] sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                          <span className="font-semibold tabular-nums">{bucket.count}</span>
                          <span className="font-semibold tabular-nums" style={{ color: bucket.color }}>
                            {formatKPIValue(bucket.percentage || 0, "percent")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="app-card-soft overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Perdidos do período</h3>
                <span className="shrink-0 text-xs text-muted-foreground">{lostDeals.length} registros</span>
              </div>

              {lostDeals.length === 0 ? (
                <div className="rounded-lg bg-white/[0.035] p-4 text-center text-sm text-muted-foreground">
                  Nenhum lead perdido nesse período.
                </div>
              ) : (
                <div className="space-y-2">
                  {lostDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="grid gap-2 rounded-lg bg-white/[0.035] p-3 text-sm transition-colors hover:bg-white/[0.055] md:grid-cols-[1.1fr_1fr_0.8fr_0.7fr_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{deal.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sourceLabels[deal.source || ""] || deal.source || "Origem não informada"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Motivo</p>
                        <p className="truncate font-medium text-destructive">{deal.lostReasonGroup}</p>
                        <p className="break-words text-xs text-muted-foreground">{deal.lostReason}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Responsável</p>
                        <p className="truncate font-medium">{deal.assignedUserName}</p>
                      </div>
                      <div className="md:text-right">
                        <p className="text-xs text-muted-foreground">Entrada / perda</p>
                        <p className="font-medium">{formatDateTime(deal.createdAt)}</p>
                        <p className="text-xs text-destructive">{formatDateTime(deal.lostAt)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-tour="dashboard-won-dialog" className="app-card max-h-[82dvh] w-[calc(100vw-24px)] max-w-[980px] overflow-hidden rounded-[12px] p-0 shadow-2xl backdrop-blur-xl sm:w-[92vw] sm:rounded-xl">
        <DialogHeader className="px-4 pb-3 pt-4 text-left sm:px-5 sm:pt-5">
          <DialogTitle className="flex items-start gap-2 pr-8 text-[15px] font-semibold leading-snug sm:items-center sm:text-base">
            <Trophy className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500 sm:mt-0" />
            <span>Ganhos - Tempo de Conversão</span>
          </DialogTitle>
          <DialogDescription className="text-xs leading-5 sm:text-sm">
            {totalWon} ganhos em {periodLabel.toLowerCase()}
            {averageDays !== null && averageDays !== undefined ? ` | média: ${averageDays} dias` : ""}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(82dvh-88px)] overflow-x-hidden">
          <div className="space-y-4 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:space-y-5 sm:px-5 sm:pb-5">
            <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Ganhos</p>
                <p className="mt-1 text-2xl font-bold">{totalWon}</p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Conversão</p>
                <p className={cn("mt-1 text-2xl font-bold", data.conversionRate > 0 ? "text-emerald-500" : "text-destructive")}>
                  {formatKPIValue(data.conversionRate || 0, "percent")}
                </p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">VGV dos ganhos</p>
                <p className="mt-1 text-xl font-bold text-emerald-500">{formatCurrency(totalVgv)}</p>
              </div>
              <div className="app-card-soft p-3">
                <p className="text-xs text-muted-foreground">Ticket médio</p>
                <p className="mt-1 text-xl font-bold">{formatCurrency(averageTicket)}</p>
              </div>
            </div>

            <div className="app-card-soft overflow-hidden p-4">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">Tempo até o ganho</h3>
                  <p className="text-xs text-muted-foreground">Distribuição dos fechamentos pela idade do lead.</p>
                </div>
                <p className="text-sm font-semibold text-emerald-500 sm:text-right">{formatCurrency(totalVgv)}</p>
              </div>

              <div className="space-y-3">
                {data.wonConversionBuckets.map((bucket) => {
                  const hasDeals = bucket.count > 0;
                  const width = hasDeals ? Math.max(4, Math.min(100, bucket.percentage || 0)) : 0;

                  return (
                    <div
                      key={bucket.key}
                      className={cn(
                        "grid gap-1.5 text-xs sm:grid-cols-[140px_1fr_70px_70px] sm:items-center sm:gap-3",
                        !hasDeals && "opacity-55",
                      )}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-3 sm:contents">
                        <span className={cn("min-w-0 truncate text-muted-foreground", !hasDeals && "text-[11px]")}>
                          {bucket.label}
                        </span>
                        <div className="flex shrink-0 items-center gap-3 sm:contents">
                          <span className={cn("text-right font-semibold tabular-nums", !hasDeals && "text-[11px]")}>{bucket.count}</span>
                          <span className={cn("text-right font-semibold tabular-nums", !hasDeals && "text-[11px]")} style={{ color: bucket.color }}>
                            {formatKPIValue(bucket.percentage || 0, "percent")}
                          </span>
                        </div>
                      </div>
                      <div className={cn("overflow-hidden rounded-full bg-white/[0.045] sm:col-start-2 sm:row-start-1", hasDeals ? "h-2.5 sm:h-3" : "h-1.5")}>
                        <div
                          className="h-full rounded-full transition-all"
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

            <div className="app-card-soft overflow-hidden p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Ganhos do período</h3>
                <span className="shrink-0 text-xs text-muted-foreground">{wonDeals.length} registros</span>
              </div>

              {wonDeals.length === 0 ? (
                <div className="rounded-lg bg-white/[0.035] p-4 text-center text-sm text-muted-foreground">
                  Nenhum ganho fechado nesse período.
                </div>
              ) : (
                <div className="space-y-2">
                  {wonDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="grid gap-2 rounded-lg bg-white/[0.035] p-3 text-sm transition-colors hover:bg-white/[0.055] md:grid-cols-[1.2fr_0.8fr_0.8fr_0.7fr_auto] md:items-center"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{deal.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {sourceLabels[deal.source || ""] || deal.source || "Origem não informada"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Responsável</p>
                        <p className="truncate font-medium">{deal.assignedUserName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Entrada / ganho</p>
                        <p className="font-medium">{formatDateTime(deal.createdAt)}</p>
                        <p className="text-xs text-emerald-500">{formatDateTime(deal.wonAt)}</p>
                      </div>
                      <div className="md:text-right">
                        <p className="font-semibold text-emerald-500">{formatCurrency(deal.value)}</p>
                        <p className="text-xs text-muted-foreground">{formatConversionDays(deal.conversionDays)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
