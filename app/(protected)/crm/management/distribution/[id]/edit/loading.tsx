"use client";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Skeleton } from "@/components/ui/skeleton";

export default function EditDistributionQueueLoading() {
  return (
    <AppLayout title="Editar fila">
      <div className="flex w-full flex-col gap-3">
        <Skeleton className="h-8 w-40 shrink-0 rounded-[6px]" />
        <Skeleton className="h-10 w-full shrink-0 rounded-[8px]" />
        <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-[76px] rounded-[8px]" />
          ))}
        </div>
        <div className="grid items-start gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
          <Skeleton className="h-[580px] rounded-[8px]" />
          <Skeleton className="h-[420px] rounded-[8px]" />
        </div>
      </div>
    </AppLayout>
  );
}
