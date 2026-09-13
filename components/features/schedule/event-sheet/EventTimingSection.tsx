import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Bell, Clock } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { agendaPopoverClass } from "@/components/features/schedule/event-sheet/config";
import {
  AgendaRow,
  TimePicker,
} from "@/components/features/schedule/event-sheet/EventSheetPrimitives";
import {
  isRecurrenceRule,
  getReminderLabel,
  getReminderSelectValue,
  parseReminderSelectValue,
  recurrenceLimitLabels,
  recurrenceOptions,
  reminderOptions,
  type RecurrenceRule,
} from "@/components/features/schedule/event-sheet/model";

export function EventTimingSection({
  locked,
  timingLocked = false,
  date,
  time,
  endTimePreview,
  isAllDay,
  recurrenceRule,
  reminderMinutes,
  isExisting,
  onDateChange,
  onTimeChange,
  onEndTimeChange,
  onAllDayChange,
  onRecurrenceChange,
  onReminderChange,
}: {
  locked: boolean;
  timingLocked?: boolean;
  date: Date | undefined;
  time: string;
  endTimePreview: string;
  isAllDay: boolean;
  recurrenceRule: RecurrenceRule;
  reminderMinutes: number | null;
  isExisting: boolean;
  onDateChange: (date: Date | undefined) => void;
  onTimeChange: (value: string) => void;
  onEndTimeChange: (value: string) => void;
  onAllDayChange: (checked: boolean) => void;
  onRecurrenceChange: (value: RecurrenceRule) => void;
  onReminderChange: (value: number | null) => void;
}) {
  const reminderValue = getReminderSelectValue(reminderMinutes);
  const hasLegacyReminder = !reminderOptions.some(
    (option) => option.value === reminderValue,
  );

  return (
    <AgendaRow
      dataTour="agenda-event-date"
      icon={<Clock size={19} />}
      align={locked ? "center" : "start"}
    >
      {locked ? (
        <div className="space-y-1 text-[12px] font-light text-[var(--app-text-primary)]">
          <div>
            {date ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR }) : "-"}{" "}
            · {time} - {endTimePreview || "-"}
          </div>
          <div className="flex items-center gap-1 text-[11px] text-[var(--app-text-tertiary)]">
            <Bell className="h-3 w-3" /> {getReminderLabel(reminderMinutes)}
          </div>
        </div>
      ) : (
        <div className="space-y-2 sm:space-y-1">
          {timingLocked ? (
            <div className="rounded-[6px] bg-[var(--app-surface-soft)] px-3 py-2 text-[12px] font-light text-[var(--app-text-primary)]">
              <div>
                {date
                  ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })
                  : "-"}{" "}
                · {time} - {endTimePreview || "-"}
              </div>
              <p className="max-w-[430px] pt-1 text-[11px] leading-[16px] text-[var(--app-text-tertiary)]">
                Para alterar data ou horário, use “Resultado ou remarcar”. O
                Vimob preservará o horário anterior no histórico.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_76px_12px_76px] sm:items-center">
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label={
                      date
                        ? `Data da atividade: ${format(date, "dd/MM/yyyy")}`
                        : "Selecionar data da atividade"
                    }
                    className="col-span-2 h-10 rounded-[6px] bg-[var(--app-surface-soft)] px-3 text-left text-[12px] font-light leading-tight text-[var(--app-text-secondary)] transition hover:bg-[var(--app-surface-hover)] hover:text-primary focus-visible:text-primary active:text-primary sm:col-span-1 sm:h-9"
                  >
                    {date
                      ? format(date, "EEEE, dd 'de' MMMM", { locale: ptBR })
                      : "Selecionar data"}
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  className={cn("w-auto p-0", agendaPopoverClass)}
                  align="start"
                >
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={onDateChange}
                    locale={ptBR}
                  />
                </PopoverContent>
              </Popover>
              <div className="min-w-0 space-y-1 sm:space-y-0">
                <span className="text-[11px] font-light text-[var(--app-text-tertiary)] sm:sr-only">
                  Início
                </span>
                <TimePicker
                  ariaLabel="Horário de início"
                  value={time}
                  onChange={onTimeChange}
                  disabled={isAllDay}
                />
              </div>
              <span className="hidden text-center text-[var(--app-text-tertiary)] sm:block">
                -
              </span>
              <div className="min-w-0 space-y-1 sm:space-y-0">
                <span className="text-[11px] font-light text-[var(--app-text-tertiary)] sm:sr-only">
                  Fim
                </span>
                <TimePicker
                  ariaLabel="Horário de fim"
                  value={endTimePreview || time}
                  onChange={onEndTimeChange}
                  disabled={isAllDay}
                />
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pl-0.5 text-xs text-[var(--app-text-tertiary)]">
            {!timingLocked && (
              <label
                data-tour="agenda-event-all-day"
                className="inline-flex items-center gap-1.5"
              >
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(event) => onAllDayChange(event.target.checked)}
                  className="h-4 w-4 rounded-sm bg-transparent accent-primary"
                />
                Dia inteiro
              </label>
            )}
            <Select
              value={recurrenceRule}
              disabled={isExisting}
              onValueChange={(value) => {
                if (isRecurrenceRule(value)) onRecurrenceChange(value);
              }}
            >
              <SelectTrigger
                data-tour="agenda-event-recurrence"
                aria-label="Recorrência"
                className="h-7 w-[132px] rounded-[6px] border-0 bg-transparent px-1.5 text-[12px] font-light text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus:ring-0"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {recurrenceOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={reminderValue}
              onValueChange={(value) =>
                onReminderChange(parseReminderSelectValue(value))
              }
            >
              <SelectTrigger
                data-tour="agenda-event-reminder"
                aria-label="Lembrete"
                className="h-7 w-[142px] rounded-[6px] border-0 bg-transparent px-1.5 text-[12px] font-light text-[var(--app-text-tertiary)] shadow-none hover:bg-[var(--app-surface-hover)] hover:text-[var(--app-text-primary)] focus:ring-0"
              >
                <Bell className="mr-1 h-3 w-3 shrink-0" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hasLegacyReminder && (
                  <SelectItem value={reminderValue}>
                    {getReminderLabel(reminderMinutes)} (atual)
                  </SelectItem>
                )}
                {reminderOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {recurrenceRule !== "none" && (
              <span
                data-tour="agenda-event-recurrence-limit"
                className="text-[11px] text-[var(--app-text-tertiary)]"
              >
                {recurrenceLimitLabels[recurrenceRule]}
              </span>
            )}
            {isExisting && (
              <span className="text-[11px] text-[var(--app-text-tertiary)]">
                Definida na criação
              </span>
            )}
          </div>
        </div>
      )}
    </AgendaRow>
  );
}
