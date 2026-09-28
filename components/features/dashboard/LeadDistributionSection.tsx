"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, ChevronDown, RefreshCw, UserRoundX, UsersRound, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardLeadDistribution } from "@/hooks/use-dashboard-stats";
import { visibleBrokerDistributionRows } from "./lead-distribution-rows";

const TEAM_SELECTION_STORAGE_PREFIX = "vimob:dashboard:teams:selected";

type AvailableTeam = {
  id: string;
  name: string;
};

type ChartRow = {
  id: string;
  name: string;
  leadCount: number | null;
  avatarUrl?: string | null;
  kind?: "entity" | "unassigned";
};

type ContextRow = {
  kind: "unassigned" | "other";
  name: string;
  leadCount: number;
};

type LeadDistributionSectionProps = {
  data?: DashboardLeadDistribution;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  organizationId?: string | null;
  currentUserId?: string | null;
  availableTeams?: AvailableTeam[];
  display?: "both" | "users" | "teams";
  selectedTeamId?: string | null;
  selectedUserId?: string | null;
  selectedBrokerId?: string | null;
  onBrokerSelect?: (brokerId: string | null) => void;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "?") + (parts.length > 1 ? parts.at(-1)?.[0] || "" : "");
}

function sortChartRows(rows: ChartRow[]) {
  return rows.sort(
    (a, b) =>
      (b.leadCount ?? -1) - (a.leadCount ?? -1) ||
      a.name.localeCompare(b.name, "pt-BR"),
  );
}

function readTeamSelection(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === "string")) {
      return null;
    }
    return Array.from(new Set(parsed.filter((id) => id.trim() !== "")));
  } catch {
    return null;
  }
}

function usePinnedTeamIds(
  organizationId: string | null | undefined,
  currentUserId: string | null | undefined,
  availableTeams: AvailableTeam[] | undefined,
) {
  const storageKey = useMemo(
    () =>
      organizationId && currentUserId
        ? `${TEAM_SELECTION_STORAGE_PREFIX}:${organizationId}:${currentUserId}`
        : null,
    [organizationId, currentUserId],
  );
  const [selectedTeamIds, setSelectedTeamIds] = useState<string[] | null>(null);
  const [hydratedKey, setHydratedKey] = useState<string | null | undefined>();

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!storageKey) {
        setSelectedTeamIds(null);
        setHydratedKey(null);
        return;
      }
      try {
        setSelectedTeamIds(readTeamSelection(localStorage.getItem(storageKey)));
      } catch {
        setSelectedTeamIds(null);
      }
      setHydratedKey(storageKey);
    });
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  // Teams may have been deactivated or removed since the preference was saved.
  useEffect(() => {
    if (!storageKey || hydratedKey !== storageKey || !availableTeams || selectedTeamIds === null) {
      return;
    }
    const visibleIds = new Set(availableTeams.map((team) => team.id));
    const nextIds = selectedTeamIds.filter((id) => visibleIds.has(id));
    if (nextIds.length === selectedTeamIds.length) return;
    const nextSelection = nextIds.length > 0 ? nextIds : null;
    queueMicrotask(() => setSelectedTeamIds(nextSelection));
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextSelection));
    } catch {
      // The selection remains usable in memory when storage is restricted.
    }
  }, [availableTeams, hydratedKey, selectedTeamIds, storageKey]);

  const activeSelection = hydratedKey === storageKey ? selectedTeamIds : null;

  const saveSelection = (ids: string[]) => {
    const validIds = new Set((availableTeams ?? []).map((team) => team.id));
    const nextIds = Array.from(new Set(ids.filter((id) => validIds.has(id))));
    const nextSelection =
      nextIds.length === validIds.size ? null : nextIds;
    setSelectedTeamIds(nextSelection);
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(nextSelection));
    } catch {
      // The selection remains usable in memory when storage is restricted.
    }
  };

  return { activeSelection, saveSelection, isHydrated: hydratedKey === storageKey };
}

function DistributionSkeleton() {
  return (
    <div className="flex h-[250px] items-end gap-3 px-2" aria-label="Carregando distribuição de leads">
      {[110, 170, 85, 145, 70].map((height, index) => (
        <div key={index} className="flex w-[58px] shrink-0 flex-col items-center gap-2">
          <Skeleton className="h-7 w-7 rounded-full" />
          <Skeleton className="w-9 rounded-t-[5px]" style={{ height }} />
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}

function DistributionBars({
  rows,
  variant,
  selectedBrokerId,
  onBrokerSelect,
}: {
  rows: ChartRow[];
  variant: "user" | "team";
  selectedBrokerId?: string | null;
  onBrokerSelect?: (brokerId: string | null) => void;
}) {
  const [localSelectedId, setLocalSelectedId] = useState<string | null>(null);
  const isBrokerChart = variant === "user";
  const selectedId = isBrokerChart && onBrokerSelect ? selectedBrokerId : localSelectedId;
  const expandBrokers = isBrokerChart && rows.length <= 5;
  const spreadBrokers = isBrokerChart && rows.length <= 8;
  const spreadTeams = !isBrokerChart && rows.length <= 5;
  const brokerColumnWidthClass = rows.length <= 2
    ? "min-w-[128px] flex-1"
    : rows.length === 3
      ? "min-w-[100px] flex-1"
      : rows.length === 4
        ? "min-w-[90px] flex-1"
        : rows.length === 5
          ? "min-w-[80px] flex-1"
          : rows.length === 6
            ? "w-[80px] sm:w-[112px]"
            : rows.length === 7
              ? "w-[76px] sm:w-[100px]"
              : spreadBrokers
                ? "w-[70px] sm:w-[92px]"
                : "w-[56px] sm:w-[60px]";
  const brokerBarWidthClass = rows.length <= 2
    ? "w-full max-w-[176px]"
    : rows.length === 3
      ? "w-full max-w-[152px]"
      : rows.length === 4
        ? "w-full max-w-[136px]"
        : rows.length === 5
          ? "w-full max-w-[120px]"
          : rows.length === 6
            ? "w-[72px] sm:w-[100px]"
            : rows.length === 7
              ? "w-[68px] sm:w-[88px]"
              : spreadBrokers
                ? "w-[62px] sm:w-[80px]"
                : "w-9";
  const teamColumnWidthClass = rows.length === 1
    ? "min-w-[132px] flex-1"
    : rows.length === 2
      ? "min-w-[110px] flex-1"
      : rows.length === 3
        ? "min-w-[88px] flex-1"
        : rows.length === 4
          ? "min-w-[72px] flex-1"
          : rows.length === 5
            ? "min-w-[64px] flex-1"
            : "w-[56px]";
  const teamBarWidthClass = rows.length === 1
    ? "w-full max-w-[140px]"
    : rows.length === 2
      ? "w-full max-w-[128px]"
      : rows.length === 3
        ? "w-full max-w-[112px]"
        : rows.length === 4
          ? "w-full max-w-[88px]"
    : rows.length === 5
      ? "w-full max-w-[72px]"
            : "w-11";
  const maxCount = Math.max(1, ...rows.map((row) => row.leadCount ?? 0));
  const selectedRow = rows.find((row) => row.id === selectedId);
  // Count, avatar, name and spacing occupy a fixed part of each broker column.
  // Only the remaining height represents the lead count.
  const brokerFixedContentHeight = 84;

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[250px] flex-col items-center justify-center gap-2 text-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
          {variant === "team"
            ? "Nenhuma equipe com leads para os filtros selecionados"
            : selectedBrokerId === "unassigned"
              ? "Nenhum lead sem responsável para os filtros selecionados"
              : "Nenhum corretor para os filtros selecionados"}
        </p>
      </div>
    );
  }

  return (
    <div className={`flex min-w-0 flex-1 flex-col justify-end ${isBrokerChart ? "min-h-[300px]" : "min-h-[250px]"}`}>
      <div
        className={`app-scrollbar overflow-x-auto rounded-[6px] pb-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${isBrokerChart ? "min-h-0 flex-1" : ""}`}
        role="region"
        aria-label={variant === "user"
          ? selectedBrokerId === "unassigned" ? "Leads sem responsável" : "Leads por corretor"
          : "Leads por equipe"}
        tabIndex={0}
      >
        <div className={`flex min-w-full items-end border-b border-[var(--app-border)] px-2 ${isBrokerChart ? expandBrokers ? "h-full w-full gap-2" : `h-full w-max gap-1.5 sm:gap-2 ${spreadBrokers ? "justify-evenly" : "justify-center"}` : spreadTeams ? "w-full gap-2" : "w-max justify-center gap-2"}`}>
          <TooltipProvider delayDuration={120}>
            {rows.map((row) => {
              const leadCount = Math.max(0, row.leadCount ?? 0);
              const countLabel = row.leadCount === null
                ? "Contagem indisponível"
                : `${row.leadCount} ${row.leadCount === 1 ? "lead" : "leads"}`;
              const teamBarHeight = row.leadCount === null ? 3 : Math.max(3, Math.round((leadCount / maxCount) * 145));
              const brokerBarRatio = leadCount / maxCount;
              const brokerMinimumBarHeight = Math.min(24, leadCount * 4);
              return (
                <div key={row.id} className={`shrink-0 ${isBrokerChart ? `relative h-full min-h-[290px] ${brokerColumnWidthClass}` : `flex h-[240px] flex-col justify-end ${teamColumnWidthClass}`}`}>
                  {!isBrokerChart ? <span className="shrink-0" style={{ height: 145 - teamBarHeight }} aria-hidden="true" /> : null}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        aria-label={isBrokerChart && onBrokerSelect
                          ? `${selectedId === row.id ? "Remover filtro de" : "Filtrar Dashboard por"} ${row.name}: ${countLabel}`
                          : `${row.name}: ${countLabel}`}
                        aria-pressed={selectedId === row.id}
                        onClick={() => {
                          if (isBrokerChart && onBrokerSelect) {
                            onBrokerSelect(selectedId === row.id ? null : row.id);
                            return;
                          }
                          setLocalSelectedId((current) => current === row.id ? null : row.id);
                        }}
                        className={`group flex w-full flex-col items-center justify-end rounded-t-[6px] px-1 pb-1 focus-visible:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${isBrokerChart ? "absolute bottom-0 left-0" : ""}`}
                        style={isBrokerChart ? {
                          height: `calc(${brokerBarRatio * 100}% + ${brokerFixedContentHeight * (1 - brokerBarRatio)}px)`,
                          minHeight: brokerFixedContentHeight + brokerMinimumBarHeight,
                        } : undefined}
                      >
                      <span className="mb-1 text-[11px] font-medium tabular-nums text-[var(--app-text-primary)]">
                        {row.leadCount === null ? "—" : row.leadCount.toLocaleString("pt-BR")}
                      </span>
                      {variant === "user" ? (
                        row.kind === "unassigned" ? (
                          <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-primary">
                            <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" />
                          </span>
                        ) : (
                          <Avatar className="mb-1 h-7 w-7 border border-[var(--app-border)]">
                            <AvatarImage src={row.avatarUrl || undefined} alt="" />
                            <AvatarFallback className="bg-primary/15 text-[9px] font-medium uppercase text-primary">
                              {initials(row.name)}
                            </AvatarFallback>
                          </Avatar>
                        )
                      ) : (
                        <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
                          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                      <span
                        className={
                          row.leadCount === null
                            ? `${isBrokerChart ? brokerBarWidthClass : teamBarWidthClass} rounded-t-[5px] bg-[var(--app-border)]`
                            : isBrokerChart
                              ? `${brokerBarWidthClass} rounded-t-[5px] bg-primary transition-colors group-hover:bg-primary/75`
                              : `${teamBarWidthClass} rounded-t-[5px] bg-violet-500 transition-colors group-hover:bg-violet-400`
                        }
                        style={isBrokerChart ? { flexGrow: 1, flexBasis: 0, minHeight: brokerMinimumBarHeight } : { height: teamBarHeight }}
                        aria-hidden="true"
                      />
                      <span className="mt-2 block w-full shrink-0 truncate text-center text-[10px] leading-[15px] font-light text-[var(--app-text-secondary)]">
                        {row.name}
                      </span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6} collisionPadding={12} className="max-w-[min(240px,calc(100vw-24px))]">
                    <div className="flex items-center gap-2">
                      {variant === "user" ? (
                        row.kind === "unassigned" ? (
                          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/15 text-primary">
                            <UserRoundX className="h-4 w-4" aria-hidden="true" />
                          </span>
                        ) : (
                          <Avatar className="h-8 w-8 border border-[var(--app-border)]">
                            <AvatarImage src={row.avatarUrl || undefined} alt="" />
                            <AvatarFallback className="bg-primary/15 text-[10px] font-medium uppercase text-primary">
                              {initials(row.name)}
                            </AvatarFallback>
                          </Avatar>
                        )
                      ) : (
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
                          <Building2 className="h-4 w-4" aria-hidden="true" />
                        </span>
                      )}
                      <span className="min-w-0">
                        <span className="block truncate text-[12px] font-medium">{row.name}</span>
                        <span className="block text-[11px]">{countLabel}</span>
                      </span>
                    </div>
                    </TooltipContent>
                  </Tooltip>
                </div>
              );
            })}
          </TooltipProvider>
        </div>
      </div>
      {selectedRow ? (
        <p className="mt-1 text-center text-[11px] font-light text-[var(--app-text-secondary)]" aria-live="polite">
          <span className="font-medium text-[var(--app-text-primary)]">{selectedRow.name}</span>
          {` · ${selectedRow.leadCount === null ? "contagem indisponível" : `${selectedRow.leadCount.toLocaleString("pt-BR")} ${selectedRow.leadCount === 1 ? "lead" : "leads"}`}`}
        </p>
      ) : null}
    </div>
  );
}

function DistributionCard({
  title,
  rows,
  contextRows = [],
  variant,
  isLoading,
  trailing,
  notice,
  fillHeight = false,
  selectedBrokerId,
  onBrokerSelect,
}: {
  title: string;
  rows: ChartRow[];
  contextRows?: ContextRow[];
  variant: "user" | "team";
  isLoading: boolean;
  trailing?: ReactNode;
  notice?: ReactNode;
  fillHeight?: boolean;
  selectedBrokerId?: string | null;
  onBrokerSelect?: (brokerId: string | null) => void;
}) {
  const Icon = variant === "user" ? UsersRound : Building2;
  return (
    <Card className={`flex min-w-0 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none ${fillHeight ? "min-h-[320px] lg:h-full" : "min-h-[360px]"}`}>
      <CardHeader className="shrink-0 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="truncate">{title}</span>
          </CardTitle>
          {variant === "user" && selectedBrokerId && onBrokerSelect ? (
            <button
              type="button"
              onClick={() => onBrokerSelect(null)}
              aria-label={selectedBrokerId === "unassigned" ? "Limpar filtro Sem responsável" : "Limpar filtro de corretor"}
              className="flex h-7 shrink-0 items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[11px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              <span>Limpar filtro</span>
            </button>
          ) : trailing ?? (!isLoading ? (
            <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">
              {rows.some((row) => row.kind === "unassigned")
                ? "Sem responsável"
                : `${rows.length} ${rows.length === 1 ? (variant === "user" ? "corretor" : "equipe") : (variant === "user" ? "corretores" : "equipes")}`}
            </span>
          ) : null)}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-end px-4 pb-4 pt-2">
        {isLoading ? <DistributionSkeleton /> : <DistributionBars rows={rows} variant={variant} selectedBrokerId={selectedBrokerId} onBrokerSelect={onBrokerSelect} />}
        {!isLoading ? notice : null}
        {!isLoading && contextRows.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {contextRows.map((row) => (
              <span
                key={`${variant}-${row.kind}`}
                className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]"
              >
                {row.name}: {row.leadCount.toLocaleString("pt-BR")}
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function TeamPicker({
  teams,
  selectedIds,
  isReady,
  onSave,
}: {
  teams?: AvailableTeam[];
  selectedIds: string[] | null;
  isReady: boolean;
  onSave: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draftIds, setDraftIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const availableIds = useMemo(() => (teams ?? []).map((team) => team.id), [teams]);
  const visibleTeams = useMemo(
    () => (teams ?? []).filter((team) => team.name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"))),
    [search, teams],
  );
  const selectedCount = selectedIds === null ? availableIds.length : selectedIds.length;

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftIds(selectedIds === null ? availableIds : selectedIds);
      setSearch("");
    }
    setOpen(nextOpen);
  };

  const toggleTeam = (teamId: string, checked: boolean) => {
    setDraftIds((current) =>
      checked
        ? Array.from(new Set([...current, teamId]))
        : current.filter((id) => id !== teamId),
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        disabled={!isReady || teams === undefined || teams.length === 0}
        aria-label="Escolher equipes exibidas"
        aria-haspopup="dialog"
        className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light text-[var(--app-text-secondary)] transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:opacity-60"
      >
        {selectedCount} {selectedCount === 1 ? "grupo" : "grupos"}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent aria-describedby={undefined} className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[440px] flex-col gap-3 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 sm:p-5">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[15px] font-normal">Equipes exibidas</DialogTitle>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar equipe"
              aria-label="Buscar equipe"
              className="h-9 min-w-0 flex-1 rounded-[6px]"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraftIds(availableIds)} className="bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]">
              Todas
            </Button>
          </div>
          <div className="app-scrollbar min-h-0 max-h-[min(48dvh,360px)] overflow-y-auto rounded-[6px] bg-[var(--app-surface-soft)] p-1">
            {visibleTeams.length === 0 ? (
              <p className="p-4 text-center text-[12px] font-light text-[var(--app-text-secondary)]">Nenhuma equipe encontrada</p>
            ) : visibleTeams.map((team) => (
              <label key={team.id} htmlFor={`dashboard-team-${team.id}`} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[6px] px-3 py-2 text-[12px] hover:bg-[var(--app-surface-hover)]">
                <Checkbox
                  id={`dashboard-team-${team.id}`}
                  checked={draftIds.includes(team.id)}
                  onCheckedChange={(checked) => toggleTeam(team.id, checked === true)}
                  aria-label={team.name}
                />
                <span className="min-w-0 flex-1 truncate">{team.name}</span>
              </label>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)} className="bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-secondary)]">
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={draftIds.length === 0}
              onClick={() => {
                onSave(draftIds);
                handleOpenChange(false);
              }}
            >
              Aplicar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function LeadDistributionSection({
  data,
  isLoading,
  isError,
  onRetry,
  organizationId,
  currentUserId,
  availableTeams,
  display = "both",
  selectedTeamId = null,
  selectedUserId = null,
  selectedBrokerId = null,
  onBrokerSelect,
}: LeadDistributionSectionProps) {
  const { activeSelection, saveSelection, isHydrated } = usePinnedTeamIds(
    organizationId,
    currentUserId,
    display === "users" ? undefined : availableTeams,
  );

  const userRows = useMemo(
    () => visibleBrokerDistributionRows(data?.users, selectedUserId),
    [data?.users, selectedUserId],
  );
  const selectedChartUserId = selectedUserId === "unassigned" ? "unassigned" : selectedBrokerId;

  const teamRows = useMemo(() => {
    const counts = new Map((data?.teams ?? [])
      .filter((row) => row.kind === "entity" && row.id)
      .map((row) => [row.id as string, row.leadCount]));
    const hasOther = (data?.teams ?? []).some((row) => row.kind === "other");
    const teams = availableTeams ?? (data?.teams ?? [])
      .filter((row) => row.kind === "entity" && row.id)
      .map((row) => ({ id: row.id as string, name: row.name }));
    return sortChartRows(teams
      .filter((team) => selectedTeamId
        ? team.id === selectedTeamId
        : activeSelection === null || activeSelection.includes(team.id))
      .map((team) => ({
        id: team.id,
        name: team.name,
        leadCount: counts.get(team.id) ?? (hasOther ? null : 0),
      }))
      .filter((team) => team.leadCount !== 0));
  }, [activeSelection, availableTeams, data?.teams, selectedTeamId]);

  if (isError) {
    return (
      <Card className={`rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none ${display === "both" ? "" : "flex min-h-[320px] flex-col lg:h-full"}`}>
        <CardContent className="flex min-h-[112px] flex-1 flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-[14px] font-normal text-[var(--app-text-primary)]">Não foi possível carregar a distribuição de leads.</p>
            <p className="mt-1 text-[12px] font-light text-[var(--app-text-tertiary)]">Os demais indicadores continuam disponíveis.</p>
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={onRetry} className="h-8 gap-1.5 rounded-[6px] bg-primary/10 px-3 text-[11px] font-light text-primary hover:bg-primary/15 hover:text-primary">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  const teamContext: ContextRow[] = (data?.teams ?? [])
    .filter((row) => row.kind !== "entity")
    .map((row) => ({ kind: row.kind as ContextRow["kind"], name: row.name, leadCount: row.leadCount }));

  return (
    <section data-tour="dashboard-lead-distribution" className={display === "both" ? undefined : "min-h-0 lg:h-full"}>
      <div className={display === "both" ? "grid grid-cols-1 gap-3 lg:grid-cols-12" : "min-h-0 lg:h-full"}>
        {display !== "teams" ? (
          <div className={display === "both" ? "min-w-0 lg:col-span-8" : "min-h-0 min-w-0 lg:h-full"}>
            <DistributionCard title={selectedUserId === "unassigned" ? "Leads sem responsável" : "Leads por corretor"} rows={userRows} variant="user" isLoading={isLoading} fillHeight={display !== "both"} selectedBrokerId={selectedChartUserId} onBrokerSelect={onBrokerSelect} />
          </div>
        ) : null}
        {display !== "users" ? (
          <div className={display === "both" ? "min-w-0 lg:col-span-4" : "min-h-0 min-w-0 lg:h-full"}>
          <DistributionCard
            title="Leads por equipe"
            rows={teamRows}
            contextRows={teamContext}
            variant="team"
            isLoading={isLoading || !isHydrated}
            fillHeight={display !== "both"}
            notice={<>
              {!selectedTeamId ? <p className="mt-2 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">Um lead pode aparecer em mais de uma equipe quando o corretor pertence a vários grupos.</p> : null}
            </>}
            trailing={selectedTeamId ? null :
              <TeamPicker
                teams={availableTeams}
                selectedIds={activeSelection}
                isReady={isHydrated}
                onSave={saveSelection}
              />
            }
          />
          </div>
        ) : null}
      </div>
    </section>
  );
}
