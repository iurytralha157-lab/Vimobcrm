import AgendaScreen from "@/components/features/schedule/AgendaScreen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function AgendaPage() {
  return (
    <PermissionBoundary module="agenda" title="Agenda" permission="schedule_view">
      <AgendaScreen />
    </PermissionBoundary>
  );
}
