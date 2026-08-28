'use client';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { SiteAnalyticsTab } from '@/components/features/site/SiteAnalyticsTab';

export default function SiteDashboardScreen() {
  return (
    <AppLayout title="Dashboard do Site" borderless>
      <div className="dashboard-site min-w-0 w-full pb-8 sm:pt-1">
        <SiteAnalyticsTab />
      </div>
    </AppLayout>
  );
}
