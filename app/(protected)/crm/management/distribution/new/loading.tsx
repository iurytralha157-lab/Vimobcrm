"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewDistributionQueueLoading() {
  return (
    <AppLayout title="Nova fila" disableMainScroll>
      <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden">
        <Skeleton className="h-8 w-40 shrink-0 rounded-[6px]" />
        <Skeleton className="min-h-[360px] flex-1 rounded-[8px]" />
      </div>
    </AppLayout>
  );
}
