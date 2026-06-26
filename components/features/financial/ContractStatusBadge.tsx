import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface ContractStatusBadgeProps {
  status?: string | null;
  className?: string;
}

export function ContractStatusBadge({ status, className }: ContractStatusBadgeProps) {
  const safeStatus = status || 'draft';
  const statusConfig: Record<string, { label: string; variant: string }> = {
    draft: { label: 'Rascunho', variant: 'bg-muted text-muted-foreground border-muted' },
    active: { label: 'Ativo', variant: 'bg-success/10 text-success border-success/20' },
    finished: { label: 'Encerrado', variant: 'bg-primary/10 text-primary border-primary/20' },
    cancelled: { label: 'Cancelado', variant: 'bg-destructive/10 text-destructive border-destructive/20' },
  };

  const config = statusConfig[safeStatus] || { label: safeStatus, variant: 'bg-muted text-muted-foreground' };

  return (
    <Badge variant="outline" className={cn('font-medium', config.variant, className)}>
      {config.label}
    </Badge>
  );
}
