"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  buildContactExportFilters,
  buildContactListFilters,
  ContactsBulkSelectionBar,
  ContactsList,
  ContactsOverlays,
  ContactsPagination,
  ContactsToolbar,
  toggleContactSelection,
  toggleCurrentPageSelection,
  type ContactsToolbarFilters,
} from "@/components/features/contacts/contacts-screen";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useFloatingChat } from "@/contexts/FloatingChatContext";
import { useContactsList, type ContactListFilters } from "@/hooks/use-contacts-list";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import {
  useBulkDeleteLeads,
  useDeleteLead,
  useLead,
  type Lead,
} from "@/hooks/use-leads";
import { useIsMobile } from "@/hooks/use-mobile";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { usePipelines, useStages } from "@/hooks/use-stages";
import { useTags } from "@/hooks/use-tags";
import { useToast } from "@/hooks/use-toast";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { useOrganizationUsers } from "@/hooks/use-users";
import {
  getDateRangeFromPreset,
  type DatePreset,
} from "@/hooks/use-dashboard-filters";
import { getErrorMessageOrFallback as getErrorMessage } from "@/lib/api/vimob-error";

export default function Contacts() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { openNewChat } = useFloatingChat();
  const { activeOrganization, isSuperAdmin } = useAuth();
  const { hasModule } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const organizationId = activeOrganization.organizationId ?? null;
  const canDeleteLeads = isSuperAdmin || hasPermission("lead_delete");
  const canCreateLeads = isSuperAdmin || hasPermission("lead_create");
  const canImportLeads = isSuperAdmin || hasPermission("lead_import");
  const canExportLeads = isSuperAdmin || hasPermission("lead_export");
  const canUseWhatsApp =
    hasModule("whatsapp") &&
    (isSuperAdmin || hasPermission("whatsapp_operate"));
  const isMobile = useIsMobile();
  const { toast } = useToast();
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const [contactsDatePreset, setContactsDatePreset] =
    useState<DatePreset | null>(null);
  const [contactsCustomDateRange, setContactsCustomDateRange] = useState<{
    from: Date;
    to: Date;
  } | null>(null);
  const contactsDateRange = useMemo(() => {
    if (!contactsDatePreset) return null;
    if (contactsDatePreset === "custom") return contactsCustomDateRange;
    return getDateRangeFromPreset(contactsDatePreset);
  }, [contactsCustomDateRange, contactsDatePreset]);
  const [selectedPipeline, setSelectedPipeline] = useState<string>("all");
  const [selectedStage, setSelectedStage] = useState<string>("all");
  const { data: pipelines = [] } = usePipelines();

  const {
    filters: sharedFilters,
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
    isFiltersHydrated,
  } = useSharedFilters({
    loadDynamicOptions: shouldLoadFilterOptions,
    pipelineId: selectedPipeline !== "all" ? selectedPipeline : null,
    dateMode: contactsDateRange ? "origin" : undefined,
    dateRangeOverride: contactsDateRange,
  });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState<string | null>(
    null,
  );
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [deleteContactId, setDeleteContactId] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
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
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(true);
    };
    const handleKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Shift") setShiftPressed(false);
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

  const normalizedSearch = search.trim();
  const deferredSearch = useDebouncedValue(normalizedSearch, 300);
  const isSearchSettling = normalizedSearch !== deferredSearch;
  const effectiveDealStatus = lostLeadsView ? "lost" : selectedDealStatus;
  const filters = buildContactListFilters({
    search: deferredSearch,
    teamId: sharedFilters.teamId,
    pipelineId: selectedPipeline,
    stageId: selectedStage,
    assigneeId: selectedAssignee,
    tagId: selectedTag,
    source: selectedSource,
    campaignId,
    adSetId,
    adId,
    dealStatus: effectiveDealStatus,
    dateRange: contactsDateRange,
    sortBy,
    sortDir,
    page,
    pageSize,
  });

  const {
    data: contacts = [],
    isLoading,
    isFetching: isFetchingContacts,
    isError: contactsError,
    error: contactsQueryError,
    isPlaceholderData: contactsPlaceholderData,
    refetch: refetchContacts,
  } = useContactsList(filters, { enabled: isFiltersHydrated });
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
  const { data: stages = [] } = useStages(
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
    if (contactsPlaceholderData || isFetchingContacts || page <= 1) {
      return;
    }

    const lastAvailablePage = totalPages > 0 ? totalPages : 1;
    if (page <= lastAvailablePage) return;

    let isActive = true;
    queueMicrotask(() => {
      if (isActive) setPage(lastAvailablePage);
    });
    return () => {
      isActive = false;
    };
  }, [contactsPlaceholderData, isFetchingContacts, page, totalPages]);

  const handleClearFilters = () => {
    clearFilters();
    setContactsDatePreset(null);
    setContactsCustomDateRange(null);
    setSelectedPipeline("all");
    setSelectedStage("all");
    setLostLeadsView(false);
    setPage(1);
  };

  const clearSelection = () => setSelectedIds(new Set());

  const toggleSelectAll = () => {
    if (!canDeleteLeads) return;
    setSelectedIds(
      toggleCurrentPageSelection(
        selectedIds,
        contacts.map((contact) => contact.id),
      ),
    );
  };

  const toggleSelectOne = (contactId: string) => {
    if (!canDeleteLeads) return;
    setSelectedIds(
      toggleContactSelection({
        selectedIds,
        currentPageIds: contacts.map((contact) => contact.id),
        contactId,
        shiftPressed,
        lastSelectedId,
      }),
    );
    setLastSelectedId(contactId);
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

  const toolbarFilters: ContactsToolbarFilters = {
    datePreset: contactsDatePreset,
    onDatePresetChange: handleFilterChange(setContactsDatePreset),
    onClearDatePreset: () => {
      setContactsDatePreset(null);
      setContactsCustomDateRange(null);
      setPage(1);
    },
    defaultDatePreset: null,
    customDateRange: contactsCustomDateRange,
    onCustomDateRangeChange: handleFilterChange(setContactsCustomDateRange),
    teamId: sharedFilters.teamId,
    onTeamChange: handleFilterChange(setTeamId),
    userId: selectedAssignee,
    onUserChange: handleFilterChange(setSelectedAssignee),
    pipelineId: filterPipelineId || null,
    onPipelineChange: (value) => {
      setSelectedPipeline(value || "all");
      setSelectedStage("all");
      setPage(1);
    },
    pipelines,
    stageId: selectedStage !== "all" ? selectedStage : null,
    onStageChange: (value) => {
      setSelectedStage(value || "all");
      setPage(1);
    },
    stages: filterStages,
    source: selectedSource,
    onSourceChange: handleFilterChange(setSelectedSource),
    campaignId: sharedFilters.campaignId,
    onCampaignChange: handleFilterChange(setCampaignId),
    adSetId: sharedFilters.adSetId,
    onAdSetChange: handleFilterChange(setAdSetId),
    adId: sharedFilters.adId,
    onAdChange: handleFilterChange(setAdId),
    tagId: selectedTag,
    onTagChange: handleFilterChange(setSelectedTag),
    dealStatus: effectiveDealStatus,
    onDealStatusChange: (value) => {
      setLostLeadsView(false);
      handleFilterChange(setSelectedDealStatus)(value);
    },
    searchQuery: search,
    onSearchChange: (value) => {
      setSearch(value);
      setPage(1);
    },
    onClear: handleClearFilters,
    hasActiveFilters,
    dynamicSources,
    campaigns,
    adSets,
    ads,
    tags: allTagsFromHook,
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
    loadDynamicOptions: shouldLoadFilterOptions,
    includeUnassignedUserOption: true,
    onFiltersOpenChange: (open) => {
      if (open) setShouldLoadFilterOptions(true);
    },
    tourPrefix: "contacts",
    triggerClassName:
      "bg-[var(--app-surface-soft)] text-[10px] font-light hover:bg-[var(--app-surface-hover)]",
  };

  return (
    <AppLayout title="Contatos" disableMainScroll>
      <div className="contacts-page-shell relative flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden animate-in">
        <ContactsToolbar
          isMobile={isMobile}
          totalCount={totalCount}
          isCountLoading={isLoading || contactsPlaceholderData}
          canCreateLeads={canCreateLeads}
          canImportLeads={canImportLeads}
          canExportLeads={canExportLeads}
          isExporting={isExporting}
          filters={toolbarFilters}
          onCreate={() => setIsCreateDialogOpen(true)}
          onImport={() => setImportDialogOpen(true)}
          onExport={() => setExportDialogOpen(true)}
        />

        <ContactsList
          isMobile={isMobile}
          contacts={contacts}
          isLoading={isLoading}
          isTransitioning={isContactsTransitioning}
          showRefreshError={showContactsRefreshError}
          showErrorState={showContactsErrorState}
          errorMessage={contactsErrorMessage}
          isFetching={isFetchingContacts}
          hasActiveFilters={hasActiveFilters}
          canCreateLeads={canCreateLeads}
          canImportLeads={canImportLeads}
          canDeleteLeads={canDeleteLeads}
          canUseWhatsApp={canUseWhatsApp}
          lostLeadsView={lostLeadsView}
          selectedIds={selectedIds}
          sortBy={sortBy}
          sortDir={sortDir}
          onRetry={() => void refetchContacts()}
          onClearFilters={handleClearFilters}
          onCreate={() => setIsCreateDialogOpen(true)}
          onImport={() => setImportDialogOpen(true)}
          onToggleLostLeadsView={handleToggleLostLeadsView}
          onViewDetails={openLeadDetails}
          onWhatsApp={(contact) => {
            if (canUseWhatsApp && contact.phone) {
              openNewChat(contact.phone, contact.name, contact.id);
            }
          }}
          onRequestDelete={setDeleteContactId}
          onToggleSelectAll={toggleSelectAll}
          onToggleSelectOne={toggleSelectOne}
          onSort={handleSort}
          footer={
            totalPages > 1 || totalCount > 0 ? (
              <ContactsPagination
                page={page}
                pageSize={pageSize}
                totalCount={totalCount}
                totalPages={totalPages}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
              />
            ) : null
          }
        />

        <ContactsBulkSelectionBar
          canDeleteLeads={canDeleteLeads}
          selectedCount={selectedIds.size}
          onRequestDelete={() => setBulkDeleteDialogOpen(true)}
          onClear={clearSelection}
        />

        <ContactsOverlays
          isOpeningLeadDetails={isOpeningLeadDetails}
          showLeadDetailError={showLeadDetailError}
          selectedLeadError={selectedLeadError}
          isFetchingSelectedLead={isFetchingSelectedLead}
          selectedContactId={selectedContactId}
          selectedLead={selectedLead ?? null}
          stages={stages}
          tags={tags}
          users={users}
          onRetrySelectedLead={() => void refetchSelectedLead()}
          onCloseSelectedLead={() => setSelectedContactId(null)}
          onEditLead={(leadToEdit) => {
            if (!selectedLead) return;
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
          canCreateLeads={canCreateLeads}
          isCreateDialogOpen={isCreateDialogOpen}
          onCreateDialogOpenChange={setIsCreateDialogOpen}
          editingLead={editingLead}
          onEditingDialogOpenChange={(nextOpen) => {
            if (!nextOpen) setEditingLead(null);
          }}
          onEditedLeadSaved={() => void refetchContacts()}
          canDeleteLeads={canDeleteLeads}
          deleteContactId={deleteContactId}
          isDeletePending={deleteLead.isPending}
          onDeleteDialogOpenChange={(open) => {
            if (!open && !deleteLead.isPending) setDeleteContactId(null);
          }}
          onConfirmDelete={() => void handleDeleteContact()}
          bulkDeleteDialogOpen={bulkDeleteDialogOpen}
          selectedCount={selectedIds.size}
          isBulkDeletePending={bulkDeleteLeads.isPending}
          onBulkDeleteDialogOpenChange={(open) => {
            if (!bulkDeleteLeads.isPending) setBulkDeleteDialogOpen(open);
          }}
          onConfirmBulkDelete={() => void handleBulkDelete()}
          canImportLeads={canImportLeads}
          importDialogOpen={importDialogOpen}
          onImportDialogOpenChange={setImportDialogOpen}
          canExportLeads={canExportLeads}
          exportDialogOpen={exportDialogOpen}
          exportFilters={buildContactExportFilters(filters)}
          organizationId={organizationId}
          totalCount={totalCount}
          onExportDialogOpenChange={setExportDialogOpen}
          onExportingChange={setIsExporting}
        />
      </div>
    </AppLayout>
  );
}
