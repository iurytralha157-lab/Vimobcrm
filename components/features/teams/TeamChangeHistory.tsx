"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Clock3,
  History,
  Link2,
  PencilLine,
  UserMinus,
  UserPlus,
  UserRoundCog,
} from "lucide-react";

import { Skeleton } from "@/components/ui/skeleton";
import { useTeamHistory } from "@/hooks/use-teams";
import type { TeamHistoryEvent } from "@/lib/api/teams";

type DisplayHistoryEvent = {
  event: TeamHistoryEvent;
  groupedCount: number;
};

function availabilitySubjectKey(event: TeamHistoryEvent) {
  const teamMemberId =
    event.new_data?.team_member_id || event.old_data?.team_member_id;
  return event.subject_user?.id || String(teamMemberId || "unknown-member");
}

function groupHistoryEvents(events: TeamHistoryEvent[]): DisplayHistoryEvent[] {
  const grouped: DisplayHistoryEvent[] = [];

  for (const event of events) {
    const previous = grouped.at(-1);
    if (
      event.entity_type === "team_member_availability" &&
      previous?.event.entity_type === "team_member_availability" &&
      availabilitySubjectKey(previous.event) ===
        availabilitySubjectKey(event) &&
      (previous.event.user?.id || "system") === (event.user?.id || "system") &&
      previous.event.created_at === event.created_at
    ) {
      previous.groupedCount += 1;
      continue;
    }

    grouped.push({ event, groupedCount: 1 });
  }

  return grouped;
}

function eventDescription(event: TeamHistoryEvent) {
  const subject = event.subject_user?.name || "Membro";
  const changedKeys = new Set(Object.keys(event.diff || {}));

  if (event.entity_type === "team") {
    if (event.action === "create") return "Equipe criada";
    if (event.action === "delete") return "Equipe excluída";
    if (changedKeys.has("is_active")) {
      return event.new_data?.is_active === false
        ? "Equipe desativada"
        : "Equipe ativada";
    }
    if (changedKeys.has("name")) return "Nome da equipe alterado";
    if (changedKeys.has("logo_url")) return "Logo da equipe alterada";
    return "Dados da equipe atualizados";
  }

  if (event.entity_type === "team_member") {
    if (event.action === "create") return `${subject} foi adicionado à equipe`;
    if (event.action === "delete") return `${subject} foi removido da equipe`;
    if (changedKeys.has("is_leader")) {
      return `Liderança de ${subject} atualizada`;
    }
    return `Vínculo de ${subject} atualizado`;
  }

  if (event.entity_type === "team_member_availability") {
    return `Escala de ${subject} atualizada`;
  }

  if (event.entity_type === "team_pipeline") {
    return event.action === "delete"
      ? "Pipeline removido da equipe"
      : "Pipeline vinculado à equipe";
  }

  return "Configuração da equipe atualizada";
}

function eventIcon(event: TeamHistoryEvent) {
  if (event.entity_type === "team_member_availability") return Clock3;
  if (event.entity_type === "team_pipeline") return Link2;
  if (event.entity_type === "team_member") {
    if (event.action === "create") return UserPlus;
    if (event.action === "delete") return UserMinus;
    return UserRoundCog;
  }
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

export function TeamChangeHistory({ teamId }: { teamId: string }) {
  const historyQuery = useTeamHistory(teamId);
  const displayHistory = useMemo(
    () => groupHistoryEvents(historyQuery.data || []),
    [historyQuery.data],
  );

  return (
    <section
      data-team-panel="history"
      className="flex h-full w-full min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] p-2 sm:p-3"
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
        data-team-history-scroll
        className="scrollbar-thin -mr-2 min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/30"
        role="region"
        aria-label="Histórico rolável da equipe"
        tabIndex={0}
      >
        {historyQuery.isPending ? (
          <div className="space-y-2 px-1" aria-label="Carregando histórico">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} className="h-12 rounded-[6px]" />
            ))}
          </div>
        ) : historyQuery.isError && displayHistory.length === 0 ? (
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-4 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
            O histórico está indisponível no momento. A edição da equipe
            continua disponível.
          </div>
        ) : displayHistory.length === 0 ? (
          <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-4 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
            Ainda não há alterações auditadas para esta equipe.
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
              aria-label="Alterações recentes da equipe"
            >
              {displayHistory.map(({ event, groupedCount }) => {
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
                        · {event.user?.name || "Sistema"}
                        {groupedCount > 1 ? " · escala consolidada" : ""}
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
