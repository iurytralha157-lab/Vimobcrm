import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { List, Search, X } from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { DASHBOARD_CHART_COLORS } from '@/config/dashboard-chart-colors';
import { DashboardChartError } from '@/components/features/dashboard/DashboardChartError';
import { LeadSourceRows } from '@/components/features/dashboard/LeadSourceRows';
import { getSourceFilterUnavailableReason } from '@/lib/validation/dashboard-filter-text';
import { useDashboardQueryScope } from '@/hooks/use-dashboard-stats';
import { useDashboardDialogFocus } from '@/hooks/dashboard/use-dashboard-dialog-focus';
import {
  buildDashboardSourcesModel, DASHBOARD_SOURCE_PAGE_SIZE, filterDashboardSources,
  formatDashboardSourcePercentage, formatDashboardSourceTotal, type DashboardSource, type DashboardSourceSlice,
} from '@/components/features/dashboard/lead-sources-model';

interface LeadSourcesChartProps {
  data: DashboardSource[];
  countEntries: boolean;
  isLoading?: boolean;
  isError: boolean;
  onRetry: () => void;
  selectedSource?: string | null;
  onSourceChange?: (source: string | null) => void;
}
type ChartPoint = DashboardSourceSlice & { color: string; percentage: string };
const INITIAL_CHART_DIMENSION = { width: 180, height: 180 };

function LeadSourcesTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: ChartPoint; value?: number | string }>;
}) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  const value = Number(payload?.[0]?.value ?? point.value);
  const unitLabel = value === 1 ? 'lead' : 'leads';
  return (
    <div className="max-w-[min(280px,calc(100vw-32px))] rounded-[8px] bg-[var(--app-surface-solid)] px-3 py-2 text-[11px] text-[var(--app-text-primary)] shadow-md">
      <p className="break-all">{point.name}</p>
      <p className="mt-1 tabular-nums">{value.toLocaleString('pt-BR')} {unitLabel} · {point.percentage}</p>
    </div>
  );
}

export function LeadSourcesChart({ data, countEntries, isLoading, isError, onRetry, selectedSource, onSourceChange }: LeadSourcesChartProps) {
  const dashboardScope = useDashboardQueryScope();
  const dialogFocus = useDashboardDialogFocus(
    dashboardScope.isReady && !isError ? dashboardScope.accessSignature : null,
  );
  const otherSourcesTrigger = useRef<HTMLButtonElement>(null);
  const title = 'Origem dos leads';
  const unit = 'Leads';
  const [detailOpen, setDetailOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(DASHBOARD_SOURCE_PAGE_SIZE);
  const model = useMemo(() => buildDashboardSourcesModel(data), [data]);
  const matchingSources = useMemo(() => filterDashboardSources(model.sources, search), [model.sources, search]);
  const totalLabel = formatDashboardSourceTotal(model.total);
  const totalFontSize = totalLabel.length > 7 ? 12 : totalLabel.length > 5 ? 16 : 20;
  const chartData: ChartPoint[] = model.slices.map((source, index) => ({
    ...source,
    color: source.isOther ? 'var(--app-text-tertiary)' : DASHBOARD_CHART_COLORS[index],
    percentage: formatDashboardSourcePercentage(source.value, model.total),
  }));
  const openDetail = (trigger: HTMLElement | null) => {
    if (trigger) dialogFocus.captureTrigger(trigger);
    else dialogFocus.skipRestore();
    setSearch('');
    setVisibleCount(DASHBOARD_SOURCE_PAGE_SIZE);
    setDetailOpen(true);
  };
  const selectSource = (source: DashboardSourceSlice, trigger?: HTMLElement) => {
    // SVG slices are not keyboard launchers; return to the button that opens the list.
    if (source.isOther) { openDetail(trigger ?? otherSourcesTrigger.current); return; }
    const rawSource = source.rawSource ?? source.name;
    const canFilter = Boolean(onSourceChange && !getSourceFilterUnavailableReason(rawSource));
    if (canFilter) onSourceChange?.(rawSource === selectedSource ? null : rawSource);
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[12px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="shrink-0 px-4 pb-1 pt-4">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CardTitle className="min-w-0 truncate text-[14px] font-normal leading-5 text-[var(--app-text-primary)]">
            {title}
          </CardTitle>
          <div className="flex shrink-0 items-center gap-1">
            {selectedSource ? (
              <button
                type="button"
                onClick={() => onSourceChange?.(null)}
                aria-label="Limpar filtro de origem"
                className="grid size-9 place-items-center rounded-[8px] bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            {!isLoading && !isError && model.total > 0 ? (
              <button
                ref={otherSourcesTrigger}
                type="button"
                onClick={(event) => openDetail(event.currentTarget)}
                aria-label={`Ver ${model.sources.length.toLocaleString('pt-BR')} origens`}
                aria-haspopup="dialog"
                className="inline-flex h-9 items-center gap-1.5 rounded-[8px] bg-[var(--app-surface-soft)] px-2.5 text-[12px] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
              >
                <List className="size-4" aria-hidden="true" />
                Origens
              </button>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-1">
        {isLoading ? <div role="status" aria-label="Carregando origens" className="flex min-h-0 flex-1 items-center justify-center"><Skeleton className="h-36 w-36 rounded-full" /></div>
          : isError ? <DashboardChartError message="Não foi possível carregar a origem dos leads." onRetry={onRetry} />
          : model.total === 0 ? <p className="my-auto py-6 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhum dado de origem disponível para este período</p>
          : <>
            <div className="flex min-h-0 flex-1 items-center justify-center" role="img" aria-label={`${title}: ${model.total.toLocaleString('pt-BR')} leads. Valores e filtros na lista de origens.`}>
              <div className="relative h-full max-h-[240px] min-h-[120px] w-full max-w-[240px]">
                <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1} initialDimension={INITIAL_CHART_DIMENSION}>
                  <PieChart>
                    <Pie data={chartData} cx="50%" cy="50%" innerRadius="60%" outerRadius="95%" paddingAngle={3} dataKey="value" isAnimationActive={false} stroke="transparent">
                      {chartData.map((source) => <Cell key={source.key} fill={source.color} opacity={selectedSource && source.rawSource !== selectedSource && !source.isOther ? 0.35 : 1} onClick={() => selectSource(source)} className={source.isOther || (onSourceChange && !getSourceFilterUnavailableReason(source.rawSource)) ? 'cursor-pointer' : undefined} />)}
                    </Pie>
                    <Tooltip content={<LeadSourcesTooltip />} cursor={false} wrapperStyle={{ zIndex: 30, pointerEvents: 'none' }} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span title={model.total.toLocaleString('pt-BR')} style={{ fontSize: totalFontSize }} className="max-w-[55%] text-center font-normal leading-tight tabular-nums text-[var(--app-text-primary)]">{totalLabel}</span>
                  <span className="text-[10px] text-[var(--app-text-secondary)]">{unit}</span>
                </div>
              </div>
            </div>
          </>}
      </CardContent>
      <Dialog open={detailOpen && !isError && !isLoading} onOpenChange={setDetailOpen}>
        <DialogContent
          onCloseAutoFocus={dialogFocus.onCloseAutoFocus}
          className="flex max-h-[min(680px,calc(100dvh-24px))] w-[calc(100vw-24px)] max-w-[600px] flex-col gap-3 overflow-hidden rounded-[8px] p-4 sm:p-5"
        >
          <DialogHeader className="shrink-0 pr-7 text-left">
            <DialogTitle className="text-[15px] font-normal">{title}</DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--app-text-secondary)]">
              {model.total.toLocaleString('pt-BR')} {countEntries ? 'entradas e reentradas' : 'leads únicos'} nos filtros atuais. Escolha uma origem para filtrar a Dashboard.
            </DialogDescription>
          </DialogHeader>
          <div className="relative shrink-0"><Search className="absolute left-3 top-3 h-4 w-4 text-[var(--app-text-secondary)]" aria-hidden="true" /><Input value={search} onChange={(event) => { setSearch(event.target.value); setVisibleCount(DASHBOARD_SOURCE_PAGE_SIZE); }} aria-label="Buscar origem" placeholder="Buscar origem" className="h-10 pl-9" /></div>
          <div className="app-scrollbar min-h-0 overflow-y-auto overscroll-contain">
            <LeadSourceRows sources={matchingSources.slice(0, visibleCount)} total={model.total} selectedSource={selectedSource} onSelect={onSourceChange ? (source) => { selectSource(source); setDetailOpen(false); } : undefined} />
            {matchingSources.length === 0 ? <p className="py-5 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhuma origem encontrada.</p> : null}
            {matchingSources.length > visibleCount ? <button type="button" onClick={() => setVisibleCount((current) => current + DASHBOARD_SOURCE_PAGE_SIZE)} className="mt-2 min-h-10 w-full rounded-[6px] bg-[var(--app-surface-soft)] text-[12px] text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Carregar mais origens ({Math.min(visibleCount, matchingSources.length)} de {matchingSources.length})</button> : null}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
