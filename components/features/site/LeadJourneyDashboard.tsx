import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { useLeadAnalytics } from '@/hooks/use-lead-analytics';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line } from 'recharts';
import { Route, MousePointerClick, Users, TrendingUp, FileText, Monitor, CheckCircle, XCircle, Eye, ExternalLink, Smartphone, Globe, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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

const EVENT_LABELS: Record<string, string> = {
  pageview: 'Visualização',
  form_submit: 'Formulário',
  whatsapp_click: 'WhatsApp',
  cta_click: 'CTA',
  favorite: 'Favorito',
};

interface LeadJourneyDashboardProps {
  dateFrom: Date;
  dateTo: Date;
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

  const siteBaseUrl = (() => {
    if (siteInfo?.custom_domain && siteInfo?.domain_verified) {
      return `https://${siteInfo.custom_domain}`;
    }
    if (siteInfo?.subdomain) {
      return `https://vimob.vettercompany.com.br/sites/${siteInfo.subdomain}`;
    }
    return null;
  })();

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
    total_sessions: 0, total_conversions: 0, device_breakdown: [] as { device_type: string; total: number }[], locations: [] as { city: string; region: string | null; lat: number; lng: number; sessions: number }[],
  };

  const conversionRate = analytics.total_sessions > 0
    ? ((analytics.total_conversions / analytics.total_sessions) * 100).toFixed(1)
    : '0';

  const funnelData = analytics.funnel.map(f => ({
    name: EVENT_LABELS[f.event_type] || f.event_type,
    total: f.total,
  }));

  const chartData = analytics.daily_views.map(d => ({
    date: format(new Date(d.date), 'dd/MM', { locale: ptBR }),
    views: d.views,
  }));

  const deviceTotal = analytics.device_breakdown.reduce((acc: number, d) => acc + d.total, 0);

  return (
    <div className="space-y-6">

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="app-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Sessões</span>
            </div>
            <span className="text-2xl font-bold">{analytics.total_sessions}</span>
          </CardContent>
        </Card>
        <Card className="app-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <MousePointerClick className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Conversões</span>
            </div>
            <span className="text-2xl font-bold">{analytics.total_conversions}</span>
          </CardContent>
        </Card>
        <Card className="app-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Taxa de Conversão</span>
            </div>
            <span className="text-2xl font-bold">{conversionRate}%</span>
          </CardContent>
        </Card>
        <Card className="app-card">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Monitor className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Dispositivos</span>
            </div>
            <div className="flex gap-2 text-xs">
              {analytics.device_breakdown.map(d => (
                <span key={d.device_type} className="text-muted-foreground">
                  {d.device_type === 'desktop' ? '💻' : d.device_type === 'mobile' ? '📱' : '📋'}
                  {deviceTotal > 0 ? Math.round((d.total / deviceTotal) * 100) : 0}%
                </span>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {funnelData.length > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <MousePointerClick className="w-4 h-4 text-primary" />
                Funil de Eventos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48 min-h-[192px] min-w-[1px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <BarChart data={funnelData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis type="number" tick={{ fontSize: 11 }} />
                    <YAxis dataKey="name" type="category" width={100} tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="total" name="Total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {chartData.length > 0 && (
          <Card className="app-card">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" />
                Evolução Diária
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-48 min-h-[192px] min-w-[1px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Line
                      type="monotone"
                      dataKey="views"
                      name="Views"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </LineChart>
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
            <CardContent className="p-0">
              <ScrollArea className="max-h-[400px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">#</TableHead>
                      <TableHead>Página</TableHead>
                      <TableHead className="text-right w-16">Views</TableHead>
                      {siteBaseUrl && <TableHead className="w-10" />}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {analytics.top_pages.map((page, i) => (
                      <TableRow key={page.page_path}>
                        <TableCell className="font-medium text-muted-foreground text-xs">{i + 1}</TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">{page.page_path}</TableCell>
                        <TableCell className="text-right font-semibold text-xs">{page.views}</TableCell>
                        {siteBaseUrl && (
                          <TableCell className="text-right p-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6"
                              onClick={() => window.open(`${siteBaseUrl}${page.page_path}`, '_blank')}
                            >
                              <ExternalLink className="h-3 w-3" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Visitor Location Map */}
        <Card className="app-card">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              Mapa de Visitantes
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {analytics.locations.length > 0 ? (
              <div className="h-[350px]">
                <VisitorMap locations={analytics.locations} />
              </div>
            ) : (
              <div className="h-[350px] flex flex-col items-center justify-center text-muted-foreground">
                <MapPin className="w-8 h-8 mb-2" />
                <p className="text-sm">Dados de localização aparecerão com novos acessos</p>
              </div>
            )}
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
            <CardTitle className="text-base flex items-center gap-2">
              <Route className="w-4 h-4 text-primary" />
              Últimas Jornadas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sessão</TableHead>
                  <TableHead>Percurso</TableHead>
                  <TableHead>Eventos</TableHead>
                  <TableHead>Entrada</TableHead>
                  <TableHead className="text-center">Converteu</TableHead>
                  <TableHead className="text-center">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.journeys.slice(0, 20).map((j) => {
                  const isConverted = j.converted;
                  return (
                  <TableRow key={j.session_id} className={cn(isConverted && 'bg-emerald-500/5')}>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {j.session_id.substring(0, 8)}...
                    </TableCell>
                    <TableCell className="max-w-[250px]">
                      <div className="flex flex-wrap gap-1">
                        {j.path_sequence.slice(0, 5).map((path, idx) => (
                          <Badge key={idx} variant="secondary" className="text-[10px] font-mono">
                            {path.length > 20 ? `${path.substring(0, 20)}…` : path}
                          </Badge>
                        ))}
                        {j.path_sequence.length > 5 && (
                          <Badge variant="outline" className="text-[10px]">
                            +{j.path_sequence.length - 5}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(j.event_sequence)].map((evt, idx) => (
                          <Badge key={idx} variant="outline" className="text-[10px]">
                            {EVENT_LABELS[evt as string] || String(evt)}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(j.first_event), 'dd/MM HH:mm', { locale: ptBR })}
                    </TableCell>
                    <TableCell className="text-center">
                      {j.converted ? (
                        <CheckCircle className="w-5 h-5 text-emerald-500 mx-auto" />
                      ) : (
                        <XCircle className="w-4 h-4 text-muted-foreground mx-auto" />
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setSelectedJourney(j)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {analytics.journeys.length === 0 && analytics.total_sessions === 0 && (
        <Card className="app-card border-dashed border-white/[0.08]">
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
        <DialogContent className="w-[90%] sm:max-w-lg sm:w-full rounded-lg">
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
          </DialogHeader>

          {selectedJourney && (
            <div className="space-y-4">
              {/* Session Info */}
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-white/[0.045] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Sessão</p>
                  <p className="font-mono text-xs">{selectedJourney.session_id.substring(0, 12)}...</p>
                </div>
                <div className="rounded-lg bg-white/[0.045] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Total de eventos</p>
                  <p className="font-semibold">{selectedJourney.total_events}</p>
                </div>
                <div className="rounded-lg bg-white/[0.045] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Primeira ação</p>
                  <p className="text-xs">{format(new Date(selectedJourney.first_event), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                </div>
                <div className="rounded-lg bg-white/[0.045] p-3">
                  <p className="text-[10px] text-muted-foreground mb-1">Última ação</p>
                  <p className="text-xs">{format(new Date(selectedJourney.last_event), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
                </div>
              </div>

              {/* Device & Location Info */}
              <div className="grid grid-cols-3 gap-3 text-sm">
                {selectedJourney.device_type && (
                  <div className="rounded-lg bg-white/[0.045] p-3">
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
                  <div className="rounded-lg bg-white/[0.045] p-3">
                    <div className="flex items-center gap-1 mb-1">
                      <Globe className="h-3 w-3 text-muted-foreground" />
                      <p className="text-[10px] text-muted-foreground">Navegador</p>
                    </div>
                    <p className="text-xs font-medium capitalize">{selectedJourney.browser}</p>
                  </div>
                )}
                {selectedJourney.os && (
                  <div className="rounded-lg bg-white/[0.045] p-3">
                    <p className="text-[10px] text-muted-foreground mb-1">Sistema</p>
                    <p className="text-xs font-medium">{selectedJourney.os}</p>
                  </div>
                )}
              </div>

              {/* City/Region */}
              {(selectedJourney.city || selectedJourney.region) && (
                <div className="rounded-lg bg-white/[0.045] p-3 text-sm">
                  <div className="flex items-center gap-1 mb-1">
                    <MapPin className="h-3 w-3 text-muted-foreground" />
                    <p className="text-[10px] text-muted-foreground">Localização</p>
                  </div>
                  <p className="text-xs font-medium">
                    {[selectedJourney.city, selectedJourney.region].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}

              {/* Events */}
              <div>
                <p className="text-xs font-medium mb-2">Tipos de evento</p>
                <div className="flex flex-wrap gap-1.5">
                  {[...new Set(selectedJourney.event_sequence)].map((evt, idx) => (
                    <Badge key={idx} variant="outline" className="text-xs">
                      {EVENT_LABELS[evt] || evt}
                    </Badge>
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
                            <div className="absolute left-2.5 top-5 bottom-0 w-px bg-white/[0.08]" />
                          )}
                          <div className={cn(
                            'absolute left-0 w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[9px] font-bold',
                            idx === 0
                              ? 'bg-primary/15 text-primary'
                              : isLast
                              ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                              : 'bg-white/[0.06] text-muted-foreground'
                          )}>
                            {idx + 1}
                          </div>
                          <div className="flex-1 pb-2.5 min-w-0">
                            <p className="font-mono text-xs truncate">{path}</p>
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
