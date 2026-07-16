import AutomationsScreen from "@/components/features/automations/AutomationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function AutomationsPage() {
  return (
    <PermissionBoundary title="Automacoes" anyOf={["automations_view", "automations_manage"]}>
      <AutomationsScreen />
    </PermissionBoundary>
  );
}
