"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditDistributionQueueLoading() {
  return (
    <AppLayout title="Editar fila" disableMainScroll>
      <div className="flex h-full min-h-0 w-full flex-col gap-3 overflow-hidden">
        <Skeleton className="h-8 w-40 shrink-0 rounded-[6px]" />
        <Skeleton className="h-10 w-full shrink-0 rounded-[8px]" />
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[76px] rounded-[8px]" />
          ))}
        </div>
        <div className="grid min-h-[360px] flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <Skeleton className="h-full rounded-[8px]" />
          <Skeleton className="h-full rounded-[8px]" />
        </div>
      </div>
    </AppLayout>
  );
}
