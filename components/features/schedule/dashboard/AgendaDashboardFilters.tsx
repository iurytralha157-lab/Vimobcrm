"use client";

import { useMemo, useState } from "react";
import {
  differenceInCalendarDays,
  format,
  isSameDay,
  isSameYear,
  parseISO,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarRange, Check, SlidersHorizontal, X } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardEventType,
  ScheduleDashboardQuery,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import {
  AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
  getAgendaDashboardPresetRange,
  type AgendaDashboardDatePreset,
} from "./agenda-dashboard-date-range";

const ALL_VALUE = "__all__";

export type AgendaDashboardTeamOption = {
  id: string;
  name: string;
  userIds?: string[];
};

export type AgendaDashboardUserOption = {
  id: string;
  name: string;
};

export type AgendaDashboardSourceOption = {
  value: string;
  label: string;
};

type DatePresetOption = {
  value: AgendaDashboardDatePreset;
  label: string;
};

const DATE_PRESETS: DatePresetOption[] = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "this_week", label: "Esta semana" },
  { value: "last_week", label: "Semana passada" },
  { value: "next_week", label: "Próxima semana" },
  { value: "this_month", label: "Este mês" },
  { value: "last_30_days", label: "Últimos 30 dias" },
  { value: "next_30_days", label: "Próximos 30 dias" },
];

const EVENT_TYPE_OPTIONS: Array<{
  value: ScheduleDashboardEventType;
  label: string;
}> = [
  { value: "visit", label: "Visita" },
  { value: "meeting", label: "Reunião" },
  { value: "call", label: "Ligação" },
  { value: "email", label: "E-mail" },
  { value: "message", label: "Mensagem" },
  { value: "task", label: "Tarefa" },
];

const STATUS_OPTIONS: Array<{ value: ScheduleDashboardStatus; label: string }> =
  [
    { value: "scheduled", label: "Em aberto" },
    { value: "completed", label: "Realizado" },
    { value: "cancelled", label: "Cancelado" },
    { value: "no_show", label: "No-show" },
    { value: "overdue", label: "Em atraso" },
    { value: "upcoming", label: "Próximos agendamentos" },
  ];

const DATE_BASIS_OPTIONS = [
  { value: "start_time", label: "Data agendada" },
  { value: "created_at", label: "Data de criação" },
  { value: "completed_at", label: "Data do desfecho" },
] as const;

export type AgendaDashboardFiltersProps = {
  filters: ScheduleDashboardQuery;
  onChange: (filters: ScheduleDashboardQuery) => void;
  teams?: AgendaDashboardTeamOption[];
  users?: AgendaDashboardUserOption[];
  sources?: AgendaDashboardSourceOption[];
  isLoadingTeams?: boolean;
  isLoadingUsers?: boolean;
  showTeamFilter?: boolean;
  reportTimezone?: string;
  className?: string;
};

function formatCalendarDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function getActivePreset(
  filters: ScheduleDashboardQuery,
  reportTimezone: string,
) {
  return DATE_PRESETS.find(({ value }) => {
    const presetRange = getAgendaDashboardPresetRange(
      value,
      new Date(),
      reportTimezone,
    );
    return (
      filters.dateFrom === presetRange.dateFrom &&
      filters.dateTo === presetRange.dateTo
    );
  })?.value;
}

function getPeriodLabel(
  filters: ScheduleDashboardQuery,
  reportTimezone: string,
) {
  const preset = getActivePreset(filters, reportTimezone);
  const presetLabel = DATE_PRESETS.find(
    (option) => option.value === preset,
  )?.label;
  if (presetLabel) return presetLabel;

  const from = parseISO(filters.dateFrom);
  const to = parseISO(filters.dateTo);
  if (isSameDay(from, to)) {
    return format(from, "dd 'de' MMM 'de' yyyy", { locale: ptBR });
  }

  if (isSameYear(from, to)) {
    return `${format(from, "dd MMM", { locale: ptBR })} – ${format(
      to,
      "dd MMM yyyy",
      {
        locale: ptBR,
      },
    )}`;
  }

  return `${format(from, "dd MMM yyyy", { locale: ptBR })} – ${format(
    to,
    "dd MMM yyyy",
    {
      locale: ptBR,
    },
  )}`;
}

function PeriodFilter({
  filters,
  onChange,
  reportTimezone,
}: Pick<AgendaDashboardFiltersProps, "filters" | "onChange"> & {
  reportTimezone: string;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [draftRange, setDraftRange] = useState<DateRange | undefined>();
  const activePreset = getActivePreset(filters, reportTimezone);
  const customRangeTooLong = Boolean(
    draftRange?.from &&
    draftRange.to &&
    differenceInCalendarDays(draftRange.to, draftRange.from) > 365,
  );

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftRange({
        from: parseISO(filters.dateFrom),
        to: parseISO(filters.dateTo),
      });
    }
    setOpen(nextOpen);
  };

  const applyPreset = (preset: AgendaDashboardDatePreset) => {
    const range = getAgendaDashboardPresetRange(
      preset,
      new Date(),
      reportTimezone,
    );
    onChange({
      ...filters,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
    });
    setOpen(false);
  };

  const applyCustomRange = () => {
    if (!draftRange?.from || !draftRange.to || customRangeTooLong) return;
    onChange({
      ...filters,
      dateFrom: formatCalendarDate(draftRange.from),
      dateTo: formatCalendarDate(draftRange.to),
    });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={getPeriodLabel(filters, reportTimezone)}
          className="h-8 max-w-[180px] gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground"
        >
          <CalendarRange className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">
            {getPeriodLabel(filters, reportTimezone)}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className="app-header-popover w-auto overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-0"
      >
        <div className={cn("flex", isMobile && "w-[min(94vw,350px)] flex-col")}>
          <div className="w-full space-y-1 border-b border-[var(--app-border)] bg-[var(--app-surface-soft)] p-2 sm:w-[168px] sm:border-b-0 sm:border-r">
            <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--app-text-tertiary)]">
              Atalhos
            </p>
            {DATE_PRESETS.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => applyPreset(option.value)}
                className={cn(
                  "h-8 w-full justify-between rounded-[6px] px-2 text-[11px] font-light shadow-none",
                  activePreset === option.value
                    ? "bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary"
                    : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]",
                )}
              >
                {option.label}
                {activePreset === option.value ? (
                  <Check className="h-3.5 w-3.5" />
                ) : null}
              </Button>
            ))}
          </div>

          <div className="p-2">
            <p className="px-2 pb-1 pt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--app-text-tertiary)]">
              Personalizado
            </p>
            <Calendar
              mode="range"
              selected={draftRange}
              onSelect={setDraftRange}
              numberOfMonths={isMobile ? 1 : 2}
              locale={ptBR}
              className="p-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={
                !draftRange?.from || !draftRange.to || customRangeTooLong
              }
              onClick={applyCustomRange}
              className="mt-2 h-8 w-full rounded-[6px] text-[11px] font-normal shadow-none"
            >
              Aplicar período
            </Button>
            {customRangeTooLong ? (
              <p
                role="alert"
                className="mt-1.5 text-center text-[9px] font-light text-destructive"
              >
                Selecione no máximo 366 dias.
              </p>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function AgendaDashboardFilters({
  filters,
  onChange,
  teams = [],
  users = [],
  sources = [],
  isLoadingTeams = false,
  isLoadingUsers = false,
  showTeamFilter = true,
  reportTimezone = AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
  className,
}: AgendaDashboardFiltersProps) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [retainedSourceOptions, setRetainedSourceOptions] = useState<
    AgendaDashboardSourceOption[]
  >([]);
  const availableUsers = useMemo(() => {
    if (!filters.teamId) return users;
    const selectedTeam = teams.find((team) => team.id === filters.teamId);
    if (!selectedTeam?.userIds) return users;
    const memberIds = new Set(selectedTeam.userIds);
    return users.filter((user) => memberIds.has(user.id));
  }, [filters.teamId, teams, users]);
  const availableSources = useMemo(() => {
    const options = filters.source
      ? [...retainedSourceOptions, ...sources]
      : sources;
    const uniqueOptions = new Map(
      options.map((option) => [option.value, option.label] as const),
    );
    return Array.from(uniqueOptions, ([value, label]) => ({
      value,
      label,
    })).sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
  }, [filters.source, retainedSourceOptions, sources]);
  const activeFilterCount = useMemo(
    () =>
      [
        filters.teamId,
        filters.userId,
        filters.source,
        filters.eventType,
        filters.status,
        filters.dateBasis !== "start_time" ? filters.dateBasis : undefined,
      ].filter(Boolean).length,
    [filters],
  );

  const clearAdditionalFilters = () => {
    onChange({
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      dateBasis: "start_time",
    });
  };

  return (
    <div
      className={cn("flex shrink-0 items-center justify-end gap-2", className)}
    >
      <PeriodFilter
        filters={filters}
        onChange={onChange}
        reportTimezone={reportTimezone}
      />

      <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(
              "h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground",
              activeFilterCount > 0 &&
                "bg-primary/10 text-primary hover:text-primary",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Demais filtros</span>
            {activeFilterCount > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-medium text-primary-foreground">
                {activeFilterCount}
              </span>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="app-header-popover w-[min(94vw,380px)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-[12px] font-medium text-[var(--app-text-primary)]">
                Demais filtros
              </p>
              <p className="mt-0.5 text-[10px] font-light text-[var(--app-text-tertiary)]">
                Refine os indicadores sem alterar o período.
              </p>
            </div>
            {activeFilterCount > 0 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAdditionalFilters}
                className="h-7 gap-1 rounded-[6px] px-2 text-[10px] font-light text-muted-foreground shadow-none hover:bg-destructive/10 hover:text-destructive"
              >
                <X className="h-3 w-3" />
                Limpar
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FilterField label="Base do período">
              <Select
                value={filters.dateBasis}
                onValueChange={(value) =>
                  onChange({
                    ...filters,
                    dateBasis: value as ScheduleDashboardQuery["dateBasis"],
                    status:
                      value !== "start_time" &&
                      (filters.status === "overdue" ||
                        filters.status === "upcoming")
                        ? undefined
                        : filters.status,
                  })
                }
              >
                <SelectTrigger
                  className="h-9 rounded-[6px] text-[11px]"
                  aria-label="Base do período"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_BASIS_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-[11px]"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            {showTeamFilter ? (
              <FilterField label="Equipe">
                <Select
                  value={filters.teamId ?? ALL_VALUE}
                  onValueChange={(value) => {
                    const teamId = value === ALL_VALUE ? undefined : value;
                    const selectedTeam = teams.find(
                      (team) => team.id === teamId,
                    );
                    const selectedTeamUserIds = selectedTeam?.userIds;
                    const userStillBelongsToTeam =
                      !teamId ||
                      !filters.userId ||
                      !selectedTeamUserIds ||
                      selectedTeamUserIds.includes(filters.userId);
                    onChange({
                      ...filters,
                      teamId,
                      userId: userStillBelongsToTeam
                        ? filters.userId
                        : undefined,
                    });
                  }}
                >
                  <SelectTrigger
                    className="h-9 rounded-[6px] text-[11px]"
                    aria-label="Equipe"
                  >
                    <SelectValue
                      placeholder={
                        isLoadingTeams ? "Carregando..." : "Todas as equipes"
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE} className="text-[11px]">
                      Todas as equipes
                    </SelectItem>
                    {teams.map((team) => (
                      <SelectItem
                        key={team.id}
                        value={team.id}
                        className="text-[11px]"
                      >
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            ) : null}

            <FilterField label="Usuário">
              <Select
                value={filters.userId ?? ALL_VALUE}
                onValueChange={(value) =>
                  onChange({
                    ...filters,
                    userId: value === ALL_VALUE ? undefined : value,
                  })
                }
              >
                <SelectTrigger
                  className="h-9 rounded-[6px] text-[11px]"
                  aria-label="Usuário"
                >
                  <SelectValue
                    placeholder={
                      isLoadingUsers ? "Carregando..." : "Todos os usuários"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE} className="text-[11px]">
                    Todos os usuários
                  </SelectItem>
                  {availableUsers.map((user) => (
                    <SelectItem
                      key={user.id}
                      value={user.id}
                      className="text-[11px]"
                    >
                      {user.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Origem">
              <Select
                value={filters.source ?? ALL_VALUE}
                onValueChange={(value) => {
                  if (value !== ALL_VALUE) {
                    setRetainedSourceOptions(availableSources);
                  }
                  onChange({
                    ...filters,
                    source: value === ALL_VALUE ? undefined : value,
                  });
                }}
              >
                <SelectTrigger
                  className="h-9 rounded-[6px] text-[11px]"
                  aria-label="Origem"
                >
                  <SelectValue placeholder="Todas as origens" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE} className="text-[11px]">
                    Todas as origens
                  </SelectItem>
                  {availableSources.map((source) => (
                    <SelectItem
                      key={source.value}
                      value={source.value}
                      className="text-[11px]"
                    >
                      {source.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Tipo de atividade">
              <Select
                value={filters.eventType ?? ALL_VALUE}
                onValueChange={(value) =>
                  onChange({
                    ...filters,
                    eventType:
                      value === ALL_VALUE
                        ? undefined
                        : (value as ScheduleDashboardEventType),
                  })
                }
              >
                <SelectTrigger
                  className="h-9 rounded-[6px] text-[11px]"
                  aria-label="Tipo de atividade"
                >
                  <SelectValue placeholder="Todos os tipos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE} className="text-[11px]">
                    Todos os tipos
                  </SelectItem>
                  {EVENT_TYPE_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-[11px]"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status">
              <Select
                value={filters.status ?? ALL_VALUE}
                onValueChange={(value) => {
                  const status =
                    value === ALL_VALUE
                      ? undefined
                      : (value as ScheduleDashboardStatus);
                  onChange({
                    ...filters,
                    dateBasis:
                      status === "overdue" || status === "upcoming"
                        ? "start_time"
                        : filters.dateBasis,
                    status,
                  });
                }}
              >
                <SelectTrigger
                  className="h-9 rounded-[6px] text-[11px]"
                  aria-label="Status"
                >
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_VALUE} className="text-[11px]">
                    Todos os status
                  </SelectItem>
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="text-[11px]"
                    >
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
        {label}
      </span>
      {children}
    </div>
  );
}
