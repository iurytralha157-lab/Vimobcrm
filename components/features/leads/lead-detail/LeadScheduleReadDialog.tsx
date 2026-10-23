import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useScheduleCapabilities, type ScheduleEvent } from '@/hooks/use-schedule-events';
import { getScheduleOutcomeLabel } from '@/lib/schedule-outcome';
import { getScheduleDisplayLifecycle, getScheduleDisplayLifecycleLabel, getScheduleDisplayTitle } from '@/components/features/schedule/schedule-event-presentation';
import { getConfirmedScheduleTimeZone, ScheduleTimeZoneStatus } from '@/components/features/schedule/ScheduleTimeZoneStatus';

export function LeadScheduleReadDialog({ event, onClose }: { event: ScheduleEvent; onClose: () => void }) {
  const capabilities = useScheduleCapabilities();
  const timeZone = getConfirmedScheduleTimeZone(capabilities);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const formatDate = (value: string) => {
    const date = new Date(value);
    return timeZone && Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { timeZone }) : 'Data indisponível';
  };
  const status = timeZone ? getScheduleDisplayLifecycle(event, timeZone, now) : null;
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto rounded-[8px] bg-[var(--app-surface-solid)] text-sm">
        <DialogHeader>
          <DialogTitle>{getScheduleDisplayTitle(event)}</DialogTitle>
          <DialogDescription>Consulta do compromisso</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {timeZone ? <>
            <p>{formatDate(event.start_time)} — {formatDate(event.end_time)}</p>
            {event.is_all_day && <p>Dia todo</p>}
            {status && <p>{getScheduleDisplayLifecycleLabel(status)}</p>}
          </> : <ScheduleTimeZoneStatus
            failed={capabilities.isError || capabilities.isSuccess}
            fetching={capabilities.isFetching}
            retry={() => void capabilities.refetch()}
          />}
          {!event.is_masked && <>
            {event.description && <p className="whitespace-pre-wrap">{event.description}</p>}
            {event.location && <p>Local: {event.location}</p>}
            {event.user?.name && <p>Responsável: {event.user.name}</p>}
            {event.outcome && <p>Resultado: {getScheduleOutcomeLabel(event.outcome)}</p>}
            {event.outcome_notes && <p className="whitespace-pre-wrap">{event.outcome_notes}</p>}
          </>}
        </div>
      </DialogContent>
    </Dialog>
  );
}
