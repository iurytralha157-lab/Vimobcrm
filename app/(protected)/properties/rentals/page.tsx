import PropertyRentalsScreen from "@/components/features/properties/PropertyRentalsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyRentalsPage() {
  return (
    <PermissionBoundary
      title="Imóveis para locação"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertyRentalsScreen />
    </PermissionBoundary>
  );
}
