"use client";

import { Clock3, RefreshCw, Repeat2, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardFirstContact } from "@/hooks/use-dashboard-stats";
import { sourceLabels } from "@/hooks/use-dashboard-filters";

type FirstContactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: DashboardFirstContact;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  periodLabel: string;
};

function formatSeconds(seconds: number | null): string {
  if (seconds === null) return "—";
  const rounded = Math.max(0, Math.round(seconds));
  if (rounded < 60) return `${rounded}s`;
  if (rounded < 3600) return `${Math.round(rounded / 60)}min`;
  if (rounded < 86400) {
    const totalMinutes = Math.round(rounded / 60);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes ? `${hours}h ${minutes}min` : `${hours}h`;
  }
  const totalHours = Math.round(rounded / 3600);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours ? `${days}d ${hours}h` : `${days}d`;
}

function initialLetters(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] ?? "?"}${parts.length > 1 ? parts.at(-1)?.[0] ?? "" : ""}`;
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <p className="text-[12px] font-light text-[var(--app-text-tertiary)]">{label}</p>
      <p className="mt-1 text-[20px] font-normal tabular-nums text-[var(--app-text-primary)]">{value}</p>
      {hint ? <p className="mt-0.5 text-[11px] font-light text-[var(--app-text-tertiary)]">{hint}</p> : null}
    </div>
  );
}

function DurationBar({ seconds, maxSeconds, label }: { seconds: number | null; maxSeconds: number; label: string }) {
  return (
    <div
      className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-hover)]"
      role="img"
      aria-label={`${label}: ${seconds === null ? "sem primeiro contato" : formatSeconds(seconds)}`}
    >
      {seconds !== null ? (
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.max(3, Math.min(100, (seconds / maxSeconds) * 100))}%` }}
        />
      ) : null}
    </div>
  );
}

export function FirstContactDialog({
  open,
  onOpenChange,
  data,
  isLoading,
  isError,
  onRetry,
  periodLabel,
}: FirstContactDialogProps) {
  const brokers = [...(data?.brokers ?? [])].sort((left, right) => {
    if (left.averageResponseSeconds === null) return right.averageResponseSeconds === null ? left.name.localeCompare(right.name, "pt-BR") : 1;
    if (right.averageResponseSeconds === null) return -1;
    return left.averageResponseSeconds - right.averageResponseSeconds || left.name.localeCompare(right.name, "pt-BR");
  });
  const sources = [...(data?.sources ?? [])].sort((left, right) => right.contactedLeads - left.contactedLeads || left.source.localeCompare(right.source, "pt-BR"));
  const maxBrokerSeconds = Math.max(1, ...brokers.map((broker) => broker.averageResponseSeconds ?? 0));
  const maxSourceSeconds = Math.max(1, ...sources.map((source) => source.averageResponseSeconds ?? 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="dashboard-first-contact-dialog"
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Primeiro contato
          </DialogTitle>
          <DialogDescription className="pl-[42px] text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
            Leads com origem em {periodLabel.toLowerCase()}. Menor tempo médio registrado aparece primeiro.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {isError ? (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-[12px] text-[var(--app-text-secondary)]">
                <p>Não foi possível carregar o primeiro contato.</p>
                <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="mt-2 gap-1.5 text-primary">
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Tentar novamente
                </Button>
              </div>
            ) : isLoading || !data ? (
              <div className="space-y-3" role="status" aria-label="Carregando primeiro contato">
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-[8px]" />)}</div>
                <Skeleton className="h-52 rounded-[8px]" />
                <Skeleton className="h-40 rounded-[8px]" />
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
                  <Metric label="Tempo médio" value={formatSeconds(data.averageResponseSeconds)} hint="Resposta humana registrada" />
                  <Metric label="Com medida humana" value={data.contactedLeads.toLocaleString("pt-BR")} hint={`de ${data.leadCount.toLocaleString("pt-BR")} leads`} />
                  <Metric label="Sem medida humana" value={Math.max(0, data.leadCount - data.contactedLeads).toLocaleString("pt-BR")} />
                  <Metric label="Redistribuídos" value={data.redistributedLeads.toLocaleString("pt-BR")} hint={`${data.redistributionEvents.toLocaleString("pt-BR")} movimentações`} />
                </div>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="first-contact-brokers-title">
                  <div className="mb-3 flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 id="first-contact-brokers-title" className="text-[14px] font-normal">Por corretor</h3>
                  </div>
                  {brokers.length === 0 ? (
                    <p className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhum corretor com contato ou redistribuição nesse período.</p>
                  ) : (
                    <div className="space-y-2">
                      {brokers.map((broker) => (
                        <div key={broker.id} className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8 shrink-0 border border-[var(--app-border)]">
                              <AvatarImage src={broker.avatarUrl ?? undefined} alt={broker.name} />
                              <AvatarFallback className="bg-primary/15 text-[10px] text-primary">{initialLetters(broker.name)}</AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">{broker.name}</p>
                              <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">{broker.contactedLeads} resposta(s) medidas · {broker.leadCount} lead(s) atuais</p>
                            </div>
                            <span className="shrink-0 text-[13px] font-normal tabular-nums text-[var(--app-text-primary)]">{formatSeconds(broker.averageResponseSeconds)}</span>
                          </div>
                          <DurationBar seconds={broker.averageResponseSeconds} maxSeconds={maxBrokerSeconds} label={broker.name} />
                          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-light text-[var(--app-text-tertiary)]">
                            <span>Leads redistribuídos de: <strong className="font-normal text-[var(--app-text-primary)]">{broker.redistributedAway}</strong></span>
                            <span>Leads recebidos: <strong className="font-normal text-[var(--app-text-primary)]">{broker.redistributedReceived}</strong></span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="first-contact-sources-title">
                  <div className="mb-3 flex items-center gap-2">
                    <Repeat2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 id="first-contact-sources-title" className="text-[14px] font-normal">Por origem</h3>
                  </div>
                  {sources.length === 0 ? (
                    <p className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhuma origem disponível para os filtros selecionados.</p>
                  ) : (
                    <div className="space-y-2">
                      {sources.map((source) => {
                        const label = sourceLabels[source.source] || source.source || "Sem origem";
                        return (
                          <div key={source.source} className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                            <div className="flex items-center justify-between gap-3 text-[12px]">
                              <span className="min-w-0 truncate text-[var(--app-text-primary)]">{label}</span>
                              <span className="shrink-0 tabular-nums text-[var(--app-text-primary)]">{formatSeconds(source.averageResponseSeconds)}</span>
                            </div>
                            <DurationBar seconds={source.averageResponseSeconds} maxSeconds={maxSourceSeconds} label={label} />
                            <p className="mt-2 text-[11px] font-light text-[var(--app-text-tertiary)]">{source.contactedLeads} de {source.leadCount} com medida humana · {source.redistributedLeads} leads redistribuídos</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
                <p className="text-[11px] font-light leading-4 text-[var(--app-text-tertiary)]">
                  Médias consideram apenas a primeira resposta humana registrada. Uma automação anterior pode impedir o registro de uma resposta humana posterior neste indicador. Cada lead redistribuído conta uma vez por corretor de saída e de entrada.
                </p>
              </>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
