import {
  Users,
  Clock,
  DollarSign,
  TrendingUp,
  TrendingDown,
  CalendarCheck,
  Building2,
  Eye,
  CircleDot,
  XCircle,
  Trophy,
  LucideIcon,
} from "lucide-react";
import type { KeyboardEvent } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type {
  LostDealDetail,
  LostReasonBucket,
  WonConversionBucket,
  WonDealDetail,
} from "@/hooks/use-dashboard-stats";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  getDashboardKPIValueStyle,
  type DashboardKPIAccent,
} from "@/components/features/dashboard/dashboard-kpi-theme";

interface KPIData {
  totalLeads: number;
  openLeads?: number;
  lostLeads?: number;
  conversionRate: number;
  closedLeads: number;
  wonAverageConversionDays?: number | null;
  wonConversionBuckets?: WonConversionBucket[];
  wonDeals?: WonDealDetail[];
  lostReasonBuckets?: LostReasonBucket[];
  lostDeals?: LostDealDetail[];
  avgResponseTime: string;
  totalSalesValue: number;
  pendingCommissions: number;
  leadsTrend: number;
  openTrend?: number;
  lostTrend?: number;
  conversionTrend: number;
  closedTrend: number;
  // Financial data
  totalReceivables?: number;
  totalPayables?: number;
  overdueReceivables?: number;
  overduePayables?: number;
  paidCommissions?: number;
  scheduledVisits?: number;
  propertyCount?: number;
  siteVisits?: number;
}

interface KPICardsProps {
  data: KPIData;
  isLoading?: boolean;
  periodLabel?: string;
  scheduledVisits?: number;
  propertyCount?: number;
  siteVisits?: number;
  onLostClick?: () => void;
  onWonClick?: () => void;
}

interface KPICardItemProps {
  title: string;
  value: string | number;
  trend?: number;
  rate?: number;
  rateVariant?: "positive" | "negative" | "auto";
  rateLabel?: string;
  icon: LucideIcon;
  tooltip: string;
  format?: "number" | "currency" | "percent" | "time";
  accentColor?: DashboardKPIAccent;
  iconColor?: string;
  iconBgColor?: string;
  onClick?: () => void;
  interactive?: boolean;
  tourTarget?: string;
  className?: string;
  compact?: boolean;
}

function formatValue(value: string | number, format: string): string {
  if (typeof value === "string") return value;

  switch (format) {
    case "currency":
      return new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        notation: "standard",
        maximumFractionDigits: 0,
      }).format(value);
    case "percent":
      return `${value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
    case "number":
    default:
      return value.toLocaleString("pt-BR");
  }
}

function KPICardItem({
  title,
  value,
  trend,
  rate,
  rateVariant = "positive",
  rateLabel,
  icon: Icon,
  tooltip,
  format = "number",
  onClick,
  interactive = false,
  tourTarget,
  className,
  compact = false,
  isHighlighted = false,
  accentColor = "leads",
}: KPICardItemProps & { isHighlighted?: boolean }) {
  const hasTrend = trend !== undefined && trend !== 0;
  const isPositive = (trend ?? 0) >= 0;
  const rateValue = rate ?? 0;
  const rateColorClass =
    rateVariant === "negative"
      ? "text-destructive"
      : rateVariant === "auto"
        ? rateValue > 0
          ? "text-emerald-500"
          : "text-destructive"
        : "text-emerald-500";
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onClick) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div className={cn("h-full", className)}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Card
              data-tour={tourTarget}
              className={cn(
                "group h-full overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none transition-colors",
                interactive
                  ? "cursor-pointer hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
                  : "cursor-default",
              )}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={onClick}
              onKeyDown={handleKeyDown}
            >
              <CardContent
                className={cn(
                  "relative p-3 sm:p-4",
                  compact ? "min-h-[78px] sm:min-h-[82px]" : "min-h-[96px]",
                  isHighlighted && "sm:py-5",
                )}
              >
                <div className="flex flex-col gap-1">
                  <div>
                    <p
                      className={cn(
                        "truncate pr-9 text-[12px] font-light leading-tight text-[var(--app-text-tertiary)] sm:pr-11",
                      )}
                    >
                      {title}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/50 text-white transition-colors sm:right-4 sm:top-4",
                      interactive && "group-hover:bg-primary",
                    )}
                  >
                    <Icon className={cn("h-4 w-4 text-white")} />
                  </div>

                  <div className="flex flex-col">
                    <p
                      className={cn(
                        "break-words text-lg font-normal leading-tight text-[var(--app-text-primary)] sm:text-2xl",
                        isHighlighted && "sm:text-[26px]",
                      )}
                      style={getDashboardKPIValueStyle(accentColor)}
                    >
                      {formatValue(value, format)}
                    </p>

                    {hasTrend && (
                      <div className="flex items-center gap-1 mt-1">
                        {isPositive ? (
                          <TrendingUp className="h-3 w-3 text-emerald-500" />
                        ) : (
                          <TrendingDown className="h-3 w-3 text-destructive" />
                        )}
                        <span
                          className={cn(
                            "text-[10px] font-light",
                            isPositive
                              ? "text-emerald-500"
                              : "text-destructive",
                          )}
                        >
                          {trend > 0 ? "+" : ""}
                          {trend}%
                        </span>
                      </div>
                    )}
                    {rate !== undefined && (
                      <div
                        className={cn(
                          "mt-1 max-w-full whitespace-nowrap text-[10px] font-light leading-tight",
                          rateColorClass,
                        )}
                      >
                        {formatValue(rate, "percent")}
                        {rateLabel ? ` ${rateLabel}` : ""}
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TooltipTrigger>
          <TooltipContent className="app-header-popover rounded-[8px] border-0 text-[var(--app-text-primary)]">
            <p className="text-[11px] font-light leading-snug">{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function KPICardSkeleton() {
  return (
    <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-12" />
            <Skeleton className="h-3 w-10" />
          </div>
          <Skeleton className="h-8 w-8 rounded-[6px]" />
        </div>
      </CardContent>
    </Card>
  );
}

export function KPICards({
  data,
  isLoading,
  periodLabel = "Últimos 30 dias",
  scheduledVisits,
  propertyCount,
  siteVisits,
  onLostClick,
  onWonClick,
}: KPICardsProps) {
  if (isLoading) {
    const topSkeletonTours = [
      "dashboard-kpi-leads",
      "dashboard-kpi-open",
      "dashboard-kpi-lost",
      "dashboard-kpi-won",
    ];
    const bottomSkeletonTours = [
      "dashboard-kpi-vgv",
      "dashboard-kpi-visits",
      "dashboard-kpi-first-contact",
      "dashboard-kpi-properties",
      "dashboard-kpi-site-visits",
    ];

    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {topSkeletonTours.map((tourTarget) => (
            <div key={tourTarget} data-tour={tourTarget}>
              <KPICardSkeleton />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {bottomSkeletonTours.map((tourTarget, index) => (
            <div
              key={tourTarget}
              data-tour={tourTarget}
              className={cn(index === 0 && "col-span-2")}
            >
              <KPICardSkeleton />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const kpis: KPICardItemProps[] = [
    {
      title: "Leads",
      value: data.totalLeads,
      icon: Users,
      tooltip: `Total de leads captados - ${periodLabel}`,
      format: "number",
      accentColor: "leads",
      tourTarget: "dashboard-kpi-leads",
    },
    {
      title: "Em aberto",
      value: data.openLeads ?? 0,
      rate:
        data.totalLeads > 0
          ? ((data.openLeads ?? 0) / data.totalLeads) * 100
          : 0,
      icon: CircleDot,
      tooltip: `Percentual de leads em aberto dentro do total do período - ${periodLabel}`,
      format: "number",
      accentColor: "open",
      tourTarget: "dashboard-kpi-open",
    },
    {
      title: "Perdidos",
      value: data.lostLeads ?? 0,
      rate:
        data.totalLeads > 0
          ? ((data.lostLeads ?? 0) / data.totalLeads) * 100
          : 0,
      rateVariant: "negative",
      icon: XCircle,
      tooltip: `Percentual de leads perdidos dentro do total do período - ${periodLabel}`,
      format: "number",
      accentColor: "lost",
      onClick: onLostClick,
      interactive: Boolean(onLostClick),
      tourTarget: "dashboard-kpi-lost",
    },
    {
      title: "Ganhos",
      value: data.closedLeads,
      rate: data.conversionRate,
      rateVariant: "auto",
      rateLabel: "conversão",
      icon: Trophy,
      tooltip: `Ganhos fechados no período, independente da data de entrada do lead - ${periodLabel}`,
      format: "number",
      accentColor: "won",
      iconColor: "rgb(16, 185, 129)",
      iconBgColor: "rgba(16, 185, 129, 0.1)",
      onClick: onWonClick,
      interactive: Boolean(onWonClick),
      tourTarget: "dashboard-kpi-won",
    },
    {
      title: "Visitas",
      value: scheduledVisits ?? 0,
      rate:
        data.totalLeads > 0
          ? ((scheduledVisits ?? 0) / data.totalLeads) * 100
          : 0,
      rateVariant: "auto",
      icon: CalendarCheck,
      tooltip: `Visitas e reuniões criadas no período em relação ao total de leads - ${periodLabel}`,
      format: "number",
      accentColor: "visits",
      tourTarget: "dashboard-kpi-visits",
    },
  ];

  const bottomKpis: KPICardItemProps[] = [
    {
      title: "VGV",
      value: data.totalSalesValue,
      icon: DollarSign,
      tooltip: `Valor total em vendas (VGV) - ${periodLabel}`,
      format: "currency",
      accentColor: "vgv",
      tourTarget: "dashboard-kpi-vgv",
      className: "col-span-2",
      compact: true,
    },
    {
      title: "1º Contato",
      value: data.avgResponseTime,
      icon: Clock,
      tooltip: "Tempo médio até a primeira ligação ou mensagem",
      format: "time",
      accentColor: "response",
      tourTarget: "dashboard-kpi-first-contact",
      compact: true,
    },
    {
      title: "Imóveis",
      value: propertyCount ?? 0,
      icon: Building2,
      tooltip: "Total de imóveis cadastrados",
      format: "number",
      accentColor: "properties",
      tourTarget: "dashboard-kpi-properties",
      compact: true,
    },
    {
      title: "Visitas no site",
      value: siteVisits ?? 0,
      icon: Eye,
      tooltip: `Visitas ao site no período - ${periodLabel}`,
      format: "number",
      accentColor: "site",
      tourTarget: "dashboard-kpi-site-visits",
      compact: true,
    },
  ];

  return (
    <div className="space-y-2 sm:space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {kpis.slice(0, 4).map((kpi) => (
          <KPICardItem key={kpi.title} {...kpi} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <KPICardItem key={bottomKpis[0].title} {...bottomKpis[0]} />
        <KPICardItem key={kpis[4].title} {...kpis[4]} />
        {bottomKpis.slice(1).map((kpi) => (
          <KPICardItem key={kpi.title} {...kpi} />
        ))}
      </div>
    </div>
  );
}
