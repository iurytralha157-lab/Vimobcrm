"use client";

import { useMemo } from "react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { getDateRangeFromPreset } from "@/hooks/use-dashboard-filters";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { useRelativeDateClock } from "@/hooks/shared/use-relative-date-clock";
import { usePipelines } from "@/hooks/use-stages";
import { MetaCampaignDashboard } from "./MetaCampaignDashboard";

export function MetaCampaignsDashboardScreen() {
  const { data: pipelines = [] } = usePipelines();
  const {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    pipelineId,
    setPipelineId,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    pageId,
    setPageId,
    campaignId,
    setCampaignId,
    campaignIds,
    setCampaignIds,
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    tagIds,
    setTagIds,
    dealStatus,
    setDealStatus,
    setSearchQuery,
    clearFilters,
    dynamicSources,
    pages,
    campaigns,
    adSets,
    ads,
    tags,
    isLoadingSources,
    isLoadingPages,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
    isLoadingTags,
    hasTagsError,
    isFiltersHydrated,
  } = useSharedFilters({ multiCampaigns: true });
  const relativeDateClock = useRelativeDateClock(!filters.dateRange);
  const campaignFilters = useMemo(
    () => {
      void relativeDateClock;
      return {
      ...filters,
      // Campaign analytics does not support the shared lead-text search.
      searchQuery: "",
      datePreset: datePreset ?? "last30days" as const,
      dateRange: filters.dateRange ?? getDateRangeFromPreset("last30days"),
      };
    },
    [datePreset, filters, relativeDateClock],
  );
  const hasActiveCampaignFilters =
    pipelineId !== null ||
    teamId !== null ||
    (userId !== null && userId !== "all") ||
    source !== null ||
    pageId !== null ||
    campaignIds.length > 0 ||
    adSetId !== null ||
    adId !== null ||
    tagIds.length > 0 ||
    dealStatus !== null ||
    Boolean(filters.dateRange);

  return (
    <AppLayout title="Dashboard de campanhas">
      <div className="space-y-4">
        <SharedFilters
          datePreset={datePreset ?? "last30days"}
          onDatePresetChange={setDatePreset}
          defaultDatePreset="last30days"
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          pipelineId={pipelineId}
          onPipelineChange={setPipelineId}
          pipelines={pipelines}
          teamId={teamId}
          onTeamChange={setTeamId}
          userId={userId}
          onUserChange={setUserId}
          includeUnassignedUserOption
          source={source}
          onSourceChange={setSource}
          pageId={pageId}
          onPageChange={setPageId}
          campaignId={campaignId}
          onCampaignChange={setCampaignId}
          campaignIds={campaignIds}
          onCampaignsChange={setCampaignIds}
          adSetId={adSetId}
          onAdSetChange={setAdSetId}
          adId={adId}
          onAdChange={setAdId}
          tagIds={tagIds}
          onTagsChange={setTagIds}
          dealStatus={dealStatus}
          onDealStatusChange={setDealStatus}
          searchQuery={campaignFilters.searchQuery}
          onSearchChange={setSearchQuery}
          onClear={clearFilters}
          hasActiveFilters={hasActiveCampaignFilters}
          hideSearch
          dynamicSources={dynamicSources}
          pages={pages}
          campaigns={campaigns}
          adSets={adSets}
          ads={ads}
          tags={tags}
          isLoadingSources={isLoadingSources}
          isLoadingPages={isLoadingPages}
          isLoadingCampaigns={isLoadingCampaigns}
          isLoadingAdSets={isLoadingAdSets}
          isLoadingAds={isLoadingAds}
          isLoadingTags={isLoadingTags}
          hasTagsError={hasTagsError}
          datePosition="start"
        />

        <MetaCampaignDashboard filters={campaignFilters} filtersReady={isFiltersHydrated} />
      </div>
    </AppLayout>
  );
}

export default MetaCampaignsDashboardScreen;
