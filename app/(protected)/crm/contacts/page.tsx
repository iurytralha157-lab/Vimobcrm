import ContactsScreen from "@/components/features/contacts/ContactsScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function ContactsPage() {
  return (
    <PermissionBoundary
      module="crm"
      title="Contatos"
      anyOf={["lead_view_own", "lead_view_team", "lead_view_all"]}
    >
      <ContactsScreen />
    </PermissionBoundary>
  );
}
