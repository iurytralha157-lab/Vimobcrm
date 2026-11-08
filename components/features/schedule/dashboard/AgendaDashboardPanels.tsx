"use client";

import { EmptyNote, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount, formatPercent } from "@/components/features/marketing/marketing-format";
import { getScheduleOutcomeLabel } from "@/lib/schedule-outcome";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardBreakdown,
  ScheduleDashboardDataQuality,
  ScheduleDashboardPerformerRanking,
  ScheduleDashboardSource,
} from "@/lib/validation/schedule-dashboard";

import { AgendaBarRow, PersonAvatar } from "./agenda-dashboard-ui";
import type { AgendaWeeklyCompletion } from "./agenda-dashboard-metrics";

const TYPE_LABELS: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
  __unknown__: "Outro",
};

function outcomeLabel(key: string) {
  if (key === "no_show") return "Não compareceu";
  if (key === "__none__") return "Realizado sem desfecho";
  return getScheduleOutcomeLabel(key);
}

function shareOf(value: number, maximum: number) {
  return maximum > 0 ? (value / maximum) * 100 : 0;
}

const SCROLL_LIST = "max-h-[220px] space-y-2.5 overflow-y-auto overscroll-contain pr-1";

export function AgendaTypeDistributionPanel({ items }: { items: ScheduleDashboardBreakdown[] }) {
  const visible = items.filter((item) => item.count > 0).slice().sort((left, right) => right.count - left.count);
  const maximum = visible[0]?.count ?? 0;
  return (
    <Panel title="Por tipo">
      {visible.length === 0 ? (
        <EmptyNote>Nenhum compromisso neste recorte.</EmptyNote>
      ) : (
        <div className={SCROLL_LIST}>
          {visible.map((item, index) => (
            <AgendaBarRow
              key={item.key}
              label={TYPE_LABELS[item.key] ?? item.key}
              value={formatCount(item.count)}
              percent={shareOf(item.count, maximum)}
              highlight={index === 0}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

/** Every source stays reachable: a long list scrolls inside the panel instead of being cut. */
export function AgendaSourceDistributionPanel({ items }: { items: ScheduleDashboardSource[] }) {
  const visible = items.filter((item) => item.count > 0).slice().sort((left, right) => right.count - left.count);
  const maximum = visible[0]?.count ?? 0;
  return (
    <Panel title="De onde veio o lead">
      {visible.length === 0 ? (
        <EmptyNote>Nenhuma origem registrada neste recorte.</EmptyNote>
      ) : (
        <div className={SCROLL_LIST}>
          {visible.map((item, index) => (
            <AgendaBarRow
              key={item.key}
              label={item.label}
              value={formatCount(item.count)}
              percent={shareOf(item.count, maximum)}
              highlight={index === 0}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgendaOutcomeDistributionPanel({ items }: { items: ScheduleDashboardBreakdown[] }) {
  const visible = items.filter((item) => item.count > 0).slice().sort((left, right) => right.count - left.count);
  const total = visible.reduce((sum, item) => sum + item.count, 0);
  const maximum = visible[0]?.count ?? 0;
  return (
    <Panel title="Como terminaram" aside={`${formatCount(total)} com resultado lançado`}>
      {visible.length === 0 ? (
        <EmptyNote>Nenhum resultado lançado neste recorte.</EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {visible.map((item, index) => (
            <AgendaBarRow
              key={item.key}
              label={outcomeLabel(item.key)}
              value={`${formatCount(item.count)} · ${formatPercent(shareOf(item.count, total))}`}
              valueWidth={88}
              percent={shareOf(item.count, maximum)}
              highlight={index === 0}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgendaCompletedBySourcePanel({ items }: { items: ScheduleDashboardSource[] }) {
  const reported = items.every((item) => item.appointment_eligible !== undefined);
  const visible = items
    .filter((item) => (item.appointment_eligible ?? 0) > 0)
    .slice()
    .sort((left, right) => (right.appointment_completed ?? 0) - (left.appointment_completed ?? 0));
  const rates = visible.map((item) => shareOf(item.appointment_completed ?? 0, item.appointment_eligible ?? 0));
  const best = Math.max(...rates, 0);
  return (
    <Panel title="Realizados por origem do lead" aside="Visitas e reuniões">
      {!reported ? (
        <EmptyNote>Este indicador ainda não está disponível nesta versão do serviço.</EmptyNote>
      ) : visible.length === 0 ? (
        <EmptyNote>Nenhuma visita ou reunião com resultado neste recorte.</EmptyNote>
      ) : (
        <div className={SCROLL_LIST}>
          {visible.map((item, index) => (
            <AgendaBarRow
              key={item.key}
              label={item.label}
              value={`${formatCount(item.appointment_completed)} · ${formatPercent(rates[index])}`}
              valueWidth={88}
              percent={rates[index]}
              highlight={rates[index] === best && best > 0}
              title={`${item.label}: ${formatCount(item.appointment_completed)} de ${formatCount(item.appointment_eligible)} elegíveis`}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgendaWeeklyCompletionPanel({ weeks }: { weeks: AgendaWeeklyCompletion[] }) {
  const best = Math.max(...weeks.map((week) => week.rate), 0);
  return (
    <Panel title="Taxa de realização por semana" aside="Últimas semanas">
      {weeks.length === 0 ? (
        <EmptyNote>Nenhuma semana com compromissos elegíveis neste recorte.</EmptyNote>
      ) : (
        <div className="space-y-2.5">
          {weeks.map((week) => (
            <AgendaBarRow
              key={week.key}
              label={week.label}
              value={formatPercent(week.rate)}
              valueWidth={48}
              percent={week.rate}
              highlight={week.rate === best && best > 0}
              title={`${week.label}: ${formatCount(week.completed)} de ${formatCount(week.eligible)} elegíveis`}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export function AgendaDataQualityPanel({
  quality,
  overdue,
  children,
}: {
  quality?: ScheduleDashboardDataQuality;
  overdue: number;
  children?: React.ReactNode;
}) {
  const rows = quality
    ? [
        { key: "overdue", label: "Sem resultado", title: "Sem resultado lançado", value: overdue },
        { key: "performer", label: "Sem executor", title: "Realizado sem registro do executor", value: quality.completed_without_performer },
        { key: "source", label: "Sem origem", title: "Com lead e sem origem histórica registrada", value: quality.missing_lead_source_snapshot },
        { key: "result", label: "Sem horário", title: "Realizado sem data real de desfecho", value: quality.completed_without_result_time },
        { key: "creator", label: "Sem autor", title: "Sem registro de quem criou", value: quality.missing_created_by },
      ]
    : [];
  const maximum = Math.max(...rows.map((row) => row.value), 0);
  return (
    <Panel title="Qualidade dos dados" aside="O que pode distorcer os números">
      {rows.length > 0 ? (
        <div className="space-y-2.5">
          {rows.map((row) => (
            <AgendaBarRow
              key={row.key}
              label={row.label}
              title={`${row.title}: ${formatCount(row.value)}`}
              value={formatCount(row.value)}
              percent={shareOf(row.value, maximum)}
              highlight={row.value === maximum && maximum > 0}
            />
          ))}
        </div>
      ) : null}
      <div className={cn(rows.length > 0 && "mt-3")}>{children}</div>
    </Panel>
  );
}

export function AgendaTopPerformersPanel({ performers }: { performers: ScheduleDashboardPerformerRanking[] }) {
  const visible = performers
    .filter((person) => person.completed > 0)
    .slice()
    .sort((left, right) => right.completed - left.completed || left.name.localeCompare(right.name, "pt-BR"))
    .slice(0, 5);
  const maximum = visible[0]?.completed ?? 0;
  return (
    <Panel title="Quem mais realizou" aside="No período">
      {visible.length === 0 ? (
        <EmptyNote>Nenhuma realização neste recorte.</EmptyNote>
      ) : (
        <ol className="space-y-1">
          {visible.map((person, index) => (
            <li
              key={person.user_id}
              className={cn("flex items-center gap-2.5 rounded-[8px] px-2 py-1.5", index === 0 && "bg-primary/10")}
            >
              <PersonAvatar name={person.name} avatarUrl={person.avatar_url} className="h-8 w-8" />
              <div className="min-w-0 flex-1 text-[11px] font-light">
                <p className="truncate text-[12px] text-[var(--app-text-primary)]">{person.name}</p>
                <p className="flex justify-between gap-2 text-[var(--app-text-secondary)]">
                  <span className="truncate">{formatCount(person.total)} compromissos</span>
                  <span className="shrink-0 tabular-nums">{formatCount(person.completed)} realizados</span>
                </p>
                <span className="mt-1 block h-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${shareOf(person.completed, maximum)}%` }} />
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
