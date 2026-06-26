import { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useSiteAnalytics, useSiteAnalyticsDetailed } from '@/hooks/use-site-analytics';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Eye, MousePointerClick, Monitor, ArrowUpRight, ArrowDownRight, Minus, BarChart3, TrendingUp, Star, FileText, Users, Route, ExternalLink } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LeadJourneyDashboard } from './LeadJourneyDashboard';
import { DateFilterPopover } from '@/components/ui/date-filter-popover';
import { DatePreset, getDateRangeFromPreset } from '@/hooks/use-dashboard-filters';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { siteAPI } from '@/lib/api/site';

function getTrendIcon(current: number, previous: number) {
  if (current > previous) return <ArrowUpRight className="w-3 h-3 text-emerald-500" />;
  if (current < previous) return <ArrowDownRight className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-muted-foreground" />;
}

function getTrendColor(current: number, previous: number) {
  if (current > previous) return 'text-emerald-500';
  if (current < previous) return 'text-red-500';
  return 'text-muted-foreground';
}

function useSiteBaseUrl() {
  const { profile, organization } = useAuth();
  const organizationId = organization?.id || profile?.organization_id || undefined;
  const { data: siteInfo } = useQuery({
    queryKey: ['org-site-info', organizationId],
    queryFn: async () => {
      if (!organizationId) return null;
      return siteAPI.getSite(organizationId);
    },
    enabled: !!organizationId,
  });

  if (siteInfo?.custom_domain && siteInfo?.domain_verified) {
    return `https://${siteInfo.custom_domain}`;
  }
  if (siteInfo?.subdomain) {
    return `https://vimob.vettercompany.com.br/sites/${siteInfo.subdomain}`;
  }
  return null;
}

export function SiteAnalyticsTab() {
  const [datePreset, setDatePreset] = useState<DatePreset>('last7days');
  const siteBaseUrl = useSiteBaseUrl();
  const [customDateRange, setCustomDateRange] = useState<{ from: Date; to: Date } | null>(null);

  const { dateFrom, dateTo } = useMemo(() => {
    if (datePreset === 'custom' && customDateRange) {
      return { dateFrom: customDateRange.from, dateTo: customDateRange.to };
    }

    const range = getDateRangeFromPreset(datePreset);
    return { dateFrom: range.from, dateTo: range.to };
  }, [datePreset, customDateRange]);

  const { data, isLoading } = useSiteAnalytics(dateFrom, dateTo);
  const { data: detailed } = useSiteAnalyticsDetailed(dateFrom, dateTo);

  const chartData = useMemo(() => {
    const dailyViews = new Map(
      (detailed?.dailyViews || []).map(d => [new Date(d.date).toISOString().slice(0, 10), d.views])
    );

    const start = new Date(dateFrom);
    const end = new Date(dateTo);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    const days: Array<{ date: string; fullDate: string; views: number }> = [];
    for (const cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
      const key = cursor.toISOString().slice(0, 10);
      days.push({
        date: cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
        fullDate: cursor.toLocaleDateString('pt-BR'),
        views: dailyViews.get(key) || 0,
      });
    }

    return days;
  }, [detailed?.dailyViews, dateFrom, dateTo]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-48" />
          <Skeleton className="h-48" />
        </div>
      </div>
    );
  }

  const stats = data || {
    totalViews: 0, totalPages: 0, uniquePages: 0, uniqueSessions: 0, avgDuration: 0,
    desktopPct: 0, mobilePct: 0, tabletPct: 0,
    directPct: 0, searchPct: 0, socialPct: 0, campaignPct: 0,
    conversions: 0,
    prevViews: 0, prevPages: 0, prevUniquePages: 0, prevAvgDuration: 0,
    prevDesktopPct: 0, prevMobilePct: 0, prevConversions: 0,
  };

  const hasData = stats.uniqueSessions > 0 || stats.totalPages > 0 || (detailed?.totalSessions ?? 0) > 0;
  const handleDatePresetChange = (preset: DatePreset | null) => {
    setDatePreset(preset || 'last7days');
  };

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <TabsList>
          <TabsTrigger value="overview" className="gap-1.5">
            <BarChart3 className="w-4 h-4" />
            Visão Geral
          </TabsTrigger>
          <TabsTrigger value="journeys" className="gap-1.5">
            <Route className="w-4 h-4" />
            Percurso dos Leads
          </TabsTrigger>
        </TabsList>

        <DateFilterPopover
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          defaultPreset="last7days"
        />
      </div>

      <TabsContent value="overview" className="space-y-6">
        {!hasData && (
          <Card className="app-card border-dashed border-white/[0.08]">
            <CardContent className="p-6 text-center">
              <BarChart3 className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
              <p className="font-semibold mb-1">Nenhum dado registrado ainda</p>
              <p className="text-sm text-muted-foreground">
                Os dados aparecerão automaticamente quando visitantes acessarem seu site público. Certifique-se de que o site está ativo e publicado.
              </p>
            </CardContent>
          </Card>
        )}


        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <MetricCard label="Sessões" value={stats.uniqueSessions} previous={stats.prevViews} icon={Users} />
          <MetricCard label="Páginas vistas" value={stats.totalPages} previous={stats.prevPages} icon={Eye} />
          <MetricCard label="Conversão" value={detailed?.conversionRate ?? 0} previous={stats.prevConversions} suffix="%" icon={TrendingUp} />
          <MetricCard label="Leads do site" value={detailed?.siteLeads ?? 0} previous={stats.prevConversions} icon={MousePointerClick} />
        </div>

        <div className="hidden">
        <Card className="app-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Eye className="w-4 h-4 text-primary" />
              Visitas no site
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <StatBlock label="Sessões" current={stats.uniqueSessions} previous={stats.prevViews} />
              <StatBlock label="Páginas vistas" current={stats.totalPages} previous={stats.prevPages} />
              <StatBlock label="Páginas únicas" current={stats.uniquePages} previous={stats.prevUniquePages} />
              <StatBlock label="Tempo médio" current={stats.avgDuration} previous={stats.prevAvgDuration} suffix="s" />
            </div>
          </CardContent>
        </Card>

        <Card className="app-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-primary" />
              Entradas
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
              <StatBlock label="Link direto" current={stats.directPct} previous={0} suffix="%" hideArrow />
              <StatBlock label="Busca" current={stats.searchPct} previous={0} suffix="%" hideArrow />
              <StatBlock label="Campanhas" current={stats.campaignPct} previous={0} suffix="%" hideArrow />
              <StatBlock label="Redes sociais" current={stats.socialPct} previous={0} suffix="%" hideArrow />
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Monitor className="w-4 h-4 text-primary" />
                Dispositivos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 gap-6">
                <StatBlock label="Web" current={stats.desktopPct} previous={stats.prevDesktopPct} suffix="%" />
                <StatBlock label="Mobile" current={stats.mobilePct} previous={stats.prevMobilePct} suffix="%" />
              </div>
            </CardContent>
          </Card>

          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Taxa de Conversão
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <span className="text-3xl font-bold">{detailed?.conversionRate ?? 0}%</span>
                <p className="text-xs text-muted-foreground mt-1">{detailed?.totalConversions ?? 0} conversões / {detailed?.totalSessions ?? 0} sessões</p>
              </div>
            </CardContent>
          </Card>

          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Leads do Site
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-center">
                <span className="text-3xl font-bold">{detailed?.siteLeads ?? 0}</span>
                <p className="text-xs text-muted-foreground mt-1">leads gerados via site</p>
              </div>
            </CardContent>
          </Card>
        </div>
        </div>

        <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Evolução de Visitas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <AreaChart data={chartData} margin={{ top: 8, right: 12, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="siteVisitsGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--border)" />
                    <XAxis
                      dataKey="date"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    />
                    <Tooltip
                      cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1, strokeDasharray: '4 4' }}
                      content={<SiteVisitsTooltip />}
                    />
                    <Area
                      type="monotone"
                      dataKey="views"
                      name="Visitas"
                      stroke="var(--primary)"
                      strokeWidth={2.5}
                      fill="url(#siteVisitsGradient)"
                      fillOpacity={1}
                      dot={{ r: 3, fill: 'var(--background)', stroke: 'var(--primary)', strokeWidth: 2 }}
                      activeDot={{ r: 5, fill: 'var(--primary)', stroke: 'var(--background)', strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(detailed?.topProperties?.length ?? 0) > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Star className="w-4 h-4 text-primary" />
                Imóveis Mais Vistos
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
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
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs">{prop.code}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{prop.title}</TableCell>
                      <TableCell className="text-right font-semibold">{prop.views}</TableCell>
                      <TableCell className="text-right">{prop.favorites}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}

        {(detailed?.topPages?.length ?? 0) > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Páginas Mais Acessadas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Página</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    {siteBaseUrl && <TableHead className="w-12" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detailed!.topPages.map((page, i) => (
                    <TableRow key={page.page_path}>
                      <TableCell className="font-medium text-muted-foreground">{i + 1}</TableCell>
                      <TableCell className="font-mono text-xs max-w-[300px] truncate">{page.page_path}</TableCell>
                      <TableCell className="text-right font-semibold">{page.views}</TableCell>
                      {siteBaseUrl && (
                        <TableCell className="text-right p-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => window.open(`${siteBaseUrl}${page.page_path}`, '_blank')}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
        </div>
      </TabsContent>

      <TabsContent value="journeys" className="space-y-6">
        <LeadJourneyDashboard dateFrom={dateFrom} dateTo={dateTo} />
      </TabsContent>
    </Tabs>
  );
}

function SiteVisitsTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ value?: number; payload?: { fullDate?: string } }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;

  const value = Number(payload[0]?.value || 0);
  const title = payload[0]?.payload?.fullDate || label;

  return (
    <div className="min-w-[140px] rounded-xl border border-white/[0.055] bg-[#171717]/95 p-3 text-popover-foreground shadow-xl backdrop-blur-md">
      <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">{title}</p>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary" />
          <span className="text-xs text-muted-foreground">Visitas</span>
        </div>
        <span className="text-xs font-semibold tabular-nums text-foreground">{value}</span>
      </div>
    </div>
  );
}

function MetricCard({ label, value, previous, suffix = '', icon: Icon }: {
  label: string;
  value: number;
  previous: number;
  suffix?: string;
  icon: typeof Users;
}) {
  return (
    <Card className="app-card overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase text-muted-foreground">{label}</p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-2xl font-bold leading-none">{value}{suffix}</span>
              {getTrendIcon(value, previous)}
            </div>
            <p className={`text-xs font-medium mt-2 ${getTrendColor(value, previous)}`}>
              Anterior: {previous}{suffix}
            </p>
          </div>
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4 text-primary" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StatBlock({ label, current, previous, suffix = '', hideArrow = false }: {
  label: string;
  current: number;
  previous: number;
  suffix?: string;
  hideArrow?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <span className="text-xl font-bold">{current}{suffix}</span>
        {!hideArrow && getTrendIcon(current, previous)}
      </div>
      <p className="text-[11px] text-muted-foreground mt-0.5">Atual</p>
      {!hideArrow && (
        <>
          <p className={`text-sm font-medium mt-2 ${getTrendColor(current, previous)}`}>
            {previous}{suffix}
          </p>
          <p className="text-[11px] text-muted-foreground">Anterior</p>
        </>
      )}
    </div>
  );
}
