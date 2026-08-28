import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

interface MarketingSectionCardProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
  titleId?: string;
}

export function MarketingSectionCard({
  title,
  description,
  icon: Icon,
  action,
  children,
  className,
  contentClassName,
  titleId,
}: MarketingSectionCardProps) {
  return (
    <section
      className={cn(
        "min-w-0 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none",
        className,
      )}
      aria-labelledby={titleId}
    >
      <header className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon ? (
            <span
              aria-hidden="true"
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-primary-foreground"
            >
              <Icon className="h-4 w-4" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-sm font-medium text-[var(--app-text-primary)]"
            >
              {title}
            </h2>
            {description ? (
              <p className="mt-1 text-[11px] leading-4 text-[var(--app-text-tertiary)]">
                {description}
              </p>
            ) : null}
          </div>
        </div>
        {action}
      </header>

      <div className={contentClassName}>{children}</div>
    </section>
  );
}
