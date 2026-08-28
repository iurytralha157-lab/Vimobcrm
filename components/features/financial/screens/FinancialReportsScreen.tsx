"use client";

import { useMemo, useState } from "react";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  useFinancialEntries,
  type FinancialEntry,
} from "@/hooks/use-financial";
import { useCommissionsByBroker } from "@/hooks/use-commissions";
import { useIsMobile } from "@/hooks/use-mobile";
import { DateFilterPopover } from "@/components/ui/date-filter-popover";
import {
  DatePreset,
  getDateRangeFromPreset,
} from "@/hooks/use-dashboard-filters";
import {
  formatCurrency,
  formatDate,
  exportToExcel,
  exportToCSV,
  prepareFinancialEntriesExport,
} from "@/lib/export-financial";
import {
  FileText,
  Download,
  BarChart3,
  DollarSign,
  Building2,
  Users,
  AlertTriangle,
  TrendingUp,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { endOfDay, format, startOfDay } from "date-fns";
import { toast } from "sonner";

import { cn } from "@/lib/utils";

type ReportType =
  | "monthly"
  | "cashflow"
  | "commissions"
  | "property"
  | "payments"
  | "overdue";

interface ReportConfig {
  id: ReportType;
  title: string;
  description: string;
  icon: typeof FileText;
}

type ExportRow = Record<string, string | number | boolean | null | undefined>;

type BrokerCommissionSummary = {
  user: { id: string; name: string | null; email: string | null };
  forecast: number;
  approved: number;
  paid: number;
  total: number;
};

type FinancialReportEntry = FinancialEntry & {
  value?: number | null;
};

type PropertyRevenueSummary = {
  key: string;
  label: string;
  entryCount: number;
  total: number;
  paid: number;
};

function parseFinancialDate(value: string | null | undefined) {
  if (!value) return null;
  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]);
    const day = Number(dateOnlyMatch[3]);
    const parsed = new Date(year, month - 1, day);
    return parsed.getFullYear() === year &&
      parsed.getMonth() === month - 1 &&
      parsed.getDate() === day
      ? parsed
      : null;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function finiteNumber(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function getPaidAmount(entry: FinancialReportEntry) {
  const explicitPaidAmount = entry.paid_value ?? entry.paid_amount;
  if (explicitPaidAmount != null) return finiteNumber(explicitPaidAmount);
  return entry.status === "paid"
    ? finiteNumber(entry.value ?? entry.amount)
    : 0;
}

function getOutstandingAmount(entry: FinancialReportEntry) {
  const amount = finiteNumber(entry.value ?? entry.amount);
  const paid = finiteNumber(entry.paid_value ?? entry.paid_amount);
  return Math.max(amount - paid, 0);
}

function isWithinDateRange(
  value: string | null | undefined,
  start: Date | null,
  end: Date | null,
) {
  const parsed = parseFinancialDate(value);
  if (!parsed) return false;
  if (start && parsed < start) return false;
  if (end && parsed > end) return false;
  return true;
}

function getEntryStatus(status: string | null | undefined) {
  switch (status) {
    case "paid":
      return { label: "Pago", className: "text-success" };
    case "overdue":
      return { label: "Vencido", className: "text-destructive" };
    case "pending":
      return { label: "Pendente", className: "text-warning" };
    case "partial":
      return { label: "Parcialmente pago", className: "text-warning" };
    case "cancelled":
      return {
        label: "Cancelado",
        className: "text-[var(--app-text-secondary)]",
      };
    default:
      return {
        label: "Não informado",
        className: "text-[var(--app-text-secondary)]",
      };
  }
}

const reports: ReportConfig[] = [
  {
    id: "monthly",
    title: "Fechamento Mensal",
    description: "Resumo de receitas e despesas do mês",
    icon: BarChart3,
  },
  {
    id: "cashflow",
    title: "Fluxo de Caixa",
    description: "Entradas e saídas por período",
    icon: TrendingUp,
  },
  {
    id: "commissions",
    title: "Comissões por Corretor",
    description: "Ranking de corretores por comissões",
    icon: Users,
  },
  {
    id: "property",
    title: "Receita por Imóvel",
    description: "Performance financeira dos imóveis",
    icon: Building2,
  },
  {
    id: "payments",
    title: "Pagamentos Realizados",
    description: "Histórico de pagamentos efetuados",
    icon: DollarSign,
  },
  {
    id: "overdue",
    title: "Pendências Financeiras",
    description: "Contas vencidas e pendentes",
    icon: AlertTriangle,
  },
];

function EmptyReportState({ children }: { children: string }) {
  return (
    <div
      className="flex min-h-40 flex-col items-center justify-center px-4 py-8 text-center"
      role="status"
    >
      <span className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]">
        <FileText className="h-4 w-4" aria-hidden="true" />
      </span>
      <p className="max-w-sm text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">
        {children}
      </p>
    </div>
  );
}

function EntryCardMobile({
  entry,
  amount,
  dateValue,
  dateLabel = "Vencimento",
}: {
  entry: FinancialReportEntry;
  amount?: number;
  dateValue?: string | null;
  dateLabel?: string;
}) {
  const status = getEntryStatus(entry.status);

  return (
    <div className="border-b border-[var(--app-border)] px-4 py-3 last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-normal text-[var(--app-text-primary)]">
            {entry.description || "Sem descrição"}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge
              variant={entry.type === "receivable" ? "default" : "secondary"}
              className="rounded-[4px] px-1.5 py-0.5 text-[9px] font-light"
            >
              {entry.type === "receivable" ? "Receita" : "Despesa"}
            </Badge>
            <span className={cn("text-[11px] font-light", status.className)}>
              {status.label}
            </span>
          </div>
        </div>
        <div className="min-w-0 shrink-0 text-right">
          <p className="max-w-[150px] break-words text-[13px] font-normal tabular-nums text-[var(--app-text-primary)]">
            {formatCurrency(amount ?? finiteNumber(entry.value ?? entry.amount))}
          </p>
          <p className="mt-0.5 text-[10px] font-light text-[var(--app-text-secondary)]">
            {dateLabel}: {formatDate(dateValue ?? entry.due_date)}
          </p>
        </div>
      </div>
    </div>
  );
}

// Mobile Commission Card
function CommissionCardMobile({ broker }: { broker: BrokerCommissionSummary }) {
  return (
    <div className="border-b border-[var(--app-border)] p-3 last:border-b-0">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <p className="min-w-0 truncate text-[13px] font-normal text-[var(--app-text-primary)]">
          {broker.user.name || "Corretor inativo"}
        </p>
        <p className="max-w-[150px] shrink-0 break-words text-right text-[13px] font-normal tabular-nums">
          {formatCurrency(finiteNumber(broker.total))}
        </p>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-light text-[var(--app-text-secondary)]">
            Previsão
          </p>
          <p className="break-words text-[11px] font-normal tabular-nums">
            {formatCurrency(finiteNumber(broker.forecast))}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-light text-[var(--app-text-secondary)]">
            Aprovadas
          </p>
          <p className="break-words text-[11px] font-normal tabular-nums text-warning">
            {formatCurrency(finiteNumber(broker.approved))}
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-light text-[var(--app-text-secondary)]">
            Pagas
          </p>
          <p className="break-words text-[11px] font-normal tabular-nums text-success">
            {formatCurrency(finiteNumber(broker.paid))}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function FinancialReports() {
  const isMobile = useIsMobile();
  const [selectedReport, setSelectedReport] = useState<ReportType>("monthly");
  const [datePreset, setDatePreset] = useState<DatePreset>("thisMonth");
  const [customDateRange, setCustomDateRange] = useState<{
    from: Date;
    to: Date;
  } | null>(null);
  const [isExporting, setIsExporting] = useState<"excel" | "csv" | null>(null);

  const {
    data: entries,
    isLoading: entriesLoading,
    isFetching: entriesFetching,
    error: entriesError,
    refetch: refetchEntries,
  } = useFinancialEntries();
  const {
    data: commissionsByBroker,
    isLoading: commissionsLoading,
    isFetching: commissionsFetching,
    error: commissionsError,
    refetch: refetchCommissions,
  } = useCommissionsByBroker();

  const { start, end } = useMemo(() => {
    const dateRange = customDateRange || getDateRangeFromPreset(datePreset);
    return {
      start:
        dateRange?.from && Number.isFinite(dateRange.from.getTime())
          ? startOfDay(dateRange.from)
          : null,
      end:
        dateRange?.to && Number.isFinite(dateRange.to.getTime())
          ? endOfDay(dateRange.to)
          : null,
    };
  }, [customDateRange, datePreset]);
  const todayStartTime = startOfDay(new Date()).getTime();
  const handleDatePresetChange = (preset: DatePreset | null) => {
    setDatePreset(preset || "thisMonth");
  };

  const {
    filteredEntries,
    totalReceivables,
    totalPayables,
    paidInPeriod,
    overdueEntriesFiltered,
    totalOverdue,
    entriesInOtherPeriods,
    entriesWithoutValidDueDate,
    propertyRevenue,
  } = useMemo(() => {
    const sourceEntries = entries || [];
    const periodEntries = sourceEntries.filter((entry) =>
      isWithinDateRange(entry.due_date, start, end),
    );
    const receivables = periodEntries.filter(
      (entry) => entry.type === "receivable",
    );
    const payables = periodEntries.filter(
      (entry) => entry.type === "payable",
    );
    const receivableTotal = receivables.reduce(
      (sum, entry) => sum + finiteNumber(entry.amount),
      0,
    );
    const payableTotal = payables.reduce(
      (sum, entry) => sum + finiteNumber(entry.amount),
      0,
    );
    const payments = sourceEntries
      .filter(
        (entry) =>
          (entry.status === "paid" || entry.status === "partial") &&
          isWithinDateRange(entry.paid_date, start, end),
      )
      .sort((left, right) => {
        const leftTime = parseFinancialDate(left.paid_date)?.getTime() ?? 0;
        const rightTime = parseFinancialDate(right.paid_date)?.getTime() ?? 0;
        return rightTime - leftTime;
      });
    const overdue = sourceEntries
      .filter((entry) => {
        if (entry.status === "paid" || entry.status === "cancelled") {
          return false;
        }
        const dueDate = parseFinancialDate(entry.due_date);
        if (!dueDate || !isWithinDateRange(entry.due_date, start, end)) {
          return false;
        }
        return (
          entry.status === "overdue" ||
          ((entry.status === "pending" || entry.status === "partial") &&
            dueDate.getTime() < todayStartTime)
        );
      })
      .sort((left, right) => {
        const leftTime = parseFinancialDate(left.due_date)?.getTime() ?? 0;
        const rightTime = parseFinancialDate(right.due_date)?.getTime() ?? 0;
        return leftTime - rightTime;
      });
    const datedEntriesCount = sourceEntries.filter((entry) =>
      parseFinancialDate(entry.due_date),
    ).length;
    const propertySummary = Array.from(
      receivables
        .reduce((summary, entry) => {
          const propertyKey =
            entry.property?.id ||
            entry.property?.code ||
            entry.property?.title ||
            "unlinked";
          const existing = summary.get(propertyKey) || {
            key: propertyKey,
            label: entry.property?.code
              ? `${entry.property.code}${entry.property.title ? ` — ${entry.property.title}` : ""}`
              : entry.property?.title || "Sem imóvel vinculado",
            entryCount: 0,
            total: 0,
            paid: 0,
          };
          existing.entryCount += 1;
          existing.total += finiteNumber(entry.amount);
          existing.paid += getPaidAmount(entry);
          summary.set(propertyKey, existing);
          return summary;
        }, new Map<string, PropertyRevenueSummary>())
        .values(),
    ).sort((left, right) => right.total - left.total);

    return {
      filteredEntries: periodEntries,
      totalReceivables: receivableTotal,
      totalPayables: payableTotal,
      paidInPeriod: payments,
      overdueEntriesFiltered: overdue,
      totalOverdue: overdue.reduce(
        (sum, entry) => sum + getOutstandingAmount(entry),
        0,
      ),
      entriesInOtherPeriods: Math.max(
        datedEntriesCount - periodEntries.length,
        0,
      ),
      entriesWithoutValidDueDate: Math.max(
        sourceEntries.length - datedEntriesCount,
        0,
      ),
      propertyRevenue: propertySummary,
    };
  }, [end, entries, start, todayStartTime]);
  const exportPeriodLabel =
    start && Number.isFinite(start.getTime())
      ? format(start, "yyyy-MM")
      : format(new Date(), "yyyy-MM");

  const buildExport = () => {
    let data: ExportRow[] = [];
    let filename = "";

    switch (selectedReport) {
      case "monthly":
      case "cashflow":
      case "payments":
      case "overdue":
        data = prepareFinancialEntriesExport(
          selectedReport === "overdue"
            ? overdueEntriesFiltered
            : selectedReport === "payments"
              ? paidInPeriod
              : filteredEntries,
        );
        filename = `${selectedReport}-${exportPeriodLabel}`;
        break;
      case "commissions":
        data =
          commissionsByBroker?.map((b) => ({
            Corretor: b.user.name || "Corretor inativo",
            "Total Comissões": formatCurrency(finiteNumber(b.total)),
            Previsão: formatCurrency(finiteNumber(b.forecast)),
            Aprovadas: formatCurrency(finiteNumber(b.approved)),
            Pagas: formatCurrency(finiteNumber(b.paid)),
          })) || [];
        filename = `comissoes-corretores-${format(new Date(), "yyyy-MM")}`;
        break;
      case "property":
        data = propertyRevenue.map((property) => ({
          Imóvel: property.label,
          Lançamentos: property.entryCount,
          "Receita Prevista": formatCurrency(property.total),
          "Receita Recebida": formatCurrency(property.paid),
        }));
        filename = `receita-imoveis-${exportPeriodLabel}`;
        break;
      default:
        data = prepareFinancialEntriesExport(filteredEntries);
        filename = `relatorio-${format(new Date(), "yyyy-MM-dd")}`;
    }

    return { data, filename };
  };

  const handleExportExcel = async () => {
    const { data, filename } = buildExport();

    if (!data.length) {
      toast.error("Nenhum dado para exportar");
      return;
    }

    setIsExporting("excel");
    try {
      await exportToExcel(data, filename);
      toast.success("Relatório exportado com sucesso");
    } catch {
      toast.error("Não foi possível exportar o relatório em Excel.");
    } finally {
      setIsExporting(null);
    }
  };

  const handleExportCSV = async () => {
    const { data, filename } = buildExport();

    if (!data.length) {
      toast.error("Nenhum dado para exportar");
      return;
    }

    setIsExporting("csv");
    try {
      await exportToCSV(data, filename);
      toast.success("Relatório exportado com sucesso");
    } catch {
      toast.error("Não foi possível exportar o relatório em CSV.");
    } finally {
      setIsExporting(null);
    }
  };

  const renderReportContent = () => {
    const isLoading =
      selectedReport === "commissions" ? commissionsLoading : entriesLoading;

    if (isLoading) {
      return (
        <div
          className="space-y-3"
          aria-busy="true"
          aria-label="Carregando relatório financeiro"
        >
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-12 rounded-[6px]" />
          ))}
        </div>
      );
    }

    const reportError =
      selectedReport === "commissions" ? commissionsError : entriesError;
    const isRetrying =
      selectedReport === "commissions"
        ? commissionsFetching
        : entriesFetching;
    const hasReportData =
      selectedReport === "commissions"
        ? commissionsByBroker !== undefined
        : entries !== undefined;

    if (reportError && !hasReportData) {
      return (
        <div
          className="flex min-h-[220px] flex-col items-center justify-center gap-3 px-6 text-center"
          role="alert"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <h3 className="text-[14px] font-normal text-[var(--app-text-primary)]">
            Não foi possível carregar este relatório
          </h3>
          <p className="max-w-sm text-[12px] font-light text-[var(--app-text-secondary)]">
            Verifique sua conexão e tente novamente. Nenhum valor foi
            substituído por estimativas.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 rounded-[6px] px-3 text-[12px] font-light shadow-none"
            disabled={isRetrying}
            onClick={() => {
              if (selectedReport === "commissions") void refetchCommissions();
              else void refetchEntries();
            }}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", isRetrying && "animate-spin")}
              aria-hidden="true"
            />
            {isRetrying ? "Atualizando..." : "Tentar novamente"}
          </Button>
        </div>
      );
    }

    if (!hasReportData) {
      return (
        <EmptyReportState>
          Os dados financeiros ainda não estão disponíveis para este acesso.
        </EmptyReportState>
      );
    }

    switch (selectedReport) {
      case "monthly": {
        const visibleEntries = filteredEntries.slice(0, 20);
        const remainingEntries = Math.max(
          filteredEntries.length - visibleEntries.length,
          0,
        );

        return (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Card className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] shadow-none">
                <CardContent className="p-4">
                  <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                    Receitas previstas
                  </p>
                  <p className="mt-1 break-words text-[16px] font-normal leading-tight tabular-nums text-success">
                    {formatCurrency(totalReceivables)}
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] shadow-none">
                <CardContent className="p-4">
                  <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                    Despesas previstas
                  </p>
                  <p className="mt-1 break-words text-[16px] font-normal leading-tight tabular-nums text-destructive">
                    {formatCurrency(totalPayables)}
                  </p>
                </CardContent>
              </Card>
              <Card className="rounded-[8px] border-0 bg-[var(--app-surface-soft)] shadow-none">
                <CardContent className="p-4">
                  <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                    Saldo
                  </p>
                  <p
                    className={cn(
                      "mt-1 break-words text-[16px] font-normal leading-tight tabular-nums",
                      totalReceivables - totalPayables >= 0
                        ? "text-success"
                        : "text-destructive",
                    )}
                  >
                    {formatCurrency(totalReceivables - totalPayables)}
                  </p>
                </CardContent>
              </Card>
            </div>

            {filteredEntries.length === 0 && entriesInOtherPeriods > 0 && (
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-4 text-center">
                <p className="text-[12px] font-light text-[var(--app-text-secondary)]">
                  Nenhum lançamento no período selecionado.
                </p>
                <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
                  Há{" "}
                  <span className="font-normal text-[var(--app-text-primary)]">
                    {entriesInOtherPeriods}
                  </span>{" "}
                  lançamento(s) em outros períodos. Selecione outro intervalo
                  para consultá-los.
                </p>
              </div>
            )}

            {entriesWithoutValidDueDate > 0 ? (
              <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                {entriesWithoutValidDueDate}{" "}
                {entriesWithoutValidDueDate === 1
                  ? "lançamento sem vencimento válido não entrou no período."
                  : "lançamentos sem vencimento válido não entraram no período."}
              </p>
            ) : null}

            {isMobile ? (
              <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                <CardContent className="p-0">
                  {visibleEntries.length > 0 ? (
                    visibleEntries.map((entry) => (
                      <EntryCardMobile key={entry.id} entry={entry} />
                    ))
                  ) : (
                    <EmptyReportState>
                      Nenhum lançamento encontrado no período selecionado.
                    </EmptyReportState>
                  )}
                </CardContent>
              </Card>
            ) : (
              <Table className="min-w-[720px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleEntries.length > 0 ? (
                    visibleEntries.map((entry) => {
                      const status = getEntryStatus(entry.status);
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            {entry.description || "Sem descrição"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                entry.type === "receivable"
                                  ? "text-success"
                                  : "text-destructive"
                              }
                            >
                              {entry.type === "receivable"
                                ? "Receita"
                                : "Despesa"}
                            </span>
                          </TableCell>
                          <TableCell className="text-right font-normal tabular-nums">
                            {formatCurrency(finiteNumber(entry.amount))}
                          </TableCell>
                          <TableCell>{formatDate(entry.due_date)}</TableCell>
                          <TableCell>
                            <span
                              className={cn(
                                "text-[12px] font-light",
                                status.className,
                              )}
                            >
                              {status.label}
                            </span>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-40 text-center text-[12px] font-light text-[var(--app-text-secondary)]"
                      >
                        Nenhum lançamento encontrado no período selecionado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}

            {remainingEntries > 0 ? (
              <p className="text-right text-[11px] font-light text-[var(--app-text-tertiary)]">
                Exibindo 20 de {filteredEntries.length} lançamentos. A
                exportação inclui todos os resultados do período.
              </p>
            ) : null}
          </div>
        );
      }

      case "cashflow": {
        const sortedEntries = [...filteredEntries].sort((left, right) => {
          const leftTime =
            parseFinancialDate(left.due_date)?.getTime() ??
            Number.MAX_SAFE_INTEGER;
          const rightTime =
            parseFinancialDate(right.due_date)?.getTime() ??
            Number.MAX_SAFE_INTEGER;
          return leftTime - rightTime;
        });
        let runningBalance = 0;
        const cashflowRows = sortedEntries.map((entry) => {
          runningBalance +=
            entry.type === "receivable"
              ? finiteNumber(entry.amount)
              : -finiteNumber(entry.amount);
          return { entry, balance: runningBalance };
        });

        return (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                  Entradas previstas
                </p>
                <p className="text-[14px] font-normal text-success">
                  {formatCurrency(totalReceivables)}
                </p>
              </div>
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                  Saídas previstas
                </p>
                <p className="text-[14px] font-normal text-destructive">
                  {formatCurrency(totalPayables)}
                </p>
              </div>
              <div className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
                <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                  Saldo projetado
                </p>
                <p className="text-[14px] font-normal">
                  {formatCurrency(runningBalance)}
                </p>
              </div>
            </div>

            {cashflowRows.length === 0 ? (
              <EmptyReportState>
                Nenhum lançamento no período selecionado.
              </EmptyReportState>
            ) : isMobile ? (
              <div className="overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)]">
                {cashflowRows.map(({ entry, balance }) => (
                  <div key={entry.id}>
                    <EntryCardMobile entry={entry} />
                    <p className="-mt-3 px-4 pb-3 text-right text-[11px] font-light text-[var(--app-text-secondary)]">
                      Saldo projetado: {formatCurrency(balance)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <Table className="min-w-[680px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Movimento</TableHead>
                    <TableHead className="text-right">
                      Saldo projetado
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cashflowRows.map(({ entry, balance }) => (
                    <TableRow key={entry.id}>
                      <TableCell>{formatDate(entry.due_date)}</TableCell>
                      <TableCell>
                        {entry.description || "Sem descrição"}
                      </TableCell>
                      <TableCell
                        className={`text-right ${entry.type === "receivable" ? "text-success" : "text-destructive"}`}
                      >
                        {entry.type === "receivable" ? "+" : "-"}{" "}
                        {formatCurrency(finiteNumber(entry.amount))}
                      </TableCell>
                      <TableCell className="text-right font-normal tabular-nums">
                        {formatCurrency(balance)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        );
      }

      case "property":
        return propertyRevenue.length === 0 ? (
          <EmptyReportState>
            Nenhuma receita vinculada a imóvel no período selecionado.
          </EmptyReportState>
        ) : isMobile ? (
          <div className="space-y-2">
            {propertyRevenue.map((property) => (
              <div
                key={property.key}
                className="rounded-[8px] bg-[var(--app-surface-soft)] p-3"
              >
                <p className="truncate text-[13px] font-normal">
                  {property.label}
                </p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <p className="text-[11px] font-light text-[var(--app-text-secondary)]">
                    {property.entryCount}{" "}
                    {property.entryCount === 1 ? "lançamento" : "lançamentos"}
                  </p>
                  <div className="text-right">
                    <p className="text-[13px] font-normal">
                      {formatCurrency(property.total)}
                    </p>
                    <p className="text-[11px] font-light text-success">
                      {formatCurrency(property.paid)} recebido
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Table className="min-w-[680px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
            <TableHeader>
              <TableRow>
                <TableHead>Imóvel</TableHead>
                <TableHead className="text-right">Lançamentos</TableHead>
                <TableHead className="text-right">Receita prevista</TableHead>
                <TableHead className="text-right">Receita recebida</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {propertyRevenue.map((property) => (
                <TableRow key={property.key}>
                  <TableCell>{property.label}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {property.entryCount}
                  </TableCell>
                  <TableCell className="text-right font-normal tabular-nums">
                    {formatCurrency(property.total)}
                  </TableCell>
                  <TableCell className="text-right text-success">
                    {formatCurrency(property.paid)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        );

      case "commissions":
        return isMobile ? (
          <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="p-0">
              {commissionsByBroker?.length === 0 ? (
                <EmptyReportState>
                  Nenhuma comissão encontrada
                </EmptyReportState>
              ) : (
                commissionsByBroker?.map((broker) => (
                  <CommissionCardMobile key={broker.user.id} broker={broker} />
                ))
              )}
            </CardContent>
          </Card>
        ) : (
          <Table className="min-w-[720px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
            <TableHeader>
              <TableRow>
                <TableHead>Corretor</TableHead>
                <TableHead className="text-right">Total Comissões</TableHead>
                <TableHead className="text-right">Previsão</TableHead>
                <TableHead className="text-right">Aprovadas</TableHead>
                <TableHead className="text-right">Pagas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissionsByBroker?.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={5}
                    className="h-40 text-center text-[12px] font-light text-[var(--app-text-secondary)]"
                  >
                    Nenhuma comissão encontrada
                  </TableCell>
                </TableRow>
              ) : (
                commissionsByBroker?.map((broker) => (
                  <TableRow key={broker.user.id}>
                    <TableCell className="font-normal">
                      {broker.user.name || "Corretor inativo"}
                    </TableCell>
                    <TableCell className="text-right font-normal tabular-nums">
                      {formatCurrency(finiteNumber(broker.total))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatCurrency(finiteNumber(broker.forecast))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-warning">
                      {formatCurrency(finiteNumber(broker.approved))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-success">
                      {formatCurrency(finiteNumber(broker.paid))}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        );

      case "payments": {
        const paymentsData = paidInPeriod;
        return isMobile ? (
          <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
            <CardContent className="p-0">
              {paymentsData.length === 0 ? (
                <EmptyReportState>
                  Nenhum pagamento no período
                </EmptyReportState>
              ) : (
                paymentsData.map((entry) => (
                  <EntryCardMobile
                    key={entry.id}
                    entry={entry}
                    amount={getPaidAmount(entry)}
                    dateValue={entry.paid_date}
                    dateLabel="Pagamento"
                  />
                ))
              )}
            </CardContent>
          </Card>
        ) : (
          <Table className="min-w-[620px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
            <TableHeader>
              <TableRow>
                <TableHead>Descrição</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Valor Pago</TableHead>
                <TableHead>Data Pagamento</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paymentsData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="h-40 text-center text-[12px] font-light text-[var(--app-text-secondary)]"
                  >
                    Nenhum pagamento no período
                  </TableCell>
                </TableRow>
              ) : (
                paymentsData.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      {entry.description || "Sem descrição"}
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          entry.type === "receivable"
                            ? "text-success"
                            : "text-destructive"
                        }
                      >
                        {entry.type === "receivable"
                          ? "Recebimento"
                          : "Pagamento"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-normal tabular-nums">
                      {formatCurrency(getPaidAmount(entry))}
                    </TableCell>
                    <TableCell>{formatDate(entry.paid_date)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        );
      }

      case "overdue":
        return (
          <div className="space-y-4">
            <Card className="rounded-[8px] border-0 bg-destructive/10 shadow-none">
              <CardContent className="p-4">
                <p className="text-[11px] font-light text-destructive">
                  Total em Atraso
                </p>
                <p className="mt-1 break-words text-[18px] font-normal leading-tight tabular-nums text-destructive">
                  {formatCurrency(totalOverdue)}
                </p>
                <p className="mt-1 text-[11px] font-light text-[var(--app-text-secondary)]">
                  {overdueEntriesFiltered.length}{" "}
                  {overdueEntriesFiltered.length === 1
                    ? "lançamento"
                    : "lançamentos"}
                </p>
              </CardContent>
            </Card>

            {isMobile ? (
              <Card className="rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
                <CardContent className="p-0">
                  {overdueEntriesFiltered.length === 0 ? (
                    <EmptyReportState>
                      Nenhuma pendência encontrada
                    </EmptyReportState>
                  ) : (
                    overdueEntriesFiltered.map((entry) => (
                      <EntryCardMobile
                        key={entry.id}
                        entry={entry}
                        amount={getOutstandingAmount(entry)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            ) : (
              <Table className="min-w-[720px] text-[12px] [&_td]:px-3 [&_td]:py-3 [&_th]:h-9 [&_th]:px-3 [&_th]:text-[10px] [&_th]:font-light">
                <TableHeader>
                  <TableRow>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead className="text-right">
                      Saldo em atraso
                    </TableHead>
                    <TableHead>Vencimento</TableHead>
                    <TableHead>Pessoa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueEntriesFiltered.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="h-40 text-center text-[12px] font-light text-[var(--app-text-secondary)]"
                      >
                        Nenhuma pendência encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    overdueEntriesFiltered.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell>
                          {entry.description || "Sem descrição"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={
                              entry.type === "receivable"
                                ? "text-success"
                                : "text-destructive"
                            }
                          >
                            {entry.type === "receivable" ? "Receber" : "Pagar"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-normal tabular-nums text-destructive">
                          {formatCurrency(getOutstandingAmount(entry))}
                        </TableCell>
                        <TableCell className="text-destructive">
                          {formatDate(entry.due_date)}
                        </TableCell>
                        <TableCell>{entry.category || "-"}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        );

      default:
        return (
          <EmptyReportState>
            Selecione um relatório para visualizar
          </EmptyReportState>
        );
    }
  };

  const selectedReportConfig = reports.find((r) => r.id === selectedReport);

  return (
    <AppLayout title="Relatórios Financeiros" borderless>
      <div className="mx-auto w-full max-w-[1440px] space-y-5 pb-8 sm:pt-2">
        <div className="min-w-0">
          <h2 className="text-[14px] font-normal text-[var(--app-text-primary)]">
            Análises financeiras
          </h2>
          <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
            Consulte os resultados por período e exporte os dados em CSV ou
            Excel.
          </p>
        </div>

        {((selectedReport === "commissions" &&
          commissionsError &&
          commissionsByBroker) ||
          (selectedReport !== "commissions" && entriesError && entries)) && (
          <div
            className="flex flex-col gap-2 rounded-[8px] bg-[var(--app-surface-soft)] px-3 py-2.5 text-[12px] font-light text-[var(--app-text-secondary)] sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <span>Os dados deste relatório podem estar desatualizados.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 shrink-0 rounded-[6px] px-3 text-[12px] font-light shadow-none"
              disabled={
                selectedReport === "commissions"
                  ? commissionsFetching
                  : entriesFetching
              }
              onClick={() => {
                if (selectedReport === "commissions") void refetchCommissions();
                else void refetchEntries();
              }}
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  (selectedReport === "commissions"
                    ? commissionsFetching
                    : entriesFetching) && "animate-spin",
                )}
                aria-hidden="true"
              />
              {(
                selectedReport === "commissions"
                  ? commissionsFetching
                  : entriesFetching
              )
                ? "Atualizando..."
                : "Atualizar novamente"}
            </Button>
          </div>
        )}

        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
          {/* Report Selection */}
          {isMobile ? (
            <Select
              value={selectedReport}
              onValueChange={(value) => setSelectedReport(value as ReportType)}
            >
              <SelectTrigger
                aria-label="Selecionar relatório financeiro"
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reports.map((report) => (
                  <SelectItem key={report.id} value={report.id}>
                    <div className="flex items-center gap-2">
                      <report.icon className="h-4 w-4" aria-hidden="true" />
                      {report.title}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <nav
              className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-1"
              aria-label="Tipos de relatório financeiro"
            >
              {reports.map((report) => (
                <button
                  type="button"
                  key={report.id}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-[8px] p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 ${
                    selectedReport === report.id
                      ? "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]"
                      : "bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]"
                  }`}
                  onClick={() => setSelectedReport(report.id)}
                  aria-pressed={selectedReport === report.id}
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[6px] bg-primary/50 text-primary-foreground">
                    <report.icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[12px] font-normal">
                      {report.title}
                    </span>
                    <span className="block text-[11px] font-light text-[var(--app-text-secondary)]">
                      {report.description}
                    </span>
                  </span>
                </button>
              ))}
            </nav>
          )}

          {/* Report Content */}
          <div className="min-w-0">
            <Card className="min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
              <CardHeader className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                <div className="min-w-0">
                  <CardTitle className="text-[14px] font-normal text-[var(--app-text-primary)]">
                    {selectedReportConfig?.title}
                  </CardTitle>
                  <CardDescription className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">
                    {selectedReportConfig?.description}
                  </CardDescription>
                </div>
                <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                  {selectedReport !== "commissions" ? (
                    <DateFilterPopover
                      datePreset={datePreset}
                      onDatePresetChange={handleDatePresetChange}
                      customDateRange={customDateRange}
                      onCustomDateRangeChange={setCustomDateRange}
                      defaultPreset="thisMonth"
                      align="end"
                    />
                  ) : (
                    <span className="mr-auto text-[11px] font-light text-[var(--app-text-tertiary)] sm:mr-0">
                      Visão consolidada
                    </span>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleExportCSV()}
                    disabled={isExporting !== null}
                    className="h-9 w-9 rounded-[6px] p-0 text-[12px] font-light shadow-none md:w-auto md:px-3"
                    aria-label={
                      isExporting === "csv"
                        ? "Exportando relatório em CSV"
                        : "Exportar relatório em CSV"
                    }
                    title="Exportar relatório em CSV"
                  >
                    {isExporting === "csv" ? (
                      <Loader2
                        className="h-4 w-4 animate-spin md:mr-1"
                        aria-hidden="true"
                      />
                    ) : (
                      <Download
                        className="h-4 w-4 md:mr-1"
                        aria-hidden="true"
                      />
                    )}
                    <span className="hidden md:inline">
                      {isExporting === "csv" ? "Exportando..." : "CSV"}
                    </span>
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => void handleExportExcel()}
                    disabled={isExporting !== null}
                    className="h-9 w-9 rounded-[6px] p-0 text-[12px] font-light shadow-none md:w-auto md:px-3"
                    aria-label={
                      isExporting === "excel"
                        ? "Exportando relatório em Excel"
                        : "Exportar relatório em Excel"
                    }
                    title="Exportar relatório em Excel"
                  >
                    {isExporting === "excel" ? (
                      <Loader2
                        className="h-4 w-4 animate-spin md:mr-1"
                        aria-hidden="true"
                      />
                    ) : (
                      <Download
                        className="h-4 w-4 md:mr-1"
                        aria-hidden="true"
                      />
                    )}
                    <span className="hidden md:inline">
                      {isExporting === "excel" ? "Exportando..." : "Excel"}
                    </span>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 sm:px-5 sm:pb-5">
                {renderReportContent()}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
