import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import type { EventType } from "@/hooks/use-schedule-events";
import { cn } from "@/lib/utils";
import {
  agendaControlClass,
  agendaFieldClass,
  agendaPopoverClass,
  eventTypes,
} from "@/components/features/schedule/event-sheet/config";
import { FieldPill } from "@/components/features/schedule/event-sheet/EventSheetPrimitives";

export function EventSheetHeader({
  locked,
  typeLocked = false,
  title,
  selectedType,
  isLoading,
  onTitleChange,
  onTypeChange,
  onClose,
}: {
  locked: boolean;
  typeLocked?: boolean;
  title: string;
  selectedType: EventType;
  isLoading: boolean;
  onTitleChange: (value: string) => void;
  onTypeChange: (value: EventType) => void;
  onClose: () => void;
}) {
  const typeConf =
    eventTypes.find((eventType) => eventType.type === selectedType) ||
    eventTypes[3];
  const TypeIcon = typeConf.icon;

  return (
    <div className="grid shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-[var(--app-border)] px-4 pb-3 pt-3 sm:grid-cols-[minmax(0,1fr)_158px_auto] sm:border-b-0 sm:px-8 sm:pb-1 sm:pt-4">
      <div className="col-start-2 row-start-1 min-w-0 sm:col-start-1">
        {locked ? (
          <h2
            className={cn(
              "min-h-10 px-3 py-2.5 text-[12px] font-light leading-tight sm:min-h-9 sm:py-2",
              agendaFieldClass,
            )}
          >
            {title || "Sem título"}
          </h2>
        ) : (
          <Input
            data-tour="agenda-event-title"
            aria-label="Título da atividade"
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Adicionar título"
            className={cn(
              "h-10 px-3 text-[12px] font-light sm:h-9",
              agendaFieldClass,
            )}
          />
        )}
      </div>
      <div className="col-span-2 min-w-0 sm:col-span-1">
        {locked || typeLocked ? (
          <FieldPill className="h-10 w-full justify-center px-3 text-xs sm:h-9">
            <TypeIcon className="h-3.5 w-3.5" />
            {typeConf.label}
          </FieldPill>
        ) : (
          <Select
            value={selectedType}
            onValueChange={(value: EventType) => onTypeChange(value)}
          >
            <SelectTrigger
              data-tour="agenda-event-type"
              aria-label="Tipo da atividade"
              className={cn(
                "h-10 w-full px-3 text-[12px] font-light leading-none sm:h-9 [&>span]:!flex [&>span]:items-center [&>span]:gap-2 [&>svg]:h-3.5 [&>svg]:w-3.5 [&>svg]:text-[var(--app-text-tertiary)]",
                agendaControlClass,
              )}
            >
              <span className="min-w-0">
                <TypeIcon className="h-3.5 w-3.5 shrink-0 text-[var(--app-text-tertiary)]" />
                <span className="truncate">{typeConf.label}</span>
              </span>
            </SelectTrigger>
            <SelectContent className={agendaPopoverClass}>
              {eventTypes.map(({ type, label, icon: Icon }) => (
                <SelectItem key={type} value={type}>
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        disabled={isLoading}
        className="col-start-1 row-start-1 shrink-0 rounded-[6px] p-2 text-[var(--app-text-tertiary)] transition hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] sm:col-start-3 sm:p-1.5"
        aria-label="Fechar"
      >
        <X size={18} strokeWidth={1.7} />
      </button>
    </div>
  );
}
