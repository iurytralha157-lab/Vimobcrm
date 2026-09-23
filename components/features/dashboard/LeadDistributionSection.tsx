"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Building2, ChevronDown, RefreshCw, UserRoundX, UsersRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { DashboardLeadDistribution } from "@/hooks/use-dashboard-stats";

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
  teamsError?: boolean;
  onRetryTeams?: () => void;
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
}: {
  rows: ChartRow[];
  variant: "user" | "team";
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const maxCount = Math.max(1, ...rows.map((row) => row.leadCount ?? 0));
  const selectedRow = rows.find((row) => row.id === selectedId);

  if (rows.length === 0) {
    return (
      <div className="flex min-h-[250px] flex-col items-center justify-center gap-2 text-center">
        <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
          <UserRoundX className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
          {variant === "team" ? "Nenhuma equipe selecionada" : "Nenhum corretor para os filtros selecionados"}
        </p>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div
        className="app-scrollbar overflow-x-auto pb-2"
        role="region"
        aria-label={variant === "user" ? "Leads por corretor" : "Leads por equipe"}
        tabIndex={0}
      >
        <div className="flex min-w-full w-max items-end justify-around gap-2 border-b border-[var(--app-border)] px-2 sm:gap-3">
          <TooltipProvider delayDuration={120}>
            {rows.map((row) => {
              const countLabel = row.leadCount === null
                ? "Contagem indisponível"
                : `${row.leadCount} ${row.leadCount === 1 ? "lead" : "leads"}`;
              const height = row.leadCount === null ? 3 : Math.max(3, Math.round((row.leadCount / maxCount) * 145));
              return (
                <Tooltip key={row.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={`${row.name}: ${countLabel}`}
                      aria-pressed={selectedId === row.id}
                      onClick={() => setSelectedId((current) => current === row.id ? null : row.id)}
                      className="group flex h-[240px] w-[62px] shrink-0 flex-col items-center justify-end rounded-t-[6px] px-1 pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary sm:w-[72px]"
                    >
                      <span className="mb-1 text-[11px] font-medium tabular-nums text-[var(--app-text-primary)]">
                        {row.leadCount === null ? "—" : row.leadCount.toLocaleString("pt-BR")}
                      </span>
                      {variant === "user" ? (
                        <Avatar className="mb-1 h-7 w-7 border border-[var(--app-border)]">
                          <AvatarImage src={row.avatarUrl || undefined} alt="" />
                          <AvatarFallback className="bg-primary/15 text-[9px] font-medium uppercase text-primary">
                            {initials(row.name)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span className="mb-1 flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-violet-500">
                          <Building2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </span>
                      )}
                      <span
                        className={
                          row.leadCount === null
                            ? "w-9 rounded-t-[5px] bg-[var(--app-border)]"
                            : variant === "user"
                              ? "w-9 rounded-t-[5px] bg-primary transition-colors group-hover:bg-primary/75"
                              : "w-9 rounded-t-[5px] bg-violet-500 transition-colors group-hover:bg-violet-400"
                        }
                        style={{ height }}
                        aria-hidden="true"
                      />
                      <span className="mt-2 block w-full truncate text-center text-[10px] font-light text-[var(--app-text-secondary)]">
                        {row.name}
                      </span>
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-center">
                    <span className="font-medium">{row.name}</span>
                    <span className="block text-[11px]">{countLabel}</span>
                  </TooltipContent>
                </Tooltip>
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
  contextRows,
  variant,
  isLoading,
  trailing,
  notice,
}: {
  title: string;
  rows: ChartRow[];
  contextRows: ContextRow[];
  variant: "user" | "team";
  isLoading: boolean;
  trailing?: ReactNode;
  notice?: ReactNode;
}) {
  const Icon = variant === "user" ? UsersRound : Building2;
  return (
    <Card className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="shrink-0 px-4 pb-2 pt-4">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex min-w-0 items-center gap-2 text-[14px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span className="truncate">{title}</span>
          </CardTitle>
          {trailing ?? (!isLoading ? (
            <span className="shrink-0 rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-1 text-[10px] font-light text-[var(--app-text-secondary)]">
              {rows.length} {rows.length === 1 ? "corretor" : "corretores"}
            </span>
          ) : null)}
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 px-4 pb-4 pt-2">
        {isLoading ? <DistributionSkeleton /> : <DistributionBars rows={rows} variant={variant} />}
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
        <DialogContent className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[440px] flex-col gap-3 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 sm:p-5">
          <DialogHeader className="text-left">
            <DialogTitle className="text-[15px] font-normal">Equipes exibidas</DialogTitle>
            <DialogDescription className="text-[12px] font-light leading-5">
              Escolha as equipes que ficam no gráfico. Os filtros da página continuam funcionando normalmente.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar equipe"
              aria-label="Buscar equipe"
              className="h-9 min-w-0 flex-1 rounded-[6px]"
            />
            <Button type="button" variant="ghost" size="sm" onClick={() => setDraftIds(availableIds)}>
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
            <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>
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
  teamsError = false,
  onRetryTeams,
}: LeadDistributionSectionProps) {
  const { activeSelection, saveSelection, isHydrated } = usePinnedTeamIds(
    organizationId,
    currentUserId,
    availableTeams,
  );

  const userRows = useMemo(() => {
    const rows = (data?.users ?? [])
      .filter((row) => row.kind === "entity" && row.id)
      .map((row) => ({
        id: row.id as string,
        name: row.name,
        leadCount: row.leadCount,
        avatarUrl: row.avatarUrl,
      }));
    return sortChartRows(rows);
  }, [data?.users]);

  const teamRows = useMemo(() => {
    const counts = new Map((data?.teams ?? [])
      .filter((row) => row.kind === "entity" && row.id)
      .map((row) => [row.id as string, row.leadCount]));
    const hasOther = (data?.teams ?? []).some((row) => row.kind === "other");
    const teams = availableTeams ?? (data?.teams ?? [])
      .filter((row) => row.kind === "entity" && row.id)
      .map((row) => ({ id: row.id as string, name: row.name }));
    return sortChartRows(teams
      .filter((team) => activeSelection === null || activeSelection.includes(team.id))
      .map((team) => ({
        id: team.id,
        name: team.name,
        leadCount: counts.get(team.id) ?? (hasOther ? null : 0),
      })));
  }, [activeSelection, availableTeams, data?.teams]);

  if (isError) {
    return (
      <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
        <CardContent className="flex min-h-[112px] flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
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

  const userContext: ContextRow[] = (data?.users ?? [])
    .filter((row) => row.kind !== "entity")
    .map((row) => ({ kind: row.kind as ContextRow["kind"], name: row.name, leadCount: row.leadCount }));
  const teamContext: ContextRow[] = (data?.teams ?? [])
    .filter((row) => row.kind !== "entity")
    .map((row) => ({ kind: row.kind as ContextRow["kind"], name: row.name, leadCount: row.leadCount }));

  return (
    <section data-tour="dashboard-lead-distribution">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <DistributionCard title="Leads por corretor" rows={userRows} contextRows={userContext} variant="user" isLoading={isLoading} />
        </div>
        <div className="min-w-0 lg:col-span-4">
          <DistributionCard
            title="Leads por equipe"
            rows={teamRows}
            contextRows={teamContext}
            variant="team"
            isLoading={isLoading || !isHydrated}
            notice={teamsError ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-[11px] font-light text-[var(--app-text-secondary)]">
                <span>Não foi possível carregar as equipes para editar a seleção.</span>
                {onRetryTeams ? (
                  <Button type="button" variant="ghost" size="sm" onClick={onRetryTeams} className="h-7 gap-1 px-2 text-[11px] text-primary">
                    <RefreshCw className="h-3 w-3" aria-hidden="true" />
                    Tentar novamente
                  </Button>
                ) : null}
              </div>
            ) : null}
            trailing={
              <TeamPicker
                teams={availableTeams}
                selectedIds={activeSelection}
                isReady={isHydrated}
                onSave={saveSelection}
              />
            }
          />
        </div>
      </div>
    </section>
  );
}
