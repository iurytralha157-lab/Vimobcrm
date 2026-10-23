import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { PieChart as PieChartIcon, Search, X } from 'lucide-react';
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
    // SVG slices are not keyboard launchers; return to the equivalent legend button.
    if (source.isOther) { openDetail(trigger ?? otherSourcesTrigger.current); return; }
    const rawSource = source.rawSource ?? source.name;
    const canFilter = Boolean(onSourceChange && !getSourceFilterUnavailableReason(rawSource));
    if (canFilter) onSourceChange?.(rawSource === selectedSource ? null : rawSource);
  };

  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border-0 bg-[var(--app-surface-solid)] shadow-none">
      <CardHeader className="shrink-0 px-3 pb-1 pt-3">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <CardTitle className="flex min-w-0 items-center gap-2 text-[13px] font-light text-[var(--app-text-primary)]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground"><PieChartIcon className="h-3.5 w-3.5" aria-hidden="true" /></span>
            <span className="truncate">{title}</span>
          </CardTitle>
          {selectedSource ? <button type="button" onClick={() => onSourceChange?.(null)} aria-label="Limpar filtro de origem" className="grid h-7 w-7 shrink-0 place-items-center rounded-[6px] bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><X className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col px-3 pb-3 pt-1">
        {isLoading ? <div role="status" aria-label="Carregando origens" className="flex min-h-0 flex-1 items-center justify-center"><Skeleton className="h-36 w-36 rounded-full" /></div>
          : isError ? <DashboardChartError message="Não foi possível carregar a origem dos leads." onRetry={onRetry} />
          : model.total === 0 ? <p className="my-auto py-6 text-center text-[12px] text-[var(--app-text-secondary)]">Nenhum dado de origem disponível para este período</p>
          : <>
            <div className="flex min-h-0 flex-1 items-center justify-center" role="img" aria-label={`${title}: ${model.total.toLocaleString('pt-BR')} leads. Valores e filtros na legenda e na lista de origens.`}>
              <div className="relative h-full max-h-[180px] min-h-[84px] w-full max-w-[180px]">
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
            <ul className="mt-1 grid shrink-0 grid-cols-2 gap-x-2 gap-y-0.5">
              {chartData.map((source) => <li key={source.key} className="min-w-0">
                <button ref={source.isOther ? otherSourcesTrigger : undefined} type="button" disabled={!source.isOther && (!onSourceChange || Boolean(getSourceFilterUnavailableReason(source.rawSource)))} title={source.isOther ? undefined : getSourceFilterUnavailableReason(source.rawSource) ?? undefined} onClick={(event) => selectSource(source, event.currentTarget)} aria-pressed={Boolean(source.rawSource && selectedSource === source.rawSource)} aria-label={`${source.name}: ${source.value.toLocaleString('pt-BR')} leads, ${source.percentage}${source.isOther ? '. Ver todas as origens' : getSourceFilterUnavailableReason(source.rawSource) ? `. ${getSourceFilterUnavailableReason(source.rawSource)}` : ''}`} className="flex min-h-7 w-full items-center gap-1.5 rounded-[4px] px-1 text-[11px] text-[var(--app-text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default aria-pressed:bg-primary/10 lg:min-h-6 lg:text-[10px]">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: source.color }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-left" title={source.name}>{source.name}</span>
                  <span className="shrink-0 tabular-nums">{source.value.toLocaleString('pt-BR')}</span>
                </button>
              </li>)}
            </ul>
            <button type="button" onClick={(event) => openDetail(event.currentTarget)} className="mt-1 min-h-7 shrink-0 rounded-[6px] text-[11px] text-primary hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">Ver {model.sources.length.toLocaleString('pt-BR')} origens</button>
          </>}
      </CardContent>
      <Dialog open={detailOpen && !isError && !isLoading} onOpenChange={setDetailOpen}>
        <DialogContent onCloseAutoFocus={dialogFocus.onCloseAutoFocus} aria-describedby={undefined} className="flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[520px] flex-col gap-3 overflow-hidden rounded-[8px] p-4 sm:p-5">
          <DialogHeader className="pr-7 text-left"><DialogTitle className="text-[15px] font-normal">{title}</DialogTitle></DialogHeader>
          <p className="text-[12px] text-[var(--app-text-secondary)]">{model.total.toLocaleString('pt-BR')} {countEntries ? 'entradas e reentradas' : 'leads únicos'} nos filtros atuais. Escolha uma origem para filtrar a Dashboard.</p>
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
