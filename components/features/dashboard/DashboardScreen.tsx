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
} from "lucide-react";

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
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
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
  } = useSharedFilters();

  // Mapeamento de strings de data para chaves de cache estáveis
  const dateFromStr = filters.dateRange.from.toISOString();
  const dateToStr = filters.dateRange.to.toISOString();

  // Data hooks - Imobiliário
  const { data: stats, isLoading: statsLoading } = useEnhancedDashboardStats(filters);
  const { data: evolutionData = [], isLoading: evolutionLoading } = useDealsEvolutionData(filters);
  const { data: sourcesData = [], isLoading: sourcesLoading } = useLeadSourcesData(filters);

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
    staleTime: 1000 * 60,
  });

  const propertyCount = extraCounts?.propertyCount ?? 0;
  const siteVisits = extraCounts?.siteVisits ?? 0;
  const scheduledVisitsCount = extraCounts?.scheduledVisits ?? 0;

  useEffect(() => {
    if (!statsLoading && !evolutionLoading) {
      performanceTracker.addMetric("Dashboard Full Load", performance.now(), "ms");
    }
  }, [statsLoading, evolutionLoading]);

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
          />
        </div>

        {/* ===== DESKTOP LAYOUT ===== */}
        <div className="hidden lg:grid lg:grid-cols-12 gap-2 md:gap-3 flex-1 min-h-0 overflow-hidden">
          <div className="col-span-8 flex flex-col gap-3 min-h-0">
            <div className="flex-shrink-0">
              <KPICardsGrid
                data={kpiData}
                isLoading={statsLoading || extraCountsLoading}
                periodLabel={periodLabel}
                propertyCount={propertyCount}
                siteVisits={siteVisits}
                scheduledVisits={scheduledVisitsCount}
                layout="top"
                onWonClick={() => setWonDialogOpen(true)}
              />
            </div>

            <div data-tour="dashboard-evolution" className="flex-1 min-h-0">
              <DealsEvolutionChart data={evolutionData} isLoading={evolutionLoading} />
            </div>
          </div>

          <div className="col-span-4 min-h-0 flex flex-col gap-3">
            <div data-tour="dashboard-funnel" className="h-[48%] min-h-0">{funnelComponent}</div>
            <div data-tour="dashboard-sources" className="h-[52%] min-h-0">
              <LeadSourcesChart
                data={sourcesData}
                isLoading={sourcesLoading}
                selectedSource={source}
                onSourceChange={setSource}
              />
            </div>
          </div>
        </div>

        {/* ===== MOBILE LAYOUT ===== */}
        <div className={cn("app-scrollbar lg:hidden flex flex-col gap-4 overflow-y-auto", !isMobile ? "flex-1 min-h-0" : "")}>
          <KPICards
            data={kpiData}
            isLoading={statsLoading || extraCountsLoading}
            periodLabel={periodLabel}
            scheduledVisits={scheduledVisitsCount}
            propertyCount={propertyCount}
            siteVisits={siteVisits}
            onWonClick={() => setWonDialogOpen(true)}
          />

          <Tabs
            value={mobileChartTab}
            onValueChange={setMobileChartTab}
            className={cn(!isMobile ? "flex-1 flex flex-col min-h-0" : "")}
          >
            <TabsList className="w-full grid grid-cols-3 border-0 bg-[var(--app-surface-soft)]">
              <TabsTrigger value="funnel" className="text-xs">
                Funil
              </TabsTrigger>
              <TabsTrigger value="evolution" className="text-xs">
                Evolução
              </TabsTrigger>
              <TabsTrigger value="sources" className="text-xs">
                Origem
              </TabsTrigger>
            </TabsList>
            <TabsContent value="funnel" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-funnel" className="h-[400px]">{funnelComponent}</div>
            </TabsContent>
            <TabsContent value="evolution" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-evolution" className="h-[400px]">
                <DealsEvolutionChart data={evolutionData} isLoading={evolutionLoading} />
              </div>
            </TabsContent>
            <TabsContent value="sources" className={cn("mt-3", !isMobile ? "flex-1 min-h-0" : "")}>
              <div data-tour="dashboard-sources" className="h-[450px]">
                <LeadSourcesChart
                  data={sourcesData}
                  isLoading={sourcesLoading}
                  selectedSource={source}
                  onSourceChange={setSource}
                />
              </div>
            </TabsContent>
          </Tabs>
        </div>
      </div>

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
  onWonClick,
}: KPICardsGridProps) {
  if (isLoading) {
    const isSide = layout === "side";
    return (
      <div className="space-y-3">
        <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-4")}>
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={`skeleton-top-${i}`} data-tour={["dashboard-kpi-leads", "dashboard-kpi-open", "dashboard-kpi-lost", "dashboard-kpi-won"][i]}>
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
        <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-5")}>
          {Array.from({ length: 5 }).map((_, i) => (
            <Card
              key={`skeleton-bottom-${i}`}
              data-tour={["dashboard-kpi-visits", "dashboard-kpi-vgv", "dashboard-kpi-first-contact", "dashboard-kpi-properties", "dashboard-kpi-site-visits"][i]}
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

  const renderKPI = (kpi: DashboardKPI) => {
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
      <div key={kpi.title} data-tour={kpi.tourTarget} className="h-full">
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card
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
    <div className="space-y-3">
      <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(132px,1fr))]")}>
        {allKpis.slice(0, 5).map(renderKPI)}
      </div>
      <div className={cn("grid gap-3", isSide ? "grid-cols-2" : "grid-cols-[repeat(auto-fit,minmax(150px,1fr))]")}>{allKpis.slice(5).map(renderKPI)}</div>
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
      <DialogContent className="app-card max-h-[80vh] w-[92vw] max-w-[80vw] overflow-hidden p-0 shadow-2xl backdrop-blur-xl sm:rounded-xl">
        <DialogHeader className="px-5 pb-3 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Trophy className="h-5 w-5 text-emerald-500" />
            Ganhos - Tempo de Conversão
          </DialogTitle>
          <DialogDescription>
            {totalWon} ganhos em {periodLabel.toLowerCase()}
            {averageDays !== null && averageDays !== undefined ? ` | média: ${averageDays} dias` : ""}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[calc(80vh-92px)]">
          <div className="space-y-5 px-5 pb-5">
            <div className="grid gap-3 md:grid-cols-4">
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

            <div className="app-card-soft p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">Tempo até o ganho</h3>
                  <p className="text-xs text-muted-foreground">Distribuição dos fechamentos pela idade do lead.</p>
                </div>
                <p className="text-sm font-semibold text-emerald-500">{formatCurrency(totalVgv)}</p>
              </div>

              <div className="space-y-3">
                {data.wonConversionBuckets.map((bucket) => {
                  const hasDeals = bucket.count > 0;
                  const width = hasDeals ? Math.max(4, Math.min(100, bucket.percentage || 0)) : 0;

                  return (
                    <div
                      key={bucket.key}
                      className={cn(
                        "grid grid-cols-[110px_1fr_58px_58px] items-center gap-3 text-xs sm:grid-cols-[140px_1fr_70px_70px]",
                        !hasDeals && "opacity-55",
                      )}
                    >
                      <span className={cn("text-muted-foreground", !hasDeals && "text-[11px]")}>{bucket.label}</span>
                      <div className={cn("overflow-hidden rounded-full bg-white/[0.045]", hasDeals ? "h-3" : "h-1.5")}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                            width: `${width}%`,
                          backgroundColor: bucket.color,
                        }}
                      />
                    </div>
                      <span className={cn("text-right font-semibold", !hasDeals && "text-[11px]")}>{bucket.count}</span>
                      <span className={cn("text-right font-semibold", !hasDeals && "text-[11px]")} style={{ color: bucket.color }}>
                      {formatKPIValue(bucket.percentage || 0, "percent")}
                    </span>
                  </div>
                  );
                })}
              </div>
            </div>

            <div className="app-card-soft p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">Ganhos do período</h3>
                <span className="text-xs text-muted-foreground">{wonDeals.length} registros</span>
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
                      <div>
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
