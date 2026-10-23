"use client";

import { endOfDay, format, parseISO } from "date-fns";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { datePresetOptions, type DatePreset } from "@/hooks/use-dashboard-filters";
import type { ScheduleDashboardQuery } from "@/lib/validation/schedule-dashboard";
import {
  getAgendaDashboardPresetRange,
  getAgendaDashboardSharedPresetRange,
  validateAgendaDashboardCalendarRange,
} from "@/components/features/schedule/dashboard/agenda-dashboard-date-range";

/** Presentation is shared; Agenda keeps its required civil-date query contract. */
export function AgendaDashboardPeriodFilter({
  filters,
  onChange,
  reportTimezone,
}: {
  filters: ScheduleDashboardQuery;
  onChange: (filters: ScheduleDashboardQuery) => void;
  reportTimezone: string;
}) {
  const appliedRange = {
    from: parseISO(filters.dateFrom),
    to: endOfDay(parseISO(filters.dateTo)),
  };
  const getPresetDates = (preset: Exclude<DatePreset, "custom">) =>
    getAgendaDashboardSharedPresetRange(preset, new Date(), reportTimezone);
  const activePreset = datePresetOptions.find(({ value }) => {
    if (value === "custom") return false;
    const range = getPresetDates(value);
    return range.dateFrom === filters.dateFrom && range.dateTo === filters.dateTo;
  })?.value ?? "custom";

  const applyPreset = (preset: DatePreset | null) => {
    // The shared picker follows this callback with the custom range callback.
    if (preset === "custom") return;
    const range = preset
      ? getPresetDates(preset)
      : getAgendaDashboardPresetRange("this_week", new Date(), reportTimezone);
    onChange({ ...filters, ...range });
  };

  return (
    <DateFilterPopover
      datePreset={activePreset}
      onDatePresetChange={applyPreset}
      customDateRange={activePreset === "custom" ? appliedRange : null}
      onCustomDateRangeChange={(range) => {
        // Presets and clear also emit null; neither removes the required period.
        if (!range || validateAgendaDashboardCalendarRange(range)) return;
        onChange({
          ...filters,
          dateFrom: format(range.from, "yyyy-MM-dd"),
          dateTo: format(range.to, "yyyy-MM-dd"),
        });
      }}
      getPresetRange={(preset) => {
        if (preset === "custom") return appliedRange;
        const range = getPresetDates(preset);
        return { from: parseISO(range.dateFrom), to: endOfDay(parseISO(range.dateTo)) };
      }}
      validateRange={validateAgendaDashboardCalendarRange}
      defaultPreset={null}
      dateLabel="Período da agenda"
      triggerClassName="bg-primary/50 text-white hover:bg-primary hover:text-white"
      align="end"
    />
  );
}
