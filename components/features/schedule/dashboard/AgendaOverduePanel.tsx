"use client";

import { AlertTriangle, ArrowUpRight } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ScheduleDashboardOverdueOwner } from "@/lib/validation/schedule-dashboard";

const integerFormatter = new Intl.NumberFormat("pt-BR");

function getInitials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "?"
  );
}

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
    <section className="flex h-[360px] min-w-0 flex-col overflow-hidden rounded-[8px] bg-[var(--app-surface-solid)] shadow-none">
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[7px] bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-normal text-[var(--app-text-primary)]">
              Responsáveis com atraso
            </h2>
            <p className="truncate text-[9px] font-light text-[var(--app-text-tertiary)]">
              Inclui cada participante dos compromissos compartilhados
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full bg-rose-500/10 px-2 py-1 text-[9px] font-medium tabular-nums text-rose-600 dark:text-rose-400">
          {integerFormatter.format(totalOverdue)} em atraso
        </span>
      </div>

      {visibleOwners.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 py-10 text-center">
          <p className="max-w-[260px] text-[11px] font-light leading-5 text-[var(--app-text-tertiary)]">
            {totalOverdue > 0
              ? "Há atrasos no recorte, mas nenhum responsável está disponível no detalhamento."
              : "Nenhum responsável com compromisso em atraso neste recorte."}
          </p>
        </div>
      ) : (
        <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-3 pb-3 pt-1 [scrollbar-gutter:stable]">
          {visibleOwners.map((owner, index) => {
            const content = (
              <>
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--app-surface-soft)] text-[9px] font-medium text-[var(--app-text-tertiary)]">
                  {index + 1}
                </span>
                <Avatar className="h-8 w-8 shrink-0">
                  {owner.avatar_url ? (
                    <AvatarImage src={owner.avatar_url} alt={owner.name} />
                  ) : null}
                  <AvatarFallback className="bg-rose-500/10 text-[9px] font-medium text-rose-600 dark:text-rose-400">
                    {getInitials(owner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-3">
                    <span className="truncate text-[11px] font-normal text-[var(--app-text-primary)]">
                      {owner.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-medium tabular-nums text-rose-600 dark:text-rose-400">
                      {integerFormatter.format(owner.overdue)}
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-[var(--app-surface-soft)]">
                    <span
                      className="block h-full rounded-full bg-rose-500/70"
                      style={{
                        width: `${Math.max(4, (owner.overdue / maximum) * 100)}%`,
                      }}
                    />
                  </span>
                </span>
                {onSelectOwner ? (
                  <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)] group-hover:text-rose-500" />
                ) : null}
              </>
            );

            return (
              <li key={owner.user_id}>
                {onSelectOwner ? (
                  <button
                    type="button"
                    onClick={() => onSelectOwner(owner.user_id)}
                    className="group flex w-full items-center gap-2.5 rounded-[7px] px-2 py-2 text-left transition-colors hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-rose-500/40"
                    aria-label={`Filtrar ${owner.overdue} compromisso${owner.overdue === 1 ? "" : "s"} em atraso de ${owner.name}`}
                  >
                    {content}
                  </button>
                ) : (
                  <div className="flex items-center gap-2.5 rounded-[7px] px-2 py-2">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {detailedTotal < totalOverdue && visibleOwners.length > 0 ? (
        <p className="border-t border-[var(--app-border)] px-4 py-2 text-[9px] font-light text-[var(--app-text-tertiary)]">
          {integerFormatter.format(totalOverdue - detailedTotal)} atraso(s) sem
          responsável detalhado.
        </p>
      ) : null}
    </section>
  );
}
