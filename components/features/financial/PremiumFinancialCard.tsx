
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { LucideIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface PremiumFinancialCardProps {
  title: string;
  value: string;
  description?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: 'default' | 'success' | 'warning' | 'destructive' | 'primary';
  chartData?: { value: number }[];
  className?: string;
}

export function PremiumFinancialCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  variant = 'default',
  chartData,
  className,
}: PremiumFinancialCardProps) {
  const variantStyles = {
    default: 'app-card',
    success: 'app-card border-success/20',
    warning: 'app-card border-warning/20',
    destructive: 'app-card border-destructive/20',
    primary: 'app-card bg-primary/[0.045] border-primary/20',
  };

  const iconStyles = {
    default: 'bg-white/[0.055] text-muted-foreground',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    destructive: 'bg-destructive/10 text-destructive',
    primary: 'bg-primary/10 text-primary',
  };
  const sparkline = chartData?.length ? buildSparklinePoints(chartData) : null;

  return (
    <Card className={cn('overflow-hidden transition-all card-hover', variantStyles[variant], className)}>
      <CardContent className="p-0">
        <div className="p-4 md:p-6 pb-2">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              <h3 className="text-xl md:text-2xl font-bold tracking-tight">{value}</h3>
              {description && (
                <p className="text-[10px] sm:text-xs text-muted-foreground">{description}</p>
              )}
            </div>
            <div className={cn("p-2 rounded-xl", iconStyles[variant])}>
              <Icon className="h-5 w-5" />
            </div>
          </div>

          {trend && (
            <div className="mt-4 flex items-center gap-1.5">
              <div className={cn(
                "flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold",
                trend.isPositive ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"
              )}>
                {trend.isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                {Math.abs(trend.value)}%
              </div>
              <span className="text-[10px] text-muted-foreground">vs mês anterior</span>
            </div>
          )}
        </div>

        {sparkline && (
          <div className="mt-2 h-12 w-full opacity-50">
            <svg className="h-full w-full" viewBox="0 0 120 48" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={sparkline}
                fill="none"
                stroke={getSparklineColor(variant)}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="3"
              />
            </svg>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getSparklineColor(variant: PremiumFinancialCardProps['variant']) {
  if (variant === 'success') return '#10b981';
  if (variant === 'destructive') return '#ef4444';
  return '#ff452f';
}

function buildSparklinePoints(data: { value: number }[]) {
  if (data.length === 1) {
    return '0,24 120,24';
  }

  const values = data.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 120;
      const y = 40 - ((value - min) / range) * 32;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}
