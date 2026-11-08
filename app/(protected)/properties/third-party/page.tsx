import { PropertiesScreen } from "@/components/features/properties";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function PropertyThirdPartyPage() {
  return (
    <PermissionBoundary
      title="Imóveis de terceiros"
      anyOf={["property_view", "property_manage"]}
    >
      <PropertiesScreen preset="third_party" />
    </PermissionBoundary>
  );
}
