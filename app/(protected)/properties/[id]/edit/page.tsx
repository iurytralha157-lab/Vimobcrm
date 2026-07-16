import PropertyFormScreen from "@/components/features/properties/PropertyFormScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function EditPropertyPage() {
  return <PermissionBoundary title="Editar Imovel" permission="property_manage"><PropertyFormScreen /></PermissionBoundary>;
}
