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
      <CardContent className="p-3 sm:p-4 md:p-6">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0 space-y-1 sm:space-y-2">
            <p className="text-xs sm:text-sm font-medium text-muted-foreground leading-tight">{title}</p>
            <p className="text-base sm:text-xl md:text-2xl font-bold tracking-tight break-all">{value}</p>
            {description && (
              <p className="text-[10px] sm:text-xs text-muted-foreground leading-tight">{description}</p>
            )}
            {trend && (
              <p className={cn(
                "text-xs font-medium",
                trend.isPositive ? "text-success" : "text-destructive"
              )}>
                {trend.isPositive ? '↑' : '↓'} {Math.abs(trend.value)}% vs mês anterior
              </p>
            )}
          </div>
          <div className={cn(
            "p-2 sm:p-3 rounded-lg shrink-0",
            iconStyles[variant]
          )}>
            <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
