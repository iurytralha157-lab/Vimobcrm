import DashboardScreen from "@/components/features/dashboard/DashboardScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function DashboardPage() {
  return (
    <PermissionBoundary title="Dashboard" permission="dashboard_view">
      <DashboardScreen />
    </PermissionBoundary>
  );
}
