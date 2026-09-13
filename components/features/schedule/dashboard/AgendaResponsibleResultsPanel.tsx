"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ScheduleDashboardPerformerRanking } from "@/lib/validation/schedule-dashboard";

import {
  AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE,
  paginateAgendaResponsibleResults,
} from "./agenda-responsible-results-pagination";

const integerFormatter = new Intl.NumberFormat("pt-BR");
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

function sortPerformers(ranking: ScheduleDashboardPerformerRanking[]) {
  return ranking.slice().sort((left, right) => {
    const leftOverdueRate =
      left.eligible > 0 ? left.overdue / left.eligible : 0;
    const rightOverdueRate =
      right.eligible > 0 ? right.overdue / right.eligible : 0;

    return (
      Number(right.eligible > 0) - Number(left.eligible > 0) ||
      right.completion_rate - left.completion_rate ||
      right.completed - left.completed ||
      left.no_show_rate - right.no_show_rate ||
      leftOverdueRate - rightOverdueRate ||
      right.total - left.total ||
      left.name.localeCompare(right.name, "pt-BR")
    );
  });
}

function PersonAvatar({
  name,
  avatarUrl,
}: {
  name: string;
  avatarUrl: string | null;
}) {
  return (
    <Avatar className="h-8 w-8 shrink-0">
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={name} /> : null}
      <AvatarFallback className="bg-primary/10 text-[9px] font-medium text-primary">
        {getInitials(name)}
      </AvatarFallback>
    </Avatar>
  );
}

function RateCell({
  value,
  available,
  tone = "primary",
}: {
  value: number;
  available: boolean;
  tone?: "primary" | "warning";
}) {
  if (!available) {
    return (
      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
        —
      </span>
    );
  }

  return (
    <div className="ml-auto w-[76px]">
      <span
        className={cn(
          "block text-right text-[10px] font-medium tabular-nums",
          tone === "warning"
            ? "text-amber-600 dark:text-amber-400"
            : "text-primary",
        )}
      >
        {percentFormatter.format(value)}%
      </span>
      <span
        className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]"
        aria-hidden="true"
      >
        <span
          className={cn(
            "block h-full rounded-full",
            tone === "warning" ? "bg-amber-500" : "bg-primary",
          )}
          style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        />
      </span>
    </div>
  );
}

export function AgendaResponsibleResultsPanel({
  performers,
}: {
  performers: ScheduleDashboardPerformerRanking[];
}) {
  const [requestedPage, setRequestedPage] = useState(1);
  const orderedPerformers = useMemo(
    () => sortPerformers(performers),
    [performers],
  );
  const pagination = paginateAgendaResponsibleResults(
    orderedPerformers,
    requestedPage,
  );

  return (
    <section
      aria-labelledby="agenda-responsible-results-title"
      className="min-w-0 overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none"
    >
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-primary/10 text-primary">
          <UsersRound className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2
          id="agenda-responsible-results-title"
          className="min-w-0 flex-1 truncate text-[13px] font-normal text-[var(--app-text-primary)]"
        >
          Resultado por responsável
        </h2>
        {orderedPerformers.length > 0 ? (
          <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium tabular-nums text-primary">
            {integerFormatter.format(orderedPerformers.length)} responsáve
            {orderedPerformers.length === 1 ? "l" : "is"}
          </span>
        ) : null}
      </div>

      {orderedPerformers.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center px-5 py-10 text-center">
          <p className="max-w-[280px] text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
            Nenhum responsável encontrado neste período.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <table className="w-full min-w-[1080px] border-separate border-spacing-0 text-left">
            <thead>
              <tr className="bg-[var(--app-surface-soft)] text-[8px] font-medium uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">
                <th className="w-[260px] px-4 py-2.5 font-medium">
                  Responsável
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Agendamentos
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Visitas e reuniões
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Realizados
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Em aberto
                </th>
                <th className="px-3 py-2.5 text-right font-medium">
                  Em atraso
                </th>
                <th className="px-3 py-2.5 text-right font-medium">No-show</th>
                <th className="w-[112px] px-3 py-2.5 text-right font-medium">
                  Realização
                </th>
                <th className="w-[112px] px-4 py-2.5 text-right font-medium">
                  Taxa de no-show
                </th>
              </tr>
            </thead>
            <tbody>
              {pagination.items.map((person, index) => {
                const rankingIndex = pagination.startIndex + index;

                return (
                  <tr
                    key={person.user_id}
                    className="group text-[10px] text-[var(--app-text-secondary)]"
                  >
                    <td className="border-t border-[var(--app-border)] px-4 py-3">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <span
                          className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[8px] font-medium tabular-nums",
                            rankingIndex === 0
                              ? "bg-primary text-primary-foreground"
                              : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]",
                          )}
                        >
                          {rankingIndex + 1}
                        </span>
                        <PersonAvatar
                          name={person.name}
                          avatarUrl={person.avatar_url}
                        />
                        <span className="min-w-0 truncate text-[10px] font-medium text-[var(--app-text-primary)]">
                          {person.name}
                        </span>
                      </div>
                    </td>
                    <td className="border-t border-[var(--app-border)] px-3 py-3 text-right font-medium tabular-nums text-primary">
                      {integerFormatter.format(person.total)}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-3 py-3 text-right tabular-nums">
                      {integerFormatter.format(person.appointments)}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-3 py-3 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      {integerFormatter.format(person.completed)}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-3 py-3 text-right tabular-nums">
                      {integerFormatter.format(person.open)}
                    </td>
                    <td
                      className={cn(
                        "border-t border-[var(--app-border)] px-3 py-3 text-right font-medium tabular-nums",
                        person.overdue > 0
                          ? "text-rose-600 dark:text-rose-400"
                          : "text-[var(--app-text-secondary)]",
                      )}
                    >
                      {integerFormatter.format(person.overdue)}
                    </td>
                    <td
                      className={cn(
                        "border-t border-[var(--app-border)] px-3 py-3 text-right font-medium tabular-nums",
                        person.no_show > 0
                          ? "text-amber-600 dark:text-amber-400"
                          : "text-[var(--app-text-secondary)]",
                      )}
                    >
                      {integerFormatter.format(person.no_show)}
                    </td>
                    <td className="border-t border-[var(--app-border)] px-3 py-3 text-right">
                      <RateCell
                        value={person.completion_rate}
                        available={person.eligible > 0}
                      />
                    </td>
                    <td className="border-t border-[var(--app-border)] px-4 py-3 text-right">
                      <RateCell
                        value={person.no_show_rate}
                        available={person.appointment_eligible > 0}
                        tone="warning"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {pagination.totalItems > AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE ? (
        <nav
          className="flex min-h-12 flex-col gap-2 border-t border-[var(--app-border)] px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
          aria-label="Paginação do resultado por responsável"
        >
          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
            Exibindo {integerFormatter.format(pagination.from)}–
            {integerFormatter.format(pagination.to)} de{" "}
            {integerFormatter.format(pagination.totalItems)} responsáveis
          </p>
          <div className="flex items-center justify-between gap-2 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() => setRequestedPage(Math.max(1, pagination.page - 1))}
              disabled={pagination.page <= 1}
              aria-label="Ir para a página anterior de responsáveis"
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Anterior</span>
            </Button>
            <span
              className="min-w-20 text-center text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]"
              aria-live="polite"
            >
              Página {integerFormatter.format(pagination.page)} de{" "}
              {integerFormatter.format(pagination.totalPages)}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              onClick={() =>
                setRequestedPage(
                  Math.min(pagination.totalPages, pagination.page + 1),
                )
              }
              disabled={pagination.page >= pagination.totalPages}
              aria-label="Ir para a próxima página de responsáveis"
            >
              <span className="hidden sm:inline">Próxima</span>
              <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </nav>
      ) : null}
    </section>
  );
}
