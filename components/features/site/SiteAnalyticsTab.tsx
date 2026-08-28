import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useSiteAnalytics,
  useSiteAnalyticsDetailed,
} from "@/hooks/use-site-analytics";
import { siteAnalyticsRangeQuery } from "@/hooks/use-lead-analytics";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Eye,
  MousePointerClick,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  BarChart3,
  TrendingUp,
  Star,
  FileText,
  Users,
  Route,
  ExternalLink,
  Clock3,
  Activity,
  PanelsTopLeft,
  AlertCircle,
  RefreshCw,
  Monitor,
  Smartphone,
  Tablet,
  PieChart as PieChartIcon,
  Megaphone,
} from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LeadJourneyDashboard } from "./LeadJourneyDashboard";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import {
  DatePreset,
  getDateRangeFromPreset,
} from "@/hooks/use-dashboard-filters";
import { Button } from "@/components/ui/button";
import { useSiteDashboardUrl } from "@/hooks/site";
import { useIsMobile } from "@/hooks/use-mobile";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { DomainValidationError, siteAnalyticsQuerySchema } from "@/lib/validation";
import { getSitePublicPageUrl } from "@/lib/site/site-publication";

const DAY_IN_MS = 24 * 60 * 60 * 1_000;

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
  return error instanceof Error
    ? error.message
    : "Não foi possível carregar os dados do site agora.";
}

function getTrendIcon(current: number, previous: number) {
  if (current > previous)
    return <ArrowUpRight className="w-3 h-3 text-emerald-500" />;
  if (current < previous)
    return <ArrowDownRight className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function getTrendColor(current: number, previous: number) {
  if (current > previous) return "text-emerald-500";
  if (current < previous) return "text-red-500";
  return "text-muted-foreground";
}

export function SiteAnalyticsTab() {
  const [datePreset, setDatePreset] = useState<DatePreset>("last7days");
  const siteBaseUrl = useSiteDashboardUrl();
  const isMobile = useIsMobile();
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date;
    to: Date;
  } | null>(null);

  const { dateFrom, dateTo } = useMemo(() => {
    if (datePreset === "custom" && customDateRange) {
      return { dateFrom: customDateRange.from, dateTo: customDateRange.to };
    }

    const range = getDateRangeFromPreset(datePreset);
    return { dateFrom: range.from, dateTo: range.to };
  }, [datePreset, customDateRange]);

  const summaryQuery = useSiteAnalytics(dateFrom, dateTo);
  const detailedQuery = useSiteAnalyticsDetailed(dateFrom, dateTo);
  const { data, isPending } = summaryQuery;
  const { data: detailed, isPending: isDetailedPending } = detailedQuery;

  const chartData = useMemo(() => {
    const parsedRange = siteAnalyticsQuerySchema.safeParse(
      siteAnalyticsRangeQuery(dateFrom, dateTo),
    );
    if (!parsedRange.success) return [];

    const dailyViews = new Map(
      (detailed?.dailyViews || []).map((day) => [day.date, day.views]),
    );
    const start = Date.parse(`${parsedRange.data.dateFrom}T00:00:00.000Z`);
    const end = Date.parse(`${parsedRange.data.dateTo}T00:00:00.000Z`);

    const days: Array<{ date: string; fullDate: string; views: number }> = [];
    for (let cursor = start; cursor <= end; cursor += DAY_IN_MS) {
      const day = new Date(cursor);
      const key = day.toISOString().slice(0, 10);
      days.push({
        date: day.toLocaleDateString("pt-BR", {
          day: "2-digit",
          month: "2-digit",
          timeZone: "UTC",
        }),
        fullDate: day.toLocaleDateString("pt-BR", { timeZone: "UTC" }),
        views: dailyViews.get(key) || 0,
      });
    }

    return days;
  }, [detailed?.dailyViews, dateFrom, dateTo]);

  const sourceData = [
    {
      name: "Direto",
      value: Number(data?.directPct || 0),
      color: "var(--chart-1)",
    },
    {
      name: "Busca",
      value: Number(data?.searchPct || 0),
      color: "var(--chart-2)",
    },
    {
      name: "Campanhas",
      value: Number(data?.campaignPct || 0),
      color: "var(--chart-3)",
    },
    {
      name: "Social",
      value: Number(data?.socialPct || 0),
      color: "var(--chart-4)",
    },
    {
      name: "Referências",
      value: Number(data?.referralPct || 0),
      color: "var(--chart-5)",
    },
  ];
  const deviceData = [
    {
      name: "Desktop",
      value: Number(data?.desktopPct || 0),
      color: "var(--chart-1)",
      icon: Monitor,
    },
    {
      name: "Mobile",
      value: Number(data?.mobilePct || 0),
      color: "var(--chart-2)",
      icon: Smartphone,
    },
    {
      name: "Tablet",
      value: Number(data?.tabletPct || 0),
      color: "var(--chart-3)",
      icon: Tablet,
    },
  ].filter((item) => item.value > 0);

  const hasCompleteData = Boolean(data && detailed);
  if (!hasCompleteData && (isPending || isDetailedPending)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-9 w-[260px] rounded-[8px]" />
          <Skeleton className="h-9 w-[150px] rounded-[8px]" />
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24 rounded-[8px]" />
          ))}
        </div>
        <Skeleton className="h-80 rounded-[8px]" />
      </div>
    );
  }

  const stats = data || {
    totalViews: 0,
    totalPages: 0,
    uniquePages: 0,
    uniqueSessions: 0,
    avgDuration: 0,
    desktopPct: 0,
    mobilePct: 0,
    tabletPct: 0,
    directPct: 0,
    searchPct: 0,
    socialPct: 0,
    campaignPct: 0,
    referralPct: 0,
    conversions: 0,
    prevSessions: 0,
    prevViews: 0,
    prevPages: 0,
    prevUniquePages: 0,
    prevAvgDuration: 0,
    prevDesktopPct: 0,
    prevMobilePct: 0,
    prevConversions: 0,
    prevConversionRate: 0,
  };

  const hasData =
    stats.uniqueSessions > 0 ||
    stats.totalPages > 0 ||
    (detailed?.totalSessions ?? 0) > 0 ||
    (detailed?.siteLeads ?? 0) > 0 ||
    (detailed?.liveVisitors ?? 0) > 0 ||
    (detailed?.dailyViews.length ?? 0) > 0;
  const handleDatePresetChange = (preset: DatePreset | null) => {
    setDatePreset(preset || "last7days");
  };
  const blockingError = summaryQuery.error || detailedQuery.error;
  const hasBlockingError = !hasCompleteData && Boolean(blockingError);
  const hasStaleError = hasCompleteData && (summaryQuery.isError || detailedQuery.isError);
  const isRefetching = summaryQuery.isFetching || detailedQuery.isFetching;
  const handleRetry = () => {
    void summaryQuery.refetch();
    void detailedQuery.refetch();
  };

  return (
    <Tabs defaultValue="overview" className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-row items-center gap-2">
        <div
          data-collapse="compact"
          className="app-responsive-tab-list min-w-0 flex-1"
        >
          <TabsList
            data-responsive-tab-scroll
            aria-label="Seções de análise do site"
            className="h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <TabsTrigger
              value="overview"
              data-responsive-tab
              aria-label="Visão Geral"
              title="Visão Geral"
              className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
            >
              <BarChart3 className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="app-responsive-tab-label">Visão Geral</span>
            </TabsTrigger>
            <TabsTrigger
              value="journeys"
              data-responsive-tab
              aria-label="Percurso dos Leads"
              title="Percurso dos Leads"
              className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
            >
              <Route className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="app-responsive-tab-label">
                Percurso dos Leads
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        {hasCompleteData && isRefetching && !hasStaleError ? (
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
          onDatePresetChange={handleDatePresetChange}
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          defaultPreset="last7days"
          align="end"
          triggerDataTour="site-dashboard-date-filter"
          triggerClassName="h-8 w-auto shrink-0 justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/25 focus-visible:ring-offset-0 sm:text-[12px]"
          iconOnly={isMobile}
        />
      </div>

      {hasStaleError && (
        <div role="status" className="flex flex-col gap-3 rounded-[8px] bg-amber-500/[0.08] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-[var(--app-text-secondary)]">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-500" />
            Os últimos dados válidos continuam visíveis, mas a atualização falhou.
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-xs shadow-none hover:bg-[var(--app-surface-hover)]"
            onClick={handleRetry}
            disabled={isRefetching}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`} />
            {isRefetching ? "Atualizando" : "Tentar novamente"}
          </Button>
        </div>
      )}

      <TabsContent value="overview" className="mt-0 min-w-0 space-y-4">
        {hasBlockingError && (
          <Card className="app-card bg-[var(--app-surface-solid)]">
            <CardContent role="alert" className="flex min-h-[240px] flex-col items-center justify-center p-6 text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-red-500/[0.08] text-red-500">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-normal text-[var(--app-text-primary)]">
                Não foi possível carregar o dashboard do site
              </p>
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
                <RefreshCw
                  className={`mr-1.5 h-3.5 w-3.5 ${isRefetching ? "animate-spin" : ""}`}
                />
                {isRefetching ? "Carregando" : "Tentar novamente"}
              </Button>
            </CardContent>
          </Card>
        )}

        {!hasBlockingError && !hasData && (
          <Card className="app-card bg-[var(--app-surface-soft)]">
            <CardContent className="p-6 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="mb-1 text-sm font-normal text-[var(--app-text-primary)]">
                Nenhum dado registrado ainda
              </p>
              <p className="text-xs font-light leading-5 text-[var(--app-text-tertiary)]">
                Os dados aparecerão automaticamente quando visitantes acessarem
                seu site público. Certifique-se de que o site está ativo e
                publicado.
              </p>
            </CardContent>
          </Card>
        )}

        {!hasBlockingError && hasData && (
          <>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <MetricCard
            label="Sessões"
            value={stats.uniqueSessions}
            previous={stats.prevSessions ?? stats.prevViews}
            icon={Users}
          />
          <MetricCard
            label="Páginas vistas"
            value={stats.totalPages}
            previous={stats.prevPages}
            icon={Eye}
          />
          <MetricCard
            label="Conversão"
            value={detailed?.conversionRate ?? 0}
            previous={stats.prevConversionRate ?? 0}
            suffix="%"
            icon={TrendingUp}
          />
          <MetricCard
            label="Leads do site"
            value={detailed?.siteLeads ?? 0}
            previous={stats.prevConversions}
            icon={MousePointerClick}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
          <Card className="app-card overflow-hidden xl:col-span-8">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <CardTitle className="flex items-center gap-2 text-sm font-normal text-[var(--app-text-primary)]">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Evolução de visitas
                </CardTitle>
                <span className="text-xs text-[var(--app-text-tertiary)]">
                  {stats.totalPages} visualizações
                </span>
              </div>
            </CardHeader>
            <CardContent>
              <div className="h-72 min-h-[288px] min-w-[1px]">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  minWidth={1}
                  minHeight={1}
                  initialDimension={{ width: 800, height: 256 }}
                >
                  <AreaChart
                    data={chartData}
                    margin={{ top: 8, right: 12, left: -18, bottom: 0 }}
                    accessibilityLayer
                  >
                    <defs>
                      <linearGradient
                        id="siteVisitsGradient"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop
                          offset="5%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0.24}
                        />
                        <stop
                          offset="95%"
                          stopColor="var(--chart-1)"
                          stopOpacity={0}
                        />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      vertical={false}
                      strokeDasharray="3 3"
                      stroke="var(--app-border)"
                    />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      cursor={{
                        stroke: "var(--muted-foreground)",
                        strokeWidth: 1,
                        strokeDasharray: "4 4",
                      }}
                      content={<SiteVisitsTooltip />}
                    />
                    <Area
                      type="monotone"
                      dataKey="views"
                      name="Visitas"
                      stroke="var(--chart-1)"
                      strokeWidth={2.5}
                      fill="url(#siteVisitsGradient)"
                      fillOpacity={1}
                      dot={false}
                      activeDot={{
                        r: 4,
                        fill: "var(--chart-1)",
                        stroke: "var(--app-surface-solid)",
                        strokeWidth: 2,
                      }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="app-card xl:col-span-4">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-normal text-[var(--app-text-primary)]">
                <Activity className="h-4 w-4 text-primary" />
                Qualidade da visita
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 px-4 pb-4">
              <QualityRow
                icon={Clock3}
                label="Tempo médio"
                value={formatDuration(stats.avgDuration)}
              />
              <QualityRow
                icon={PanelsTopLeft}
                label="Páginas por sessão"
                value={(detailed?.pagesPerSession ?? 0).toLocaleString("pt-BR")}
              />
              <QualityRow
                icon={TrendingUp}
                label="Taxa de rejeição"
                value={`${detailed?.bounceRate ?? 0}%`}
              />
              <QualityRow
                icon={Activity}
                label="Ativos agora"
                value={detailed?.liveVisitors ?? 0}
                accent
              />
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DistributionDonut
            title="Aquisição de tráfego"
            description="Distribuição das sessões por canal de entrada."
            icon={Megaphone}
            items={sourceData.filter((item) => item.value > 0)}
            total={stats.uniqueSessions}
            totalLabel="Sessões"
          />
          <DistributionDonut
            title="Dispositivos"
            description="Como os visitantes acessaram o site."
            icon={PieChartIcon}
            items={deviceData}
            total={stats.uniqueSessions}
            totalLabel="Acessos"
          />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(detailed?.topProperties?.length ?? 0) > 0 && (
            <Card className="app-card">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-normal text-[var(--app-text-primary)]">
                  <Star className="h-4 w-4 text-primary" />
                  Imóveis Mais Vistos
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Código</TableHead>
                      <TableHead>Título</TableHead>
                      <TableHead className="text-right">Views</TableHead>
                      <TableHead className="text-right">Favoritos</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailed!.topProperties.map((prop, i) => (
                      <TableRow key={prop.property_id}>
                        <TableCell className="font-light text-muted-foreground">
                          {i + 1}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {prop.code}
                        </TableCell>
                        <TableCell className="max-w-[200px] truncate">
                          {prop.title}
                        </TableCell>
                        <TableCell className="text-right font-normal">
                          {prop.views}
                        </TableCell>
                        <TableCell className="text-right">
                          {prop.favorites}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {(detailed?.topPages?.length ?? 0) > 0 && (
            <Card
              className={`app-card ${(detailed?.topProperties?.length ?? 0) === 0 ? "lg:col-span-2" : ""}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-normal text-[var(--app-text-primary)]">
                  <FileText className="h-4 w-4 text-primary" />
                  Páginas Mais Acessadas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-3 pb-3">
                {detailed!.topPages.map((page, i) => (
                  <RankingRow
                    key={page.page_path}
                    rank={i + 1}
                    label={page.page_path}
                    value={page.views}
                    valueLabel="views"
                    href={
                      getSitePublicPageUrl(siteBaseUrl, page.page_path) ||
                      undefined
                    }
                  />
                ))}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(detailed?.campaigns?.length ?? 0) > 0 && (
            <Card
              className={`app-card ${(detailed?.searchTerms?.length ?? 0) === 0 ? "lg:col-span-2" : ""}`}
            >
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-normal text-[var(--app-text-primary)]">
                  Origem e campanhas
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 px-3 pb-3">
                {detailed!.campaigns.map((item, index) => (
                  <CampaignRow
                    key={`${item.source}:${item.campaign}`}
                    rank={index + 1}
                    source={item.source}
                    campaign={item.campaign}
                    sessions={item.sessions}
                    conversions={item.conversions}
                  />
                ))}
              </CardContent>
            </Card>
          )}
          {(detailed?.searchTerms?.length ?? 0) > 0 && (
            <Card className="app-card">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-normal text-[var(--app-text-primary)]">
                  Buscas mais realizadas
                </CardTitle>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Busca</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detailed!.searchTerms.map((item) => (
                      <TableRow key={item.term}>
                        <TableCell className="max-w-[280px] truncate">
                          {item.term}
                        </TableCell>
                        <TableCell className="text-right font-normal">
                          {item.searches}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </div>
          </>
        )}
      </TabsContent>

      <TabsContent value="journeys" className="mt-0 min-w-0 space-y-4">
        <LeadJourneyDashboard dateFrom={dateFrom} dateTo={dateTo} />
      </TabsContent>
    </Tabs>
  );
}

function SiteVisitsTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { fullDate?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const value = Number(payload[0]?.value || 0);
  const title = payload[0]?.payload?.fullDate || label;

  return (
    <div className="min-w-[140px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3 text-[var(--app-text-primary)] shadow-none">
      <p className="mb-2 text-[11px] font-light text-[var(--app-text-secondary)]">
        {title}
      </p>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Visitas</span>
        </div>
        <span className="text-xs font-normal tabular-nums text-foreground">
          {value}
        </span>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  previous,
  suffix = "",
  icon: Icon,
}: {
  label: string;
  value: number;
  previous: number;
  suffix?: string;
  icon: typeof Users;
}) {
  return (
    <Card className="app-card overflow-hidden !bg-[var(--app-surface-soft)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
              {label}
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-2xl font-normal leading-none text-[var(--app-text-primary)]">
                {value}
                {suffix}
              </span>
              {getTrendIcon(value, previous)}
            </div>
            <p
              className={`mt-2 text-xs font-light ${getTrendColor(value, previous)}`}
            >
              Anterior: {previous}
              {suffix}
            </p>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/10">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QualityRow({
  icon: Icon,
  label,
  value,
  accent = false,
}: {
  icon: typeof Users;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-3 border-b border-[var(--app-border)] py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
          <Icon className="h-3.5 w-3.5 text-[var(--app-text-secondary)]" />
        </div>
        <span className="truncate text-xs text-[var(--app-text-secondary)]">
          {label}
        </span>
      </div>
      <span
        className={
          accent
            ? "text-lg font-normal text-primary"
            : "text-lg font-normal text-[var(--app-text-primary)]"
        }
      >
        {value}
      </span>
    </div>
  );
}

function DistributionDonut({
  title,
  description,
  icon: Icon,
  items,
  total,
  totalLabel,
}: {
  title: string;
  description: string;
  icon: typeof Users;
  items: Array<{
    name: string;
    value: number;
    color: string;
    icon?: typeof Users;
  }>;
  total: number;
  totalLabel: string;
}) {
  const chartItems = items.length
    ? items
    : [{ name: "Sem dados", value: 1, color: "var(--app-surface-soft)" }];

  return (
    <Card className="app-card overflow-hidden">
      <CardHeader className="pb-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-normal text-[var(--app-text-primary)]">
              {title}
            </CardTitle>
            <p className="mt-1 text-[11px] text-[var(--app-text-tertiary)]">
              {description}
            </p>
          </div>
          <Icon className="h-4 w-4 shrink-0 text-primary" />
        </div>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-3 px-4 pb-4 sm:grid-cols-[190px_minmax(0,1fr)] sm:items-center">
        <div
          className="dashboard-recharts-focusless relative mx-auto h-[176px] w-[176px]"
          role="img"
          aria-label={`${title}: ${items.length > 0 ? items.map((item) => `${item.name}, ${item.value}%`).join("; ") : "sem dados no período"}`}
        >
          <ResponsiveContainer
            width="100%"
            height="100%"
            minWidth={1}
            minHeight={1}
            initialDimension={{ width: 176, height: 176 }}
          >
            <PieChart accessibilityLayer>
              <Pie
                data={chartItems}
                dataKey="value"
                nameKey="name"
                innerRadius="57%"
                outerRadius="88%"
                paddingAngle={items.length > 1 ? 3 : 0}
                stroke="transparent"
                strokeWidth={0}
              >
                {chartItems.map((item) => (
                  <Cell key={item.name} fill={item.color} />
                ))}
              </Pie>
              <Tooltip
                cursor={false}
                content={<PercentTooltip />}
                wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-normal leading-none text-[var(--app-text-primary)]">
              {total}
            </span>
            <span className="mt-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
              {totalLabel}
            </span>
          </div>
        </div>
        <div className="min-w-0 space-y-3">
          {items.map((item) => {
            const ItemIcon = item.icon;
            return (
              <div key={item.name} className="min-w-0 text-xs">
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  {ItemIcon && (
                    <ItemIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-secondary)]" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[var(--app-text-secondary)]">
                    {item.name}
                  </span>
                  <span className="font-normal tabular-nums text-[var(--app-text-primary)]">
                    {item.value}%
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(3, Math.min(100, item.value))}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </div>
            );
          })}
          {items.length === 0 && (
            <p className="text-xs text-[var(--app-text-tertiary)]">
              Sem dados no período.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RankingRow({
  rank,
  label,
  value,
  valueLabel,
  href,
}: {
  rank: number;
  label: string;
  value: number;
  valueLabel: string;
  href?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-[6px] px-2 py-2.5 hover:bg-[var(--app-surface-soft)]">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[11px] font-normal text-[var(--app-text-secondary)]">
        {rank}
      </span>
      <span
        className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--app-text-secondary)]"
        title={label}
      >
        {label}
      </span>
      <span className="shrink-0 text-right">
        <strong className="text-sm font-normal text-[var(--app-text-primary)]">
          {value}
        </strong>
        <span className="ml-1 text-[10px] text-[var(--app-text-tertiary)]">
          {valueLabel}
        </span>
      </span>
      {href && (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-[6px] shadow-none hover:bg-[var(--app-surface-hover)]"
        >
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Abrir ${label} no site`}
            title="Abrir página no site"
          >
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </Button>
      )}
    </div>
  );
}

function CampaignRow({
  rank,
  source,
  campaign,
  sessions,
  conversions,
}: {
  rank: number;
  source: string;
  campaign: string;
  sessions: number;
  conversions: number;
}) {
  return (
    <div className="grid min-w-0 grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] px-2 py-2.5 hover:bg-[var(--app-surface-soft)]">
      <span className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[11px] font-normal text-[var(--app-text-secondary)]">
        {rank}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs font-normal text-[var(--app-text-primary)]">
          {campaign || "Sem campanha"}
        </p>
        <p className="mt-0.5 truncate text-[10px] text-[var(--app-text-tertiary)]">
          {source || "Origem não informada"}
        </p>
      </div>
      <div className="flex shrink-0 gap-3 text-right">
        <div>
          <p className="text-sm font-normal text-[var(--app-text-primary)]">
            {sessions}
          </p>
          <p className="text-[9px] text-[var(--app-text-tertiary)]">sessões</p>
        </div>
        <div>
          <p className="text-sm font-normal text-primary">{conversions}</p>
          <p className="text-[9px] text-[var(--app-text-tertiary)]">leads</p>
        </div>
      </div>
    </div>
  );
}

function PercentTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{
    name?: string;
    value?: number;
    payload?: { name?: string };
  }>;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  return (
    <div className="rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-primary)] shadow-none">
      <span className="text-[var(--app-text-secondary)]">
        {item.payload?.name || item.name}:{" "}
      </span>
      <strong className="font-normal">{Number(item.value || 0)}%</strong>
    </div>
  );
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}min ${remainder}s`;
}
