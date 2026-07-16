import AgendaScreen from "@/components/features/schedule/AgendaScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function AgendaPage() {
  return (
    <PermissionBoundary title="Agenda" permission="schedule_view">
      <AgendaScreen />
    </PermissionBoundary>
  );
}
