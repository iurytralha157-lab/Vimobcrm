import { Badge } from "@/components/ui/badge";
import type { BillingStatusPresentation } from "@/lib/billing/subscription-presentation";
import { cn } from "@/lib/utils";

type BillingStatusBadgeProps = {
  status: BillingStatusPresentation;
};

export function BillingStatusBadge({ status }: BillingStatusBadgeProps) {
  return (
    <Badge
      variant={status.variant}
      className={cn(
        "rounded-[6px] border-transparent font-light shadow-none",
        status.variant === "default" &&
          "bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300",
        status.variant === "destructive" &&
          "bg-destructive/15 text-destructive hover:bg-destructive/25",
        (status.variant === "outline" || status.variant === "secondary") &&
          "bg-[var(--app-surface-hover)] text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)]",
      )}
    >
      {status.label}
    </Badge>
  );
}
