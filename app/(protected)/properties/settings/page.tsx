import { PropertySettingsScreen } from "@/components/features/properties";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertySettingsPage() {
  return (
    <PermissionBoundary
      title="Configurações de imóveis"
      permission="settings_organization"
    >
      <PropertySettingsScreen />
    </PermissionBoundary>
  );
}
