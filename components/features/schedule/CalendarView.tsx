import { useState, useMemo, useCallback } from 'react';
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
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { Phone, Mail, Calendar as CalendarIcon, CheckSquare, MessageSquare, Home, Clock, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScheduleEvent, EventType } from '@/hooks/use-schedule-events';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  DndContext,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
  useDroppable,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay
} from '@dnd-kit/core';

const eventTypeIcons: Record<EventType, React.ElementType> = {
  call: Phone,
  email: Mail,
  meeting: CalendarIcon,
  task: CheckSquare,
  message: MessageSquare,
  visit: Home,
};

const userEventColors = [
  { background: '#ff4e1a', border: '#ff7a45' },
  { background: '#2563eb', border: '#60a5fa' },
  { background: '#16a34a', border: '#4ade80' },
  { background: '#9333ea', border: '#c084fc' },
  { background: '#db2777', border: '#f472b6' },
  { background: '#0891b2', border: '#22d3ee' },
  { background: '#ca8a04', border: '#facc15' },
  { background: '#dc2626', border: '#f87171' },
  { background: '#4f46e5', border: '#818cf8' },
  { background: '#0d9488', border: '#2dd4bf' },
];

function getUserEventColor(userId?: string | null) {
  if (!userId) return userEventColors[0];
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) >>> 0;
  }
  return userEventColors[hash % userEventColors.length];
}

interface ActivityCardProps {
  event: ScheduleEvent;
  onEditEvent?: (event: ScheduleEvent) => void;
  onEventUpdate?: (id: string, updates: Partial<ScheduleEvent>) => void;
  isDragging?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

function ActivityCard({ event, onEditEvent, onEventUpdate, isDragging, style, className }: ActivityCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: event.id,
    data: event
  });

  const [resizing, setResizing] = useState(false);
  const [tempHeight, setTempHeight] = useState<number | null>(null);

  const start = parseISO(event.start_time);
  const end = parseISO(event.end_time);
  const duration = event.is_all_day ? 24 * 60 : differenceInMinutes(end, start);
  const userColor = getUserEventColor(event.user_id);
  const styleWidth = typeof style?.width === 'string' ? style.width : undefined;

  // Granular density modes
  const isTiny = duration <= 20;          // 15-20 min slot
  const isCompact = duration < 45;        // 30 min
  const isNarrow = !!styleWidth && styleWidth.includes('calc(') && parseFloat(styleWidth.match(/calc\((\d+(?:\.\d+)?)/)?.[1] || '100') < 50;

  const dragStyle = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: 100,
    opacity: 0.8,
  } : undefined;

  const handleResizeMouseDown = (e: React.MouseEvent) => {
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
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const currentHeight = tempHeight !== null ? tempHeight : (duration * (56 / 60));

  // Tiny mode: single line with just title + time on hover
  if (isTiny) {
    return (
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={(e) => { e.stopPropagation(); onEditEvent?.(event); }}
        title={`${format(start, 'HH:mm')} - ${format(end, 'HH:mm')} · ${event.title}`}
        className={cn(
          "absolute left-0.5 right-0.5 rounded-[4px] border text-white overflow-hidden shadow-sm hover:shadow-md z-10 cursor-grab active:cursor-grabbing group flex items-center px-1.5 gap-1",
          isDragging && "opacity-50 grayscale",
          className
        )}
        style={{ ...style, ...dragStyle, backgroundColor: userColor.background, borderColor: userColor.border, height: `${currentHeight}px` }}
      >
        <span className="text-[9px] font-bold tabular-nums opacity-80 shrink-0">
          {event.is_all_day ? 'Dia inteiro' : format(start, 'HH:mm')}
        </span>
        <span className="text-[10px] font-black truncate tracking-tight leading-none">
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
      title={`${format(start, 'HH:mm')} - ${format(end, 'HH:mm')} · ${event.title}`}
      className={cn(
        "absolute left-0.5 right-0.5 rounded-[4px] border text-white overflow-hidden shadow-sm transition-shadow hover:shadow-md z-10 cursor-grab active:cursor-grabbing group",
        isDragging && "opacity-50 grayscale",
        resizing && "z-50 ring-2 ring-primary ring-offset-1",
        className
      )}
      style={{
        ...style,
        ...dragStyle,
        backgroundColor: userColor.background,
        borderColor: userColor.border,
        height: `${currentHeight}px`
      }}
    >
      <div className={cn(
        "flex h-full relative min-h-0",
        isCompact ? "flex-col gap-0 px-1.5 py-1" : "flex-col p-2"
      )}>
        <span className={cn(
          "font-black truncate tracking-tight leading-tight",
          isCompact ? "text-[10px]" : "text-[11px]"
        )}>
          {event.title}
        </span>

        <div className={cn(
          "flex items-center gap-2 text-[9px] font-bold opacity-80 tabular-nums shrink-0 min-w-0",
          isCompact ? "" : "mt-auto"
        )}>
          <div className="flex items-center gap-1 min-w-0">
            {!isNarrow && !isCompact && <Clock className="h-2.5 w-2.5 shrink-0" />}
            <span className="truncate">
              {event.is_all_day ? 'Dia inteiro' : format(start, 'HH:mm')}
              {!event.is_all_day && !isCompact && ` - ${format(tempHeight !== null ? addMinutes(start, Math.round(tempHeight / (56/60))) : end, 'HH:mm')}`}
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
        <div
          className="absolute bottom-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-white/20 active:bg-white/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          onMouseDown={handleResizeMouseDown}
        >
          <div className="w-4 h-0.5 bg-white/40 rounded-full" />
        </div>
      </div>
    </div>
  );
}

function DroppableSlot({
  id,
  onQuickCreate,
  className,
  children
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
        isOver && "bg-primary/[0.05] ring-2 ring-primary/20 ring-inset z-0"
      )}
      onClick={onQuickCreate}
    >
      {children}
    </div>
  );
}

interface CalendarViewProps {
  events: ScheduleEvent[];
  selectedDate: Date;
  onDateSelect: (date: Date) => void;
  pivotDate: Date;
  onPivotChange: (date: Date) => void;
  viewMode: 'day' | 'week' | 'month' | 'year';
  onEditEvent?: (event: ScheduleEvent) => void;
  onEventUpdate?: (id: string, updates: Partial<ScheduleEvent>) => void;
  onQuickCreate?: (date: Date) => void;
  showThirtyMinLines?: boolean;
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
  showThirtyMinLines = false
}: CalendarViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );
  const [activeEvent, setActiveEvent] = useState<ScheduleEvent | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveEvent(event.active.data.current as ScheduleEvent);
  };

  const calculateEventLayouts = useCallback((dayEvents: ScheduleEvent[]) => {
    if (dayEvents.length === 0) return [];

    // Sort events by start time, then duration
    const sorted = [...dayEvents].sort((a, b) => {
      const startA = new Date(a.start_time).getTime();
      const startB = new Date(b.start_time).getTime();
      if (startA !== startB) return startA - startB;

      const durA = new Date(a.end_time).getTime() - startA;
      const durB = new Date(b.end_time).getTime() - startB;
      return durB - durA;
    });

    const layouts: { event: ScheduleEvent; column: number; totalColumns: number }[] = [];
    let currentCluster: ScheduleEvent[] = [];
    let clusterMaxEnd = 0;

    const processCluster = (cluster: ScheduleEvent[]) => {
      if (cluster.length === 0) return;

      const columns: ScheduleEvent[][] = [];
      cluster.forEach(event => {
        let placed = false;
        const eventStart = new Date(event.start_time).getTime();

        for (let i = 0; i < columns.length; i++) {
          const lastEventInCol = columns[i][columns[i].length - 1];
          if (eventStart >= new Date(lastEventInCol.end_time).getTime()) {
            columns[i].push(event);
            layouts.push({ event, column: i, totalColumns: 0 });
            placed = true;
            break;
          }
        }

        if (!placed) {
          columns.push([event]);
          layouts.push({ event, column: columns.length - 1, totalColumns: 0 });
        }
      });

      // Update totalColumns for all events in this cluster
      cluster.forEach(event => {
        const layout = layouts.find(l => l.event.id === event.id);
        if (layout) layout.totalColumns = columns.length;
      });
    };

    sorted.forEach(event => {
      const eventStart = new Date(event.start_time).getTime();

      if (eventStart >= clusterMaxEnd && currentCluster.length > 0) {
        processCluster(currentCluster);
        currentCluster = [];
        clusterMaxEnd = 0;
      }

      currentCluster.push(event);
      const eventEnd = new Date(event.end_time).getTime();
      if (eventEnd > clusterMaxEnd) clusterMaxEnd = eventEnd;
    });

    processCluster(currentCluster);
    return layouts;
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveEvent(null);
    const { active, over } = event;

    if (over && active.id !== over.id) {
      const scheduleEvent = active.data.current as ScheduleEvent;
      const [dateStr, hourStr] = (over.id as string).split('|');

      const newStart = parseISO(`${dateStr}T${hourStr}:00`);
      const originalStart = parseISO(scheduleEvent.start_time);
      const originalEnd = parseISO(scheduleEvent.end_time);
      const duration = differenceInMinutes(originalEnd, originalStart);

      const newEnd = addMinutes(newStart, duration);

      onEventUpdate?.(scheduleEvent.id, {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString()
      });
    }
  };

  const eventsByDate = useMemo(() => {
    const map: Record<string, ScheduleEvent[]> = {};
    events.forEach(event => {
      const dateKey = format(parseISO(event.start_time), 'yyyy-MM-dd');
      if (!map[dateKey]) map[dateKey] = [];
      map[dateKey].push(event);
    });
    return map;
  }, [events]);

  const renderMonthView = () => {
    const monthStart = startOfMonth(pivotDate);
    const monthEnd = endOfMonth(pivotDate);
    const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
    const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
    const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
    const weekDays = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

    return (
      <div className="flex flex-col h-full overflow-hidden bg-transparent">
        <div className="grid grid-cols-7 border-b border-white/[0.045] bg-[var(--app-surface-solid)]">
          {weekDays.map(day => (
            <div key={day} className="text-center text-[10px] font-black text-muted-foreground/60 py-2.5 uppercase tracking-[0.2em]">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-white/[0.045] flex-1 overflow-hidden">
          {calendarDays.map(day => {
            const dateKey = format(day, 'yyyy-MM-dd');
            const dayEvents = eventsByDate[dateKey] || [];
            const isCurrentMonth = isSameMonth(day, pivotDate);
            const isSelected = isSameDay(day, selectedDate);
            const isDayToday = isToday(day);

            const maxVisibleEvents = 3;
            const visibleEvents = dayEvents.slice(0, maxVisibleEvents);
            const moreCount = dayEvents.length - maxVisibleEvents;

            return (
              <div
                key={dateKey}
                onClick={() => {
                  onDateSelect(day);
                  onQuickCreate?.(day);
                }}
                className={cn(
                  "bg-[var(--app-surface)] min-h-[120px] p-2 transition-all cursor-pointer hover:bg-white/[0.045] group relative flex flex-col",
                  !isCurrentMonth && "bg-muted/5 opacity-30",
                  isSelected && "bg-primary/[0.03] ring-1 ring-primary/10 ring-inset z-10"
                )}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className={cn(
                    "text-[11px] font-black h-6 w-6 flex items-center justify-center rounded-lg transition-all",
                    isDayToday ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20" : "text-muted-foreground group-hover:text-foreground"
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>

                <div className="space-y-1 flex-1">
                  {visibleEvents.map(event => {
                    const Icon = eventTypeIcons[event.event_type as EventType] || CalendarIcon;
                    const userColor = getUserEventColor(event.user_id);
                    return (
                      <div
                        key={event.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          onEditEvent?.(event);
                        }}
                        className={cn(
                          "px-2 py-1 rounded-lg text-[9px] font-bold border truncate flex items-center gap-1.5 text-white shadow-sm transition-all hover:scale-[1.02] active:scale-95",
                        )}
                        style={{ backgroundColor: userColor.background, borderColor: userColor.border }}
                      >
                        <Icon className="h-2.5 w-2.5 flex-shrink-0 opacity-80" />
                        <span className="truncate tracking-tight">{event.title}</span>
                      </div>
                    );
                  })}

                  {moreCount > 0 && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-center py-0.5 text-[9px] font-black text-primary hover:underline bg-primary/5 rounded-md"
                        >
                          +{moreCount} mais
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="app-card w-64 p-2 shadow-2xl z-[100]" align="start">
                        <div className="text-[10px] font-black uppercase text-muted-foreground mb-2 px-1 border-b border-white/[0.045] pb-1">
                          {format(day, "dd 'de' MMMM", { locale: ptBR })}
                        </div>
                        <div className="space-y-1 max-h-[300px] overflow-y-auto pr-1">
                          {dayEvents.map(event => {
                            const Icon = eventTypeIcons[event.event_type as EventType] || CalendarIcon;
                            const userColor = getUserEventColor(event.user_id);
                            return (
                              <div
                                key={event.id}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onEditEvent?.(event);
                                }}
                                className={cn(
                                  "px-2 py-1.5 rounded-xl text-[10px] font-bold border truncate flex items-center gap-2 text-white shadow-sm cursor-pointer transition-all hover:translate-x-1",
                                )}
                                style={{ backgroundColor: userColor.background, borderColor: userColor.border }}
                              >
                                <Icon className="h-3 w-3 flex-shrink-0 opacity-80" />
                                <div className="flex flex-col truncate">
                                  <span className="truncate tracking-tight leading-tight">{event.title}</span>
                                  <span className="text-[8px] opacity-70">
                                    {event.is_all_day ? 'Dia inteiro' : format(new Date(event.start_time), 'HH:mm')}
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
      end: endOfDay(pivotDate)
    });

    const dayEvents = eventsByDate[format(pivotDate, 'yyyy-MM-dd')] || [];

    return (
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <ScrollArea className="h-full border-0 bg-transparent">
          <div className="relative flex min-h-full">
            {/* Time axis */}
            <div className="w-16 border-r border-white/[0.045] flex-shrink-0 bg-white/[0.025]">
              {hours.map(hour => (
                <div key={hour.toString()} className="h-14 border-b border-white/[0.045] flex items-center justify-center">
                  <span className="text-[10px] text-muted-foreground/60 font-black uppercase tracking-tighter tabular-nums">
                    {format(hour, 'HH:mm')}
                  </span>
                </div>
              ))}
            </div>

            {/* Grid content */}
            <div className="flex-1 relative">
              {hours.map(hour => {
                const hourStr = format(hour, 'HH');
                return (
                  <div key={hour.toString()} className="h-14 border-b border-white/[0.045] w-full relative">
                    <DroppableSlot
                      id={`${format(pivotDate, 'yyyy-MM-dd')}|${hourStr}:00`}
                      className={cn(
                        "h-7 w-full cursor-pointer hover:bg-primary/[0.02] transition-colors",
                        showThirtyMinLines && "border-b border-white/[0.025]"
                      )}
                      onQuickCreate={() => {
                        const clickDate = new Date(pivotDate);
                        clickDate.setHours(hour.getHours(), 0, 0, 0);
                        onQuickCreate?.(clickDate);
                      }}
                    />
                    <DroppableSlot
                      id={`${format(pivotDate, 'yyyy-MM-dd')}|${hourStr}:30`}
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
              {calculateEventLayouts(dayEvents).map(({ event, column, totalColumns }) => {
                const start = parseISO(event.start_time);
                const end = parseISO(event.end_time);
                const top = event.is_all_day ? 0 : (start.getHours() * 60 + start.getMinutes()) * (56 / 60);
                const duration = event.is_all_day ? 24 * 60 : Math.max((end.getTime() - start.getTime()) / (1000 * 60), 15);
                const height = duration * (56 / 60);

                const width = 100 / totalColumns;
                const left = column * width;

                return (
                  <ActivityCard
                    key={event.id}
                    event={event}
                    onEditEvent={onEditEvent}
                    onEventUpdate={onEventUpdate}
                    style={{
                      top: `${top}px`,
                      height: `${height}px`,
                      minHeight: '28px',
                      width: `calc(${width}% - 4px)`,
                      left: `calc(${left}% + 2px)`
                    }}
                  />
                );
              })}
            </div>
          </div>
        </ScrollArea>
        <DragOverlay>
          {activeEvent ? (
            <ActivityCard
              event={activeEvent}
              className="w-[150px] relative left-0 right-0"
              style={{ position: 'relative', top: 0, height: '56px' }}
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
      end: endOfDay(new Date())
    });

    return (
      <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <ScrollArea className="h-full border-0 bg-transparent">
          <div className="relative flex flex-col min-w-[1000px] min-h-full">
            {/* Header */}
            <div className="flex border-b border-white/[0.045] sticky top-0 bg-[var(--app-surface-solid)] z-20 shadow-sm">
              <div className="w-16 border-r border-white/[0.045] flex-shrink-0 bg-white/[0.025]" />
              {weekDays.map(day => (
                <div key={day.toString()} className="flex-1 border-r border-white/[0.045] last:border-r-0 py-2.5 text-center">
                  <span className="block text-[10px] text-muted-foreground/60 font-black uppercase tracking-[0.2em] mb-1">
                    {format(day, 'EEE', { locale: ptBR })}
                  </span>
                  <span className={cn(
                    "text-base font-black h-8 w-8 inline-flex items-center justify-center rounded-xl transition-all",
                    isToday(day) ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20 scale-105" : "text-foreground"
                  )}>
                    {format(day, 'd')}
                  </span>
                </div>
              ))}
            </div>

            {/* Grid */}
            <div className="flex relative flex-1">
              {/* Time axis */}
              <div className="w-16 border-r border-white/[0.045] flex-shrink-0 bg-white/[0.025]">
                {hours.map(hour => (
                  <div key={hour.toString()} className="h-14 border-b border-white/[0.045] flex items-center justify-center">
                    <span className="text-[10px] text-muted-foreground/60 font-black uppercase tracking-tighter tabular-nums">
                      {format(hour, 'HH:mm')}
                    </span>
                  </div>
                ))}
              </div>

              {/* Days columns */}
              {weekDays.map(day => (
                <div key={day.toString()} className="flex-1 border-r border-white/[0.045] last:border-r-0 relative">
                  {hours.map(hour => {
                    const hourStr = format(hour, 'HH');
                    return (
                      <div key={hour.toString()} className="h-14 border-b border-white/[0.045] w-full relative">
                        <DroppableSlot
                          id={`${format(day, 'yyyy-MM-dd')}|${hourStr}:00`}
                          className={cn(
                            "h-7 w-full cursor-pointer hover:bg-primary/[0.01] transition-colors",
                            showThirtyMinLines && "border-b border-white/[0.025]"
                          )}
                          onQuickCreate={() => {
                            const clickDate = new Date(day);
                            clickDate.setHours(hour.getHours(), 0, 0, 0);
                            onQuickCreate?.(clickDate);
                          }}
                        />
                        <DroppableSlot
                          id={`${format(day, 'yyyy-MM-dd')}|${hourStr}:30`}
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

                  {/* Events for this day */}
                  {calculateEventLayouts(eventsByDate[format(day, 'yyyy-MM-dd')] || []).map(({ event, column, totalColumns }) => {
                    const start = parseISO(event.start_time);
                    const end = parseISO(event.end_time);
                    const top = event.is_all_day ? 0 : (start.getHours() * 60 + start.getMinutes()) * (56 / 60);
                    const duration = event.is_all_day ? 24 * 60 : Math.max((end.getTime() - start.getTime()) / (1000 * 60), 15);
                    const height = duration * (56 / 60);

                    const width = 100 / totalColumns;
                    const left = column * width;

                    return (
                      <ActivityCard
                        key={event.id}
                        event={event}
                        onEditEvent={onEditEvent}
                        onEventUpdate={onEventUpdate}
                        style={{
                          top: `${top}px`,
                          height: `${height}px`,
                          minHeight: '28px',
                          width: `calc(${width}% - 4px)`,
                          left: `calc(${left}% + 2px)`
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
              style={{ position: 'relative', top: 0, height: '56px' }}
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
      end: endOfYear(pivotDate)
    });

    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 p-4 h-full overflow-y-auto">
        {months.map(month => {
          const monthStart = startOfMonth(month);
          const monthEnd = endOfMonth(month);
          const calendarStart = startOfWeek(monthStart, { weekStartsOn: 0 });
          const calendarEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
          const calendarDays = eachDayOfInterval({ start: calendarStart, end: calendarEnd });
          const weekDaysShort = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

          return (
            <div key={month.toString()} className="app-card space-y-4 p-4">
              <h3 className="font-black text-sm capitalize text-primary tracking-wider text-center">
                {format(month, 'MMMM', { locale: ptBR })}
              </h3>
              <div className="grid grid-cols-7 gap-px">
                {weekDaysShort.map((d, i) => (
                  <div key={i} className="text-[9px] font-black text-muted-foreground text-center pb-2 uppercase opacity-50">
                    {d}
                  </div>
                ))}
                {calendarDays.map(day => {
                  const hasEvents = (eventsByDate[format(day, 'yyyy-MM-dd')] || []).length > 0;
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
                        "text-[10px] h-7 flex items-center justify-center rounded-lg cursor-pointer relative font-bold",
                        !isCurrentMonth && "opacity-10",
                        isDayToday && "bg-primary text-primary-foreground shadow-sm shadow-primary/20",
                        !isDayToday && isCurrentMonth && "hover:bg-accent",
                        hasEvents && !isDayToday && "text-primary ring-1 ring-primary/20"
                      )}
                    >
                      {format(day, 'd')}
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
        {viewMode === 'month' && renderMonthView()}
        {viewMode === 'day' && renderDayView()}
        {viewMode === 'week' && renderWeekView()}
        {viewMode === 'year' && renderYearView()}
      </div>

    </div>

  );
}
