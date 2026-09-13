import PropertyFormScreen from "@/components/features/properties/PropertyFormScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function EditPropertyPage() {
  return (
    <PermissionBoundary
      title="Editar Imovel"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertyFormScreen />
    </PermissionBoundary>
  );
}
