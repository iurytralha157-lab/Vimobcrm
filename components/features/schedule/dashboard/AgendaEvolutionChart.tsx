"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardDailyPoint,
  ScheduleDashboardDateBasis,
  ScheduleDashboardWeeklyPoint,
} from "@/lib/validation/schedule-dashboard";

import { AgendaDailyChart } from "./AgendaDailyChart";
import { AgendaWeeklyChart } from "./AgendaWeeklyChart";

export type AgendaEvolutionGranularity = "daily" | "weekly";

type AgendaEvolutionChartProps = {
  daily: ScheduleDashboardDailyPoint[];
  weekly: ScheduleDashboardWeeklyPoint[];
  dateFrom: string;
  dateTo: string;
  dateBasis: ScheduleDashboardDateBasis;
  defaultGranularity?: AgendaEvolutionGranularity;
};

const granularityOptions: Array<{
  value: AgendaEvolutionGranularity;
  label: string;
}> = [
  { value: "daily", label: "Dia" },
  { value: "weekly", label: "Semana" },
];

export function AgendaEvolutionChart({
  daily,
  weekly,
  dateFrom,
  dateTo,
  dateBasis,
  defaultGranularity = "weekly",
}: AgendaEvolutionChartProps) {
  const [granularity, setGranularity] =
    useState<AgendaEvolutionGranularity>(defaultGranularity);

  const action = (
    <div
      role="group"
      aria-label="Agrupar evolução da agenda"
      className="flex items-center rounded-[7px] bg-[var(--app-surface-soft)] p-0.5"
    >
      {granularityOptions.map((option) => {
        const active = option.value === granularity;

        return (
          <button
            key={option.value}
            type="button"
            onClick={() => setGranularity(option.value)}
            className={cn(
              "h-6 rounded-[5px] px-2.5 text-[9px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/45",
              active
                ? "bg-primary text-primary-foreground"
                : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
            )}
            aria-pressed={active}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );

  if (granularity === "daily") {
    return (
      <AgendaDailyChart
        data={daily}
        dateFrom={dateFrom}
        dateTo={dateTo}
        dateBasis={dateBasis}
        action={action}
      />
    );
  }

  return (
    <AgendaWeeklyChart
      data={weekly}
      dateFrom={dateFrom}
      dateTo={dateTo}
      dateBasis={dateBasis}
      action={action}
    />
  );
}
