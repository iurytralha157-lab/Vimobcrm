import PropertyLocationsScreen from "@/components/features/properties/PropertyLocationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyLocationsPage() {
  return <PermissionBoundary title="Localizacoes" permission="property_manage"><PropertyLocationsScreen initialTab="cities" /></PermissionBoundary>;
}
