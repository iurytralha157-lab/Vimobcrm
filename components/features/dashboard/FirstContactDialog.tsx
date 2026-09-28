"use client";

import { useState } from "react";
import { ChevronDown, Clock3, RefreshCw, Repeat2, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashboardFirstContactLeads, type DashboardFirstContact } from "@/hooks/use-dashboard-stats";
import { sourceLabels } from "@/hooks/use-dashboard-filters";
import type { DashboardAPIFilters } from "@/lib/api/dashboard";

type FirstContactDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data?: DashboardFirstContact;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  filters?: DashboardAPIFilters;
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

function formatDate(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function responseBaselineAt(respondedAt: string, responseSeconds: number): string {
  return new Date(new Date(respondedAt).getTime() - responseSeconds * 1000).toISOString();
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-3.5">
      <p className="text-[12px] font-medium text-[var(--app-text-secondary)]">{label}</p>
      <p className="mt-1 text-[22px] font-medium tabular-nums text-[var(--app-text-primary)]">{value}</p>
      {hint ? <p className="mt-1 text-[11px] leading-4 text-[var(--app-text-secondary)]">{hint}</p> : null}
    </div>
  );
}

function DurationBar({ seconds, maxSeconds, label }: { seconds: number | null; maxSeconds: number; label: string }) {
  return (
    <div
      className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--app-surface-hover)]"
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

function BrokerLeadDetails({
  broker,
  query,
}: {
  broker: DashboardFirstContact["brokers"][number];
  query: ReturnType<typeof useDashboardFirstContactLeads>;
}) {
  const responseLeads = query.data?.pages.flatMap((page) => page.items) ?? [];
  const responseLeadTotal = query.data?.pages[0]?.total ?? 0;

  return (
    <section
      id={`first-contact-leads-${broker.id}`}
      className="rounded-[8px] border border-[var(--app-border)] bg-[var(--app-surface-solid)] p-3 sm:p-4"
      aria-labelledby={`first-contact-leads-title-${broker.id}`}
    >
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={`first-contact-leads-title-${broker.id}`} className="text-[14px] font-medium text-[var(--app-text-primary)]">
            Primeiras respostas de {broker.name}
          </h4>
          <p className="mt-1 text-[12px] leading-4 text-[var(--app-text-secondary)]">
            Primeira resposta humana registrada no recorte · mais demorados primeiro
          </p>
        </div>
        {query.data ? (
          <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[11px] tabular-nums text-[var(--app-text-secondary)]">
            {responseLeads.length} de {responseLeadTotal}
          </span>
        ) : null}
      </div>
      {query.isError ? (
        <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] text-[var(--app-text-secondary)]">
          Não foi possível carregar os leads deste corretor.
          <Button type="button" variant="ghost" size="sm" className="ml-2 text-primary" onClick={() => void query.refetch()}>Tentar novamente</Button>
        </div>
      ) : query.isPending ? (
        <div role="status" aria-label="Carregando leads atendidos" className="space-y-2"><Skeleton className="h-16 rounded-[8px]" /><Skeleton className="h-16 rounded-[8px]" /></div>
      ) : responseLeads.length === 0 ? (
        <p className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[12px] text-[var(--app-text-secondary)]">Nenhuma primeira resposta humana medida para este corretor e os filtros atuais.</p>
      ) : (
        <div className="space-y-2">
          {responseLeads.map((lead) => (
            <div key={lead.id} className="min-w-0 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-[var(--app-text-primary)]" title={lead.name}>{lead.name}</p>
                  <p className="mt-0.5 text-[11px] text-[var(--app-text-secondary)]">{sourceLabels[lead.source] || lead.source}</p>
                </div>
                <strong className="shrink-0 text-[13px] font-medium tabular-nums text-[var(--app-text-primary)]">{formatSeconds(lead.responseSeconds)}</strong>
              </div>
              <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] leading-4 text-[var(--app-text-secondary)]">
                <span>Entrou: {formatDate(lead.createdAt)}</span>
                <span>Início da medição: {formatDate(responseBaselineAt(lead.respondedAt, lead.responseSeconds))}</span>
                <span>Respondeu: {formatDate(lead.respondedAt)}</span>
                {lead.currentOwner ? <span>Responsável atual: {lead.currentOwner}</span> : null}
              </p>
            </div>
          ))}
          {query.hasNextPage ? (
            <Button type="button" variant="outline" size="sm" className="w-full" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
              {query.isFetchingNextPage ? "Carregando..." : "Carregar mais leads"}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}

export function FirstContactDialog({
  open,
  onOpenChange,
  data,
  isLoading,
  isError,
  onRetry,
  filters,
}: FirstContactDialogProps) {
  const [selectedBrokerId, setSelectedBrokerId] = useState<string | null>(null);
  const brokers = [...(data?.brokers ?? [])].sort((left, right) => {
    if (left.averageResponseSeconds === null) return right.averageResponseSeconds === null ? left.name.localeCompare(right.name, "pt-BR") : 1;
    if (right.averageResponseSeconds === null) return -1;
    return left.averageResponseSeconds - right.averageResponseSeconds || left.name.localeCompare(right.name, "pt-BR");
  });
  const sources = [...(data?.sources ?? [])].sort((left, right) => right.contactedLeads - left.contactedLeads || left.source.localeCompare(right.source, "pt-BR"));
  const maxBrokerSeconds = Math.max(1, ...brokers.map((broker) => broker.averageResponseSeconds ?? 0));
  const maxSourceSeconds = Math.max(1, ...sources.map((source) => source.averageResponseSeconds ?? 0));
  const filteredBrokerId = brokers.find((broker) => broker.id === filters?.userId)?.id ?? null;
  const activeBrokerId = selectedBrokerId === ""
    ? null
    : selectedBrokerId && brokers.some((broker) => broker.id === selectedBrokerId)
      ? selectedBrokerId
      : filteredBrokerId;
  const leadDetails = useDashboardFirstContactLeads(filters, activeBrokerId, { enabled: open });

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) setSelectedBrokerId(null);
      onOpenChange(nextOpen);
    }}>
      <DialogContent
        data-tour="dashboard-first-contact-dialog"
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[16px] font-medium leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            Primeiro contato
          </DialogTitle>
          <DialogDescription className="sr-only">
            Métricas de primeiro contato por corretor e por origem.
          </DialogDescription>
        </DialogHeader>

        <div className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
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
                  <Metric label="Tempo médio" value={formatSeconds(data.averageResponseSeconds)} hint="Primeira resposta humana registrada" />
                  <Metric
                    label="Leads no recorte"
                    value={data.leadCount.toLocaleString("pt-BR")}
                    hint={filteredBrokerId ? "Passaram pelo corretor no período" : "Entrada no período selecionado"}
                  />
                  <Metric label="Respostas medidas" value={data.contactedLeads.toLocaleString("pt-BR")} hint={filteredBrokerId ? "Pelo corretor filtrado" : `${Math.max(0, data.leadCount - data.contactedLeads).toLocaleString("pt-BR")} sem medida`} />
                  <Metric label="Redistribuídos" value={data.redistributedLeads.toLocaleString("pt-BR")} hint={`${data.redistributionEvents.toLocaleString("pt-BR")} movimentações registradas`} />
                </div>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="first-contact-brokers-title">
                  <div className="mb-3 flex items-center gap-2">
                    <UsersRound className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 id="first-contact-brokers-title" className="text-[15px] font-medium text-[var(--app-text-primary)]">Por corretor</h3>
                  </div>
                  {brokers.length === 0 ? (
                    <p className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhum corretor com contato ou redistribuição nesse período.</p>
                  ) : (
                    <div className="space-y-2">
                      {brokers.map((broker) => {
                        const expanded = activeBrokerId === broker.id;
                        return (
                          <div key={broker.id} className="space-y-2">
                            <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8 shrink-0 border border-[var(--app-border)]">
                                  <AvatarImage src={broker.avatarUrl ?? undefined} alt={broker.name} />
                                  <AvatarFallback className="bg-primary/15 text-[10px] text-primary">{initialLetters(broker.name)}</AvatarFallback>
                                </Avatar>
                                <div className="min-w-0 flex-1">
                                  <p className="break-words text-[13px] font-medium text-[var(--app-text-primary)]">{broker.name}</p>
                                  <p className="text-[12px] leading-4 text-[var(--app-text-secondary)]">
                                    {broker.handledLeads} {broker.handledLeads === 1 ? "lead passou" : "leads passaram"} por ele · {broker.contactedLeads} {broker.contactedLeads === 1 ? "resposta medida" : "respostas medidas"}
                                  </p>
                                </div>
                                <span className="shrink-0 text-[14px] font-medium tabular-nums text-[var(--app-text-primary)]">{formatSeconds(broker.averageResponseSeconds)}</span>
                              </div>
                              <DurationBar seconds={broker.averageResponseSeconds} maxSeconds={maxBrokerSeconds} label={broker.name} />
                              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <p className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] leading-4 text-[var(--app-text-secondary)]">
                                  <span>Atualmente com ele: <strong className="font-medium text-[var(--app-text-primary)]">{broker.leadCount}</strong></span>
                                  <span>Recebimentos registrados: <strong className="font-medium text-[var(--app-text-primary)]">{broker.receivedLeads}</strong></span>
                                  <span>Repassados: <strong className="font-medium text-[var(--app-text-primary)]">{broker.redistributedAway}</strong></span>
                                  <span>Recebidos por redistribuição: <strong className="font-medium text-[var(--app-text-primary)]">{broker.redistributedReceived}</strong></span>
                                </p>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className={`h-9 w-full shrink-0 gap-2 rounded-[6px] border px-3 text-[12px] font-medium shadow-none sm:w-auto ${expanded ? "border-transparent bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground" : "border-[var(--app-border)] bg-[var(--app-surface-soft)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"}`}
                                  onClick={() => setSelectedBrokerId(expanded ? "" : broker.id)}
                                  aria-expanded={expanded}
                                  aria-controls={expanded ? `first-contact-leads-${broker.id}` : undefined}
                                >
                                  {expanded ? "Ocultar leads e tempos" : "Ver leads e tempos"}
                                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : "text-primary"}`} aria-hidden="true" />
                                </Button>
                              </div>
                            </div>
                            {expanded ? <BrokerLeadDetails broker={broker} query={leadDetails} /> : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 sm:p-4" aria-labelledby="first-contact-sources-title">
                  <div className="mb-3 flex items-center gap-2">
                    <Repeat2 className="h-4 w-4 text-primary" aria-hidden="true" />
                    <h3 id="first-contact-sources-title" className="text-[15px] font-medium text-[var(--app-text-primary)]">Por origem</h3>
                  </div>
                  {sources.length === 0 ? (
                    <p className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhuma origem disponível para os filtros selecionados.</p>
                  ) : (
                    <div className="space-y-2">
                      {sources.map((source) => {
                        const label = sourceLabels[source.source] || source.source || "Sem origem";
                        return (
                          <div key={source.source} className="rounded-[8px] bg-[var(--app-surface-solid)] p-3">
                            <div className="flex items-center justify-between gap-3 text-[13px] font-medium">
                              <span className="min-w-0 truncate text-[var(--app-text-primary)]">{label}</span>
                              <span className="shrink-0 tabular-nums text-[var(--app-text-primary)]">{formatSeconds(source.averageResponseSeconds)}</span>
                            </div>
                            <DurationBar seconds={source.averageResponseSeconds} maxSeconds={maxSourceSeconds} label={label} />
                            <p className="mt-2 text-[12px] leading-4 text-[var(--app-text-secondary)]">{source.contactedLeads} {source.contactedLeads === 1 ? "resposta medida" : "respostas medidas"} · {source.leadCount} leads na origem · {source.redistributedLeads} redistribuídos</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
                <p className="rounded-[8px] bg-[var(--app-surface-soft)] p-3 text-[11px] leading-5 text-[var(--app-text-secondary)]">
                  O tempo considera a primeira resposta humana registrada de cada lead, atribuída a quem respondeu. A medição começa na atribuição ativa; se ela não estiver registrada, começa na entrada do lead. Não é recalculada a cada nova atribuição. Uma automação anterior pode impedir esse registro. “Passaram por ele” reúne atribuições registradas e respostas medidas, sem duplicar o mesmo lead para o corretor. “Recebimentos registrados” inclui distribuição, ciclos, histórico e responsável atual. A trilha histórica é incompleta, então ambos podem ser menores que o total real. “Repassados” e “recebidos por redistribuição” contam apenas transferências com origem e destino identificados.
                </p>
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
