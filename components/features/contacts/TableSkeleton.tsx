import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

interface TableSkeletonProps {
  rows?: number;
  showSelection?: boolean;
}

export function TableSkeleton({
  rows = 8,
  showSelection = false,
}: TableSkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, index) => (
        <TableRow
          key={index}
          className="animate-pulse border-b border-border/30 last:border-b-0"
        >
          {showSelection && (
            <TableCell className="w-12">
              <Skeleton className="h-4 w-4 rounded-[4px]" />
            </TableCell>
          )}

          <TableCell>
            <div className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-[6px]" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-3 w-28 rounded-[4px]" />
                <Skeleton className="h-2.5 w-16 rounded-[4px]" />
              </div>
            </div>
          </TableCell>

          <TableCell>
            <div className="space-y-2">
              <Skeleton className="h-3 w-24 rounded-[4px]" />
              <Skeleton className="h-3 w-32 rounded-[4px]" />
            </div>
          </TableCell>

          <TableCell>
            <Skeleton className="h-5 w-14 rounded-[4px]" />
          </TableCell>

          <TableCell>
            <Skeleton className="h-5 w-24 rounded-[4px]" />
          </TableCell>

          <TableCell className="w-14">
            <Skeleton className="mx-auto h-7 w-7 rounded-[6px]" />
          </TableCell>

          <TableCell className="hidden 2xl:table-cell">
            <div className="flex gap-1">
              <Skeleton className="h-5 w-14 rounded-[4px]" />
              <Skeleton className="h-5 w-10 rounded-[4px]" />
            </div>
          </TableCell>

          <TableCell>
            <Skeleton className="h-3 w-20 rounded-[4px]" />
          </TableCell>

          <TableCell className="w-12">
            <Skeleton className="h-8 w-8 rounded-[6px]" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
