import ConversationsScreen from "@/components/features/whatsapp/ConversationsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function ConversationsPage() {
  return (
    <PermissionBoundary title="Conversas" permission="whatsapp_view">
      <ConversationsScreen />
    </PermissionBoundary>
  );
}
