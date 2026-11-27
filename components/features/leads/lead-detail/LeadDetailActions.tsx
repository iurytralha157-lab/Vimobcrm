import type { ComponentProps } from 'react';
import type { Locale } from 'date-fns';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { LeadCadencePanel } from '@/components/features/leads/LeadCadencePanel';
import { CompactScheduleEventsList } from '@/components/features/leads/lead-detail/CompactScheduleEventsList';
import type { ScheduleEvent } from '@/hooks/use-schedule-events';
import { cn } from '@/lib/utils';

type LeadDetailActionsProps = {
  mobile: boolean;
  /** Desktop card: next cadence action and agenda side by side, feedback below. */
  split?: boolean;
  schedule: {
    visible: boolean;
    manageable: boolean;
    events: ScheduleEvent[];
    summary: string;
    locale: Locale;
    error: boolean;
    pending: boolean;
    hasNextPage: boolean;
    fetchingNextPage: boolean;
    onRefetch: () => void;
    onFetchNextPage: () => void;
    onEditEvent: (event: ScheduleEvent) => void;
    onSchedule: () => void;
  };
  cadence: ComponentProps<typeof LeadCadencePanel>;
  feedback: {
    value: string;
    canProgress: boolean;
    pending: boolean;
    onChange: (value: string) => void;
    onSave: () => void;
  };
};

export function LeadDetailActions({ mobile, split = false, schedule, cadence, feedback }: LeadDetailActionsProps) {
  const actionHeight = mobile ? 'h-10' : 'h-8';
  // The shared primary-action rule fixes height at 2rem; keep mobile hit areas at 40px.
  const primaryActionStyle = mobile ? { height: '2.5rem' } : undefined;
  const scheduleCard = schedule.visible && (
    <section data-tour={mobile ? undefined : 'lead-detail-agenda'} className="lead-agenda-card rounded-[8px] bg-[var(--app-surface-soft)] p-3">
      <div className="flex items-center justify-between">
        <div className="lead-agenda-summary min-w-0">
          <h3 className="text-[12px] font-normal">Agenda</h3>
          <p className="text-[10px] text-[var(--app-text-tertiary)]">{schedule.summary}</p>
        </div>
        <Button
          size="sm"
          disabled={!schedule.manageable}
          className={cn('lead-detail-primary-action lead-agenda-action shrink-0 rounded-[6px] border-0 bg-primary/50 px-2.5 text-primary-foreground shadow-none hover:bg-primary hover:text-primary-foreground', actionHeight)}
          style={primaryActionStyle}
          onClick={schedule.onSchedule}
        >
          <Calendar className="h-3.5 w-3.5" />
          Agendar
        </Button>
      </div>
      {schedule.error && (
        <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[6px] bg-[var(--app-surface-solid)] px-2.5 py-2 text-[11px] text-[var(--app-text-secondary)]">
          <span>{schedule.events.length > 0 ? 'Não foi possível atualizar a agenda.' : 'Não foi possível carregar a agenda.'}</span>
          <Button type="button" variant="ghost" size="sm" className={cn('rounded-[5px] px-2 text-[11px]', mobile ? 'h-10' : 'h-7')} onClick={schedule.onRefetch}>
            Tentar novamente
          </Button>
        </div>
      )}
      {schedule.pending && schedule.events.length === 0 ? (
        <p role="status" className="mt-2 text-[11px] text-[var(--app-text-tertiary)]">Carregando compromissos...</p>
      ) : (schedule.events.length > 0 || !schedule.error) && (
        <CompactScheduleEventsList events={schedule.events} locale={schedule.locale} onEditEvent={schedule.onEditEvent} />
      )}
      {schedule.hasNextPage && (
        <Button type="button" variant="ghost" className="mt-2 h-9 text-xs" disabled={schedule.fetchingNextPage} onClick={schedule.onFetchNextPage}>
          {schedule.fetchingNextPage ? 'Carregando...' : 'Ver mais compromissos'}
        </Button>
      )}
    </section>
  );
  return (
    <>
      {split ? (
        <div className={cn('grid gap-3', schedule.visible && 'grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]')}>
          <div className="min-w-0"><LeadCadencePanel {...cadence} /></div>
          {scheduleCard}
        </div>
      ) : (
        <>
          {scheduleCard}
          <LeadCadencePanel {...cadence} />
        </>
      )}

      <section data-tour={mobile ? undefined : 'lead-detail-feedback'} className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
        <Textarea
          aria-label="Feedback do lead"
          placeholder="Registre o feedback sobre atendimento, perfil ou próximos passos..."
          value={feedback.value}
          onChange={(event) => feedback.onChange(event.target.value)}
          disabled={!feedback.canProgress}
          rows={2}
          className="h-16 min-h-16 resize-none rounded-[6px] border-0 bg-[var(--app-surface-solid)] px-2.5 text-xs font-light leading-4"
        />
        <div className="mt-2 flex justify-end">
          <Button
            className={cn('lead-detail-primary-action rounded-[6px] px-3', actionHeight)}
            style={primaryActionStyle}
            disabled={!feedback.canProgress || !feedback.value.trim() || feedback.pending}
            onClick={feedback.onSave}
          >
            Registrar feedback
          </Button>
        </div>
      </section>
    </>
  );
}
