import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon } from 'lucide-react';

interface FinancialCardProps {
  title: string;
  value: string;
  description?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'success' | 'warning' | 'destructive';
  className?: string;
}

export function FinancialCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  variant = 'default',
  className,
}: FinancialCardProps) {
  const variantStyles = {
    default: 'bg-[var(--app-surface)]',
    success: 'bg-success/10 border-success/20',
    warning: 'bg-warning/10 border-warning/20',
    destructive: 'bg-destructive/10 border-destructive/20',
  };

  const iconStyles = {
    default: 'bg-primary/10 text-primary',
    success: 'bg-success/20 text-success',
    warning: 'bg-warning/20 text-warning',
    destructive: 'bg-destructive/20 text-destructive',
  };

  return (
    <Card className={cn('card-hover', variantStyles[variant], className)}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-[12px] font-light leading-tight text-muted-foreground">{title}</p>
            <p className="break-all text-[16px] font-normal leading-tight">{value}</p>
            {description && (
              <p className="text-[11px] font-light leading-tight text-muted-foreground">{description}</p>
            )}
            {trend && (
              <p className={cn(
                "text-[12px] font-light",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs mês anterior
              </p>
            )}
          </div>
          <div className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] p-0",
            iconStyles[variant]
          )}>
            <Icon className="h-4 w-4" aria-hidden="true" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
