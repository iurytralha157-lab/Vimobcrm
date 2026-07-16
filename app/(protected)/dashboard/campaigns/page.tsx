import MetaCampaignsDashboardScreen from "@/components/features/meta";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function CampaignsDashboardPage() {
  return (
    <PermissionBoundary title="Dashboard de Campanhas" permission="dashboard_campaigns_view">
      <MetaCampaignsDashboardScreen />
    </PermissionBoundary>
  );
}
