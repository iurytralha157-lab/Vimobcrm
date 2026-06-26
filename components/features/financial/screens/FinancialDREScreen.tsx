'use client';

import { useState } from 'react';
import { AppLayout } from '@/components/shared/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Download, Settings2, TrendingUp, ArrowUpRight, ArrowDownRight, FileSpreadsheet, Loader2 } from 'lucide-react';
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

  const { data: groups, isLoading: groupsLoading } = useDREGroups();
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

  const { data: dreData, isLoading: dreLoading } = useDRE({
    startDate,
    endDate,
    regime,
    compareWithPrevious
  });

  const handleInitializeGroups = async () => {
    try {
      await initializeGroups();
      toast.success('Grupos do DRE inicializados com sucesso!');
    } catch {
      toast.error('Erro ao inicializar grupos do DRE');
    }
  };

  const handleExportExcel = () => {
    toast.info('Exportação Excel em desenvolvimento');
  };

  const handleExportPDF = () => {
    toast.info('Exportação PDF em desenvolvimento');
  };

  // Gerar opções de meses (últimos 12 meses)
  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const date = subMonths(new Date(), i);
    return {
      value: format(date, 'yyyy-MM'),
      label: format(date, 'MMMM yyyy', { locale: ptBR })
    };
  });

  const hasNoGroups = !groupsLoading && (!groups || groups.length === 0);

  return (
    <AppLayout title="DRE - Demonstrativo de Resultado">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <p className="text-muted-foreground">
            Análise do resultado financeiro do exercício
          </p>

          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleExportExcel}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              Excel
            </Button>
            <Button variant="outline" size="sm" onClick={handleExportPDF}>
              <Download className="h-4 w-4 mr-2" />
              PDF
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
        <Tabs defaultValue="report" className="space-y-4">
          <TabsList>
            <TabsTrigger value="report">
              <TrendingUp className="h-4 w-4 mr-2" />
              Relatório
            </TabsTrigger>
            <TabsTrigger value="config">
              <Settings2 className="h-4 w-4 mr-2" />
              Configuração
            </TabsTrigger>
          </TabsList>

          <TabsContent value="report">
            {hasNoGroups ? (
              <Card className="app-card">
                <CardContent className="py-12 text-center">
                  <div className="mx-auto w-12 h-12 rounded-full bg-white/[0.055] flex items-center justify-center mb-4">
                    <Settings2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="text-lg font-semibold mb-2">Configuração Inicial</h3>
                  <p className="text-muted-foreground mb-4 max-w-md mx-auto">
                    O DRE precisa ser configurado antes do primeiro uso.
                    Clique abaixo para criar a estrutura padrão de grupos contábeis.
                  </p>
                  <Button onClick={handleInitializeGroups}>
                    Inicializar Grupos do DRE
                  </Button>
                </CardContent>
              </Card>
            ) : dreLoading ? (
              <Card className="app-card">
                <CardContent className="py-12 flex items-center justify-center">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </CardContent>
              </Card>
            ) : dreData ? (
              <>
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
          <span className={`text-lg font-bold ${getColors()}`}>
            {formatCurrency(value)}
          </span>
          {getIcon()}
        </div>
      </CardContent>
    </Card>
  );
}
