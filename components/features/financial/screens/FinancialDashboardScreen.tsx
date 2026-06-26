'use client';

import type { ComponentType } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Award,
  Calendar,
  DollarSign,
  Download,
  FileText,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react';
import { Area, AreaChart, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';

import { PremiumFinancialCard } from '@/components/features/financial/PremiumFinancialCard';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { useFinancialDashboard } from '@/hooks/use-financial';
import { exportToExcel, formatCurrency } from '@/lib/export-financial';

const FinancialChartTooltipContent = ChartTooltipContent as unknown as ComponentType<Record<string, unknown>>;

export default function FinancialDashboard() {
  const realEstateData = useFinancialDashboard();

  if (realEstateData.isLoading) {
    return (
      <AppLayout title="Dashboard Financeiro">
        <div className="space-y-4 md:space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-2 md:gap-4 lg:grid-cols-4">
            {[1, 2, 3, 4].map((item) => (
              <Skeleton key={item} className="h-24 rounded-[6px] md:h-32" />
            ))}
          </div>
        </div>
      </AppLayout>
    );
  }

  if (realEstateData.isError) {
    return (
      <AppLayout title="Dashboard Financeiro">
        <Card className="app-card mx-auto max-w-2xl">
          <CardContent className="py-10 text-center">
            <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-[#FF4529]" />
            <h2 className="text-lg font-semibold">Financeiro aguardando estrutura</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              O painel financeiro está pronto no front-end. Quando as tabelas financeiras forem finalizadas, os indicadores carregam automaticamente.
            </p>
          </CardContent>
        </Card>
      </AppLayout>
    );
  }

  return <RealEstateFinancialDashboard data={realEstateData.data} />;
}

function RealEstateFinancialDashboard({ data }: { data: ReturnType<typeof useFinancialDashboard>['data'] }) {
  const chartConfig = {
    receitas: { label: 'Receitas', color: 'var(--success)' },
    despesas: { label: 'Despesas', color: 'var(--destructive)' },
  };

  const totalOverdue = (data?.overdueReceivables || 0) + (data?.overduePayables || 0);

  const handleExport = () => {
    if (!data) return;

    const exportData = [
      { Metrica: 'VGV Bruto', Valor: formatCurrency(data.vgvBruto) },
      { Metrica: 'VGV Líquido', Valor: formatCurrency(data.vgvLiquido) },
      { Metrica: 'Ticket Médio', Valor: formatCurrency(data.avgTicket) },
      { Metrica: 'Receita Confirmada (30d)', Valor: formatCurrency(data.confirmedRevenue30) },
      { Metrica: 'A Receber (30d)', Valor: formatCurrency(data.receivable30) },
      { Metrica: 'A Pagar', Valor: formatCurrency(data.totalPayable) },
      { Metrica: 'Vencidos', Valor: formatCurrency(totalOverdue) },
      { Metrica: 'Comissões Previstas', Valor: formatCurrency(data.forecastCommissions) },
      { Metrica: 'Comissões Liberadas', Valor: formatCurrency(data.pendingCommissions) },
      { Metrica: 'Comissões Pagas', Valor: formatCurrency(data.paidCommissions) },
      { Metrica: 'Projeção Anual', Valor: formatCurrency(data.annualProjection) },
    ];

    exportToExcel(exportData, `Dashboard_Financeiro_${format(new Date(), 'yyyy-MM-dd')}`);
    toast.success('Resumo financeiro exportado com sucesso!');
  };

  return (
    <AppLayout title="Dashboard Financeiro">
      <div className="space-y-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Performance Financeira</h2>
            <p className="text-balance text-sm text-muted-foreground">
              Métricas consolidadas de vendas e recebimentos.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="hidden gap-2 md:flex" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exportar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="hidden gap-2 md:flex"
              onClick={() => {
                window.location.href = '/financeiro/dre';
              }}
            >
              <FileText className="h-4 w-4" />
              Ver DRE Executivo
            </Button>
            <Badge variant="outline" className="border-primary/20 bg-primary/5 px-3 py-1 text-xs font-bold text-primary">
              ESTRATÉGICO
            </Badge>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 md:gap-6 lg:grid-cols-4">
          <PremiumFinancialCard
            title="VGV Bruto"
            value={formatCurrency(data?.vgvBruto || 0)}
            description={`${data?.activeContracts || 0} contratos ativos`}
            icon={Award}
            variant="primary"
            chartData={data?.monthlyData?.map((month) => ({ value: month.receitas }))}
          />
          <PremiumFinancialCard
            title="VGV Líquido"
            value={formatCurrency(data?.vgvLiquido || 0)}
            description="Líquido de comissões"
            icon={Target}
            variant="success"
          />
          <PremiumFinancialCard
            title="Ticket Médio"
            value={formatCurrency(data?.avgTicket || 0)}
            description="Média por contrato"
            icon={FileText}
          />
          <PremiumFinancialCard
            title="Receita Confirmada (30d)"
            value={formatCurrency(data?.confirmedRevenue30 || 0)}
            description="Entradas pagas nos últimos 30 dias"
            icon={TrendingUp}
            variant="success"
            chartData={data?.monthlyData?.map((month) => ({ value: month.receitas }))}
          />
          <PremiumFinancialCard
            title="A Receber (30d)"
            value={formatCurrency(data?.receivable30 || 0)}
            description="Entradas previstas"
            icon={Calendar}
          />
          <PremiumFinancialCard
            title="A Pagar"
            value={formatCurrency(data?.totalPayable || 0)}
            description="Despesas em aberto"
            icon={TrendingDown}
            variant="warning"
          />
          <PremiumFinancialCard
            title="Vencidos"
            value={formatCurrency(totalOverdue)}
            description="Atrasados"
            icon={AlertTriangle}
            variant="destructive"
          />
          <PremiumFinancialCard
            title="Taxa de Inadimplência"
            value={`${(data?.defaultRate || 0).toFixed(1)}%`}
            description="Vencidos / total previsto"
            icon={AlertTriangle}
            variant="destructive"
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <Card className="app-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Evolução do Fluxo de Caixa</CardTitle>
              <CardDescription>Receitas realizadas vs despesas nos últimos 6 meses.</CardDescription>
            </CardHeader>
            <CardContent className="pt-0">
              {data?.monthlyData && data.monthlyData.length > 0 ? (
                <ChartContainer config={chartConfig} className="h-[300px] w-full">
                  <AreaChart data={data.monthlyData}>
                    <defs>
                      <linearGradient id="colorReceitas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--success)" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="var(--success)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorDespesas" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="var(--destructive)" stopOpacity={0.1} />
                        <stop offset="95%" stopColor="var(--destructive)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                    <YAxis axisLine={false} tickLine={false} tickFormatter={(value) => `R$ ${value / 1000}k`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
                    <ChartTooltip content={<FinancialChartTooltipContent />} />
                    <Area type="monotone" dataKey="receitas" stroke="var(--success)" fillOpacity={1} fill="url(#colorReceitas)" strokeWidth={3} />
                    <Area type="monotone" dataKey="despesas" stroke="var(--destructive)" fillOpacity={1} fill="url(#colorDespesas)" strokeWidth={2} strokeDasharray="5 5" />
                  </AreaChart>
                </ChartContainer>
              ) : (
                <div className="flex h-[300px] items-center justify-center text-sm text-muted-foreground">
                  Sem dados históricos
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="app-card">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <DollarSign className="h-5 w-5 text-primary" />
                  Resumo de Comissões
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="app-card-soft flex items-center justify-between p-3">
                  <span className="text-sm font-medium">Previstas</span>
                  <span className="font-bold">{formatCurrency(data?.forecastCommissions || 0)}</span>
                </div>
                <div className="flex items-center justify-between rounded-[6px] bg-primary/[0.045] p-3">
                  <span className="text-sm font-medium text-primary">Liberadas</span>
                  <span className="font-bold text-primary">{formatCurrency(data?.pendingCommissions || 0)}</span>
                </div>
                <div className="flex items-center justify-between rounded-[6px] bg-success/[0.045] p-3">
                  <span className="text-sm font-medium text-success">Pagas</span>
                  <span className="font-bold text-success">{formatCurrency(data?.paidCommissions || 0)}</span>
                </div>
              </CardContent>
            </Card>

            <Card className="app-card bg-primary/[0.045]">
              <CardContent className="p-6">
                <p className="mb-2 text-sm font-semibold text-primary">Previsão Anual (Forecast)</p>
                <h3 className="text-3xl font-bold">{formatCurrency(data?.annualProjection || 0)}</h3>
                <p className="mt-2 text-xs text-muted-foreground">
                  Baseado no volume de recebimentos recorrentes atuais.
                </p>
                <Button className="mt-6 w-full">Ver Relatório Detalhado</Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
