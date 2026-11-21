import { useRef, useState } from "react";
import type { CSSProperties } from "react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getScheduleDisplayLifecycle, getScheduleDisplayLifecycleLabel, getScheduleDisplayTitle } from "@/components/features/schedule/schedule-event-presentation";
import type { ScheduleEvent } from "@/hooks/use-schedule-events";
import type { ScheduleEventDaySegment } from "@/lib/schedule-event-segments";
import { formatScheduleZonedTime } from "@/lib/schedule-time-zone";
import { cn } from "@/lib/utils";

interface CalendarEventOverflowProps {
  segments: ScheduleEventDaySegment<ScheduleEvent>[];
  hiddenCount?: number;
  dayLabel: string;
  timeZone: string;
  lifecycleNow: number;
  onEditEvent?: (event: ScheduleEvent) => void;
  style?: CSSProperties;
}

export function CalendarEventOverflow({
  segments,
  hiddenCount = segments.length,
  dayLabel,
  timeZone,
  lifecycleNow,
  onEditEvent,
  style,
}: CalendarEventOverflowProps) {
  const [open, setOpen] = useState(false);
  const selectingEvent = useRef(false);
  const first = segments[0];
  const timeLabel = style && first && !first.event.is_all_day
    ? `, a partir de ${formatScheduleZonedTime(first.start, timeZone)}`
    : "";
  const countLabel = hiddenCount === 1 ? "1 compromisso a mais" : `${hiddenCount} compromissos a mais`;
  const label = `Ver ${countLabel} em ${dayLabel}${timeLabel}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "w-full rounded-[4px] bg-primary/10 text-center text-primary transition-colors hover:bg-primary/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            style ? "absolute z-10 text-[11px] font-semibold tabular-nums" : "py-0.5 text-[9px] font-medium",
          )}
          style={style}
          title={label}
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
        >
          +{hiddenCount}{!style && " mais"}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        aria-label={label}
        className="app-header-popover w-72 max-w-[calc(100vw-24px)] rounded-[8px] p-2"
        onCloseAutoFocus={(event) => {
          if (!selectingEvent.current) return;
          selectingEvent.current = false;
          event.preventDefault();
        }}
      >
        <p className="mb-1 border-b border-[var(--schedule-grid-border)] px-2 pb-2 text-xs font-semibold text-[var(--app-text-primary)]">
          {dayLabel}
        </p>
        <ul className="max-h-[min(20rem,50vh)] space-y-1 overflow-y-auto overscroll-contain" data-calendar-overflow-list>
          {open && segments.map(({ event, key, start, end }) => {
            const title = getScheduleDisplayTitle(event);
            const time = event.is_all_day ? "Dia inteiro" : `${formatScheduleZonedTime(start, timeZone)} – ${formatScheduleZonedTime(end, timeZone)}`;
            const lifecycle = getScheduleDisplayLifecycle(event, timeZone, lifecycleNow);

            return (
              <li key={key}>
                <button
                  type="button"
                  disabled={!onEditEvent}
                  className="block w-full rounded-[6px] px-2 py-1.5 text-left hover:bg-[var(--app-surface-soft)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-primary/60"
                  onClick={(click) => {
                    click.stopPropagation();
                    selectingEvent.current = true;
                    setOpen(false);
                    onEditEvent?.(event);
                  }}
                >
                  <span className="block break-words text-xs font-medium text-[var(--app-text-primary)]">{title}</span>
                  <span className="block text-[11px] text-[var(--app-text-secondary)]">{time} · {getScheduleDisplayLifecycleLabel(lifecycle)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
