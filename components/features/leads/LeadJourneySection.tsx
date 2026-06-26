import { useLeadJourney, JourneyEvent } from '@/hooks/use-lead-journey';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  Loader2,
  Globe,
  Eye,
  MousePointer,
  MessageCircle,
  Heart,
  Home,
  Map,
  ExternalLink,
  Smartphone,
  Monitor,
  Tablet,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface LeadJourneySectionProps {
  leadId: string;
}

function getEventIcon(eventType: string) {
  const map: Record<string, React.ComponentType<{ className?: string }>> = {
    pageview: Eye,
    form_submit: MessageCircle,
    whatsapp_click: MessageCircle,
    favorite: Heart,
    cta_click: MousePointer,
    property_view: Home,
  };
  return map[eventType] || Globe;
}

function getEventLabel(event: JourneyEvent): string {
  switch (event.event_type) {
    case 'pageview':
      if (event.property_id || event.page_path?.includes('/imovel/') || event.page_path?.includes('/imoveis/')) {
        return `Visitou imóvel`;
      }
      return `Visitou página`;
    case 'form_submit':
      return 'Enviou formulário de contato';
    case 'whatsapp_click':
      return 'Clicou no WhatsApp';
    case 'favorite':
      return 'Favoritou imóvel';
    case 'cta_click':
      return 'Clicou em CTA';
    default:
      return event.event_type;
  }
}

function getEventColor(eventType: string): { text: string; bg: string } {
  const map: Record<string, { text: string; bg: string }> = {
    pageview:       { text: 'text-blue-600 dark:text-blue-400',    bg: 'bg-blue-500/15' },
    form_submit:    { text: 'text-green-600 dark:text-green-400',  bg: 'bg-green-500/15' },
    whatsapp_click: { text: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/15' },
    favorite:       { text: 'text-pink-600 dark:text-pink-400',    bg: 'bg-pink-500/15' },
    cta_click:      { text: 'text-orange-600 dark:text-orange-400', bg: 'bg-orange-500/15' },
  };
  return map[eventType] || { text: 'text-muted-foreground', bg: 'bg-muted' };
}

function DeviceTypeIcon({ deviceType }: { deviceType?: string | null }) {
  if (deviceType === 'mobile') return <Smartphone className="h-3 w-3" />;
  if (deviceType === 'tablet') return <Tablet className="h-3 w-3" />;
  return <Monitor className="h-3 w-3" />;
}

function formatPagePath(path: string): string {
  if (path === '/' || path === '') return 'Página inicial';
  // Remove leading slash and clean up
  const clean = path.replace(/^\//, '').replace(/\//g, ' > ');
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

export function LeadJourneySection({ leadId }: LeadJourneySectionProps) {
  const { data: events = [], isLoading } = useLeadJourney(leadId);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-white/[0.055] bg-[var(--app-surface)] p-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="h-7 w-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Map className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="font-medium text-sm">Jornada do visitante</h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (events.length === 0) {
    return null; // Don't show section if no journey data
  }

  // Compute stats
  const totalVisits = events.filter(e => e.event_type === 'pageview').length;
  const uniquePages = new Set(events.filter(e => e.event_type === 'pageview').map(e => e.page_path)).size;
  const propertiesViewed = new Set(
    events
      .filter(e => e.property_id || e.page_path?.includes('/imovel/') || e.page_path?.includes('/imoveis/'))
      .map(e => e.property_id || e.page_path)
  ).size;
  const firstEvent = events[0];
  const lastEvent = events[events.length - 1];

  return (
    <div className="rounded-lg border border-white/[0.055] bg-[var(--app-surface)] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-indigo-500/10 flex items-center justify-center">
            <Map className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <h3 className="font-medium text-sm">Jornada do visitante</h3>
        </div>
        <Badge variant="secondary" className="text-xs gap-1">
          <DeviceTypeIcon deviceType={firstEvent?.device_type} />
          {firstEvent?.browser || 'N/A'}
        </Badge>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg bg-white/[0.045] p-2 text-center">
          <p className="text-lg font-bold">{totalVisits}</p>
          <p className="text-[10px] text-muted-foreground">Pageviews</p>
        </div>
        <div className="rounded-lg bg-white/[0.045] p-2 text-center">
          <p className="text-lg font-bold">{uniquePages}</p>
          <p className="text-[10px] text-muted-foreground">Páginas</p>
        </div>
        <div className="rounded-lg bg-white/[0.045] p-2 text-center">
          <p className="text-lg font-bold">{propertiesViewed}</p>
          <p className="text-[10px] text-muted-foreground">Imóveis</p>
        </div>
      </div>

      {/* UTM info */}
      {(firstEvent?.utm_source || firstEvent?.utm_campaign) && (
        <div className="flex flex-wrap gap-1 mb-3">
          {firstEvent.utm_source && (
            <Badge variant="outline" className="text-[10px]">
              Origem: {firstEvent.utm_source}
            </Badge>
          )}
          {firstEvent.utm_medium && (
            <Badge variant="outline" className="text-[10px]">
              Mídia: {firstEvent.utm_medium}
            </Badge>
          )}
          {firstEvent.utm_campaign && (
            <Badge variant="outline" className="text-[10px]">
              Campanha: {firstEvent.utm_campaign}
            </Badge>
          )}
        </div>
      )}

      {/* Referrer */}
      {firstEvent?.referrer && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-3">
          <ExternalLink className="h-3 w-3" />
          <span className="truncate">Veio de: {firstEvent.referrer}</span>
        </div>
      )}

      {/* Timeline */}
      <ScrollArea className="max-h-[300px]">
        <div className="space-y-0">
          {events.map((event, index) => {
            const Icon = getEventIcon(event.event_type);
            const colors = getEventColor(event.event_type);
            const isLast = index === events.length - 1;

            return (
              <div key={event.id} className="relative flex gap-3 pl-7">
                {/* Connector line */}
                {!isLast && (
                  <div className="absolute left-3 top-6 bottom-0 w-px bg-border" />
                )}

                {/* Icon */}
                <div
                  className={cn(
                    'absolute left-0 w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                    colors.bg
                  )}
                >
                  <Icon className={cn('h-3 w-3', colors.text)} />
                </div>

                {/* Content */}
                <div className="flex-1 pb-3 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium leading-tight">
                        {getEventLabel(event)}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {event.page_title || formatPagePath(event.page_path)}
                      </p>
                    </div>
                    <p className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">
                      {format(new Date(event.created_at), 'HH:mm', { locale: ptBR })}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Footer with time range */}
      <div className="mt-2 pt-2 border-t text-[10px] text-muted-foreground text-center">
        {format(new Date(firstEvent.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
        {' -> '}
        {format(new Date(lastEvent.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
      </div>
    </div>
  );
}
