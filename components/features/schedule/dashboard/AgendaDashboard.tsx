"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CalendarSearch,
  LoaderCircle,
  RefreshCw,
  WifiOff,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useScheduleDashboard,
  useScheduleDashboardQueryScope,
} from "@/hooks/schedule/use-schedule-dashboard";
import { useScheduleUsers } from "@/hooks/use-schedule-users";
import { useTeams } from "@/hooks/use-teams";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { getPublicErrorMessage } from "@/lib/api/vimob-error";
import { cn } from "@/lib/utils";
import {
  scheduleDashboardQuerySchema,
  type ScheduleDashboardQuery,
} from "@/lib/validation/schedule-dashboard";

import { AgendaDashboardFilters } from "./AgendaDashboardFilters";
import { AgendaDashboardKpis } from "./AgendaDashboardKpis";
import { AgendaOverduePanel } from "./AgendaOverduePanel";
import {
  AgendaSourceDistributionPanel,
  AgendaTypeDistributionPanel,
} from "./AgendaDashboardPanels";
import { AgendaAdaptiveChart } from "./AgendaAdaptiveChart";
import { AgendaResponsibleResultsPanel } from "./AgendaResponsibleResultsPanel";
import { AgendaEventsPanel } from "./AgendaEventsPanel";
import {
  AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
  getAgendaDashboardPresetRange,
} from "./agenda-dashboard-date-range";

const URL_KEYS = {
  dateFrom: "ad_from",
  dateTo: "ad_to",
  dateBasis: "ad_basis",
  teamId: "ad_team",
  userId: "ad_user",
  source: "ad_source",
  eventType: "ad_type",
  status: "ad_status",
} as const;

export type AgendaDashboardProps = {
  filters?: ScheduleDashboardQuery;
  initialFilters?: Partial<ScheduleDashboardQuery>;
  onFiltersChange?: (filters: ScheduleDashboardQuery) => void;
  syncFiltersToUrl?: boolean;
  className?: string;
};

export function createDefaultAgendaDashboardFilters(
  referenceDate = new Date(),
  timeZone = AGENDA_DASHBOARD_FALLBACK_TIME_ZONE,
): ScheduleDashboardQuery {
  const range = getAgendaDashboardPresetRange(
    "this_week",
    referenceDate,
    timeZone,
  );
  return {
    ...range,
    dateBasis: "start_time",
  };
}

function createInitialFilters(
  initialFilters?: Partial<ScheduleDashboardQuery>,
) {
  const defaults = createDefaultAgendaDashboardFilters();
  const result = scheduleDashboardQuerySchema.safeParse({
    ...defaults,
    ...initialFilters,
  });
  return result.success ? normalizeOperationalFilters(result.data) : defaults;
}

function normalizeOperationalFilters(filters: ScheduleDashboardQuery) {
  if (
    (filters.status === "overdue" || filters.status === "upcoming") &&
    filters.dateBasis !== "start_time"
  ) {
    return { ...filters, dateBasis: "start_time" as const };
  }
  return filters;
}

function readFiltersFromUrl(fallback: ScheduleDashboardQuery) {
  const searchParams = new URLSearchParams(window.location.search);
  let filters = fallback;
  const dateFrom = searchParams.get(URL_KEYS.dateFrom);
  const dateTo = searchParams.get(URL_KEYS.dateTo);

  if (dateFrom || dateTo) {
    const dateResult = scheduleDashboardQuerySchema.safeParse({
      ...filters,
      dateFrom: dateFrom ?? filters.dateFrom,
      dateTo: dateTo ?? filters.dateTo,
    });
    if (dateResult.success) filters = dateResult.data;
  }

  const independentKeys = [
    "dateBasis",
    "teamId",
    "userId",
    "source",
    "eventType",
    "status",
  ] as const;

  independentKeys.forEach((key) => {
    const value = searchParams.get(URL_KEYS[key]);
    if (!value) return;
    const result = scheduleDashboardQuerySchema.safeParse({
      ...filters,
      [key]: value,
    });
    if (result.success) filters = result.data;
  });

  return normalizeOperationalFilters(filters);
}

function writeFiltersToUrl(filters: ScheduleDashboardQuery) {
  const url = new URL(window.location.href);
  const values: Record<keyof typeof URL_KEYS, string | undefined> = {
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo,
    dateBasis: filters.dateBasis,
    teamId: filters.teamId,
    userId: filters.userId,
    source: filters.source,
    eventType: filters.eventType,
    status: filters.status,
  };

  Object.entries(URL_KEYS).forEach(([key, parameter]) => {
    const value = values[key as keyof typeof URL_KEYS];
    if (value) url.searchParams.set(parameter, value);
    else url.searchParams.delete(parameter);
  });

  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl !== currentUrl) {
    window.history.replaceState(window.history.state, "", nextUrl);
  }
}

export function AgendaDashboard({
  filters: controlledFilters,
  initialFilters,
  onFiltersChange,
  syncFiltersToUrl = true,
  className,
}: AgendaDashboardProps) {
  const [internalFilters, setInternalFilters] =
    useState<ScheduleDashboardQuery>(() =>
      createInitialFilters(initialFilters),
    );
  const isControlled = controlledFilters !== undefined;
  const effectiveFilters = useMemo(
    () => normalizeOperationalFilters(controlledFilters ?? internalFilters),
    [controlledFilters, internalFilters],
  );
  const effectiveFiltersKey = useMemo(
    () =>
      [
        effectiveFilters.dateFrom,
        effectiveFilters.dateTo,
        effectiveFilters.dateBasis,
        effectiveFilters.teamId ?? "",
        effectiveFilters.userId ?? "",
        effectiveFilters.source ?? "",
        effectiveFilters.eventType ?? "",
        effectiveFilters.status ?? "",
      ].join("|"),
    [effectiveFilters],
  );
  const [urlReady, setUrlReady] = useState(
    () => !syncFiltersToUrl || isControlled,
  );
  const urlHydratedRef = useRef(false);
  const canAlignDefaultPeriodRef = useRef(
    !isControlled && !initialFilters?.dateFrom && !initialFilters?.dateTo,
  );
  const dashboardScope = useScheduleDashboardQueryScope();
  const dashboardIdentityKey = `${dashboardScope.organizationId ?? ""}|${dashboardScope.currentUserId ?? ""}`;
  const filterScopeKey = `${dashboardScope.organizationId ?? ""}|${dashboardScope.currentUserId ?? ""}|${dashboardScope.accessSignature}`;
  const previousDashboardIdentityRef = useRef(dashboardIdentityKey);
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const canViewTeams = !permissionsLoading && hasPermission("team_view");

  const applyFilters = useCallback(
    (nextFilters: ScheduleDashboardQuery) => {
      const result = scheduleDashboardQuerySchema.safeParse(nextFilters);
      if (!result.success) return;
      canAlignDefaultPeriodRef.current = false;
      const normalizedFilters = normalizeOperationalFilters(result.data);
      if (!isControlled) setInternalFilters(normalizedFilters);
      onFiltersChange?.(normalizedFilters);
    },
    [isControlled, onFiltersChange],
  );

  useEffect(() => {
    if (!dashboardScope.organizationId || !dashboardScope.currentUserId) return;
    const previousIdentity = previousDashboardIdentityRef.current;
    previousDashboardIdentityRef.current = dashboardIdentityKey;
    if (
      !previousIdentity ||
      previousIdentity === "|" ||
      previousIdentity === dashboardIdentityKey
    ) {
      return;
    }

    const nextFilters = {
      ...effectiveFilters,
      teamId: undefined,
      userId: undefined,
      source: undefined,
    };
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (!isControlled) setInternalFilters(nextFilters);
      onFiltersChange?.(nextFilters);
    });
    return () => {
      active = false;
    };
  }, [
    dashboardIdentityKey,
    dashboardScope.currentUserId,
    dashboardScope.organizationId,
    effectiveFilters,
    isControlled,
    onFiltersChange,
  ]);

  useEffect(() => {
    if (urlHydratedRef.current) return;

    if (!syncFiltersToUrl || isControlled) {
      urlHydratedRef.current = true;
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || urlHydratedRef.current) return;
      urlHydratedRef.current = true;
      const searchParams = new URLSearchParams(window.location.search);
      if (
        searchParams.has(URL_KEYS.dateFrom) ||
        searchParams.has(URL_KEYS.dateTo)
      ) {
        canAlignDefaultPeriodRef.current = false;
      }
      const hydratedFilters = readFiltersFromUrl(internalFilters);
      setInternalFilters(hydratedFilters);
      onFiltersChange?.(hydratedFilters);
      setUrlReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, [internalFilters, isControlled, onFiltersChange, syncFiltersToUrl]);

  useEffect(() => {
    if (!syncFiltersToUrl || !urlReady) return;
    writeFiltersToUrl(effectiveFilters);
  }, [effectiveFilters, syncFiltersToUrl, urlReady]);

  const dashboardQuery = useScheduleDashboard(effectiveFilters, {
    enabled: urlReady,
  });
  const teamsQuery = useTeams({ enabled: urlReady && canViewTeams });
  const usersQuery = useScheduleUsers({ enabled: urlReady });
  const data = dashboardQuery.data;

  useEffect(() => {
    if (
      !data ||
      !urlReady ||
      !canAlignDefaultPeriodRef.current ||
      dashboardQuery.isPlaceholderData
    ) {
      return;
    }

    const alignedPeriod = createDefaultAgendaDashboardFilters(
      new Date(),
      data.report_timezone,
    );
    if (
      alignedPeriod.dateFrom === effectiveFilters.dateFrom &&
      alignedPeriod.dateTo === effectiveFilters.dateTo
    ) {
      canAlignDefaultPeriodRef.current = false;
      return;
    }

    const alignedFilters = {
      ...effectiveFilters,
      dateFrom: alignedPeriod.dateFrom,
      dateTo: alignedPeriod.dateTo,
    };
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled || !canAlignDefaultPeriodRef.current) return;
      canAlignDefaultPeriodRef.current = false;
      setInternalFilters(alignedFilters);
      onFiltersChange?.(alignedFilters);
    });

    return () => {
      cancelled = true;
    };
  }, [
    dashboardQuery.isPlaceholderData,
    data,
    effectiveFilters,
    onFiltersChange,
    urlReady,
  ]);

  const sourceOptions = useMemo(() => {
    const options = (data?.by_source ?? [])
      .map((source) => ({ value: source.key, label: source.label }))
      .sort((left, right) => left.label.localeCompare(right.label, "pt-BR"));
    if (
      !effectiveFilters.source ||
      options.some((option) => option.value === effectiveFilters.source)
    ) {
      return options;
    }
    return options.concat({
      value: effectiveFilters.source,
      label:
        effectiveFilters.source === "__none__"
          ? "Sem origem"
          : effectiveFilters.source,
    });
  }, [data?.by_source, effectiveFilters.source]);

  const teamOptions = useMemo(
    () =>
      (teamsQuery.data ?? []).map((team) => ({
        id: team.id,
        name: team.name,
        userIds: (team.members ?? []).map((member) => member.user_id),
      })),
    [teamsQuery.data],
  );
  const userOptions = useMemo(
    () =>
      (usersQuery.data ?? []).map((user) => ({
        id: user.id,
        name: user.name,
      })),
    [usersQuery.data],
  );

  const hasActivityData = Boolean(
    data &&
    (data.kpis.total > 0 ||
      data.kpis.completed > 0 ||
      data.kpis.cancelled > 0 ||
      data.kpis.no_show > 0 ||
      data.kpis.open > 0 ||
      data.kpis.overdue > 0 ||
      data.kpis.upcoming > 0 ||
      data.by_type.some((item) => item.count > 0) ||
      data.by_source.some((item) => item.count > 0) ||
      data.performer_ranking.length > 0),
  );
  const selectStatus = useCallback(
    (status?: ScheduleDashboardQuery["status"]) => {
      const nextStatus =
        effectiveFilters.status === status ? undefined : status;
      applyFilters({
        ...effectiveFilters,
        dateBasis:
          nextStatus === "overdue" || nextStatus === "upcoming"
            ? "start_time"
            : effectiveFilters.dateBasis,
        status: nextStatus,
      });
    },
    [applyFilters, effectiveFilters],
  );

  const selectOverdueOwner = useCallback(
    (userId: string) => {
      applyFilters({
        ...effectiveFilters,
        dateBasis: "start_time",
        status: "overdue",
        userId,
      });
    },
    [applyFilters, effectiveFilters],
  );

  return (
    <section
      aria-label="Dashboard da agenda"
      aria-busy={dashboardQuery.isFetching}
      className={cn("min-w-0 space-y-3 p-2 sm:space-y-4 sm:p-4", className)}
    >
      <div className="flex min-w-0 justify-end">
        <AgendaDashboardFilters
          key={filterScopeKey}
          filters={effectiveFilters}
          onChange={applyFilters}
          teams={teamOptions}
          users={userOptions}
          sources={sourceOptions}
          isLoadingTeams={teamsQuery.isPending}
          isLoadingUsers={usersQuery.isPending}
          showTeamFilter={canViewTeams}
          reportTimezone={
            data?.report_timezone ?? AGENDA_DASHBOARD_FALLBACK_TIME_ZONE
          }
        />
      </div>

      {!urlReady || dashboardQuery.isPending ? (
        <AgendaDashboardLoading />
      ) : dashboardQuery.isError && !data ? (
        <AgendaDashboardError
          message={getPublicErrorMessage(
            dashboardQuery.error,
            "Não foi possível carregar a dashboard da agenda agora.",
          )}
          onRetry={() => void dashboardQuery.refetch()}
        />
      ) : data ? (
        <>
          {dashboardQuery.isError ? (
            <AgendaDashboardRefreshWarning
              onRetry={() => void dashboardQuery.refetch()}
            />
          ) : dashboardQuery.isPlaceholderData ? (
            <AgendaDashboardTransitionNotice />
          ) : null}

          <AgendaDashboardKpis
            kpis={data.kpis}
            byType={data.by_type}
            dateBasis={data.period.date_basis}
            activeStatus={effectiveFilters.status}
            onStatusSelect={selectStatus}
          />

          {!hasActivityData ? (
            <AgendaDashboardEmpty />
          ) : (
            <>
              <div className="grid min-w-0 grid-cols-1 items-stretch gap-3 xl:grid-cols-12">
                <div className="min-w-0 xl:col-span-8">
                  <AgendaAdaptiveChart
                    hourly={data.hourly}
                    daily={data.daily}
                    dateFrom={data.period.date_from}
                    dateTo={data.period.date_to}
                    dateBasis={data.period.date_basis}
                  />
                </div>
                <div className="min-w-0 xl:col-span-4">
                  <AgendaOverduePanel
                    owners={data.overdue_by_owner}
                    totalOverdue={data.kpis.overdue}
                    onSelectOwner={selectOverdueOwner}
                  />
                </div>
              </div>

              <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-3">
                <AgendaEventsPanel
                  filters={effectiveFilters}
                  period={data.period}
                  reportTimezone={data.report_timezone}
                  enabled={!dashboardQuery.isPlaceholderData}
                  lifecycleRevision={
                    effectiveFilters.status === "overdue" ||
                    effectiveFilters.status === "upcoming"
                      ? data.kpis.total
                      : 0
                  }
                />
                <AgendaTypeDistributionPanel items={data.by_type} />
                <AgendaSourceDistributionPanel items={data.by_source} />
              </div>

              <AgendaResponsibleResultsPanel
                key={effectiveFiltersKey}
                performers={data.performer_ranking}
              />
            </>
          )}
        </>
      ) : null}
    </section>
  );
}

function AgendaDashboardLoading() {
  return (
    <div aria-label="Carregando dashboard da agenda" className="space-y-3">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[112px] rounded-[8px]" />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-[64px] rounded-[8px]" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-12">
        <Skeleton className="h-[360px] rounded-[8px] xl:col-span-8" />
        <Skeleton className="h-[360px] rounded-[8px] xl:col-span-4" />
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-[440px] rounded-[8px]" />
        ))}
      </div>
      <Skeleton className="h-[280px] rounded-[8px]" />
    </div>
  );
}

function AgendaDashboardTransitionNotice() {
  return (
    <div
      role="status"
      className="flex items-center gap-2 rounded-[8px] bg-sky-500/10 px-3 py-2 text-[10px] font-light text-sky-700 dark:text-sky-300"
    >
      <LoaderCircle
        className="h-3.5 w-3.5 shrink-0 animate-spin"
        aria-hidden="true"
      />
      Atualizando o recorte; os indicadores ainda refletem a leitura anterior.
    </div>
  );
}

function AgendaDashboardRefreshWarning({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-[8px] bg-amber-500/10 px-3 py-2 text-amber-800 dark:text-amber-300 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="flex min-w-0 items-center gap-2 text-[10px] font-light">
        <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span>
          A atualização falhou. Os indicadores abaixo mostram a última leitura
          válida.
        </span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onRetry}
        className="h-7 shrink-0 gap-1.5 rounded-[6px] px-2 text-[10px] font-light text-current shadow-none hover:bg-amber-500/15 hover:text-current"
      >
        <RefreshCw className="h-3 w-3" />
        Atualizar
      </Button>
    </div>
  );
}

function AgendaDashboardError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-destructive/10 text-destructive">
        <AlertCircle className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-[13px] font-medium text-[var(--app-text-primary)]">
        Não foi possível carregar os indicadores
      </h2>
      <p className="mt-1 max-w-md text-[11px] font-light text-[var(--app-text-tertiary)]">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={onRetry}
        className="mt-4 h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[11px] shadow-none"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Tentar novamente
      </Button>
    </div>
  );
}

function AgendaDashboardEmpty() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-solid)] px-6 py-10 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-primary/10 text-primary">
        <CalendarSearch className="h-5 w-5" aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-[13px] font-medium text-[var(--app-text-primary)]">
        Nenhum agendamento encontrado
      </h2>
      <p className="mt-1 max-w-md text-[11px] font-light text-[var(--app-text-tertiary)]">
        Ajuste o período ou remova algum dos demais filtros para ampliar a
        busca.
      </p>
    </div>
  );
}
