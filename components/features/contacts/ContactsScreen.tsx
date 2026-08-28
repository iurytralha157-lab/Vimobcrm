"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Table,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableBody,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Users,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { useIsMobile } from "@/hooks/use-mobile";
import { ContactCard } from "@/components/features/contacts/ContactCard";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useOrganizationUsers } from "@/hooks/use-users";
import { useTags } from "@/hooks/use-tags";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";
import { TableSkeleton } from "@/components/features/contacts/TableSkeleton";
import { EmptyState } from "@/components/features/contacts/EmptyState";
import {
  useContactsList,
  type Contact,
  type ContactListFilters,
} from "@/hooks/use-contacts-list";
import {
  useLead,
  useDeleteLead,
  useBulkDeleteLeads,
  type Lead,
} from "@/hooks/use-leads";
import { ReentryBadge } from "@/components/features/leads/ReentryBadge";
import { useToast } from "@/hooks/use-toast";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { useAuth } from "@/contexts/AuthContext";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useFilterOptionsPipelineId } from "@/hooks/use-filter-options-pipeline-id";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

function DeferredSurfaceLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
    >
      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
      Preparando formulário...
    </div>
  );
}

const LeadDetailDialog = dynamic(
  () =>
    import("@/components/features/leads/LeadDetailDialog").then(
      (module) => module.LeadDetailDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

const CreateLeadDialog = dynamic(
  () =>
    import("@/components/features/leads/CreateLeadDialog").then(
      (module) => module.CreateLeadDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

const ImportContactsDialog = dynamic(
  () =>
    import("@/components/features/contacts/ImportContactsDialog").then(
      (module) => module.ImportContactsDialog,
    ),
  { loading: DeferredSurfaceLoading },
);

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

function getTagForegroundClass(backgroundColor: string) {
  const match = backgroundColor
    .trim()
    .match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i);
  if (!match) return "text-white";

  const value =
    match[1].length === 3
      ? match[1]
          .split("")
          .map((character) => character + character)
          .join("")
      : match[1].slice(0, 6);
  const channels = [0, 2, 4].map(
    (offset) => Number.parseInt(value.slice(offset, offset + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4,
  );
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;

  return luminance > 0.179 ? "text-slate-950" : "text-white";
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
  if (sortBy !== column)
    return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;

  return sortDir === "asc" ? (
    <ArrowUp className="h-3 w-3 ml-1" />
  ) : (
    <ArrowDown className="h-3 w-3 ml-1" />
  );
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
        "flex h-8 shrink-0 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)]",
        className,
      )}
      aria-label="Total de contatos filtrados"
    >
      <span className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
        <Users className="h-3 w-3" aria-hidden="true" />
      </span>
      <span className="text-[var(--app-text-primary)]">
        {isLoading ? "..." : totalCount.toLocaleString("pt-BR")}
      </span>
      <span>contatos</span>
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
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 py-8 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-destructive/15 text-destructive">
        <AlertTriangle className="h-4 w-4" />
      </div>
      <div className="mt-3 space-y-1">
        <h3 className="text-[14px] font-medium text-[var(--app-text-primary)]">
          Não foi possível carregar os contatos
        </h3>
        <p className="max-w-[420px] text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
          {message}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onRetry}
        disabled={isRetrying}
        className="mt-3 h-8 gap-2 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
      >
        <RefreshCw
          className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
        />
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
          <div className="flex w-10 justify-center">
            {name ? (
              <Avatar className="h-7 w-7 rounded-[6px] [&_img]:rounded-[6px]">
                <AvatarImage src={avatarUrl || undefined} alt={name} />
                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[10px] font-light text-primary-foreground">
                  {getInitials(name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[10px] font-light text-[var(--app-text-tertiary)]">
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
  const filterOptionsPipelineId = useFilterOptionsPipelineId(
    selectedPipeline !== "all" ? selectedPipeline : null,
  );
  const { data: pipelines = [] } = usePipelines();

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
    pipelineId:
      selectedPipeline !== "all" ? selectedPipeline : filterOptionsPipelineId,
  });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [pageInputValue, setPageInputValue] = useState("1");
  const [isExporting, setIsExporting] = useState(false);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [lostLeadsView, setLostLeadsView] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);
  const [shiftPressed, setShiftPressed] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const openLeadDetails = (contactId: string) =>
    setSelectedContactId(contactId);

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
  const [sortBy, setSortBy] =
    useState<ContactListFilters["sortBy"]>("created_at");
  const [sortDir, setSortDir] = useState<ContactListFilters["sortDir"]>("desc");

  const PAGE_SIZE_OPTIONS = [5, 10, 30, 50, 100];

  const normalizedSearch = search.trim();
  const deferredSearch = useDebouncedValue(normalizedSearch, 300);
  const isSearchSettling = normalizedSearch !== deferredSearch;
  const dateRange = sharedFilters.dateRange;
  const effectiveDealStatus = lostLeadsView ? "lost" : selectedDealStatus;

  const filters: ContactListFilters = {
    search: deferredSearch || undefined,
    teamId: sharedFilters.teamId || undefined,
    pipelineId: selectedPipeline !== "all" ? selectedPipeline : undefined,
    stageId: selectedStage !== "all" ? selectedStage : undefined,
    assigneeId:
      selectedAssignee &&
      selectedAssignee !== "all" &&
      selectedAssignee !== "unassigned"
        ? selectedAssignee
        : undefined,
    unassigned: selectedAssignee === "unassigned",
    tagId: selectedTag && selectedTag !== "all" ? selectedTag : undefined,
    source:
      selectedSource && selectedSource !== "all" ? selectedSource : undefined,
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
    mode: "compact",
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
  const {
    data: selectedLead,
    isFetching: isFetchingSelectedLead,
    isError: isSelectedLeadError,
    error: selectedLeadError,
    refetch: refetchSelectedLead,
  } = useLead(selectedContactId);
  const filterPipelineId =
    selectedPipeline !== "all" ? selectedPipeline : undefined;
  const { data: filterStages = [] } = useStages(filterPipelineId);
  const detailPipelineId = selectedLead?.pipeline_id || undefined;
  const { data: stages = [], refetch: refetchStages } = useStages(
    detailPipelineId || undefined,
  );
  const shouldLoadDetailReferences = Boolean(selectedContactId || editingLead);
  const { data: users = [] } = useOrganizationUsers({
    enabled: shouldLoadDetailReferences,
  });
  const { data: tags = [] } = useTags({
    enabled: shouldLoadDetailReferences,
  });
  const deleteLead = useDeleteLead();
  const bulkDeleteLeads = useBulkDeleteLeads();

  const totalCount = contacts[0]?.total_count || 0;
  const totalPages = Math.ceil(totalCount / pageSize);
  const isOpeningLeadDetails = Boolean(
    selectedContactId && !selectedLead && isFetchingSelectedLead,
  );
  const showLeadDetailError = Boolean(
    selectedContactId && !selectedLead && isSelectedLeadError,
  );
  const isInitialContactsLoading = isLoading && contacts.length === 0;
  const isContactsTransitioning =
    isInitialContactsLoading || contactsPlaceholderData || isSearchSettling;
  const showContactsRefreshError =
    contactsError && contacts.length > 0 && !isContactsTransitioning;
  const showContactsErrorState =
    contactsError && contacts.length === 0 && !isContactsTransitioning;
  const contactsErrorMessage = getErrorMessage(
    contactsQueryError,
    "Tente novamente em instantes.",
  );

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
    if (
      contactsPlaceholderData ||
      isFetchingContacts ||
      totalPages === 0 ||
      page <= totalPages
    )
      return;
    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setPage(totalPages);
    });
    return () => {
      isActive = false;
    };
  }, [contactsPlaceholderData, isFetchingContacts, page, totalPages]);

  const sourceLabels: Record<string, string> = {
    manual: "Manual",
    meta: "Meta Ads",
    site: "Site",
  };

  const dealStatusConfig = {
    open: {
      label: "Aberto",
      icon: CircleDot,
      className: "bg-[var(--app-surface-soft)] text-muted-foreground",
    },
    won: {
      label: "Ganho",
      icon: Trophy,
      className:
        "bg-[var(--lead-status-won-bg)] text-[var(--lead-status-won-fg)]",
    },
    lost: {
      label: "Perdido",
      icon: XCircle,
      className:
        "bg-[var(--lead-status-lost-bg)] text-[var(--lead-status-lost-fg)]",
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
            selectedAssignee &&
            selectedAssignee !== "all" &&
            selectedAssignee !== "unassigned"
              ? selectedAssignee
              : undefined,
          unassigned: selectedAssignee === "unassigned",
          tagId: selectedTag && selectedTag !== "all" ? selectedTag : undefined,
          source:
            selectedSource && selectedSource !== "all"
              ? selectedSource
              : undefined,
          campaignId: campaignId || undefined,
          adSetId: adSetId || undefined,
          adId: adId || undefined,
          dealStatus:
            effectiveDealStatus && effectiveDealStatus !== "all"
              ? effectiveDealStatus
              : undefined,
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
        description: getErrorMessage(
          error,
          "Não foi possível exportar os contatos",
        ),
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
    if (!canDeleteLeads || bulkDeleteLeads.isPending) return;

    try {
      const result = await bulkDeleteLeads.mutateAsync(Array.from(selectedIds));
      setSelectedIds(new Set(result.failures.map(({ id }) => id)));
      setBulkDeleteDialogOpen(false);

      if (result.deletedIds.length > 0) {
        toast({
          title: "Contatos excluídos",
          description: `${result.deletedIds.length} contato(s) excluído(s) com sucesso.`,
        });
      }
      if (result.failures.length > 0) {
        toast({
          title: "Alguns contatos não foram excluídos",
          description: `${result.failures.length} contato(s) permaneceram selecionados para você tentar novamente.`,
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Não foi possível excluir os contatos",
        description: getErrorMessage(error, "Tente novamente em instantes."),
        variant: "destructive",
      });
    }
  };

  const handleDeleteContact = async () => {
    if (!canDeleteLeads || !deleteContactId || deleteLead.isPending) return;

    try {
      await deleteLead.mutateAsync(deleteContactId);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(deleteContactId);
        return next;
      });
      setDeleteContactId(null);
    } catch {
      // useDeleteLead already presents the actionable error message and the
      // controlled dialog remains open so the user can retry or cancel.
    }
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
      <div className="relative min-w-0 space-y-3 animate-in">
        {isMobile ? (
          <div className="app-toolbar flex flex-col gap-2 p-2">
            <div className="flex min-w-0 items-center gap-2">
              <div data-tour="contacts-filters" className="min-w-0 flex-1">
                <SharedFilters
                  datePreset={datePreset}
                  onDatePresetChange={handleFilterChange(setDatePreset)}
                  customDateRange={customDateRange}
                  onCustomDateRangeChange={handleFilterChange(
                    setCustomDateRange,
                  )}
                  teamId={sharedFilters.teamId}
                  onTeamChange={handleFilterChange(setTeamId)}
                  userId={selectedAssignee}
                  onUserChange={handleFilterChange(setSelectedAssignee)}
                  pipelineId={filterPipelineId || null}
                  onPipelineChange={(value) => {
                    setSelectedPipeline(value || "all");
                    setSelectedStage("all");
                    setPage(1);
                  }}
                  pipelines={pipelines}
                  stageId={selectedStage !== "all" ? selectedStage : null}
                  onStageChange={(value) => {
                    setSelectedStage(value || "all");
                    setPage(1);
                  }}
                  stages={filterStages}
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
                  hasActiveFilters={
                    hasSharedActiveFilters ||
                    selectedPipeline !== "all" ||
                    selectedStage !== "all" ||
                    lostLeadsView
                  }
                  dynamicSources={dynamicSources}
                  campaigns={campaigns}
                  adSets={adSets}
                  ads={ads}
                  tags={allTagsFromHook}
                  isLoadingSources={isLoadingSources}
                  isLoadingCampaigns={isLoadingCampaigns}
                  isLoadingAdSets={isLoadingAdSets}
                  isLoadingAds={isLoadingAds}
                  loadDynamicOptions={shouldLoadFilterOptions}
                  onFiltersOpenChange={(open) => {
                    if (open) setShouldLoadFilterOptions(true);
                  }}
                  tourPrefix="contacts"
                  triggerClassName="text-[10px] font-light"
                />
              </div>

              {canCreateLeads && (
                <Button
                  data-tour="contacts-new"
                  size="sm"
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="h-8 shrink-0 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[11px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                  title="Novo Lead"
                >
                  <Plus className="h-4 w-4" />
                  <span>Novo</span>
                </Button>
              )}
            </div>

            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
              <LeadCountBadge
                isLoading={isLoading || contactsPlaceholderData}
                totalCount={totalCount}
                className="justify-center"
              />

              {(canImportLeads || canExportLeads) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      data-tour="contacts-import"
                      variant="outline"
                      size="icon"
                      aria-label="Importar ou exportar contatos"
                      className="h-8 w-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                    >
                      <Upload className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    data-tour="contacts-import-menu"
                    align="end"
                    sideOffset={8}
                    collisionPadding={12}
                    className="app-header-popover w-52 p-2"
                  >
                    {canImportLeads && (
                      <DropdownMenuItem
                        data-tour="contacts-import-action"
                        onClick={() => setImportDialogOpen(true)}
                        className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                      >
                        <Upload className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                        Importar CSV/Excel
                      </DropdownMenuItem>
                    )}
                    {canExportLeads && (
                      <DropdownMenuItem
                        data-tour="contacts-export-action"
                        onClick={handleExport}
                        disabled={isExporting || totalCount === 0}
                        className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                      >
                        <Download className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                        {isExporting ? "Exportando..." : "Exportar"}
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        ) : (
          <div className="app-toolbar overflow-visible p-2">
            <div className="flex items-center justify-between gap-3 w-full">
              <div className="flex items-center gap-2">
                <LeadCountBadge
                  isLoading={isLoading || contactsPlaceholderData}
                  totalCount={totalCount}
                />

                {(canImportLeads || canExportLeads) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        data-tour="contacts-import"
                        variant="outline"
                        size="sm"
                        aria-label="Importar ou exportar contatos"
                        className="h-8 gap-1.5 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
                      >
                        <Upload className="h-4 w-4" />
                        <span className="hidden xl:inline">
                          Importar / Exportar
                        </span>
                        <ChevronDown className="h-4 w-4 opacity-50" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      data-tour="contacts-import-menu"
                      align="end"
                      sideOffset={8}
                      collisionPadding={12}
                      className="app-header-popover w-52 p-2"
                    >
                      {canImportLeads && (
                        <DropdownMenuItem
                          data-tour="contacts-import-action"
                          onClick={() => setImportDialogOpen(true)}
                          className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                        >
                          <Upload className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                          Importar CSV/Excel
                        </DropdownMenuItem>
                      )}
                      {canExportLeads && (
                        <DropdownMenuItem
                          data-tour="contacts-export-action"
                          onClick={handleExport}
                          disabled={isExporting || totalCount === 0}
                          className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                        >
                          <Download className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                          {isExporting ? "Exportando..." : "Exportar"}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <div className="contacts-toolbar-actions flex min-w-0 items-center justify-end gap-2">
                <div data-tour="contacts-filters">
                  <SharedFilters
                    datePreset={datePreset}
                    onDatePresetChange={handleFilterChange(setDatePreset)}
                    customDateRange={customDateRange}
                    onCustomDateRangeChange={handleFilterChange(
                      setCustomDateRange,
                    )}
                    teamId={sharedFilters.teamId}
                    onTeamChange={handleFilterChange(setTeamId)}
                    userId={selectedAssignee}
                    onUserChange={handleFilterChange(setSelectedAssignee)}
                    pipelineId={filterPipelineId || null}
                    onPipelineChange={(value) => {
                      setSelectedPipeline(value || "all");
                      setSelectedStage("all");
                      setPage(1);
                    }}
                    pipelines={pipelines}
                    stageId={selectedStage !== "all" ? selectedStage : null}
                    onStageChange={(value) => {
                      setSelectedStage(value || "all");
                      setPage(1);
                    }}
                    stages={filterStages}
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
                    hasActiveFilters={
                      hasSharedActiveFilters ||
                      selectedPipeline !== "all" ||
                      selectedStage !== "all" ||
                      lostLeadsView
                    }
                    dynamicSources={dynamicSources}
                    campaigns={campaigns}
                    adSets={adSets}
                    ads={ads}
                    tags={allTagsFromHook}
                    isLoadingSources={isLoadingSources}
                    isLoadingCampaigns={isLoadingCampaigns}
                    isLoadingAdSets={isLoadingAdSets}
                    isLoadingAds={isLoadingAds}
                    loadDynamicOptions={shouldLoadFilterOptions}
                    onFiltersOpenChange={(open) => {
                      if (open) setShouldLoadFilterOptions(true);
                    }}
                    tourPrefix="contacts"
                    triggerClassName="text-[10px] font-light"
                  />
                </div>

                {canCreateLeads && (
                  <Button
                    data-tour="contacts-new"
                    size="sm"
                    onClick={() => setIsCreateDialogOpen(true)}
                    className="h-8 gap-1.5 rounded-[6px] bg-primary/50 px-2.5 text-[11px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary hover:text-primary-foreground focus-visible:ring-1 focus-visible:ring-primary/30"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Novo Lead</span>
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {lostLeadsView && (
          <div className="rounded-[8px] bg-red-500/10 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[6px] bg-red-500/70 text-white">
                  <XCircle className="h-4 w-4" />
                </div>
                <div>
                  <h2 className="text-[13px] font-medium text-red-700 dark:text-red-300">
                    Leads perdidos
                  </h2>
                  <p className="text-[12px] font-light leading-5 text-[var(--app-text-tertiary)]">
                    Listando leads marcados como perdidos e o motivo informado
                    na perda.
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleLostLeadsView}
                className="h-8 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                Ver todos os leads
              </Button>
            </div>
          </div>
        )}

        <Card
          data-tour="contacts-list"
          className="app-card contacts-table-card relative min-w-0 overflow-hidden bg-[var(--app-surface-solid)] p-1.5 shadow-none sm:p-2"
        >
          {isContactsTransitioning && (
            <div role="status" aria-live="polite" className="absolute inset-0 z-30 flex items-center justify-center bg-[var(--app-bg)]/70">
              <div className="flex items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)] shadow-none">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>Carregando contatos...</span>
              </div>
            </div>
          )}

          {showContactsRefreshError && (
            <div
              role="status"
              className="absolute right-3 top-3 z-30 flex items-center gap-2 rounded-[6px] bg-amber-500/12 px-3 py-1.5 text-[11px] font-light text-amber-800 dark:text-amber-100"
            >
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Os contatos exibidos podem estar desatualizados.</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refetchContacts()}
                disabled={isFetchingContacts}
                className="h-7 rounded-[4px] bg-[var(--app-surface-solid)] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
              >
                <RefreshCw
                  className={cn(
                    "h-3 w-3",
                    isFetchingContacts && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                Tentar novamente
              </Button>
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
                <div className="space-y-1">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className="grid animate-pulse grid-cols-[36px_minmax(0,1fr)_32px] items-center gap-2.5 rounded-[6px] px-2 py-2.5"
                    >
                      <div className="h-9 w-9 rounded-[6px] bg-[var(--app-surface-soft)]" />
                      <div className="min-w-0 space-y-2">
                        <div className="h-3 w-32 rounded-[4px] bg-[var(--app-surface-soft)]" />
                        <div className="h-3 w-44 max-w-full rounded-[4px] bg-[var(--app-surface-soft)]" />
                        <div className="h-3 w-28 rounded-[4px] bg-[var(--app-surface-soft)]" />
                      </div>
                      <div className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)]" />
                    </div>
                  ))}
                </div>
              ) : contacts.length === 0 ? (
                <EmptyState
                  hasActiveFilters={!!hasActiveFilters}
                  onImport={
                    canImportLeads ? () => setImportDialogOpen(true) : undefined
                  }
                  onCreate={
                    canCreateLeads
                      ? () => setIsCreateDialogOpen(true)
                      : undefined
                  }
                  onClearFilters={handleClearFilters}
                />
              ) : (
                <div className="space-y-1">
                  {contacts.map((contact: Contact) => (
                    <ContactCard
                      key={contact.id}
                      contact={contact}
                      sourceLabels={sourceLabels}
                      onViewDetails={() => openLeadDetails(contact.id)}
                      onDelete={
                        canDeleteLeads
                          ? () => setDeleteContactId(contact.id)
                          : undefined
                      }
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="min-w-0 overflow-x-auto overscroll-x-contain">
              {showContactsErrorState ? (
                <ContactsErrorState
                  message={contactsErrorMessage}
                  onRetry={() => void refetchContacts()}
                  isRetrying={isFetchingContacts}
                />
              ) : isLoading ? (
                <Table className="app-data-table min-w-[760px] table-fixed [&_td]:px-2.5 [&_td]:py-2.5">
                  <TableSkeleton showSelection={canDeleteLeads} />
                </Table>
              ) : contacts.length === 0 ? (
                <EmptyState
                  hasActiveFilters={!!hasActiveFilters}
                  onImport={
                    canImportLeads ? () => setImportDialogOpen(true) : undefined
                  }
                  onCreate={
                    canCreateLeads
                      ? () => setIsCreateDialogOpen(true)
                      : undefined
                  }
                  onClearFilters={handleClearFilters}
                />
              ) : (
                <Table className="contacts-table min-w-[760px] table-fixed border-separate border-spacing-0 [&_td]:px-2.5 [&_td]:py-2.5 [&_th]:h-9 [&_th]:px-2.5 [&_th]:text-[10px] [&_th]:font-light [&_th]:text-[var(--app-text-tertiary)]">
                  <TableHeader>
                    <TableRow className="border-b border-border/30 bg-transparent hover:bg-transparent">
                      {canDeleteLeads && (
                        <TableHead className="w-12">
                          <Checkbox
                            data-tour="contacts-select-all"
                            aria-label="Selecionar todos os contatos desta página"
                            checked={
                              selectedIds.size === contacts.length &&
                              contacts.length > 0
                            }
                            onCheckedChange={toggleSelectAll}
                          />
                        </TableHead>
                      )}
                      <TableHead
                        aria-sort={
                          sortBy === "name"
                            ? sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => handleSort("name")}
                          className="flex h-9 w-full items-center rounded-[4px] text-left outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30"
                        >
                          Nome{" "}
                          <SortIcon
                            column="name"
                            sortBy={sortBy}
                            sortDir={sortDir}
                          />
                        </button>
                      </TableHead>
                      <TableHead>Contato</TableHead>
                      <TableHead className="w-24 xl:w-28">
                        {lostLeadsView ? "Motivo da perda" : "Status"}
                      </TableHead>
                      <TableHead className="w-36 xl:w-44">
                        Pipeline / Estágio
                      </TableHead>
                      <TableHead className="w-14 text-center">Resp.</TableHead>
                      <TableHead className="hidden 2xl:table-cell 2xl:w-40">
                        Tags
                      </TableHead>
                      <TableHead
                        className="w-24 xl:w-40"
                        aria-sort={
                          sortBy === "created_at"
                            ? sortDir === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          onClick={() => handleSort("created_at")}
                          className="flex h-9 w-full items-center rounded-[4px] text-left outline-none transition-colors hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-primary/30"
                        >
                          Criado em{" "}
                          <SortIcon
                            column="created_at"
                            sortBy={sortBy}
                            sortDir={sortDir}
                          />
                        </button>
                      </TableHead>
                      <TableHead
                        className="contacts-actions-cell w-12"
                        aria-label="Ações"
                      ></TableHead>
                    </TableRow>
                  </TableHeader>

                  <TableBody>
                    {contacts.map((contact: Contact) => {
                      const isLost = contact.deal_status === "lost";
                      const isWon = contact.deal_status === "won";
                      const status: keyof typeof dealStatusConfig =
                        contact.deal_status === "won" ||
                        contact.deal_status === "lost"
                          ? contact.deal_status
                          : "open";
                      const StatusIcon =
                        dealStatusConfig[status]?.icon || CircleDot;

                      return (
                        <TableRow
                          key={contact.id}
                          className={cn(
                            "group cursor-pointer border-b border-border/30 transition-colors hover:bg-[var(--app-surface-hover)] last:border-b-0",
                            isLost &&
                              "bg-[var(--lead-status-lost-card)] hover:bg-[var(--lead-status-lost-card-hover)]",
                            isWon &&
                              "bg-[var(--lead-status-won-card)] hover:bg-[var(--lead-status-won-card-hover)]",
                          )}
                          data-deal-status={status}
                          onClick={() => openLeadDetails(contact.id)}
                        >
                          {canDeleteLeads && (
                            <TableCell onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                aria-label={`Selecionar ${contact.name}`}
                                checked={selectedIds.has(contact.id)}
                                onCheckedChange={() =>
                                  toggleSelectOne(contact.id)
                                }
                              />
                            </TableCell>
                          )}

                          <TableCell>
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openLeadDetails(contact.id);
                              }}
                              className="flex min-w-0 items-center gap-3 rounded-[4px] text-left outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
                            >
                              <Avatar className="h-9 w-9 shrink-0 rounded-[6px] [&_img]:rounded-[6px]">
                                <AvatarImage
                                  src={contact.whatsapp_avatar_url || undefined}
                                  alt={contact.name}
                                />
                                <AvatarFallback className="rounded-[6px] bg-primary/50 text-[11px] font-light text-primary-foreground transition-colors group-hover:bg-primary">
                                  {getInitials(contact.name)}
                                </AvatarFallback>
                              </Avatar>
                              <div className="min-w-0">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span
                                    className="truncate text-[13px] font-medium text-[var(--app-text-primary)]"
                                    title={contact.name}
                                  >
                                    {contact.name}
                                  </span>
                                  <ReentryBadge
                                    count={contact.reentry_count}
                                    lastEntryAt={contact.last_entry_at}
                                  />
                                </div>
                                {contact.source && (
                                  <p
                                    className="truncate text-[11px] font-light text-[var(--app-text-tertiary)]"
                                    title={
                                      sourceLabels[contact.source] ||
                                      contact.source
                                    }
                                  >
                                    {sourceLabels[contact.source] ||
                                      contact.source}
                                  </p>
                                )}
                              </div>
                            </button>
                          </TableCell>

                          <TableCell>
                            <div className="min-w-0 space-y-1">
                              {contact.phone && (
                                <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                                  <Phone className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                                  <span
                                    className="truncate"
                                    title={contact.phone}
                                  >
                                    {contact.phone}
                                  </span>
                                </div>
                              )}
                              {contact.email && (
                                <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
                                  <Mail className="h-3 w-3 shrink-0 text-[var(--app-text-tertiary)]" />
                                  <span
                                    className="truncate"
                                    title={contact.email}
                                  >
                                    {contact.email}
                                  </span>
                                </div>
                              )}
                            </div>
                          </TableCell>

                          <TableCell
                            onClick={() => openLeadDetails(contact.id)}
                          >
                            {lostLeadsView ? (
                              <p
                                className="max-w-[260px] text-[12px] font-light leading-5 text-red-700 dark:text-red-300"
                                title={contact.lost_reason || undefined}
                              >
                                {contact.lost_reason || "Motivo não informado"}
                              </p>
                            ) : (
                              <div className="space-y-1">
                                <Badge
                                  variant="secondary"
                                  className={cn(
                                    "gap-1 rounded-[4px] border-0 px-1.5 py-0.5 text-[10px] font-light whitespace-nowrap",
                                    dealStatusConfig[status]?.className,
                                  )}
                                >
                                  <StatusIcon className="h-3 w-3" />
                                  {dealStatusConfig[status]?.label}
                                </Badge>
                                {isLost && contact.lost_reason && (
                                  <p
                                    className="max-w-[150px] truncate text-[10px] font-light text-red-600 dark:text-red-400"
                                    title={contact.lost_reason}
                                  >
                                    {contact.lost_reason}
                                  </p>
                                )}
                              </div>
                            )}
                          </TableCell>

                          <TableCell
                            onClick={() => openLeadDetails(contact.id)}
                          >
                            <div className="space-y-1">
                              {contact.stage_name && (
                                <Badge
                                  variant="secondary"
                                  className="max-w-[150px] justify-center truncate rounded-[4px] border-0 bg-[var(--app-surface-soft)] px-1.5 py-0.5 text-[10px] font-light text-[var(--app-text-secondary)] whitespace-nowrap"
                                  title={contact.stage_name}
                                >
                                  {contact.stage_name}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell
                            className="w-14"
                            onClick={() => openLeadDetails(contact.id)}
                          >
                            <AssigneeAvatarCell
                              name={contact.assignee_name}
                              avatarUrl={contact.assignee_avatar}
                            />
                          </TableCell>

                          <TableCell
                            className="hidden 2xl:table-cell"
                            onClick={() => openLeadDetails(contact.id)}
                          >
                            <div className="flex flex-wrap gap-1">
                              {contact.tags?.slice(0, 2).map((tag) => (
                                <Badge
                                  key={tag.id}
                                  variant="secondary"
                                  className={cn(
                                    "rounded-[4px] px-1.5 text-[9px] font-light",
                                    getTagForegroundClass(tag.color),
                                  )}
                                  style={{
                                    backgroundColor: tag.color,
                                    borderColor: tag.color,
                                  }}
                                >
                                  {tag.name}
                                </Badge>
                              ))}
                              {contact.tags && contact.tags.length > 2 && (
                                <Badge
                                  variant="secondary"
                                  className="rounded-[4px] px-1.5 text-[9px] font-light"
                                >
                                  +{contact.tags.length - 2}
                                </Badge>
                              )}
                            </div>
                          </TableCell>

                          <TableCell
                            onClick={() => openLeadDetails(contact.id)}
                          >
                            <p className="whitespace-nowrap text-[12px] font-light text-[var(--app-text-secondary)]">
                              <span className="xl:hidden">
                                {format(
                                  new Date(contact.created_at),
                                  "dd/MM/yy",
                                  { locale: ptBR },
                                )}
                              </span>
                              <span className="hidden xl:inline">
                                {format(
                                  new Date(contact.created_at),
                                  "dd/MM/yyyy HH:mm",
                                  { locale: ptBR },
                                )}
                              </span>
                            </p>
                          </TableCell>

                          <TableCell
                            className="contacts-actions-cell w-12 px-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Ações de ${contact.name}`}
                                  className="h-8 w-8 rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:ring-1 focus-visible:ring-[var(--app-border-strong)] data-[state=open]:bg-[var(--app-surface-hover)] data-[state=open]:text-[var(--app-text-primary)]"
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent
                                align="end"
                                sideOffset={8}
                                collisionPadding={12}
                                className="app-header-popover w-52 p-2"
                              >
                                <DropdownMenuItem
                                  onClick={() => openLeadDetails(contact.id)}
                                  className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                                >
                                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                                  Ver detalhes
                                </DropdownMenuItem>
                                {contact.phone && (
                                  <DropdownMenuItem
                                    asChild
                                    className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-[var(--app-text-primary)] transition-colors focus:bg-[var(--app-surface-hover)] focus:text-[var(--app-text-primary)]"
                                  >
                                    <a
                                      href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                    >
                                      <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                                      WhatsApp
                                    </a>
                                  </DropdownMenuItem>
                                )}
                                {canDeleteLeads && (
                                  <>
                                    <DropdownMenuSeparator className="mx-0 my-1 bg-border/30" />
                                    <DropdownMenuItem
                                      className="cursor-pointer gap-2 rounded-[4px] px-2.5 py-2 text-[14px] font-light text-destructive transition-colors focus:bg-destructive/10 focus:text-destructive data-[highlighted]:!bg-destructive/10 data-[highlighted]:!text-destructive"
                                      onClick={() =>
                                        setDeleteContactId(contact.id)
                                      }
                                    >
                                      <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" />
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
          <div className="app-card fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-2 rounded-[8px] bg-[var(--app-surface-solid)] p-2 shadow-none">
            <span className="whitespace-nowrap px-1 text-[12px] font-light text-[var(--app-text-primary)]">
              {selectedIds.size} selecionado(s)
            </span>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setBulkDeleteDialogOpen(true)}
              className="h-8 gap-1 rounded-[6px] px-2.5 text-[11px] font-light shadow-none"
            >
              <Trash2 className="h-4 w-4 mr-1" />
              Excluir
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearSelection}
              className="h-8 rounded-[6px] px-2.5 text-[11px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Cancelar
            </Button>
          </div>
        )}

        {(totalPages > 1 || totalCount > 0) && (
          <div className="app-toolbar flex flex-wrap items-center justify-between gap-2 p-2">
            <div className="flex items-center gap-2">
              <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                Página {page} de {totalPages || 1}
              </p>
              <Select
                value={String(pageSize)}
                onValueChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
              >
                <SelectTrigger aria-label="Contatos por página" className="h-8 w-[100px] rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[11px] font-light shadow-none">
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
                aria-label="Ir para a primeira página"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() => setPage(1)}
                disabled={page === 1}
              >
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Ir para a página anterior"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() =>
                  setPage((currentPage) => Math.max(1, currentPage - 1))
                }
                disabled={page === 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1 mx-2">
                <Input
                  type="text"
                  inputMode="numeric"
                  aria-label="Número da página"
                  value={pageInputValue}
                  onChange={(e) => setPageInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const pageNumber = parseInt(pageInputValue);

                      if (
                        !isNaN(pageNumber) &&
                        pageNumber >= 1 &&
                        pageNumber <= totalPages
                      ) {
                        setPage(pageNumber);
                      } else {
                        setPageInputValue(String(page));
                      }
                    }
                  }}
                  onBlur={() => {
                    const pageNumber = parseInt(pageInputValue);

                    if (
                      !isNaN(pageNumber) &&
                      pageNumber >= 1 &&
                      pageNumber <= totalPages
                    ) {
                      setPage(pageNumber);
                    } else {
                      setPageInputValue(String(page));
                    }
                  }}
                  className="h-8 w-12 rounded-[6px] border-0 bg-[var(--app-surface-solid)] p-1 text-center text-[11px] font-light shadow-none focus-visible:ring-1 focus-visible:ring-primary/30"
                />
                <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
                  / {totalPages}
                </span>
              </div>

              <Button
                variant="outline"
                size="icon"
                aria-label="Ir para a próxima página"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() =>
                  setPage((currentPage) =>
                    Math.min(totalPages, currentPage + 1),
                  )
                }
                disabled={page === totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                aria-label="Ir para a última página"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)]"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages}
              >
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {isOpeningLeadDetails && (
          <div
            role="status"
            aria-live="polite"
            className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" aria-hidden="true" />
            Abrindo lead...
          </div>
        )}

        {showLeadDetailError && (
          <div
            role="alert"
            className="fixed bottom-[calc(1.25rem+env(safe-area-inset-bottom))] left-1/2 z-[80] flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-[12px] font-light text-[var(--app-text-secondary)] shadow-none"
          >
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden="true" />
            <span>
              {getErrorMessage(
                selectedLeadError,
                "Não foi possível abrir este contato.",
              )}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => void refetchSelectedLead()}
              disabled={isFetchingSelectedLead}
              className="h-7 rounded-[4px] bg-[var(--app-surface-soft)] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Tentar novamente
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setSelectedContactId(null)}
              className="h-7 rounded-[4px] px-2 text-[10px] font-light shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              Fechar
            </Button>
          </div>
        )}

        {selectedContactId && selectedLead && (
          <LeadDetailDialog
            lead={selectedLead}
            stages={stages}
            onClose={() => setSelectedContactId(null)}
            onEdit={(leadToEdit) => {
              const contactTags = contacts.find(
                (contact) => contact.id === selectedLead.id,
              )?.tags;
              setEditingLead({
                ...selectedLead,
                ...leadToEdit,
                assignee: selectedLead.assignee,
                stage: selectedLead.stage,
                tags: contactTags || selectedLead.tags,
              });
              setSelectedContactId(null);
            }}
            allTags={tags}
            allUsers={users}
            refetchStages={() => {
              void refetchStages();
              void refetchContacts();
            }}
          />
        )}

        {canCreateLeads && isCreateDialogOpen && (
          <CreateLeadDialog
            open={isCreateDialogOpen}
            onOpenChange={setIsCreateDialogOpen}
          />
        )}

        {editingLead && (
          <CreateLeadDialog
            open={!!editingLead}
            onOpenChange={(nextOpen) => {
              if (!nextOpen) setEditingLead(null);
            }}
            lead={editingLead}
            onSaved={() => void refetchContacts()}
          />
        )}

        <AlertDialog
          open={canDeleteLeads && !!deleteContactId}
          onOpenChange={(open) => {
            if (!open && !deleteLead.isPending) setDeleteContactId(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir contato</AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir este contato? Esta ação não pode
                ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteLead.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                disabled={deleteLead.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  void handleDeleteContact();
                }}
              >
                {deleteLead.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {deleteLead.isPending ? "Excluindo..." : "Excluir"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={canDeleteLeads && bulkDeleteDialogOpen}
          onOpenChange={(open) => {
            if (!bulkDeleteLeads.isPending) setBulkDeleteDialogOpen(open);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Excluir {selectedIds.size} contatos
              </AlertDialogTitle>
              <AlertDialogDescription>
                Tem certeza que deseja excluir {selectedIds.size} contatos
                selecionados? Esta ação não pode ser desfeita.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={bulkDeleteLeads.isPending}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive hover:bg-destructive/90"
                disabled={bulkDeleteLeads.isPending}
                onClick={(event) => {
                  event.preventDefault();
                  void handleBulkDelete();
                }}
              >
                {bulkDeleteLeads.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {bulkDeleteLeads.isPending
                  ? "Excluindo..."
                  : `Excluir ${selectedIds.size} contatos`}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {canImportLeads && importDialogOpen && (
          <ImportContactsDialog
            open={importDialogOpen}
            onOpenChange={setImportDialogOpen}
          />
        )}
      </div>
    </AppLayout>
  );
}
