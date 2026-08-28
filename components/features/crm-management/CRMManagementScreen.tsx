"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { GitBranch, Loader2, Shuffle, Tags, Users } from "lucide-react";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TeamPipelinesManager } from "@/components/features/teams/TeamPipelinesManager";
import { useUserAccessScope } from "@/hooks/use-user-access-scope";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import {
  getAllowedManagementTabs,
  getSafeManagementTab,
} from "@/lib/access/management";
import { DEFAULT_AUTHENTICATED_ROUTE } from "@/config/constants";

import { DistributionTab } from "@/components/features/crm-management/DistributionTab";
import { TeamsTab } from "@/components/features/crm-management/TeamsTab";
import { TagsTab } from "@/components/features/crm-management/TagsTab";
import { ManagementToolbarProvider } from "@/components/features/crm-management/ManagementToolbar";

export default function CRMManagement() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const accessScope = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(
    null,
  );
  const isAccessLoading = accessScope.isLoading || permissionsLoading;

  const managementTabs = useMemo(
    () =>
      getAllowedManagementTabs({
        isAdmin: accessScope.isAdmin,
        isTeamLeader: accessScope.isTeamLeader,
        hasPermission,
      }),
    [accessScope.isAdmin, accessScope.isTeamLeader, hasPermission],
  );
  const activeTab = useMemo(
    () => getSafeManagementTab(requestedTab, managementTabs),
    [requestedTab, managementTabs],
  );

  useEffect(() => {
    if (isAccessLoading) return;

    if (!activeTab) {
      router.replace(DEFAULT_AUTHENTICATED_ROUTE);
      return;
    }

    if (requestedTab !== activeTab) {
      router.replace(`/crm/management?tab=${activeTab}`);
    }
  }, [activeTab, isAccessLoading, requestedTab, router]);

  if (isAccessLoading || !activeTab) {
    return (
      <AppLayout title="Gestão">
        <div className="crm-management-surface animate-in">
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Gestão">
      <div className="crm-management-surface animate-in">
        <ManagementToolbarProvider target={toolbarTarget}>
          <Tabs
            value={activeTab}
            onValueChange={(tab) => router.push(`/crm/management?tab=${tab}`)}
            className="min-w-0 space-y-3"
          >
            <div className="flex min-w-0 flex-row items-center gap-2">
              <div
                className="app-responsive-tab-list min-w-0 flex-1"
                data-collapse="compact"
              >
                <TabsList
                  aria-label="Seções de Gestão"
                  data-responsive-tab-scroll
                  className="inline-flex h-8 w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 text-[var(--app-text-secondary)] shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  {managementTabs.includes("teams") && (
                    <TabsTrigger
                      value="teams"
                      data-responsive-tab
                      aria-label="Equipes"
                      title="Equipes"
                      className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <Users className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">Equipes</span>
                    </TabsTrigger>
                  )}
                  {managementTabs.includes("distribution") && (
                    <TabsTrigger
                      value="distribution"
                      data-responsive-tab
                      aria-label="Distribuição"
                      title="Distribuição"
                      className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <Shuffle className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">
                        Distribuição
                      </span>
                    </TabsTrigger>
                  )}
                  {managementTabs.includes("pipelines") && (
                    <TabsTrigger
                      value="pipelines"
                      data-responsive-tab
                      aria-label="Pipelines"
                      title="Pipelines"
                      className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <GitBranch className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">
                        Pipelines
                      </span>
                    </TabsTrigger>
                  )}
                  {managementTabs.includes("tags") && (
                    <TabsTrigger
                      value="tags"
                      data-responsive-tab
                      aria-label="Tags"
                      title="Tags"
                      className="mx-0 h-6 shrink-0 gap-1 rounded-[6px] px-2.5 text-[10px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[var(--app-text-primary)] data-[state=active]:shadow-none sm:text-[12px]"
                    >
                      <Tags className="h-3 w-3" aria-hidden="true" />
                      <span className="app-responsive-tab-label">Tags</span>
                    </TabsTrigger>
                  )}
                </TabsList>
              </div>
              <div
                ref={setToolbarTarget}
                className="ml-auto flex min-h-8 w-auto min-w-0 shrink-0 items-center justify-end gap-2 empty:hidden"
              />
            </div>

            {managementTabs.includes("teams") && (
              <TabsContent value="teams" className="mt-0">
                <TeamsTab />
              </TabsContent>
            )}

            {managementTabs.includes("distribution") && (
              <TabsContent value="distribution" className="mt-0">
                <DistributionTab />
              </TabsContent>
            )}

            {managementTabs.includes("pipelines") && (
              <TabsContent value="pipelines" className="mt-0">
                <TeamPipelinesManager />
              </TabsContent>
            )}

            {managementTabs.includes("tags") && (
              <TabsContent value="tags" className="mt-0">
                <TagsTab />
              </TabsContent>
            )}
          </Tabs>
        </ManagementToolbarProvider>
      </div>
    </AppLayout>
  );
}
