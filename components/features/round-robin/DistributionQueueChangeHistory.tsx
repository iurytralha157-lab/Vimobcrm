"use client";

import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  History,
  ListFilter,
  PencilLine,
  Power,
  UserMinus,
  UserPlus,
  UsersRound,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useRoundRobinHistory } from "@/hooks/use-round-robins";
import type { RoundRobinHistoryEvent } from "@/lib/api/round-robins";

function changedKeys(event: RoundRobinHistoryEvent) {
  return new Set(Object.keys(event.diff || {}));
}

function memberSubject(event: RoundRobinHistoryEvent) {
  if (event.subject_user?.name) return event.subject_user.name;
  if (event.subject_user?.email) return event.subject_user.email;

  const teamId = event.new_data?.team_id || event.old_data?.team_id;
  return teamId ? "Equipe" : "Participante";
}

function eventDescription(event: RoundRobinHistoryEvent) {
  const keys = changedKeys(event);

  if (event.entity_type === "distribution_queue") {
    if (event.action === "create") return "Fila de distribuição criada";
    if (event.action === "delete") return "Fila de distribuição excluída";
    if (keys.has("is_active")) {
      return event.new_data?.is_active === false
        ? "Fila de distribuição desativada"
        : "Fila de distribuição ativada";
    }
    if (keys.has("name")) return "Nome da fila alterado";
    if (keys.has("strategy")) return "Estratégia de distribuição alterada";
    if (keys.has("pipeline_id") || keys.has("target_pipeline_id")) {
      return "Pipeline de destino alterado";
    }
    if (keys.has("target_stage_id")) return "Etapa de destino alterada";
    if (keys.has("reentry_behavior")) {
      return "Política de reentrada atualizada";
    }
    if (keys.has("settings")) return "Configurações operacionais atualizadas";
    return "Dados da fila atualizados";
  }

  if (event.entity_type === "distribution_queue_rule") {
    if (event.action === "create") return "Critério de entrada adicionado";
    if (event.action === "delete") return "Critério de entrada removido";
    return "Critério de entrada atualizado";
  }

  const subject = memberSubject(event);
  if (event.action === "create") return `${subject} adicionado à distribuição`;
  if (event.action === "delete") return `${subject} removido da distribuição`;
  if (keys.has("weight")) return `Peso de ${subject} atualizado`;
  if (keys.has("position")) return `Ordem de ${subject} atualizada`;
  if (keys.has("is_active")) return `Participação de ${subject} atualizada`;
  return `Configuração de ${subject} atualizada`;
}

function eventIcon(event: RoundRobinHistoryEvent) {
  if (event.entity_type === "distribution_queue_rule") return ListFilter;
  if (event.entity_type === "distribution_queue_member") {
    const isTeam = Boolean(event.new_data?.team_id || event.old_data?.team_id);
    if (isTeam) return UsersRound;
    if (event.action === "create") return UserPlus;
    if (event.action === "delete") return UserMinus;
    return PencilLine;
  }
  if (changedKeys(event).has("is_active")) return Power;
  return PencilLine;
}

function eventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { compact: "Horário indisponível", absolute: "Data indisponível" };
  }
  return {
    compact: format(date, "dd/MM · HH:mm", { locale: ptBR }),
    absolute: format(date, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
  };
}

export function DistributionQueueChangeHistory({
  queueId,
}: {
  queueId: string;
}) {
  const historyQuery = useRoundRobinHistory(queueId);
  const events = historyQuery.data || [];

  return (
    <section
      data-distribution-panel="history"
      className="flex w-full min-w-0 flex-col rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3"
    >
      <div className="flex shrink-0 items-center gap-2 px-1 pb-2">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-white">
          <History className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="min-w-0 truncate text-[13px] font-normal">
          Histórico de alterações
        </h2>
      </div>

      <div
        data-distribution-history-scroll
        className="scrollbar-thin -mr-2 max-h-[420px] overflow-y-auto overscroll-contain pr-2 [scrollbar-gutter:stable]"
        role="region"
        aria-label="Histórico da distribuição"
      >
        {historyQuery.isPending ? (
          <div className="space-y-2 px-1" aria-label="Carregando histórico">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-12 rounded-[6px]" />
            ))}
          </div>
        ) : historyQuery.isError && events.length === 0 ? (
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-4 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
            O histórico está indisponível no momento. A edição da fila continua
            disponível.
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-4 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
            Ainda não há alterações auditadas para esta distribuição.
          </div>
        ) : (
          <>
            {historyQuery.isRefetchError && (
              <p
                className="mb-1 rounded-[6px] bg-amber-500/10 px-2 py-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300"
                role="status"
              >
                Não foi possível atualizar agora. Exibindo o último histórico
                carregado.
              </p>
            )}
            <ol
              className="space-y-1"
              aria-label="Alterações recentes da distribuição"
            >
              {events.map((event) => {
                const Icon = eventIcon(event);
                const time = eventTime(event.created_at);
                return (
                  <li
                    key={event.id}
                    className="flex min-w-0 gap-2 rounded-[6px] bg-[var(--app-surface-soft)] p-2"
                  >
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[5px] bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)]">
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] leading-4 text-[var(--app-text-primary)]">
                        {eventDescription(event)}
                      </p>
                      <p
                        className="mt-0.5 truncate text-[9px] text-[var(--app-text-tertiary)]"
                        title={time.absolute}
                      >
                        <time dateTime={event.created_at}>{time.compact}</time>{" "}
                        · {event.user?.name || event.user?.email || "Sistema"}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}
