import { formatDashboardSourcePercentage, type DashboardSourceSlice } from "@/components/features/dashboard/lead-sources-model";
import { getSourceFilterUnavailableReason } from "@/lib/validation/dashboard-filter-text";

export function LeadSourceRows({ sources, total, selectedSource, onSelect }: {
  sources: readonly DashboardSourceSlice[];
  total: number;
  selectedSource?: string | null;
  onSelect?: (source: DashboardSourceSlice) => void;
}) {
  return (
    <ul className="space-y-1">
      {sources.map((source) => {
        const unavailableReason = getSourceFilterUnavailableReason(source.rawSource);
        return (
        <li key={source.key}>
          <button type="button" disabled={!onSelect || Boolean(unavailableReason)} title={unavailableReason ?? undefined}
            aria-pressed={Boolean(source.rawSource && selectedSource === source.rawSource)}
            aria-label={`${source.name}: ${source.value.toLocaleString("pt-BR")} leads, ${formatDashboardSourcePercentage(source.value, total)}${unavailableReason ? `. ${unavailableReason}` : ''}`}
            onClick={() => { if (!unavailableReason) onSelect?.(source); }}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[6px] px-3 py-2 text-left text-[12px] text-[var(--app-text-primary)] hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-default disabled:hover:bg-transparent aria-pressed:bg-primary/10">
            <span className="min-w-0 flex-1 break-all">{source.name}{unavailableReason ? <span className="mt-1 block text-[11px] text-[var(--app-text-secondary)]">{unavailableReason}</span> : null}</span>
            <span className="shrink-0 text-right tabular-nums"><strong className="block font-medium">{source.value.toLocaleString("pt-BR")}</strong><span className="text-[11px] text-[var(--app-text-secondary)]">{formatDashboardSourcePercentage(source.value, total)}</span></span>
          </button>
        </li>
      ); })}
    </ul>
  );
}
