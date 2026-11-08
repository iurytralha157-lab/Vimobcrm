"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useDashboardQuery } from "@/hooks/dashboard/use-dashboard-query";
import { useRouter } from "next/navigation";
import {
  Eye,
  XCircle,
  Trophy,
  PieChart as PieChartIcon,
} from "lucide-react";
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";

import { performanceTracker } from "@/lib/performance";
import { cn } from "@/lib/utils";

// Componentes de Layout e UI
import { AppLayout } from "@/components/shared/layout/AppLayout";

import { DashboardKpiGrid } from "@/components/features/dashboard/DashboardKpis";
import { SalesFunnelWithPipeline } from "@/components/features/dashboard/SalesFunnelWithPipeline";
import { DealsEvolutionChart } from "@/components/features/dashboard/DealsEvolutionChart";
import { LeadSourcesChart } from "@/components/features/dashboard/LeadSourcesChart";
import { DASHBOARD_SOURCE_SLICE_LIMIT } from "@/components/features/dashboard/lead-sources-model";
import { LeadDistributionSection } from "@/components/features/dashboard/LeadDistributionSection";
import { CampaignLeadsChart } from "@/components/features/dashboard/CampaignLeadsChart";
import { TopCreativesCard } from "@/components/features/dashboard/TopCreativesCard";
import { FirstContactDialog } from "@/components/features/dashboard/FirstContactDialog";
import { DashboardLeadEntriesDialog } from "@/components/features/dashboard/DashboardLeadEntriesDialog";
import { DashboardVisitsDialog } from "@/components/features/dashboard/DashboardVisitsDialog";
import {
  getDashboardStatsFailureState,
  getDashboardStatsErrorDescription,
  shouldDisplayCachedDashboardStats,
} from "@/components/features/dashboard/dashboard-stats-error";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// Hooks e Contextos
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { MAX_DASHBOARD_SOURCE_FILTER_LENGTH } from "@/lib/validation/dashboard-filter-text";
import { useFilters } from "@/contexts/FilterContext";
import {
  type EnhancedDashboardStats,
  useDashboardLeadDistribution,
  useDashboardFirstContact,
  useEnhancedDashboardStats,
  useDealsEvolutionData,
  useLeadSourcesData,
  useDashboardQueryScope,
} from "@/hooks/use-dashboard-stats";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDashboardPipelineOptions } from "@/hooks/dashboard/use-dashboard-pipeline-options";
import { useDashboardDialogFocus } from "@/hooks/dashboard/use-dashboard-dialog-focus";
import { SharedFilters } from "@/components/shared/SharedFilters";
import {
  datePresetOptions,
} from "@/hooks/use-dashboard-filters";
import { findDashboardSourceLabel, getDashboardSourceLabel } from "@/lib/analytics/dashboard-source-label";
import {
  getDashboardExtraCounts,
  getDashboardFiltersQueryKey,
  type DashboardAPIFilters,
} from "@/lib/api/dashboard";
import { DASHBOARD_CHART_COLORS } from "@/config/dashboard-chart-colors";
import { DASHBOARD_LAYOUT } from "@/config/dashboard-layout";
import { MAX_SHARED_REPORT_RANGE_DAYS } from "@/lib/filters/date-range-limits";
import { FilterPeriodNotice } from "@/components/shared/filters/FilterPeriodNotice";

const DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS = 1000 * 60 * 10;
const DASHBOARD_DESKTOP_BREAKPOINT_PX = DASHBOARD_LAYOUT.desktopBreakpointPx;
const DIALOG_CHART_INITIAL_DIMENSION = { width: 180, height: 180 };

type KPIFormat = "number" | "currency" | "percent" | "time";

function useIsDashboardDesktop() {
  const [isDashboardDesktop, setIsDashboardDesktop] = useState<boolean | null>(
    null,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(
      `(min-width: ${DASHBOARD_DESKTOP_BREAKPOINT_PX}px)`,
    );
    const syncDashboardLayout = () => setIsDashboardDesktop(mediaQuery.matches);

    syncDashboardLayout();
    mediaQuery.addEventListener("change", syncDashboardLayout);

    return () => mediaQuery.removeEventListener("change", syncDashboardLayout);
  }, []);

  return isDashboardDesktop;
}

// ==========================================
// COMPONENTE PRINCIPAL
// ==========================================
export default function Dashboard() {
  const loadStartedAt = useRef<number | null>(null);
  const hasRecordedInitialLoad = useRef(false);
  useEffect(() => { loadStartedAt.current = performance.now(); }, []);
  const isMobile = useIsMobile();
  const isDashboardDesktop = useIsDashboardDesktop();
  const router = useRouter();
  const [mobileChartTab, setMobileChartTab] = useState("funnel");
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [wonDialogOpen, setWonDialogOpen] = useState(false);
  const [firstContactDialogOpen, setFirstContactDialogOpen] = useState(false);
  const [leadEntriesDialogOpen, setLeadEntriesDialogOpen] = useState(false);
  const [visitsDialogOpen, setVisitsDialogOpen] = useState(false);
  const [shouldLoadFilterOptions, setShouldLoadFilterOptions] = useState(false);
  const [entryFilterCapability, setEntryFilterCapability] = useState<{
    organizationId: string | undefined;
    enabled: boolean;
  }>({ organizationId: undefined, enabled: false });
  const dashboardQueryScope = useDashboardQueryScope();
  const activeOrganizationId = dashboardQueryScope.organizationId;
  const entryFilterMode = entryFilterCapability.organizationId === activeOrganizationId
    && entryFilterCapability.enabled;
  const {
    pipelines,
    isError: hasPipelinesError,
    isFetching: isFetchingPipelines,
    refresh: refreshPipelineOptions,
  } = useDashboardPipelineOptions(dashboardQueryScope);
  const { pipelineId, setPipelineId } = useFilters();

  const {
    filters,
    datePreset,
    setDatePreset,
    customDateRange,
    setCustomDateRange,
    clearDateFilter,
    teamId,
    setTeamId,
    userId,
    setUserId,
    source,
    setSource,
    pageId,
    setPageId,
    campaignId,
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
    hasTeamOptionsError,
    hasLeadMetaFiltersError,
    hasDynamicOptionsError,
    isRetryingDynamicOptions,
    refetchLeadMetaFilters,
    refetchTags,
    refetchTeams,
    isFiltersHydrated,
    periodError,
  } = useSharedFilters({
    cacheTrustScope: dashboardQueryScope,
    loadDynamicOptions: shouldLoadFilterOptions,
    pipelineId,
    dateMode: "origin",
    entryMode: entryFilterMode,
    multiCampaigns: true,
    dateRangeMaxDays: MAX_SHARED_REPORT_RANGE_DAYS,
  });
  const dashboardDateRange = filters.dateRange;
  const canQueryDashboard = isFiltersHydrated && !periodError;

  const dashboardFilters = useMemo<DashboardAPIFilters>(
    () => ({
      dateRange: dashboardDateRange,
      pipelineId,
      teamId: filters.teamId,
      userId: filters.userId,
      source: filters.source,
      pageId: filters.pageId,
      campaignIds,
      adSetId: filters.adSetId,
      adId: filters.adId,
      tagIds: filters.tagIds,
      dealStatus: filters.dealStatus,
      searchQuery: filters.searchQuery,
    }),
    [campaignIds, dashboardDateRange, filters, pipelineId],
  );

  // Data hooks - Imobiliário
  const {
    data: stats,
    isLoading: statsLoading,
    isError: statsError,
    isAccessBlocked: statsAccessBlocked,
    isFetching: statsFetching,
    error: statsQueryError,
    refetch: refetchStats,
  } = useEnhancedDashboardStats(dashboardFilters, {
    enabled: canQueryDashboard,
  });
  useEffect(() => {
    if (!activeOrganizationId || !stats || statsError) return;
    const enabled = stats.entryBreakdownAvailable === true;
    let isActive = true;
    queueMicrotask(() => {
      if (!isActive) return;
      setEntryFilterCapability((current) => current.organizationId === activeOrganizationId && current.enabled === enabled
        ? current
        : { organizationId: activeOrganizationId, enabled });
    });
    return () => { isActive = false; };
  }, [activeOrganizationId, stats, statsError]);
  const shouldLoadDealDetails =
    canQueryDashboard && (lostDialogOpen || wonDialogOpen);
  const {
    data: detailedStats,
    isLoading: dealDetailsLoading,
    isError: dealDetailsError,
    isAccessBlocked: detailsAccessBlocked,
    error: dealDetailsQueryError,
    refetch: refetchDealDetails,
  } = useEnhancedDashboardStats(dashboardFilters, {
    enabled: shouldLoadDealDetails,
    includeDetails: true,
  });
  const { data: evolutionResponseData, isLoading: evolutionLoading, isError: evolutionError, refetch: refetchEvolution } =
    useDealsEvolutionData(dashboardFilters, { enabled: canQueryDashboard });
  const evolutionData = evolutionResponseData ?? [];
  const { data: sourcesData = [], isLoading: sourcesLoading, isError: sourcesError, refetch: refetchSources } =
    useLeadSourcesData(dashboardFilters, undefined, {
      enabled: canQueryDashboard && (stats !== undefined || statsError),
      countEntries: stats?.entryBreakdownAvailable === true,
    });
  const {
    data: leadDistribution,
    isLoading: leadDistributionLoading,
    isError: leadDistributionError,
    refetch: refetchLeadDistribution,
  } = useDashboardLeadDistribution(dashboardFilters, {
    enabled: canQueryDashboard,
  });
  // The distribution already includes every eligible active team, even those
  // with no leads. Keep the saved chart selection intact while the page-wide
  // team filter narrows that response to a single team.
  const availableDistributionTeams = useMemo(
    () => !teamId && !leadDistributionError
      ? leadDistribution?.teams
        .filter((team) => team.kind === "entity" && team.id)
        .map((team) => ({ id: team.id as string, name: team.name }))
        .sort((left, right) => left.name.localeCompare(right.name, "pt-BR"))
      : undefined,
    [leadDistribution?.teams, leadDistributionError, teamId],
  );
  const {
    data: firstContactData,
    isLoading: firstContactLoading,
    isError: firstContactError,
    refetch: refetchFirstContact,
  } = useDashboardFirstContact(dashboardFilters, {
    enabled: canQueryDashboard && firstContactDialogOpen,
  });
  const hasOrganization = Boolean(activeOrganizationId);

  const {
    data: extraCounts,
    isLoading: extraCountsLoading,
    isError: extraCountsError,
    isAccessBlocked: extraCountsAccessBlocked,
    isFetching: extraCountsFetching,
    error: extraCountsQueryError,
    refetch: refetchExtraCounts,
  } = useDashboardQuery({
    queryKey: [
      "dashboard-extra-counts",
      activeOrganizationId,
      dashboardQueryScope.currentUserId,
      dashboardQueryScope.accessSignature,
      getDashboardFiltersQueryKey(dashboardFilters),
    ],
    queryFn: ({ signal }) =>
      getDashboardExtraCounts({
        organizationId: activeOrganizationId,
        filters: dashboardFilters,
        signal,
      }),
    enabled: dashboardQueryScope.isReady && canQueryDashboard,
    staleTime: DASHBOARD_EXTRA_COUNTS_STALE_TIME_MS,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  }, dashboardQueryScope);

  const canShowPreviousExtraCounts = getDashboardStatsFailureState(
    extraCounts !== undefined,
    extraCountsError,
    extraCountsQueryError,
  ) === "stale";
  const propertyCount = extraCountsAccessBlocked || (extraCountsError && !canShowPreviousExtraCounts) ? "—" : extraCounts?.propertyCount ?? 0;
  const siteVisits = extraCountsAccessBlocked || (extraCountsError && !canShowPreviousExtraCounts) ? "—" : extraCounts?.siteVisits ?? 0;
  const scheduledVisitsCount = extraCountsAccessBlocked || (extraCountsError && !canShowPreviousExtraCounts) ? "—" : extraCounts?.scheduledVisits ?? 0;
  const kpisLoading =
    !hasOrganization || !isFiltersHydrated || statsLoading || extraCountsLoading;
  const statsFailureState = statsAccessBlocked ? "unavailable" : getDashboardStatsFailureState(
    stats !== undefined,
    statsError,
    statsQueryError,
  );
  const kpisError = statsFailureState === "unavailable";
  const kpisStale = statsFailureState === "stale";
  const dashboardAccessDenied = statsAccessBlocked || (statsError && !shouldDisplayCachedDashboardStats(statsQueryError));
  const dialogFocusScope = dashboardQueryScope.isReady && !dashboardAccessDenied
    ? dashboardQueryScope.accessSignature
    : null;
  const leadsDialogFocus = useDashboardDialogFocus(dialogFocusScope);
  const lostDialogFocus = useDashboardDialogFocus(dialogFocusScope);
  const wonDialogFocus = useDashboardDialogFocus(dialogFocusScope);
  const firstContactDialogFocus = useDashboardDialogFocus(dialogFocusScope);
  const visitsDialogFocus = useDashboardDialogFocus(dialogFocusScope);
  const openLeadEntriesDialog = (trigger: HTMLElement) => {
    leadsDialogFocus.captureTrigger(trigger);
    setLeadEntriesDialogOpen(true);
  };
  const openLostDialog = (trigger: HTMLElement) => {
    lostDialogFocus.captureTrigger(trigger);
    setLostDialogOpen(true);
  };
  const openWonDialog = (trigger: HTMLElement) => {
    wonDialogFocus.captureTrigger(trigger);
    setWonDialogOpen(true);
  };
  const openFirstContactDialog = (trigger: HTMLElement) => {
    firstContactDialogFocus.captureTrigger(trigger);
    setFirstContactDialogOpen(true);
  };
  const openVisitsDialog = (trigger: HTMLElement) => {
    visitsDialogFocus.captureTrigger(trigger);
    setVisitsDialogOpen(true);
  };
  const statsErrorDescription = getDashboardStatsErrorDescription(statsQueryError);
  const evolutionDataLoading =
    !hasOrganization || !isFiltersHydrated || evolutionLoading;
  const sourcesDataLoading =
    !hasOrganization || !isFiltersHydrated || statsLoading || sourcesLoading;

  useEffect(() => {
    if (
      hasOrganization &&
      dashboardQueryScope.isReady &&
      isFiltersHydrated &&
      stats !== undefined &&
      evolutionResponseData !== undefined &&
      !statsError &&
      !evolutionError &&
      loadStartedAt.current !== null &&
      !hasRecordedInitialLoad.current &&
      !statsLoading &&
      !evolutionLoading
    ) {
      performanceTracker.addMetric(
        "Dashboard Stats and Evolution Load",
        performance.now() - loadStartedAt.current,
        "ms",
      );
      hasRecordedInitialLoad.current = true;
    }
  }, [dashboardQueryScope.isReady, hasOrganization, isFiltersHydrated, stats, statsError, evolutionResponseData, evolutionError, statsLoading, evolutionLoading]);

  const funnelComponent = (
    <SalesFunnelWithPipeline
      filters={dashboardFilters}
      enabled={canQueryDashboard}
      pipelineId={pipelineId}
      onPipelineChange={setPipelineId}
    />
  );
  const periodLabel =
    datePresetOptions.find((o) => o.value === datePreset)?.label ||
    "Todos os dados";

  const retryKpis = () => {
    void refetchStats();
    void refetchExtraCounts();
  };

  const kpiData: EnhancedDashboardStats = stats || {
    totalLeads: 0,
    uniqueLeads: 0,
    reentries: 0,
    totalEntries: 0,
    entryBreakdownAvailable: false,
    leadsInProgress: 0,
    leadsClosed: 0,
    leadsLost: 0,
    openLeads: 0,
    lostLeads: 0,
    conversionRate: 0,
    closedLeads: 0,
    wonAverageConversionDays: null,
    wonConversionBuckets: [],
    wonDeals: [],
    wonDealsTruncated: false,
    lostReasonBuckets: [],
    lostDeals: [],
    lostDealsTruncated: false,
    avgResponseTime: "--",
    totalSalesValue: 0,
    pendingCommissions: 0,
    leadsTrend: 0,
    entriesTrend: 0,
    openTrend: 0,
    lostTrend: 0,
    conversionTrend: 0,
    closedTrend: 0,
    totalReceivables: 0,
    totalPayables: 0,
    overdueReceivables: 0,
    overduePayables: 0,
    paidCommissions: 0,
  };
  const clearDashboardFilters = () => {
    clearFilters();
    setPipelineId(null);
  };
  const retryDynamicOptions = () => {
    refreshPipelineOptions();
    void refetchLeadMetaFilters();
    void refetchTags();
    if (dashboardQueryScope.canViewLeadDistribution) void refetchTeams();
  };
  const detailsFailureState = detailsAccessBlocked ? "unavailable" : getDashboardStatsFailureState(detailedStats !== undefined, dealDetailsError, dealDetailsQueryError);
  const dialogDataUnavailable = kpisError || detailsFailureState === "unavailable";
  const dialogData = detailsFailureState === "unavailable" ? kpiData : detailedStats || kpiData;
  const showDealDetailsLoading =
    shouldLoadDealDetails && !dealDetailsError && !detailedStats;
  const selectedBrokerId = userId && userId !== "all" && userId !== "unassigned"
    ? userId
    : null;
  const showSelectedBrokerEvolutionFirst = Boolean(
    dashboardQueryScope.canViewLeadDistribution && selectedBrokerId,
  );

  return (
    <AppLayout title="Dashboard" disableMainScroll={true} borderless>
      <div
        className={cn(
          "dashboard-borderless flex h-full w-full animate-fade-in flex-col gap-3 overflow-hidden pb-1",
          !isMobile ? "flex-1 min-h-0" : "",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 justify-end overflow-visible",
            isMobile ? "p-2" : "px-2 py-1",
          )}
          data-tour="dashboard-filters"
        >
          {!dashboardAccessDenied ? <SharedFilters
            cacheTrustScope={dashboardQueryScope}
            datePreset={datePreset}
            onDatePresetChange={setDatePreset}
            onClearDatePreset={clearDateFilter}
            defaultDatePreset={null}
            customDateRange={customDateRange}
            onCustomDateRangeChange={setCustomDateRange}
            teamId={teamId}
            onTeamChange={setTeamId}
            userId={userId}
            onUserChange={setUserId}
            includeUnassignedUserOption
            pipelineId={pipelineId}
            onPipelineChange={setPipelineId}
            pipelines={pipelines}
            source={source}
            onSourceChange={setSource}
            sourceFilterMaxLength={MAX_DASHBOARD_SOURCE_FILTER_LENGTH}
            dateRangeMaxDays={MAX_SHARED_REPORT_RANGE_DAYS}
            pageId={pageId}
            onPageChange={(id) => {
              setPageId(id);
              setCampaignIds([]);
            }}
            campaignId={campaignId}
            onCampaignChange={(id) => setCampaignIds(id ? [id] : [])}
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
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onClear={clearDashboardFilters}
            hasActiveFilters={hasActiveFilters || Boolean(pipelineId)}
            dynamicSources={dynamicSources}
            pages={pages}
            campaigns={campaigns}
            adSets={adSets}
            ads={ads}
            tags={tags}
            isLoadingSources={isLoadingSources}
            isLoadingPages={isLoadingPages}
            isLoadingCampaigns={isLoadingCampaigns}
            hasCampaignsError={hasLeadMetaFiltersError}
            isLoadingAdSets={isLoadingAdSets}
            isLoadingAds={isLoadingAds}
            isLoadingTags={isLoadingTags}
            hasTagsError={hasTagsError}
            hasDynamicOptionsError={hasDynamicOptionsError || hasPipelinesError}
            isRetryingDynamicOptions={isRetryingDynamicOptions || isFetchingPipelines}
            onRetryDynamicOptions={retryDynamicOptions}
            loadDynamicOptions={shouldLoadFilterOptions}
            onFiltersOpenChange={(open) => {
              if (!open) return;
              setShouldLoadFilterOptions(true);
              refreshPipelineOptions();
              if (hasLeadMetaFiltersError) void refetchLeadMetaFilters();
              if (hasTagsError) void refetchTags();
              if (hasTeamOptionsError) void refetchTeams();
            }}
            tourPrefix="dashboard"
          /> : null}
        </div>

        {periodError ? (
          <FilterPeriodNotice message={periodError} onClear={clearDateFilter} />
        ) : dashboardAccessDenied ? (
          <DashboardDataError message={statsErrorDescription} onRetry={retryKpis} isRetrying={statsFetching} />
        ) : isDashboardDesktop === null ? (
          <div className="min-h-[420px] flex-1 rounded-[8px] bg-[var(--app-surface-soft)]" />
        ) : isDashboardDesktop ? (
          <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto pb-5">
            <div className={DASHBOARD_LAYOUT.desktopFirstRow}>
              <div className="col-span-8 flex min-h-0 flex-col gap-3">
                <div className="shrink-0">
                  {kpisError ? (
                    <DashboardDataError message={statsErrorDescription} onRetry={retryKpis} isRetrying={statsFetching} />
                  ) : (
                    <DashboardKpiGrid
                      layout="desktop"
                      data={kpiData}
                      isLoading={kpisLoading}
                      periodLabel={periodLabel}
                      evolution={evolutionError ? [] : evolutionData}
                      propertyCount={propertyCount}
                      siteVisits={siteVisits}
                      scheduledVisits={scheduledVisitsCount}
                      onLeadsClick={dashboardQueryScope.isReady && isFiltersHydrated ? openLeadEntriesDialog : undefined}
                      onLostClick={openLostDialog}
                      onWonClick={openWonDialog}
                      onVisitsClick={openVisitsDialog}
                      onFirstContactClick={dashboardQueryScope.canViewLeadDistribution ? openFirstContactDialog : undefined}
                    />
                  )}
                  {kpisStale ? <DashboardStatsStaleNotice onRetry={retryKpis} isRetrying={statsFetching} /> : null}
                  {extraCountsError || extraCountsAccessBlocked ? <DashboardExtraCountsError onRetry={() => void refetchExtraCounts()} hasPreviousData={canShowPreviousExtraCounts} isRetrying={extraCountsFetching} /> : null}
                </div>

                {dashboardQueryScope.canViewLeadDistribution && !showSelectedBrokerEvolutionFirst ? (
                  <div className="min-h-0 flex-1">
                    <LeadDistributionSection
                      display="users"
                      selectedTeamId={teamId}
                      selectedUserId={userId}
                      selectedBrokerId={selectedBrokerId}
                      onBrokerSelect={setUserId}
                      data={leadDistribution}
                      isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                      isError={leadDistributionError}
                      onRetry={() => void refetchLeadDistribution()}
                      organizationId={activeOrganizationId}
                      currentUserId={dashboardQueryScope.currentUserId}
                      availableTeams={availableDistributionTeams}
                    />
                  </div>
                ) : (
                  <div data-tour="dashboard-evolution" className="min-h-0 flex-1">
                    <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} isError={evolutionError} onRetry={() => void refetchEvolution()} />
                  </div>
                )}
              </div>

              <div className="col-span-4 flex min-h-0 flex-col gap-3">
                <div data-tour="dashboard-funnel" className="h-[48%] min-h-0">
                  {funnelComponent}
                </div>
                <div data-tour="dashboard-sources" className="h-[52%] min-h-0">
                  <LeadSourcesChart
                    data={sourcesData}
                    countEntries={stats?.entryBreakdownAvailable === true}
                    isLoading={sourcesDataLoading}
                    isError={sourcesError}
                    onRetry={() => void refetchSources()}
                    selectedSource={source}
                    onSourceChange={setSource}
                  />
                </div>
              </div>
            </div>

            {dashboardQueryScope.canViewLeadDistribution ? (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
                <div
                  data-tour={showSelectedBrokerEvolutionFirst ? undefined : "dashboard-evolution"}
                  className="h-[360px] min-w-0 lg:col-span-8"
                >
                  {showSelectedBrokerEvolutionFirst ? (
                    <LeadDistributionSection
                      display="users"
                      selectedTeamId={teamId}
                      selectedUserId={userId}
                      selectedBrokerId={selectedBrokerId}
                      onBrokerSelect={setUserId}
                      data={leadDistribution}
                      isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                      isError={leadDistributionError}
                      onRetry={() => void refetchLeadDistribution()}
                      organizationId={activeOrganizationId}
                      currentUserId={dashboardQueryScope.currentUserId}
                      availableTeams={availableDistributionTeams}
                    />
                  ) : (
                    <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} isError={evolutionError} onRetry={() => void refetchEvolution()} />
                  )}
                </div>
                <div className="h-[360px] min-w-0 lg:col-span-4">
                  <LeadDistributionSection
                    display="teams"
                    selectedTeamId={teamId}
                    data={leadDistribution}
                    isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                    isError={leadDistributionError}
                    onRetry={() => void refetchLeadDistribution()}
                    organizationId={activeOrganizationId}
                    currentUserId={dashboardQueryScope.currentUserId}
                    availableTeams={availableDistributionTeams}
                  />
                </div>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
                <CampaignLeadsChart filters={dashboardFilters} filtersReady={isFiltersHydrated} />
              </div>
              <div className="min-w-0 lg:col-span-4">
                <TopCreativesCard filters={dashboardFilters} filtersReady={isFiltersHydrated} />
              </div>
            </div>
          </div>
        ) : (
          <div className="scrollbar-hidden min-h-0 flex-1 space-y-4 overflow-y-auto pb-5">
            <section>
              {kpisError ? (
                <DashboardDataError message={statsErrorDescription} onRetry={retryKpis} isRetrying={statsFetching} />
              ) : (
                <DashboardKpiGrid
                  layout="mobile"
                  data={kpiData}
                  isLoading={kpisLoading}
                  periodLabel={periodLabel}
                  evolution={evolutionError ? [] : evolutionData}
                  scheduledVisits={scheduledVisitsCount}
                  propertyCount={propertyCount}
                  siteVisits={siteVisits}
                  onLeadsClick={dashboardQueryScope.isReady && isFiltersHydrated ? openLeadEntriesDialog : undefined}
                  onLostClick={openLostDialog}
                  onWonClick={openWonDialog}
                  onVisitsClick={openVisitsDialog}
                  onFirstContactClick={dashboardQueryScope.canViewLeadDistribution ? openFirstContactDialog : undefined}
                />
              )}
              {kpisStale ? <DashboardStatsStaleNotice onRetry={retryKpis} isRetrying={statsFetching} /> : null}
              {extraCountsError || extraCountsAccessBlocked ? <DashboardExtraCountsError onRetry={() => void refetchExtraCounts()} hasPreviousData={canShowPreviousExtraCounts} isRetrying={extraCountsFetching} /> : null}
            </section>

            {!dashboardQueryScope.canViewLeadDistribution || showSelectedBrokerEvolutionFirst ? (
              <div data-tour="dashboard-evolution" className={DASHBOARD_LAYOUT.mobileEvolution}>
                <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} isError={evolutionError} onRetry={() => void refetchEvolution()} />
              </div>
            ) : null}

            {dashboardQueryScope.canViewLeadDistribution && !showSelectedBrokerEvolutionFirst ? (
              <LeadDistributionSection
                display="users"
                selectedTeamId={teamId}
                selectedUserId={userId}
                selectedBrokerId={selectedBrokerId}
                onBrokerSelect={setUserId}
                data={leadDistribution}
                isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                isError={leadDistributionError}
                onRetry={() => void refetchLeadDistribution()}
                organizationId={activeOrganizationId}
                currentUserId={dashboardQueryScope.currentUserId}
                availableTeams={availableDistributionTeams}
              />
            ) : null}

            <section>
              <Tabs value={mobileChartTab === "sources" ? "sources" : "funnel"} onValueChange={setMobileChartTab}>
                <TabsList className="grid h-10 w-full grid-cols-2 gap-1 rounded-[10px] border-0 bg-[var(--app-surface-solid)] p-1 shadow-none">
                  <TabsTrigger
                    value="funnel"
                    className="mx-0 h-8 rounded-[6px] text-[11px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
                  >
                    Funil
                  </TabsTrigger>
                  <TabsTrigger
                    value="sources"
                    className="mx-0 h-8 rounded-[6px] text-[11px] font-light text-[var(--app-text-secondary)] shadow-none data-[state=active]:bg-[var(--app-surface-hover)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none"
                  >
                    Origem
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="funnel" className="mt-3">
                  <div data-tour="dashboard-funnel" className={DASHBOARD_LAYOUT.mobileFunnel}>
                    {funnelComponent}
                  </div>
                </TabsContent>
                <TabsContent value="sources" className="mt-3">
                  <div data-tour="dashboard-sources" className={DASHBOARD_LAYOUT.mobileSources}>
                    <LeadSourcesChart
                      data={sourcesData}
                      countEntries={stats?.entryBreakdownAvailable === true}
                      isLoading={sourcesDataLoading}
                      isError={sourcesError}
                      onRetry={() => void refetchSources()}
                      selectedSource={source}
                      onSourceChange={setSource}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </section>

            {dashboardQueryScope.canViewLeadDistribution ? (
              <>
                {showSelectedBrokerEvolutionFirst ? (
                  <div className={DASHBOARD_LAYOUT.mobileEvolution}>
                    <LeadDistributionSection
                      display="users"
                      selectedTeamId={teamId}
                      selectedUserId={userId}
                      selectedBrokerId={selectedBrokerId}
                      onBrokerSelect={setUserId}
                      data={leadDistribution}
                      isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                      isError={leadDistributionError}
                      onRetry={() => void refetchLeadDistribution()}
                      organizationId={activeOrganizationId}
                      currentUserId={dashboardQueryScope.currentUserId}
                      availableTeams={availableDistributionTeams}
                    />
                  </div>
                ) : (
                  <div data-tour="dashboard-evolution" className={DASHBOARD_LAYOUT.mobileEvolution}>
                    <DealsEvolutionChart data={evolutionData} isLoading={evolutionDataLoading} isError={evolutionError} onRetry={() => void refetchEvolution()} />
                  </div>
                )}
                <LeadDistributionSection
                  display="teams"
                  selectedTeamId={teamId}
                  data={leadDistribution}
                  isLoading={!hasOrganization || !isFiltersHydrated || leadDistributionLoading}
                  isError={leadDistributionError}
                  onRetry={() => void refetchLeadDistribution()}
                  organizationId={activeOrganizationId}
                  currentUserId={dashboardQueryScope.currentUserId}
                  availableTeams={availableDistributionTeams}
                />
              </>
            ) : null}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="min-w-0 lg:col-span-8">
                <CampaignLeadsChart filters={dashboardFilters} filtersReady={isFiltersHydrated} />
              </div>
              <div className="min-w-0 lg:col-span-4">
                <TopCreativesCard filters={dashboardFilters} filtersReady={isFiltersHydrated} />
              </div>
            </div>
          </div>
        )}
      </div>

      <DashboardLeadEntriesDialog
        open={leadEntriesDialogOpen}
        onOpenChange={setLeadEntriesDialogOpen}
        onCloseAutoFocus={leadsDialogFocus.onCloseAutoFocus}
        onNavigate={leadsDialogFocus.skipRestore}
        filters={dashboardFilters}
        available={dashboardQueryScope.isReady && isFiltersHydrated && statsFailureState !== "unavailable" && stats?.entryBreakdownAvailable === true}
        availabilityError={kpisError ? statsErrorDescription : undefined}
        onRetryAvailability={() => void refetchStats()}
      />

      <LostDealsDialog
        open={lostDialogOpen}
        onOpenChange={setLostDialogOpen}
        onCloseAutoFocus={lostDialogFocus.onCloseAutoFocus}
        data={dialogData}
        detailsLoading={showDealDetailsLoading || dealDetailsLoading}
        detailsError={dealDetailsError}
        dataUnavailable={dialogDataUnavailable}
        onRetryDetails={() => void refetchDealDetails()}
        onViewLead={(leadId) => {
          lostDialogFocus.skipRestore();
          setLostDialogOpen(false);
          router.push(`/crm/pipelines?lead=${leadId}`);
        }}
      />

      <WonDealsDialog
        open={wonDialogOpen}
        onOpenChange={setWonDialogOpen}
        onCloseAutoFocus={wonDialogFocus.onCloseAutoFocus}
        data={dialogData}
        detailsLoading={showDealDetailsLoading || dealDetailsLoading}
        detailsError={dealDetailsError}
        dataUnavailable={dialogDataUnavailable}
        onRetryDetails={() => void refetchDealDetails()}
        onViewLead={(leadId) => {
          wonDialogFocus.skipRestore();
          setWonDialogOpen(false);
          router.push(`/crm/pipelines?lead=${leadId}`);
        }}
      />

      <FirstContactDialog
        open={firstContactDialogOpen}
        onOpenChange={setFirstContactDialogOpen}
        onCloseAutoFocus={firstContactDialogFocus.onCloseAutoFocus}
        filters={dashboardFilters}
        data={firstContactData}
        isLoading={firstContactLoading}
        isError={firstContactError || dashboardAccessDenied}
        onRetry={() => void refetchFirstContact()}
      />
      <DashboardVisitsDialog
        open={visitsDialogOpen}
        onOpenChange={setVisitsDialogOpen}
        onCloseAutoFocus={visitsDialogFocus.onCloseAutoFocus}
        onNavigate={visitsDialogFocus.skipRestore}
        filters={dashboardFilters}
        periodLabel={periodLabel}
        accessDenied={dashboardAccessDenied}
      />
    </AppLayout>
  );
}

// ==========================================
// HELPER FUNCTIONS & SUB-COMPONENTS
// ==========================================
function formatKPIValue(value: string | number, format: KPIFormat): string {
  if (typeof value === "string") return value;
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "standard",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    default:
      return value.toLocaleString("pt-BR");
  }
}

function DashboardDataError({
  message,
  onRetry,
  isRetrying,
}: {
  message: string;
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <Card role="alert" className="rounded-[12px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardContent className="flex min-h-[96px] flex-col items-start justify-between gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-destructive/10 text-destructive">
            <XCircle className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
              Não foi possível carregar os indicadores.
            </p>
            <p className="mt-0.5 text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
              {message}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onRetry}
          disabled={isRetrying}
          className="h-8 shrink-0 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
        >
          {isRetrying ? "Atualizando..." : "Tentar novamente"}
        </button>
      </CardContent>
    </Card>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

function formatDateTime(value: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatConversionDays(days: number | null): string {
  if (days === null) return "--";
  if (days === 0) return "Mesmo dia";
  if (days === 1) return "1 dia";
  if (days < 30) return `${days} dias`;
  const months = Math.round(days / 30);
  return months === 1 ? "1 mês" : `${months} meses`;
}

function getInitials(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function DashboardAssigneeAvatar({ name }: { name?: string | null }) {
  const label = name?.trim() || "Sem responsável";

  return (
    <TooltipProvider delayDuration={120}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="flex w-9 justify-end md:w-[34px]" aria-label={label}>
            <div className="flex h-7 w-7 items-center justify-center rounded-[6px] bg-primary/50 text-[9px] font-light text-primary-foreground ring-1 ring-primary/20">
              {name ? getInitials(name) : "--"}
            </div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

type DistributionChartPoint = {
  key: string;
  label: string;
  count: number;
  percentage: number;
  color: string;
};

type DistributionTooltipEntry = {
  value?: string | number;
  color?: string;
  fill?: string;
  payload?: Partial<DistributionChartPoint>;
};

function DistributionTooltip({
  active,
  payload,
  fallbackLabel,
}: {
  active?: boolean;
  payload?: DistributionTooltipEntry[];
  fallbackLabel: string;
}) {
  if (!active || !payload?.length) return null;

  const entry = payload[0];
  const point = entry.payload;
  const count = Number(entry.value || point?.count || 0);
  const leadLabel = count === 1 ? "lead" : "leads";

  return (
    <div className="min-w-[160px] rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-3 py-2.5 text-[var(--app-text-primary)] shadow-none">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 rounded-[4px] ring-2 ring-[var(--app-surface-solid)]"
          style={{ backgroundColor: point?.color || entry.color || entry.fill }}
        />
        <span className="truncate text-[11px] font-light text-[var(--app-text-secondary)]">
          {point?.label || fallbackLabel}
        </span>
      </div>
      <div className="flex items-end justify-between gap-4">
        <span className="text-[11px] font-light text-[var(--app-text-tertiary)]">
          {count} {leadLabel}
        </span>
        <span className="rounded-[6px] bg-[var(--app-surface-soft)] px-2 py-0.5 text-[11px] font-light tabular-nums text-[var(--app-text-primary)]">
          {formatKPIValue(point?.percentage || 0, "percent")}
        </span>
      </div>
    </div>
  );
}

function getSourceLabel(source: string | null | undefined): string {
  const normalizedSource = (source || "").trim();
  const labelKey = normalizedSource.toLowerCase();

  return (
    findDashboardSourceLabel(labelKey) ||
    findDashboardSourceLabel(normalizedSource) ||
    normalizedSource ||
    "Origem não informada"
  );
}

function buildWonSourceBuckets(
  wonDeals: EnhancedDashboardStats["wonDeals"],
  totalWon: number,
): DistributionChartPoint[] {
  const groupedSources = new Map<
    string,
    { key: string; label: string; count: number }
  >();

  for (const deal of wonDeals) {
    const source = (deal.source || "").trim();
    const key = source.toLowerCase() || "sem-origem";
    const current = groupedSources.get(key);

    if (current) {
      current.count += 1;
      continue;
    }

    groupedSources.set(key, {
      key,
      label: getSourceLabel(source),
      count: 1,
    });
  }

  const percentageBase = totalWon > 0 ? totalWon : wonDeals.length;

  const sortedSources = Array.from(groupedSources.values())
    .sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
    );
  const chartSources = sortedSources.slice(0, DASHBOARD_SOURCE_SLICE_LIMIT).map((bucket) => ({ ...bucket, key: `source:${bucket.key}` }));
  if (sortedSources.length > DASHBOARD_SOURCE_SLICE_LIMIT) {
    chartSources.push({
      key: "aggregate:remaining-sources",
      label: "Outras origens",
      count: sortedSources.slice(DASHBOARD_SOURCE_SLICE_LIMIT).reduce((sum, bucket) => sum + bucket.count, 0),
    });
  }
  return chartSources.map((bucket, index) => ({
    ...bucket,
    percentage:
      percentageBase > 0 ? (bucket.count / percentageBase) * 100 : 0,
    color:
      DASHBOARD_CHART_COLORS[(index + 3) % DASHBOARD_CHART_COLORS.length],
  }));
}

function DashboardExtraCountsError({
  onRetry,
  hasPreviousData,
  isRetrying,
}: {
  onRetry: () => void;
  hasPreviousData: boolean;
  isRetrying: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={isRetrying}
      className="mt-2 w-full rounded-[8px] bg-destructive/10 px-3 py-2 text-left text-[11px] text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive"
    >
      {hasPreviousData
        ? "Visitas, imóveis e sessões do site exibem os últimos dados carregados. Tentar novamente."
        : "Visitas, imóveis e sessões do site indisponíveis. Tentar novamente."}
    </button>
  );
}

function DashboardStatsStaleNotice({
  onRetry,
  isRetrying,
}: {
  onRetry: () => void;
  isRetrying: boolean;
}) {
  return (
    <div role="status" className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-amber-500/[0.08] px-3 py-2 text-[11px] text-[var(--app-text-secondary)]">
      <span>Atualização indisponível. Exibindo os últimos indicadores carregados para estes filtros.</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={isRetrying}
        className="shrink-0 font-normal text-primary transition-colors hover:underline disabled:opacity-50"
      >
        {isRetrying ? "Atualizando..." : "Tentar novamente"}
      </button>
    </div>
  );
}

function DashboardDealDetailsState({
  hasError,
  onRetry,
}: {
  hasError: boolean;
  onRetry: () => void;
}) {
  if (hasError) {
    return (
      <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
        <p>Não foi possível carregar os registros detalhados.</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-2 rounded-[6px] bg-primary/15 px-3 py-1.5 text-[11px] font-normal text-primary transition-colors hover:bg-primary/25"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className="space-y-2 rounded-[8px] bg-[var(--app-surface-solid)] p-3"
    >
      <span className="sr-only">Carregando registros detalhados</span>
      <Skeleton className="h-10 w-full rounded-[6px]" />
      <Skeleton className="h-10 w-full rounded-[6px]" />
      <Skeleton className="h-10 w-4/5 rounded-[6px]" />
    </div>
  );
}

function LostDealsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
  detailsLoading,
  detailsError,
  dataUnavailable,
  onRetryDetails,
  onViewLead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  data: EnhancedDashboardStats;
  detailsLoading: boolean;
  detailsError: boolean;
  dataUnavailable: boolean;
  onRetryDetails: () => void;
  onViewLead: (leadId: string) => void;
}) {
  const lostDeals = data.lostDeals || [];
  const reasonBuckets = [...(data.lostReasonBuckets || [])]
    .filter((bucket) => bucket.count > 0)
    .sort(
      (a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR"),
    );
  const totalLost = data.lostLeads || lostDeals.length;
  const lostDetailsTruncated =
    data.lostDealsTruncated || lostDeals.length < totalLost;
  const topReason = reasonBuckets[0];
  const otherBucket = reasonBuckets.find((bucket) => bucket.key === "outros");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="dashboard-lost-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <XCircle className="h-3.5 w-3.5" />
            </span>
            <span>Perdidos - Motivos de Perda</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {dataUnavailable ? <DashboardDealDetailsState hasError={true} onRetry={onRetryDetails} /> : <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Perdidos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums text-destructive">
                          {totalLost.toLocaleString("pt-BR")}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Motivos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {reasonBuckets.length}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Principal motivo
                </p>
                <p
                  title={topReason?.label || undefined}
                  className="mt-1 line-clamp-2 text-[14px] font-normal leading-5"
                >
                  {topReason?.label || "--"}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Outros
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {otherBucket?.count || 0}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-normal">
                    Distribuição dos motivos
                  </h3>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                  <PieChartIcon className="h-3.5 w-3.5" />
                </span>
              </div>

              {reasonBuckets.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhuma perda registrada nesse período.
                </div>
              ) : (
                <div className="grid min-w-0 gap-3 md:grid-cols-[190px_minmax(0,1fr)] md:items-center">
                  <div className="dashboard-recharts-focusless relative mx-auto h-[150px] w-full max-w-[170px] sm:h-[180px] sm:max-w-[190px]">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={1}
                      minHeight={1}
                      initialDimension={DIALOG_CHART_INITIAL_DIMENSION}
                    >
                      <PieChart>
                        <Pie
                          data={reasonBuckets}
                          cx="50%"
                          cy="50%"
                          innerRadius="58%"
                          outerRadius="92%"
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                          stroke="transparent"
                          strokeWidth={0}
                        >
                          {reasonBuckets.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={
                            <DistributionTooltip fallbackLabel="Motivo" />
                          }
                          cursor={false}
                          wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                        Perdas
                      </span>
                      <span className="text-[30px] font-normal leading-tight text-[var(--app-text-primary)]">
                        {totalLost}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    {reasonBuckets.map((bucket) => (
                      <div
                        key={bucket.key}
                        className="flex min-w-0 items-center gap-3 text-xs"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-[4px]"
                              style={{ backgroundColor: bucket.color }}
                            />
                            <span className="truncate font-light">
                              {bucket.label}
                            </span>
                          </div>
                          <div className="h-2.5 overflow-hidden rounded-[4px] bg-[var(--app-surface-solid)]">
                            <div
                              className="h-full rounded-[4px] transition-[width] duration-200"
                              style={{
                                width: `${Math.max(4, Math.min(100, bucket.percentage || 0))}%`,
                                backgroundColor: bucket.color,
                              }}
                            />
                          </div>
                        </div>
                        <div className="flex min-w-[76px] shrink-0 flex-col items-end gap-0.5 sm:min-w-[118px] sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                          <span className="font-normal tabular-nums">
                            {bucket.count.toLocaleString("pt-BR")}
                          </span>
                          <span
                            className="font-normal tabular-nums"
                            style={{ color: bucket.color }}
                          >
                            {formatKPIValue(bucket.percentage || 0, "percent")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-light">
                  {lostDetailsTruncated ? "Perdidos mais recentes" : "Perdidos do período"}
                </h3>
                <span className="shrink-0 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {lostDetailsTruncated
                    ? `${lostDeals.length} de ${totalLost} registros`
                    : `${lostDeals.length} registros`}
                </span>
              </div>

              {detailsLoading || detailsError ? (
                <DashboardDealDetailsState
                  hasError={detailsError}
                  onRetry={onRetryDetails}
                />
              ) : lostDeals.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum lead perdido nesse período.
                </div>
              ) : (
                <div className="dashboard-dialog-list overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
                  {lostDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="dashboard-dialog-list-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-3 text-[12px] transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-[0.8fr_1.3fr_34px_220px_auto] md:items-center md:gap-y-2"
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                          {deal.name}
                        </p>
                        <p className="break-all text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {getDashboardSourceLabel(deal.source)}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          Motivo
                        </p>
                        <p className="truncate text-[12px] font-normal text-destructive">
                          {deal.lostReasonGroup}
                        </p>
                        <p className="break-words text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {deal.lostReason}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1 md:flex md:justify-center">
                        <span className="block truncate text-[11px] text-[var(--app-text-secondary)] md:hidden">
                          Responsável:{" "}
                          <span className="font-normal text-[var(--app-text-primary)]">
                            {deal.assignedUserName || "Sem responsável"}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <DashboardAssigneeAvatar
                            name={deal.assignedUserName}
                          />
                        </span>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-1 md:text-right">
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                            Entrada
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--app-text-primary)]">
                            {formatDateTime(deal.createdAt)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-destructive/75">
                            Perda
                          </p>
                          <p className="truncate text-[11px] font-light text-destructive">
                            {formatDateTime(deal.lostAt)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        aria-label={`Visualizar ${deal.name}`}
                        className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 md:col-span-1 md:h-9"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Visualizar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function WonDealsDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  data,
  detailsLoading,
  detailsError,
  dataUnavailable,
  onRetryDetails,
  onViewLead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
  data: EnhancedDashboardStats;
  detailsLoading: boolean;
  detailsError: boolean;
  dataUnavailable: boolean;
  onRetryDetails: () => void;
  onViewLead: (leadId: string) => void;
}) {
  const wonDeals = data.wonDeals || [];
  const totalWon = data.closedLeads || 0;
  const wonDetailsTruncated =
    data.wonDealsTruncated || wonDeals.length < totalWon;
  const totalVgv = data.totalSalesValue || 0;
  const averageTicket = totalWon > 0 ? totalVgv / totalWon : 0;
  const sourceBuckets = buildWonSourceBuckets(
    wonDeals,
    wonDetailsTruncated ? wonDeals.length : totalWon,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        data-tour="dashboard-won-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        className="dashboard-dialog-shell flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-[min(720px,calc(100dvh-32px))] sm:max-h-[calc(100dvh-32px)] sm:w-[min(960px,calc(100vw-32px))] sm:max-w-[960px] [&>button.absolute]:right-3 [&>button.absolute]:top-3 [&>button.absolute]:grid [&>button.absolute]:h-9 [&>button.absolute]:w-9 [&>button.absolute]:place-items-center sm:[&>button.absolute]:right-4 sm:[&>button.absolute]:top-4"
      >
        <DialogHeader className="shrink-0 px-4 pb-3 pr-14 pt-[calc(0.75rem+env(safe-area-inset-top))] text-left sm:px-5 sm:pt-4">
          <DialogTitle className="flex items-center gap-2.5 text-[14px] font-light leading-snug text-[var(--app-text-primary)]">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
              <Trophy className="h-3.5 w-3.5" />
            </span>
            <span>Ganhos - Tempo de Conversão</span>
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="dashboard-dialog-scroll min-h-0 flex-1 overflow-x-hidden">
          <div className="space-y-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-5 sm:pb-5">
            {dataUnavailable ? <DashboardDealDetailsState hasError={true} onRetry={onRetryDetails} /> : <>
            <div className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4">
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Ganhos
                </p>
                <p className="mt-1 text-[20px] font-normal leading-tight tabular-nums">
                  {totalWon}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Conversão
                </p>
                <p
                  className={cn(
                    "mt-1 text-[20px] font-normal leading-tight tabular-nums",
                    data.conversionRate > 0
                      ? "text-[var(--lead-status-won-fg)]"
                      : "text-destructive",
                  )}
                >
                  {formatKPIValue(data.conversionRate || 0, "percent")}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  VGV dos ganhos
                </p>
                <p className="mt-1 break-all text-[18px] font-normal leading-tight tabular-nums text-[var(--lead-status-won-fg)]">
                  {formatCurrency(totalVgv)}
                </p>
              </div>
              <div className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none">
                <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                  Ticket médio
                </p>
                <p className="mt-1 break-all text-[18px] font-normal leading-tight tabular-nums">
                  {formatCurrency(averageTicket)}
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-[14px] font-normal">
                    Origem exibida e tempo dos ganhos
                  </h3>
                  <p className="text-[12px] font-light leading-[18px] text-[var(--app-text-tertiary)]">
                    {wonDetailsTruncated
                      ? "A origem considera os registros recentes exibidos; o tempo de conversão considera o total."
                      : "Pizza por origem e tempo até o ganho dos leads captados no período filtrado."}
                  </p>
                </div>
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground">
                  <PieChartIcon className="h-3.5 w-3.5" />
                </span>
              </div>

              {detailsLoading || detailsError ? (
                <DashboardDealDetailsState
                  hasError={detailsError}
                  onRetry={onRetryDetails}
                />
              ) : sourceBuckets.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum lead captado nesse período está ganho.
                </div>
              ) : (
                <div className="grid min-w-0 gap-3 md:grid-cols-[190px_minmax(0,1fr)] md:items-center">
                  <div className="dashboard-recharts-focusless relative mx-auto h-[150px] w-full max-w-[170px] sm:h-[180px] sm:max-w-[190px]">
                    <ResponsiveContainer
                      width="100%"
                      height="100%"
                      minWidth={1}
                      minHeight={1}
                      initialDimension={DIALOG_CHART_INITIAL_DIMENSION}
                    >
                      <PieChart>
                        <Pie
                          data={sourceBuckets}
                          cx="50%"
                          cy="50%"
                          innerRadius="52%"
                          outerRadius="76%"
                          paddingAngle={3}
                          dataKey="count"
                          nameKey="label"
                          stroke="transparent"
                          strokeWidth={0}
                        >
                          {sourceBuckets.map((entry) => (
                            <Cell key={entry.key} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip
                          content={
                            <DistributionTooltip fallbackLabel="Origem" />
                          }
                          cursor={false}
                          wrapperStyle={{ zIndex: 30, pointerEvents: "none" }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                      <span className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                        {wonDetailsTruncated ? "Exibidos" : "Ganhos"}
                      </span>
                      <span className="text-[30px] font-normal leading-tight text-[var(--app-text-primary)]">
                        {wonDetailsTruncated ? wonDeals.length : totalWon}
                      </span>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-3">
                    {data.wonConversionBuckets.map((bucket) => {
                      const hasDeals = bucket.count > 0;
                      const width = hasDeals
                        ? Math.max(4, Math.min(100, bucket.percentage || 0))
                        : 0;

                      return (
                        <div
                          key={bucket.key}
                          className={cn(
                            "grid gap-1.5 text-xs sm:grid-cols-[140px_1fr_70px_70px] sm:items-center sm:gap-3",
                            !hasDeals && "opacity-55",
                          )}
                        >
                          <div className="flex min-w-0 items-center justify-between gap-3 sm:contents">
                            <span
                              className={cn(
                                "min-w-0 truncate text-muted-foreground",
                                !hasDeals && "text-[11px]",
                              )}
                            >
                              {bucket.label}
                            </span>
                            <div className="flex shrink-0 items-center gap-3 sm:contents">
                              <span
                                className={cn(
                                  "text-right font-normal tabular-nums",
                                  !hasDeals && "text-[11px]",
                                )}
                              >
                                {bucket.count}
                              </span>
                              <span
                                className={cn(
                                  "text-right font-normal tabular-nums",
                                  !hasDeals && "text-[11px]",
                                )}
                                style={{ color: bucket.color }}
                              >
                                {formatKPIValue(
                                  bucket.percentage || 0,
                                  "percent",
                                )}
                              </span>
                            </div>
                          </div>
                          <div
                            className={cn(
                              "overflow-hidden rounded-[4px] bg-[var(--app-surface-solid)] sm:col-start-2 sm:row-start-1",
                              hasDeals ? "h-2.5 sm:h-3" : "h-1.5",
                            )}
                          >
                            <div
                              className="h-full rounded-[4px] transition-[width] duration-200"
                              style={{
                                width: `${width}%`,
                                backgroundColor: bucket.color,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-soft)] p-3 shadow-none sm:p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-[14px] font-light">
                  {wonDetailsTruncated ? "Ganhos mais recentes" : "Ganhos do período"}
                </h3>
                <span className="shrink-0 text-[12px] font-light text-[var(--app-text-tertiary)]">
                  {wonDetailsTruncated
                    ? `${wonDeals.length} de ${totalWon} registros`
                    : `${wonDeals.length} registros`}
                </span>
              </div>

              {detailsLoading || detailsError ? (
                <DashboardDealDetailsState
                  hasError={detailsError}
                  onRetry={onRetryDetails}
                />
              ) : wonDeals.length === 0 ? (
                <div className="rounded-[8px] bg-[var(--app-surface-solid)] p-4 text-center text-[12px] font-light leading-[18px] text-[var(--app-text-secondary)]">
                  Nenhum lead captado nesse período está ganho.
                </div>
              ) : (
                <div className="dashboard-dialog-list overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
                  {wonDeals.map((deal) => (
                    <div
                      key={deal.id}
                      className="dashboard-dialog-list-row grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-3 p-3 text-[12px] transition-colors hover:bg-[var(--app-surface-hover)] md:grid-cols-[1fr_34px_220px_0.75fr_auto] md:items-center md:gap-y-2"
                    >
                      <div className="col-span-2 min-w-0 md:col-span-1">
                        <p className="truncate text-[12px] font-normal text-[var(--app-text-primary)]">
                          {deal.name}
                        </p>
                        <p className="break-all text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {getDashboardSourceLabel(deal.source)}
                        </p>
                      </div>
                      <div className="col-span-2 min-w-0 md:col-span-1 md:flex md:justify-center">
                        <span className="block truncate text-[11px] text-[var(--app-text-secondary)] md:hidden">
                          Responsável:{" "}
                          <span className="font-normal text-[var(--app-text-primary)]">
                            {deal.assignedUserName || "Sem responsável"}
                          </span>
                        </span>
                        <span className="hidden md:block">
                          <DashboardAssigneeAvatar
                            name={deal.assignedUserName}
                          />
                        </span>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-3 md:col-span-1">
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--app-text-tertiary)]">
                            Entrada
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--app-text-primary)]">
                            {formatDateTime(deal.createdAt)}
                          </p>
                        </div>
                        <div className="min-w-0">
                          <p className="text-[10px] font-light text-[var(--lead-status-won-fg)] opacity-75">
                            Ganho
                          </p>
                          <p className="truncate text-[11px] font-light text-[var(--lead-status-won-fg)]">
                            {formatDateTime(deal.wonAt)}
                          </p>
                        </div>
                      </div>
                      <div className="md:text-right">
                        <p className="text-[12px] font-normal text-[var(--lead-status-won-fg)]">
                          {formatCurrency(deal.value)}
                        </p>
                        <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                          {formatConversionDays(deal.conversionDays)}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onViewLead(deal.id)}
                        aria-label={`Visualizar ${deal.name}`}
                        className="col-span-2 inline-flex h-10 items-center justify-center gap-1.5 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none transition-colors hover:bg-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40 md:col-span-1 md:h-9"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        Visualizar
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
