import { Crosshair } from 'lucide-react';
import { ptBR } from 'date-fns/locale';
import type { UnifiedHistoryEvent } from '@/hooks/use-lead-history';
import { CampaignTrackingDetailsBody } from './CampaignTrackingHover';
import { getLeadSourceLabel, hasLeadTrackingData, trackingSourceLabel } from './tracking';
import type { CampaignTrackingDetails } from './types';
import { formatDateSafely } from './utils';
import { formAnswersFromHistory } from './origin-answers';

type LeadOriginPanelProps = {
  leadFirstName: string;
  source: string;
  createdAt: string | null | undefined;
  tracking: CampaignTrackingDetails | null;
  trackingLoading: boolean;
  trackingError: boolean;
  onRetryTracking: () => void;
  historyEvents: UnifiedHistoryEvent[] | undefined;
  historyComplete: boolean;
};

export function LeadOriginPanel({
  leadFirstName, source, createdAt, tracking, trackingLoading, trackingError, onRetryTracking, historyEvents, historyComplete,
}: LeadOriginPanelProps) {
  const sourceLabel = trackingSourceLabel(tracking?.platform) || getLeadSourceLabel(source);
  const capturedAt = tracking?.created_at || createdAt;
  const answers = formAnswersFromHistory(historyEvents);
  const hasTracking = hasLeadTrackingData(tracking);

  return (
    <div className="space-y-3">
      <section className="flex items-start gap-3 rounded-[8px] bg-[var(--app-surface-soft)] p-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-primary/50 text-white">
          <Crosshair strokeWidth={1.5} className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-[13px] font-normal">{leadFirstName} entrou por {sourceLabel}</p>
          {capturedAt && (
            <p className="mt-0.5 text-xs font-light text-[var(--app-text-tertiary)]">
              Capturado em {formatDateSafely(capturedAt, "dd/MM/yyyy 'às' HH:mm", ptBR, capturedAt)}
            </p>
          )}
          {!hasTracking && !trackingLoading && !trackingError && (
            <p className="mt-2 text-xs font-light text-[var(--app-text-secondary)]">
              Sem anúncio, formulário ou UTMs ligados a este lead. Quando o lead chega por um anúncio, aqui aparecem a campanha, o criativo e as respostas do formulário.
            </p>
          )}
        </div>
      </section>

      {(hasTracking || trackingLoading || trackingError) && (
        <section className="rounded-[8px] bg-[var(--app-surface-soft)]">
          <h3 className="px-3 pt-3 text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">Campanha</h3>
          <CampaignTrackingDetailsBody leadMeta={tracking} loading={trackingLoading} error={trackingError} onRetry={onRetryTracking} />
        </section>
      )}

      <section className="rounded-[8px] bg-[var(--app-surface-soft)] p-3">
        <h3 className="text-[11px] font-normal uppercase tracking-[0.06em] text-[var(--app-text-tertiary)]">Respostas do formulário</h3>
        {answers.length > 0 ? (
          <dl className="mt-2 space-y-2">
            {answers.map((item) => (
              <div key={item.id} className="rounded-[6px] bg-[var(--app-surface-solid)] px-3 py-2">
                <dt className="text-xs font-light text-[var(--app-text-tertiary)]">{item.question}</dt>
                <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs font-normal">{item.answer}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="mt-2 text-xs font-light text-[var(--app-text-secondary)]">
            {historyComplete ? 'Nenhuma resposta de formulário registrada.' : 'O histórico ainda está parcial. Respostas antigas aparecem no fim do histórico, em Atividades.'}
          </p>
        )}
      </section>
    </div>
  );
}
