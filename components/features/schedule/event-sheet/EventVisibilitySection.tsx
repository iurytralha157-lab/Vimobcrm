import { Lock } from "lucide-react";
import type { ScheduleEventVisibility } from "@/hooks/use-schedule-events";
import { cn } from "@/lib/utils";
import {
  AgendaRow,
  FieldPill,
} from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import { visibilityOptions } from "@/components/features/schedule/event-sheet/model";

export function EventVisibilitySection({
  locked,
  visibility,
  onVisibilityChange,
}: {
  locked: boolean;
  visibility: ScheduleEventVisibility;
  onVisibilityChange: (visibility: ScheduleEventVisibility) => void;
}) {
  const selectedOption = visibilityOptions.find(
    (option) => option.value === visibility,
  );

  return (
    <AgendaRow
      dataTour="agenda-event-visibility"
      icon={<Lock size={18} />}
      label="Visibilidade"
      inline
    >
      <div className="flex w-full flex-col items-start gap-1.5">
        {locked ? (
          <FieldPill className="h-9 px-3 text-xs">
            {selectedOption?.label || "Padrão"}
          </FieldPill>
        ) : (
          <div className="grid h-10 w-full grid-cols-3 rounded-[6px] bg-[var(--app-surface-soft)] p-1 sm:inline-flex sm:h-9 sm:w-auto">
            {visibilityOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onVisibilityChange(option.value)}
                title={option.description}
                aria-label={`${option.label}: ${option.description}`}
                aria-pressed={visibility === option.value}
                className={cn(
                  "min-w-0 rounded-[6px] px-2 text-[12px] font-light transition sm:px-3",
                  visibility === option.value
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "text-[var(--app-text-secondary)] hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)]",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        <p className="text-xs leading-4 text-[var(--app-text-tertiary)]">
          {selectedOption?.description}
        </p>
      </div>
    </AgendaRow>
  );
}
