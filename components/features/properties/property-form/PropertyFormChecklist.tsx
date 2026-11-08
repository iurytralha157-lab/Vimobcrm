"use client";

import { Check, Clock3 } from "lucide-react";

import { cn } from "@/lib/utils";

import type { PropertyFormProgressItem } from "./property-form-portfolio";

export function PropertyFormChecklist({ items }: { items: PropertyFormProgressItem[] }) {
  const done = items.filter((item) => item.done).length;
  return (
    <section data-testid="property-form-checklist" aria-label="O que falta" className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[14px] font-normal text-[var(--app-text-primary)]">O que falta</h3>
        <span className="text-[12px] font-light text-[var(--app-text-secondary)]">{done} de {items.length}</span>
      </div>
      <span className="block h-1.5 overflow-hidden rounded-[3px] bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]">
        <span className="block h-full rounded-[3px] bg-primary" style={{ width: `${(done / items.length) * 100}%` }} />
      </span>
      <ul className="space-y-1.5">
        {items.map((item) => (
          <li key={item.label} className={cn("flex items-center gap-2 text-[12px] font-light", item.done ? "text-[var(--app-text-primary)]" : "text-[var(--app-text-secondary)]")}>
            {item.done
              ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              : <Clock3 className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" aria-hidden="true" />}
            {item.label}
          </li>
        ))}
      </ul>
    </section>
  );
}
