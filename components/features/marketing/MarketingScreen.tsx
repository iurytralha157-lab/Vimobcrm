"use client";

import Link from "next/link";
import {
  BarChart3,
  BrainCircuit,
  CircleAlert,
  ImageIcon,
  LayoutDashboard,
  Megaphone,
  MessageCircleMore,
  Radio,
  RefreshCw,
  Settings2,
  Share2,
  type LucideIcon,
} from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { SharedFilters } from "@/components/shared/SharedFilters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useMarketingDashboard } from "@/hooks/marketing";
import { useSharedFilters } from "@/hooks/use-shared-filters";
import { VimobAPIError } from "@/lib/api/vimob-error";
import { cn } from "@/lib/utils";
import { DomainValidationError } from "@/lib/validation";

import { MarketingDataState } from "./MarketingDataState";
import { MarketingTabViews } from "./MarketingTabViews";
import {
  MARKETING_TABS,
  type MarketingTab,
  type MarketingTabHrefs,
} from "./marketing-tabs";

const INTEGRATION_HREF = "/settings/integrations/meta";

const TAB_ICONS: Record<MarketingTab, LucideIcon> = {
  overview: LayoutDashboard,
  acquisition: Share2,
  paid: BarChart3,
  media: ImageIcon,
  social: Megaphone,
  relationship: MessageCircleMore,
  reputation: Radio,
  intelligence: BrainCircuit,
};

interface MarketingScreenProps {
  activeTab: MarketingTab;
  tabHrefs: MarketingTabHrefs;
}

function formatDateTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function isInvalidMarketingFilterError(error: unknown) {
  return (
    (error instanceof DomainValidationError && error.direction === "input") ||
    (error instanceof VimobAPIError && error.code === "invalid_analytics_filters")
  );
}

function marketingErrorDescription(error: unknown) {
  if (isInvalidMarketingFilterError(error)) {
    return "O período ou um filtro salvo não é mais válido. Limpe os filtros e selecione o período novamente.";
  }
  if (error instanceof DomainValidationError && error.direction === "response") {
    return "A API respondeu em um formato incompatível com esta versão do CRM. Nenhum número foi estimado.";
  }
  return error instanceof Error
    ? error.message
    : "Tente novamente. Nenhum número foi estimado enquanto a consulta falhou.";
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
  const sharedFilters = useSharedFilters();
  const model = useMarketingDashboard(sharedFilters.filters);
  const data = model.insightsQuery.data;
  const insightsError = model.insightsQuery.error;
  const hasStaleDataError = Boolean(data && model.insightsQuery.isError);
  const hasInvalidFilters = isInvalidMarketingFilterError(insightsError);
  const lastSyncLabel = formatDateTime(model.lastSyncAt);
  const dataDependentTab = !["social", "reputation"].includes(activeTab);
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

  return (
    <AppLayout title="Marketing" borderless>
      <div className="w-full space-y-4 pb-8 sm:pt-1">
        <section
          aria-label="Status da integração de Marketing"
          className="flex flex-col gap-3 rounded-[8px] bg-[var(--app-surface-solid)] p-3.5 sm:flex-row sm:items-center sm:justify-between"
        >
          {model.integrationsQuery.isLoading ? (
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-[6px]" />
              <div>
                <Skeleton className="h-3 w-40" />
                <Skeleton className="mt-2 h-3 w-56" />
              </div>
            </div>
          ) : model.integrationsQuery.isError && !model.integrationState.isConnected ? (
            <div className="min-w-0">
              <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                Não foi possível verificar a conexão da Meta
              </p>
              <p className="mt-1 text-[11px] text-[var(--app-text-tertiary)]">
                Os dados já sincronizados continuam disponíveis.
              </p>
            </div>
          ) : model.integrationState.isConnected ? (
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-success/10 text-success"
              >
                <Megaphone className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                    Meta conectada
                  </p>
                  <span className="rounded-[4px] bg-success/10 px-2 py-0.5 text-[9px] font-light text-success">
                    Ativa
                  </span>
                  {!model.integrationState.hasAdAccount ? (
                    <span className="rounded-[4px] bg-warning/10 px-2 py-0.5 text-[9px] font-light text-warning">
                      Conta de anúncio pendente
                    </span>
                  ) : null}
                  {!model.integrationState.hasMarketingToken ? (
                    <span className="rounded-[4px] bg-warning/10 px-2 py-0.5 text-[9px] font-light text-warning">
                      Reconexão para Marketing
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-[11px] text-[var(--app-text-tertiary)]">
                  {model.integrationState.pageCount} página(s)
                  {" · "}
                  {model.integrationState.adAccountCount} conta(s) de anúncio
                  {lastSyncLabel
                    ? ` · Última sincronização ${lastSyncLabel}`
                    : ""}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex min-w-0 items-start gap-3">
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground"
              >
                <Megaphone className="h-4 w-4" />
              </span>
              <div className="min-w-0">
              <p className="text-[12px] font-normal text-[var(--app-text-primary)]">
                  Conecte a Meta para começar
                </p>
                <p className="mt-1 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
                  Escolha a página, a conta de anúncios e o perfil do Instagram
                  que serão analisados.
                </p>
              </div>
            </div>
          )}

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0">
            {model.canManageIntegration && model.integrationsQuery.isError ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => model.integrationsQuery.refetch()}
                className="h-9 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)] sm:flex-none"
              >
                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            ) : null}

            {model.canManageIntegration ? (
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="h-9 flex-1 rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light shadow-none hover:bg-[var(--app-surface-hover)] sm:flex-none"
              >
                <Link href={INTEGRATION_HREF}>
                  <Settings2 className="mr-1.5 h-3.5 w-3.5" />
                  {model.integrationState.isConnected
                    ? model.integrationState.hasMarketingToken
                      ? "Configurar"
                      : "Reconectar Meta"
                    : "Conectar Meta"}
                </Link>
              </Button>
            ) : null}

            {canSyncIntegration ? (
              <Button
                type="button"
                size="sm"
                onClick={model.sync}
                disabled={
                  !model.integrationState.hasAdAccount ||
                  !model.integrationState.hasMarketingToken ||
                  model.syncMutation.isPending
                }
                title={
                  !model.integrationState.hasMarketingToken
                    ? "Reconecte a Meta para autorizar Ads Insights com segurança"
                    : model.integrationState.hasAdAccount
                      ? "Sincronizar o período selecionado"
                      : "Selecione uma conta de anúncio antes de sincronizar"
                }
                className="h-9 flex-1 rounded-[6px] border-0 bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary sm:flex-none"
              >
                <RefreshCw
                  className={cn(
                    "mr-1.5 h-3.5 w-3.5",
                    model.syncMutation.isPending && "animate-spin",
                  )}
                />
                {model.syncMutation.isPending ? "Sincronizando" : "Sincronizar"}
              </Button>
            ) : null}
          </div>
        </section>

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
            {data && model.insightsQuery.isFetching && !hasStaleDataError ? (
              <span
                role="status"
                className="inline-flex h-8 items-center gap-1.5 rounded-[6px] bg-[var(--app-surface-soft)] px-2 text-[10px] text-[var(--app-text-tertiary)]"
              >
                <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span className="hidden sm:inline">Atualizando</span>
                <span className="sr-only sm:hidden">Atualizando dados de Marketing</span>
              </span>
            ) : null}
            <SharedFilters
              datePreset={sharedFilters.datePreset}
              onDatePresetChange={sharedFilters.setDatePreset}
              customDateRange={sharedFilters.customDateRange}
              onCustomDateRangeChange={sharedFilters.setCustomDateRange}
              teamId={sharedFilters.teamId}
              onTeamChange={sharedFilters.setTeamId}
              userId={sharedFilters.userId}
              onUserChange={sharedFilters.setUserId}
              source={sharedFilters.source}
              onSourceChange={sharedFilters.setSource}
              campaignId={sharedFilters.campaignId}
              onCampaignChange={sharedFilters.setCampaignId}
              adSetId={sharedFilters.adSetId}
              onAdSetChange={sharedFilters.setAdSetId}
              adId={sharedFilters.adId}
              onAdChange={sharedFilters.setAdId}
              tagId={sharedFilters.tagId}
              onTagChange={sharedFilters.setTagId}
              dealStatus={sharedFilters.dealStatus}
              onDealStatusChange={sharedFilters.setDealStatus}
              searchQuery={sharedFilters.searchQuery}
              onSearchChange={sharedFilters.setSearchQuery}
              onClear={sharedFilters.clearFilters}
              hasActiveFilters={sharedFilters.hasActiveFilters}
              dynamicSources={sharedFilters.dynamicSources}
              campaigns={sharedFilters.campaigns}
              adSets={sharedFilters.adSets}
              ads={sharedFilters.ads}
              tags={sharedFilters.tags}
              isLoadingSources={sharedFilters.isLoadingSources}
              isLoadingCampaigns={sharedFilters.isLoadingCampaigns}
              isLoadingAdSets={sharedFilters.isLoadingAdSets}
              isLoadingAds={sharedFilters.isLoadingAds}
              datePosition="start"
              mobileIconOnly
              tourPrefix="marketing"
            />
          </div>
        </div>
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
                Não foi possível atualizar agora. Os últimos dados carregados continuam visíveis.
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
            title="Não foi possível carregar os dados de Marketing"
            description={marketingErrorDescription(insightsError)}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                {hasInvalidFilters ? (
                  <Button
                    type="button"
                    onClick={sharedFilters.clearFilters}
                    className="h-9 rounded-[6px] border-0 bg-primary/50 px-4 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary"
                  >
                    Limpar filtros
                  </Button>
                ) : null}
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
