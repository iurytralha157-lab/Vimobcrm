"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  BarChart3,
  CircleAlert,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  RefreshCw,
  Settings2,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useMarketingDashboard,
  useMarketingScopeFilters,
} from "@/hooks/marketing";
import { getDateRangeFromPreset } from "@/hooks/use-dashboard-filters";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { getMarketingDashboardErrorState } from "@/lib/analytics/marketing-dashboard-error";
import { cn } from "@/lib/utils";

import { MarketingDataState } from "./MarketingDataState";
import {
  MarketingScopeFilters,
  type MarketingScopeFilterOption,
} from "./MarketingScopeFilters";
import { MarketingTabViews } from "./MarketingTabViews";
import {
  MARKETING_TABS,
  type MarketingTab,
  type MarketingTabHrefs,
} from "./marketing-tabs";

const INTEGRATION_HREF = "/settings/integrations/meta";

function uniqueScopeOptions(options: MarketingScopeFilterOption[]) {
  const unique = new Map<string, string>();
  options.forEach((option) => {
    const value = option.value.trim();
    const label = option.label.trim();
    if (value && label && !unique.has(value)) unique.set(value, label);
  });
  return Array.from(unique, ([value, label]) => ({ value, label })).sort(
    (left, right) => left.label.localeCompare(right.label, "pt-BR"),
  );
}

function formatObjectiveLabel(value: string) {
  return value
    .toLocaleLowerCase("pt-BR")
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}

const TAB_ICONS: Record<MarketingTab, LucideIcon> = {
  overview: LayoutDashboard,
  paid: BarChart3,
  media: ImageIcon,
  acquisition: Share2,
  social: Megaphone,
};

interface MarketingScreenProps {
  activeTab: MarketingTab;
  tabHrefs: MarketingTabHrefs;
}

function MarketingSkeleton() {
  return (
    <div className="space-y-4" aria-label="Carregando dados de Marketing">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, index) => (
          <Skeleton
            key={index}
            className="h-[92px] rounded-[8px] bg-[var(--app-surface-solid)]"
          />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <Skeleton className="h-[330px] rounded-[8px] bg-[var(--app-surface-solid)]" />
        <Skeleton className="h-[330px] rounded-[8px] bg-[var(--app-surface-solid)]" />
      </div>
    </div>
  );
}

export function MarketingScreen({ activeTab, tabHrefs }: MarketingScreenProps) {
  const usesPaidMediaScope = activeTab !== "social";
  const sharedFilters = useSharedFilters({ loadDynamicOptions: true });
  const marketingScope = useMarketingScopeFilters();
  const marketingDateRange = useMemo(
    () =>
      sharedFilters.filters.dateRange ?? getDateRangeFromPreset("last30days"),
    [sharedFilters.filters.dateRange],
  );
  const dashboardFilters = useMemo(
    () => ({
      ...sharedFilters.filters,
      datePreset: sharedFilters.datePreset ?? "last30days",
      dateRange: marketingDateRange,
      teamId: null,
      userId: null,
      source: null,
      pageId: sharedFilters.filters.pageId,
      campaignId: usesPaidMediaScope
        ? sharedFilters.filters.campaignId
        : null,
      adSetId: usesPaidMediaScope ? sharedFilters.filters.adSetId : null,
      adId: usesPaidMediaScope ? sharedFilters.filters.adId : null,
      tagIds: [],
      dealStatus: null,
      searchQuery: "",
      accountId: usesPaidMediaScope ? marketingScope.accountId : null,
      objective: usesPaidMediaScope ? marketingScope.objective : null,
    }),
    [
      marketingScope.accountId,
      marketingScope.objective,
      marketingDateRange,
      sharedFilters.datePreset,
      sharedFilters.filters,
      usesPaidMediaScope,
    ],
  );
  const model = useMarketingDashboard(dashboardFilters);
  const data = model.insightsQuery.data;
  const insightsError = model.insightsQuery.error;
  const errorState = getMarketingDashboardErrorState(insightsError);
  const hasStaleDataError = Boolean(data && model.insightsQuery.isError);
  const hasInvalidFilters = errorState.shouldClearFilters;
  const dataDependentTab = activeTab !== "social";
  // prettier-ignore
  const canSyncIntegration = model.canManageIntegration && model.integrationState.isConnected && model.canSyncIntegration;
  const hasSynchronizedData = Boolean(
    data?.lastSync ||
    data?.dataQuality.hasDailyFacts ||
    data?.campaigns.length ||
    data?.topCreatives.length ||
    data?.media.length ||
    data?.dailyData.length ||
    data?.social.lastSync ||
    data?.summary.totalLeads ||
    data?.summary.totalWon ||
    data?.summary.totalRevenue ||
    data?.summary.conversations_count,
  );
  const scopeOptions = useMemo(() => {
    const responseOptions = data?.filterOptions ?? {
      accounts: [],
      objectives: [],
    };
    const accounts = uniqueScopeOptions([
      ...responseOptions.accounts.map((account) => ({
        value: account.id,
        label: account.currency
          ? `${account.name} · ${account.currency}`
          : account.name,
      })),
      ...(marketingScope.accountId
        ? [{ value: marketingScope.accountId, label: marketingScope.accountId }]
        : []),
    ]);

    const campaigns = uniqueScopeOptions([
      ...(!marketingScope.accountId && !marketingScope.objective
        ? sharedFilters.campaigns.map((campaign) => ({
            value: campaign.id,
            label: campaign.name,
          }))
        : []),
      ...(data?.campaigns ?? []).map((campaign) => ({
        value: campaign.campaign_id,
        label: campaign.campaign_name,
      })),
      ...(sharedFilters.campaignId
        ? [{ value: sharedFilters.campaignId, label: sharedFilters.campaignId }]
        : []),
    ]);

    const pages = uniqueScopeOptions([
      ...sharedFilters.pages.map((page) => ({
        value: page.id,
        label: page.name,
      })),
      ...(sharedFilters.pageId
        ? [{ value: sharedFilters.pageId, label: sharedFilters.pageId }]
        : []),
    ]);

    const adSets = uniqueScopeOptions([
      ...(!marketingScope.accountId &&
      !marketingScope.objective &&
      !sharedFilters.campaignId
        ? sharedFilters.adSets.map((adSet) => ({
            value: adSet.id,
            label: adSet.name,
          }))
        : []),
      ...(data?.campaigns ?? [])
        .filter(
          (campaign) =>
            !sharedFilters.campaignId ||
            campaign.campaign_id === sharedFilters.campaignId,
        )
        .flatMap((campaign) =>
          campaign.adsets.map((adSet) => ({
            value: adSet.adset_id,
            label: adSet.adset_name,
          })),
        ),
      ...(sharedFilters.adSetId
        ? [{ value: sharedFilters.adSetId, label: sharedFilters.adSetId }]
        : []),
    ]);

    const objectives = uniqueScopeOptions([
      ...responseOptions.objectives,
      ...(data?.campaigns ?? []).flatMap((campaign) =>
        campaign.objective
          ? [
              {
                value: campaign.objective,
                label: formatObjectiveLabel(campaign.objective),
              },
            ]
          : [],
      ),
      ...(marketingScope.objective
        ? [
            {
              value: marketingScope.objective,
              label: formatObjectiveLabel(marketingScope.objective),
            },
          ]
        : []),
    ]);

    return { accounts, pages, campaigns, adSets, objectives };
  }, [
    data,
    marketingScope.accountId,
    marketingScope.objective,
    sharedFilters.pageId,
    sharedFilters.pages,
    sharedFilters.adSetId,
    sharedFilters.adSets,
    sharedFilters.campaignId,
    sharedFilters.campaigns,
  ]);

  const clearMarketingScope = () => {
    marketingScope.clearScope();
    sharedFilters.setPageId(null);
    sharedFilters.setCampaignId(null);
    sharedFilters.setAdSetId(null);
    sharedFilters.setAdId(null);
  };

  const changeMarketingAccount = (accountId: string | null) => {
    marketingScope.setAccountId(accountId);
    sharedFilters.setCampaignId(null);
    sharedFilters.setAdSetId(null);
    sharedFilters.setAdId(null);
  };

  const changeMarketingObjective = (objective: string | null) => {
    marketingScope.setObjective(objective);
    sharedFilters.setCampaignId(null);
    sharedFilters.setAdSetId(null);
    sharedFilters.setAdId(null);
  };

  const hasActiveMarketingScope = Boolean(
    sharedFilters.pageId ||
    marketingScope.accountId ||
    sharedFilters.campaignId ||
    sharedFilters.adSetId ||
    marketingScope.objective,
  );
  const hasActiveMarketingFilters =
    Boolean(sharedFilters.pageId) ||
    (usesPaidMediaScope && hasActiveMarketingScope) ||
    (sharedFilters.datePreset !== null && sharedFilters.datePreset !== "last30days");
  const clearAllMarketingFilters = () => {
    marketingScope.clearScope();
    sharedFilters.clearFilters();
  };

  return (
    <AppLayout title="Marketing" borderless>
      <div className="w-full space-y-4 pb-8 sm:pt-1">
        <div className="flex min-w-0 flex-row items-center gap-2">
          <div
            className="app-responsive-tab-list min-w-0 flex-1"
            data-collapse="wide"
          >
            <nav
              aria-label="Áreas de Marketing"
              data-responsive-tab-scroll
              className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              <div className="flex min-w-max gap-1">
                {MARKETING_TABS.map((tab) => {
                  const Icon = TAB_ICONS[tab.key];
                  const isActive = tab.key === activeTab;

                  return (
                    <Link
                      key={tab.key}
                      href={tabHrefs[tab.key]}
                      scroll={false}
                      aria-current={isActive ? "page" : undefined}
                      aria-label={tab.label}
                      data-responsive-tab
                      title={tab.description}
                      className={cn(
                        "mx-0 inline-flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-2.5 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none transition-colors hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30 sm:text-[12px]",
                        isActive &&
                          "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-solid)] hover:text-[var(--app-text-primary)]",
                      )}
                    >
                      <Icon className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">
                        {tab.label}
                      </span>
                    </Link>
                  );
                })}
              </div>
            </nav>
          </div>

          <div className="ml-auto flex min-h-8 w-auto min-w-0 shrink-0 items-center justify-end gap-2">
            {model.canManageIntegration && model.integrationsQuery.isError ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => model.integrationsQuery.refetch()}
                title="Tentar verificar a integração Meta novamente"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] p-0 text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Tentar conexão Meta novamente</span>
              </Button>
            ) : null}

            {model.canManageIntegration ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-8 w-8 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-0 text-[10px] font-light text-[var(--app-text-secondary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] xl:w-auto xl:px-2.5"
              >
                <Link
                  href={INTEGRATION_HREF}
                  title={
                    model.integrationState.isConnected
                      ? model.integrationState.hasMarketingToken
                        ? "Configurar integração Meta"
                        : "Reconectar integração Meta"
                      : "Conectar integração Meta"
                  }
                >
                  <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="sr-only xl:not-sr-only xl:ml-1.5">
                    {model.integrationState.isConnected
                      ? model.integrationState.hasMarketingToken
                        ? "Meta"
                        : "Reconectar"
                      : "Conectar Meta"}
                  </span>
                </Link>
              </Button>
            ) : null}

            {canSyncIntegration ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={model.sync}
                disabled={
                  !model.integrationState.hasAdAccount ||
                  !model.integrationState.hasMarketingToken ||
                  model.syncMutation.isPending
                }
                title={
                  !model.integrationState.hasAdAccount
                    ? "Selecione uma conta de anúncios na integração Meta"
                    : !model.integrationState.hasMarketingToken
                      ? "Reconecte a Meta para liberar ads_read e sincronizar Marketing"
                      : model.syncMutation.isPending
                        ? "Sincronização em andamento"
                        : "Sincronizar o período selecionado com a Meta"
                }
                className="mx-0.5 h-8 w-8 min-w-8 shrink-0 rounded-[6px] border-0 bg-primary/50 p-0 text-primary-foreground shadow-none hover:bg-primary"
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    model.syncMutation.isPending && "animate-spin",
                  )}
                  aria-hidden="true"
                />
                <span className="sr-only">
                  {model.syncMutation.isPending
                    ? "Sincronizando"
                    : "Sincronizar"}
                </span>
              </Button>
            ) : null}

            {data && model.insightsQuery.isFetching && !hasStaleDataError ? (
              <span
                role="status"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[10px] text-[var(--app-text-tertiary)]"
              >
                <RefreshCw
                  className="h-3 w-3 animate-spin"
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">Atualizando</span>
                <span className="sr-only sm:hidden">
                  Atualizando dados de Marketing
                </span>
              </span>
            ) : null}
            <SharedFilters
              datePreset={sharedFilters.datePreset ?? "last30days"}
              onDatePresetChange={sharedFilters.setDatePreset}
              defaultDatePreset="last30days"
              customDateRange={sharedFilters.customDateRange}
              onCustomDateRangeChange={sharedFilters.setCustomDateRange}
              teamId={sharedFilters.teamId}
              onTeamChange={sharedFilters.setTeamId}
              userId={sharedFilters.userId}
              onUserChange={sharedFilters.setUserId}
              source={sharedFilters.source}
              onSourceChange={sharedFilters.setSource}
              pageId={sharedFilters.pageId}
              onPageChange={sharedFilters.setPageId}
              campaignId={sharedFilters.campaignId}
              onCampaignChange={sharedFilters.setCampaignId}
              adSetId={sharedFilters.adSetId}
              onAdSetChange={sharedFilters.setAdSetId}
              adId={sharedFilters.adId}
              onAdChange={sharedFilters.setAdId}
              tagIds={sharedFilters.tagIds}
              onTagsChange={sharedFilters.setTagIds}
              dealStatus={sharedFilters.dealStatus}
              onDealStatusChange={sharedFilters.setDealStatus}
              searchQuery={sharedFilters.searchQuery}
              onSearchChange={sharedFilters.setSearchQuery}
              onClear={clearAllMarketingFilters}
              hasActiveFilters={hasActiveMarketingFilters}
              dynamicSources={sharedFilters.dynamicSources}
              pages={sharedFilters.pages}
              campaigns={sharedFilters.campaigns}
              adSets={sharedFilters.adSets}
              ads={sharedFilters.ads}
              tags={sharedFilters.tags}
              isLoadingSources={sharedFilters.isLoadingSources}
              isLoadingPages={sharedFilters.isLoadingPages}
              isLoadingCampaigns={sharedFilters.isLoadingCampaigns}
              isLoadingAdSets={sharedFilters.isLoadingAdSets}
              isLoadingAds={sharedFilters.isLoadingAds}
              datePosition="start"
              loadDynamicOptions={false}
              mobileIconOnly
              tourPrefix="marketing"
              advancedContentOnly
              hasAdvancedContentFilters={
                Boolean(sharedFilters.pageId) ||
                (usesPaidMediaScope && hasActiveMarketingScope)
              }
              advancedContent={
                <MarketingScopeFilters
                  accountId={marketingScope.accountId}
                  onAccountChange={changeMarketingAccount}
                  accounts={scopeOptions.accounts}
                  pageId={sharedFilters.pageId}
                  onPageChange={sharedFilters.setPageId}
                  pages={scopeOptions.pages}
                  campaignId={sharedFilters.campaignId}
                  onCampaignChange={sharedFilters.setCampaignId}
                  campaigns={scopeOptions.campaigns}
                  adSetId={sharedFilters.adSetId}
                  onAdSetChange={sharedFilters.setAdSetId}
                  adSets={scopeOptions.adSets}
                  objective={marketingScope.objective}
                  onObjectiveChange={changeMarketingObjective}
                  objectives={scopeOptions.objectives}
                  onClear={clearMarketingScope}
                  isLoading={model.insightsQuery.isLoading}
                  pageOnly={!usesPaidMediaScope}
                  variant="panel"
                />
              }
            />
          </div>
        </div>

        {usesPaidMediaScope && sharedFilters.pageId ? (
          <p className="flex items-start gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2.5 py-2 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">
            <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
            As métricas pagas podem ficar parciais: o recorte por página considera
            apenas anúncios cuja página foi identificada na sincronização.
          </p>
        ) : null}

        {hasStaleDataError ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-[8px] bg-warning/10 px-3.5 py-3 text-[11px] font-light text-[var(--app-text-secondary)] sm:flex-row sm:items-center sm:justify-between"
          >
            <span className="flex min-w-0 items-start gap-2">
              <CircleAlert
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning"
                aria-hidden="true"
              />
              <span>
                Os últimos dados válidos continuam visíveis.{" "}
                {errorState.description}
              </span>
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => model.insightsQuery.refetch()}
              disabled={model.insightsQuery.isFetching}
              className="h-8 shrink-0 rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-3 text-[11px] shadow-none hover:bg-[var(--app-surface-hover)]"
            >
              <RefreshCw
                className={cn(
                  "mr-1.5 h-3.5 w-3.5",
                  model.insightsQuery.isFetching && "animate-spin",
                )}
              />
              Tentar novamente
            </Button>
          </div>
        ) : null}
        {model.insightsQuery.isLoading ? (
          <MarketingSkeleton />
        ) : model.insightsQuery.isError && !data ? (
          <MarketingDataState
            kind="error"
            title={errorState.title}
            description={errorState.description}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {hasInvalidFilters ? (
                  <Button
                    type="button"
                    onClick={clearAllMarketingFilters}
                    className="h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                  >
                    Limpar filtros
                  </Button>
                ) : null}
                {errorState.canRetry ? (
                  <Button
                    type="button"
                    variant={hasInvalidFilters ? "ghost" : "default"}
                    onClick={() => model.insightsQuery.refetch()}
                    disabled={model.insightsQuery.isFetching}
                    className={cn(
                      "h-9 rounded-[6px] border-0 px-4 text-[12px] font-light shadow-none",
                      hasInvalidFilters
                        ? "bg-[var(--app-surface-solid)] hover:bg-[var(--app-surface-hover)]"
                        : "bg-primary/50 text-primary-foreground hover:bg-primary",
                    )}
                  >
                    <RefreshCw
                      className={cn(
                        "mr-1.5 h-3.5 w-3.5",
                        model.insightsQuery.isFetching && "animate-spin",
                      )}
                    />
                    Tentar novamente
                  </Button>
                ) : null}
              </div>
            }
          />
        ) : data && (!dataDependentTab || hasSynchronizedData) ? (
          <MarketingTabViews
            activeTab={activeTab}
            model={model}
            tabHrefs={tabHrefs}
          />
        ) : (
          <MarketingDataState
            kind="empty"
            title={
              model.integrationState.hasAdAccount
                ? model.integrationState.hasMarketingToken
                  ? "Ainda não há dados sincronizados"
                  : "Reconecte a Meta para Marketing"
                : "Selecione uma conta de anúncio"
            }
            description={
              model.integrationState.hasAdAccount
                ? model.integrationState.hasMarketingToken
                  ? model.canSyncIntegration
                    ? "Use Sincronizar para buscar o período selecionado. Até lá, as métricas permanecem indisponíveis em vez de exibir zeros enganosos."
                    : model.canManageIntegration
                      ? "A integração está pronta. A sincronização manual precisa ser iniciada por um proprietário ou administrador."
                      : "A integração está pronta, mas ainda não há dados sincronizados para o período selecionado."
                  : model.canManageIntegration
                    ? "A conexão atual recebe leads, mas precisa ser renovada para autorizar Ads Insights com segurança."
                    : "Peça a um administrador para renovar as permissões de Marketing da Meta."
                : model.canManageIntegration
                  ? "A conexão da página recebe leads, mas os indicadores de mídia dependem de uma conta de anúncio autorizada."
                  : "Peça a um administrador para configurar uma conta de anúncio na integração Meta."
            }
            action={
              !model.canManageIntegration ? undefined : model.integrationState
                  .hasAdAccount &&
                model.integrationState.hasMarketingToken &&
                model.canSyncIntegration ? (
                <Button
                  type="button"
                  onClick={model.sync}
                  disabled={model.syncMutation.isPending}
                  className="h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                >
                  <RefreshCw
                    className={cn(
                      "mr-1.5 h-3.5 w-3.5",
                      model.syncMutation.isPending && "animate-spin",
                    )}
                  />
                  {model.syncMutation.isPending
                    ? "Sincronizando"
                    : "Sincronizar período"}
                </Button>
              ) : (
                <Button
                  asChild
                  className="h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                >
                  <Link href={INTEGRATION_HREF}>
                    {!model.integrationState.hasAdAccount
                      ? "Configurar conta Meta"
                      : !model.integrationState.hasMarketingToken
                        ? "Reconectar Meta"
                        : "Revisar integração"}
                  </Link>
                </Button>
              )
            }
          />
        )}
      </div>
    </AppLayout>
  );
}

export default MarketingScreen;
