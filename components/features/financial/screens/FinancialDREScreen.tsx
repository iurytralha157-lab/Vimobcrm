'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Settings2, TrendingUp, ArrowUpRight, ArrowDownRight, FileSpreadsheet, Loader2, Printer, RefreshCw } from 'lucide-react';
import { useDRE, useDREGroups, useInitializeDREGroups } from '@/hooks/use-dre';
import { DREReport } from '@/components/features/financial/DREReport';
import { DREAccountConfig } from '@/components/features/financial/DREAccountConfig';
import { startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, subMonths, format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { toast } from 'sonner';

type PeriodType = 'month' | 'quarter' | 'year' | 'custom';
type RegimeType = 'cash' | 'accrual';

export default function FinancialDRE() {
  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [regime, setRegime] = useState<RegimeType>('cash');
  const [compareWithPrevious, setCompareWithPrevious] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => format(new Date(), 'yyyy-MM'));
  const [isInitializingGroups, setIsInitializingGroups] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const {
    data: groups,
    isLoading: groupsLoading,
    error: groupsError,
    refetch: refetchGroups,
  } = useDREGroups();
  const { initializeGroups } = useInitializeDREGroups();

  // Calcular datas baseado no período selecionado
  const getDates = () => {
    const now = new Date();
    switch (periodType) {
      case 'month': {
        const [year, month] = selectedMonth.split('-').map(Number);
        const date = new Date(year, month - 1, 1);
        return { start: startOfMonth(date), end: endOfMonth(date) };
      }
      case 'quarter':
        return { start: startOfQuarter(now), end: endOfQuarter(now) };
      case 'year':
        return { start: startOfYear(now), end: endOfYear(now) };
      default:
        return { start: startOfMonth(now), end: endOfMonth(now) };
    }
  };

  const { start: startDate, end: endDate } = getDates();

  const {
    data: dreData,
    isLoading: dreLoading,
    error: dreError,
    refetch: refetchDRE,
  } = useDRE({
    startDate,
    endDate,
    regime,
    compareWithPrevious
  });

  const handleInitializeGroups = async () => {
    setIsInitializingGroups(true);
    try {
      await initializeGroups();
      await refetchGroups();
      toast.success('Grupos do DRE inicializados com sucesso!');
    } catch {
      toast.error('Erro ao inicializar grupos do DRE');
    } finally {
      setIsInitializingGroups(false);
    }
  };

  const handleExportExcel = async () => {
    if (!dreData) {
      toast.error('Carregue o relatório antes de exportar.');
      return;
    }

    setIsExporting(true);
    try {
      const { exportToExcel } = await import('@/lib/export-financial');
      await exportToExcel(
        dreData.lines.map((line) => ({
          Conta: line.name,
          Valor: line.value,
          'Valor anterior': line.previousValue,
          'Percentual da receita': line.percentage,
          'Variação percentual': line.variation,
        })),
        `dre-${format(startDate, 'yyyy-MM-dd')}-${format(endDate, 'yyyy-MM-dd')}`,
        'DRE',
      );
    } catch {
      toast.error('Não foi possível gerar a planilha agora.');
    } finally {
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  // Gerar opções de meses (últimos 12 meses)
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy', { locale: ptBR })
    };
  });

  const hasNoGroups = !groupsLoading && !groupsError && (!groups || groups.length === 0);

  return (
    <AppLayout title="DRE - Demonstrativo de Resultado">
      <div className="space-y-3">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Análise do resultado financeiro do exercício
          </p>

          <div className="flex items-center gap-2">
            <Button className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]" onClick={() => void handleExportExcel()} disabled={!dreData || isExporting}>
              {isExporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />}
              {isExporting ? 'Exportando...' : 'Excel'}
            </Button>
            <Button className="h-8 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none hover:bg-[var(--app-surface-hover)]" onClick={handlePrint} disabled={!dreData}>
              <Printer className="mr-1.5 h-3.5 w-3.5" />
              Imprimir / PDF
            </Button>
          </div>
        </div>

        {/* Filtros */}
        <Card className="app-card">
          <CardContent className="pt-6">
            <div className="flex flex-wrap items-end gap-4">
              {/* Período */}
              <div className="space-y-2">
                <Label>Período</Label>
                <Select value={periodType} onValueChange={(v) => setPeriodType(v as PeriodType)}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="month">Mensal</SelectItem>
                    <SelectItem value="quarter">Trimestral</SelectItem>
                    <SelectItem value="year">Anual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Seletor de mês */}
              {periodType === 'month' && (
                <div className="space-y-2">
                  <Label>Mês</Label>
                  <Select value={selectedMonth} onValueChange={setSelectedMonth}>
                    <SelectTrigger className="w-[180px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map(opt => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Regime */}
              <div className="space-y-2">
                <Label>Regime</Label>
                <Select value={regime} onValueChange={(v) => setRegime(v as RegimeType)}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Caixa</SelectItem>
                    <SelectItem value="accrual">Competência</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Comparativo */}
              <div className="flex items-center gap-2 pb-1">
                <Switch
                  id="compare"
                  checked={compareWithPrevious}
                  onCheckedChange={setCompareWithPrevious}
                />
                <Label htmlFor="compare" className="cursor-pointer">
                  Comparar com período anterior
                </Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Conteúdo Principal */}
        <Tabs defaultValue="report" className="min-w-0 space-y-3">
          <div className="app-responsive-tab-list min-w-0" data-collapse="compact">
            <TabsList data-responsive-tab-scroll className="h-auto w-fit max-w-full justify-start overflow-x-auto rounded-[8px] bg-[var(--app-surface-soft)] p-1 shadow-none [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <TabsTrigger value="report" data-responsive-tab aria-label="Relatório" title="Relatório" className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none">
              <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="app-responsive-tab-label">Relatório</span>
            </TabsTrigger>
            <TabsTrigger value="config" data-responsive-tab aria-label="Configuração" title="Configuração" className="rounded-[6px] text-[12px] font-light shadow-none data-[state=active]:bg-[var(--app-surface-solid)] data-[state=active]:shadow-none">
              <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="app-responsive-tab-label">Configuração</span>
            </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="report">
            {groupsError ? (
              <FinancialErrorState
                message="Não foi possível carregar a configuração do DRE."
                onRetry={() => void refetchGroups()}
              />
            ) : hasNoGroups ? (
              <Card className="app-card">
                <CardContent className="py-12 text-center">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)]">
                    <Settings2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="mb-2 text-[14px] font-normal">Configuração Inicial</h3>
                  <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                    O DRE precisa ser configurado antes do primeiro uso.
                    Clique abaixo para criar a estrutura padrão de grupos contábeis.
                  </p>
                  <Button onClick={() => void handleInitializeGroups()} disabled={isInitializingGroups}>
                    {isInitializingGroups ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                    {isInitializingGroups ? 'Inicializando...' : 'Inicializar Grupos do DRE'}
                  </Button>
                </CardContent>
              </Card>
            ) : dreLoading ? (
              <Card className="app-card">
                <CardContent className="py-12 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : dreError && !dreData ? (
              <FinancialErrorState
                message="Não foi possível carregar o relatório do período."
                onRetry={() => void refetchDRE()}
              />
            ) : dreData ? (
              <>
                {dreError ? (
                  <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-[8px] bg-destructive/10 px-3 py-2 text-[12px] font-light text-destructive">
                    <span>Os dados abaixo podem estar desatualizados.</span>
                    <Button variant="ghost" className="h-8 rounded-[6px] px-2.5 text-[12px] font-light" onClick={() => void refetchDRE()}>
                      Tentar novamente
                    </Button>
                  </div>
                ) : null}
                {/* Cards de resumo */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                  <SummaryCard
                    title="Receita Bruta"
                    value={dreData.totals.grossRevenue}
                    type="revenue"
                  />
                  <SummaryCard
                    title="Receita Líquida"
                    value={dreData.totals.netRevenue}
                    type="neutral"
                  />
                  <SummaryCard
                    title="Lucro Bruto"
                    value={dreData.totals.grossProfit}
                    type="neutral"
                  />
                  <SummaryCard
                    title="EBITDA"
                    value={dreData.totals.operatingResult}
                    type={dreData.totals.operatingResult >= 0 ? 'positive' : 'negative'}
                  />
                  <SummaryCard
                    title="Resultado Líquido"
                    value={dreData.totals.netResult}
                    type={dreData.totals.netResult >= 0 ? 'positive' : 'negative'}
                  />
                </div>

                <DREReport
                  data={dreData}
                  showPrevious={compareWithPrevious}
                  regime={regime}
                />
              </>
            ) : null}
          </TabsContent>

          <TabsContent value="config">
            <DREAccountConfig />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}

function FinancialErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="app-card">
      <CardContent className="flex flex-col items-center py-12 text-center">
        <span className="grid h-10 w-10 place-items-center rounded-[6px] bg-destructive/10 text-destructive">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
        </span>
        <h3 className="mt-3 text-[14px] font-normal">Não foi possível carregar</h3>
        <p className="mt-1 text-[12px] font-light text-[var(--app-text-secondary)]">{message}</p>
        <Button className="mt-4 h-8 rounded-[6px] bg-primary/50 px-3 text-[12px] font-light text-primary-foreground shadow-none hover:bg-primary" onClick={onRetry}>
          Tentar novamente
        </Button>
      </CardContent>
    </Card>
  );
}

interface SummaryCardProps {
  title: string;
  value: number;
  type: 'revenue' | 'positive' | 'negative' | 'neutral';
}

function SummaryCard({ title, value, type }: SummaryCardProps) {
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(val);
  };

  const getColors = () => {
    switch (type) {
      case 'revenue':
        return 'text-blue-600 dark:text-blue-400';
      case 'positive':
        return 'text-emerald-600 dark:text-emerald-400';
      case 'negative':
        return 'text-red-600 dark:text-red-400';
      default:
        return 'text-foreground';
    }
  };

  const getIcon = () => {
    if (type === 'positive') return <ArrowUpRight className="h-4 w-4 text-emerald-500" />;
    if (type === 'negative') return <ArrowDownRight className="h-4 w-4 text-red-500" />;
    return null;
  };

  return (
    <Card className="app-card-soft">
      <CardContent className="pt-4 pb-3">
        <p className="text-xs text-muted-foreground mb-1">{title}</p>
        <div className="flex items-center gap-1">
          <span className={`text-[14px] font-normal ${getColors()}`}>
            {formatCurrency(value)}
          </span>
          {getIcon()}
        </div>
      </CardContent>
    </Card>
  );
}
