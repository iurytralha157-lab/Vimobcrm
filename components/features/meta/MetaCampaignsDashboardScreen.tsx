"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { SharedFilters } from "@/components/shared/SharedFilters";
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
    campaignId,
    setCampaignId,
    adSetId,
    setAdSetId,
    adId,
    setAdId,
    tagId,
    setTagId,
    dealStatus,
    setDealStatus,
    searchQuery,
    setSearchQuery,
    clearFilters,
    hasActiveFilters,
    dynamicSources,
    campaigns,
    adSets,
    ads,
    tags,
    isLoadingSources,
    isLoadingCampaigns,
    isLoadingAdSets,
    isLoadingAds,
  } = useSharedFilters();

  return (
    <AppLayout title="Dashboard de campanhas">
      <div className="space-y-4">
        <SharedFilters
          datePreset={datePreset}
          onDatePresetChange={setDatePreset}
          customDateRange={customDateRange}
          onCustomDateRangeChange={setCustomDateRange}
          teamId={teamId}
          onTeamChange={setTeamId}
          userId={userId}
          onUserChange={setUserId}
          source={source}
          onSourceChange={setSource}
          campaignId={campaignId}
          onCampaignChange={setCampaignId}
          adSetId={adSetId}
          onAdSetChange={setAdSetId}
          adId={adId}
          onAdChange={setAdId}
          tagId={tagId}
          onTagChange={setTagId}
          dealStatus={dealStatus}
          onDealStatusChange={setDealStatus}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onClear={clearFilters}
          hasActiveFilters={hasActiveFilters}
          hideSearch
          dynamicSources={dynamicSources}
          campaigns={campaigns}
          adSets={adSets}
          ads={ads}
          tags={tags}
          isLoadingSources={isLoadingSources}
          isLoadingCampaigns={isLoadingCampaigns}
          isLoadingAdSets={isLoadingAdSets}
          isLoadingAds={isLoadingAds}
          datePosition="start"
        />

        <MetaCampaignDashboard filters={filters} />
      </div>
    </AppLayout>
  );
}

export default MetaCampaignsDashboardScreen;
