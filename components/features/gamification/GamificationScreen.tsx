"use client";

import { useEffect, useRef, useState } from "react";
import {
  BarChart3,
  History,
  Loader2,
  Settings,
  ShieldOff,
  Trophy,
} from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList } from "@/components/ui/tabs";
import {
  useGamificationAdmin,
  useGamificationOverview,
  useGamificationRealtime,
} from "@/hooks/gamification";
import { LOCATION_HASH_CHANGE_EVENT } from "@/hooks/use-location-hash";
import { useOrganizationModules } from "@/hooks/use-organization-modules";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import { VimobAPIError } from "@/lib/api/vimob-client";
import { getFriendlyErrorMessage } from "@/lib/error-handler";

import { GamificationAdmin } from "./GamificationAdmin";
import { GamificationArena } from "./GamificationArena";
import { GamificationDashboard } from "./GamificationDashboard";
import { GamificationHistory } from "./GamificationHistory";
import {
  EMPTY_ADMIN_SNAPSHOT,
  EMPTY_GAMIFICATION_OVERVIEW,
  type GamificationTab,
  tabFromHash,
} from "./gamification-domain";
import { ArenaCelebration, ConfigTab } from "./GamificationUi";

export default function GamificationScreen() {
  const {
    error: modulesError,
    isLoading: modulesLoading,
    hasModule,
    refetch: refetchModules,
  } = useOrganizationModules();
  const { hasPermission } = useUserPermissions();
  const canManage = hasPermission("gamification_manage");
  const [activeTab, setActiveTab] = useState<GamificationTab>("arena");
  const [showCelebration, setShowCelebration] = useState(false);
  const previousRankingRef = useRef<Record<string, number>>({});
  const moduleEnabled =
    !modulesLoading && !modulesError && hasModule("gamification");
  useGamificationRealtime(moduleEnabled);
  const overviewEnabled = moduleEnabled && activeTab === "dashboard";
  const adminEnabled =
    moduleEnabled &&
    (activeTab === "dashboard" || (activeTab === "config" && canManage));
  const { overview, isLoading, error, refetch } =
    useGamificationOverview(overviewEnabled);
  const admin = useGamificationAdmin(adminEnabled);

  const data = overview ?? EMPTY_GAMIFICATION_OVERVIEW;
  const snapshot = admin.snapshot ?? EMPTY_ADMIN_SNAPSHOT;

  useEffect(() => {
    const handleHashChange = () => {
      const requestedTab = tabFromHash(window.location.hash);
      const nextTab =
        requestedTab === "config" && !canManage ? "arena" : requestedTab;
      setActiveTab(nextTab);
      if (nextTab !== requestedTab) {
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}`,
        );
      }
    };
    const syncTimeout = window.setTimeout(handleHashChange, 0);
    window.addEventListener("hashchange", handleHashChange);
    return () => {
      window.clearTimeout(syncTimeout);
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [canManage]);

  useEffect(() => {
    if (data.ranking.length === 0) {
      previousRankingRef.current = {};
      return;
    }

    const previousRanking = previousRankingRef.current;
    const hadPreviousRanking = Object.keys(previousRanking).length > 0;
    const currentRanking = data.ranking.reduce<Record<string, number>>(
      (acc, entry) => {
        acc[entry.userId] = entry.position;
        return acc;
      },
      {},
    );
    const previousLeaderId = Object.entries(previousRanking).find(
      ([, position]) => position === 1,
    )?.[0];
    const currentLeaderId = data.ranking[0]?.userId;
    const hasPositionGain = data.ranking.some((entry) => {
      const previousPosition = previousRanking[entry.userId];
      return (
        previousPosition !== undefined && entry.position < previousPosition
      );
    });
    const leaderChanged = Boolean(
      previousLeaderId &&
      currentLeaderId &&
      previousLeaderId !== currentLeaderId,
    );

    previousRankingRef.current = currentRanking;

    if (!hadPreviousRanking || (!hasPositionGain && !leaderChanged)) return;

    setShowCelebration(true);
    const timeout = window.setTimeout(() => setShowCelebration(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [data.ranking]);

  const handleTabChange = (value: string) => {
    const tab = value as GamificationTab;
    if (tab === "config" && !canManage) return;
    setActiveTab(tab);
    const hash = tab === "arena" ? "" : `#${tab}`;
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}${hash}`,
    );
    window.dispatchEvent(new Event(LOCATION_HASH_CHANGE_EVENT));
  };

  if (modulesLoading) {
    return (
      <AppLayout title="Gamificação">
        <div
          className="flex min-h-[320px] items-center justify-center gap-3 text-sm text-muted-foreground"
          role="status"
        >
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
          Verificando acesso ao módulo...
        </div>
      </AppLayout>
    );
  }

  if (modulesError) {
    return (
      <AppLayout title="Gamificação">
        <div
          className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <ShieldOff
            className="mb-3 h-9 w-9 text-destructive"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            Não foi possível verificar o acesso à gamificação
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            O estado do módulo não pôde ser consultado. Tente novamente antes de
            continuar.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetchModules()}
          >
            Tentar novamente
          </Button>
        </div>
      </AppLayout>
    );
  }

  if (!moduleEnabled) {
    return (
      <AppLayout title="Gamificação">
        <div className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center">
          <ShieldOff
            className="mb-3 h-9 w-9 text-muted-foreground"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            Módulo de gamificação indisponível
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            Este módulo não está habilitado para a organização selecionada.
            Solicite a ativação ao administrador da conta.
          </p>
        </div>
      </AppLayout>
    );
  }

  if (overviewEnabled && error && !overview) {
    const moduleUnavailable =
      error instanceof VimobAPIError &&
      error.status === 403 &&
      error.code === "module_unavailable";
    return (
      <AppLayout title="Gamificação">
        <div
          className="app-card flex min-h-[320px] flex-col items-center justify-center px-6 text-center"
          role="alert"
        >
          <ShieldOff
            className="mb-3 h-9 w-9 text-destructive"
            aria-hidden="true"
          />
          <h1 className="text-lg font-medium">
            {moduleUnavailable
              ? "Módulo de gamificação indisponível"
              : "Não foi possível carregar a gamificação"}
          </h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">
            {moduleUnavailable
              ? "A organização selecionada não possui acesso a este módulo."
              : getFriendlyErrorMessage(error)}
          </p>
          {!moduleUnavailable && (
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void refetch()}
            >
              Tentar novamente
            </Button>
          )}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Gamificação">
      <div className="space-y-5">
        <ArenaCelebration active={showCelebration} />
        {overviewEnabled && error && overview && (
          <div
            className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm text-muted-foreground"
            role="alert"
          >
            <span>Os dados podem estar desatualizados.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
            >
              Atualizar novamente
            </Button>
          </div>
        )}

        <Tabs
          data-tour="gamification-tabs"
          value={activeTab}
          onValueChange={handleTabChange}
          className="space-y-5"
        >
          <div
            data-collapse="compact"
            className="app-responsive-tab-list min-w-0"
          >
            <TabsList
              data-responsive-tab-scroll
              aria-label="Seções de gamificação"
              className="inline-flex h-auto w-fit max-w-full justify-start gap-1 overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1"
            >
              <ConfigTab value="arena" icon={Trophy} label="Arena" />
              <ConfigTab
                value="dashboard"
                icon={BarChart3}
                label="Meu painel"
              />
              <ConfigTab value="history" icon={History} label="Histórico" />
              {canManage && (
                <ConfigTab
                  value="config"
                  icon={Settings}
                  label="Configuração"
                />
              )}
            </TabsList>
          </div>
          <TabsContent
            data-tour="gamification-arena"
            value="arena"
            className="mt-0"
          >
            <GamificationArena />
          </TabsContent>

          <TabsContent
            data-tour="gamification-dashboard"
            value="dashboard"
            className="mt-0"
          >
            {isLoading && !overview ? (
              <div
                className="app-card flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground"
                role="status"
              >
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                Carregando painel...
              </div>
            ) : (
              <GamificationDashboard
                data={data}
                admin={admin}
                snapshot={snapshot}
              />
            )}
          </TabsContent>

          <TabsContent
            data-tour="gamification-history"
            value="history"
            className="mt-0"
          >
            <GamificationHistory />
          </TabsContent>

          {canManage && (
            <TabsContent
              data-tour="gamification-config"
              value="config"
              className="mt-0"
            >
              <GamificationAdmin
                admin={admin}
                snapshot={snapshot}
                isLoading={admin.isLoading}
              />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
