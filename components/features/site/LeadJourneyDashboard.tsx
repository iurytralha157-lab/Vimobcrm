import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeadAnalytics } from '@/hooks/use-lead-analytics';
import { ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid, AreaChart, Area } from 'recharts';
import { Route, MousePointerClick, Users, TrendingUp, FileText, Monitor, CheckCircle, Eye, ExternalLink, Smartphone, Globe, MapPin, Activity, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { useState } from 'react';
import type { LeadJourney } from '@/hooks/use-lead-analytics';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { siteAPI } from '@/lib/api/site';
import { VisitorMap } from './VisitorMap';
import { getSitePublicUrl } from '@/lib/site/site-publication';

const EVENT_LABELS: Record<string, string> = {
  pageview: 'Visualização',
	page_view: 'Visualização',
	property_view: 'Imóvel visualizado',
	property_search: 'Busca realizada',
	form_submit: 'Formulário enviado',
  whatsapp_click: 'WhatsApp',
	cta_click: 'Clique em chamada',
  favorite: 'Favorito',
};

const FUNNEL_ORDER = ['pageview', 'page_view', 'property_search', 'property_view', 'favorite', 'cta_click', 'whatsapp_click', 'form_submit'];

interface LeadJourneyDashboardProps {
  dateFrom: Date;
  dateTo: Date;
}

function getJourneyOrigin(journey: LeadJourney) {
  if (journey.utm_source?.trim()) return journey.utm_source.trim();
  if (!journey.referrer?.trim()) return 'Direto';
  try {
    return new URL(journey.referrer).hostname.replace(/^www\./, '') || 'Referência';
  } catch {
    return journey.referrer;
  }
}

function FunnelStage({ item, index, max }: { item: { name: string; total: number }; index: number; max: number }) {
	const width = Math.max(36, Math.round((item.total / max) * 100));
	const intensity = Math.max(16, 34 - index * 3);
	return (
	  <div
		className="mx-auto flex min-h-9 items-center justify-between gap-3 rounded-[6px] px-3 text-xs"
		style={{ width: `${width}%`, background: `color-mix(in srgb, var(--chart-1) ${intensity}%, var(--app-surface-soft))` }}
	  >
		<span className="truncate text-[var(--app-text-primary)]">{item.name}</span>
		<span className="shrink-0 font-medium text-[var(--app-text-primary)]">{item.total}</span>
	  </div>
	);
}

export function LeadJourneyDashboard({ dateFrom, dateTo }: LeadJourneyDashboardProps) {
  const { data, isLoading } = useLeadAnalytics(dateFrom, dateTo);
  const [selectedJourney, setSelectedJourney] = useState<LeadJourney | null>(null);
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

  const siteBaseUrl = getSitePublicUrl({
    customDomain: siteInfo?.custom_domain,
    domainVerified: siteInfo?.domain_verified,
    subdomain: siteInfo?.subdomain,
  });

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const analytics = data || {
    journeys: [] as LeadJourney[], funnel: [] as { event_type: string; total: number }[], top_pages: [] as { page_path: string; views: number }[], daily_views: [] as { date: string; views: number }[],
    total_sessions: 0, total_conversions: 0, device_breakdown: [] as { device_type: string; total: number }[], locations: [] as { city: string; region: string | null; country: string | null; lat: number | null; lng: number | null; sessions: number }[],
  };

  const conversionRate = analytics.total_sessions > 0
    ? ((analytics.total_conversions / analytics.total_sessions) * 100).toFixed(1)
    : '0';

	const funnelData = analytics.funnel.map(f => ({
    name: EVENT_LABELS[f.event_type] || f.event_type,
	  eventType: f.event_type,
    total: f.total,
	})).sort((a, b) => {
	  const aIndex = FUNNEL_ORDER.indexOf(a.eventType);
	  const bIndex = FUNNEL_ORDER.indexOf(b.eventType);
	  return (aIndex === -1 ? 99 : aIndex) - (bIndex === -1 ? 99 : bIndex);
	});

  const chartData = analytics.daily_views.map(d => ({
    date: format(new Date(d.date), 'dd/MM', { locale: ptBR }),
    views: d.views,
  }));

	const totalInteractions = analytics.funnel.reduce((acc, item) => acc + item.total, 0);
	const funnelMax = Math.max(...funnelData.map(item => item.total), 1);

  return (
    <div className="space-y-6">

	  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
		<Card className="app-card !bg-[var(--app-surface-soft)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
			  <Users className="h-4 w-4 text-[#FF4529]" />
              <span className="text-xs text-muted-foreground">Sessões</span>
            </div>
			<span className="text-2xl font-semibold text-[var(--app-text-primary)]">{analytics.total_sessions}</span>
          </CardContent>
        </Card>
		<Card className="app-card !bg-[var(--app-surface-soft)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
			  <MousePointerClick className="h-4 w-4 text-[#FF4529]" />
              <span className="text-xs text-muted-foreground">Conversões</span>
            </div>
			<span className="text-2xl font-semibold text-[var(--app-text-primary)]">{analytics.total_conversions}</span>
          </CardContent>
        </Card>
		<Card className="app-card !bg-[var(--app-surface-soft)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
			  <TrendingUp className="h-4 w-4 text-[#FF4529]" />
              <span className="text-xs text-muted-foreground">Taxa de Conversão</span>
            </div>
			<span className="text-2xl font-semibold text-[var(--app-text-primary)]">{conversionRate}%</span>
          </CardContent>
        </Card>
		<Card className="app-card !bg-[var(--app-surface-soft)]">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
			  <Activity className="h-4 w-4 text-[#FF4529]" />
			  <span className="text-xs text-muted-foreground">Interações</span>
			</div>
			<span className="text-2xl font-semibold text-[var(--app-text-primary)]">{totalInteractions}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
        {funnelData.length > 0 && (
          <Card className="app-card flex h-full min-h-[430px] flex-col overflow-hidden">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MousePointerClick className="w-4 h-4 text-primary" />
				Funil de interação
              </CardTitle>
            </CardHeader>
            <CardContent>
			  <div className="flex min-h-[192px] flex-col justify-center gap-2.5">
				{funnelData.map((item, index) => (
				  <FunnelStage key={`${item.eventType}:${item.name}`} item={item} index={index} max={funnelMax} />
				))}
			  </div>
            </CardContent>
          </Card>
        )}

        {chartData.length > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
				Evolução diária
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48 min-h-[192px] min-w-[1px]">
				<ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={{ width: 640, height: 192 }}>
				  <AreaChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
					<defs><linearGradient id="journeyViews" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--chart-1)" stopOpacity={0.24} /><stop offset="95%" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
					<CartesianGrid vertical={false} strokeDasharray="3 3" stroke="var(--app-border)" />
					<XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--app-text-tertiary)' }} />
					<YAxis axisLine={false} tickLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--app-text-tertiary)' }} />
					<Tooltip contentStyle={{ border: 0, borderRadius: 8, fontSize: 12, background: 'var(--app-surface-solid)', color: 'var(--app-text-primary)', boxShadow: 'none' }} />
					<Area type="monotone" dataKey="views" name="Visitas" stroke="var(--chart-1)" strokeWidth={2.5} fill="url(#journeyViews)" dot={false} activeDot={{ r: 4, fill: 'var(--chart-1)', stroke: 'var(--app-surface-solid)', strokeWidth: 2 }} />
				  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {analytics.top_pages.length > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                Páginas Mais Acessadas
              </CardTitle>
            </CardHeader>
            <CardContent className="app-scrollbar h-[350px] flex-1 space-y-1 overflow-y-auto px-3 pb-3">
              {analytics.top_pages.map((page, i) => (
                <div key={page.page_path} className="flex min-w-0 items-center gap-3 rounded-[7px] px-2 py-2.5 hover:bg-[var(--app-surface-soft)]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[11px] font-semibold text-[var(--app-text-secondary)]">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-[var(--app-text-secondary)]" title={page.page_path}>{page.page_path}</span>
                  <span className="shrink-0"><strong className="text-sm font-semibold text-[var(--app-text-primary)]">{page.views}</strong><span className="ml-1 text-[10px] text-[var(--app-text-tertiary)]">views</span></span>
                  {siteBaseUrl && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 rounded-[6px] shadow-none hover:bg-[var(--app-surface-hover)]" aria-label={`Abrir ${page.page_path} no site`} title="Abrir página no site" onClick={() => window.open(`${siteBaseUrl}${page.page_path}`, '_blank')}><ExternalLink className="h-3.5 w-3.5" /></Button>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Visitor Location Map */}
        <Card className="app-card flex h-full min-h-[430px] flex-col overflow-hidden">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              Mapa de Visitantes
            </CardTitle>
          </CardHeader>
		  <CardContent className="p-2">
			<div className="h-[350px]">
			  <VisitorMap locations={analytics.locations} />
			</div>
            {analytics.locations.length > 0 && (
              <div className="mt-3 space-y-1.5 max-h-[120px] overflow-y-auto">
                {analytics.locations.slice(0, 10).map((loc, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-2">
                    <span className="text-muted-foreground">
                      {loc.city}{loc.region ? `, ${loc.region}` : ''}
                    </span>
                    <Badge variant="secondary" className="text-[10px]">
                      {loc.sessions} sessão{loc.sessions > 1 ? 'es' : ''}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Journeys - Full Width */}
      {analytics.journeys.length > 0 && (
        <Card className="app-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              Últimas Jornadas
            </CardTitle>
          </CardHeader>
          <CardContent className="max-h-[620px] space-y-1 overflow-y-auto px-3 pb-3">
            {analytics.journeys.slice(0, 20).map((j) => {
              const eventNames = [...new Set(j.event_sequence)].map(evt => EVENT_LABELS[evt] || evt);
              const firstPath = j.path_sequence[0] || 'Página não identificada';
              const lastPath = j.path_sequence[j.path_sequence.length - 1] || firstPath;
              const journeyOrigin = getJourneyOrigin(j);
              return (
                  <div key={j.session_id} className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-2 rounded-[7px] px-3 py-3 hover:bg-[var(--app-surface-soft)] md:grid-cols-[110px_minmax(0,1fr)_180px_110px_32px] md:items-center', j.converted && 'bg-emerald-500/[0.05]')}>
                  <div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', j.converted ? 'bg-emerald-500' : 'bg-[#FF4529]')} /><div><p className="font-mono text-xs text-[var(--app-text-primary)]">{j.session_id.substring(0, 8)}</p><p className="text-[10px] text-[var(--app-text-tertiary)]">{format(new Date(j.first_event), 'dd/MM HH:mm', { locale: ptBR })}</p></div></div>
                  <div className="col-span-2 flex min-w-0 items-start gap-2 font-mono text-[11px] text-[var(--app-text-secondary)] md:col-span-1 md:items-center"><span className="min-w-0 break-all md:truncate" title={firstPath}>{firstPath}</span>{j.path_sequence.length > 1 && <><ArrowRight className="mt-0.5 h-3 w-3 shrink-0 text-[#FF4529] md:mt-0" /><span className="min-w-0 break-all md:truncate" title={lastPath}>{lastPath}</span></>}</div>
                  <div className="col-span-2 min-w-0 text-[11px] text-[var(--app-text-tertiary)] md:col-span-1">
                    <p className="break-words md:truncate" title={eventNames.join(', ')}>{eventNames.join(' · ') || 'Sem eventos'}</p>
                    <p className="mt-0.5 flex min-w-0 items-center gap-1"><Globe className="h-3 w-3 shrink-0" /><span className="truncate">{journeyOrigin}</span></p>
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-[var(--app-text-secondary)]">{j.converted && <CheckCircle className="h-3.5 w-3.5 text-emerald-500" />}<span>{j.total_events} eventos</span></div>
                  <Button variant="ghost" size="icon" className="col-start-2 row-start-1 h-7 w-7 rounded-[6px] shadow-none hover:bg-[var(--app-surface-hover)] md:col-start-auto md:row-start-auto" aria-label={`Ver jornada da sessão ${j.session_id.substring(0, 8)}`} title="Ver detalhes da jornada" onClick={() => setSelectedJourney(j)}><Eye className="h-4 w-4" /></Button>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {analytics.journeys.length === 0 && analytics.total_sessions === 0 && (
		<Card className="app-card !bg-[var(--app-surface-soft)]">
          <CardContent className="p-6 text-center">
            <Route className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="font-semibold mb-1">Nenhuma jornada registrada ainda</p>
            <p className="text-sm text-muted-foreground">
              Os dados aparecerão quando visitantes navegarem pelo site público.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Session Detail Dialog */}
      <Dialog open={!!selectedJourney} onOpenChange={(open) => !open && setSelectedJourney(null)}>
        <DialogContent className="z-[200] max-h-[88dvh] w-[calc(100vw-24px)] min-w-0 overflow-x-hidden overflow-y-auto rounded-[8px] p-4 shadow-none sm:max-w-lg sm:p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Route className="h-4 w-4 text-primary" />
              Jornada da Sessão
              {selectedJourney?.converted && (
                <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
                  Converteu
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Detalhes da navegação realizada nesta sessão do site.
            </DialogDescription>
          </DialogHeader>

          {selectedJourney && (
            <div className="space-y-4">
              {/* Session Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
				<div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Sessão</p>
                  <p className="font-mono text-xs">{selectedJourney.session_id.substring(0, 12)}...</p>
                </div>
				<div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Total de eventos</p>
                  <p className="font-semibold">{selectedJourney.total_events}</p>
                </div>
				<div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Primeira ação</p>
                  <p className="text-xs">{format(new Date(selectedJourney.first_event), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                </div>
				<div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Última ação</p>
                  <p className="text-xs">{format(new Date(selectedJourney.last_event), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                </div>
              </div>

              {/* Device & Location Info */}
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                {selectedJourney.device_type && (
				  <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                    <div className="flex items-center gap-1 mb-1">
                      {selectedJourney.device_type === 'mobile' ? (
                        <Smartphone className="h-3 w-3 text-muted-foreground" />
                      ) : (
                        <Monitor className="h-3 w-3 text-muted-foreground" />
                      )}
                      <p className="text-[10px] text-muted-foreground">Dispositivo</p>
                    </div>
                    <p className="text-xs font-medium capitalize">{selectedJourney.device_type}</p>
                  </div>
                )}
                {selectedJourney.browser && (
				  <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground">Navegador</p>
                    </div>
                    <p className="text-xs font-medium capitalize">{selectedJourney.browser}</p>
                  </div>
                )}
                {selectedJourney.os && (
				  <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Sistema</p>
                    <p className="text-xs font-medium">{selectedJourney.os}</p>
                  </div>
                )}
              </div>

              {/* City/Region */}
              {(selectedJourney.city || selectedJourney.region || selectedJourney.country) && (
				<div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-sm">
                  <div className="flex items-center gap-1 mb-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">Localização</p>
                  </div>
                  <p className="text-xs font-medium">
                    {[selectedJourney.city, selectedJourney.region, selectedJourney.country].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}

              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-sm">
                <div className="mb-1 flex items-center gap-1">
                  <Globe className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">Origem da sessão</p>
                </div>
                <p className="break-all text-xs font-medium">{getJourneyOrigin(selectedJourney)}</p>
              </div>

              {/* Events */}
              <div>
                <p className="text-xs font-medium mb-2">Tipos de evento</p>
                <div className="flex flex-wrap gap-x-3 gap-y-1.5 rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2.5">
                  {[...new Set(selectedJourney.event_sequence)].map((evt, idx) => (
                    <span key={idx} className="flex items-center gap-1.5 text-[11px] text-[var(--app-text-secondary)]"><span className="h-1.5 w-1.5 rounded-full bg-[#FF4529]" />{EVENT_LABELS[evt] || evt}</span>
                  ))}
                </div>
              </div>

              {/* Path Timeline */}
              <div>
                <p className="text-xs font-medium mb-2">Percurso completo ({selectedJourney.path_sequence.length} páginas)</p>
                <ScrollArea className="max-h-[260px]">
                  <div className="space-y-0">
                    {selectedJourney.path_sequence.map((path, idx) => {
                      const isLast = idx === selectedJourney.path_sequence.length - 1;
                      return (
                        <div key={idx} className="relative flex gap-3 pl-6">
                          {!isLast && (
							<div className="absolute bottom-0 left-2.5 top-5 w-px bg-[var(--app-border)]" />
                          )}
                          <div className={cn(
                            'absolute left-0 w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold',
                            idx === 0
                              ? 'bg-primary/15 text-primary'
                              : isLast
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
							  : 'bg-[var(--app-surface-soft)] text-muted-foreground'
                          )}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 pb-2.5 min-w-0">
                            <p className="whitespace-normal break-all font-mono text-xs">{path}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
