import { PropertyDevelopmentsScreen } from "@/components/features/properties";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyDevelopmentsPage() {
  return (
    <PermissionBoundary title="Empreendimentos" permission="property_manage">
      <PropertyDevelopmentsScreen />
    </PermissionBoundary>
  );
}
