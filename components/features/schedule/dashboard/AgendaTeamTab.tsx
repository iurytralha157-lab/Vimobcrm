"use client";

import { EmptyNote, KpiRow, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import type { ScheduleDashboardData } from "@/lib/validation/schedule-dashboard";

import { AgendaOverduePanel } from "./AgendaOverduePanel";
import { AgendaResponsibleResultsPanel } from "./AgendaResponsibleResultsPanel";
import { AgendaBarRow, AgendaKpiCard } from "./agenda-dashboard-ui";
import { buildTeamSummary } from "./agenda-dashboard-metrics";

export function AgendaTeamTab({
  data,
  resultsKey,
  onSelectOverdueOwner,
}: {
  data: ScheduleDashboardData;
  resultsKey: string;
  onSelectOverdueOwner: (userId: string) => void;
}) {
  const summary = buildTeamSummary(data.performer_ranking, data.overdue_by_owner);
  const noShows = data.performer_ranking
    .filter((person) => person.appointment_eligible > 0)
    .slice()
    .sort((left, right) => right.no_show_rate - left.no_show_rate || left.name.localeCompare(right.name, "pt-BR"));
  const worstNoShow = noShows[0]?.no_show_rate ?? 0;

  return (
    <div className="space-y-3">
      <KpiRow>
        <AgendaKpiCard label="Pessoas com agenda" value={formatCount(summary.activeCount)} note="Na equipe filtrada" />
        <AgendaKpiCard
          label="Compromissos por pessoa"
          value={summary.averagePerPerson === null ? "—" : summary.averagePerPerson.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          note="Média no período"
        />
        <AgendaKpiCard
          label="Melhor realização"
          value={summary.best ? formatPercent(summary.best.completion_rate) : "—"}
          note={summary.best ? `${summary.best.name}${summary.bestTied ? " e outros" : ""}` : "Sem base elegível"}
        />
        <AgendaKpiCard
          label="Atrasos concentrados"
          value={formatCount(summary.worstOverdue?.overdue ?? 0)}
          note={summary.worstOverdue?.name ?? "Nenhum atraso"}
        />
      </KpiRow>

      <div className="grid min-w-0 grid-cols-1 gap-3 @[720px]/agenda-dashboard:grid-cols-2">
        <AgendaOverduePanel
          owners={data.overdue_by_owner}
          totalOverdue={data.kpis.overdue}
          onSelectOwner={onSelectOverdueOwner}
        />
        <Panel title="Não compareceu por responsável" aside="Em visitas e reuniões">
          {noShows.length === 0 ? (
            <EmptyNote>Nenhuma visita ou reunião com resultado neste recorte.</EmptyNote>
          ) : (
            <div className="max-h-[260px] space-y-2.5 overflow-y-auto overscroll-contain pr-1">
              {noShows.map((person, index) => (
                <AgendaBarRow
                  key={person.user_id}
                  label={person.name}
                  value={formatPercent(person.no_show_rate)}
                  valueWidth={48}
                  percent={worstNoShow > 0 ? (person.no_show_rate / worstNoShow) * 100 : 0}
                  highlight={index === 0 && worstNoShow > 0}
                  title={`${person.name}: ${formatCount(person.no_show)} de ${formatCount(person.appointment_eligible)} visitas e reuniões`}
                />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <AgendaResponsibleResultsPanel
        key={resultsKey}
        performers={data.performer_ranking}
        totals={data.kpis}
      />
    </div>
  );
}
