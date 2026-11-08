import SiteDashboardScreen from '@/components/features/site/SiteDashboardScreen';
import {
  buildSiteTabHrefs,
  normalizeSiteTab,
  type SiteSearchParams,
} from '@/components/features/site/dashboard/site-dashboard-tabs';
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary';

export default async function SiteDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SiteSearchParams>;
}) {
  const params = await searchParams;

  return (
    <PermissionBoundary module="site" title="Dashboard do Site" permission="dashboard_site_view">
      <SiteDashboardScreen
        activeTab={normalizeSiteTab(params.tab)}
        tabHrefs={buildSiteTabHrefs(params)}
      />
    </PermissionBoundary>
  );
}
