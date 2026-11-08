'use client';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { SiteAnalyticsTab } from '@/components/features/site/SiteAnalyticsTab';
import type { SiteTab, SiteTabHrefs } from '@/components/features/site/dashboard/site-dashboard-tabs';

export default function SiteDashboardScreen({
  activeTab,
  tabHrefs,
}: {
  activeTab: SiteTab;
  tabHrefs: SiteTabHrefs;
}) {
  return (
    <AppLayout title="Site" borderless>
      <div className="dashboard-site min-w-0 w-full pb-8 sm:pt-1">
        <SiteAnalyticsTab activeTab={activeTab} tabHrefs={tabHrefs} />
      </div>
    </AppLayout>
  );
}
