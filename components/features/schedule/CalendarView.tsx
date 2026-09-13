import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  isWeekend,
  startOfWeek,
  endOfWeek,
  parseISO,
  addDays,
  startOfYear,
  endOfYear,
  eachMonthOfInterval,
  differenceInMinutes,
  addMinutes,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Phone,
  Mail,
  Calendar as CalendarIcon,
  CheckSquare,
  MessageSquare,
  Home,
  Clock,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScheduleEvent, EventType } from "@/hooks/use-schedule-events";
import {
  splitScheduleEventByDay,
  type ScheduleEventDaySegment,
} from "@/lib/schedule-event-segments";
import { layoutScheduleCalendarSegments } from "@/components/features/schedule/calendar-event-geometry";
import { SCHEDULE_USER_EVENT_COLORS } from "@/config/schedule-event-colors";
import {
  getCalendarEventDensity,
  isCalendarEventNarrow,
} from "@/components/features/schedule/calendar-event-density";
import {
  DEFAULT_SCHEDULE_TIME_ZONE,
  getScheduleLifecycleLabel,
  getScheduleLifecycleState,
  isAttendanceScheduleType,
  type ScheduleLifecycleState,
} from "@/lib/schedule-outcome";
import {
  formatScheduleZonedTime,
  getScheduleZonedClockMinutes,
  scheduleCivilDateTimeToDate,
  scheduleInstantToLocalDateProxy,
} from "@/lib/schedule-time-zone";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
} from "@dnd-kit/core";

const eventTypeIcons: Record<EventType, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: CalendarIcon,
  task: CheckSquare,
  message: MessageSquare,
  visit: Home,
};

function getUserEventColor(userId?: string | null) {
  if (!userId) return SCHEDULE_USER_EVENT_COLORS[0];
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return SCHEDULE_USER_EVENT_COLORS[hash % SCHEDULE_USER_EVENT_COLORS.length];
}

const calendarLifecycleBadgeClasses: Record<ScheduleLifecycleState, string> = {
  open: "bg-white/15 text-white",
  overdue: "bg-red-950/30 text-white",
  completed: "bg-emerald-950/25 text-white",
  no_show: "bg-amber-950/30 text-white",
  rescheduled: "bg-blue-950/30 text-white",
  cancelled: "bg-slate-950/25 text-white",
};

const eventTypeLabels: Record<string, string> = {
  call: "Ligação",
  email: "E-mail",
  meeting: "Reunião",
  task: "Tarefa",
  message: "Mensagem",
  visit: "Visita",
};

type ScheduleEventTimeUpdate = Partial<
  Pick<ScheduleEvent, "start_time" | "end_time">
>;

const CALENDAR_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function formatCalendarHour(hour: number) {
  return String(hour).padStart(2, "0");
}

interface ActivityCardProps {
  event: ScheduleEvent;
  displayStart?: Date;
  displayEnd?: Date;
  dragId?: string;
  onEditEvent?: (event: ScheduleEvent) => void;
  onEventUpdate?: (id: string, updates: ScheduleEventTimeUpdate) => void;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
  editable?: boolean;
  resizable?: boolean;
  displayDurationMinutes?: number;
  lifecycleNow: number;
  timeZone: string;
}

function ActivityCard({
  event,
  displayStart,
  displayEnd,
  dragId,
  onEditEvent,
  onEventUpdate,
  isDragging,
  style,
  className,
  editable = false,
  resizable = true,
  displayDurationMinutes,
  lifecycleNow,
  timeZone,
}: ActivityCardProps) {
  const { listeners, setNodeRef, transform } = useDraggable({
    id: dragId ?? event.id,
    data: event,
    disabled: !editable,
  });

  const [resizing, setResizing] = useState(false);
  const [tempHeight, setTempHeight] = useState<number | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const resizeClickResetRef = useRef<number | null>(null);
  const suppressEditClickRef = useRef(false);

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.();
      if (resizeClickResetRef.current !== null) {
        window.clearTimeout(resizeClickResetRef.current);
      }
    };
  }, []);

  const start = displayStart ?? parseISO(event.start_time);
  const end = displayEnd ?? parseISO(event.end_time);
  const duration =
    displayDurationMinutes ??
    (event.is_all_day ? 24 * 60 : Math.max(differenceInMinutes(end, start), 1));
  const userColor = getUserEventColor(event.user_id);
  const lifecycle = getScheduleLifecycleState({
    status: event.status,
    outcome: event.outcome,
    startTime: event.start_time,
    endTime: event.end_time,
    isAllDay: event.is_all_day ?? false,
    timeZone,
    now: lifecycleNow,
  });
  const lifecycleLabel = getScheduleLifecycleLabel(lifecycle);
  const isFinalized = [
    "completed",
    "no_show",
    "rescheduled",
    "cancelled",
  ].includes(lifecycle);
  const styleWidth = typeof style?.width === "string" ? style.width : undefined;
  const displayedDuration =
    tempHeight === null
      ? duration
      : Math.max(Math.round(tempHeight / (56 / 60)), 1);
  const density = getCalendarEventDensity(displayedDuration);
  const isNarrow = isCalendarEventNarrow(styleWidth);
  const activityTitle =
    event.title.trim() ||
    (event.event_type ? eventTypeLabels[event.event_type] : undefined) ||
    "Compromisso";
  const activityTimeLabel = event.is_all_day
    ? "Dia inteiro"
    : `${formatScheduleZonedTime(start, timeZone)} às ${formatScheduleZonedTime(end, timeZone)}`;
  const activityAriaLabel = `${activityTitle}. ${activityTimeLabel}. ${lifecycleLabel}.`;

  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 100,
        opacity: 0.8,
      }
    : undefined;

  const scheduleResizeClickReset = () => {
    suppressEditClickRef.current = true;
    if (resizeClickResetRef.current !== null) {
      window.clearTimeout(resizeClickResetRef.current);
    }
    resizeClickResetRef.current = window.setTimeout(() => {
      suppressEditClickRef.current = false;
      resizeClickResetRef.current = null;
    }, 0);
  };

  const handleResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (
      !editable ||
      !resizable ||
      !e.isPrimary ||
      e.button !== 0 ||
      resizeCleanupRef.current
    ) {
      return;
    }

    // The draggable card listens for pointerdown. Stop this event here so a
    // resize gesture never arms the PointerSensor on the parent card.
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);

    const pointerId = e.pointerId;
    const startY = e.clientY;
    const initialHeight = duration * (56 / 60);
    let latestHeight: number | null = null;

    const onPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (moveEvent.cancelable) moveEvent.preventDefault();
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(28, initialHeight + deltaY); // Min height 30 mins (28px)
      // Snap to 30 mins increments (28px)
      const snappedHeight = Math.round(newHeight / 28) * 28;
      latestHeight = snappedHeight;
      setTempHeight(snappedHeight);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerup", onPointerUp, true);
      document.removeEventListener("pointercancel", onPointerCancel, true);
      if (resizeCleanupRef.current === cleanup) {
        resizeCleanupRef.current = null;
      }
    };

    const finishResize = (commit: boolean) => {
      setResizing(false);
      setTempHeight(null);
      cleanup();

      if (commit && latestHeight !== null) {
        const newDuration = Math.round(latestHeight / (56 / 60));
        const newEnd = addMinutes(start, newDuration);
        onEventUpdate?.(event.id, { end_time: newEnd.toISOString() });
      }

      scheduleResizeClickReset();
    };

    function onPointerUp(upEvent: PointerEvent) {
      if (upEvent.pointerId !== pointerId) return;
      if (upEvent.cancelable) upEvent.preventDefault();
      upEvent.stopPropagation();
      finishResize(true);
    }

    function onPointerCancel(cancelEvent: PointerEvent) {
      if (cancelEvent.pointerId !== pointerId) return;
      if (cancelEvent.cancelable) cancelEvent.preventDefault();
      cancelEvent.stopPropagation();
      finishResize(false);
    }

    resizeCleanupRef.current = cleanup;
    document.addEventListener("pointermove", onPointerMove, {
      capture: true,
      passive: false,
    });
    document.addEventListener("pointerup", onPointerUp, true);
    document.addEventListener("pointercancel", onPointerCancel, true);
  };

  const handleCardClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (suppressEditClickRef.current) {
      e.preventDefault();
      return;
    }
    onEditEvent?.(event);
  };

  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!onEditEvent || (e.key !== "Enter" && e.key !== " ")) return;
    e.preventDefault();
    e.stopPropagation();
    onEditEvent(event);
  };

  const handleResizeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const currentHeight =
    tempHeight !== null
      ? `${tempHeight}px`
      : (style?.height ?? `${duration * (56 / 60)}px`);

  if (density === "compact") {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        role={onEditEvent ? "button" : undefined}
        tabIndex={onEditEvent ? 0 : undefined}
        aria-label={onEditEvent ? activityAriaLabel : undefined}
        onKeyDown={handleCardKeyDown}
        onClick={handleCardClick}
        title={`${activityTitle} · ${formatScheduleZonedTime(start, timeZone)} - ${formatScheduleZonedTime(end, timeZone)} · ${lifecycleLabel}`}
        data-calendar-event-density={density}
        className={cn(
          "group absolute left-0.5 right-0.5 z-10 flex items-center gap-1 overflow-hidden rounded-[4px] border-0 px-1.5 py-0.5 text-white shadow-none",
          editable && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-50 grayscale",
          resizing && "z-50 ring-2 ring-primary ring-offset-1",
          isFinalized && "opacity-75",
          lifecycle === "cancelled" && "grayscale",
          className,
        )}
        style={{
          ...style,
          ...dragStyle,
          backgroundColor: userColor.background,
          height: currentHeight,
        }}
      >
        <span
          data-calendar-event-title
          className="min-w-0 flex-1 truncate text-[10px] font-medium leading-none"
        >
          {activityTitle}
        </span>
        {!isNarrow && (
          <span
            data-calendar-event-time
            className="shrink-0 text-[9px] font-light leading-none tabular-nums opacity-80"
          >
            {event.is_all_day
              ? "Dia inteiro"
              : formatScheduleZonedTime(start, timeZone)}
          </span>
        )}
        {lifecycle !== "open" && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white ring-1 ring-black/10" />
        )}
        {editable && resizable && displayedDuration > 20 && (
          <div
            data-calendar-event-resize-handle
            className="absolute bottom-0 left-0 right-0 flex h-1.5 touch-none cursor-ns-resize select-none items-center justify-center opacity-0 transition-opacity hover:bg-current/20 active:bg-current/40 group-hover:opacity-100"
            onPointerDown={handleResizePointerDown}
            onClick={handleResizeClick}
          >
            <div className="h-0.5 w-4 rounded-full bg-current/40" />
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      role={onEditEvent ? "button" : undefined}
      tabIndex={onEditEvent ? 0 : undefined}
      aria-label={onEditEvent ? activityAriaLabel : undefined}
      onKeyDown={handleCardKeyDown}
      onClick={handleCardClick}
      title={`${activityTitle} · ${formatScheduleZonedTime(start, timeZone)} - ${formatScheduleZonedTime(end, timeZone)} · ${lifecycleLabel}`}
      data-calendar-event-density={density}
      className={cn(
        "group absolute left-0.5 right-0.5 z-10 overflow-hidden rounded-[4px] border-0 text-white shadow-none",
        editable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50 grayscale",
        resizing && "z-50 ring-2 ring-primary ring-offset-1",
        isFinalized && "opacity-75",
        lifecycle === "cancelled" && "grayscale",
        className,
      )}
      style={{
        ...style,
        ...dragStyle,
        backgroundColor: userColor.background,
        height: currentHeight,
      }}
    >
      <div
        className={cn("flex h-full relative min-h-0", "flex-col px-2 py-1.5")}
      >
        <span
          data-calendar-event-title
          className="truncate text-[11px] font-medium leading-tight"
        >
          {activityTitle}
        </span>

        {density === "detailed" && !isNarrow && lifecycle !== "open" && (
          <span
            className={cn(
              "mt-1 max-w-full truncate w-fit rounded-[3px] px-1 py-0.5 text-[8px] font-normal leading-none",
              calendarLifecycleBadgeClasses[lifecycle],
            )}
          >
            {lifecycleLabel}
          </span>
        )}

        <div
          className={cn(
            "flex min-w-0 shrink-0 items-center gap-2 text-[9px] font-light tabular-nums opacity-80",
            "mt-auto",
          )}
        >
          <div className="flex items-center gap-1 min-w-0">
            {density === "detailed" && !isNarrow && (
              <Clock className="h-2.5 w-2.5 shrink-0" />
            )}
            <span data-calendar-event-time className="truncate">
              {event.is_all_day
                ? "Dia inteiro"
                : formatScheduleZonedTime(start, timeZone)}
              {!event.is_all_day &&
                !isNarrow &&
                ` - ${formatScheduleZonedTime(tempHeight !== null ? addMinutes(start, Math.round(tempHeight / (56 / 60))) : end, timeZone)}`}
            </span>
          </div>
          {density === "standard" && !isNarrow && lifecycle !== "open" && (
            <span
              className={cn(
                "ml-auto max-w-[72px] truncate rounded-[3px] px-1 py-0.5 text-[8px] font-normal leading-none",
                calendarLifecycleBadgeClasses[lifecycle],
              )}
            >
              {lifecycleLabel}
            </span>
          )}
          {density === "detailed" && !isNarrow && event.lead && (
            <div className="flex items-center gap-1 max-w-[80px] min-w-0">
              <User className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{event.lead.name}</span>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {editable && resizable && (
          <div
            data-calendar-event-resize-handle
            className="absolute bottom-0 left-0 right-0 flex h-1.5 touch-none cursor-ns-resize select-none items-center justify-center opacity-0 transition-opacity hover:bg-current/20 active:bg-current/40 group-hover:opacity-100"
            onPointerDown={handleResizePointerDown}
            onClick={handleResizeClick}
          >
            <div className="h-0.5 w-4 rounded-full bg-current/40" />
          </div>
        )}
      </div>
    </div>
  );
}

function DroppableSlot({
  id,
  onQuickCreate,
  className,
  children,
  disabled = false,
}: {
  id: string;
  onQuickCreate?: () => void;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: id,
    disabled,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        disabled && "cursor-not-allowed bg-[var(--app-surface-soft)]/70",
        isOver &&
          !disabled &&
          "bg-primary/[0.05] ring-2 ring-primary/20 ring-inset z-0",
      )}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      onClick={disabled ? undefined : onQuickCreate}
    >
      {children}
    </div>
  );
}

function CurrentTimeIndicator({
  top,
  className,
}: {
  top: number;
  className?: string;
}) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-[15] flex items-center",
        className,
      )}
      style={{ top }}
    >
      <span className="-ml-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
      <span className="h-px flex-1 bg-primary" />
    </div>
  );
}
interface CalendarViewProps {
  events: ScheduleEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  pivotDate: Date;
  onPivotChange: (date: Date) => void;
  viewMode: "day" | "week" | "month" | "year";
  onEditEvent?: (event: ScheduleEvent) => void;
  onEventUpdate?: (id: string, updates: ScheduleEventTimeUpdate) => void;
  onQuickCreate?: (date: Date, time?: string) => void;
  showThirtyMinLines?: boolean;
  canManageEvents?: boolean;
  timeZone?: string;
}

export function CalendarView({
  events,
  selectedDate,
  onDateSelect,
  pivotDate,
  onPivotChange,
  viewMode,
  onEditEvent,
  onEventUpdate,
  onQuickCreate,
  showThirtyMinLines = false,
  canManageEvents = false,
  timeZone = DEFAULT_SCHEDULE_TIME_ZONE,
}: CalendarViewProps) {
  const isEventTimingEditable = useCallback(
    (event: ScheduleEvent) =>
      canManageEvents &&
      !event.is_masked &&
      !isAttendanceScheduleType(event.event_type) &&
      !["completed", "no_show", "cancelled", "canceled"].includes(
        event.status || "",
      ),
    [canManageEvents],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );
  const [activeEvent, setActiveEvent] = useState<ScheduleEvent | null>(null);
  const [currentTime, setCurrentTime] = useState<number | null>(null);

  useEffect(() => {
    let intervalId: number | undefined;
    const updateCurrentTime = () => setCurrentTime(Date.now());

    updateCurrentTime();
    const timeoutId = window.setTimeout(
      () => {
        updateCurrentTime();
        intervalId = window.setInterval(updateCurrentTime, 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );

    return () => {
      window.clearTimeout(timeoutId);
      if (intervalId !== undefined) window.clearInterval(intervalId);
    };
  }, []);

  const currentDisplayTime =
    currentTime === null
      ? null
      : scheduleInstantToLocalDateProxy(currentTime, timeZone);
  const currentTimeTop = currentTime
    ? (getScheduleZonedClockMinutes(currentTime, timeZone) * 56) / 60
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    const scheduleEvent = event.active.data.current as ScheduleEvent;
    if (!isEventTimingEditable(scheduleEvent)) return;
    setActiveEvent(scheduleEvent);
  };

  const calculateEventLayouts = useCallback(
    (daySegments: ScheduleEventDaySegment<ScheduleEvent>[]) => {
      return layoutScheduleCalendarSegments(daySegments, timeZone);
    },
    [timeZone],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveEvent(null);
    const { active, over } = event;

    if (canManageEvents && over && active.id !== over.id) {
      const scheduleEvent = active.data.current as ScheduleEvent;
      if (!isEventTimingEditable(scheduleEvent)) return;
      const [dateStr, hourStr] = (over.id as string).split("|");

      const originalStart = parseISO(scheduleEvent.start_time);
      const newStart = scheduleCivilDateTimeToDate(dateStr, hourStr, timeZone, {
        preferredInstant: originalStart,
      });
      if (!newStart) return;
      const originalEnd = parseISO(scheduleEvent.end_time);
      const duration = differenceInMinutes(originalEnd, originalStart);

      const newEnd = addMinutes(newStart, duration);

      onEventUpdate?.(scheduleEvent.id, {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      });
    }
  };

  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEventDaySegment<ScheduleEvent>[]> = {};
    events.forEach((event) => {
      splitScheduleEventByDay(event, timeZone).forEach((segment) => {
        if (!map[segment.dateKey]) map[segment.dateKey] = [];
        map[segment.dateKey].push(segment);
      });
    });
    return map;
  }, [events, timeZone]);

  const renderMonthView = () => {
    const monthStart = startOfMonth(pivotDate);
    const monthEnd = endOfMonth(pivotDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const calendarDays = eachDayOfInterval({
      start: calendarStart,
      end: calendarEnd,
    });
    const weekDays = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

    return (
      <div className="flex flex-col h-full overflow-hidden bg-transparent">
        <div
          data-calendar-header="month"
          className="schedule-calendar-days-header sticky top-0 z-20 grid h-8 shrink-0 grid-cols-7"
        >
          {weekDays.map((day, index) => (
            <div
              key={day}
              data-weekend={
                index === 0 ? "sunday" : index === 6 ? "saturday" : undefined
              }
              className="schedule-calendar-days-header__cell flex h-8 items-center justify-center border-r border-[var(--schedule-grid-border)] px-2 text-center text-[10px] font-light text-[var(--app-text-tertiary)] last:border-r-0"
            >
              {day}
            </div>
          ))}
        </div>
        <div className="grid flex-1 grid-cols-7 gap-px overflow-hidden bg-[var(--schedule-grid-border)]">
          {calendarDays.map((day) => {
            const dateKey = format(day, "yyyy-MM-dd");
            const daySegments = eventsByDate[dateKey] || [];
            const isCurrentMonth = isSameMonth(day, pivotDate);
            const isSelected = isSameDay(day, selectedDate);
            const isDayToday = currentDisplayTime
              ? isSameDay(day, currentDisplayTime)
              : isToday(day);

            const maxVisibleEvents = 3;
            const visibleEvents = daySegments.slice(0, maxVisibleEvents);
            const moreCount = daySegments.length - maxVisibleEvents;

            return (
              <div
                key={dateKey}
                onClick={() => {
                  onDateSelect(day);
                  onQuickCreate?.(day);
                }}
                className={cn(
                  "group relative flex min-h-[120px] cursor-pointer flex-col bg-[var(--app-surface-solid)] p-2 transition-colors hover:bg-[var(--app-surface-hover)]",
                  !isCurrentMonth && "bg-muted/5 opacity-30",
                  isSelected &&
                    "z-10 bg-primary/[0.06] ring-1 ring-inset ring-primary/10",
                )}
              >
                <div className="flex justify-between items-center mb-1">
                  <span
                    className={cn(
                      "flex h-6 w-6 items-center justify-center rounded-[6px] text-[11px] font-light transition-colors",
                      isDayToday
                        ? "bg-primary/50 text-white"
                        : "text-[var(--app-text-tertiary)] group-hover:text-[var(--app-text-primary)]",
                    )}
                  >
                    {format(day, "d")}
                  </span>
                </div>

                <div className="space-y-1 flex-1">
                  {visibleEvents.map((segment) => {
                    const event = segment.event;
                    const Icon =
                      eventTypeIcons[event.event_type as EventType] ||
                      CalendarIcon;
                    const userColor = getUserEventColor(event.user_id);
                    const lifecycle = getScheduleLifecycleState({
                      status: event.status,
                      outcome: event.outcome,
                      startTime: event.start_time,
                      endTime: event.end_time,
                      isAllDay: event.is_all_day ?? false,
                      timeZone,
                      now: currentTime ?? 0,
                    });
                    return (
                      <div
                        key={segment.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditEvent?.(event);
                        }}
                        className={cn(
                          "flex items-center gap-1.5 truncate rounded-[4px] border-0 px-2 py-1 text-[9px] font-light text-white shadow-none transition-opacity hover:opacity-90",
                          [
                            "completed",
                            "no_show",
                            "rescheduled",
                            "cancelled",
                          ].includes(lifecycle) && "opacity-70",
                          lifecycle === "cancelled" && "grayscale",
                        )}
                        title={`${event.title} · ${getScheduleLifecycleLabel(lifecycle)}`}
                        style={{ backgroundColor: userColor.background }}
                      >
                        <Icon className="h-2.5 w-2.5 flex-shrink-0 opacity-80" />
                        <span className="truncate tracking-tight">
                          {event.title}
                        </span>
                        {lifecycle !== "open" && (
                          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-white/90" />
                        )}
                      </div>
                    );
                  })}

                  {moreCount > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded-[4px] bg-primary/10 py-0.5 text-center text-[9px] font-light text-primary transition-colors hover:bg-primary/15"
                        >
                          +{moreCount} mais
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="app-header-popover z-[100] w-64 rounded-[8px] border-0 p-2"
                        align="start"
                      >
                        <div className="mb-2 border-b border-[var(--schedule-grid-border)] px-1 pb-1 text-[10px] font-light text-[var(--app-text-tertiary)]">
                          {format(day, "dd 'de' MMMM", { locale: ptBR })}
                        </div>
                        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                          {daySegments.map((segment) => {
                            const event = segment.event;
                            const Icon =
                              eventTypeIcons[event.event_type as EventType] ||
                              CalendarIcon;
                            const userColor = getUserEventColor(event.user_id);
                            const lifecycle = getScheduleLifecycleState({
                              status: event.status,
                              outcome: event.outcome,
                              startTime: event.start_time,
                              endTime: event.end_time,
                              isAllDay: event.is_all_day ?? false,
                              timeZone,
                              now: currentTime ?? 0,
                            });
                            return (
                              <div
                                key={segment.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditEvent?.(event);
                                }}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 truncate rounded-[4px] border-0 px-2 py-1.5 text-[10px] font-light text-white shadow-none transition-opacity hover:opacity-90",
                                  [
                                    "completed",
                                    "no_show",
                                    "rescheduled",
                                    "cancelled",
                                  ].includes(lifecycle) && "opacity-75",
                                  lifecycle === "cancelled" && "grayscale",
                                )}
                                title={`${event.title} · ${getScheduleLifecycleLabel(lifecycle)}`}
                                style={{
                                  backgroundColor: userColor.background,
                                }}
                              >
                                <Icon className="h-3 w-3 flex-shrink-0 opacity-80" />
                                <div className="flex flex-col truncate">
                                  <span className="truncate tracking-tight leading-tight">
                                    {event.title}
                                  </span>
                                  <span className="text-[8px] opacity-70">
                                    {event.is_all_day
                                      ? "Dia inteiro"
                                      : formatScheduleZonedTime(
                                          segment.start,
                                          timeZone,
                                        )}{" "}
                                    · {getScheduleLifecycleLabel(lifecycle)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderDayView = () => {
    const hours = CALENDAR_HOURS;
    const dayDateKey = format(pivotDate, "yyyy-MM-dd");
    const daySegments = eventsByDate[dayDateKey] || [];

    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="h-full border-0 bg-transparent">
          <div className="relative flex min-h-full">
            {/* Time axis */}
            <div className="w-16 flex-shrink-0 border-r border-[var(--schedule-grid-border)] bg-[var(--app-surface-soft)]">
              {hours.map((hour) => (
                <div
                  key={hour}
                  className="flex h-14 items-center justify-center border-b border-[var(--schedule-grid-border)]"
                >
                  <span className="text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]">
                    {formatCalendarHour(hour)}:00
                  </span>
                </div>
              ))}
            </div>

            {currentDisplayTime &&
              currentTimeTop !== null &&
              isSameDay(pivotDate, currentDisplayTime) && (
                <CurrentTimeIndicator
                  top={currentTimeTop}
                  className="left-16 right-0"
                />
              )}

            {/* Grid content */}
            <div className="flex-1 relative">
              {hours.map((hour) => {
                const hourStr = formatCalendarHour(hour);
                const hourStart = `${hourStr}:00`;
                const halfHourStart = `${hourStr}:30`;
                return (
                  <div
                    key={hour}
                    className="relative h-14 w-full border-b border-[var(--schedule-grid-border)]"
                  >
                    <DroppableSlot
                      id={`${dayDateKey}|${hourStart}`}
                      disabled={
                        !scheduleCivilDateTimeToDate(
                          dayDateKey,
                          hourStart,
                          timeZone,
                        )
                      }
                      className={cn(
                        "h-7 w-full cursor-pointer hover:bg-primary/[0.02] transition-colors",
                        showThirtyMinLines &&
                          "border-b border-[var(--schedule-grid-border)]",
                      )}
                      onQuickCreate={() => {
                        onQuickCreate?.(pivotDate, hourStart);
                      }}
                    />
                    <DroppableSlot
                      id={`${dayDateKey}|${halfHourStart}`}
                      disabled={
                        !scheduleCivilDateTimeToDate(
                          dayDateKey,
                          halfHourStart,
                          timeZone,
                        )
                      }
                      className="h-7 w-full cursor-pointer hover:bg-primary/[0.02] transition-colors"
                      onQuickCreate={() => {
                        onQuickCreate?.(pivotDate, halfHourStart);
                      }}
                    />
                  </div>
                );
              })}

              {/* Events */}
              {calculateEventLayouts(daySegments).map(
                ({ segment, geometry, column, totalColumns }) => {
                  const { event, start, end } = segment;
                  const top = geometry.startMinutes * (56 / 60);
                  const height = geometry.durationMinutes * (56 / 60);
                  const realDurationMinutes =
                    (end.getTime() - start.getTime()) / 60_000;
                  const canResizeInGrid =
                    Math.abs(geometry.durationMinutes - realDurationMinutes) <
                    0.001;

                  const width = 100 / totalColumns;
                  const left = column * width;

                  return (
                    <ActivityCard
                      key={segment.key}
                      event={event}
                      displayStart={start}
                      displayEnd={end}
                      displayDurationMinutes={geometry.durationMinutes}
                      dragId={segment.key}
                      onEditEvent={onEditEvent}
                      onEventUpdate={onEventUpdate}
                      editable={isEventTimingEditable(event)}
                      resizable={segment.isLast && canResizeInGrid}
                      lifecycleNow={currentTime ?? 0}
                      timeZone={timeZone}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        minHeight: `${Math.min(28, height)}px`,
                        width: `calc(${width}% - 4px)`,
                        left: `calc(${left}% + 2px)`,
                      }}
                    />
                  );
                },
              )}
            </div>
          </div>
        </ScrollArea>
        <DragOverlay>
          {activeEvent ? (
            <ActivityCard
              event={activeEvent}
              lifecycleNow={currentTime ?? 0}
              timeZone={timeZone}
              className="w-[150px] relative left-0 right-0"
              style={{ position: "relative", top: 0, height: "56px" }}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  const renderWeekView = () => {
    const weekStart = startOfWeek(pivotDate, { weekStartsOn: 0 });
    const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
    const hours = CALENDAR_HOURS;

    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="h-full border-0 bg-transparent">
          <div className="relative flex flex-col min-w-[1000px] min-h-full">
            {/* Header */}
            <div
              data-calendar-header="week"
              className="schedule-calendar-days-header sticky top-0 z-20 flex h-9 shrink-0"
            >
              <div
                aria-hidden="true"
                className="h-9 w-16 flex-shrink-0 border-r border-[var(--schedule-grid-border)]"
              />
              {weekDays.map((day) => {
                const isSelected = isSameDay(day, selectedDate);
                const isDayToday = currentDisplayTime
                  ? isSameDay(day, currentDisplayTime)
                  : isToday(day);
                const weekendKind = isWeekend(day)
                  ? day.getDay() === 0
                    ? "sunday"
                    : "saturday"
                  : undefined;

                return (
                  <button
                    type="button"
                    key={day.toString()}
                    data-weekend={weekendKind}
                    data-selected={isSelected || undefined}
                    data-today={isDayToday || undefined}
                    aria-current={isDayToday ? "date" : undefined}
                    aria-pressed={isSelected}
                    aria-label={format(day, "EEEE, d 'de' MMMM", {
                      locale: ptBR,
                    })}
                    onClick={() => {
                      onDateSelect(day);
                      onPivotChange(day);
                    }}
                    className="schedule-calendar-days-header__cell group flex h-9 flex-1 items-center justify-center gap-1.5 border-r border-[var(--schedule-grid-border)] px-2 text-[10px] font-light text-[var(--app-text-secondary)] outline-none transition-colors last:border-r-0 hover:text-[var(--app-text-primary)] focus-visible:z-10 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/40"
                  >
                    <span
                      className={cn(
                        "capitalize",
                        weekendKind && !isSelected && !isDayToday
                          ? "text-[var(--app-text-tertiary)]"
                          : "text-inherit",
                      )}
                    >
                      {format(day, "EEE", { locale: ptBR })}
                    </span>
                    <span className="schedule-calendar-days-header__date inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] px-1 text-[11px] tabular-nums transition-colors">
                      {format(day, "d")}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Grid */}
            <div className="flex relative flex-1">
              {/* Time axis */}
              <div className="w-16 flex-shrink-0 border-r border-[var(--schedule-grid-border)] bg-[var(--app-surface-soft)]">
                {hours.map((hour) => (
                  <div
                    key={hour}
                    className="flex h-14 items-center justify-center border-b border-[var(--schedule-grid-border)]"
                  >
                    <span className="text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]">
                      {formatCalendarHour(hour)}:00
                    </span>
                  </div>
                ))}
              </div>

              {/* Days columns */}
              {weekDays.map((day) => (
                <div
                  key={day.toString()}
                  className="relative flex-1 border-r border-[var(--schedule-grid-border)] last:border-r-0"
                >
                  {hours.map((hour) => {
                    const hourStr = formatCalendarHour(hour);
                    const dayDateKey = format(day, "yyyy-MM-dd");
                    const hourStart = `${hourStr}:00`;
                    const halfHourStart = `${hourStr}:30`;
                    return (
                      <div
                        key={hour}
                        className="relative h-14 w-full border-b border-[var(--schedule-grid-border)]"
                      >
                        <DroppableSlot
                          id={`${dayDateKey}|${hourStart}`}
                          disabled={
                            !scheduleCivilDateTimeToDate(
                              dayDateKey,
                              hourStart,
                              timeZone,
                            )
                          }
                          className={cn(
                            "h-7 w-full cursor-pointer hover:bg-primary/[0.01] transition-colors",
                            showThirtyMinLines &&
                              "border-b border-[var(--schedule-grid-border)]",
                          )}
                          onQuickCreate={() => {
                            onQuickCreate?.(day, hourStart);
                          }}
                        />
                        <DroppableSlot
                          id={`${dayDateKey}|${halfHourStart}`}
                          disabled={
                            !scheduleCivilDateTimeToDate(
                              dayDateKey,
                              halfHourStart,
                              timeZone,
                            )
                          }
                          className="h-7 w-full cursor-pointer hover:bg-primary/[0.01] transition-colors"
                          onQuickCreate={() => {
                            onQuickCreate?.(day, halfHourStart);
                          }}
                        />
                      </div>
                    );
                  })}

                  {currentDisplayTime &&
                    currentTimeTop !== null &&
                    isSameDay(day, currentDisplayTime) && (
                      <CurrentTimeIndicator
                        top={currentTimeTop}
                        className="left-0 right-0"
                      />
                    )}

                  {/* Events for this day */}
                  {calculateEventLayouts(
                    eventsByDate[format(day, "yyyy-MM-dd")] || [],
                  ).map(({ segment, geometry, column, totalColumns }) => {
                    const { event, start, end } = segment;
                    const top = geometry.startMinutes * (56 / 60);
                    const height = geometry.durationMinutes * (56 / 60);
                    const realDurationMinutes =
                      (end.getTime() - start.getTime()) / 60_000;
                    const canResizeInGrid =
                      Math.abs(geometry.durationMinutes - realDurationMinutes) <
                      0.001;

                    const width = 100 / totalColumns;
                    const left = column * width;

                    return (
                      <ActivityCard
                        key={segment.key}
                        event={event}
                        displayStart={start}
                        displayEnd={end}
                        displayDurationMinutes={geometry.durationMinutes}
                        dragId={segment.key}
                        onEditEvent={onEditEvent}
                        onEventUpdate={onEventUpdate}
                        editable={isEventTimingEditable(event)}
                        resizable={segment.isLast && canResizeInGrid}
                        lifecycleNow={currentTime ?? 0}
                        timeZone={timeZone}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          minHeight: `${Math.min(28, height)}px`,
                          width: `calc(${width}% - 4px)`,
                          left: `calc(${left}% + 2px)`,
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
        <DragOverlay>
          {activeEvent ? (
            <ActivityCard
              event={activeEvent}
              lifecycleNow={currentTime ?? 0}
              timeZone={timeZone}
              className="w-[150px] relative left-0 right-0"
              style={{ position: "relative", top: 0, height: "56px" }}
            />
          ) : null}
        </DragOverlay>
      </DndContext>
    );
  };

  const renderYearView = () => {
    const yearStart = startOfYear(pivotDate);
    const months = eachMonthOfInterval({
      start: yearStart,
      end: endOfYear(pivotDate),
    });

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 h-full overflow-y-auto">
        {months.map((month) => {
          const monthStart = startOfMonth(month);
          const monthEnd = endOfMonth(month);
          const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
          const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
          const calendarDays = eachDayOfInterval({
            start: calendarStart,
            end: calendarEnd,
          });
          const weekDaysShort = ["D", "S", "T", "Q", "Q", "S", "S"];

          return (
            <div
              key={month.toString()}
              className="space-y-4 rounded-[8px] border-0 bg-[var(--app-surface-solid)] p-4 shadow-none"
            >
              <h3 className="text-center text-sm font-light capitalize text-[var(--app-text-primary)]">
                {format(month, "MMMM", { locale: ptBR })}
              </h3>
              <div className="grid grid-cols-7 gap-px">
                {weekDaysShort.map((d, i) => (
                  <div
                    key={i}
                    className="pb-2 text-center text-[9px] font-light text-[var(--app-text-tertiary)]"
                  >
                    {d}
                  </div>
                ))}
                {calendarDays.map((day) => {
                  const hasEvents =
                    (eventsByDate[format(day, "yyyy-MM-dd")] || []).length > 0;
                  const isCurrentMonth = isSameMonth(day, month);
                  const isDayToday = currentDisplayTime
                    ? isSameDay(day, currentDisplayTime)
                    : isToday(day);

                  return (
                    <div
                      key={day.toString()}
                      onClick={() => {
                        onDateSelect(day);
                        onPivotChange(day);
                      }}
                      className={cn(
                        "relative flex h-7 cursor-pointer items-center justify-center rounded-[6px] text-[10px] font-light transition-colors",
                        !isCurrentMonth && "opacity-10",
                        isDayToday && "bg-primary/50 text-white",
                        !isDayToday &&
                          isCurrentMonth &&
                          "hover:bg-[var(--app-surface-hover)]",
                        hasEvents &&
                          !isDayToday &&
                          "text-primary ring-1 ring-primary/20",
                      )}
                    >
                      {format(day, "d")}
                      {hasEvents && !isDayToday && (
                        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 bg-primary rounded-full" />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="vimob-calendar h-full flex flex-col bg-transparent overflow-hidden">
      <div className="flex-1 overflow-hidden">
        {viewMode === "month" && renderMonthView()}
        {viewMode === "day" && renderDayView()}
        {viewMode === "week" && renderWeekView()}
        {viewMode === "year" && renderYearView()}
      </div>
    </div>
  );
}
