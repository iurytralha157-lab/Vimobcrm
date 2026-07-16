import PropertiesScreen from "@/components/features/properties/PropertiesScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertiesPage() {
  return (
    <PermissionBoundary title="Imoveis" anyOf={["property_view", "property_manage"]}>
      <PropertiesScreen />
    </PermissionBoundary>
  );
}
