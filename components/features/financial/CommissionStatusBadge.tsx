import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface CommissionStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export function CommissionStatusBadge({ status, className }: CommissionStatusBadgeProps) {
  const safeStatus = status || 'forecast';
  const statusConfig: Record<string, { label: string; variant: string }> = {
    forecast: { label: 'Prevista', variant: 'bg-white/[0.045] text-muted-foreground border-white/[0.055]' },
    pending: { label: 'Liberada', variant: 'bg-primary/10 text-primary border-primary/20' },
    approved: { label: 'Aprovada', variant: 'bg-warning/10 text-warning border-warning/20' },
    paid: { label: 'Paga', variant: 'bg-success/10 text-success border-success/20' },
    cancelled: { label: 'Cancelada', variant: 'bg-destructive/10 text-destructive border-destructive/20' },
  };

  const config = statusConfig[safeStatus] || { label: safeStatus, variant: 'bg-muted text-muted-foreground' };

  return (
    <Badge variant="outline" className={cn('font-medium', config.variant, className)}>
      {config.label}
    </Badge>
  );
}
