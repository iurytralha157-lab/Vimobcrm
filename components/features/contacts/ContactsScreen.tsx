"use client";

import { useState, useDeferredValue, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { LeadDetailDialog } from "@/components/features/leads/LeadDetailDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Table, TableCell, TableHead, TableHeader, TableRow, TableBody } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  MoreHorizontal,
  Phone,
  Mail,
  ExternalLink,
  Download,
  Upload,
  ChevronDown,
  MessageCircle,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  Plus,
  ChevronsRight,
  Trophy,
  XCircle,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { CreateLeadDialog } from "@/components/features/leads/CreateLeadDialog";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { ContactCard } from "@/components/features/contacts/ContactCard";
import { useStages } from "@/hooks/use-stages";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useTags } from "@/hooks/use-tags";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { ImportContactsDialog } from "@/components/features/contacts/ImportContactsDialog";
import { TableSkeleton } from "@/components/features/contacts/TableSkeleton";
import { EmptyState } from "@/components/features/contacts/EmptyState";
import { useContactsList, type Contact, type ContactListFilters } from "@/hooks/use-contacts-list";
import { useLead, useDeleteLead } from "@/hooks/use-leads";
import { ReentryBadge } from "@/components/features/leads/ReentryBadge";
import { useToast } from "@/hooks/use-toast";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useFilterOptionsPipelineId } from "@/hooks/use-filter-options-pipeline-id";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function SortIcon({
  column,
  sortBy,
  sortDir,
}: {
  column: ContactListFilters["sortBy"];
  sortBy: ContactListFilters["sortBy"];
  sortDir: ContactListFilters["sortDir"];
}) {
  if (sortBy !== column) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;

  return sortDir === "asc" ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
}

function LeadCountBadge({
  isLoading,
  totalCount,
  className,
}: {
  isLoading: boolean;
  totalCount: number;
  className?: string;
}) {
  return (
    <div
      data-tour="contacts-count"
      className={cn(
        "flex h-9 shrink-0 items-center rounded-md bg-[var(--app-surface-soft)] px-3 text-sm font-semibold text-[var(--app-text-primary)]",
        className,
      )}
      aria-label="Total de leads filtrados"
    >
      {isLoading ? "..." : totalCount.toLocaleString("pt-BR")} leads
    </div>
  );
}

function ContactsErrorState({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[8px] bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-[var(--app-text-primary)]">Não foi possível carregar os contatos</h3>
        <p className="max-w-[420px] text-xs text-muted-foreground">{message}</p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying} className="h-8 gap-2">
        <RefreshCw className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")} />
        Tentar novamente
      </Button>
    </div>
  );
}

function AssigneeAvatarCell({
  name,
  avatarUrl,
}: {
  name: string | null;
  avatarUrl: string | null;
}) {
  const label = name || "Sem responsável";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex w-12 justify-center">
            {name ? (
              <Avatar className="h-7 w-7">
                <AvatarImage src={avatarUrl || undefined} alt={name} />
                <AvatarFallback className="bg-[var(--app-surface-soft)] text-[10px] text-[var(--app-text-tertiary)]">
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-[10px] text-muted-foreground">
                --
              </div>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function Contacts() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { organization, profile, isSuperAdmin } = useAuth();
  const { hasPermission } = useUserPermissions();
  const organizationId = organization?.id ?? profile?.organization_id ?? null;
  const canDeleteLeads = isSuperAdmin || hasPermission("lead_delete");
  const canCreateLeads = isSuperAdmin || hasPermission("lead_create");
  const canImportLeads = isSuperAdmin || hasPermission("lead_import");
  const canExportLeads = isSuperAdmin || hasPermission("lead_export");
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<string>("all");
  const [selectedStage, setSelectedStage] = useState<string>("all");
  const filterOptionsPipelineId = useFilterOptionsPipelineId(selectedPipeline !== "all" ? selectedPipeline : null);

  const {
    filters: sharedFilters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    setTeamId,
    userId: selectedAssignee,
    setUserId: setSelectedAssignee,
    tagId: selectedTag,
    setTagId: setSelectedTag,
    dealStatus: selectedDealStatus,
    setDealStatus: setSelectedDealStatus,
    source: selectedSource,
    setSource: setSelectedSource,
    campaignId,
    setCampaignId,
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    searchQuery: search,
    setSearchQuery: setSearch,
    clearFilters,
    hasActiveFilters: hasSharedActiveFilters,
    dynamicSources,
    campaigns,
    adSets,
    ads,
    tags: allTagsFromHook,
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
  } = useSharedFilters({
    loadDynamicOptions: shouldLoadFilterOptions,
    pipelineId: selectedPipeline !== "all" ? selectedPipeline : filterOptionsPipelineId,
  });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(null);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [isExporting, setIsExporting] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [lostLeadsView, setLostLeadsView] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const openLeadDetails = (contactId: string) => setSelectedContactId(contactId);

  useEffect(() => {
    if (searchParams.get("new") !== "lead" || !canCreateLeads) return;

    const cleanParams = new URLSearchParams(searchParams.toString());
    cleanParams.delete("new");
    const cleanSearch = cleanParams.toString();

    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setIsCreateDialogOpen(true);
      router.replace(`/crm/contacts${cleanSearch ? `?${cleanSearch}` : ""}`);
    });

    return () => {
      isActive = false;
    };
  }, [canCreateLeads, searchParams, router]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftPressed(true);
      }
    };
    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Shift") {
        setShiftPressed(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [sortBy, setSortBy] = useState<ContactListFilters["sortBy"]>("created_at");
  const [sortDir, setSortDir] = useState<ContactListFilters["sortDir"]>("desc");

  const PAGE_SIZE_OPTIONS = [5, 10, 30, 50, 100];

  const deferredSearch = useDeferredValue(search);
  const dateRange = sharedFilters.dateRange;
  const effectiveDealStatus = lostLeadsView ? "lost" : selectedDealStatus;

  const filters: ContactListFilters = {
    search: deferredSearch || undefined,
    teamId: sharedFilters.teamId || undefined,
    pipelineId: selectedPipeline !== "all" ? selectedPipeline : undefined,
    stageId: selectedStage !== "all" ? selectedStage : undefined,
    assigneeId:
      selectedAssignee && selectedAssignee !== "all" && selectedAssignee !== "unassigned" ? selectedAssignee : undefined,
    unassigned: selectedAssignee === "unassigned",
    tagId: selectedTag && selectedTag !== "all" ? selectedTag : undefined,
    source: selectedSource && selectedSource !== "all" ? selectedSource : undefined,
    campaignId: campaignId || undefined,
    adSetId: adSetId || undefined,
    adId: adId || undefined,
    dealStatus:
      effectiveDealStatus && effectiveDealStatus !== "all"
        ? (effectiveDealStatus as "open" | "won" | "lost")
        : undefined,
    createdFrom: dateRange ? dateRange.from.toISOString() : undefined,
    createdTo: dateRange ? dateRange.to.toISOString() : undefined,
    sortBy,
    sortDir,
    page,
    limit: pageSize,
  };

  const {
    data: contacts = [],
    isLoading,
    isFetching: isFetchingContacts,
    isError: contactsError,
    error: contactsQueryError,
    isPlaceholderData: contactsPlaceholderData,
    refetch: refetchContacts,
  } = useContactsList(filters);
  const { data: stages = [] } = useStages(selectedPipeline !== "all" ? selectedPipeline : undefined);
  const { data: users = [] } = useOrganizationUsers();
  const { data: tags = [] } = useTags();

  const { data: selectedLead, isFetching: isFetchingSelectedLead } = useLead(selectedContactId);
  const deleteLead = useDeleteLead();

  const totalCount = contacts[0]?.total_count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const isOpeningLeadDetails = Boolean(selectedContactId && !selectedLead && isFetchingSelectedLead);
  const isInitialContactsLoading = isLoading && contacts.length === 0;
  const isContactsTransitioning = isInitialContactsLoading || contactsPlaceholderData;
  const isContactsRetrying = contactsError && !isContactsTransitioning && !isFetchingContacts;
  const showContactsErrorState = contactsError && contacts.length === 0 && !isContactsTransitioning;
  const contactsErrorMessage = getErrorMessage(contactsQueryError, "Tente novamente em instantes.");

  useEffect(() => {
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setPageInputValue(String(page));
    });
    return () => {
      isActive = false;
    };
  }, [page]);

  useEffect(() => {
    if (contactsPlaceholderData || isFetchingContacts || totalPages === 0 || page <= totalPages) return;
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setPage(totalPages);
    });
    return () => {
      isActive = false;
    };
  }, [contactsPlaceholderData, isFetchingContacts, page, totalPages]);

  useEffect(() => {
    if (!contactsError) return;

    const retryTimer = window.setTimeout(() => {
      void refetchContacts();
    }, 2500);

    return () => window.clearTimeout(retryTimer);
  }, [contactsError, refetchContacts]);

  const sourceLabels: Record<string, string> = {
    manual: "Manual",
    meta: "Meta Ads",
    site: "Site",
  };

  const dealStatusConfig = {
    open: { label: "Aberto", icon: CircleDot, className: "bg-[var(--app-surface-soft)] text-muted-foreground" },
    won: {
      label: "Ganho",
      icon: Trophy,
      className: "bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]",
    },
    lost: {
      label: "Perdido",
      icon: XCircle,
      className: "bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]",
    },
  };

  const handleClearFilters = () => {
    clearFilters();
    setSelectedPipeline("all");
    setSelectedStage("all");
    setLostLeadsView(false);
    setPage(1);
  };

  const handleExport = async () => {
    if (!canExportLeads) return;
    setIsExporting(true);

    try {
      const { exportContactsFiltered } = await import("@/lib/export-contacts");
      const count = await exportContactsFiltered({
        filters: {
          search: deferredSearch || undefined,
          teamId: sharedFilters.teamId || undefined,
          pipelineId: selectedPipeline !== "all" ? selectedPipeline : undefined,
          stageId: selectedStage !== "all" ? selectedStage : undefined,
          assigneeId:
            selectedAssignee && selectedAssignee !== "all" && selectedAssignee !== "unassigned"
              ? selectedAssignee
              : undefined,
          unassigned: selectedAssignee === "unassigned",
          tagId: selectedTag && selectedTag !== "all" ? selectedTag : undefined,
          source: selectedSource && selectedSource !== "all" ? selectedSource : undefined,
          campaignId: campaignId || undefined,
          adSetId: adSetId || undefined,
          adId: adId || undefined,
          dealStatus: effectiveDealStatus && effectiveDealStatus !== "all" ? effectiveDealStatus : undefined,
          createdFrom: dateRange ? dateRange.from.toISOString() : undefined,
          createdTo: dateRange ? dateRange.to.toISOString() : undefined,
        },
        organizationId,
        filename: `leads-${format(new Date(), "yyyy-MM-dd")}`,
        exportFormat: "csv",
      });

      toast({
        title: "Exportação concluída",
        description: `${count} leads exportados com sucesso`,
      });
    } catch (error: unknown) {
      toast({
        title: "Erro na exportação",
        description: getErrorMessage(error, "Não foi possível exportar os contatos"),
        variant: "destructive",
      });
    } finally {
      setIsExporting(false);
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelectAll = () => {
    if (!canDeleteLeads) return;
    if (selectedIds.size === contacts.length && contacts.length > 0) {
      clearSelection();
    } else {
      setSelectedIds(new Set(contacts.map((contact) => contact.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    if (!canDeleteLeads) return;
    const newSet = new Set(selectedIds);

    if (shiftPressed && lastSelectedId) {
      const lastIdx = contacts.findIndex((c) => c.id === lastSelectedId);
      const currentIdx = contacts.findIndex((c) => c.id === id);

      if (lastIdx !== -1 && currentIdx !== -1) {
        const start = Math.min(lastIdx, currentIdx);
        const end = Math.max(lastIdx, currentIdx);

        const shouldSelect = selectedIds.has(lastSelectedId);

        for (let i = start; i <= end; i++) {
          const contactId = contacts[i].id;
          if (shouldSelect) {
            newSet.add(contactId);
          } else {
            newSet.delete(contactId);
          }
        }
      }
    } else {
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
    }

    setSelectedIds(newSet);
    setLastSelectedId(id);
  };

  const handleBulkDelete = async () => {
    if (!canDeleteLeads) return;
    for (const id of selectedIds) {
      await deleteLead.mutateAsync(id);
    }

    clearSelection();
    setBulkDeleteDialogOpen(false);
  };

  const hasActiveFilters =
    hasSharedActiveFilters ||
    selectedPipeline !== "all" ||
    selectedStage !== "all" ||
    lostLeadsView;

  const handleSort = (column: ContactListFilters["sortBy"]) => {
    if (sortBy === column) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSortDir("desc");
    }

    setPage(1);
  };

  const handleToggleLostLeadsView = () => {
    setLostLeadsView((current) => !current);
    setPage(1);
  };

  const handleFilterChange =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setter(value);
      setPage(1);
    };

  return (
    <AppLayout title="Contatos">
      <div className="space-y-6 animate-in relative">
        {isMobile ? (
          <div className="app-toolbar flex flex-col gap-2 p-2">
            <div className="flex min-w-0 items-center gap-2">
              <div data-tour="contacts-filters" className="min-w-0 flex-1">
                <SharedFilters
                  datePreset={datePreset}
                  onDatePresetChange={handleFilterChange(setDatePreset)}
                  customDateRange={customDateRange}
                  onCustomDateRangeChange={handleFilterChange(setCustomDateRange)}
                  teamId={sharedFilters.teamId}
                  onTeamChange={handleFilterChange(setTeamId)}
                  userId={selectedAssignee}
                  onUserChange={handleFilterChange(setSelectedAssignee)}
                  source={selectedSource}
                  onSourceChange={handleFilterChange(setSelectedSource)}
                  campaignId={sharedFilters.campaignId}
                  onCampaignChange={handleFilterChange(setCampaignId)}
                  adSetId={sharedFilters.adSetId}
                  onAdSetChange={handleFilterChange(setAdSetId)}
                  adId={sharedFilters.adId}
                  onAdChange={handleFilterChange(setAdId)}
                  tagId={selectedTag}
                  onTagChange={handleFilterChange(setSelectedTag)}
                  dealStatus={effectiveDealStatus}
                  onDealStatusChange={(value) => {
                    setLostLeadsView(false);
                    handleFilterChange(setSelectedDealStatus)(value);
                  }}
                  searchQuery={search}
                  onSearchChange={(value) => {
                    setSearch(value);
                    setPage(1);
                  }}
                  onClear={handleClearFilters}
                  hasActiveFilters={hasSharedActiveFilters || selectedPipeline !== "all" || selectedStage !== "all" || lostLeadsView}
                  dynamicSources={dynamicSources}
                  campaigns={campaigns}
                  adSets={adSets}
                  ads={ads}
                  tags={allTagsFromHook}
                  isLoadingSources={isLoadingSources}
                  isLoadingCampaigns={isLoadingCampaigns}
                  isLoadingAdSets={isLoadingAdSets}
                  isLoadingAds={isLoadingAds}
                  datePosition="end"
                  loadDynamicOptions={shouldLoadFilterOptions}
                  onFiltersOpenChange={(open) => {
                    if (open) setShouldLoadFilterOptions(true);
                  }}
                  tourPrefix="contacts"
                />
              </div>

              {canCreateLeads && <Button
                data-tour="contacts-new"
                size="sm"
                onClick={() => setIsCreateDialogOpen(true)}
                className="h-9 shrink-0 gap-1.5 px-3 font-medium"
                title="Novo Lead"
              >
                <Plus className="h-4 w-4" />
                <span>Novo</span>
              </Button>}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <LeadCountBadge
                isLoading={isLoading || contactsPlaceholderData}
                totalCount={totalCount}
                className="justify-center px-2 text-xs"
              />

              {(canImportLeads || canExportLeads) && <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button data-tour="contacts-import" variant="outline" size="icon" className="h-9 w-9 shrink-0 border-0 bg-[var(--app-surface-soft)] shadow-none hover:bg-[var(--app-surface-hover)]">
                    <Upload className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent data-tour="contacts-import-menu" align="end" className="w-48">
                  {canImportLeads && <DropdownMenuItem data-tour="contacts-import-action" onClick={() => setImportDialogOpen(true)} className="py-2.5">
                    <Upload className="h-4 w-4 mr-2 text-primary" />
                    Importar CSV/Excel
                  </DropdownMenuItem>}
                  {canExportLeads && <DropdownMenuItem data-tour="contacts-export-action" onClick={handleExport} disabled={isExporting || totalCount === 0} className="py-2.5">
                    <Download className="h-4 w-4 mr-2 text-primary" />
                    {isExporting ? "Exportando..." : "Exportar"}
                  </DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>}
            </div>
          </div>
        ) : (
          <div className="app-toolbar overflow-hidden px-3 py-1.5">
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2">
                <LeadCountBadge isLoading={isLoading || contactsPlaceholderData} totalCount={totalCount} />

                {(canImportLeads || canExportLeads) && <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button data-tour="contacts-import" variant="outline" size="sm" className="h-9 gap-2 border-0 bg-[var(--app-surface-soft)] font-medium shadow-none hover:bg-[var(--app-surface-hover)]">
                      <Upload className="h-4 w-4" />
                      <span className="hidden xl:inline">Importar / Exportar</span>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent data-tour="contacts-import-menu" align="end" className="w-48">
                    {canImportLeads && <DropdownMenuItem data-tour="contacts-import-action" onClick={() => setImportDialogOpen(true)} className="py-2.5">
                      <Upload className="h-4 w-4 mr-2 text-primary" />
                      Importar CSV/Excel
                    </DropdownMenuItem>}
                    {canExportLeads && <DropdownMenuItem
                      data-tour="contacts-export-action"
                      onClick={handleExport}
                      disabled={isExporting || totalCount === 0}
                      className="py-2.5"
                    >
                      <Download className="h-4 w-4 mr-2 text-primary" />
                      {isExporting ? "Exportando..." : "Exportar"}
                    </DropdownMenuItem>}
                  </DropdownMenuContent>
                </DropdownMenu>}

              </div>

              <div className="contacts-toolbar-actions flex min-w-0 items-center justify-end gap-2">
                <div data-tour="contacts-filters" className="contacts-period-first">
                  <SharedFilters
                    datePreset={datePreset || "last30days"}
                    onDatePresetChange={handleFilterChange(setDatePreset)}
                    customDateRange={customDateRange}
                    onCustomDateRangeChange={handleFilterChange(setCustomDateRange)}
                    teamId={sharedFilters.teamId}
                    onTeamChange={handleFilterChange(setTeamId)}
                    userId={selectedAssignee}
                    onUserChange={handleFilterChange(setSelectedAssignee)}
                    source={selectedSource}
                    onSourceChange={handleFilterChange(setSelectedSource)}
                    campaignId={sharedFilters.campaignId}
                    onCampaignChange={handleFilterChange(setCampaignId)}
                    adSetId={sharedFilters.adSetId}
                    onAdSetChange={handleFilterChange(setAdSetId)}
                    adId={sharedFilters.adId}
                    onAdChange={handleFilterChange(setAdId)}
                    tagId={selectedTag}
                    onTagChange={handleFilterChange(setSelectedTag)}
                    dealStatus={effectiveDealStatus}
                    onDealStatusChange={(value) => {
                      setLostLeadsView(false);
                      handleFilterChange(setSelectedDealStatus)(value);
                    }}
                    searchQuery={search}
                    onSearchChange={(value) => {
                      setSearch(value);
                      setPage(1);
                    }}
                    onClear={handleClearFilters}
                    hasActiveFilters={hasSharedActiveFilters || selectedPipeline !== "all" || selectedStage !== "all" || lostLeadsView}
                    dynamicSources={dynamicSources}
                    campaigns={campaigns}
                    adSets={adSets}
                    ads={ads}
                    tags={allTagsFromHook}
                    isLoadingSources={isLoadingSources}
                    isLoadingCampaigns={isLoadingCampaigns}
                    isLoadingAdSets={isLoadingAdSets}
                    isLoadingAds={isLoadingAds}
                    datePosition="end"
                    loadDynamicOptions={shouldLoadFilterOptions}
                    onFiltersOpenChange={(open) => {
                      if (open) setShouldLoadFilterOptions(true);
                    }}
                    tourPrefix="contacts"
                  />
                </div>

                {canCreateLeads && <Button
                  data-tour="contacts-new"
                  size="sm"
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="h-9 gap-2 font-medium bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-4 w-4" />
                  <span>Novo Lead</span>
                </Button>}
              </div>
            </div>
          </div>
        )}

        {lostLeadsView && (
          <div className="rounded-lg border border-red-500/15 bg-red-500/10 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-red-500 text-white">
                  <XCircle className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">Leads perdidos</h2>
                  <p className="text-xs text-muted-foreground">
                    Listando leads marcados como perdidos e o motivo informado na perda.
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={handleToggleLostLeadsView} className="h-8 text-xs">
                Ver todos os leads
              </Button>
            </div>
          </div>
        )}

        <Card data-tour="contacts-list" className="app-card contacts-table-card relative overflow-hidden">
          {isContactsTransitioning && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70 backdrop-blur-[2px]">
              <div className="flex items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-4 py-3 text-xs font-extralight tracking-wide text-[var(--app-text-primary)] shadow-[0_18px_40px_rgb(0_0_0_/_0.18)]">
                <Loader2 className="h-4 w-4 animate-spin text-[#FF4529]" />
                <span>Carregando contatos...</span>
              </div>
            </div>
          )}

          {isContactsRetrying && contacts.length > 0 && (
            <div className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-[8px] bg-amber-500/12 px-3 py-2 text-[11px] font-extralight tracking-wide text-amber-700 ring-1 ring-amber-500/25 dark:text-amber-200">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              <span>API demorou. Tentando carregar contatos novamente...</span>
            </div>
          )}

          {isMobile ? (
            <div>
              {showContactsErrorState ? (
                <ContactsErrorState
                  message={contactsErrorMessage}
                  onRetry={() => void refetchContacts()}
                  isRetrying={isFetchingContacts}
                />
              ) : isLoading ? (
                <div className="divide-y divide-white/[0.045]">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="p-4 space-y-3 animate-pulse">
                      <div className="flex justify-between">
                        <div className="space-y-2 flex-1">
                          <div className="h-4 w-32 bg-white/[0.06] rounded" />
                          <div className="h-3 w-24 bg-white/[0.06] rounded" />
                        </div>
                        <div className="h-8 w-8 bg-white/[0.06] rounded" />
                      </div>
                      <div className="flex gap-2">
                        <div className="h-6 w-20 bg-white/[0.06] rounded-full" />
                        <div className="h-6 w-16 bg-white/[0.06] rounded-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : contacts.length === 0 ? (
                <EmptyState
                  hasActiveFilters={!!hasActiveFilters}
                  onImport={canImportLeads ? () => setImportDialogOpen(true) : undefined}
                  onCreate={canCreateLeads ? () => setIsCreateDialogOpen(true) : undefined}
                  onClearFilters={handleClearFilters}
                />
              ) : (
                <div className="divide-y divide-white/[0.045]">
                  {contacts.map((contact: Contact) => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      sourceLabels={sourceLabels}
                      onViewDetails={() => openLeadDetails(contact.id)}
                      onDelete={canDeleteLeads ? () => setDeleteContactId(contact.id) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              {showContactsErrorState ? (
                <ContactsErrorState
                  message={contactsErrorMessage}
                  onRetry={() => void refetchContacts()}
                  isRetrying={isFetchingContacts}
                />
              ) : isLoading ? (
                <Table className="app-data-table">
                  <TableSkeleton />
                </Table>
              ) : contacts.length === 0 ? (
                <EmptyState
                  hasActiveFilters={!!hasActiveFilters}
                  onImport={canImportLeads ? () => setImportDialogOpen(true) : undefined}
                  onCreate={canCreateLeads ? () => setIsCreateDialogOpen(true) : undefined}
                  onClearFilters={handleClearFilters}
                />
              ) : (
                <Table className="contacts-table">
                  <TableHeader>
                    <TableRow className="border-b border-[var(--app-border-strong)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-soft)]">
                      {canDeleteLeads && (
                        <TableHead className="w-10">
                          <Checkbox
                            data-tour="contacts-select-all"
                            checked={selectedIds.size === contacts.length && contacts.length > 0}
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      )}
                      <TableHead className="cursor-pointer hover:bg-[var(--app-surface-hover)]" onClick={() => handleSort("name")}>
                        <div className="flex items-center">
                          Nome <SortIcon column="name" sortBy={sortBy} sortDir={sortDir} />
                        </div>
                      </TableHead>
                      <TableHead>Contato</TableHead>
                      <TableHead>{lostLeadsView ? "Motivo da perda" : "Status"}</TableHead>
                      <TableHead>Pipeline / Estágio</TableHead>
                      <TableHead className="w-14 text-center">Resp.</TableHead>
                      <TableHead className="hidden 2xl:table-cell">Tags</TableHead>
                      <TableHead className="cursor-pointer hover:bg-[var(--app-surface-hover)]" onClick={() => handleSort("created_at")}>
                        <div className="flex items-center">
                          Criado em <SortIcon column="created_at" sortBy={sortBy} sortDir={sortDir} />
                        </div>
                      </TableHead>
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {contacts.map((contact: Contact) => {
                      const isLost = contact.deal_status === "lost";
                      const isWon = contact.deal_status === "won";
                      const status: keyof typeof dealStatusConfig =
                        contact.deal_status === "won" || contact.deal_status === "lost"
                          ? contact.deal_status
                          : "open";
                      const StatusIcon = dealStatusConfig[status]?.icon || CircleDot;

                      return (
                        <TableRow
                          key={contact.id}
                          className={cn(
                            "cursor-pointer border-b border-[var(--app-border-strong)] hover:bg-[var(--app-surface-hover)] last:border-b-0",
                            isLost && "bg-[var(--lead-status-lost-card)] hover:bg-[var(--lead-status-lost-card-hover)]",
                            isWon &&
                              "bg-[var(--lead-status-won-card)] hover:bg-[var(--lead-status-won-card-hover)]",
                          )}
                          onClick={() => openLeadDetails(contact.id)}
                        >
                          {canDeleteLeads && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedIds.has(contact.id)}
                                onCheckedChange={() => toggleSelectOne(contact.id)}
                              />
                            </TableCell>
                          )}

                          <TableCell>
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9">
                                <AvatarImage src={contact.whatsapp_avatar_url || undefined} alt={contact.name} />
                                <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                  {getInitials(contact.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-medium text-foreground">{contact.name}</p>
                                  <ReentryBadge count={contact.reentry_count} lastEntryAt={contact.last_entry_at} />
                                </div>
                                {contact.source && (
                                  <p className="text-xs text-muted-foreground">
                                    {sourceLabels[contact.source] || contact.source}
                                  </p>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell>
                            <div className="space-y-1">
                              {contact.phone && (
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Phone className="h-3 w-3" />
                                  {contact.phone}
                                </div>
                              )}
                              {contact.email && (
                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                  <Mail className="h-3 w-3" />
                                  {contact.email}
                                </div>
                              )}
                            </div>
                          </TableCell>

                          <TableCell onClick={() => openLeadDetails(contact.id)}>
                            {lostLeadsView ? (
                              <p
                                className="max-w-[260px] text-sm font-medium text-red-700 dark:text-red-300"
                                title={contact.lost_reason || undefined}
                              >
                                {contact.lost_reason || "Motivo não informado"}
                              </p>
                            ) : (
                              <div className="space-y-1">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "gap-1 rounded-md border-0 px-2 py-0.5 text-xs font-medium whitespace-nowrap",
                                    dealStatusConfig[status]?.className,
                                  )}
                                >
                                  <StatusIcon className="h-3 w-3" />
                                  {dealStatusConfig[status]?.label}
                                </Badge>
                                {isLost && contact.lost_reason && (
                                  <p
                                    className="text-xs text-red-600 dark:text-red-400 max-w-[150px] truncate"
                                    title={contact.lost_reason}
                                  >
                                    {contact.lost_reason}
                                  </p>
                                )}
                              </div>
                            )}
                          </TableCell>

                          <TableCell onClick={() => openLeadDetails(contact.id)}>
                            <div className="space-y-1">
                              {contact.stage_name && (
                                <Badge
                                  variant="secondary"
                                  className="max-w-[150px] justify-center truncate rounded-md border-0 bg-[var(--app-surface-soft)] px-2 py-0.5 text-xs font-medium text-[var(--app-text-primary)] whitespace-nowrap"
                                  title={contact.stage_name}
                                >
                                  {contact.stage_name}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="w-14" onClick={() => openLeadDetails(contact.id)}>
                            <AssigneeAvatarCell name={contact.assignee_name} avatarUrl={contact.assignee_avatar} />
                          </TableCell>

                          <TableCell className="hidden 2xl:table-cell" onClick={() => openLeadDetails(contact.id)}>
                            <div className="flex flex-wrap gap-1">
                              {contact.tags?.slice(0, 2).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  variant="secondary"
                                  className="text-[10px] px-1.5"
                                  style={{
                                    backgroundColor: tag.color,
                                    color: "#FFFFFF",
                                    borderColor: tag.color,
                                  }}
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                              {contact.tags && contact.tags.length > 2 && (
                                <Badge variant="secondary" className="text-[10px] px-1.5">
                                  +{contact.tags.length - 2}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell onClick={() => openLeadDetails(contact.id)}>
                            <p className="whitespace-nowrap text-sm text-[var(--app-text-primary)]">
                              {format(new Date(contact.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                            </p>
                          </TableCell>

                          <TableCell onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => openLeadDetails(contact.id)}>
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  Ver detalhes
                                </DropdownMenuItem>
                                {contact.phone && (
                                  <DropdownMenuItem asChild>
                                    <a
                                      href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <MessageCircle className="h-4 w-4 mr-2" />
                                      WhatsApp
                                    </a>
                                  </DropdownMenuItem>
                                )}
                                {canDeleteLeads && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      className="text-destructive focus:text-destructive"
                                      onClick={() => setDeleteContactId(contact.id)}
                                    >
                                      <Trash2 className="h-4 w-4 mr-2" />
                                      Excluir
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </div>
          )}
        </Card>

        {canDeleteLeads && selectedIds.size > 0 && (
          <div className="app-card fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 p-3 shadow-lg">
            <span className="text-sm font-medium">{selectedIds.size} selecionado(s)</span>
            <Button variant="destructive" size="sm" onClick={() => setBulkDeleteDialogOpen(true)}>
              <Trash2 className="h-4 w-4 mr-1" />
              Excluir
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              Cancelar
            </Button>
          </div>
        )}

        {(totalPages > 1 || totalCount > 0) && (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-muted-foreground">
                Página {page} de {totalPages || 1}
              </p>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                  <SelectTrigger className="h-8 w-[100px] border-white/[0.055] bg-white/[0.035]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <SelectItem key={size} value={String(size)}>
                      {size} por pág
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1 mx-2">
                <Input
                  type="text"
                  value={pageInputValue}
                  onChange={(e) => setPageInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const pageNumber = parseInt(pageInputValue);

                      if (!isNaN(pageNumber) && pageNumber >= 1 && pageNumber <= totalPages) {
                        setPage(pageNumber);
                      } else {
                        setPageInputValue(String(page));
                      }
                    }
                  }}
                  onBlur={() => {
                    const pageNumber = parseInt(pageInputValue);

                    if (!isNaN(pageNumber) && pageNumber >= 1 && pageNumber <= totalPages) {
                      setPage(pageNumber);
                    } else {
                      setPageInputValue(String(page));
                    }
                  }}
                  className="h-8 w-12 border-white/[0.055] bg-white/[0.035] p-1 text-center"
                />
                <span className="text-sm text-muted-foreground">/ {totalPages}</span>
              </div>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage((currentPage) => Math.min(totalPages, currentPage + 1))}
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {isOpeningLeadDetails && (
          <div className="fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs font-medium text-[var(--app-text-secondary)] shadow-[0_14px_40px_rgba(0,0,0,0.18)]">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            Abrindo lead...
          </div>
        )}

        {selectedLead && (
          <LeadDetailDialog
            lead={selectedLead}
            stages={stages}
            onClose={() => setSelectedContactId(null)}
            allTags={tags}
            allUsers={users}
            refetchStages={() => {}}
          />
        )}

        {canCreateLeads && <CreateLeadDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen} />}

        <AlertDialog open={canDeleteLeads && !!deleteContactId} onOpenChange={(open) => !open && setDeleteContactId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir contato</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este contato? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                onClick={async () => {
                  if (canDeleteLeads && deleteContactId) {
                    await deleteLead.mutateAsync(deleteContactId);
                    setDeleteContactId(null);
                  }
                }}
              >
                Excluir
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog open={canDeleteLeads && bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {selectedIds.size} contatos</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir {selectedIds.size} contatos selecionados? Esta ação não pode ser
                desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={handleBulkDelete}>
                Excluir {selectedIds.size} contatos
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {canImportLeads && <ImportContactsDialog open={importDialogOpen} onOpenChange={setImportDialogOpen} />}
      </div>
    </AppLayout>
  );
}
