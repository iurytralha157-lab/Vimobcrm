import type { ReactNode } from "react";
import { AlertCircle, DatabaseZap, LoaderCircle } from "lucide-react";

import { cn } from "@/lib/utils";

interface MarketingDataStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  kind?: "empty" | "waiting" | "error";
  compact?: boolean;
  className?: string;
}

export function MarketingDataState({
  title,
  description,
  action,
  kind = "waiting",
  compact = false,
  className,
}: MarketingDataStateProps) {
  const Icon =
    kind === "error" ? AlertCircle : kind === "empty" ? DatabaseZap : LoaderCircle;

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[8px] bg-[var(--app-surface-soft)] px-5 text-center",
        compact ? "min-h-36 py-5" : "min-h-52 py-8",
        className,
      )}
      role={kind === "error" ? "alert" : "status"}
    >
      <span
        aria-hidden="true"
        className="flex h-10 w-10 items-center justify-center rounded-[6px] bg-[var(--app-surface-hover)] text-[var(--app-text-secondary)]"
      >
        <Icon className={cn("h-4 w-4", kind === "waiting" && "animate-pulse")} />
      </span>
      <p className="mt-3 text-sm font-medium text-[var(--app-text-primary)]">{title}</p>
      <p className="mt-1 max-w-lg text-[12px] leading-5 text-[var(--app-text-tertiary)]">
        {description}
      </p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
