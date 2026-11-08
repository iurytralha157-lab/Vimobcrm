"use client";

import { useMemo, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SearchableFilterSelect } from "@/components/shared/SearchableFilterSelect";
import { FILTER_UI } from "@/config/filter-ui";
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
import { cn } from "@/lib/utils";
import type {
  ScheduleDashboardEventType,
  ScheduleDashboardQuery,
  ScheduleDashboardStatus,
} from "@/lib/validation/schedule-dashboard";

import { AGENDA_DASHBOARD_FALLBACK_TIME_ZONE } from "./agenda-dashboard-date-range";
import { AgendaDashboardPeriodFilter } from "@/components/features/schedule/dashboard/AgendaDashboardPeriodFilter";

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
      <AgendaDashboardPeriodFilter
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
            aria-label="Demais filtros da agenda"
            className={cn(
              "h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-foreground",
              activeFilterCount > 0 &&
                "bg-primary/10 text-primary hover:text-primary",
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Filtros</span>
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
          className={cn("app-header-popover w-[min(94vw,380px)] rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4", FILTER_UI.panelViewport)}
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
                <SearchableFilterSelect value={filters.teamId ?? null} options={teams.map(team => ({ value: team.id, label: team.name }))} allLabel="Todas as equipes" ariaLabel="Equipe" loading={isLoadingTeams} onChange={value => {
                    const teamId = value ?? undefined;
                    const memberIds = teams.find(team => team.id === teamId)?.userIds;
                    const retainsUser = !teamId || !filters.userId || !memberIds || memberIds.includes(filters.userId);
                    onChange({ ...filters, teamId, userId: retainsUser ? filters.userId : undefined });
                  }} />
              </FilterField>
            ) : null}

            <FilterField label="Usuário">
              <SearchableFilterSelect value={filters.userId ?? null} options={availableUsers.map(user => ({ value: user.id, label: user.name }))} allLabel="Todos os usuários" ariaLabel="Usuário" loading={isLoadingUsers} onChange={value => onChange({ ...filters, userId: value ?? undefined })} />
            </FilterField>

            <FilterField label="Origem">
              <SearchableFilterSelect value={filters.source ?? null} options={availableSources.map(source => ({ value: source.value, label: source.label }))} allLabel="Todas as origens" ariaLabel="Origem" onChange={value => {
                  if (value) setRetainedSourceOptions(availableSources);
                  onChange({ ...filters, source: value ?? undefined });
                }} />
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
