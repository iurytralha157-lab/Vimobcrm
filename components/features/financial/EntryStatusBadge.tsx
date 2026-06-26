import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface EntryStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export function EntryStatusBadge({ status, className }: EntryStatusBadgeProps) {
  const safeStatus = status || 'pending';
  const statusConfig: Record<string, { label: string; variant: string }> = {
    pending: { label: 'Pendente', variant: 'bg-warning/10 text-warning border-warning/20' },
    paid: { label: 'Pago', variant: 'bg-success/10 text-success border-success/20' },
    overdue: { label: 'Vencido', variant: 'bg-destructive/10 text-destructive border-destructive/20' },
    cancelled: { label: 'Cancelado', variant: 'bg-muted text-muted-foreground border-muted' },
  };

  const config = statusConfig[safeStatus] || { label: safeStatus, variant: 'bg-muted text-muted-foreground' };

  return (
    <Badge variant="outline" className={cn('font-medium', config.variant, className)}>
      {config.label}
    </Badge>
  );
}
