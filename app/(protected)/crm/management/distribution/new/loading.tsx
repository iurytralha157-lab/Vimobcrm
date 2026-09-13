"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewDistributionQueueLoading() {
  return (
    <AppLayout title="Nova fila">
      <div className="flex w-full flex-col gap-3">
        <Skeleton className="h-8 w-40 shrink-0 rounded-[6px]" />
        <Skeleton className="h-[580px] rounded-[8px]" />
      </div>
    </AppLayout>
  );
}
