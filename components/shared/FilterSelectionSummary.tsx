"use client";

import { X } from "lucide-react";

export interface ActiveFilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

/** Kept inside the filter panel so page toolbars retain their existing layout. */
export function FilterSelectionSummary({ chips, paused = false }: { chips: readonly ActiveFilterChip[]; paused?: boolean }) {
  if (!chips.length) return null;
  return (
    <div aria-label={paused ? "Filtros de lead preservados e pausados" : "Filtros aplicados"} className="flex max-h-28 flex-wrap gap-1 overflow-y-auto overscroll-contain">
      {chips.map((chip) => (
        <button key={chip.key} type="button" data-filter-chip onClick={chip.onRemove}
          aria-label={`Remover filtro: ${chip.label}`} title={`Remover filtro: ${chip.label}`}
          className="flex min-w-0 max-w-full items-center gap-1 rounded-[6px] bg-primary/10 px-2 py-1 text-[11px] font-light text-primary hover:bg-primary/20 focus-visible:outline-1 focus-visible:outline-primary">
          <span className="truncate">{paused ? `Pausado: ${chip.label}` : chip.label}</span><X className="h-3 w-3 shrink-0" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
