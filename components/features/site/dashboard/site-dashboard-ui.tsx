import { useState, type ReactNode } from "react";
import { Building2 } from "lucide-react";

import {
  KpiCard,
  NEUTRAL_SOFT,
  NEUTRAL_STRONG,
  PANEL_SOFT,
  safeExternalUrl,
} from "@/components/features/marketing/marketing-ui";
import { cn } from "@/lib/utils";

import type { SiteDelta } from "./site-dashboard-format";

const DELTA_TONE = {
  up: "text-emerald-700 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
  flat: "text-[var(--app-text-tertiary)]",
};

/** Marketing's KPI card, plus the comparison with the previous period. */
export function SiteKpi({
  id,
  label,
  value,
  note,
  delta,
  href,
}: {
  id: string;
  label: string;
  value: string;
  note?: string;
  delta?: SiteDelta | null;
  href?: string;
}) {
  return (
    <div className="contents max-sm:[&_span.truncate]:whitespace-normal" data-testid={`site-kpi-${id}`}>
      <KpiCard
        label={label}
        value={value}
        href={href}
        note={
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0">{note ?? " "}</span>
            {delta ? (
              <span title="Comparado ao período anterior" className={cn("shrink-0 whitespace-nowrap tabular-nums", DELTA_TONE[delta.tone])}>
                {delta.text}
              </span>
            ) : null}
          </span>
        }
      />
    </div>
  );
}

/** A progress row for long labels, which Marketing's fixed label column would cut. */
export function BarRow({
  label,
  value,
  percent,
  highlight = false,
  title,
}: {
  label: string;
  value: string;
  percent: number;
  highlight?: boolean;
  title?: string;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-3 text-[12px] font-light sm:grid-cols-[minmax(0,180px)_minmax(0,1fr)_auto]">
      <span className="truncate text-[var(--app-text-secondary)]" title={title ?? label}>
        {label}
      </span>
      <span className={cn("h-3 overflow-hidden rounded-[3px]", NEUTRAL_SOFT)}>
        <span
          className={cn("block h-full rounded-[3px]", highlight ? "bg-primary" : NEUTRAL_STRONG)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </span>
      <span className="min-w-[44px] whitespace-nowrap text-right tabular-nums text-[var(--app-text-primary)]">{value}</span>
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ key: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex h-8 w-fit rounded-[8px] bg-[var(--app-surface-soft)] p-1">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.key === value}
          onClick={() => onChange(option.key)}
          className={cn(
            "h-6 rounded-[6px] px-2.5 text-[12px] font-light text-[var(--app-text-secondary)] transition-colors hover:text-[var(--app-text-primary)]",
            option.key === value && "bg-[var(--app-surface-solid)] text-[var(--app-text-primary)]",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PropertyPhoto({
  url,
  alt,
  className,
  iconClassName = "h-6 w-6",
}: {
  url: string | null | undefined;
  alt: string;
  className?: string;
  iconClassName?: string;
}) {
  const safeUrl = safeExternalUrl(url);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (!safeUrl || failedUrl === safeUrl) {
    return (
      <div className={cn("flex items-center justify-center text-[var(--app-text-tertiary)]", PANEL_SOFT, className)} role="img" aria-label={`${alt}: sem foto`}>
        <Building2 className={iconClassName} aria-hidden="true" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- property photos come from arbitrary catalog hosts
    <img
      src={safeUrl}
      alt={alt}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailedUrl(safeUrl)}
      className={cn("object-cover", className)}
    />
  );
}

export const TABLE_HEAD = "border-b border-[var(--app-border)] py-2 text-right text-[12px] font-light text-[var(--app-text-secondary)] first:text-left";
export const TABLE_CELL = "border-b border-[var(--app-border)] py-2.5 text-right text-[12px] font-light tabular-nums text-[var(--app-text-primary)] first:text-left";
export const TABLE_FOOT = "py-2.5 text-right text-[12px] font-normal tabular-nums text-[var(--app-text-primary)] first:text-left";

/** Secondary columns hide on phones, so tables never scroll sideways. */
export const WIDE_ONLY = "hidden md:table-cell";

export function SiteTable({ children }: { children: ReactNode }) {
  return <table className="w-full table-auto border-collapse">{children}</table>;
}

export function InfoNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[10px] font-light leading-4 text-[var(--app-text-tertiary)]">{children}</p>;
}

export function PageCell({ label, path }: { label: string; path: string }) {
  return (
    <div className="min-w-0">
      <p className="break-words">{label}</p>
      <p className="break-all text-[10px] text-[var(--app-text-tertiary)]">{path}</p>
    </div>
  );
}
