import PropertyLocationsScreen from "@/components/features/properties/PropertyLocationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

type PropertyLocationsPageProps = {
  searchParams: Promise<{ tab?: string | string[] }>;
};

export default async function PropertyLocationsPage({
  searchParams,
}: PropertyLocationsPageProps) {
  const requestedTab = (await searchParams).tab;
  const initialTab = requestedTab === "neighborhoods" ? "neighborhoods" : "cities";

  return (
    <PermissionBoundary title="Localizações" permission="property_manage">
      <PropertyLocationsScreen initialTab={initialTab} />
    </PermissionBoundary>
  );
}
