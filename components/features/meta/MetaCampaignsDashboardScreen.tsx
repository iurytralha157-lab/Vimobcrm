"use client";

import { useMemo } from "react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { getDateRangeFromPreset } from "@/hooks/use-dashboard-filters";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { MetaCampaignDashboard } from "./MetaCampaignDashboard";

export function MetaCampaignsDashboardScreen() {
  const {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
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
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    tagIds,
    setTagIds,
    dealStatus,
    setDealStatus,
    searchQuery,
    setSearchQuery,
    clearFilters,
    hasActiveFilters,
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
  } = useSharedFilters();
  const campaignFilters = useMemo(
    () => ({
      ...filters,
      datePreset: datePreset ?? "last30days" as const,
      dateRange: filters.dateRange ?? getDateRangeFromPreset("last30days"),
    }),
    [datePreset, filters],
  );

  return (
    <AppLayout title="Dashboard de campanhas">
      <div className="space-y-4">
        <SharedFilters
          datePreset={datePreset ?? "last30days"}
          onDatePresetChange={setDatePreset}
          defaultDatePreset="last30days"
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          teamId={teamId}
          onTeamChange={setTeamId}
          userId={userId}
          onUserChange={setUserId}
          source={source}
          onSourceChange={setSource}
          pageId={pageId}
          onPageChange={setPageId}
          campaignId={campaignId}
          onCampaignChange={setCampaignId}
          adSetId={adSetId}
          onAdSetChange={setAdSetId}
          adId={adId}
          onAdChange={setAdId}
          tagIds={tagIds}
          onTagsChange={setTagIds}
          dealStatus={dealStatus}
          onDealStatusChange={setDealStatus}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClear={clearFilters}
          hasActiveFilters={hasActiveFilters}
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

        <MetaCampaignDashboard filters={campaignFilters} />
      </div>
    </AppLayout>
  );
}

export default MetaCampaignsDashboardScreen;
