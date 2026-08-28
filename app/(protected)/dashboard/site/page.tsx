import SiteDashboardScreen from '@/components/features/site/SiteDashboardScreen';
import { PermissionBoundary } from '@/components/shared/access/PermissionBoundary';

export default function SiteDashboardPage() {
  return (
    <PermissionBoundary module="site" title="Dashboard do Site" permission="dashboard_site_view">
      <SiteDashboardScreen />
    </PermissionBoundary>
  );
}
