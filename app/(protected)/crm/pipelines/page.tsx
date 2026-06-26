import { Suspense } from "react";
import PipelinesScreen from "@/components/features/pipelines/Pipelines-screen";

export default function CrmPipelinesPage() {
  return (
    <Suspense fallback={null}>
      <PipelinesScreen />
    </Suspense>
  );
}
