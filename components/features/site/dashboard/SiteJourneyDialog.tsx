import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Globe, MapPin, Monitor, Route, Smartphone } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LeadJourney } from "@/hooks/use-lead-analytics";
import { cn } from "@/lib/utils";

import { journeyOrigin } from "./site-dashboard-format";

export const SITE_EVENT_LABELS: Record<string, string> = {
  pageview: "Visualização",
  page_view: "Visualização",
  session_start: "Início da sessão",
  page_duration: "Tempo na página",
  property_view: "Imóvel visualizado",
  property_search: "Busca realizada",
  form_submit: "Formulário enviado",
  whatsapp_click: "WhatsApp",
  cta_click: "Clique em chamada",
  favorite: "Favorito",
};

export function SiteJourneyDialog({
  journey,
  onClose,
}: {
  journey: LeadJourney | null;
  onClose: () => void;
}) {
  return (
  <Dialog
    open={!!journey}
    onOpenChange={(open) => !open && onClose()}
  >
    <DialogContent className="z-[200] max-h-[88dvh] w-[calc(100vw-24px)] min-w-0 overflow-x-hidden overflow-y-auto rounded-[8px] p-4 shadow-none sm:max-w-lg sm:p-5">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2 text-base">
          <Route className="h-4 w-4 text-primary" />
          Jornada da Sessão
          {journey?.converted && (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-0 text-[10px]">
              Converteu
            </Badge>
          )}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Detalhes da navegação realizada nesta sessão do site.
        </DialogDescription>
      </DialogHeader>

      {journey && (
        <div className="space-y-4">
          {/* Session Info */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] text-muted-foreground mb-1">
                Sessão
              </p>
              <p className="font-mono text-xs">
                {journey.session_id.substring(0, 12)}...
              </p>
            </div>
            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] text-muted-foreground mb-1">
                Total de eventos
              </p>
              <p className="font-normal">{journey.total_events}</p>
            </div>
            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] text-muted-foreground mb-1">
                Primeira ação
              </p>
              <p className="text-xs">
                {format(
                  new Date(journey.first_event),
                  "dd/MM/yyyy 'às' HH:mm",
                  { locale: ptBR },
                )}
              </p>
            </div>
            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <p className="text-[10px] text-muted-foreground mb-1">
                Última ação
              </p>
              <p className="text-xs">
                {format(
                  new Date(journey.last_event),
                  "dd/MM/yyyy 'às' HH:mm",
                  { locale: ptBR },
                )}
              </p>
            </div>
          </div>

          {/* Device & Location Info */}
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            {journey.device_type && (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <div className="flex items-center gap-1 mb-1">
                  {journey.device_type === "mobile" ? (
                    <Smartphone className="h-3 w-3 text-muted-foreground" />
                  ) : (
                    <Monitor className="h-3 w-3 text-muted-foreground" />
                  )}
                  <p className="text-[10px] text-muted-foreground">
                    Dispositivo
                  </p>
                </div>
                <p className="text-xs font-medium capitalize">
                  {journey.device_type}
                </p>
              </div>
            )}
            {journey.browser && (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <div className="flex items-center gap-1 mb-1">
                  <Globe className="h-3 w-3 text-muted-foreground" />
                  <p className="text-[10px] text-muted-foreground">
                    Navegador
                  </p>
                </div>
                <p className="text-xs font-medium capitalize">
                  {journey.browser}
                </p>
              </div>
            )}
            {journey.os && (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <p className="text-[10px] text-muted-foreground mb-1">
                  Sistema
                </p>
                <p className="text-xs font-medium">{journey.os}</p>
              </div>
            )}
          </div>

          {/* City/Region */}
          {(journey.city ||
            journey.region ||
            journey.country) && (
            <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-sm">
              <div className="flex items-center gap-1 mb-1">
                <MapPin className="h-3 w-3 text-muted-foreground" />
                <p className="text-[10px] text-muted-foreground">
                  Localização
                </p>
              </div>
              <p className="text-xs font-medium">
                {[
                  journey.city,
                  journey.region,
                  journey.country,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
            </div>
          )}

          <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-sm">
            <div className="mb-1 flex items-center gap-1">
              <Globe className="h-3 w-3 text-muted-foreground" />
              <p className="text-[10px] text-muted-foreground">
                Origem da sessão
              </p>
            </div>
            <p className="break-all text-xs font-medium">
              {journeyOrigin(journey)}
            </p>
          </div>

          {/* Events */}
          <div>
            <p className="text-xs font-medium mb-2">Tipos de evento</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1.5 rounded-[7px] bg-[var(--app-surface-soft)] px-3 py-2.5">
              {[...new Set(journey.event_sequence)].map(
                (evt, idx) => (
                  <span
                    key={idx}
                    className="flex items-center gap-1.5 text-[11px] text-[var(--app-text-secondary)]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-primary/50" />
                    {SITE_EVENT_LABELS[evt] || evt}
                  </span>
                ),
              )}
            </div>
          </div>

          {/* Path Timeline */}
          <div>
            <p className="text-xs font-medium mb-2">
              Percurso completo ({journey.path_sequence.length}{" "}
              páginas)
            </p>
            <ScrollArea className="max-h-[260px]">
              <div className="space-y-0">
                {journey.path_sequence.map((path, idx) => {
                  const isLast =
                    idx === journey.path_sequence.length - 1;
                  return (
                    <div key={idx} className="relative flex gap-3 pl-6">
                      {!isLast && (
                        <div className="absolute bottom-0 left-2.5 top-5 w-px bg-[var(--app-border)]" />
                      )}
                      <div
                        className={cn(
                          "absolute left-0 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-normal",
                          idx === 0
                            ? "bg-primary/15 text-primary"
                            : isLast
                              ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                              : "bg-[var(--app-surface-soft)] text-muted-foreground",
                        )}
                      >
                        {idx + 1}
                      </div>
                      <div className="flex-1 pb-2.5 min-w-0">
                        <p className="whitespace-normal break-all font-mono text-xs">
                          {path}
                        </p>
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
  );
}
