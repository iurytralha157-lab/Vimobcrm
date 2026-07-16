import PropertyLocationsScreen from "@/components/features/properties/PropertyLocationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyOwnersPage() {
  return <PermissionBoundary title="Proprietarios" permission="property_manage"><PropertyLocationsScreen initialTab="owners" /></PermissionBoundary>;
}
