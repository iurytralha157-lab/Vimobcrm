'use client';

import { AppLayout } from '@/components/shared/layout/AppLayout';
import { SiteAnalyticsTab } from '@/components/features/site/SiteAnalyticsTab';

export default function SiteDashboardScreen() {
  return (
    <AppLayout title="Dashboard do Site">
      <div className="dashboard-site min-w-0">
        <SiteAnalyticsTab />
      </div>
    </AppLayout>
  );
}
