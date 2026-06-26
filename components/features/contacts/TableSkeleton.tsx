import { TableBody, TableCell, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';

interface TableSkeletonProps {
  rows?: number;
}

export function TableSkeleton({ rows = 10 }: TableSkeletonProps) {
  return (
    <TableBody>
      {Array.from({ length: rows }).map((_, i) => (
        <TableRow key={i} className="animate-pulse">
          {/* Seleção */}
          <TableCell>
            <Skeleton className="h-4 w-4 rounded" />
          </TableCell>
          {/* Contato */}
          <TableCell>
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <div className="flex gap-3">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-36" />
              </div>
            </div>
          </TableCell>
          {/* Estágio */}
          <TableCell>
            <Skeleton className="h-6 w-24 rounded-full" />
          </TableCell>
          {/* Responsável */}
          <TableCell>
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-16" />
            </div>
          </TableCell>
          {/* Tags */}
          <TableCell>
            <div className="flex gap-1">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-12 rounded-full" />
            </div>
          </TableCell>
          {/* Fonte */}
          <TableCell>
            <Skeleton className="h-5 w-16 rounded-full" />
          </TableCell>
          {/* Última Interação */}
          <TableCell>
            <div className="space-y-1">
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-16" />
            </div>
          </TableCell>
          {/* Data */}
          <TableCell>
            <Skeleton className="h-4 w-16" />
          </TableCell>
          {/* Ações */}
          <TableCell>
            <Skeleton className="h-8 w-8 rounded" />
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  );
}
