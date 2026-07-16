import PropertyFormScreen from "@/components/features/properties/PropertyFormScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function NewPropertyPage() {
  return (
    <PermissionBoundary title="Novo Imovel" permission="property_manage">
      <PropertyFormScreen />
    </PermissionBoundary>
  );
}
