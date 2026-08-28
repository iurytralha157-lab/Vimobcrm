
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 1,
});

const maxSparklinePoints = 120;

interface PremiumFinancialCardProps {
  title: string;
  value: string;
  description?: string;
  icon: LucideIcon;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  variant?: "default" | "success" | "warning" | "destructive" | "primary";
  chartData?: { value: number }[];
  className?: string;
}

export function PremiumFinancialCard({
  title,
  value,
  description,
  icon: Icon,
  trend,
  variant = "default",
  chartData,
  className,
}: PremiumFinancialCardProps) {
  const variantStyles: Record<
    NonNullable<PremiumFinancialCardProps["variant"]>,
    string
  > = {
    default: "bg-[var(--app-surface-solid)]",
    success: "bg-[var(--app-surface-solid)]",
    warning: "bg-[var(--app-surface-solid)]",
    destructive: "bg-[var(--app-surface-solid)]",
    primary: "bg-[var(--app-surface-solid)]",
  };

  const iconStyles: Record<
    NonNullable<PremiumFinancialCardProps["variant"]>,
    string
  > = {
    default:
      "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    primary: "bg-primary/10 text-primary",
  };
  const sparkline = chartData?.length ? buildSparklinePoints(chartData) : null;
  const parsedTrend = trend ? Number(trend.value) : null;
  const trendValue =
    parsedTrend !== null && Number.isFinite(parsedTrend)
      ? Math.abs(parsedTrend)
      : null;

  return (
    <Card
      role="group"
      aria-label={`${title}: ${value}`}
      className={cn(
        "min-w-0 overflow-hidden rounded-[8px] border-0 shadow-none",
        variantStyles[variant],
        className,
      )}
    >
      <CardContent className="p-0">
        <div className="flex items-start justify-between gap-3 p-4 pb-3">
          <div className="min-w-0">
            <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
              {title}
            </p>
            <p className="mt-1 break-words text-[18px] font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">
              {value}
            </p>
            {description ? (
              <p className="mt-1.5 text-[11px] font-light leading-relaxed text-[var(--app-text-secondary)]">
                {description}
              </p>
            ) : null}

            {trend && trendValue !== null ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    "inline-flex items-center gap-0.5 rounded-[4px] px-1.5 py-0.5 text-[10px] font-normal tabular-nums",
                    trend.isPositive
                      ? "bg-success/10 text-success"
                      : "bg-destructive/10 text-destructive",
                  )}
                >
                  {trend.isPositive ? (
                    <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ArrowDownRight className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span className="sr-only">
                    {trend.isPositive ? "Aumento de" : "Queda de"}
                  </span>
                  {percentageFormatter.format(trendValue)}%
                </span>
                <span className="text-[10px] font-light text-[var(--app-text-secondary)]">
                  vs. mês anterior
                </span>
              </div>
            ) : null}
          </div>
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px]",
              iconStyles[variant],
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>

        {sparkline ? (
          <div className="h-10 w-full opacity-50" aria-hidden="true">
            <svg
              className="h-full w-full"
              viewBox="0 0 120 40"
              preserveAspectRatio="none"
            >
              <polyline
                points={sparkline}
                fill="none"
                stroke={getSparklineColor(variant)}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
              />
            </svg>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function getSparklineColor(variant: PremiumFinancialCardProps["variant"]) {
  if (variant === "success") return "var(--success)";
  if (variant === "warning") return "var(--warning)";
  if (variant === "destructive") return "var(--destructive)";
  if (variant === "primary") return "var(--primary)";
  return "var(--muted-foreground)";
}

function buildSparklinePoints(data: { value: number }[]) {
  const finiteValues = data
    .map((point) => Number(point.value))
    .filter(Number.isFinite);
  const values =
    finiteValues.length > maxSparklinePoints
      ? Array.from({ length: maxSparklinePoints }, (_, index) => {
          const sourceIndex = Math.round(
            (index / (maxSparklinePoints - 1)) * (finiteValues.length - 1),
          );
          return finiteValues[sourceIndex];
        })
      : finiteValues;
  if (values.length === 0) return null;
  if (values.length === 1) return "0,20 120,20";

  const { min, max } = values.reduce(
    (range, value) => ({
      min: Math.min(range.min, value),
      max: Math.max(range.max, value),
    }),
    { min: values[0], max: values[0] },
  );
  const range = max - min;
  if (range === 0) return "0,20 120,20";

  return values
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 120;
      const y = 34 - ((value - min) / range) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
