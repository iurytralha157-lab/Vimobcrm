"use client";

import type { LucideIcon } from "lucide-react";
import { Award, ChartNoAxesColumn, ListFilter, Tags } from "lucide-react";
import { Cell, Pie, PieChart } from "recharts";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardBreakdown,
  ScheduleDashboardSource,
  ScheduleDashboardTopPerformer,
} from "@/lib/validation/schedule-dashboard";

const integerFormatter = new Intl.NumberFormat("pt-BR");
const DISTRIBUTION_COLORS = [
  "var(--primary)",
  "#fb6a4a",
  "#f97316",
  "#f59e0b",
  "#0ea5e9",
  "#8b5cf6",
] as const;

const typeChartConfig = {
  count: { label: "Atividades", color: "var(--chart-1)" },
} satisfies ChartConfig;

const TYPE_LABELS: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
  __unknown__: "Outro",
};

const AGENDA_TYPE_KEYS = [
  "visit",
  "meeting",
  "call",
  "email",
  "message",
  "task",
] as const;

const OUTCOME_LABELS: Record<string, string> = {
  contacted: "Contato realizado",
  activity_completed: "Atividade concluída",
  qualified: "Qualificado",
  proposal: "Proposta apresentada",
  visit_completed: "Visita realizada",
  meeting_completed: "Reunião realizada",
  follow_up: "Acompanhamento",
  no_show: "No-show",
  rescheduled: "Remarcado",
  cancelled: "Cancelado",
  canceled: "Cancelado",
  other: "Outro",
  __none__: "Sem resultado",
};

function humanizeKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");
}

function PanelHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 pb-3 pt-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/12 text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h2 className="truncate text-[13px] font-medium tracking-[-0.01em] text-[var(--app-text-primary)]">
          {title}
        </h2>
        <p className="mt-0.5 truncate text-[9px] font-light text-[var(--app-text-tertiary)]">
          {description}
        </p>
      </div>
    </div>
  );
}

function EmptyPanelMessage({ children }: { children: string }) {
  return (
    <div className="flex min-h-[150px] items-center justify-center px-5 py-8 text-center">
      <p className="max-w-[220px] text-[11px] font-light text-[var(--app-text-tertiary)]">
        {children}
      </p>
    </div>
  );
}

export function AgendaTopPerformersPanel({
  performers,
}: {
  performers: ScheduleDashboardTopPerformer[];
}) {
  const visiblePerformers = performers.slice(0, 6);
  const maximum = Math.max(
    ...visiblePerformers.map((performer) => performer.total),
    1,
  );

  return (
    <section className="flex min-h-[330px] flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <PanelHeader
        icon={Award}
        title="Quem mais realizou"
        description="Ranking por atividades concluídas"
      />

      {visiblePerformers.length === 0 ? (
        <EmptyPanelMessage>
          Nenhuma realização registrada neste período.
        </EmptyPanelMessage>
      ) : (
        <ol className="flex-1 space-y-1 px-3 pb-3 pt-1">
          {visiblePerformers.map((performer, index) => (
            <li
              key={performer.user_id}
              className="group rounded-[7px] px-2 py-2 transition-colors hover:bg-[var(--app-surface-hover)]"
            >
              <div className="flex items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-medium",
                    index === 0
                      ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                      : "bg-[var(--app-surface-soft)] text-[var(--app-text-tertiary)]",
                  )}
                >
                  {index + 1}
                </span>
                <Avatar className="h-8 w-8">
                  {performer.avatar_url ? (
                    <AvatarImage
                      src={performer.avatar_url}
                      alt={performer.name}
                    />
                  ) : null}
                  <AvatarFallback className="bg-primary/10 text-[9px] font-medium text-primary">
                    {getInitials(performer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] font-normal text-[var(--app-text-primary)]">
                      {performer.name}
                    </span>
                    <span className="shrink-0 text-[11px] font-medium tabular-nums text-[var(--app-text-primary)]">
                      {integerFormatter.format(performer.total)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                    <div
                      className="h-full rounded-full bg-primary/60"
                      style={{
                        width: `${Math.max(4, (performer.total / maximum) * 100)}%`,
                      }}
                    />
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AgendaTypeDistributionPanel({
  items,
}: {
  items: ScheduleDashboardBreakdown[];
}) {
  const countByType = new Map<string, number>();
  items.forEach((item) => {
    countByType.set(item.key, (countByType.get(item.key) ?? 0) + item.count);
  });
  const canonicalTypeKeys = new Set<string>(AGENDA_TYPE_KEYS);
  const otherCount = items.reduce(
    (sum, item) => (canonicalTypeKeys.has(item.key) ? sum : sum + item.count),
    0,
  );
  const chartData: Array<{
    key: string;
    count: number;
    label: string;
    fill: string;
  }> = AGENDA_TYPE_KEYS.map((key, index) => ({
    key,
    count: countByType.get(key) ?? 0,
    label: TYPE_LABELS[key],
    fill: DISTRIBUTION_COLORS[index % DISTRIBUTION_COLORS.length],
  }));
  if (otherCount > 0) {
    chartData.push({
      key: "__unknown__",
      count: otherCount,
      label: TYPE_LABELS.__unknown__,
      fill: "var(--app-text-tertiary)",
    });
  }
  const total = chartData.reduce((sum, item) => sum + item.count, 0);

  return (
    <section className="h-[440px] overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <PanelHeader
        icon={Tags}
        title="Distribuição por tipo"
        description="Como a agenda está sendo usada"
      />

      <div className="px-4 pb-4">
        <div className="relative mx-auto h-[190px] w-full max-w-[220px]">
          {total === 0 ? (
            <span
              className="pointer-events-none absolute left-1/2 top-1/2 h-[168px] w-[168px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[27px] border-[var(--app-surface-soft)]"
              aria-hidden="true"
            />
          ) : null}
          <ChartContainer
            config={typeChartConfig}
            className="relative z-10 h-[190px] w-full aspect-auto"
            role="img"
            aria-label="Distribuição das atividades por tipo"
          >
            <PieChart accessibilityLayer>
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="label"
                innerRadius={57}
                outerRadius={84}
                paddingAngle={2.5}
                cornerRadius={3}
                strokeWidth={0}
              >
                {chartData.map((item) => (
                  <Cell key={item.key} fill={item.fill} />
                ))}
              </Pie>
            </PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[22px] font-medium leading-none tracking-[-0.03em] tabular-nums text-[var(--app-text-primary)]">
              {integerFormatter.format(total)}
            </span>
            <span className="mt-1 text-[9px] font-light text-[var(--app-text-tertiary)]">
              atividades
            </span>
          </div>
        </div>

        <div className="mt-1 grid max-h-[178px] min-w-0 grid-cols-2 gap-2 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
          {chartData.map((item) => {
            const percentage = total > 0 ? (item.count / total) * 100 : 0;

            return (
              <div
                key={item.key}
                className="min-w-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2 transition-colors hover:bg-[var(--app-surface-hover)]"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-[9px] font-light text-[var(--app-text-secondary)]">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: item.fill }}
                  />
                  <span className="truncate">{item.label}</span>
                </span>
                <span className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-medium leading-none tabular-nums text-[var(--app-text-primary)]">
                    {integerFormatter.format(item.count)}
                  </span>
                  <span className="text-[8px] font-light tabular-nums text-[var(--app-text-tertiary)]">
                    {percentage.toLocaleString("pt-BR", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export function AgendaSourceDistributionPanel({
  items,
}: {
  items: ScheduleDashboardSource[];
}) {
  return (
    <BreakdownListPanel
      icon={ListFilter}
      title="Origem do lead"
      description="De onde vieram os compromissos"
      emptyMessage="Nenhuma origem encontrada neste período."
      items={items.map((item) => ({ label: item.label, count: item.count }))}
      tone="bg-primary/70"
    />
  );
}

export function AgendaOutcomeDistributionPanel({
  items,
}: {
  items: ScheduleDashboardBreakdown[];
}) {
  return (
    <BreakdownListPanel
      icon={ChartNoAxesColumn}
      title="Resultados"
      description="Desfechos registrados nas atividades"
      emptyMessage="Nenhum resultado registrado neste período."
      items={items.map((item) => ({
        label: OUTCOME_LABELS[item.key] ?? humanizeKey(item.key),
        count: item.count,
      }))}
      tone="bg-emerald-500/60"
    />
  );
}

function BreakdownListPanel({
  icon,
  title,
  description,
  emptyMessage,
  items,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  emptyMessage: string;
  items: Array<{ label: string; count: number }>;
  tone: string;
}) {
  const visibleItems = items.filter((item) => item.count > 0).slice(0, 8);
  const maximum = Math.max(...visibleItems.map((item) => item.count), 1);

  return (
    <section className="h-[440px] overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <PanelHeader icon={icon} title={title} description={description} />
      {visibleItems.length === 0 ? (
        <EmptyPanelMessage>{emptyMessage}</EmptyPanelMessage>
      ) : (
        <div className="space-y-3 px-4 pb-4 pt-2">
          {visibleItems.map((item) => (
            <div key={item.label}>
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <span className="truncate text-[10px] font-light text-[var(--app-text-secondary)]">
                  {item.label}
                </span>
                <span className="shrink-0 text-[10px] font-medium tabular-nums text-[var(--app-text-primary)]">
                  {integerFormatter.format(item.count)}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                <div
                  className={cn("h-full rounded-full", tone)}
                  style={{
                    width: `${Math.max(3, (item.count / maximum) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
