import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  agendaFieldClass,
  agendaPopoverClass,
} from "@/components/features/schedule/event-sheet/config";
import { timeOptions } from "@/components/features/schedule/event-sheet/model";

export function AgendaRow({
  icon,
  label,
  children,
  className,
  dataTour,
  inline = false,
  align = "start",
}: {
  icon: ReactNode;
  label?: ReactNode;
  children: ReactNode;
  className?: string;
  dataTour?: string;
  inline?: boolean;
  align?: "start" | "center";
}) {
  if (inline) {
    return (
      <div
        data-tour={dataTour}
        className={cn(
          "grid grid-cols-[24px_minmax(0,1fr)] items-start gap-x-3 gap-y-1 py-2 sm:grid-cols-[30px_124px_minmax(0,1fr)] sm:items-center sm:gap-2 sm:py-1.5",
          className,
        )}
      >
        <div className="flex justify-center pt-0.5 text-[var(--app-text-tertiary)] sm:pt-0">
          {icon}
        </div>
        <div className="min-w-0 text-[12px] font-light text-[var(--app-text-secondary)]">
          {label}
        </div>
        <div className="col-start-2 min-w-0 sm:col-start-3 sm:row-start-1">
          {children}
        </div>
      </div>
    );
  }

  return (
    <div
      data-tour={dataTour}
      className={cn(
        "grid grid-cols-[24px_minmax(0,1fr)] gap-3 sm:grid-cols-[30px_minmax(0,1fr)]",
        align === "center" ? "items-center py-1.5" : "items-start py-2",
        className,
      )}
    >
      <div
        className={cn(
          "flex justify-center text-[var(--app-text-tertiary)]",
          align === "start" && "pt-2",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        {label && (
          <div className="mb-1.5 text-[12px] font-light text-[var(--app-text-secondary)]">
            {label}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function FieldPill({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] sm:h-9",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function TimePicker({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${ariaLabel}: ${value || "não definido"}`}
          className="inline-flex h-10 w-full min-w-[76px] items-center justify-center rounded-[6px] border-0 bg-[var(--app-surface-soft)] px-3 text-[12px] font-light text-[var(--app-text-primary)] shadow-none transition hover:bg-[var(--app-surface-hover)] disabled:opacity-50 sm:h-9 sm:w-auto"
        >
          {value || "--:--"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn("w-[190px] p-2", agendaPopoverClass)}
        align="center"
      >
        <Input
          type="time"
          aria-label={ariaLabel}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={cn("mb-2 h-9 text-[12px] font-light", agendaFieldClass)}
        />
        <div className="grid max-h-[190px] grid-cols-2 gap-1 overflow-y-auto pr-1">
          {timeOptions.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={option === value}
              onClick={() => onChange(option)}
              className={cn(
                "rounded-[6px] px-2 py-1.5 text-[12px] font-light transition hover:bg-primary hover:text-primary-foreground",
                option === value
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
