import type { KeyboardEvent, ReactNode } from "react";

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// Same tones as the Marketing reference, kept here so the Dashboard does not
// load the Marketing module (and its Meta preview) just for class names.
export const NEUTRAL_SOFT = "bg-[color-mix(in_srgb,var(--app-text-primary)_11%,transparent)]";
export const NEUTRAL_STRONG = "bg-[color-mix(in_srgb,var(--app-text-primary)_27%,transparent)]";
export const PANEL_SOFT = "bg-[color-mix(in_srgb,var(--app-text-primary)_4%,transparent)]";

/** The Dashboard follows the Marketing reference: light panels, neutral bars, one accent. */
export const DASHBOARD_PANEL = "min-w-0 rounded-[12px] bg-[var(--app-surface-solid)]";

export function DashboardPanel({
  title,
  titleId,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: ReactNode;
  titleId?: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={cn(DASHBOARD_PANEL, "flex flex-col p-4", className)}>
      <div className="mb-3 flex min-h-7 flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h3 id={titleId} className="min-w-0 text-[14px] font-normal leading-5 text-[var(--app-text-primary)]">
          {title}
        </h3>
        {aside ? <div className="flex min-w-0 items-center gap-2 text-[12px] font-light text-[var(--app-text-secondary)]">{aside}</div> : null}
      </div>
      <div className={cn("flex min-h-0 flex-1 flex-col", bodyClassName)}>{children}</div>
    </div>
  );
}

import type { DashboardDelta } from "./dashboard-kpi-model";

const DELTA_TONE = {
  up: "text-emerald-700 dark:text-emerald-400",
  down: "text-red-600 dark:text-red-400",
};

function interactiveProps(onClick: ((trigger: HTMLElement) => void) | undefined) {
  if (!onClick) return {};
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: (event: { currentTarget: HTMLElement }) => onClick(event.currentTarget),
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        onClick(event.currentTarget);
      }
    },
  };
}

function WithHint({ hint, children }: { hint?: string; children: ReactNode }) {
  if (!hint) return <>{children}</>;
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent className="app-header-popover max-w-[280px] rounded-[8px] border-0 text-[var(--app-text-primary)]">
          <p className="text-[11px] font-light leading-snug">{hint}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** Recent quarter of the series in the accent, as in the Marketing cards. */
export function DashboardSparkline({ values }: { values: readonly number[] }) {
  const max = Math.max(0, ...values);
  if (values.length < 2 || max <= 0) return <div className="mt-2 h-[22px]" aria-hidden="true" />;
  const recentFrom = Math.floor(values.length * 0.75);
  return (
    <div className="mt-2 flex h-[22px] items-end gap-px" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className={cn("min-w-0 flex-1", index >= recentFrom ? "bg-primary" : NEUTRAL_SOFT)}
          style={{ height: `${Math.max(4, (Math.max(0, value) / max) * 100)}%` }}
        />
      ))}
    </div>
  );
}

export function DashboardKpiCard({
  tourTarget,
  label,
  value,
  note,
  delta,
  spark,
  hint,
  compact = false,
  className,
  onClick,
}: {
  tourTarget: string;
  label: string;
  value: string;
  note?: ReactNode;
  delta?: DashboardDelta | null;
  spark?: readonly number[];
  hint?: string;
  /** Without the sparkline row, for the second line of KPIs. */
  compact?: boolean;
  className?: string;
  onClick?: (trigger: HTMLElement) => void;
}) {
  return (
    <WithHint hint={hint}>
      <div
        data-tour={tourTarget}
        {...interactiveProps(onClick)}
        aria-label={onClick ? `${label}: ${value}. Ver detalhes` : undefined}
        className={cn(
          DASHBOARD_PANEL,
          "flex h-full min-w-0 flex-col p-3 transition-colors min-[1441px]:p-3.5",
          className,
          onClick
            ? "cursor-pointer hover:bg-[var(--app-surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            : "cursor-default",
        )}
      >
        <p className="truncate text-[12px] font-light leading-5 text-[var(--app-text-secondary)]">{label}</p>
        <p
          className={cn(
            "mt-1 truncate font-normal leading-tight tabular-nums text-[var(--app-text-primary)] min-[1441px]:text-[24px]",
            // Long currency values still fit narrow cards.
            value.length > 12 ? "text-[16px] sm:text-[20px]" : value.length > 9 ? "text-[18px] sm:text-[20px]" : "text-[20px] min-[1441px]:text-[22px]",
          )}
          title={value}
        >
          {value}
        </p>
        {compact ? null : spark ? <DashboardSparkline values={spark} /> : <div className="mt-2 h-[22px]" aria-hidden="true" />}
        <div className="min-h-2 flex-1" aria-hidden="true" />
        <div className="flex items-baseline justify-between gap-2 border-t border-[var(--app-border)] pt-2 text-[10px] font-light text-[var(--app-text-tertiary)]">
          <span className="min-w-0 truncate">{note ?? " "}</span>
          {delta ? (
            <span title="Comparado ao período anterior" className={cn("shrink-0 whitespace-nowrap tabular-nums", DELTA_TONE[delta.tone])}>
              {delta.text}
            </span>
          ) : null}
        </div>
      </div>
    </WithHint>
  );
}

export function DashboardSkeletonBlock({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-[8px]", PANEL_SOFT, className)} aria-hidden="true" />;
}
