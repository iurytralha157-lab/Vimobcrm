"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  formatCurrencyEditable,
  parseCurrencyInput,
} from "./property-form-model";

export function CurrencyInput({
  value,
  onValueChange,
  className,
  disabled,
  ...inputProps
}: {
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  disabled?: boolean;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange" | "onBlur" | "onFocus">) {
  const [isFocused, setIsFocused] = useState(false);
  const [draft, setDraft] = useState(() => formatCurrencyEditable(value));

  useEffect(() => {
    if (isFocused) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) setDraft(formatCurrencyEditable(value));
    });
    return () => {
      cancelled = true;
    };
  }, [isFocused, value]);

  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm text-muted-foreground">
        R$
      </span>
      <Input
        value={draft}
        onChange={(event) => {
          const nextDraft = event.target.value.replace(/[^\d,.]/g, "");
          setDraft(nextDraft);
          onValueChange(parseCurrencyInput(nextDraft));
        }}
        onFocus={(event) => {
          setDraft(formatCurrencyEditable(value));
          setIsFocused(true);
          event.currentTarget.select();
        }}
        onBlur={() => {
          const normalized = parseCurrencyInput(draft);
          onValueChange(normalized);
          setDraft(formatCurrencyEditable(normalized));
          setIsFocused(false);
        }}
        inputMode="decimal"
        placeholder="1,00"
        className={cn("pl-9", className)}
        disabled={disabled}
        {...inputProps}
      />
    </div>
  );
}

export function RequiredMark() {
  return <span className="ml-0.5 text-primary">*</span>;
}

export const togglePanelClass =
  "flex items-center justify-between gap-3 rounded-[6px] border-0 bg-[var(--app-surface-soft)] p-3 text-[var(--app-text-primary)] transition-colors hover:bg-[var(--app-surface-hover)]";

export const propertyFormTabTriggerClass =
  "mx-0 h-8 w-8 min-w-8 shrink-0 gap-0 rounded-[6px] p-0 text-[var(--app-text-secondary)] shadow-none";
