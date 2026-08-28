import { cn } from "@/lib/utils";

export interface MarketingFunnelStep {
  key: string;
  label: string;
  value: number | null;
  description?: string;
}

interface MarketingFunnelProps {
  steps: MarketingFunnelStep[];
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    notation: value >= 100_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function MarketingFunnel({ steps }: MarketingFunnelProps) {
  const maxValue = Math.max(
    ...steps.map((step) => step.value ?? 0),
    1,
  );

  return (
    <ol className="space-y-2.5" aria-label="Etapas do funil">
      {steps.map((step, index) => {
        const isAvailable = step.value !== null;
        const width = isAvailable
          ? Math.max(12, ((step.value ?? 0) / maxValue) * 100)
          : 100;

        return (
          <li key={step.key} className="grid grid-cols-[24px_minmax(0,1fr)] gap-2.5">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--app-surface-soft)] text-[10px] font-light text-[var(--app-text-secondary)]"
            >
              {index + 1}
            </span>
            <div className="min-w-0">
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]">
                <span className="font-medium text-[var(--app-text-primary)]">
                  {step.label}
                </span>
                <span
                  className={cn(
                    "shrink-0 tabular-nums text-[var(--app-text-secondary)]",
                    !isAvailable && "text-[var(--app-text-tertiary)]",
                  )}
                >
                  {isAvailable ? formatNumber(step.value ?? 0) : "Aguardando dados"}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-[6px] bg-[var(--app-surface-soft)]">
                <div
                  className={cn(
                    "h-full rounded-[6px] transition-[width] duration-500",
                    isAvailable
                      ? "bg-primary"
                      : "animate-pulse bg-[var(--app-surface-hover)]",
                  )}
                  style={{ width: `${width}%` }}
                />
              </div>
              {step.description ? (
                <p className="mt-1 text-[10px] leading-4 text-[var(--app-text-tertiary)]">
                  {step.description}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
