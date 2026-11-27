import { useEffect, useState } from 'react';
import type { Locale } from 'date-fns';
import { Calendar } from 'lucide-react';
import type { ScheduleEvent } from '@/hooks/use-schedule-events';
import { isAttendanceScheduleType } from '@/lib/schedule-outcome';
import { cn } from '@/lib/utils';
import { describeScheduleCountdown, pickNextScheduleEvent } from './next-schedule';
import { formatDateSafely } from './utils';

const typeLabels: Record<string, string> = {
  call: 'Ligação', email: 'E-mail', meeting: 'Reunião', task: 'Tarefa', message: 'Mensagem', visit: 'Visita',
};

type NextScheduleHighlightProps = {
  events: ScheduleEvent[];
  locale: Locale;
  manageable: boolean;
  mobile: boolean;
  onView: (event: ScheduleEvent) => void;
  onComplete: (event: ScheduleEvent) => void;
  onReschedule: (event: ScheduleEvent) => void;
};

/** The next open appointment with a live countdown; red one hour before and while overdue. */
export function NextScheduleHighlight({ events, locale, manageable, mobile, onView, onComplete, onReschedule }: NextScheduleHighlightProps) {
  const next = pickNextScheduleEvent(events);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!next) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [next]);
  if (!next || next.is_masked) return null;

  const countdown = describeScheduleCountdown(next.start_time, now);
  const when = formatDateSafely(next.start_time, next.is_all_day ? "dd 'de' MMM" : "dd 'de' MMM, HH:mm", locale, '');
  const canResolve = manageable && isAttendanceScheduleType(next.event_type);
  const button = cn('rounded-[6px] px-3 text-xs font-light transition-colors', mobile ? 'h-10' : 'h-8');

  return (
    <div data-next-schedule className={cn('mt-2 rounded-[6px] bg-[var(--app-surface-solid)] p-3', countdown.alert && 'ring-1 ring-red-500/40')}>
      <div className="flex items-start gap-2.5">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] text-white', countdown.alert ? 'bg-red-600' : 'bg-primary/50')}>
          <Calendar strokeWidth={1.5} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-normal">{typeLabels[next.event_type || ''] || 'Compromisso'} · {next.title}</p>
          <p className="text-xs font-light text-[var(--app-text-tertiary)]">
            {when}
            {' · '}
            <span role="timer" className={countdown.alert ? 'text-red-600 dark:text-red-400' : undefined}>{countdown.label}</span>
          </p>
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => onView(next)} className={cn(button, 'bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]')}>Ver</button>
        {canResolve && (
          <>
            <button type="button" onClick={() => onReschedule(next)} className={cn(button, 'bg-[var(--app-surface-soft)] hover:bg-[var(--app-surface-hover)]')}>Remarcar</button>
            <button type="button" onClick={() => onComplete(next)} className={cn(button, 'bg-primary text-primary-foreground hover:bg-primary/90')}>Concluir</button>
          </>
        )}
      </div>
    </div>
  );
}
