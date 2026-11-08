import { PropertiesScreen } from "@/components/features/properties";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyReadyPage() {
  return (
    <PermissionBoundary
      title="Imóveis prontos"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertiesScreen preset="ready" />
    </PermissionBoundary>
  );
}
