'use client';

import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { GitBranch, Loader2, Shuffle, Tags, Users } from 'lucide-react';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TeamPipelinesManager } from '@/components/features/teams/TeamPipelinesManager';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';
import { useUserPermissions } from '@/hooks/use-user-permissions';
import {
  getAllowedManagementTabs,
  getSafeManagementTab,
} from '@/lib/access/management';

import { DistributionTab } from '@/components/features/crm-management/DistributionTab';
import { TeamsTab } from '@/components/features/crm-management/TeamsTab';
import { TagsTab } from '@/components/features/crm-management/TagsTab';

export default function CRMManagement() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const accessScope = useUserAccessScope();
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const isAccessLoading = accessScope.isLoading || permissionsLoading;

  const managementTabs = useMemo(
    () => getAllowedManagementTabs({
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
      router.replace('/dashboard');
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
        <Tabs value={activeTab} onValueChange={(tab) => router.push(`/crm/management?tab=${tab}`)} className="min-w-0 space-y-0 sm:space-y-4">
          <TabsList className="hidden h-9 w-fit max-w-full flex-none justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 shadow-none sm:inline-flex">
            {managementTabs.includes('teams') && (
              <TabsTrigger value="teams" className="h-7 flex-1 gap-1.5 rounded-[6px] px-3 text-xs shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[#FF4529] data-[state=active]:shadow-none sm:flex-none">
                <Users className="h-3.5 w-3.5" /> Equipes
              </TabsTrigger>
            )}
            {managementTabs.includes('distribution') && (
              <TabsTrigger value="distribution" className="h-7 flex-1 gap-1.5 rounded-[6px] px-3 text-xs shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[#FF4529] data-[state=active]:shadow-none sm:flex-none">
                <Shuffle className="h-3.5 w-3.5" /> Distribuição
              </TabsTrigger>
            )}
            {managementTabs.includes('pipelines') && (
              <TabsTrigger value="pipelines" className="h-7 flex-1 gap-1.5 rounded-[6px] px-3 text-xs shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[#FF4529] data-[state=active]:shadow-none sm:flex-none">
                <GitBranch className="h-3.5 w-3.5" /> Pipelines
              </TabsTrigger>
            )}
            {managementTabs.includes('tags') && (
              <TabsTrigger value="tags" className="h-7 flex-1 gap-1.5 rounded-[6px] px-3 text-xs shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:text-[#FF4529] data-[state=active]:shadow-none sm:flex-none">
                <Tags className="h-3.5 w-3.5" /> Tags
              </TabsTrigger>
            )}
          </TabsList>
          {managementTabs.includes('teams') && (
            <TabsContent value="teams" className="mt-0">
              <TeamsTab />
            </TabsContent>
          )}

          {managementTabs.includes('distribution') && (
            <TabsContent value="distribution" className="mt-0">
              <DistributionTab />
            </TabsContent>
          )}

          {managementTabs.includes('pipelines') && (
            <TabsContent value="pipelines" className="mt-0">
              <TeamPipelinesManager />
            </TabsContent>
          )}

          {managementTabs.includes('tags') && (
            <TabsContent value="tags" className="mt-0">
              <TagsTab />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </AppLayout>
  );
}
