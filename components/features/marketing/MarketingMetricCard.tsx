import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type MarketingMetricTone = "accent" | "success" | "warning" | "neutral";

const TONE_STYLES: Record<MarketingMetricTone, string> = {
  accent: "bg-primary/12 text-primary",
  success: "bg-emerald-500/12 text-emerald-500",
  warning: "bg-amber-500/12 text-amber-500",
  neutral: "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
};

interface MarketingMetricCardProps {
  icon: LucideIcon;
  label: string;
  value: string | null;
  supportingText?: string;
  unavailableLabel?: string;
  unavailableText?: string;
  tone?: MarketingMetricTone;
  className?: string;
}

export function MarketingMetricCard({
  icon: Icon,
  label,
  value,
  supportingText,
  unavailableLabel = "Aguardando dados",
  unavailableText = "Aguardando sincronização",
  tone = "accent",
  className,
}: MarketingMetricCardProps) {
  const isAvailable = value !== null;

  return (
    <article
      className={cn(
        "min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-3.5 shadow-none",
        className,
      )}
      aria-label={`${label}: ${isAvailable ? value : unavailableText}`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]",
            TONE_STYLES[tone],
          )}
        >
          <Icon className="h-4 w-4" />
        </span>

        <div className="min-w-0">
          <p className="truncate text-[12px] font-light text-[var(--app-text-tertiary)]">
            {label}
          </p>
          <p
            className={cn(
              "mt-1 truncate text-[14px] font-normal tabular-nums text-[var(--app-text-primary)]",
              !isAvailable && "text-[12px] font-light text-[var(--app-text-secondary)]",
            )}
          >
            {isAvailable ? value : unavailableLabel}
          </p>
          <p className="mt-0.5 min-h-4 truncate text-[11px] text-[var(--app-text-tertiary)]">
            {isAvailable ? supportingText : unavailableText}
          </p>
        </div>
      </div>
    </article>
  );
}
