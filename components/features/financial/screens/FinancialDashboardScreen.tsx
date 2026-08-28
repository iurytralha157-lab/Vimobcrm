"use client";

import { useState, type ComponentType } from "react";
import { format } from "date-fns";
import {
  AlertTriangle,
  Award,
  Calendar,
  DollarSign,
  Download,
  FileText,
  Loader2,
  RefreshCw,
  Target,
  TrendingDown,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { Area, AreaChart, XAxis, YAxis } from "recharts";
import { toast } from "sonner";

import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import { useFinancialDashboard } from "@/hooks/use-financial";
import { exportToExcel, formatCurrency } from "@/lib/export-financial";
import { cn } from "@/lib/utils";

const FinancialChartTooltipContent =
  ChartTooltipContent as unknown as ComponentType<Record<string, unknown>>;

const compactCurrencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});

const countFormatter = new Intl.NumberFormat("pt-BR", {
  maximumFractionDigits: 0,
});

const percentageFormatter = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const chartConfig = {
  receitas: { label: "Receitas", color: "var(--success)" },
  despesas: { label: "Despesas", color: "var(--destructive)" },
};

type DashboardData = NonNullable<
  ReturnType<typeof useFinancialDashboard>["data"]
>;

type MetricVariant =
  | "default"
  | "success"
  | "warning"
  | "destructive"
  | "primary";

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCompactCurrency(value: unknown) {
  return compactCurrencyFormatter.format(finiteNumber(value));
}

function formatCount(value: unknown) {
  return countFormatter.format(finiteNumber(value));
}

function formatPercentage(value: unknown) {
  return `${percentageFormatter.format(finiteNumber(value))}%`;
}

function addFinite(...values: unknown[]) {
  const total = values.reduce<number>(
    (sum, value) => sum + finiteNumber(value),
    0,
  );
  return finiteNumber(total);
}

export default function FinancialDashboard() {
  const dashboardQuery = useFinancialDashboard();

  if (dashboardQuery.isLoading) {
    return <FinancialDashboardSkeleton />;
  }

  if (dashboardQuery.isError && !dashboardQuery.data) {
    return (
      <FinancialDashboardState
        kind="error"
        title="Não foi possível carregar o financeiro"
        description="Verifique sua conexão ou suas permissões e tente novamente. Nenhum indicador foi substituído por estimativas."
        isRetrying={dashboardQuery.isFetching}
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  if (!dashboardQuery.data) {
    return (
      <FinancialDashboardState
        kind="empty"
        title="Dados financeiros ainda indisponíveis"
        description="Não há uma organização financeira disponível para este acesso. Assim que o vínculo estiver pronto, os indicadores aparecerão aqui."
        isRetrying={dashboardQuery.isFetching}
        onRetry={() => void dashboardQuery.refetch()}
      />
    );
  }

  return (
    <RealEstateFinancialDashboard
      data={dashboardQuery.data}
      isStale={dashboardQuery.isError}
      isRetrying={dashboardQuery.isFetching}
      onRetry={() => void dashboardQuery.refetch()}
    />
  );
}

function FinancialDashboardSkeleton() {
  return (
    <AppLayout title="Dashboard Financeiro" borderless>
      <div
        className="mx-auto w-full max-w-[1440px] space-y-5 pb-8 sm:pt-2"
        aria-busy="true"
        aria-label="Carregando dashboard financeiro"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-44 rounded-[4px]" />
            <Skeleton className="h-3 w-64 max-w-full rounded-[4px]" />
          </div>
          <Skeleton className="h-9 w-24 rounded-[6px]" />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-[8px]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Skeleton className="h-[360px] rounded-[8px] lg:col-span-2" />
          <div className="space-y-4">
            <Skeleton className="h-48 rounded-[8px]" />
            <Skeleton className="h-44 rounded-[8px]" />
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function FinancialDashboardState({
  kind,
  title,
  description,
  isRetrying,
  onRetry,
}: {
  kind: "error" | "empty";
  title: string;
  description: string;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const isError = kind === "error";

  return (
    <AppLayout title="Dashboard Financeiro" borderless>
      <div className="mx-auto w-full max-w-[980px] pb-8 sm:pt-2">
        <section
          className="flex min-h-64 flex-col items-center justify-center rounded-[8px] border-0 bg-[var(--app-surface-solid)] px-5 py-10 text-center shadow-none"
          role={isError ? "alert" : "status"}
          aria-labelledby="financial-state-title"
        >
          <span
            className={cn(
              "mb-4 inline-flex h-10 w-10 items-center justify-center rounded-[6px]",
              isError
                ? "bg-destructive/10 text-destructive"
                : "bg-primary/10 text-primary",
            )}
          >
            {isError ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <DollarSign className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <h2
            id="financial-state-title"
            className="text-[14px] font-normal text-[var(--app-text-primary)]"
          >
            {title}
          </h2>
          <p className="mt-2 max-w-md text-[12px] font-light leading-relaxed text-[var(--app-text-secondary)]">
            {description}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-4 h-9 rounded-[6px] px-3 text-[12px] font-light"
            disabled={isRetrying}
            onClick={onRetry}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
              aria-hidden="true"
            />
            {isRetrying ? "Atualizando..." : "Tentar novamente"}
          </Button>
        </section>
      </div>
    </AppLayout>
  );
}

function RealEstateFinancialDashboard({
  data,
  isStale,
  isRetrying,
  onRetry,
}: {
  data: DashboardData;
  isStale: boolean;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const totalOverdue = addFinite(
    data.overdueReceivables,
    data.overduePayables,
  );
  const monthlyData = data.monthlyData.slice(-6);

  const handleExport = async () => {
    const exportData = [
      { Metrica: "VGV Bruto", Valor: formatCurrency(data.vgvBruto) },
      { Metrica: "VGV Líquido", Valor: formatCurrency(data.vgvLiquido) },
      { Metrica: "Ticket Médio", Valor: formatCurrency(data.avgTicket) },
      {
        Metrica: "Receita Confirmada (30d)",
        Valor: formatCurrency(data.confirmedRevenue30),
      },
      { Metrica: "A Receber (30d)", Valor: formatCurrency(data.receivable30) },
      { Metrica: "A Pagar", Valor: formatCurrency(data.totalPayable) },
      { Metrica: "Vencidos", Valor: formatCurrency(totalOverdue) },
      {
        Metrica: "Comissões Previstas",
        Valor: formatCurrency(data.forecastCommissions),
      },
      {
        Metrica: "Comissões Liberadas",
        Valor: formatCurrency(data.pendingCommissions),
      },
      {
        Metrica: "Comissões Pagas",
        Valor: formatCurrency(data.paidCommissions),
      },
      {
        Metrica: "Projeção Anual",
        Valor: formatCurrency(data.annualProjection),
      },
    ];

    setIsExporting(true);
    try {
      await exportToExcel(
        exportData,
        `Dashboard_Financeiro_${format(new Date(), "yyyy-MM-dd")}`,
      );
      toast.success("Resumo financeiro exportado com sucesso!");
    } catch {
      toast.error("Não foi possível exportar o resumo financeiro.");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <AppLayout title="Dashboard Financeiro" borderless>
      <div
        data-tour="financial-overview"
        className="mx-auto w-full max-w-[1440px] space-y-5 pb-8 sm:pt-2"
      >
        {isStale ? (
          <div
            className="flex flex-col gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2.5 text-[12px] font-light text-[var(--app-text-secondary)] sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <span className="flex items-start gap-2">
              <AlertTriangle
                className="mt-0.5 h-3.5 w-3.5 shrink-0"
                aria-hidden="true"
              />
              A atualização falhou. Os últimos indicadores disponíveis continuam
              visíveis.
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 rounded-[6px] px-3 text-[12px] font-light"
              disabled={isRetrying}
              onClick={onRetry}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
                aria-hidden="true"
              />
              {isRetrying ? "Atualizando..." : "Tentar novamente"}
            </Button>
          </div>
        ) : null}

        <div
          data-tour="financial-actions"
          className="flex items-start justify-between gap-4"
        >
          <div className="min-w-0">
            <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">
              Performance financeira
            </h2>
            <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
              Métricas consolidadas de vendas e recebimentos.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 w-9 rounded-[6px] p-0 text-[12px] font-light sm:w-auto sm:px-3"
              aria-label={isExporting ? "Exportando resumo" : "Exportar resumo"}
              title={isExporting ? "Exportando resumo" : "Exportar resumo"}
              onClick={() => void handleExport()}
              disabled={isExporting}
            >
              {isExporting ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Download className="h-4 w-4" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {isExporting ? "Exportando..." : "Exportar"}
              </span>
            </Button>
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-9 w-9 rounded-[6px] p-0 text-[12px] font-light sm:w-auto sm:px-3"
            >
              <Link
                href="/financeiro/dre"
                aria-label="Ver DRE executivo"
                title="Ver DRE executivo"
              >
                <FileText className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">DRE executivo</span>
              </Link>
            </Button>
            <Badge
              variant="outline"
              className="hidden border-primary/20 bg-primary/5 px-2.5 py-1 text-[11px] font-light text-primary md:inline-flex"
            >
              Estratégico
            </Badge>
          </div>
        </div>

        <section
          data-tour="financial-kpis"
          aria-label="Indicadores financeiros"
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
        >
          <FinancialMetricCard
            title="VGV bruto"
            value={formatCurrency(data.vgvBruto)}
            description={`${formatCount(data.activeContracts)} contratos ativos`}
            icon={Award}
            variant="primary"
            chartData={monthlyData.map((month) => ({
              value: month.receitas,
            }))}
          />
          <FinancialMetricCard
            title="VGV líquido"
            value={formatCurrency(data.vgvLiquido)}
            description="Líquido de comissões"
            icon={Target}
            variant="success"
          />
          <FinancialMetricCard
            title="Ticket médio"
            value={formatCurrency(data.avgTicket)}
            description="Média por contrato"
            icon={FileText}
          />
          <FinancialMetricCard
            title="Receita confirmada (30d)"
            value={formatCurrency(data.confirmedRevenue30)}
            description="Entradas pagas nos últimos 30 dias"
            icon={TrendingUp}
            variant="success"
            chartData={monthlyData.map((month) => ({
              value: month.receitas,
            }))}
          />
          <FinancialMetricCard
            title="A receber (30d)"
            value={formatCurrency(data.receivable30)}
            description="Entradas previstas"
            icon={Calendar}
          />
          <FinancialMetricCard
            title="A pagar"
            value={formatCurrency(data.totalPayable)}
            description="Despesas em aberto"
            icon={TrendingDown}
            variant="warning"
          />
          <FinancialMetricCard
            title="Vencidos"
            value={formatCurrency(totalOverdue)}
            description="Recebimentos e pagamentos atrasados"
            icon={AlertTriangle}
            variant="destructive"
          />
          <FinancialMetricCard
            title="Taxa de inadimplência"
            value={formatPercentage(data.defaultRate)}
            description="Vencidos sobre o total previsto"
            icon={AlertTriangle}
            variant="destructive"
          />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section
            className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none lg:col-span-2"
            aria-labelledby="financial-cash-flow-title"
          >
            <div className="px-4 pb-3 pt-4 sm:px-5 sm:pt-5">
              <h2
                id="financial-cash-flow-title"
                className="text-[14px] font-normal text-[var(--app-text-primary)]"
              >
                Evolução do fluxo de caixa
              </h2>
              <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
                Receitas realizadas e despesas nos últimos seis meses.
              </p>
            </div>
            <div className="px-2 pb-4 sm:px-4 sm:pb-5">
              {monthlyData.length > 0 ? (
                <div
                  role="img"
                  aria-label="Gráfico da evolução mensal de receitas e despesas"
                >
                  <ChartContainer
                    config={chartConfig}
                    className="h-[280px] w-full sm:h-[320px]"
                  >
                    <AreaChart data={monthlyData}>
                      <defs>
                        <linearGradient
                          id="financialReceitasGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--success)"
                            stopOpacity={0.1}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--success)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                        <linearGradient
                          id="financialDespesasGradient"
                          x1="0"
                          y1="0"
                          x2="0"
                          y2="1"
                        >
                          <stop
                            offset="5%"
                            stopColor="var(--destructive)"
                            stopOpacity={0.1}
                          />
                          <stop
                            offset="95%"
                            stopColor="var(--destructive)"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="month"
                        axisLine={false}
                        tickLine={false}
                        minTickGap={16}
                        tick={{
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <YAxis
                        axisLine={false}
                        tickLine={false}
                        width={68}
                        tickFormatter={formatCompactCurrency}
                        tick={{
                          fontSize: 11,
                          fill: "var(--muted-foreground)",
                        }}
                      />
                      <ChartTooltip content={<FinancialChartTooltipContent />} />
                      <Area
                        type="monotone"
                        dataKey="receitas"
                        stroke="var(--success)"
                        fillOpacity={1}
                        fill="url(#financialReceitasGradient)"
                        strokeWidth={2}
                      />
                      <Area
                        type="monotone"
                        dataKey="despesas"
                        stroke="var(--destructive)"
                        fillOpacity={1}
                        fill="url(#financialDespesasGradient)"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                      />
                    </AreaChart>
                  </ChartContainer>
                </div>
              ) : (
                <div
                  className="flex h-[280px] flex-col items-center justify-center px-4 text-center sm:h-[320px]"
                  role="status"
                >
                  <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
                    <TrendingUp className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <p className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    Sem histórico financeiro
                  </p>
                  <p className="mt-1 max-w-sm text-[12px] font-light text-[var(--app-text-secondary)]">
                    A evolução aparece quando houver receitas ou despesas no
                    período.
                  </p>
                </div>
              )}
            </div>
          </section>

          <div className="space-y-4">
            <section
              className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none sm:p-5"
              aria-labelledby="financial-commissions-title"
            >
              <h2
                id="financial-commissions-title"
                className="flex items-center gap-2 text-[14px] font-normal text-[var(--app-text-primary)]"
              >
                <DollarSign className="h-4 w-4 text-primary" aria-hidden="true" />
                Resumo de comissões
              </h2>
              <dl className="mt-4 space-y-2">
                <CommissionSummaryRow
                  label="Previstas"
                  value={formatCurrency(data.forecastCommissions)}
                />
                <CommissionSummaryRow
                  label="Liberadas"
                  value={formatCurrency(data.pendingCommissions)}
                  tone="primary"
                />
                <CommissionSummaryRow
                  label="Pagas"
                  value={formatCurrency(data.paidCommissions)}
                  tone="success"
                />
              </dl>
            </section>

            <section
              className="rounded-[8px] border-0 bg-primary/[0.045] p-4 shadow-none sm:p-5"
              aria-labelledby="financial-forecast-title"
            >
              <h2
                id="financial-forecast-title"
                className="text-[12px] font-light text-primary"
              >
                Previsão anual
              </h2>
              <p className="mt-2 break-words text-[20px] font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">
                {formatCurrency(data.annualProjection)}
              </p>
              <p className="mt-2 text-[12px] font-light leading-relaxed text-[var(--app-text-secondary)]">
                Baseada no volume atual de recebimentos recorrentes.
              </p>
              <Button
                asChild
                className="mt-5 h-9 w-full rounded-[6px] text-[12px] font-light"
              >
                <Link href="/financeiro/relatorios">
                  Ver relatório detalhado
                </Link>
              </Button>
            </section>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

function FinancialMetricCard({
  title,
  value,
  description,
  icon: Icon,
  variant = "default",
  chartData,
}: {
  title: string;
  value: string;
  description: string;
  icon: LucideIcon;
  variant?: MetricVariant;
  chartData?: { value: number }[];
}) {
  const iconStyles: Record<MetricVariant, string> = {
    default:
      "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    destructive: "bg-destructive/10 text-destructive",
    primary: "bg-primary/10 text-primary",
  };
  const sparkline = chartData?.length
    ? buildSparklinePoints(chartData)
    : null;

  return (
    <article className="min-w-0 overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <div className="flex items-start justify-between gap-3 p-4 pb-3">
        <div className="min-w-0">
          <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
            {title}
          </p>
          <p className="mt-1 break-words text-[18px] font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">
            {value}
          </p>
          <p className="mt-1.5 text-[11px] font-light leading-relaxed text-[var(--app-text-secondary)]">
            {description}
          </p>
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
    </article>
  );
}

function CommissionSummaryRow({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "success";
}) {
  const toneStyles = {
    default:
      "bg-[var(--app-surface-soft)] text-[var(--app-text-primary)]",
    primary: "bg-primary/[0.045] text-primary",
    success: "bg-success/[0.045] text-success",
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center justify-between gap-3 rounded-[6px] px-3 py-2.5",
        toneStyles[tone],
      )}
    >
      <dt className="text-[12px] font-light">{label}</dt>
      <dd className="min-w-0 break-words text-right text-[12px] font-normal tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function getSparklineColor(variant: MetricVariant) {
  if (variant === "success") return "var(--success)";
  if (variant === "warning") return "var(--warning)";
  if (variant === "destructive") return "var(--destructive)";
  if (variant === "primary") return "var(--primary)";
  return "var(--muted-foreground)";
}

function buildSparklinePoints(data: { value: number }[]) {
  const values = data.map((point) => finiteNumber(point.value));
  if (values.length === 1) return "0,20 120,20";

  const maxAbsolute = Math.max(...values.map((value) => Math.abs(value)));
  const normalizedValues = maxAbsolute
    ? values.map((value) => value / maxAbsolute)
    : values;
  const min = Math.min(...normalizedValues);
  const max = Math.max(...normalizedValues);
  const range = max - min;
  if (range === 0) return "0,20 120,20";

  return normalizedValues
    .map((value, index) => {
      const x = (index / (values.length - 1)) * 120;
      const y = 34 - ((value - min) / range) * 28;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
