import { TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { CONTACT_TABLE_COLUMN_CLASSES } from "@/components/features/contacts/contacts-screen/model";
import { cn } from "@/lib/utils";

interface TableSkeletonProps {
  rows?: number;
  showSelection?: boolean;
  showLostReason?: boolean;
}

export function TableSkeleton({
  rows = 8,
  showSelection = false,
  showLostReason = false,
}: TableSkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, index) => (
        <TableRow
          key={index}
          className="animate-pulse border-b border-border/30 last:border-b-0"
        >
          {showSelection && (
            <TableCell className={CONTACT_TABLE_COLUMN_CLASSES.selection}>
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

          <TableCell className={showLostReason ? CONTACT_TABLE_COLUMN_CLASSES.lostReason : CONTACT_TABLE_COLUMN_CLASSES.status}>
            <Skeleton className="h-5 w-14 rounded-[4px]" />
          </TableCell>

          <TableCell className={CONTACT_TABLE_COLUMN_CLASSES.stage}>
            <Skeleton className="h-5 w-24 rounded-[4px]" />
          </TableCell>

          <TableCell className={CONTACT_TABLE_COLUMN_CLASSES.assignee}>
            <Skeleton className="mx-auto h-7 w-7 rounded-[6px]" />
          </TableCell>

          <TableCell className={CONTACT_TABLE_COLUMN_CLASSES.tags}>
            <div className="flex gap-1">
              <Skeleton className="h-5 w-14 rounded-[4px]" />
              <Skeleton className="h-5 w-10 rounded-[4px]" />
            </div>
          </TableCell>

          <TableCell className={CONTACT_TABLE_COLUMN_CLASSES.created}>
            <Skeleton className="h-3 w-20 rounded-[4px]" />
          </TableCell>

          <TableCell className={cn("contacts-actions-cell", CONTACT_TABLE_COLUMN_CLASSES.actions)}>
            <Skeleton className="h-8 w-8 rounded-[6px]" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
