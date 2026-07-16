import { Suspense } from "react";
import PipelinesScreen from "@/components/features/pipelines/Pipelines-screen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function CrmPipelinesPage() {
  return (
    <PermissionBoundary
      title="Pipeline"
      anyOf={["lead_view_own", "lead_view_team", "lead_view_all"]}
    >
      <Suspense fallback={null}>
        <PipelinesScreen />
      </Suspense>
    </PermissionBoundary>
  );
}
