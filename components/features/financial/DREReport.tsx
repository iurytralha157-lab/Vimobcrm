import { DREData, DRELine } from '@/hooks/use-dre';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

interface DREReportProps {
  data: DREData;
  showPrevious: boolean;
  regime: 'cash' | 'accrual';
}

export function DREReport({ data, showPrevious, regime }: DREReportProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value);
  };

  const formatPercentage = (value: number | undefined) => {
    if (value === undefined) return '-';
    return `${value.toFixed(1)}%`;
  };

  const formatVariation = (value: number | undefined) => {
    if (value === undefined) return null;
    const formatted = `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
    if (value > 0) {
      return (
        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
          <TrendingUp className="h-3 w-3" />
          {formatted}
        </span>
      );
    } else if (value < 0) {
      return (
        <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
          <TrendingDown className="h-3 w-3" />
          {formatted}
        </span>
      );
    }
    return (
      <span className="flex items-center gap-1 text-muted-foreground">
        <Minus className="h-3 w-3" />
        0%
      </span>
    );
  };

  const getRowStyles = (line: DRELine) => {
    if (line.isTotal) {
      if (line.id.includes('net_result') || line.id.includes('net_revenue')) {
        return 'bg-primary/10 font-bold';
      }
      if (line.id.includes('total') || line.id.includes('ebitda')) {
        return 'bg-white/[0.055] font-semibold';
      }
      return 'font-semibold bg-white/[0.035]';
    }
    return '';
  };

  const getValueColor = (line: DRELine) => {
    if (line.id === 'total_net_result') {
      return line.value >= 0
        ? 'text-emerald-600 dark:text-emerald-400'
        : 'text-red-600 dark:text-red-400';
    }
    if (line.type === 'deduction' || line.type === 'cost' || line.type === 'expense' || line.type === 'financial_expense' || line.type === 'tax') {
      return 'text-red-600 dark:text-red-400';
    }
    if (line.type === 'revenue' || line.type === 'financial_revenue') {
      return 'text-emerald-600 dark:text-emerald-400';
    }
    return '';
  };

  const periodLabel = `${format(new Date(data.period.start), 'dd/MM/yyyy', { locale: ptBR })} a ${format(new Date(data.period.end), 'dd/MM/yyyy', { locale: ptBR })}`;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg">
          DRE - {periodLabel}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Regime de {regime === 'cash' ? 'Caixa' : 'Competência'}
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[40%]">Conta</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead className="text-right w-[80px]">AV %</TableHead>
                {showPrevious && (
                  <>
                    <TableHead className="text-right">Anterior</TableHead>
                    <TableHead className="text-right w-[100px]">Variação</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.lines.map((line) => (
                <TableRow
                  key={line.id}
                  className={cn(getRowStyles(line), 'hover:bg-white/[0.035]')}
                >
                  <TableCell
                    className={cn(
                      line.level === 1 && 'pl-8',
                      line.level === 2 && 'pl-12',
                      !line.isTotal && 'text-muted-foreground'
                    )}
                  >
                    {line.name}
                  </TableCell>
                  <TableCell className={cn('text-right tabular-nums', getValueColor(line))}>
                    {line.isTotal && line.type !== 'total' ? (
                      <span className="font-medium">{formatCurrency(line.value)}</span>
                    ) : (
                      formatCurrency(line.value)
                    )}
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatPercentage(line.percentage)}
                  </TableCell>
                  {showPrevious && (
                    <>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {line.previousValue !== undefined ? formatCurrency(line.previousValue) : '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatVariation(line.variation)}
                      </TableCell>
                    </>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Legenda */}
        <div className="mt-6 pt-4 border-t flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500" />
            <span>Receitas</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded bg-red-500/20 border border-red-500" />
            <span>Custos e Despesas</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium">AV%</span>
            <span>= Análise Vertical (% sobre Receita Bruta)</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
