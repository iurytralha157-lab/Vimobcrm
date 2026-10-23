import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  useMemo,
  useId,
  type ReactNode,
} from "react";
import {
  Users,
  Globe,
  X,
  SlidersHorizontal,
  Search,
  CircleDot,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useTeams } from "@/hooks/use-teams";
import type { QueryDataTrustScope } from "@/hooks/shared/use-query-data-trust";
import { useQueryClient } from "@tanstack/react-query";
import { isSharedFilterOptionsAccessDenied, refreshStaleSharedFilterOptions } from "@/lib/filters/shared-filter-options";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useFilters } from "@/contexts/FilterContext";
import { DatePreset } from "@/hooks/use-dashboard-filters";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { BRAND_COLORS } from "@/config/brand-colors";
import { normalizeSearchText } from "@/lib/search-text";
import { getUserFilterLabel } from "@/lib/user-display";
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";
import { SearchableFilterSelect } from "@/components/shared/SearchableFilterSelect";
import { SharedUserFilter } from "@/components/shared/SharedUserFilter";
import { FILTER_UI } from "@/config/filter-ui";
import { FilterSelectionSummary, type ActiveFilterChip } from "@/components/shared/FilterSelectionSummary";
import { getSourceFilterUnavailableReason } from "@/lib/validation/dashboard-filter-text";
import { filterTextSchema, MAX_LEAD_SOURCE_FILTER_LENGTH } from "@/lib/validation/filter-text";

import { SharedFilterPanel } from "@/components/shared/filters/SharedFilterPanel";
import type { FilterPanelCloseReason } from "@/components/shared/filters/filter-panel-events";

const sharedSearchSchema = filterTextSchema(180);

interface SharedFiltersProps {
  presentation?: "popover" | "sidebar";
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset | null) => void;
  onClearDatePreset?: () => void;
  customDateRange: { from: Date; to: Date } | null;
  onCustomDateRangeChange: (range: { from: Date; to: Date } | null) => void;
  defaultDatePreset?: DatePreset | null;
  /** Report-specific duration bound; inherited shared periods are never changed. */
  dateRangeMaxDays?: number;

  teamId: string | null;
  onTeamChange: (teamId: string | null) => void;
  userId: string | null;
  onUserChange: (userId: string | null) => void;
  includeUnassignedUserOption?: boolean;
  /** Already scoped by the caller; skips the general team/user catalogs. */
  scopeTeams?: { id: string; name: string; members?: { user_id: string; is_leader?: boolean }[] }[];
  scopeUsers?: { id: string; name: string; email?: string | null; avatar_url?: string | null; is_active?: boolean }[];
  scopeOptionsReady?: boolean;
  scopeOptionsLoading?: boolean;
  showEmptyScopeFilters?: boolean;

  pipelineId?: string | null;
  onPipelineChange?: (pipelineId: string | null) => void;
  pipelines?: { id: string; name: string }[];
  stageId?: string | null;
  onStageChange?: (stageId: string | null) => void;
  stages?: { id: string; name: string }[];

  source: string | null;
  onSourceChange: (source: string | null) => void;
  dynamicSources?: { value: string; label: string }[];
  sourceFilterMaxLength?: number;
  isLoadingSources?: boolean;

  pageId: string | null;
  onPageChange: (id: string | null) => void;
  pages?: { id: string; name: string }[];
  isLoadingPages?: boolean;
  campaignId: string | null;
  onCampaignChange: (id: string | null) => void;
  /** Dashboard-only multi-select; other pages keep the existing single selector. */
  campaignIds?: string[];
  onCampaignsChange?: (ids: string[]) => void;
  adSetId: string | null;
  onAdSetChange: (id: string | null) => void;
  adId: string | null;
  onAdChange: (id: string | null) => void;
  campaigns?: { id: string; name: string }[];
  adSets?: { id: string; name: string }[];
  ads?: { id: string; name: string }[];
  isLoadingCampaigns?: boolean;
  hasCampaignsError?: boolean;
  isLoadingAdSets?: boolean;
  isLoadingAds?: boolean;
  isLoadingTags?: boolean;
  hasTagsError?: boolean;
  hasDynamicOptionsError?: boolean;
  /** Dashboard opts in without changing the other domains' catalog policy. */
  cacheTrustScope?: QueryDataTrustScope;
  isRetryingDynamicOptions?: boolean;
  onRetryDynamicOptions?: () => void;

  tagIds: string[];
  onTagsChange: (tagIds: string[]) => void;
  tags?: { id: string; name: string; color: string }[];

  dealStatus: string | null;
  onDealStatusChange: (status: string | null) => void;

  searchQuery: string;
  onSearchChange: (query: string) => void;

  onClear: () => void;
  hasActiveFilters: boolean;
  hideSearch?: boolean;
  datePosition?: "start" | "end";
  loadDynamicOptions?: boolean;
  onFiltersOpenChange?: (open: boolean) => void;
  tourPrefix?: string;
  mobileIconOnly?: boolean;
  triggerClassName?: string;
  clearButtonClassName?: string;
  advancedContent?: ReactNode | ((layerScope: string) => ReactNode);
  advancedContentOnly?: boolean;
  hasAdvancedContentFilters?: boolean;
  showAdFilters?: boolean;
  dateLabel?: string;
  advancedFilterCount?: number;
  leadFiltersPaused?: boolean;
}

export function SharedFilters({
  presentation = "sidebar",
  datePreset,
  onDatePresetChange,
  onClearDatePreset,
  customDateRange,
  onCustomDateRangeChange,
  defaultDatePreset = null,
  dateRangeMaxDays,
  teamId,
  onTeamChange,
  userId,
  onUserChange,
  includeUnassignedUserOption = false,
  scopeTeams,
  scopeUsers,
  scopeOptionsReady = true,
  scopeOptionsLoading = false,
  showEmptyScopeFilters = false,
  pipelineId = null,
  onPipelineChange,
  pipelines = [],
  stageId = null,
  onStageChange,
  stages = [],
  source,
  onSourceChange,
  pageId,
  onPageChange,
  campaignId,
  onCampaignChange,
  campaignIds,
  onCampaignsChange,
  adSetId,
  onAdSetChange,
  adId,
  onAdChange,
  tagIds,
  onTagsChange,
  dealStatus,
  onDealStatusChange,
  searchQuery,
  onSearchChange,
  onClear,
  hasActiveFilters,
  dynamicSources = [],
  sourceFilterMaxLength = MAX_LEAD_SOURCE_FILTER_LENGTH,
  pages = [],
  campaigns = [],
  adSets = [],
  ads = [],
  tags = [],
  isLoadingSources = false,
  isLoadingPages = false,
  isLoadingCampaigns = false,
  hasCampaignsError = false,
  isLoadingAdSets = false,
  isLoadingAds = false,
  isLoadingTags = false,
  hasTagsError = false,
  hasDynamicOptionsError = false,
  cacheTrustScope,
  isRetryingDynamicOptions = false,
  onRetryDynamicOptions,
  hideSearch = false,
  datePosition = "start",
  loadDynamicOptions = true,
  onFiltersOpenChange,
  tourPrefix,
  mobileIconOnly = false,
  triggerClassName,
  clearButtonClassName,
  advancedContent,
  advancedContentOnly = false,
  hasAdvancedContentFilters = false,
  showAdFilters = true,
  dateLabel,
  advancedFilterCount,
  leadFiltersPaused = false,
}: SharedFiltersProps) {
  const { user, isSuperAdmin, activeOrganization } = useAuth();
  const queryClient = useQueryClient();
  const { isHydrated: isFiltersHydrated, pipelineId: globalPipelineId, setPipelineId: setGlobalPipelineId, filterApplicationRevision } = useFilters();
  const { hasPermission } = useUserPermissions();
  const canViewAllLeads = isSuperAdmin || hasPermission("lead_view_all");
  const canViewTeamLeads = hasPermission("lead_view_team");
  const canUseScopeFilters = canViewAllLeads || canViewTeamLeads;
  const hasActiveScopeSelection = Boolean(
    teamId ||
    (userId && userId !== "all" && userId !== "unassigned"),
  );
  const shouldLoadScopeOptions =
    scopeTeams === undefined &&
    scopeUsers === undefined &&
    isFiltersHydrated &&
    canUseScopeFilters &&
    (loadDynamicOptions || hasActiveScopeSelection);
  const teamsQuery = useTeams({
    cacheTrustScope,
    catalog: true,
    enabled: shouldLoadScopeOptions,
  });
  const usersQuery = useOrganizationUsers({
    cacheTrustScope,
    enabled: shouldLoadScopeOptions,
    scope: "filters",
  });
  const { refetch: refetchTeams, isAccessBlocked: teamsAccessBlocked } = teamsQuery;
  const { refetch: refetchUsers, isAccessBlocked: usersAccessBlocked } = usersQuery;
  const teams = useMemo(() => isSharedFilterOptionsAccessDenied(teamsQuery.error) ? [] : (cacheTrustScope ? teamsQuery.displayData : teamsQuery.data) ?? [], [cacheTrustScope, teamsQuery.data, teamsQuery.displayData, teamsQuery.error]);
  const users = useMemo(() => isSharedFilterOptionsAccessDenied(usersQuery.error) ? [] : (cacheTrustScope ? usersQuery.displayData : usersQuery.data) ?? [], [cacheTrustScope, usersQuery.data, usersQuery.displayData, usersQuery.error]);
  const isMobile = useIsMobile();
  const useMobileIcons = isMobile && mobileIconOnly;
  const currentUserId = user?.id;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [searchErrorState, setSearchError] = useState<{ message: string; revision: number; searchQuery: string } | null>(null);
  const searchError = searchErrorState && searchErrorState.revision === filterApplicationRevision && searchErrorState.searchQuery === searchQuery
    ? searchErrorState.message : "";
  const filterScopeId = useId();
  const filterLayerId = presentation === "sidebar" ? `sidebar-${filterScopeId}` : filterScopeId;

  // ✅ FIX: Usamos apenas refs para o input de busca — sem useState controlado
  // Isso evita re-renders a cada keystroke que causavam o "piscar" e perda de foco
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchDraftRef = useRef<string | null>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const searchQueryRef = useRef(searchQuery);
  const setSearchInput = useCallback((input: HTMLInputElement | null) => {
    if (input) input.value = searchDraftRef.current ?? searchQueryRef.current;
    else if (searchInputRef.current) searchDraftRef.current = searchInputRef.current.value;
    searchInputRef.current = input;
  }, []);
  const internalSelectInteractionRef = useRef(false);
  const internalSelectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  // ✅ FIX: Quando searchQuery mudar externamente (ex: limpar filtros),
  // atualiza o valor do input via ref sem causar re-render
  useLayoutEffect(() => {
    if (
      searchInputRef.current &&
      searchInputRef.current.value !== searchQuery
    ) {
      searchInputRef.current.value = searchQuery;
    }
    searchDraftRef.current = searchQuery;
  }, [searchQuery, filterApplicationRevision]);

  const commitSearch = useCallback(() => {
    // Some callers hide the search control or render only their advanced fields.
    if (!searchInputRef.current) return true;
    const nextSearch = searchInputRef.current.value;
    const validated = sharedSearchSchema.safeParse(nextSearch);
    if (!validated.success) {
      setSearchError({ message: "Use até 180 caracteres válidos na busca. O texto não foi aplicado.", revision: filterApplicationRevision, searchQuery: searchQueryRef.current });
      return false;
    }
    setSearchError(null);
    if (validated.data !== searchQueryRef.current) {
      onSearchChangeRef.current(validated.data);
      searchQueryRef.current = validated.data;
    }
    return true;
  }, [filterApplicationRevision]);

  const markInternalSelectInteraction = useCallback(() => {
    internalSelectInteractionRef.current = true;
    if (internalSelectTimerRef.current) {
      clearTimeout(internalSelectTimerRef.current);
    }
    internalSelectTimerRef.current = setTimeout(() => {
      internalSelectInteractionRef.current = false;
      internalSelectTimerRef.current = null;
    }, 180);
  }, []);

  useEffect(() => {
    return () => {
      if (internalSelectTimerRef.current) {
        clearTimeout(internalSelectTimerRef.current);
      }
    };
  }, []);

  const handleDatePresetChange = useCallback(
    (nextPreset: DatePreset | null) => {
      if (nextPreset) {
        onDatePresetChange(nextPreset);
        return;
      }
      if (onClearDatePreset) {
        onClearDatePreset();
        return;
      }
      onDatePresetChange(null);
    },
    [onClearDatePreset, onDatePresetChange],
  );

  const handleClearFilters = useCallback(() => {
    // Limpa o input via ref — sem setState, sem re-render desnecessário
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    searchQueryRef.current = "";
    setSearchError(null);
    onClear();
  }, [onClear]);

  const handlePipelineFilterChange = useCallback((nextPipelineId: string | null) => {
    onPipelineChange?.(nextPipelineId);
    // A filter selection is shared; the Pipeline board's navigation selector is separate.
    if (onPipelineChange && onPipelineChange !== setGlobalPipelineId && nextPipelineId !== globalPipelineId) {
      setGlobalPipelineId(nextPipelineId);
    }
    onStageChange?.(null);
  }, [globalPipelineId, onPipelineChange, onStageChange, setGlobalPipelineId]);

  const tryCloseFilters = useCallback((reason: FilterPanelCloseReason) => {
    if (reason === "outside" && internalSelectInteractionRef.current) return false;
    if (!commitSearch()) { searchInputRef.current?.focus(); return false; }
    setFiltersOpen(false);
    onFiltersOpenChange?.(false);
    return true;
  }, [commitSearch, onFiltersOpenChange]);

  const handleFiltersOpenChange = useCallback((open: boolean) => {
    if (!open) { tryCloseFilters("outside"); return; }
    setFiltersOpen(true);
    onFiltersOpenChange?.(true);
    void refreshStaleSharedFilterOptions(queryClient, activeOrganization.organizationId);
    if (cacheTrustScope && teamsAccessBlocked) void refetchTeams({ cancelRefetch: false });
    if (cacheTrustScope && usersAccessBlocked) void refetchUsers({ cancelRefetch: false });
  }, [activeOrganization.organizationId, cacheTrustScope, onFiltersOpenChange, queryClient, teamsAccessBlocked, refetchTeams, usersAccessBlocked, refetchUsers, tryCloseFilters]);

  const isTeamLeader = canViewTeamLeads;

  const showUserFilter = scopeUsers !== undefined || canViewAllLeads || isTeamLeader;

  const activeTeams = useMemo(
    () => teams.filter((team) => team.is_active !== false),
    [teams],
  );
  const availableTeams = useMemo(
    () =>
      scopeTeams !== undefined
        ? scopeTeams
        : canViewAllLeads
        ? activeTeams
        : activeTeams.filter((team) =>
            team.members?.some(
              (member) => member.user_id === currentUserId && member.is_leader,
            ),
          ),
    [activeTeams, canViewAllLeads, currentUserId, scopeTeams],
  );

  const availableUsers = useMemo(() => {
    if (scopeUsers !== undefined) return scopeUsers;
    if (teamId) {
      const team = availableTeams.find((item) => item.id === teamId);
      return users.filter((availableUser) =>
        team?.members?.some((member) => member.user_id === availableUser.id),
      );
    }

    if (canViewAllLeads) return users;

    const ledUserIds = new Set(
      availableTeams.flatMap(
        (team) =>
          team.members?.map((member) => member.user_id).filter(Boolean) || [],
      ),
    );
    if (currentUserId) ledUserIds.add(currentUserId);

    return users.filter((availableUser) => ledUserIds.has(availableUser.id));
  }, [availableTeams, canViewAllLeads, currentUserId, scopeUsers, teamId, users]);

  const multiCampaigns = campaignIds !== undefined && onCampaignsChange !== undefined;
  const campaignPickerOptions = useMemo(() => {
    const nameCounts = new Map<string, number>();
    campaigns.forEach((campaign) => {
      const key = normalizeSearchText(campaign.name);
      nameCounts.set(key, (nameCounts.get(key) ?? 0) + 1);
    });
    return campaigns.map((campaign) => ({
      id: campaign.id,
      name: (nameCounts.get(normalizeSearchText(campaign.name)) ?? 0) > 1
        ? `${campaign.name} · …${campaign.id.slice(-6)}`
        : campaign.name,
    }));
  }, [campaigns]);
  const hasDefaultExtraFilters =
    teamId !== null ||
    (userId !== null && userId !== "all") ||
    pipelineId !== null ||
    stageId !== null ||
    source !== null ||
    pageId !== null ||
    campaignId !== null ||
    (multiCampaigns && campaignIds.length > 0) ||
    adSetId !== null ||
    adId !== null ||
    tagIds.length > 0 ||
    dealStatus !== null ||
    searchQuery.trim() !== "";
  const hasActiveAdvancedFilters = hasAdvancedContentFilters || (advancedFilterCount ?? 0) > 0;
  const hasExtraFilters = advancedContentOnly
    ? hasActiveAdvancedFilters
    : (!leadFiltersPaused && hasDefaultExtraFilters) || hasActiveAdvancedFilters;
  const hasActiveDateFilter =
    !leadFiltersPaused && (Boolean(customDateRange) || datePreset !== defaultDatePreset);

  const filterSelectContentClass =
    "app-header-popover z-[130] rounded-[8px] border-0 p-1 [&_[role=option]]:rounded-[6px] [&_[role=option]]:text-[12px] [&_[role=option]]:font-light";
  const dashboardTriggerClass = FILTER_UI.trigger;
  const filterControlClass = FILTER_UI.control;
  const filterChips: ActiveFilterChip[] = [];
  const addChip = (key: string, label: string, onRemove: () => void) => filterChips.push({ key, label, onRemove });
  const unavailable = "indisponível";
  if (!advancedContentOnly) {
    if (pipelineId && onPipelineChange) addChip("pipeline", `Pipeline: ${pipelines.find((item) => item.id === pipelineId)?.name ?? unavailable}`, () => handlePipelineFilterChange(null));
    if (stageId && onStageChange) addChip("stage", `Estágio: ${stages.find((item) => item.id === stageId)?.name ?? unavailable}`, () => onStageChange(null));
    if (teamId) addChip("team", `Equipe: ${availableTeams.find((item) => item.id === teamId)?.name ?? unavailable}`, () => { onTeamChange(null); onUserChange(null); });
    if (userId && userId !== "all") {
      const selectedUser = availableUsers.find((item) => item.id === userId);
      addChip("user", `Corretor: ${userId === "unassigned" ? "Sem responsável" : selectedUser ? getUserFilterLabel(selectedUser) : unavailable}`, () => onUserChange(null));
    }
    if (source) addChip("source", `Origem: ${dynamicSources.find((item) => item.value === source)?.label ?? source}`, () => onSourceChange(null));
    if (pageId) addChip("page", `Página: ${pages.find((item) => item.id === pageId)?.name ?? unavailable}`, () => onPageChange(null));
    if (multiCampaigns) campaignIds.forEach((id) => addChip(`campaign:${id}`, `Campanha: ${campaignPickerOptions.find((item) => item.id === id)?.name ?? `${unavailable} · …${id.slice(-6)}`}`, () => onCampaignsChange(campaignIds.filter((selectedId) => selectedId !== id))));
    else if (campaignId) addChip("campaign", `Campanha: ${campaignPickerOptions.find((item) => item.id === campaignId)?.name ?? unavailable}`, () => onCampaignChange(null));
    if (adSetId) addChip("adset", `Conjunto: ${adSets.find((item) => item.id === adSetId)?.name ?? unavailable}`, () => onAdSetChange(null));
    if (adId) addChip("ad", `Anúncio: ${ads.find((item) => item.id === adId)?.name ?? unavailable}`, () => onAdChange(null));
    Array.from(new Set(tagIds)).forEach((id) => addChip(`tag:${id}`, `Tag: ${tags.find((item) => item.id === id)?.name ?? unavailable}`, () => onTagsChange(tagIds.filter((selectedId) => selectedId !== id))));
    if (dealStatus) addChip("status", `Status: ${{ open: "Aberto", won: "Ganho", lost: "Perdido" }[dealStatus] ?? dealStatus}`, () => onDealStatusChange(null));
    if (searchQuery.trim()) addChip("search", `Busca: ${searchQuery}`, () => onSearchChange(""));
  }
  const mainFilterCount = new Set(filterChips.map((chip) => chip.key.split(":")[0])).size;
  const extraFilterCount = (leadFiltersPaused ? 0 : mainFilterCount) + (advancedFilterCount ?? (hasAdvancedContentFilters ? 1 : 0));
  const filterSummary = `${leadFiltersPaused ? "Filtros de lead pausados: " : ""}${filterChips.map((chip) => chip.label).join("; ")}`;
  // One element tree preserves field identity across presentation rerenders.
  const filterFields = (
            <div className="space-y-2.5">
              <FilterSelectionSummary chips={filterChips} paused={leadFiltersPaused} />

              {(hasDynamicOptionsError || (cacheTrustScope && (teamsAccessBlocked || usersAccessBlocked))) && (
                <div
                  role="alert"
                  className="flex items-center justify-between gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2 text-[10px] font-light text-[var(--app-text-secondary)]"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
                    <span>Algumas opções não foram atualizadas.</span>
                  </span>
                  {onRetryDynamicOptions && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={isRetryingDynamicOptions}
                      onClick={() => {
                        onRetryDynamicOptions?.();
                        if (cacheTrustScope && teamsAccessBlocked) void refetchTeams({ cancelRefetch: false });
                        if (cacheTrustScope && usersAccessBlocked) void refetchUsers({ cancelRefetch: false });
                      }}
                      className="h-6 shrink-0 rounded-[5px] px-1.5 text-[10px] text-primary"
                    >
                      <RefreshCw
                        className={cn("h-3 w-3", isRetryingDynamicOptions && "animate-spin")}
                        aria-hidden="true"
                      />
                      Tentar novamente
                    </Button>
                  )}
                </div>
              )}

              <div className="grid gap-2">
                {typeof advancedContent === "function" ? advancedContent(filterLayerId) : advancedContent}
                {!advancedContentOnly ? (
                  <>
                    {/* ✅ FIX: Input UNCONTROLLED — sem value/onChange que causam re-render
                    Usamos defaultValue + ref. O valor é lido via ref no commitSearch. */}
                    {!hideSearch && (
                      <div>
                        <div className="relative group" data-filter-search-container>
                        <Search data-filter-search-icon aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary" />
                        <Input
                          ref={presentation === "sidebar" ? setSearchInput : searchInputRef}
                          placeholder="Buscar..."
                          aria-label="Buscar nos registros"
                          aria-describedby={`${filterLayerId}-search-help`}
                          aria-invalid={Boolean(searchError)}
                          data-filter-active={Boolean(searchQuery.trim())}
                          defaultValue={searchQuery}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitSearch();
                            }
                          }}
                          onKeyUp={(e) => {
                            e.stopPropagation();
                          }}
                          autoComplete="off"
                          className={cn(filterControlClass, "pl-8 placeholder:text-[var(--app-text-tertiary)]")}
                        />
                        </div>
                        <p id={`${filterLayerId}-search-help`} className="mt-1 text-[10px] text-muted-foreground">Pressione Enter ou feche os filtros para aplicar a busca.</p>
                        {searchError && <p role="alert" className="mt-1 text-[11px] text-destructive">{searchError}</p>}
                      </div>
                    )}

                    {onPipelineChange && (pipelines.length > 0 || showEmptyScopeFilters || pipelineId) && (
                      <SearchableFilterSelect
                        value={pipelineId} onChange={handlePipelineFilterChange}
                        options={pipelines.map((pipeline) => ({ value: pipeline.id, label: pipeline.name }))}
                        allLabel="Todas pipelines" ariaLabel="Filtrar por pipeline" layerScope={filterLayerId}
                        loading={scopeOptionsLoading} emptyLabel={scopeOptionsReady ? "Nenhuma pipeline" : "Pipelines indisponíveis"}
                      />
                    )}
                    {onStageChange && pipelineId && (stages.length > 0 || stageId) && (
                      <SearchableFilterSelect
                        value={stageId} onChange={onStageChange}
                        options={stages.map((stage) => ({ value: stage.id, label: stage.name }))}
                        allLabel="Todos estágios" ariaLabel="Filtrar por estágio" layerScope={filterLayerId}
                      />
                    )}

                    {/* Team Filter */}
                    {(availableTeams.length > 0 || showEmptyScopeFilters || teamId) && (
                      <SearchableFilterSelect
                        value={teamId} onChange={(value) => { onTeamChange(value); onUserChange(null); }}
                        options={availableTeams.map((team) => ({ value: team.id, label: team.name }))}
                        allLabel="Todas equipes" ariaLabel="Filtrar por equipe" layerScope={filterLayerId}
                        icon={<Users className={FILTER_UI.icon} aria-hidden="true" />}
                        loading={scopeOptionsLoading} emptyLabel={scopeOptionsReady ? "Nenhuma equipe" : "Equipes indisponíveis"}
                      />
                    )}

                    {/* User Filter */}
                    {showUserFilter && (
                      <SharedUserFilter
                        users={availableUsers} value={userId} onChange={onUserChange}
                        includeUnassigned={includeUnassignedUserOption} layerScope={filterLayerId}
                        loading={scopeOptionsLoading || (shouldLoadScopeOptions && usersQuery.isFetching)}
                      />
                    )}

                    {/* Source Filter */}
                    <SearchableFilterSelect
                      value={source} onChange={onSourceChange} options={dynamicSources.map((option) => ({ ...option, disabledReason: getSourceFilterUnavailableReason(option.value, sourceFilterMaxLength) ?? undefined }))}
                      allLabel="Todas origens" ariaLabel="Filtrar por origem" layerScope={filterLayerId}
                      icon={<Globe className={FILTER_UI.icon} aria-hidden="true" />} loading={isLoadingSources}
                    />

                    {/* Tag Filter */}
                    <div onPointerDownCapture={markInternalSelectInteraction}>
                      <SearchableTagPicker
                        tags={tags}
                        selectedTagIds={tagIds}
                        onToggleTag={(nextTagId) => {
                          const normalizedNextTagId = nextTagId.trim().toLowerCase();
                          const isSelected = tagIds.some(
                            (selectedTagId) =>
                              selectedTagId.trim().toLowerCase() === normalizedNextTagId,
                          );
                          onTagsChange(
                            isSelected
                              ? tagIds.filter(
                                  (selectedTagId) =>
                                    selectedTagId.trim().toLowerCase() !== normalizedNextTagId,
                                )
                              : [...tagIds, nextTagId],
                          );
                        }}
                        loading={isLoadingTags}
                        error={hasTagsError}
                        placeholder="Todas tags"
                        triggerClassName={cn(
                          filterControlClass,
                          tagIds.length > 0 && "text-primary",
                        )}
                        showSelectedBadges={false}
                        maxSelected={50}
                        allowCreate={false}
                        layerScope={filterLayerId}
                      />
                    </div>

                    {/* Deal Status Filter */}
                    <Select
                      value={dealStatus || "all"}
                      onOpenChange={markInternalSelectInteraction}
                      onValueChange={(value) =>
                        onDealStatusChange(value === "all" ? null : value)
                      }
                    >
                      <SelectTrigger
                        aria-label="Filtrar por status do negócio"
                        data-filter-active={Boolean(dealStatus && dealStatus !== "all")}
                        onPointerDown={markInternalSelectInteraction}
                        className={cn(
                          filterControlClass,
                          "justify-start gap-1.5 [&>span]:min-w-0 [&>span]:flex-1 [&>span]:text-left",
                          dealStatus && "text-primary",
                        )}
                      >
                        <CircleDot className="h-3.5 w-3.5 flex-shrink-0" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent data-filter-layer={filterLayerId} className={filterSelectContentClass}>
                        <SelectItem value="all">Todos status</SelectItem>
                        <SelectItem value="open">Aberto</SelectItem>
                        <SelectItem value="won">Ganho</SelectItem>
                        <SelectItem value="lost">Perdido</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* Meta Filters */}
                    <div className="space-y-2 border-t border-[var(--app-border)] pt-2">
                      <div className="mb-1 flex items-center gap-1.5 px-1">
                        <Globe
                          className="h-3 w-3"
                          style={{ color: BRAND_COLORS.meta }}
                        />
                        <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                          Campanhas Meta
                        </span>
                      </div>

                      <div className="space-y-2">
                        <SearchableFilterSelect
                          value={pageId} onChange={onPageChange}
                          options={pages.map((page) => ({ value: page.id, label: page.name }))}
                          allLabel="Todas páginas" ariaLabel="Filtrar por página do Facebook" layerScope={filterLayerId}
                          loading={isLoadingPages}
                        />

                        {/* Campaign */}
                        {multiCampaigns ? (
                          <SearchableTagPicker
                            tags={campaignPickerOptions} selectedTagIds={campaignIds}
                            onToggleTag={(nextId) => onCampaignsChange(campaignIds.includes(nextId) ? campaignIds.filter((id) => id !== nextId) : [...campaignIds, nextId])}
                            onClearSelection={() => onCampaignsChange([])} loading={isLoadingCampaigns} error={hasCampaignsError}
                            placeholder="Todas campanhas" itemNameSingular="campanha" itemNamePlural="campanhas"
                            triggerIcon={<Globe className={FILTER_UI.icon} aria-hidden="true" />}
                            triggerClassName={cn(filterControlClass, campaignIds.length > 0 && "text-primary")}
                            showColorDot={false} showUnavailableId caseSensitiveIds showSelectedBadges={false}
                            allowCreate={false} maxSelected={50} emptyMessage="Nenhuma campanha disponível" layerScope={filterLayerId}
                          />
                        ) : (
                          <SearchableFilterSelect
                            value={campaignId} onChange={onCampaignChange}
                            options={campaignPickerOptions.map((campaign) => ({ value: campaign.id, label: campaign.name }))}
                            allLabel="Todas campanhas" ariaLabel="Filtrar por campanha" layerScope={filterLayerId}
                            loading={isLoadingCampaigns} error={hasCampaignsError}
                          />
                        )}

                        {showAdFilters && multiCampaigns && campaignIds.length > 1 && (
                          <p className="px-1 text-[11px] text-[var(--app-text-tertiary)]">
                            Para filtrar conjuntos e anúncios, selecione apenas uma campanha.
                          </p>
                        )}

                        {/* Ad Set — available for a single campaign */}
                        {showAdFilters && (multiCampaigns ? campaignIds.length === 1 : Boolean(campaignId)) && (
                          <SearchableFilterSelect
                            value={adSetId} onChange={onAdSetChange}
                            options={adSets.map((adSet) => ({ value: adSet.id, label: adSet.name }))}
                            allLabel="Todos conjuntos" ariaLabel="Filtrar por conjunto de anúncios" layerScope={filterLayerId}
                            loading={isLoadingAdSets}
                          />
                        )}

                        {/* Ad — available after an ad set is selected */}
                        {showAdFilters && adSetId && (
                          <SearchableFilterSelect
                            value={adId} onChange={onAdChange}
                            options={ads.map((ad) => ({ value: ad.id, label: ad.name }))}
                            allLabel="Todos criativos" ariaLabel="Filtrar por anúncio" layerScope={filterLayerId}
                            loading={isLoadingAds}
                          />
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
  );
  const filterTrigger = (
            <Button
              variant="outline"
              size="sm"
              aria-expanded={filtersOpen}
              aria-label={`${filtersOpen ? "Fechar" : "Abrir"} filtros avançados${extraFilterCount ? `, ${extraFilterCount} filtros aplicados` : ""}`}
              title={filterSummary || "Filtros avançados"}
              data-tour={
                tourPrefix ? `${tourPrefix}-advanced-filters` : undefined
              }
              className={cn(
                dashboardTriggerClass,
                triggerClassName,
                isMobile && "px-2",
                useMobileIcons && "w-8 px-0",
                hasExtraFilters &&
                  "bg-primary/50 text-white hover:bg-primary hover:text-white",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span
                className={
                  useMobileIcons
                    ? "sr-only"
                    : isMobile
                      ? "hidden min-[400px]:inline"
                      : ""
                }
              >
                Filtros
              </span>
              {hasExtraFilters && (
                <Badge
                  variant="default"
                  className={cn(
                    "ml-1 h-4 min-w-[16px] px-1 text-[9px] bg-primary flex items-center justify-center",
                    isMobile && "h-4 w-4 p-0 text-[10px] ml-0.5",
                  )}
                >{extraFilterCount || 1}</Badge>
              )}
            </Button>
  );

  return (
    <div className="flex items-center justify-end gap-2 w-full">
      {/* Data no início */}
      {datePosition === "start" && (
        <DateFilterPopover
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          customDateRange={customDateRange}
          onCustomDateRangeChange={onCustomDateRangeChange}
          dateRangeMaxDays={dateRangeMaxDays}
          filterApplicationRevision={filterApplicationRevision}
          triggerDataTour={tourPrefix ? `${tourPrefix}-date-filter` : undefined}
          triggerClassName={cn(
            dashboardTriggerClass,
            triggerClassName,
            isMobile && "px-2",
            useMobileIcons && "w-8 px-0",
            hasActiveDateFilter &&
              "bg-primary/50 text-white hover:bg-primary hover:text-white",
          )}
          iconOnly={useMobileIcons}
          dateLabel={leadFiltersPaused ? `${dateLabel || "Período"} (pausado)` : dateLabel}
          defaultPreset={defaultDatePreset}
          align="end"
        />
      )}

      {/* Botão de filtros + popover */}
      <div className="flex items-center gap-1">
        <SharedFilterPanel
          presentation={presentation} open={filtersOpen} onOpenChange={handleFiltersOpenChange}
          onRequestClose={tryCloseFilters} trigger={filterTrigger} layerScope={filterLayerId}
          tourPrefix={tourPrefix} isMobile={isMobile} count={extraFilterCount}
          hasActiveFilters={hasActiveFilters} onClear={handleClearFilters}
          onOpenAutoFocus={(event) => { if (!hideSearch && searchInputRef.current) { event.preventDefault(); searchInputRef.current.focus(); } }}
        >{filterFields}</SharedFilterPanel>

        {/* Botão limpar fora do popover (desktop) */}
        {hasActiveFilters && !isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]", clearButtonClassName)}
            onClick={handleClearFilters}
            title="Limpar todos os filtros"
            aria-label="Limpar todos os filtros"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {/* Data no final */}
      {datePosition === "end" && (
        <DateFilterPopover
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          customDateRange={customDateRange}
          onCustomDateRangeChange={onCustomDateRangeChange}
          dateRangeMaxDays={dateRangeMaxDays}
          filterApplicationRevision={filterApplicationRevision}
          triggerDataTour={tourPrefix ? `${tourPrefix}-date-filter` : undefined}
          triggerClassName={cn(
            dashboardTriggerClass,
            triggerClassName,
            isMobile && "px-2",
            hasActiveDateFilter &&
              "bg-primary/50 text-white hover:bg-primary hover:text-white",
          )}
          iconOnly={useMobileIcons}
          dateLabel={leadFiltersPaused ? `${dateLabel || "Período"} (pausado)` : dateLabel}
          defaultPreset={defaultDatePreset}
          align="end"
        />
      )}
    </div>
  );
}
