import type { LucideIcon } from "lucide-react";
import {
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClockAlert,
  ListTodo,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  UserRoundX,
  UsersRound,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardBreakdown,
  ScheduleDashboardDateBasis,
  ScheduleDashboardKpis,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import { getAgendaDashboardTotalLabels } from "./agenda-dashboard-model";

const integerFormatter = new Intl.NumberFormat("pt-BR");
const percentFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

type AgendaDashboardKpisProps = {
  kpis: ScheduleDashboardKpis;
  byType?: ScheduleDashboardBreakdown[];
  dateBasis: ScheduleDashboardDateBasis;
  activeStatus?: ScheduleDashboardStatus;
  onStatusSelect?: (status?: ScheduleDashboardStatus) => void;
};

type PrimaryKpiItem = {
  label: string;
  value: string;
  icon: LucideIcon;
  tone: string;
  status?: ScheduleDashboardStatus;
};

type SupportingMetric = {
  label: string;
  value: string;
  helper: string;
  icon: LucideIcon;
  tone: string;
};

function getShare(value: number, total: number) {
  if (total <= 0) return "0% do total";
  return `${percentFormatter.format((value / total) * 100)}% do total`;
}

function getTypeCount(
  byType: ScheduleDashboardBreakdown[] | undefined,
  key: string,
  fallback: number,
) {
  if (!byType) return fallback;
  return byType.find((item) => item.key === key)?.count ?? 0;
}

export function AgendaDashboardKpis({
  kpis,
  byType,
  dateBasis,
  activeStatus,
  onStatusSelect,
}: AgendaDashboardKpisProps) {
  const totalLabels = getAgendaDashboardTotalLabels(dateBasis);
  const primaryItems: PrimaryKpiItem[] = [
    {
      label: totalLabels.period,
      value: integerFormatter.format(kpis.total),
      icon: CalendarDays,
      tone: "text-primary",
    },
    {
      label: "Realizados",
      value: integerFormatter.format(kpis.completed),
      icon: CheckCircle2,
      tone: "text-emerald-600 dark:text-emerald-400",
      status: "completed",
    },
    {
      label: "Em aberto",
      value: integerFormatter.format(kpis.open),
      icon: CalendarClock,
      tone: "text-primary",
      status: "scheduled",
    },
    {
      label: "Em atraso",
      value: integerFormatter.format(kpis.overdue),
      icon: ClockAlert,
      tone: "text-rose-600 dark:text-rose-400",
      status: "overdue",
    },
    {
      label: "No-show",
      value: integerFormatter.format(kpis.no_show),
      icon: UserRoundX,
      tone: "text-amber-600 dark:text-amber-400",
      status: "no_show",
    },
    {
      label: "Próximos agendamentos",
      value: integerFormatter.format(kpis.upcoming),
      icon: CalendarCheck2,
      tone: "text-primary",
      status: "upcoming",
    },
  ];

  const visits = getTypeCount(byType, "visit", kpis.visits);
  const meetings = getTypeCount(byType, "meeting", kpis.meetings);
  const calls = getTypeCount(byType, "call", kpis.calls);
  const emails = getTypeCount(byType, "email", 0);
  const messages = getTypeCount(byType, "message", 0);
  const tasks = getTypeCount(byType, "task", 0);

  const supportingMetrics: SupportingMetric[] = [
    {
      label: "Visitas",
      value: integerFormatter.format(visits),
      helper: getShare(visits, kpis.total),
      icon: MapPin,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Reuniões",
      value: integerFormatter.format(meetings),
      helper: getShare(meetings, kpis.total),
      icon: UsersRound,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Ligações",
      value: integerFormatter.format(calls),
      helper: getShare(calls, kpis.total),
      icon: Phone,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "E-mail",
      value: integerFormatter.format(emails),
      helper: getShare(emails, kpis.total),
      icon: Mail,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Mensagem",
      value: integerFormatter.format(messages),
      helper: getShare(messages, kpis.total),
      icon: MessageCircle,
      tone: "bg-primary/10 text-primary",
    },
    {
      label: "Tarefa",
      value: integerFormatter.format(tasks),
      helper: getShare(tasks, kpis.total),
      icon: ListTodo,
      tone: "bg-primary/10 text-primary",
    },
  ];

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {primaryItems.map((item) => (
          <PrimaryKpi
            key={item.label}
            item={item}
            active={
              activeStatus === item.status || (!activeStatus && !item.status)
            }
            onSelect={
              onStatusSelect ? () => onStatusSelect(item.status) : undefined
            }
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {supportingMetrics.map((item) => (
          <SupportingKpi key={item.label} item={item} />
        ))}
      </div>
    </div>
  );
}

function PrimaryKpi({
  item,
  active,
  onSelect,
}: {
  item: PrimaryKpiItem;
  active: boolean;
  onSelect?: () => void;
}) {
  const Icon = item.icon;
  const content = (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className="block min-w-0 truncate text-[10px] font-medium text-[var(--app-text-secondary)]">
          {item.label}
        </span>
        <Icon
          className={cn("h-3.5 w-3.5 shrink-0", item.tone)}
          aria-hidden="true"
        />
      </span>
      <span className="mt-2 block text-[24px] font-medium leading-none tracking-[-0.03em] tabular-nums text-[var(--app-text-primary)]">
        {item.value}
      </span>
    </>
  );

  const className = cn(
    "min-h-[82px] min-w-0 rounded-[8px] bg-[var(--app-surface-solid)] px-3.5 py-3 text-left shadow-none transition-colors sm:px-4",
    onSelect &&
      "hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
    onSelect && active && "ring-1 ring-inset ring-primary/25",
  );

  if (!onSelect) return <article className={className}>{content}</article>;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={className}
      aria-pressed={active}
      aria-label={`Filtrar por ${item.label.toLowerCase()}`}
    >
      {content}
    </button>
  );
}

function SupportingKpi({ item }: { item: SupportingMetric }) {
  const Icon = item.icon;

  return (
    <article className="flex min-w-0 items-center gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3 shadow-none">
      <span
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px]",
          item.tone,
        )}
      >
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[9px] font-light text-[var(--app-text-tertiary)]">
          {item.label}
        </span>
        <span className="mt-0.5 block text-[15px] font-medium tabular-nums text-[var(--app-text-primary)]">
          {item.value}
        </span>
      </span>
      <span className="hidden shrink-0 text-[9px] font-light text-[var(--app-text-tertiary)] sm:block">
        {item.helper}
      </span>
    </article>
  );
}
