import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Users, User, Globe, X, SlidersHorizontal, Search, Tag as TagIcon, CircleDot, Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { useTeams } from "@/hooks/use-teams";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useAuth } from "@/contexts/AuthContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { DatePreset } from "@/hooks/use-dashboard-filters";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";

interface SharedFiltersProps {
  datePreset: DatePreset;
  onDatePresetChange: (preset: DatePreset) => void;
  customDateRange: { from: Date; to: Date } | null;
  onCustomDateRangeChange: (range: { from: Date; to: Date } | null) => void;

  teamId: string | null;
  onTeamChange: (teamId: string | null) => void;
  userId: string | null;
  onUserChange: (userId: string | null) => void;

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

  tagId: string | null;
  onTagChange: (tagId: string | null) => void;
  tags?: { id: string; name: string; color: string }[];

  dealStatus: string | null;
  onDealStatusChange: (status: string | null) => void;

  searchQuery: string;
  onSearchChange: (query: string) => void;

  onClear: () => void;
  hasActiveFilters: boolean;
  hideSearch?: boolean;
  datePosition?: "start" | "end";
  onFiltersOpenChange?: (open: boolean) => void;
}

export function SharedFilters({
  datePreset,
  onDatePresetChange,
  customDateRange,
  onCustomDateRangeChange,
  teamId,
  onTeamChange,
  userId,
  onUserChange,
  source,
  onSourceChange,
  campaignId,
  onCampaignChange,
  adSetId,
  onAdSetChange,
  adId,
  onAdChange,
  tagId,
  onTagChange,
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
  hideSearch = false,
  datePosition = "start",
  onFiltersOpenChange,
}: SharedFiltersProps) {
  const { user, profile } = useAuth();
  const { data: teams = [] } = useTeams();
  const { data: users = [] } = useOrganizationUsers();
  const isMobile = useIsMobile();
  const { hasPermission } = useUserPermissions();
  const currentUserId = user?.id;

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [userFilterOpen, setUserFilterOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  // ✅ FIX: Usamos apenas refs para o input de busca — sem useState controlado
  // Isso evita re-renders a cada keystroke que causavam o "piscar" e perda de foco
  const searchInputRef = useRef<HTMLInputElement>(null);
  const onSearchChangeRef = useRef(onSearchChange);
  const searchQueryRef = useRef(searchQuery);

  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);

  // ✅ FIX: Quando searchQuery mudar externamente (ex: limpar filtros),
  // atualiza o valor do input via ref sem causar re-render
  useEffect(() => {
    if (searchInputRef.current && searchInputRef.current.value !== searchQuery) {
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

  const handleDatePresetChange = useCallback(
    (nextPreset: DatePreset | null) => {
      onDatePresetChange(nextPreset ?? "last30days");
    },
    [onDatePresetChange],
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
      if (!open) {
        commitSearch();
        setUserFilterOpen(false);
      }
      setFiltersOpen(open);
      onFiltersOpenChange?.(open);
    },
    [commitSearch, onFiltersOpenChange],
  );

  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const canViewAllLeads = isAdmin || hasPermission("lead_view_all");

  const isTeamLeader = useMemo(
    () => teams.some((team) => team.members?.some((member) => member.user_id === currentUserId && member.is_leader)),
    [currentUserId, teams],
  );

  const showUserFilter = canViewAllLeads || isTeamLeader;

  const activeTeams = useMemo(() => teams.filter((team) => team.is_active !== false), [teams]);
  const availableTeams = useMemo(
    () =>
      canViewAllLeads
        ? activeTeams
        : activeTeams.filter((team) =>
            team.members?.some((member) => member.user_id === currentUserId && member.is_leader),
          ),
    [activeTeams, canViewAllLeads, currentUserId],
  );

  const availableUsers = useMemo(
    () => {
      if (teamId) {
        const team = teams.find((item) => item.id === teamId);
        return users.filter((availableUser) => team?.members?.some((member) => member.user_id === availableUser.id));
      }

      if (canViewAllLeads) return users;

      const ledUserIds = new Set(
        availableTeams.flatMap((team) => team.members?.map((member) => member.user_id).filter(Boolean) || []),
      );
      if (currentUserId) ledUserIds.add(currentUserId);

      return users.filter((availableUser) => ledUserIds.has(availableUser.id));
    },
    [availableTeams, canViewAllLeads, currentUserId, teamId, teams, users],
  );

  useEffect(() => {
    if (!showUserFilter || !userId || userId === "all") return;
    if (!availableUsers.some((availableUser) => availableUser.id === userId)) {
      onUserChange(null);
    }
  }, [availableUsers, onUserChange, showUserFilter, userId]);

  const selectedUser = useMemo(
    () => availableUsers.find((availableUser) => availableUser.id === userId),
    [availableUsers, userId],
  );

  const matchingUsers = useMemo(() => {
    const normalizedSearch = userSearch.trim().toLowerCase();
    if (!normalizedSearch) return availableUsers;

    return availableUsers.filter((availableUser) => {
      const name = availableUser.name?.toLowerCase() || "";
      const email = availableUser.email?.toLowerCase() || "";
      return name.includes(normalizedSearch) || email.includes(normalizedSearch);
    });
  }, [availableUsers, userSearch]);

  const visibleUserOptions = useMemo(() => matchingUsers.slice(0, 80), [matchingUsers]);
  const hiddenUsersCount = Math.max(0, matchingUsers.length - visibleUserOptions.length);

  const hasExtraFilters =
    teamId !== null ||
    (userId !== null && userId !== "all") ||
    source !== null ||
    campaignId !== null ||
    adSetId !== null ||
    adId !== null ||
    tagId !== null ||
    dealStatus !== null ||
    searchQuery !== "";

  const filterSelectContentClass = "z-[130]";
  const dashboardTriggerClass =
    "h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface)] px-3 text-[11px] font-semibold uppercase tracking-wider text-[var(--app-text-primary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30";
  const getUserInitials = (name?: string | null, email?: string | null) => {
    const source = name?.trim() || email?.trim() || "U";
    return source
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "U";
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
          triggerClassName={cn(
            dashboardTriggerClass,
            isMobile ? "px-2 text-xs font-medium normal-case tracking-normal" : "",
            (datePreset !== "last30days" || customDateRange) && "bg-primary/10 text-primary hover:bg-primary/15",
          )}
          align="end"
        />
      )}

      {/* Botão de filtros + popover */}
      <div className="flex items-center gap-1">
        <Popover open={filtersOpen} onOpenChange={handleFiltersOpenChange} modal={false}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={filtersOpen}
              className={cn(
                dashboardTriggerClass,
                isMobile ? "px-2.5 text-xs font-medium normal-case tracking-normal" : "",
                hasExtraFilters && "bg-primary/10 text-primary hover:bg-primary/15",
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className={isMobile ? "hidden xs:inline" : ""}>Filtros</span>
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
            align="end"
            onOpenAutoFocus={(e) => e.preventDefault()}
            onInteractOutside={(e) => {
              const target = e.target instanceof Element ? e.target : null;
              if (
                target?.closest("[role='listbox']") ||
                target?.closest("[data-radix-popper-content-wrapper]")
              ) {
                e.preventDefault();
              }
            }}
            className={cn(
              "z-[100] w-72 p-3 border-white/[0.055] shadow-2xl",
              isMobile && "w-[280px] max-h-[80vh] overflow-y-auto",
            )}
          >
            {/* ✅ FIX: Conteúdo do filtro como JSX direto, não como sub-componente
                Sub-componentes definidos dentro do pai são recriados a cada render,
                causando desmontagem do <Input> e perda de foco a cada keystroke */}
            <div className="space-y-3">
              <div className="flex items-center justify-between border-b border-white/[0.055] pb-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  Filtros Avançados
                </span>
                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClearFilters}
                    className="h-5 px-1.5 text-[9px] uppercase font-bold text-primary hover:bg-primary/10"
                  >
                    Limpar
                  </Button>
                )}
              </div>

              <div className="grid gap-2">
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
                      className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] pl-8 text-xs text-[var(--app-text-primary)] placeholder:text-muted-foreground focus:bg-[var(--app-surface-hover)]"
                    />
                  </div>
                )}

                {/* Team Filter */}
                {availableTeams.length > 0 && (
                  <Select
                    value={teamId || "all"}
                    onValueChange={(value) => {
                      onTeamChange(value === "all" ? null : value);
                      onUserChange(null);
                    }}
                  >
                    <SelectTrigger className={cn("h-9 w-full text-xs", teamId && "border-primary text-primary")}>
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
                  <Popover open={userFilterOpen} onOpenChange={setUserFilterOpen} modal={false}>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={userFilterOpen}
                        className={cn(
                          "h-9 w-full justify-between rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-xs font-normal text-[var(--app-text-primary)] shadow-none outline-none ring-0 transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:ring-0 focus-visible:ring-offset-0 data-[state=open]:bg-[var(--app-surface-hover)]",
                          userId && userId !== "all" && "text-primary",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          {selectedUser ? (
                            <Avatar className="h-5 w-5">
                              <AvatarImage src={selectedUser.avatar_url || undefined} alt={selectedUser.name || selectedUser.email || "Corretor"} />
                              <AvatarFallback className="text-[9px]">{getUserInitials(selectedUser.name, selectedUser.email)}</AvatarFallback>
                            </Avatar>
                          ) : (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--app-surface-hover)]">
                              <User className="h-3.5 w-3.5 flex-shrink-0" />
                            </span>
                          )}
                          <span className="truncate">{selectedUser?.name || "Todos"}</span>
                        </span>
                        <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      align="start"
                      className="z-[140] w-[260px] p-0"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                    >
                      <Command shouldFilter={false} className="[&_[cmdk-input-wrapper]]:border-b-0">
                        <CommandInput
                          placeholder="Buscar corretor..."
                          value={userSearch}
                          onValueChange={setUserSearch}
                        />
                        <CommandList className="max-h-[260px]">
                          {matchingUsers.length === 0 ? (
                            <CommandEmpty>Nenhum corretor encontrado.</CommandEmpty>
                          ) : (
                            <CommandGroup>
                              <CommandItem
                                value="all"
                                className="rounded-[6px] border-0 outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                onSelect={() => {
                                  onUserChange(null);
                                  setUserSearch("");
                                  setUserFilterOpen(false);
                                }}
                              >
                                <Check className={cn("mr-2 h-3.5 w-3.5", !userId ? "opacity-100" : "opacity-0")} />
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--app-surface-hover)]">
                                    <User className="h-3.5 w-3.5" />
                                  </span>
                                  <span>Todos</span>
                                </span>
                              </CommandItem>
                              {visibleUserOptions.map((availableUser) => (
                                <CommandItem
                                  key={availableUser.id}
                                  value={`${availableUser.name || ""} ${availableUser.email || ""}`}
                                  className="rounded-[6px] border-0 outline-none focus-visible:ring-0 data-[selected=true]:bg-[var(--app-surface-hover)]"
                                  onSelect={() => {
                                    onUserChange(availableUser.id);
                                    setUserSearch("");
                                    setUserFilterOpen(false);
                                  }}
                                >
                                  <Check
                                    className={cn(
                                      "mr-2 h-3.5 w-3.5",
                                      userId === availableUser.id ? "opacity-100" : "opacity-0",
                                    )}
                                  />
                                  <Avatar className="mr-2 h-6 w-6">
                                    <AvatarImage src={availableUser.avatar_url || undefined} alt={availableUser.name || availableUser.email || "Corretor"} />
                                    <AvatarFallback className="text-[10px]">{getUserInitials(availableUser.name, availableUser.email)}</AvatarFallback>
                                  </Avatar>
                                  <span className="truncate">
                                    {availableUser.name || availableUser.email || "Usuário"}
                                  </span>
                                </CommandItem>
                              ))}
                              {hiddenUsersCount > 0 && (
                                <div className="px-8 py-2 text-[10px] text-muted-foreground">
                                  Digite para buscar mais {hiddenUsersCount} corretor(es).
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
                  onValueChange={(value) => onSourceChange(value === "all" ? null : value)}
                >
                  <SelectTrigger className={cn("h-9 w-full text-xs", source && "border-primary text-primary")}>
                    <Globe className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                    <SelectValue placeholder={isLoadingSources ? "Carregando..." : "Origem"} />
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
                <Select
                  value={tagId || "all"}
                  onValueChange={(value) => onTagChange(value === "all" ? null : value)}
                >
                  <SelectTrigger className={cn("h-9 w-full text-xs", tagId && "border-primary text-primary")}>
                    <TagIcon className="h-3.5 w-3.5 mr-1.5 flex-shrink-0" />
                    <SelectValue placeholder="Tag" />
                  </SelectTrigger>
                  <SelectContent className={filterSelectContentClass}>
                    <SelectItem value="all">Todas tags</SelectItem>
                    {tags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {/* Deal Status Filter */}
                <Select
                  value={dealStatus || "all"}
                  onValueChange={(value) => onDealStatusChange(value === "all" ? null : value)}
                >
                  <SelectTrigger className={cn("h-9 w-full text-xs", dealStatus && "border-primary text-primary")}>
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
                <div className="space-y-2 pt-2 border-t border-white/[0.055]">
                  <div className="flex items-center gap-1.5 px-1 mb-1">
                    <Globe className="h-3 w-3 text-[#1877F2]" />
                    <span className="text-[10px] font-bold text-muted-foreground">CAMPANHAS META</span>
                  </div>

                  <div className="space-y-2">
                    {/* Campaign */}
                    <div className="space-y-1">
                      <Select
                        value={campaignId || "all"}
                        onValueChange={(value) => onCampaignChange(value === "all" ? null : value)}
                      >
                        <SelectTrigger className="h-8 text-xs bg-white/[0.035] border-white/[0.055]">
                          <SelectValue placeholder={isLoadingCampaigns ? "Carregando..." : "Todas campanhas"} />
                        </SelectTrigger>
                        <SelectContent className={filterSelectContentClass}>
                          <SelectItem value="all">Todas campanhas</SelectItem>
                          {campaigns.map((campaign) => (
                            <SelectItem key={campaign.id} value={campaign.id}>
                              {campaign.name}
                            </SelectItem>
                          ))}
                          {!isLoadingCampaigns && campaigns.length === 0 && (
                            <div className="p-2 text-[10px] text-center text-muted-foreground">
                              Nenhuma campanha no período
                            </div>
                          )}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Ad Set — só aparece se campaign selecionada */}
                    {campaignId && (
                      <div className="space-y-1">
                        <Select
                          value={adSetId || "all"}
                          onValueChange={(value) => onAdSetChange(value === "all" ? null : value)}
                        >
                          <SelectTrigger className="h-8 text-xs bg-white/[0.035] border-white/[0.055] animate-in fade-in slide-in-from-top-1">
                            <SelectValue placeholder={isLoadingAdSets ? "Carregando..." : "Todos conjuntos"} />
                          </SelectTrigger>
                          <SelectContent className={filterSelectContentClass}>
                            <SelectItem value="all">Todos conjuntos</SelectItem>
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
                          onValueChange={(value) => onAdChange(value === "all" ? null : value)}
                        >
                          <SelectTrigger className="h-8 text-xs bg-white/[0.035] border-white/[0.055] animate-in fade-in slide-in-from-top-1">
                            <SelectValue placeholder={isLoadingAds ? "Carregando..." : "Todos criativos"} />
                          </SelectTrigger>
                          <SelectContent className={filterSelectContentClass}>
                            <SelectItem value="all">Todos criativos</SelectItem>
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
              </div>
            </div>
          </PopoverContent>
        </Popover>

        {/* Botão limpar fora do popover (desktop) */}
        {hasActiveFilters && !isMobile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-destructive transition-colors"
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
          triggerClassName={cn(
            "h-8 gap-2 text-[11px] font-semibold uppercase tracking-wider px-3 border-white/[0.08] hover:border-primary/50 transition-colors",
            isMobile ? "px-2 text-xs font-medium normal-case tracking-normal" : "",
            (datePreset !== "last30days" || customDateRange) && "border-primary/50 bg-primary/5 text-primary",
          )}
          align="end"
        />
      )}
    </div>
  );
}
