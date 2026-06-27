'use client';

import { BarChart3 } from 'lucide-react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { SiteAnalyticsTab } from '@/components/features/site/SiteAnalyticsTab';

export default function SiteDashboardScreen() {
  return (
    <AppLayout title="Dashboard do Site">
      <div className="space-y-6">
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#FF4529]">
            <BarChart3 className="h-3.5 w-3.5" />
            Site
          </p>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--app-text-primary)]">Dashboard do Site</h1>
            <p className="mt-1 text-sm text-[var(--app-text-secondary)]">
              Acompanhe visitas, conversões e jornada dos leads do site imobiliário.
            </p>
          </div>
        </div>

        <SiteAnalyticsTab />
      </div>
    </AppLayout>
  );
}
