"use client";

import { EmptyNote, NEUTRAL_SOFT, NEUTRAL_STRONG, Panel } from "@/components/features/marketing/marketing-ui";
import { formatCount } from "@/components/features/marketing/marketing-format";
import { cn } from "@/lib/utils";
import type { ScheduleDashboardOverdueOwner } from "@/lib/validation/schedule-dashboard";

/** Includes each participant of shared events, so the rows may add up to more than the total. */
export function AgendaOverduePanel({
  owners,
  totalOverdue,
  onSelectOwner,
}: {
  owners: ScheduleDashboardOverdueOwner[];
  totalOverdue: number;
  onSelectOwner?: (userId: string) => void;
}) {
  const visibleOwners = owners.filter((owner) => owner.overdue > 0);
  const maximum = Math.max(...visibleOwners.map((owner) => owner.overdue), 1);
  const detailedTotal = owners.reduce((sum, owner) => sum + owner.overdue, 0);

  return (
    <Panel title="Atrasados por responsável" aside={`${formatCount(totalOverdue)} sem resultado lançado`}>
      {visibleOwners.length === 0 ? (
        <EmptyNote>
          {totalOverdue > 0
            ? "Há atrasos no recorte, mas nenhum responsável está disponível no detalhamento."
            : "Nenhum responsável com compromisso em atraso neste recorte."}
        </EmptyNote>
      ) : (
        <ol className="max-h-[260px] space-y-1 overflow-y-auto overscroll-contain pr-1">
          {visibleOwners.map((owner, index) => (
            <li key={owner.user_id}>
              <button
                type="button"
                disabled={!onSelectOwner}
                onClick={() => onSelectOwner?.(owner.user_id)}
                aria-label={`Filtrar ${owner.overdue} compromisso${owner.overdue === 1 ? "" : "s"} em atraso de ${owner.name}`}
                title={`${owner.name}: ${formatCount(owner.overdue)} em atraso`}
                className="grid w-full grid-cols-[minmax(0,110px)_minmax(0,1fr)_auto] items-center gap-3 rounded-[6px] py-1 text-left text-[12px] font-light transition-colors enabled:hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40"
              >
                <span className="truncate text-[var(--app-text-secondary)]">{owner.name}</span>
                <span className={cn("h-3 overflow-hidden rounded-[3px]", NEUTRAL_SOFT)}>
                  <span
                    className={cn("block h-full rounded-[3px]", index === 0 ? "bg-primary" : NEUTRAL_STRONG)}
                    style={{ width: `${Math.max(4, (owner.overdue / maximum) * 100)}%` }}
                  />
                </span>
                <span className="text-right tabular-nums text-[var(--app-text-primary)]">{formatCount(owner.overdue)}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {detailedTotal < totalOverdue && visibleOwners.length > 0 ? (
        <p className="mt-2 border-t border-[var(--app-border)] pt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          {formatCount(totalOverdue - detailedTotal)} atraso(s) sem responsável detalhado.
        </p>
      ) : null}
    </Panel>
  );
}
