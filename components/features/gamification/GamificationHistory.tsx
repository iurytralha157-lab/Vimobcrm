"use client";

import { useMemo, useState } from "react";
import { startOfDay, subDays } from "date-fns";
import { History, Loader2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useGamificationEvents,
  type GamificationEvent,
} from "@/hooks/gamification";

import {
  SOURCE_LABELS,
  formatDateTime,
  formatNumber,
  getEventLabel,
} from "./gamification-domain";
import { EmptyPanel, PanelTitle } from "./GamificationUi";

export function GamificationHistory({
  events = [],
  compact = false,
}: {
  events?: GamificationEvent[];
  compact?: boolean;
}) {
  const [period, setPeriod] = useState("all");
  const [historyFrom, setHistoryFrom] = useState<string | null>(null);
  const handlePeriodChange = (value: string) => {
    setPeriod(value);
    setHistoryFrom(
      value === "all"
        ? null
        : startOfDay(subDays(new Date(), Number(value) - 1)).toISOString(),
    );
  };
  const historyFilters = useMemo(() => {
    if (!historyFrom) return { limit: 50 };
    return {
      from: historyFrom,
      limit: 50,
    };
  }, [historyFrom]);
  const historyQuery = useGamificationEvents(
    historyFilters,
    !compact && (period === "all" || historyFrom !== null),
  );
  const visibleEvents = compact ? events.slice(0, 8) : historyQuery.events;
  const totalEvents = compact ? visibleEvents.length : historyQuery.total;

  return (
    <section className="app-card overflow-hidden">
      <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <PanelTitle
          icon={History}
          eyebrow="Transparência"
          title={compact ? "Atividades recentes" : "Histórico de pontuação"}
          showIcon={false}
        />
        <div className="flex items-center gap-2">
          {!compact && (
            <Select value={period} onValueChange={handlePeriodChange}>
              <SelectTrigger className="h-9 w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7">Últimos 7 dias</SelectItem>
                <SelectItem value="30">Últimos 30 dias</SelectItem>
                <SelectItem value="90">Últimos 90 dias</SelectItem>
                <SelectItem value="all">Todo período</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Badge variant="secondary">
            {visibleEvents.length < totalEvents
              ? `${visibleEvents.length} de ${totalEvents}`
              : `${totalEvents} registros`}
          </Badge>
        </div>
      </div>

      {!compact && historyQuery.error && visibleEvents.length > 0 && (
        <div
          className="mx-4 mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          <span>O histórico pode estar desatualizado.</span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void historyQuery.refetch()}
          >
            Atualizar novamente
          </Button>
        </div>
      )}

      {!compact && historyQuery.isLoading ? (
        <div
          className="flex min-h-[180px] items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-4 w-4 animate-spin" /> Carregando histórico...
        </div>
      ) : !compact && historyQuery.error && visibleEvents.length === 0 ? (
        <div
          className="flex min-h-[180px] flex-col items-center justify-center gap-3 px-4 text-center"
          role="alert"
        >
          <p className="text-sm text-destructive">
            Não foi possível carregar o histórico.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void historyQuery.refetch()}
          >
            Tentar novamente
          </Button>
        </div>
      ) : visibleEvents.length === 0 ? (
        <EmptyPanel title="Nenhuma atividade registrada ainda" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-y border-border/60 bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Data</th>
                  <th className="px-4 py-3 text-left font-medium">Ação</th>
                  <th className="px-4 py-3 text-left font-medium">Usuário</th>
                  <th className="px-4 py-3 text-left font-medium">Origem</th>
                  <th className="px-4 py-3 text-right font-medium">Pontos</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {visibleEvents.map((event) => (
                  <tr key={event.id}>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDateTime(event.createdAt)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">
                        {getEventLabel(event.eventType)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">
                      {event.userName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {SOURCE_LABELS[event.source || "system"] ||
                        event.source ||
                        "Sistema"}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-primary">
                      +{formatNumber(event.points)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!compact && historyQuery.hasNextPage && (
            <div className="flex justify-center border-t border-border/50 p-3">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void historyQuery.fetchNextPage()}
                disabled={historyQuery.isFetchingNextPage}
              >
                {historyQuery.isFetchingNextPage && (
                  <Loader2 className="h-4 w-4 animate-spin" />
                )}
                Carregar mais
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
