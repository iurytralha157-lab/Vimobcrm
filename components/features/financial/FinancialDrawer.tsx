import { ReactNode } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface FinancialDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Wider drawer for forms with many columns/tabs (e.g. contracts) */
  size?: "default" | "lg";
  /** Prevents losing in-flight form changes while a mutation is pending. */
  pending?: boolean;
}

/**
 * Standardized side drawer used across the financial module.
 *
 * - Slides from the right
 * - 480px on desktop (640px when size="lg"), full width on mobile
 * - Dark surface (uses theme tokens — no hardcoded colors)
 * - Sticky header, scrollable body
 */
export function FinancialDrawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = "default",
  pending = false,
}: FinancialDrawerProps) {
  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        aria-busy={pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        className={cn(
          "flex w-full flex-col gap-0 border-l border-border/60 bg-[var(--app-background)] p-0",
          size === "lg"
            ? "sm:max-w-[640px]"
            : "sm:max-w-[480px]",
        )}
      >
        <SheetHeader className="sticky top-0 z-10 border-b border-border/60 bg-[var(--app-surface-solid)] px-6 py-4">
          <SheetTitle className="text-left text-base font-medium text-foreground">
            {title}
          </SheetTitle>
          <SheetDescription
            className={cn(
              "text-left text-xs text-muted-foreground",
              !description && "sr-only",
            )}
          >
            {description || `Painel de ${title.toLocaleLowerCase("pt-BR")}`}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
