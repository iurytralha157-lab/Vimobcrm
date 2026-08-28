"use client";

import { useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/shared/layout/AppLayout";
import { PremiumFinancialCard } from "@/components/features/financial/PremiumFinancialCard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CommissionStatusBadge } from "@/components/features/financial/CommissionStatusBadge";
import { formatCurrency, formatDate } from "@/lib/export-financial";
import {
  AlertTriangle,
  DollarSign,
  Clock,
  CheckCircle2,
  Award,
  Target,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useCommissions } from "@/hooks/use-commissions";

export default function BrokerFinancialPanel() {
  const { user } = useAuth();
  const userId = user?.id;

  const {
    data: commissions,
    isLoading,
    error,
    refetch,
  } = useCommissions(userId ? { userId } : undefined, {
    enabled: Boolean(userId),
  });

  if (!userId || isLoading) {
    return (
      <AppLayout title="Meu Financeiro">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </AppLayout>
    );
  }

  if (error && !commissions) {
    return (
      <AppLayout title="Meu Financeiro (Corretor)">
        <section
          className="app-card flex min-h-[240px] flex-col items-center justify-center gap-3 px-6 text-center"
          role="alert"
        >
          <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <h2 className="text-[14px] font-normal">
            Não foi possível carregar seu financeiro
          </h2>
          <p className="max-w-sm text-[12px] font-light text-[var(--app-text-secondary)]">
            Verifique sua conexão e tente novamente. Nenhum valor foi
            substituído por estimativas.
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void refetch()}
          >
            Tentar novamente
          </Button>
        </section>
      </AppLayout>
    );
  }

  const stats = {
    paid:
      commissions
        ?.filter((c) => c.status === "paid")
        .reduce((acc, c) => acc + Number(c.calculated_value), 0) || 0,
    approved:
      commissions
        ?.filter((c) => c.status === "approved")
        .reduce((acc, c) => acc + Number(c.calculated_value), 0) || 0,
    forecast:
      commissions
        ?.filter((c) => c.status === "forecast")
        .reduce((acc, c) => acc + Number(c.calculated_value), 0) || 0,
    totalDeals: new Set(commissions?.map((c) => c.contract_id)).size,
  };

  return (
    <AppLayout title="Meu Financeiro (Corretor)">
      <div className="space-y-6">
        {error && commissions && (
          <div
            className="app-card-soft flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[12px] font-light"
            role="alert"
          >
            <span>Os valores podem estar desatualizados.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void refetch()}
            >
              Atualizar novamente
            </Button>
          </div>
        )}
        {/* KPI Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <PremiumFinancialCard
            title="Recebido"
            value={formatCurrency(stats.paid)}
            icon={CheckCircle2}
            variant="success"
            chartData={commissions
              ?.filter((c) => c.status === "paid")
              .map((c) => ({ value: Number(c.calculated_value) }))}
          />
          <PremiumFinancialCard
            title="Liberado para Receber"
            value={formatCurrency(stats.approved)}
            icon={DollarSign}
            variant="primary"
          />
          <PremiumFinancialCard
            title="Previsão Futura"
            value={formatCurrency(stats.forecast)}
            icon={Clock}
            variant="warning"
          />
          <PremiumFinancialCard
            title="Total Negócios"
            value={String(stats.totalDeals)}
            icon={Award}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent Commissions Table */}
          <Card className="app-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Histórico de Comissões</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contrato</TableHead>
                    <TableHead>Cliente</TableHead>
                    <TableHead className="text-right">Sua Parte</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Previsão</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {commissions?.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center py-8 text-muted-foreground"
                      >
                        Nenhuma comissão encontrada
                      </TableCell>
                    </TableRow>
                  ) : (
                    commissions?.map((comm) => (
                      <TableRow
                        key={comm.id}
                        className="transition-colors hover:bg-[var(--app-surface-hover)]"
                      >
                        <TableCell className="font-medium">
                          {comm.contract?.contract_number || "S/N"}
                        </TableCell>
                        <TableCell>
                          {comm.contract?.client_name || "-"}
                        </TableCell>
                        <TableCell className="text-right font-normal text-primary">
                          {formatCurrency(comm.calculated_value)}
                        </TableCell>
                        <TableCell>
                          <CommissionStatusBadge status={comm.status} />
                        </TableCell>
                        <TableCell>{formatDate(comm.forecast_date)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Status summary */}
          <Card className="app-card">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5 text-primary" />
                Resumo das Comissões
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {[
                {
                  label: "Previstas",
                  count:
                    commissions?.filter((item) => item.status === "forecast")
                      .length || 0,
                  value: stats.forecast,
                },
                {
                  label: "Liberadas",
                  count:
                    commissions?.filter((item) => item.status === "approved")
                      .length || 0,
                  value: stats.approved,
                },
                {
                  label: "Pagas",
                  count:
                    commissions?.filter((item) => item.status === "paid")
                      .length || 0,
                  value: stats.paid,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="app-card-soft flex items-center justify-between gap-3 rounded-[6px] px-3 py-2.5"
                >
                  <div>
                    <p className="text-[12px] font-normal">{item.label}</p>
                    <p className="text-[11px] font-light text-[var(--app-text-tertiary)]">
                      {item.count} {item.count === 1 ? "comissão" : "comissões"}
                    </p>
                  </div>
                  <span className="text-[13px] font-normal tabular-nums">
                    {formatCurrency(item.value)}
                  </span>
                </div>
              ))}
              {!commissions?.length && (
                <p className="py-4 text-center text-[12px] font-light text-[var(--app-text-secondary)]">
                  Ainda não há comissões vinculadas ao seu usuário.
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
