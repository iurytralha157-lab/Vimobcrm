"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardKpis,
  ScheduleDashboardPerformerRanking,
} from "@/lib/validation/schedule-dashboard";

import {
  AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE,
  paginateAgendaResponsibleResults,
} from "./agenda-responsible-results-pagination";
import { PersonAvatar } from "./agenda-dashboard-ui";

const integerFormatter = new Intl.NumberFormat("pt-BR");
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const NUMERIC = "text-right tabular-nums";

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

const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_56px_56px_56px] items-center gap-2 @[720px]/agenda-dashboard:grid-cols-[minmax(0,1.6fr)_repeat(6,minmax(0,1fr))]";
const WIDE_ONLY = "hidden @[720px]/agenda-dashboard:block";

function HeaderLabel({ wide, narrow }: { wide: string; narrow: string }) {
  return (
    <span role="columnheader" className={NUMERIC} title={wide}>
      <span className="hidden truncate @[720px]/agenda-dashboard:inline">{wide}</span>
      <span className="@[720px]/agenda-dashboard:hidden">{narrow}</span>
    </span>
  );
}

export function AgendaResponsibleResultsPanel({
  performers,
  totals,
}: {
  performers: ScheduleDashboardPerformerRanking[];
  totals?: ScheduleDashboardKpis;
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
    <Panel
      title="Resultado por responsável"
      aside={totals ? `${integerFormatter.format(totals.total)} compromissos` : undefined}
    >
      {orderedPerformers.length === 0 ? (
        <EmptyNote>Nenhum responsável encontrado neste período.</EmptyNote>
      ) : (
        <div role="table" aria-label="Resultado por responsável" className="text-[12px] font-light">
          <div role="row" className={cn(COLUMNS, "border-b border-[var(--app-border)] pb-2 text-[var(--app-text-tertiary)]")}>
            <span role="columnheader">Responsável</span>
            <HeaderLabel wide="Compromissos" narrow="Compr." />
            <HeaderLabel wide="Realizados" narrow="Real." />
            <span role="columnheader" className={cn(NUMERIC, WIDE_ONLY)}>Em aberto</span>
            <span role="columnheader" className={cn(NUMERIC, WIDE_ONLY)}>Não compareceu</span>
            <span role="columnheader" className={cn(NUMERIC, WIDE_ONLY)}>Atrasados</span>
            <HeaderLabel wide="Taxa de realização" narrow="Taxa" />
          </div>
          {pagination.items.map((person, index) => {
            const rankingIndex = pagination.startIndex + index;
            return (
              <div key={person.user_id} role="row" className={cn(COLUMNS, "border-b border-[var(--app-border)] py-2 text-[var(--app-text-primary)]")}>
                <span role="cell" className="flex min-w-0 items-center gap-2" title={`${rankingIndex + 1}º na taxa de realização`}>
                  <PersonAvatar name={person.name} avatarUrl={person.avatar_url} />
                  <span className="truncate">{person.name}</span>
                </span>
                <span role="cell" className={NUMERIC}>{integerFormatter.format(person.total)}</span>
                <span role="cell" className={NUMERIC}>{integerFormatter.format(person.completed)}</span>
                <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(person.open)}</span>
                <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(person.no_show)}</span>
                <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(person.overdue)}</span>
                <span role="cell" className={NUMERIC}>
                  {person.eligible > 0 ? `${percentFormatter.format(person.completion_rate)}%` : "—"}
                </span>
              </div>
            );
          })}
          {totals ? (
            <div role="row" className={cn(COLUMNS, "pt-2.5 text-[var(--app-text-primary)]")} title="Cada compromisso conta uma vez, mesmo com vários participantes">
              <span role="cell">Total</span>
              <span role="cell" className={NUMERIC}>{integerFormatter.format(totals.total)}</span>
              <span role="cell" className={NUMERIC}>{integerFormatter.format(totals.completed)}</span>
              <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(totals.open)}</span>
              <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(totals.no_show)}</span>
              <span role="cell" className={cn(NUMERIC, WIDE_ONLY)}>{integerFormatter.format(totals.overdue)}</span>
              <span role="cell" className={NUMERIC}>
                {totals.eligible > 0 ? `${percentFormatter.format(totals.completion_rate)}%` : "—"}
              </span>
            </div>
          ) : null}
          <p className="mt-2.5 text-[10px] leading-4 text-[var(--app-text-tertiary)]">
            Responsável principal e participantes; autoria da execução é separada.
          </p>
        </div>
      )}

      {pagination.totalItems > AGENDA_RESPONSIBLE_RESULTS_PAGE_SIZE ? (
        <nav
          className="mt-2.5 flex min-h-10 flex-col gap-2 border-t border-[var(--app-border)] pt-2.5 sm:flex-row sm:items-center sm:justify-between"
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
    </Panel>
  );
}
