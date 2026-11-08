import { CircleAlert } from 'lucide-react'

import { EmptyNote, Panel } from '@/components/features/marketing/marketing-ui'
import { formatPropertyDate } from '@/lib/property-display-utils'
import type { PropertyChannelPublication, PropertyPublicationJob } from '@/lib/validation'

import { PropertyChip, type PropertyChipTone } from '../property-ui'

const ACTION_LABELS: Record<PropertyPublicationJob['action'], string> = {
  publish: 'Publicação solicitada',
  update: 'Atualização solicitada',
  unpublish: 'Remoção solicitada',
  revalidate: 'Revalidação solicitada',
}

const STATUS: Record<PropertyPublicationJob['status'], { label: string; tone: PropertyChipTone }> = {
  pending: { label: 'Na fila', tone: 'neutral' },
  processing: { label: 'Processando', tone: 'neutral' },
  retry: { label: 'Nova tentativa agendada', tone: 'warning' },
  succeeded: { label: 'Concluído', tone: 'success' },
  superseded: { label: 'Substituído', tone: 'neutral' },
  dead: { label: 'Falhou', tone: 'danger' },
}

/** Latest sends across every channel, newest first. */
export function PropertyPublicationHistory({ publications }: { publications: PropertyChannelPublication[] }) {
  const rows = publications
    .flatMap((publication) => publication.recent_jobs.map((job) => ({ job, channel: publication.label })))
    .sort((left, right) => right.job.created_at.localeCompare(left.job.created_at))
    .slice(0, 12)

  return (
    <Panel title="Últimos envios">
      {rows.length === 0 ? (
        <EmptyNote>Nenhum processamento registrado.</EmptyNote>
      ) : (
        <ul className="divide-y divide-[var(--app-border)]">
          {rows.map(({ job, channel }) => (
            <li key={job.id} className="grid gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0 sm:grid-cols-[150px_minmax(0,1fr)_minmax(0,1.4fr)_auto] sm:items-center">
              <span className="text-[12px] font-light text-[var(--app-text-secondary)]">
                {formatPropertyDate(job.created_at, true, 'Data não informada')}
              </span>
              <span className="min-w-0 truncate text-[13px] font-light text-[var(--app-text-primary)]">{channel}</span>
              <span className="min-w-0 text-[13px] font-light text-[var(--app-text-primary)]">
                {ACTION_LABELS[job.action]}
                <span className="ml-1 text-[12px] text-[var(--app-text-tertiary)]">
                  {job.attempts === 0 ? '· aguardando' : `· tentativa ${Math.min(job.attempts, job.max_attempts)} de ${job.max_attempts}`}
                  {job.version ? ` · versão ${job.version}` : ''}
                </span>
                {job.next_attempt_at && job.status === 'retry' && (
                  <span className="block text-[12px] text-warning">
                    Próxima tentativa: {formatPropertyDate(job.next_attempt_at, true, 'Data não informada')}
                  </span>
                )}
                {job.last_error?.message && (
                  <span className="mt-0.5 flex items-start gap-1 text-[12px] text-destructive">
                    <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                    {job.last_error.message}
                  </span>
                )}
              </span>
              <PropertyChip tone={STATUS[job.status].tone} className="w-fit">{STATUS[job.status].label}</PropertyChip>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
