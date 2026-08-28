import PropertyLocationsScreen from "@/components/features/properties/PropertyLocationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyCondominiumsPage() {
  return <PermissionBoundary title="Condomínios" permission="property_manage"><PropertyLocationsScreen initialTab="condominiums" /></PermissionBoundary>;
}
