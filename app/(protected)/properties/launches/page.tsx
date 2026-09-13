import { PropertiesScreen } from "@/components/features/properties";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyLaunchesPage() {
  return (
    <PermissionBoundary
      title="Imóveis em lançamento"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertiesScreen preset="launches" />
    </PermissionBoundary>
  );
}
