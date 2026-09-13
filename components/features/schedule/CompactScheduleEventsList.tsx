import { useEffect, useState } from "react";
import type { Locale } from "date-fns";
import {
  Calendar,
  CalendarClock,
  Check,
  ListTodo,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  UserX,
  X,
} from "lucide-react";

import {
  useScheduleCapabilities,
  type EventType,
  type ScheduleEvent,
} from "@/hooks/use-schedule-events";
import { useUserPermissions } from "@/hooks/use-user-permissions";
import {
  DEFAULT_SCHEDULE_TIME_ZONE,
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  isFinalScheduleStatus,
  type ScheduleLifecycleState,
} from "@/lib/schedule-outcome";
import { cn } from "@/lib/utils";

const lifecycleClasses: Record<ScheduleLifecycleState, string> = {
  open: "bg-primary/12 text-primary",
  overdue: "bg-red-500/12 text-red-600 dark:text-red-300",
  completed: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300",
  no_show: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  rescheduled: "bg-blue-500/12 text-blue-700 dark:text-blue-300",
  cancelled: "bg-red-500/12 text-red-600 dark:text-red-300",
};

const scheduleEventTypeLabels: Record<EventType, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

const scheduleEventTypeIcons: Record<EventType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  task: ListTodo,
  message: MessageCircle,
  visit: MapPin,
};

function getScheduleEventType(value?: string | null): EventType {
  return value === "email" ||
    value === "meeting" ||
    value === "task" ||
    value === "message" ||
    value === "visit"
    ? value
    : "call";
}

function formatInTimeZone(
  value: string,
  locale: Locale,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  try {
    return new Intl.DateTimeFormat(locale.code || "pt-BR", {
      ...options,
      timeZone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat(locale.code || "pt-BR", {
      ...options,
      timeZone: DEFAULT_SCHEDULE_TIME_ZONE,
    }).format(date);
  }
}

function getScheduleDateLabel(
  event: ScheduleEvent,
  locale: Locale,
  timeZone: string,
) {
  const dateLabel = formatInTimeZone(event.start_time, locale, timeZone, {
    day: "2-digit",
    month: "2-digit",
  });
  if (event.is_all_day) return `${dateLabel} - dia todo`;

  const startTime = formatInTimeZone(event.start_time, locale, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const endTime = formatInTimeZone(event.end_time, locale, timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  return startTime !== endTime
    ? `${dateLabel} ${startTime}-${endTime}`
    : `${dateLabel} ${startTime}`;
}

export function CompactScheduleEventsList({
  events,
  locale,
  onEditEvent,
  emptyLabel = null,
}: {
  events: ScheduleEvent[];
  locale: Locale;
  onEditEvent?: (event: ScheduleEvent) => void;
  emptyLabel?: string | null;
}) {
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions();
  const capabilitiesQuery = useScheduleCapabilities({
    enabled: !permissionsLoading && hasPermission("schedule_view"),
  });
  const [currentTime, setCurrentTime] = useState(() => Date.now());

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setCurrentTime(Date.now()),
      60_000,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  const sortedEvents = [...events].sort((left, right) => {
    const leftFinalized = isFinalScheduleStatus(left.status);
    const rightFinalized = isFinalScheduleStatus(right.status);
    if (leftFinalized !== rightFinalized) return leftFinalized ? 1 : -1;
    const leftTime = new Date(left.start_time).getTime();
    const rightTime = new Date(right.start_time).getTime();
    return leftFinalized ? rightTime - leftTime : leftTime - rightTime;
  });

  if (sortedEvents.length === 0) {
    return emptyLabel ? (
      <p className="mt-3 rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2 text-xs text-[var(--app-text-tertiary)]">
        {emptyLabel}
      </p>
    ) : null;
  }

  const timeZone =
    capabilitiesQuery.data?.timeZone || DEFAULT_SCHEDULE_TIME_ZONE;

  return (
    <div
      className={cn(
        "mt-3 space-y-1.5 overflow-y-auto pr-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        sortedEvents.length > 2 ? "h-[148px]" : "max-h-[148px]",
      )}
    >
      {sortedEvents.map((event) => {
        const eventType = getScheduleEventType(event.event_type);
        const EventIcon = scheduleEventTypeIcons[eventType] || Calendar;
        const lifecycle = getScheduleLifecycleState({
          status: event.status,
          outcome: event.outcome,
          startTime: event.start_time,
          endTime: event.end_time,
          isAllDay: event.is_all_day ?? false,
          timeZone,
          now: currentTime,
        });
        const isCompleted = lifecycle === "completed";
        const isFinalized = isFinalScheduleStatus(event.status);
        const StatusIcon =
          lifecycle === "completed"
            ? Check
            : lifecycle === "no_show"
              ? UserX
              : lifecycle === "rescheduled"
                ? CalendarClock
                : lifecycle === "cancelled"
                  ? X
                  : EventIcon;

        return (
          <button
            key={event.id}
            type="button"
            disabled={!onEditEvent}
            onClick={() => onEditEvent?.(event)}
            className={cn(
              "flex w-full items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-1.5 text-left transition-colors hover:bg-primary/10 disabled:cursor-default disabled:hover:bg-[var(--app-surface-solid)]",
              isFinalized && "opacity-75",
            )}
          >
            <span
              className={cn(
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px]",
                lifecycleClasses[lifecycle],
              )}
            >
              <StatusIcon className="h-3 w-3" />
            </span>
            <span className="min-w-0 flex-1">
              <span
                className={cn(
                  "block truncate text-[11px] font-normal leading-tight",
                  isCompleted && "line-through",
                )}
              >
                {event.title || scheduleEventTypeLabels[eventType]}
              </span>
              <span className="mt-px flex min-w-0 flex-wrap items-center gap-1 text-[10.5px] font-light leading-tight text-[var(--app-text-secondary)]">
                <span className="font-normal text-[var(--app-text-primary)]">
                  {scheduleEventTypeLabels[eventType]}
                </span>
                <span>-</span>
                <span>{getScheduleDateLabel(event, locale, timeZone)}</span>
                <span
                  className={cn(
                    "rounded-[4px] px-1.5 py-0.5 font-light",
                    lifecycleClasses[lifecycle],
                  )}
                >
                  {getScheduleLifecycleLabel(lifecycle)}
                </span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
