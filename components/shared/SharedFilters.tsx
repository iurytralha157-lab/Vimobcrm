import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  Users,
  User,
  Globe,
  X,
  SlidersHorizontal,
  Search,
  CircleDot,
  Check,
  ChevronsUpDown,
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
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useTeams } from "@/hooks/use-teams";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { DatePreset } from "@/hooks/use-dashboard-filters";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import { BRAND_COLORS } from "@/config/brand-colors";
import { normalizeSearchText, searchTextIncludes } from "@/lib/search-text";
import { getUserFilterLabel } from "@/lib/user-display";
import { SearchableTagPicker } from "@/components/shared/SearchableTagPicker";

interface SharedFiltersProps {
  datePreset: DatePreset | null;
  onDatePresetChange: (preset: DatePreset) => void;
  onClearDatePreset?: () => void;
  customDateRange: { from: Date; to: Date } | null;
  onCustomDateRangeChange: (range: { from: Date; to: Date } | null) => void;
  defaultDatePreset?: DatePreset | null;

  teamId: string | null;
  onTeamChange: (teamId: string | null) => void;
  userId: string | null;
  onUserChange: (userId: string | null) => void;
  includeUnassignedUserOption?: boolean;

  pipelineId?: string | null;
  onPipelineChange?: (pipelineId: string | null) => void;
  pipelines?: { id: string; name: string }[];
  stageId?: string | null;
  onStageChange?: (stageId: string | null) => void;
  stages?: { id: string; name: string }[];

  source: string | null;
  onSourceChange: (source: string | null) => void;
  dynamicSources?: { value: string; label: string }[];
  isLoadingSources?: boolean;

  campaignId: string | null;
  onCampaignChange: (id: string | null) => void;
  adSetId: string | null;
  onAdSetChange: (id: string | null) => void;
  adId: string | null;
  onAdChange: (id: string | null) => void;
  campaigns?: { id: string; name: string }[];
  adSets?: { id: string; name: string }[];
  ads?: { id: string; name: string }[];
  isLoadingCampaigns?: boolean;
  isLoadingAdSets?: boolean;
  isLoadingAds?: boolean;
  isLoadingTags?: boolean;
  hasTagsError?: boolean;
  hasDynamicOptionsError?: boolean;
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
  advancedContent?: ReactNode;
  advancedContentOnly?: boolean;
  hasAdvancedContentFilters?: boolean;
}

export function SharedFilters({
  datePreset,
  onDatePresetChange,
  onClearDatePreset,
  customDateRange,
  onCustomDateRangeChange,
  defaultDatePreset = "last30days",
  teamId,
  onTeamChange,
  userId,
  onUserChange,
  includeUnassignedUserOption = false,
  pipelineId = null,
  onPipelineChange,
  pipelines = [],
  stageId = null,
  onStageChange,
  stages = [],
  source,
  onSourceChange,
  campaignId,
  onCampaignChange,
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
  campaigns = [],
  adSets = [],
  ads = [],
  tags = [],
  isLoadingSources = false,
  isLoadingCampaigns = false,
  isLoadingAdSets = false,
  isLoadingAds = false,
  isLoadingTags = false,
  hasTagsError = false,
  hasDynamicOptionsError = false,
  isRetryingDynamicOptions = false,
  onRetryDynamicOptions,
  hideSearch = false,
  datePosition = "start",
  loadDynamicOptions = true,
  onFiltersOpenChange,
  tourPrefix,
  mobileIconOnly = false,
  triggerClassName,
  advancedContent,
  advancedContentOnly = false,
  hasAdvancedContentFilters = false,
}: SharedFiltersProps) {
  const { user, isSuperAdmin } = useAuth();
  const { hasPermission } = useUserPermissions();
  const canViewAllLeads = isSuperAdmin || hasPermission("lead_view_all");
  const canViewTeamLeads = hasPermission("lead_view_team");
  const canUseScopeFilters = canViewAllLeads || canViewTeamLeads;
  const { data: teams = [] } = useTeams({
    enabled: loadDynamicOptions && canUseScopeFilters,
  });
  const { data: users = [] } = useOrganizationUsers({
    enabled: loadDynamicOptions && canUseScopeFilters,
    scope: "filters",
  });
  const isMobile = useIsMobile();
  const useMobileIcons = isMobile && mobileIconOnly;
  const currentUserId = user?.id;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [userFilterOpen, setUserFilterOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");
  const [campaignFilterOpen, setCampaignFilterOpen] = useState(false);
  const [campaignSearch, setCampaignSearch] = useState("");

  // ✅ FIX: Usamos apenas refs para o input de busca — sem useState controlado
  // Isso evita re-renders a cada keystroke que causavam o "piscar" e perda de foco
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const searchQueryRef = useRef(searchQuery);
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
  useEffect(() => {
    if (
      searchInputRef.current &&
      searchInputRef.current.value !== searchQuery
    ) {
      searchInputRef.current.value = searchQuery;
    }
  }, [searchQuery]);

  const commitSearch = useCallback(() => {
    const nextSearch = searchInputRef.current?.value ?? "";
    if (nextSearch !== searchQueryRef.current) {
      onSearchChangeRef.current(nextSearch);
      searchQueryRef.current = nextSearch;
    }
  }, []);

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
      onDatePresetChange(defaultDatePreset || "last30days");
    },
    [defaultDatePreset, onClearDatePreset, onDatePresetChange],
  );

  const handleClearFilters = useCallback(() => {
    // Limpa o input via ref — sem setState, sem re-render desnecessário
    if (searchInputRef.current) {
      searchInputRef.current.value = "";
    }
    searchQueryRef.current = "";
    onClear();
  }, [onClear]);

  const handleFiltersOpenChange = useCallback(
    (open: boolean) => {
      if (!open && internalSelectInteractionRef.current) {
        return;
      }
      if (!open) {
        commitSearch();
        setUserFilterOpen(false);
        setCampaignFilterOpen(false);
        setCampaignSearch("");
      }
      setFiltersOpen(open);
      onFiltersOpenChange?.(open);
    },
    [commitSearch, onFiltersOpenChange],
  );

  const isTeamLeader = canViewTeamLeads;

  const showUserFilter = canViewAllLeads || isTeamLeader;

  const activeTeams = useMemo(
    () => teams.filter((team) => team.is_active !== false),
    [teams],
  );
  const availableTeams = useMemo(
    () =>
      canViewAllLeads
        ? activeTeams
        : activeTeams.filter((team) =>
            team.members?.some(
              (member) => member.user_id === currentUserId && member.is_leader,
            ),
          ),
    [activeTeams, canViewAllLeads, currentUserId],
  );

  const availableUsers = useMemo(() => {
    if (teamId) {
      const team = teams.find((item) => item.id === teamId);
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
  }, [availableTeams, canViewAllLeads, currentUserId, teamId, teams, users]);

  useEffect(() => {
    if (
      !showUserFilter ||
      !userId ||
      userId === "all" ||
      (includeUnassignedUserOption && userId === "unassigned")
    ) {
      return;
    }
    if (!availableUsers.some((availableUser) => availableUser.id === userId)) {
      onUserChange(null);
    }
  }, [
    availableUsers,
    includeUnassignedUserOption,
    onUserChange,
    showUserFilter,
    userId,
  ]);

  const selectedUser = useMemo(
    () => availableUsers.find((availableUser) => availableUser.id === userId),
    [availableUsers, userId],
  );
  const isUnassignedUserFilter =
    includeUnassignedUserOption && userId === "unassigned";

  const matchingUsers = useMemo(() => {
    const normalizedSearch = normalizeSearchText(userSearch);
    if (!normalizedSearch) return availableUsers;

    return availableUsers.filter((availableUser) => {
      return (
        searchTextIncludes(availableUser.name, normalizedSearch) ||
        searchTextIncludes(availableUser.email, normalizedSearch)
      );
    });
  }, [availableUsers, userSearch]);

  const visibleUserOptions = useMemo(
    () => matchingUsers.slice(0, 80),
    [matchingUsers],
  );
  const hiddenUsersCount = Math.max(
    0,
    matchingUsers.length - visibleUserOptions.length,
  );

  const selectedCampaign = useMemo(
    () => campaigns.find((campaign) => campaign.id === campaignId),
    [campaignId, campaigns],
  );
  const matchingCampaigns = useMemo(() => {
    const normalizedSearch = normalizeSearchText(campaignSearch);
    if (!normalizedSearch) return campaigns;
    return campaigns.filter((campaign) =>
      searchTextIncludes(campaign.name, normalizedSearch),
    );
  }, [campaignSearch, campaigns]);

  const hasDefaultExtraFilters =
    teamId !== null ||
    (userId !== null && userId !== "all") ||
    pipelineId !== null ||
    stageId !== null ||
    source !== null ||
    campaignId !== null ||
    adSetId !== null ||
    adId !== null ||
    tagIds.length > 0 ||
    dealStatus !== null ||
    searchQuery !== "";
  const hasExtraFilters = advancedContentOnly
    ? hasAdvancedContentFilters
    : hasDefaultExtraFilters || hasAdvancedContentFilters;
  const hasActiveDateFilter =
    Boolean(customDateRange) || datePreset !== defaultDatePreset;

  const filterSelectContentClass =
    "app-header-popover z-[130] rounded-[8px] border-0 p-1 [&_[role=option]]:rounded-[6px] [&_[role=option]]:text-[12px] [&_[role=option]]:font-light";
  const dashboardTriggerClass =
    "h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[10px] font-light normal-case tracking-normal text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30";
  const filterControlClass =
    "h-8 w-full rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2.5 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] focus:ring-1 focus:ring-primary/30";
  const isFilterFloatingLayer = (target: EventTarget | null) => {
    const element = target instanceof Element ? target : null;
    return Boolean(
      internalSelectInteractionRef.current ||
      element?.closest("[data-radix-popper-content-wrapper]") ||
      element?.closest("[role='listbox']") ||
      element?.closest("[cmdk-list]"),
    );
  };
  const getUserInitials = (name?: string | null, email?: string | null) => {
    const source = name?.trim() || email?.trim() || "U";
    return (
      source
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "U"
    );
  };

  return (
    <div className="flex items-center justify-end gap-2 w-full">
      {/* Data no início */}
      {datePosition === "start" && (
        <DateFilterPopover
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          customDateRange={customDateRange}
          onCustomDateRangeChange={onCustomDateRangeChange}
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
          align="end"
        />
      )}

      {/* Botão de filtros + popover */}
      <div className="flex items-center gap-1">
        <Popover
          open={filtersOpen}
          onOpenChange={handleFiltersOpenChange}
          modal={false}
        >
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={filtersOpen}
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
                      ? "hidden xs:inline"
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
                />
              )}
            </Button>
          </PopoverTrigger>

          <PopoverContent
            data-tour={tourPrefix ? `${tourPrefix}-filters-panel` : undefined}
            align="end"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              if (isFilterFloatingLayer(e.target)) {
                e.preventDefault();
              }
            }}
            onPointerDownOutside={(e) => {
              if (isFilterFloatingLayer(e.target)) {
                e.preventDefault();
              }
            }}
            onFocusOutside={(e) => {
              if (isFilterFloatingLayer(e.target)) {
                e.preventDefault();
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className={cn(
              "app-header-popover z-[100] w-72 rounded-[8px] border-0 p-2.5",
              isMobile && "max-h-[80dvh] w-[280px] overflow-y-auto",
            )}
          >
            {/* ✅ FIX: Conteúdo do filtro como JSX direto, não como sub-componente
                Sub-componentes definidos dentro do pai são recriados a cada render,
                causando desmontagem do <Input> e perda de foco a cada keystroke */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
                  Filtros Avançados
                </span>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-7 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-2 text-[10px] font-light text-primary shadow-none hover:bg-[var(--app-surface-hover)]"
                  >
                    Limpar
                  </Button>
                )}
              </div>

              {hasDynamicOptionsError && (
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
                      onClick={onRetryDynamicOptions}
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
                {advancedContent}
                {!advancedContentOnly ? (
                  <>
                    {/* ✅ FIX: Input UNCONTROLLED — sem value/onChange que causam re-render
                    Usamos defaultValue + ref. O valor é lido via ref no commitSearch. */}
                    {!hideSearch && (
                      <div className="relative group">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground group-focus-within:text-primary" />
                        <Input
                          ref={searchInputRef}
                          placeholder="Buscar..."
                          defaultValue={searchQuery}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitSearch();
                            }
                          }}
                          onKeyUp={(e) => {
                            e.stopPropagation();
                          }}
                          autoComplete="off"
                          className="h-8 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-[12px] font-light text-[var(--app-text-primary)] shadow-none placeholder:text-[var(--app-text-tertiary)] focus:bg-[var(--app-surface-hover)] focus-visible:ring-1 focus-visible:ring-primary/30"
                        />
                      </div>
                    )}

                    {onPipelineChange && pipelines.length > 0 && (
                      <Select
                        value={pipelineId || "all"}
                        onOpenChange={markInternalSelectInteraction}
                        onValueChange={(value) => {
                          onPipelineChange(value === "all" ? null : value);
                          onStageChange?.(null);
                        }}
                      >
                        <SelectTrigger
                          aria-label="Filtrar por pipeline"
                          onPointerDown={markInternalSelectInteraction}
                          className={cn(
                            filterControlClass,
                            pipelineId && "text-primary",
                          )}
                        >
                          <SelectValue placeholder="Pipeline" />
                        </SelectTrigger>
                        <SelectContent className={filterSelectContentClass}>
                          <SelectItem value="all">Todas pipelines</SelectItem>
                          {pipelines.map((pipeline) => (
                            <SelectItem key={pipeline.id} value={pipeline.id}>
                              {pipeline.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {onStageChange && pipelineId && stages.length > 0 && (
                      <Select
                        value={stageId || "all"}
                        onOpenChange={markInternalSelectInteraction}
                        onValueChange={(value) =>
                          onStageChange(value === "all" ? null : value)
                        }
                      >
                        <SelectTrigger
                          aria-label="Filtrar por estágio"
                          onPointerDown={markInternalSelectInteraction}
                          className={cn(
                            filterControlClass,
                            stageId && "text-primary",
                          )}
                        >
                          <SelectValue placeholder="Estágio" />
                        </SelectTrigger>
                        <SelectContent className={filterSelectContentClass}>
                          <SelectItem value="all">Todos estágios</SelectItem>
                          {stages.map((stage) => (
                            <SelectItem key={stage.id} value={stage.id}>
                              {stage.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* Team Filter */}
                    {availableTeams.length > 0 && (
                      <Select
                        value={teamId || "all"}
                        onOpenChange={markInternalSelectInteraction}
                        onValueChange={(value) => {
                          onTeamChange(value === "all" ? null : value);
                          onUserChange(null);
                        }}
                      >
                        <SelectTrigger
                          onPointerDown={markInternalSelectInteraction}
                          className={cn(
                            filterControlClass,
                            teamId && "text-primary",
                          )}
                        >
                          <Users className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                          <SelectValue placeholder="Equipe" />
                        </SelectTrigger>
                        <SelectContent className={filterSelectContentClass}>
                          <SelectItem value="all">Todas equipes</SelectItem>
                          {availableTeams.map((team) => (
                            <SelectItem key={team.id} value={team.id}>
                              {team.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}

                    {/* User Filter */}
                    {showUserFilter && (
                      <Popover
                        open={userFilterOpen}
                        onOpenChange={setUserFilterOpen}
                        modal={false}
                      >
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={userFilterOpen}
                            onPointerDown={markInternalSelectInteraction}
                            className={cn(
                              filterControlClass,
                              "justify-between outline-none ring-0 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0 data-[state=open]:bg-[var(--app-surface-hover)]",
                              userId && userId !== "all" && "text-primary",
                            )}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              {selectedUser ? (
                                <Avatar className="h-5 w-5">
                                  <AvatarImage
                                    src={selectedUser.avatar_url || undefined}
                                    alt={
                                      selectedUser.name ||
                                      selectedUser.email ||
                                      "Corretor"
                                    }
                                  />
                                  <AvatarFallback className="text-[9px]">
                                    {getUserInitials(
                                      selectedUser.name,
                                      selectedUser.email,
                                    )}
                                  </AvatarFallback>
                                </Avatar>
                              ) : (
                                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-surface-hover)]">
                                  <User className="h-3.5 w-3.5 flex-shrink-0" />
                                </span>
                              )}
                              <span className="truncate">
                                {selectedUser
                                  ? getUserFilterLabel(selectedUser)
                                  : isUnassignedUserFilter
                                    ? "Sem responsável"
                                    : "Todos"}
                              </span>
                            </span>
                            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent
                          align="start"
                          className="app-header-popover z-[140] w-[260px] rounded-[8px] border-0 p-1"
                          onOpenAutoFocus={(event) => event.preventDefault()}
                          onPointerDownCapture={markInternalSelectInteraction}
                          onDoubleClick={(event) => event.stopPropagation()}
                        >
                          <Command
                            shouldFilter={false}
                            className="rounded-[6px] bg-transparent text-[12px] font-light [&_[cmdk-input-wrapper]]:border-b-0"
                          >
                            <CommandInput
                              placeholder="Buscar corretor..."
                              value={userSearch}
                              onValueChange={setUserSearch}
                              className="h-9 text-[12px] font-light"
                            />
                            <CommandList className="max-h-[260px]">
                              {matchingUsers.length === 0 &&
                              !includeUnassignedUserOption ? (
                                <CommandEmpty>
                                  Nenhum corretor encontrado.
                                </CommandEmpty>
                              ) : (
                                <CommandGroup>
                                  <CommandItem
                                    value="all"
                                    className="rounded-[6px] border-0 text-[12px] font-light outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                    onSelect={() => {
                                      onUserChange(null);
                                      setUserSearch("");
                                      setUserFilterOpen(false);
                                    }}
                                  >
                                    <Check
                                      className={cn(
                                        "mr-2 h-3.5 w-3.5",
                                        !userId ? "opacity-100" : "opacity-0",
                                      )}
                                    />
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--app-surface-hover)]">
                                        <User className="h-3.5 w-3.5" />
                                      </span>
                                      <span>Todos</span>
                                    </span>
                                  </CommandItem>
                                  {includeUnassignedUserOption && (
                                    <CommandItem
                                      value="unassigned Sem responsável"
                                      className="rounded-[6px] border-0 text-[12px] font-light outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                      onSelect={() => {
                                        onUserChange("unassigned");
                                        setUserSearch("");
                                        setUserFilterOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-3.5 w-3.5",
                                          isUnassignedUserFilter
                                            ? "opacity-100"
                                            : "opacity-0",
                                        )}
                                      />
                                      <span className="flex min-w-0 items-center gap-2">
                                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--app-surface-hover)]">
                                          <User className="h-3.5 w-3.5" />
                                        </span>
                                        <span>Sem responsável</span>
                                      </span>
                                    </CommandItem>
                                  )}
                                  {visibleUserOptions.map((availableUser) => (
                                    <CommandItem
                                      key={availableUser.id}
                                      value={`${availableUser.name || ""} ${availableUser.email || ""}`}
                                      className="rounded-[6px] border-0 text-[12px] font-light outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                      onSelect={() => {
                                        onUserChange(availableUser.id);
                                        setUserSearch("");
                                        setUserFilterOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-3.5 w-3.5",
                                          userId === availableUser.id
                                            ? "opacity-100"
                                            : "opacity-0",
                                        )}
                                      />
                                      <Avatar className="mr-2 h-6 w-6">
                                        <AvatarImage
                                          src={
                                            availableUser.avatar_url ||
                                            undefined
                                          }
                                          alt={
                                            availableUser.name ||
                                            availableUser.email ||
                                            "Corretor"
                                          }
                                        />
                                        <AvatarFallback className="text-[10px]">
                                          {getUserInitials(
                                            availableUser.name,
                                            availableUser.email,
                                          )}
                                        </AvatarFallback>
                                      </Avatar>
                                      <span className="truncate">
                                        {getUserFilterLabel(availableUser)}
                                      </span>
                                    </CommandItem>
                                  ))}
                                  {hiddenUsersCount > 0 && (
                                    <div className="px-8 py-2 text-[10px] text-muted-foreground">
                                      Digite para buscar mais {hiddenUsersCount}{" "}
                                      corretor(es).
                                    </div>
                                  )}
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}

                    {/* Source Filter */}
                    <Select
                      value={source || "all"}
                      disabled={isLoadingSources}
                      onOpenChange={markInternalSelectInteraction}
                      onValueChange={(value) =>
                        onSourceChange(value === "all" ? null : value)
                      }
                    >
                      <SelectTrigger
                        disabled={isLoadingSources}
                        aria-busy={isLoadingSources}
                        onPointerDown={markInternalSelectInteraction}
                        className={cn(
                          filterControlClass,
                          source && "text-primary",
                        )}
                      >
                        <Globe className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                        <SelectValue
                          placeholder={
                            isLoadingSources ? "Carregando..." : "Origem"
                          }
                        />
                      </SelectTrigger>
                      <SelectContent className={filterSelectContentClass}>
                        <SelectItem value="all">Todas origens</SelectItem>
                        {dynamicSources.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

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
                        onPointerDown={markInternalSelectInteraction}
                        className={cn(
                          filterControlClass,
                          dealStatus && "text-primary",
                        )}
                      >
                        <CircleDot className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent className={filterSelectContentClass}>
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
                        {/* Campaign */}
                        <div className="space-y-1">
                          <Popover
                            open={campaignFilterOpen}
                            onOpenChange={(open) => {
                              setCampaignFilterOpen(open);
                              if (!open) setCampaignSearch("");
                            }}
                            modal={false}
                          >
                            <PopoverTrigger asChild>
                              <Button
                                variant="outline"
                                role="combobox"
                                aria-expanded={campaignFilterOpen}
                                aria-busy={isLoadingCampaigns}
                                disabled={isLoadingCampaigns}
                                onPointerDown={markInternalSelectInteraction}
                                className={cn(
                                  filterControlClass,
                                  "justify-between outline-none ring-0 focus-visible:ring-1 focus-visible:ring-primary/30 focus-visible:ring-offset-0 data-[state=open]:bg-[var(--app-surface-hover)]",
                                  campaignId && "text-primary",
                                )}
                              >
                                <span className="truncate">
                                  {isLoadingCampaigns
                                    ? "Carregando campanhas..."
                                    : selectedCampaign?.name || "Todas campanhas"}
                                </span>
                                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent
                              align="start"
                              className="app-header-popover z-[140] w-[260px] rounded-[8px] border-0 p-1"
                              onOpenAutoFocus={(event) => event.preventDefault()}
                              onPointerDownCapture={markInternalSelectInteraction}
                              onDoubleClick={(event) => event.stopPropagation()}
                            >
                              <Command
                                shouldFilter={false}
                                className="rounded-[6px] bg-transparent text-[12px] font-light [&_[cmdk-input-wrapper]]:border-b-0"
                              >
                                <CommandInput
                                  placeholder="Buscar campanha..."
                                  value={campaignSearch}
                                  onValueChange={setCampaignSearch}
                                  className="h-9 text-[12px] font-light"
                                />
                                <CommandList className="max-h-[260px]">
                                  {matchingCampaigns.length === 0 && (
                                    <p className="px-2 py-3 text-center text-[12px] font-light text-[var(--app-text-tertiary)]">
                                      Nenhuma campanha encontrada.
                                    </p>
                                  )}
                                  <CommandGroup>
                                    <CommandItem
                                      value="all Todas campanhas"
                                      className="rounded-[6px] border-0 text-[12px] font-light outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                      onSelect={() => {
                                        onCampaignChange(null);
                                        setCampaignSearch("");
                                        setCampaignFilterOpen(false);
                                      }}
                                    >
                                      <Check
                                        className={cn(
                                          "mr-2 h-3.5 w-3.5",
                                          !campaignId ? "opacity-100" : "opacity-0",
                                        )}
                                      />
                                      Todas campanhas
                                    </CommandItem>
                                    {matchingCampaigns.map((campaign) => (
                                      <CommandItem
                                        key={campaign.id}
                                        value={`${campaign.name} ${campaign.id}`}
                                        className="rounded-[6px] border-0 text-[12px] font-light outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                        onSelect={() => {
                                          onCampaignChange(campaign.id);
                                          setCampaignSearch("");
                                          setCampaignFilterOpen(false);
                                        }}
                                      >
                                        <Check
                                          className={cn(
                                            "mr-2 h-3.5 w-3.5",
                                            campaignId === campaign.id
                                              ? "opacity-100"
                                              : "opacity-0",
                                          )}
                                        />
                                        <span className="truncate">{campaign.name}</span>
                                      </CommandItem>
                                    ))}
                                  </CommandGroup>
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </div>

                        {/* Ad Set — só aparece se campaign selecionada */}
                        {campaignId && (
                          <div className="space-y-1">
                            <Select
                              value={adSetId || "all"}
                              disabled={isLoadingAdSets}
                              onOpenChange={markInternalSelectInteraction}
                              onValueChange={(value) =>
                                onAdSetChange(value === "all" ? null : value)
                              }
                            >
                              <SelectTrigger
                                disabled={isLoadingAdSets}
                                aria-busy={isLoadingAdSets}
                                onPointerDown={markInternalSelectInteraction}
                                className={cn(
                                  filterControlClass,
                                  "animate-in fade-in slide-in-from-top-1",
                                )}
                              >
                                <SelectValue
                                  placeholder={
                                    isLoadingAdSets
                                      ? "Carregando..."
                                      : "Todos conjuntos"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent
                                className={filterSelectContentClass}
                              >
                                <SelectItem value="all">
                                  Todos conjuntos
                                </SelectItem>
                                {adSets.map((adSet) => (
                                  <SelectItem key={adSet.id} value={adSet.id}>
                                    {adSet.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Ad — só aparece se adSet selecionado */}
                        {adSetId && (
                          <div className="space-y-1">
                            <Select
                              value={adId || "all"}
                              disabled={isLoadingAds}
                              onOpenChange={markInternalSelectInteraction}
                              onValueChange={(value) =>
                                onAdChange(value === "all" ? null : value)
                              }
                            >
                              <SelectTrigger
                                disabled={isLoadingAds}
                                aria-busy={isLoadingAds}
                                onPointerDown={markInternalSelectInteraction}
                                className={cn(
                                  filterControlClass,
                                  "animate-in fade-in slide-in-from-top-1",
                                )}
                              >
                                <SelectValue
                                  placeholder={
                                    isLoadingAds
                                      ? "Carregando..."
                                      : "Todos criativos"
                                  }
                                />
                              </SelectTrigger>
                              <SelectContent
                                className={filterSelectContentClass}
                              >
                                <SelectItem value="all">
                                  Todos criativos
                                </SelectItem>
                                {ads.map((ad) => (
                                  <SelectItem key={ad.id} value={ad.id}>
                                    {ad.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Botão limpar fora do popover (desktop) */}
        {hasActiveFilters && !isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
            onClick={handleClearFilters}
            title="Limpar todos os filtros"
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
          triggerDataTour={tourPrefix ? `${tourPrefix}-date-filter` : undefined}
          triggerClassName={cn(
            dashboardTriggerClass,
            triggerClassName,
            isMobile && "px-2",
            hasActiveDateFilter &&
              "bg-primary/50 text-white hover:bg-primary hover:text-white",
          )}
          iconOnly={useMobileIcons}
          align="end"
        />
      )}
    </div>
  );
}
