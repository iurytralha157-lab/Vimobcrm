import { useState, useMemo, useCallback, useEffect } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  parseISO,
  addDays,
  startOfDay,
  endOfDay,
  eachHourOfInterval,
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
import { SCHEDULE_USER_EVENT_COLORS } from "@/config/schedule-event-colors";
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

type ScheduleEventTimeUpdate = Partial<
  Pick<ScheduleEvent, "start_time" | "end_time">
>;

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
}: ActivityCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: dragId ?? event.id,
    data: event,
    disabled: !editable,
  });

  const [resizing, setResizing] = useState(false);
  const [tempHeight, setTempHeight] = useState<number | null>(null);

  const start = displayStart ?? parseISO(event.start_time);
  const end = displayEnd ?? parseISO(event.end_time);
  const duration = event.is_all_day
    ? 24 * 60
    : Math.max(differenceInMinutes(end, start), 1);
  const userColor = getUserEventColor(event.user_id);
  const styleWidth = typeof style?.width === "string" ? style.width : undefined;

  // Granular density modes
  const isTiny = duration <= 20; // 15-20 min slot
  const isCompact = duration < 45; // 30 min
  const isNarrow =
    !!styleWidth &&
    styleWidth.includes("calc(") &&
    parseFloat(styleWidth.match(/calc\((\d+(?:\.\d+)?)/)?.[1] || "100") < 50;

  const dragStyle = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 100,
        opacity: 0.8,
      }
    : undefined;

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    if (!editable || !resizable) return;
    e.stopPropagation();
    e.preventDefault();
    setResizing(true);

    const startY = e.clientY;
    const initialHeight = duration * (56 / 60);

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaY = moveEvent.clientY - startY;
      const newHeight = Math.max(28, initialHeight + deltaY); // Min height 30 mins (28px)
      // Snap to 30 mins increments (28px)
      const snappedHeight = Math.round(newHeight / 28) * 28;
      setTempHeight(snappedHeight);
    };

    const onMouseUp = () => {
      setResizing(false);
      setTempHeight((prev) => {
        if (prev !== null) {
          const newDuration = Math.round(prev / (56 / 60));
          const newEnd = addMinutes(start, newDuration);
          onEventUpdate?.(event.id, { end_time: newEnd.toISOString() });
        }
        return null;
      });
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const currentHeight =
    tempHeight !== null
      ? `${tempHeight}px`
      : (style?.height ?? `${duration * (56 / 60)}px`);

  // Tiny mode: single line with just title + time on hover
  if (isTiny) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={(e) => {
          e.stopPropagation();
          onEditEvent?.(event);
        }}
        title={`${format(start, "HH:mm")} - ${format(end, "HH:mm")} · ${event.title}`}
        className={cn(
          "absolute left-0.5 right-0.5 z-10 flex items-center gap-1 overflow-hidden rounded-[4px] border-0 px-1.5 text-white shadow-none",
          editable && "cursor-grab active:cursor-grabbing",
          isDragging && "opacity-50 grayscale",
          className,
        )}
        style={{
          ...style,
          ...dragStyle,
          backgroundColor: userColor.background,
          height: currentHeight,
        }}
      >
        <span className="shrink-0 text-[9px] font-light tabular-nums opacity-80">
          {event.is_all_day ? "Dia inteiro" : format(start, "HH:mm")}
        </span>
        <span className="truncate text-[10px] font-normal leading-none">
          {event.title}
        </span>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onEditEvent?.(event);
      }}
      title={`${format(start, "HH:mm")} - ${format(end, "HH:mm")} · ${event.title}`}
      className={cn(
        "absolute left-0.5 right-0.5 z-10 overflow-hidden rounded-[4px] border-0 text-white shadow-none",
        editable && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50 grayscale",
        resizing && "z-50 ring-2 ring-primary ring-offset-1",
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
        className={cn(
          "flex h-full relative min-h-0",
          isCompact ? "flex-col gap-0 px-1.5 py-1" : "flex-col p-2",
        )}
      >
        <span
          className={cn(
            "truncate font-normal leading-tight",
            isCompact ? "text-[10px]" : "text-[11px]",
          )}
        >
          {event.title}
        </span>

        <div
          className={cn(
            "flex min-w-0 shrink-0 items-center gap-2 text-[9px] font-light tabular-nums opacity-80",
            isCompact ? "" : "mt-auto",
          )}
        >
          <div className="flex items-center gap-1 min-w-0">
            {!isNarrow && !isCompact && (
              <Clock className="h-2.5 w-2.5 shrink-0" />
            )}
            <span className="truncate">
              {event.is_all_day ? "Dia inteiro" : format(start, "HH:mm")}
              {!event.is_all_day &&
                !isCompact &&
                ` - ${format(tempHeight !== null ? addMinutes(start, Math.round(tempHeight / (56 / 60))) : end, "HH:mm")}`}
            </span>
          </div>
          {!isCompact && !isNarrow && event.lead && (
            <div className="flex items-center gap-1 max-w-[80px] min-w-0">
              <User className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{event.lead.name}</span>
            </div>
          )}
        </div>

        {/* Resize handle */}
        {editable && resizable && (
          <div
            className="absolute bottom-0 left-0 right-0 flex h-1.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity hover:bg-current/20 active:bg-current/40 group-hover:opacity-100"
            onMouseDown={handleResizeMouseDown}
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
}: {
  id: string;
  onQuickCreate?: () => void;
  className?: string;
  children?: React.ReactNode;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: id,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        isOver && "bg-primary/[0.05] ring-2 ring-primary/20 ring-inset z-0",
      )}
      onClick={onQuickCreate}
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
  onQuickCreate?: (date: Date) => void;
  showThirtyMinLines?: boolean;
  canManageEvents?: boolean;
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
}: CalendarViewProps) {
  const isEventEditable = useCallback(
    (event: ScheduleEvent) =>
      canManageEvents && !event.is_masked && event.status !== "completed",
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
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    if (viewMode !== "day" && viewMode !== "week") return;

    let intervalId: number | undefined;
    const updateCurrentTime = () => setCurrentTime(new Date());

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
  }, [viewMode]);

  const currentTimeTop = currentTime
    ? ((currentTime.getHours() * 60 +
        currentTime.getMinutes() +
        currentTime.getSeconds() / 60) *
        56) /
      60
    : null;

  const handleDragStart = (event: DragStartEvent) => {
    if (!canManageEvents) return;
    setActiveEvent(event.active.data.current as ScheduleEvent);
  };

  const calculateEventLayouts = useCallback(
    (daySegments: ScheduleEventDaySegment<ScheduleEvent>[]) => {
      if (daySegments.length === 0) return [];

      // Sort events by start time, then duration
      const sorted = [...daySegments].sort((a, b) => {
        const startA = a.start.getTime();
        const startB = b.start.getTime();
        if (startA !== startB) return startA - startB;

        const durA = a.end.getTime() - startA;
        const durB = b.end.getTime() - startB;
        return durB - durA;
      });

      const layouts: {
        segment: ScheduleEventDaySegment<ScheduleEvent>;
        column: number;
        totalColumns: number;
      }[] = [];
      let currentCluster: ScheduleEventDaySegment<ScheduleEvent>[] = [];
      let clusterMaxEnd = 0;

      const processCluster = (
        cluster: ScheduleEventDaySegment<ScheduleEvent>[],
      ) => {
        if (cluster.length === 0) return;

        const columns: ScheduleEventDaySegment<ScheduleEvent>[][] = [];
        cluster.forEach((segment) => {
          let placed = false;
          const eventStart = segment.start.getTime();

          for (let i = 0; i < columns.length; i++) {
            const lastEventInCol = columns[i][columns[i].length - 1];
            if (eventStart >= lastEventInCol.end.getTime()) {
              columns[i].push(segment);
              layouts.push({ segment, column: i, totalColumns: 0 });
              placed = true;
              break;
            }
          }

          if (!placed) {
            columns.push([segment]);
            layouts.push({
              segment,
              column: columns.length - 1,
              totalColumns: 0,
            });
          }
        });

        // Update totalColumns for all events in this cluster
        cluster.forEach((segment) => {
          const layout = layouts.find(
            (item) => item.segment.key === segment.key,
          );
          if (layout) layout.totalColumns = columns.length;
        });
      };

      sorted.forEach((segment) => {
        const eventStart = segment.start.getTime();

        if (eventStart >= clusterMaxEnd && currentCluster.length > 0) {
          processCluster(currentCluster);
          currentCluster = [];
          clusterMaxEnd = 0;
        }

        currentCluster.push(segment);
        const eventEnd = segment.end.getTime();
        if (eventEnd > clusterMaxEnd) clusterMaxEnd = eventEnd;
      });

      processCluster(currentCluster);
      return layouts;
    },
    [],
  );

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveEvent(null);
    const { active, over } = event;

    if (canManageEvents && over && active.id !== over.id) {
      const scheduleEvent = active.data.current as ScheduleEvent;
      const [dateStr, hourStr] = (over.id as string).split("|");

      const newStart = parseISO(`${dateStr}T${hourStr}:00`);
      const originalStart = parseISO(scheduleEvent.start_time);
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
      splitScheduleEventByDay(event).forEach((segment) => {
        if (!map[segment.dateKey]) map[segment.dateKey] = [];
        map[segment.dateKey].push(segment);
      });
    });
    return map;
  }, [events]);

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
        <div className="grid grid-cols-7 border-b border-[var(--schedule-grid-border)] bg-[var(--app-surface-solid)]">
          {weekDays.map((day) => (
            <div
              key={day}
              className="py-2.5 text-center text-[10px] font-light text-[var(--app-text-tertiary)]"
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
            const isDayToday = isToday(day);

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
                    return (
                      <div
                        key={segment.key}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditEvent?.(event);
                        }}
                        className={cn(
                          "flex items-center gap-1.5 truncate rounded-[4px] border-0 px-2 py-1 text-[9px] font-light text-white shadow-none transition-opacity hover:opacity-90",
                        )}
                        style={{ backgroundColor: userColor.background }}
                      >
                        <Icon className="h-2.5 w-2.5 flex-shrink-0 opacity-80" />
                        <span className="truncate tracking-tight">
                          {event.title}
                        </span>
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
                            return (
                              <div
                                key={segment.key}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditEvent?.(event);
                                }}
                                className={cn(
                                  "flex cursor-pointer items-center gap-2 truncate rounded-[4px] border-0 px-2 py-1.5 text-[10px] font-light text-white shadow-none transition-opacity hover:opacity-90",
                                )}
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
                                      : format(segment.start, "HH:mm")}
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
    const hours = eachHourOfInterval({
      start: startOfDay(pivotDate),
      end: endOfDay(pivotDate),
    });

    const daySegments = eventsByDate[format(pivotDate, "yyyy-MM-dd")] || [];

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
                  key={hour.toString()}
                  className="flex h-14 items-center justify-center border-b border-[var(--schedule-grid-border)]"
                >
                  <span className="text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]">
                    {format(hour, "HH:mm")}
                  </span>
                </div>
              ))}
            </div>

            {currentTime &&
              currentTimeTop !== null &&
              isSameDay(pivotDate, currentTime) && (
                <CurrentTimeIndicator
                  top={currentTimeTop}
                  className="left-16 right-0"
                />
              )}

            {/* Grid content */}
            <div className="flex-1 relative">
              {hours.map((hour) => {
                const hourStr = format(hour, "HH");
                return (
                  <div
                    key={hour.toString()}
                    className="relative h-14 w-full border-b border-[var(--schedule-grid-border)]"
                  >
                    <DroppableSlot
                      id={`${format(pivotDate, "yyyy-MM-dd")}|${hourStr}:00`}
                      className={cn(
                        "h-7 w-full cursor-pointer hover:bg-primary/[0.02] transition-colors",
                        showThirtyMinLines &&
                          "border-b border-[var(--schedule-grid-border)]",
                      )}
                      onQuickCreate={() => {
                        const clickDate = new Date(pivotDate);
                        clickDate.setHours(hour.getHours(), 0, 0, 0);
                        onQuickCreate?.(clickDate);
                      }}
                    />
                    <DroppableSlot
                      id={`${format(pivotDate, "yyyy-MM-dd")}|${hourStr}:30`}
                      className="h-7 w-full cursor-pointer hover:bg-primary/[0.02] transition-colors"
                      onQuickCreate={() => {
                        const clickDate = new Date(pivotDate);
                        clickDate.setHours(hour.getHours(), 30, 0, 0);
                        onQuickCreate?.(clickDate);
                      }}
                    />
                  </div>
                );
              })}

              {/* Events */}
              {calculateEventLayouts(daySegments).map(
                ({ segment, column, totalColumns }) => {
                  const { event, start, end } = segment;
                  const top = event.is_all_day
                    ? 0
                    : (start.getHours() * 60 + start.getMinutes()) * (56 / 60);
                  const duration = event.is_all_day
                    ? 24 * 60
                    : Math.max(
                        (end.getTime() - start.getTime()) / (1000 * 60),
                        15,
                      );
                  const height = duration * (56 / 60);

                  const width = 100 / totalColumns;
                  const left = column * width;

                  return (
                    <ActivityCard
                      key={segment.key}
                      event={event}
                      displayStart={start}
                      displayEnd={end}
                      dragId={segment.key}
                      onEditEvent={onEditEvent}
                      onEventUpdate={onEventUpdate}
                      editable={isEventEditable(event)}
                      resizable={segment.isLast}
                      style={{
                        top: `${top}px`,
                        height: `${height}px`,
                        minHeight: "28px",
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
    const hours = eachHourOfInterval({
      start: startOfDay(new Date()),
      end: endOfDay(new Date()),
    });

    return (
      <DndContext
        sensors={sensors}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <ScrollArea className="h-full border-0 bg-transparent">
          <div className="relative flex flex-col min-w-[1000px] min-h-full">
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b border-[var(--schedule-grid-border)] bg-[var(--app-surface-solid)]">
              <div className="w-16 flex-shrink-0 border-r border-[var(--schedule-grid-border)] bg-[var(--app-surface-soft)]" />
              {weekDays.map((day) => (
                <div
                  key={day.toString()}
                  className="flex flex-1 items-center justify-center border-r border-[var(--schedule-grid-border)] py-2 last:border-r-0"
                >
                  <span
                    className={cn(
                      "inline-flex h-7 items-center justify-center gap-1 rounded-[6px] px-2.5 text-[10px] font-light transition-colors",
                      isToday(day)
                        ? "bg-primary/50 text-white"
                        : "bg-[var(--app-surface-soft)] text-[var(--app-text-secondary)]",
                    )}
                  >
                    <span className="capitalize">
                      {format(day, "EEEE", { locale: ptBR })}
                    </span>
                    <span aria-hidden="true" className="opacity-60">
                      /
                    </span>
                    <span className="text-[11px]">{format(day, "d")}</span>
                  </span>
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="flex relative flex-1">
              {/* Time axis */}
              <div className="w-16 flex-shrink-0 border-r border-[var(--schedule-grid-border)] bg-[var(--app-surface-soft)]">
                {hours.map((hour) => (
                  <div
                    key={hour.toString()}
                    className="flex h-14 items-center justify-center border-b border-[var(--schedule-grid-border)]"
                  >
                    <span className="text-[10px] font-light tabular-nums text-[var(--app-text-tertiary)]">
                      {format(hour, "HH:mm")}
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
                    const hourStr = format(hour, "HH");
                    return (
                      <div
                        key={hour.toString()}
                        className="relative h-14 w-full border-b border-[var(--schedule-grid-border)]"
                      >
                        <DroppableSlot
                          id={`${format(day, "yyyy-MM-dd")}|${hourStr}:00`}
                          className={cn(
                            "h-7 w-full cursor-pointer hover:bg-primary/[0.01] transition-colors",
                            showThirtyMinLines &&
                              "border-b border-[var(--schedule-grid-border)]",
                          )}
                          onQuickCreate={() => {
                            const clickDate = new Date(day);
                            clickDate.setHours(hour.getHours(), 0, 0, 0);
                            onQuickCreate?.(clickDate);
                          }}
                        />
                        <DroppableSlot
                          id={`${format(day, "yyyy-MM-dd")}|${hourStr}:30`}
                          className="h-7 w-full cursor-pointer hover:bg-primary/[0.01] transition-colors"
                          onQuickCreate={() => {
                            const clickDate = new Date(day);
                            clickDate.setHours(hour.getHours(), 30, 0, 0);
                            onQuickCreate?.(clickDate);
                          }}
                        />
                      </div>
                    );
                  })}

                  {currentTime &&
                    currentTimeTop !== null &&
                    isSameDay(day, currentTime) && (
                      <CurrentTimeIndicator
                        top={currentTimeTop}
                        className="left-0 right-0"
                      />
                    )}

                  {/* Events for this day */}
                  {calculateEventLayouts(
                    eventsByDate[format(day, "yyyy-MM-dd")] || [],
                  ).map(({ segment, column, totalColumns }) => {
                    const { event, start, end } = segment;
                    const top = event.is_all_day
                      ? 0
                      : (start.getHours() * 60 + start.getMinutes()) *
                        (56 / 60);
                    const duration = event.is_all_day
                      ? 24 * 60
                      : Math.max(
                          (end.getTime() - start.getTime()) / (1000 * 60),
                          15,
                        );
                    const height = duration * (56 / 60);

                    const width = 100 / totalColumns;
                    const left = column * width;

                    return (
                      <ActivityCard
                        key={segment.key}
                        event={event}
                        displayStart={start}
                        displayEnd={end}
                        dragId={segment.key}
                        onEditEvent={onEditEvent}
                        onEventUpdate={onEventUpdate}
                        editable={isEventEditable(event)}
                        resizable={segment.isLast}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          minHeight: "28px",
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
                  const isDayToday = isToday(day);

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
