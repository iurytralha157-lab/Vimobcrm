import { Suspense } from "react";
import PipelinesScreen from "@/components/features/pipelines/Pipelines-screen";
import { PermissionBoundary } from "@/components/shared/access/PermissionBoundary";

export default function CrmPipelinesPage() {
  return (
    <PermissionBoundary
      module="crm"
      title="Pipeline"
      anyOf={["lead_view_own", "lead_view_team", "lead_view_all"]}
    >
      <Suspense
        fallback={(
          <div
            role="status"
            aria-live="polite"
            className="flex min-h-[320px] items-center justify-center gap-2 text-[12px] font-light text-[var(--app-text-tertiary)]"
          >
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
            Carregando pipeline...
          </div>
        )}
      >
        <PipelinesScreen />
      </Suspense>
    </PermissionBoundary>
  );
}
