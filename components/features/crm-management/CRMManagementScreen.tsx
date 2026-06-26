'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { TeamPipelinesManager } from '@/components/features/teams/TeamPipelinesManager';
import { useUserAccessScope } from '@/hooks/use-user-access-scope';

import { DistributionTab } from '@/components/features/crm-management/DistributionTab';
import { TeamsTab } from '@/components/features/crm-management/TeamsTab';
import { TagsTab } from '@/components/features/crm-management/TagsTab';

const VALID_TABS = ['teams', 'distribution', 'pipelines', 'tags'] as const;
type ManagementTab = typeof VALID_TABS[number];

function isManagementTab(value: string | null): value is ManagementTab {
  return !!value && VALID_TABS.includes(value as ManagementTab);
}

export default function CRMManagement() {
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [activeTab, setActiveTab] = useState<ManagementTab>(
    isManagementTab(requestedTab) ? requestedTab : 'teams'
  );
  const accessScope = useUserAccessScope();

  useEffect(() => {
    const nextTab = isManagementTab(requestedTab) ? requestedTab : 'teams';
    if (nextTab === activeTab) return;

    let cancelled = false;

    queueMicrotask(() => {
      if (!cancelled) setActiveTab(nextTab);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, requestedTab]);

  const managementTabs = useMemo<ManagementTab[]>(() => {
    const tabs: ManagementTab[] = ['teams', 'distribution', 'pipelines', 'tags'];

    if (accessScope.isAdmin) return tabs;
    if (accessScope.isTeamLeader) return tabs.filter((tab) => ['teams', 'distribution'].includes(tab));
    return [];
  }, [accessScope.isAdmin, accessScope.isTeamLeader]);

  useEffect(() => {
    if (managementTabs.length === 0 || managementTabs.includes(activeTab)) return;

    let cancelled = false;
    const nextTab = managementTabs[0];

    queueMicrotask(() => {
      if (!cancelled) setActiveTab(nextTab);
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, managementTabs]);

  return (
    <AppLayout title="Gestão">
      <div className="animate-in">
        <Tabs value={activeTab}>
          <TabsContent value="teams" className="mt-0">
            <TeamsTab />
          </TabsContent>

          <TabsContent value="distribution" className="mt-0">
            <DistributionTab />
          </TabsContent>

          <TabsContent value="pipelines" className="mt-0">
            <TeamPipelinesManager />
          </TabsContent>

          <TabsContent value="tags" className="mt-0">
            <TagsTab />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
