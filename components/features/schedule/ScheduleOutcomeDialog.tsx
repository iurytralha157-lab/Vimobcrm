"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Ban,
  CalendarCheck,
  CalendarClock,
  CheckCircle2,
  Loader2,
  UserRound,
  Video,
  UserX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { EventType, ScheduleOutcome } from "@/hooks/use-schedule-events";
import {
  DEFAULT_SCHEDULE_TIME_ZONE,
  scheduleStatusForOutcome,
} from "@/lib/schedule-outcome";
import {
  formatScheduleZonedTime,
  getScheduleCivilDateKey,
  getScheduleCivilDayRange,
  scheduleCivilDateTimeToDate,
  scheduleFutureCivilDateTimeToDate,
} from "@/lib/schedule-time-zone";
import { cn } from "@/lib/utils";

export {
  getScheduleOutcomeLabel,
  scheduleStatusForOutcome,
} from "@/lib/schedule-outcome";

type OutcomeOption = {
  value: ScheduleOutcome;
  label: string;
  description: string;
  icon: typeof CalendarCheck;
};

const COMMON_FINAL_OUTCOMES: OutcomeOption[] = [
  {
    value: "no_show",
    label: "No-show",
    description: "O cliente não compareceu ao horário combinado.",
    icon: UserX,
  },
  {
    value: "rescheduled",
    label: "Remarcar",
    description: "Preserva este horário no histórico e cria um novo.",
    icon: CalendarClock,
  },
  {
    value: "cancelled",
    label: "Cancelar",
    description: "O compromisso foi cancelado e não aconteceu.",
    icon: Ban,
  },
];

const TYPE_LABELS: Record<EventType, string> = {
  call: "ligação",
  email: "e-mail",
  meeting: "reunião",
  task: "tarefa",
  message: "mensagem",
  visit: "visita",
};

const TYPE_ICONS: Record<EventType, typeof CheckCircle2> = {
  call: CheckCircle2,
  email: CheckCircle2,
  meeting: Video,
  task: CheckCircle2,
  message: CheckCircle2,
  visit: CalendarCheck,
};

function getOutcomeOptions(eventType: EventType): OutcomeOption[] {
  const primary: OutcomeOption =
    eventType === "visit"
      ? {
          value: "visit_completed",
          label: "Visita realizada",
          description: "A visita ao imóvel aconteceu como planejado.",
          icon: CalendarCheck,
        }
      : eventType === "meeting"
        ? {
            value: "meeting_completed",
            label: "Reunião realizada",
            description: "A reunião aconteceu como planejado.",
            icon: Video,
          }
        : eventType === "task"
          ? {
              value: "activity_completed",
              label: "Tarefa concluída",
              description: "A tarefa foi executada como planejado.",
              icon: CheckCircle2,
            }
          : {
              value: "contacted",
              label: "Contato realizado",
              description: "O contato foi realizado e houve atendimento.",
              icon: CheckCircle2,
            };

  return eventType === "visit" || eventType === "meeting"
    ? [primary, ...COMMON_FINAL_OUTCOMES]
    : [primary];
}

export type ScheduleOutcomeConfirmation = {
  outcome: ScheduleOutcome;
  notes: string;
  performedBy: string | null;
  reschedule: {
    startTime: string;
    endTime: string;
    isAllDay: boolean;
    reminderMinutes?: number | null;
  } | null;
};

export function ScheduleOutcomeDialog({
  open,
  onOpenChange,
  eventType,
  users,
  defaultPerformerId,
  eventStartTime,
  eventEndTime,
  eventIsAllDay,
  eventReminderMinutes,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
  isLoading,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventType: EventType;
  users: Array<{ id: string; name: string }>;
  defaultPerformerId?: string | null;
  eventStartTime?: string | null;
  eventEndTime?: string | null;
  eventIsAllDay?: boolean | null;
  eventReminderMinutes?: number | null;
  timeZone?: string;
  isLoading: boolean;
  onConfirm: (input: ScheduleOutcomeConfirmation) => void | Promise<void>;
}) {
  const [outcome, setOutcome] = useState<ScheduleOutcome | "">("");
  const [notes, setNotes] = useState("");
  const [performedBy, setPerformedBy] = useState(defaultPerformerId || "");
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState(() => {
    const start = eventStartTime ? new Date(eventStartTime) : null;
    return start && Number.isFinite(start.getTime())
      ? formatScheduleZonedTime(start, timeZone)
      : "09:00";
  });
  const [currentTime, setCurrentTime] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );
    return () => window.clearInterval(intervalId);
  }, []);
  const options = useMemo(() => getOutcomeOptions(eventType), [eventType]);
  const TypeIcon = TYPE_ICONS[eventType];
  const status = outcome ? scheduleStatusForOutcome(outcome) : null;
  const today = useMemo(
    () =>
      getScheduleCivilDateKey(currentTime, timeZone) ||
      format(new Date(currentTime), "yyyy-MM-dd"),
    [currentTime, timeZone],
  );
  const originalDurationMinutes = useMemo(() => {
    const start = eventStartTime ? Date.parse(eventStartTime) : Number.NaN;
    const end = eventEndTime ? Date.parse(eventEndTime) : Number.NaN;
    const duration = Math.round((end - start) / 60_000);
    return Number.isFinite(duration) && duration > 0 ? duration : 60;
  }, [eventEndTime, eventStartTime]);
  const rescheduleInterval = useMemo(() => {
    if (outcome !== "rescheduled" || !rescheduleDate) return null;
    let start: Date;
    let end: Date;
    if (eventIsAllDay) {
      const range = getScheduleCivilDayRange(rescheduleDate, timeZone);
      if (!range) return null;
      start = new Date(range.startTime);
      end = new Date(range.endTime);
    } else {
      const zonedStart =
        rescheduleDate === today
          ? scheduleFutureCivilDateTimeToDate(
              rescheduleDate,
              rescheduleTime,
              timeZone,
              currentTime,
            )
          : scheduleCivilDateTimeToDate(
              rescheduleDate,
              rescheduleTime,
              timeZone,
            );
      if (!zonedStart) return null;
      start = zonedStart;
      end = new Date(start.getTime() + originalDurationMinutes * 60_000);
    }

    if (!Number.isFinite(start.getTime()) || start.getTime() <= currentTime) {
      return null;
    }
    return { startTime: start.toISOString(), endTime: end.toISOString() };
  }, [
    eventIsAllDay,
    currentTime,
    originalDurationMinutes,
    outcome,
    rescheduleDate,
    rescheduleTime,
    timeZone,
    today,
  ]);
  const rescheduleInvalid = outcome === "rescheduled" && !rescheduleInterval;

  const close = () => {
    if (!isLoading) onOpenChange(false);
  };

  const confirm = async () => {
    if (
      !outcome ||
      (status === "completed" && !performedBy) ||
      rescheduleInvalid
    ) {
      return;
    }
    await onConfirm({
      outcome,
      notes: notes.trim(),
      performedBy: status === "completed" ? performedBy : null,
      reschedule:
        outcome === "rescheduled" && rescheduleInterval
          ? {
              ...rescheduleInterval,
              isAllDay: Boolean(eventIsAllDay),
              reminderMinutes:
                eventReminderMinutes == null ||
                (eventReminderMinutes >= 0 && eventReminderMinutes <= 120)
                  ? eventReminderMinutes
                  : undefined,
            }
          : null,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : close())}
    >
      <DialogContent
        className="max-h-[88dvh] w-[calc(100vw-2rem)] max-w-[620px] overflow-y-auto rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-5 text-[var(--app-text-primary)] shadow-none"
        onEscapeKeyDown={(event) => {
          if (isLoading) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[16px] font-normal">
            <span className="flex h-8 w-8 items-center justify-center rounded-[6px] bg-primary/10 text-primary">
              <TypeIcon className="h-4 w-4" />
            </span>
            Resultado da {TYPE_LABELS[eventType]}
          </DialogTitle>
          <DialogDescription className="text-[12px] font-light">
            Enquanto nenhum resultado for registrado, o compromisso permanece em
            aberto.
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={outcome}
          onValueChange={(value) => setOutcome(value as ScheduleOutcome)}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {options.map((option) => {
            const OptionIcon = option.icon;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-[7px] border px-3 py-2.5 transition-colors",
                  outcome === option.value
                    ? "border-primary/30 bg-primary/10 text-primary"
                    : "border-[var(--app-border)] bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]",
                )}
              >
                <RadioGroupItem
                  value={option.value}
                  className="mt-0.5 shrink-0"
                />
                <OptionIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  <span className="block text-[12px] font-normal">
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-light leading-4 text-[var(--app-text-secondary)]">
                    {option.description}
                  </span>
                </span>
              </label>
            );
          })}
        </RadioGroup>

        {outcome === "rescheduled" && (
          <div className="space-y-2 rounded-[7px] bg-amber-500/10 p-3">
            <div>
              <p className="text-[12px] font-normal text-amber-800 dark:text-amber-200">
                Defina o novo horário
              </p>
              <p className="mt-0.5 text-[10px] font-light leading-4 text-[var(--app-text-secondary)]">
                Este compromisso será preservado como remarcado. O novo ficará
                em aberto com os mesmos vínculos, responsáveis, duração e
                lembrete.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                type="date"
                min={today}
                value={rescheduleDate}
                onChange={(event) => setRescheduleDate(event.target.value)}
                aria-label="Nova data"
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none"
              />
              <Input
                type="time"
                value={rescheduleTime}
                onChange={(event) => setRescheduleTime(event.target.value)}
                disabled={Boolean(eventIsAllDay)}
                aria-label="Novo horário"
                className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-solid)] text-[12px] font-light shadow-none"
              />
            </div>
            {rescheduleInvalid && rescheduleDate && (
              <p className="text-[10px] font-light text-destructive">
                Escolha uma data e um horário futuros.
              </p>
            )}
          </div>
        )}

        {status === "completed" && (
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-light text-[var(--app-text-secondary)]">
              <UserRound className="h-3.5 w-3.5" /> Realizado por
            </label>
            <Select value={performedBy} onValueChange={setPerformedBy}>
              <SelectTrigger className="h-9 rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none">
                <SelectValue placeholder="Selecione o responsável" />
              </SelectTrigger>
              <SelectContent className="app-header-popover rounded-[8px] border-0">
                {users.map((user) => (
                  <SelectItem
                    key={user.id}
                    value={user.id}
                    className="text-[12px] font-light"
                  >
                    {user.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Textarea
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          maxLength={2000}
          rows={3}
          placeholder="Observações ou motivo (opcional)"
          className="resize-none rounded-[6px] border-0 bg-[var(--app-surface-soft)] text-[12px] font-light shadow-none"
        />

        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={close}
            disabled={isLoading}
            className="h-9 rounded-[6px] bg-[var(--app-surface-soft)] px-4 text-[12px] font-light"
          >
            Voltar
          </Button>
          <Button
            onClick={() => void confirm()}
            disabled={
              !outcome ||
              (status === "completed" && !performedBy) ||
              rescheduleInvalid ||
              isLoading
            }
            className="h-9 min-w-32 rounded-[6px] px-4 text-[12px] font-light"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : outcome === "rescheduled" ? (
              "Confirmar remarcação"
            ) : (
              "Registrar resultado"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
