import { CheckCircle2 } from 'lucide-react'

import { formatPropertyDate } from '@/lib/property-display-utils'
import { cn } from '@/lib/utils'
import type { PropertyChannelPublication } from '@/lib/validation'

const DESIRED_STATE_LABELS: Record<PropertyChannelPublication['desired_state'], string> = {
  published: 'Manter publicado',
  paused: 'Manter pausado',
  unpublished: 'Manter fora do ar',
}

function desiredStateLabel(publication: PropertyChannelPublication) {
  if (publication.channel === 'site' && !publication.id && publication.legacy_visible) {
    return 'Complete as pendências e publique para confirmar a atualização.'
  }
  if (publication.channel !== 'grupo_olx') {
    return DESIRED_STATE_LABELS[publication.desired_state]
  }
  if (publication.desired_state === 'published') return 'Manter no XML'
  if (publication.desired_state === 'paused') return 'Manter pausado no XML'
  return 'Manter fora do XML'
}

function versionLabel(publication: PropertyChannelPublication) {
  const isGrupoOLXChannel = publication.channel === 'grupo_olx'

  if (publication.channel === 'site' && !publication.id && publication.legacy_visible) {
    return 'Publicação pelo fluxo anterior'
  }

  if (publication.published_version) {
    return isGrupoOLXChannel
      ? `${publication.published_version} disponível no XML de ${publication.current_version}`
      : `${publication.published_version} publicada de ${publication.current_version}`
  }
  if (publication.current_version) {
    return isGrupoOLXChannel
      ? `${publication.current_version} ainda não disponibilizada no XML`
      : `${publication.current_version} ainda não publicada`
  }
  return 'Nenhuma versão criada'
}

/** Collapsed by default: the card itself lists only what is pending. */
export function PropertyPublicationChannelDetails({ publication }: { publication: PropertyChannelPublication }) {
  const isGrupoOLXChannel = publication.channel === 'grupo_olx'
  const resolvedChecks = publication.checks.filter((check) => check.resolved)
  return (
    <details className="text-[12px] font-light text-[var(--app-text-secondary)]">
      <summary className="cursor-pointer select-none hover:text-[var(--app-text-primary)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30">
        Detalhes do canal
      </summary>
      <div className="mt-2 space-y-2">
        <dl className="grid gap-2">
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">Objetivo</dt>
            <dd>{desiredStateLabel(publication)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">Versão</dt>
            <dd>{versionLabel(publication)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">Última solicitação</dt>
            <dd>{formatPropertyDate(publication.last_requested_at, true, 'Ainda não processado')}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-[var(--app-text-tertiary)]">{isGrupoOLXChannel ? 'Último processamento no Vimob' : 'Último sucesso'}</dt>
            <dd>{formatPropertyDate(publication.last_succeeded_at, true, 'Ainda não processado')}</dd>
          </div>
        </dl>
        {isGrupoOLXChannel && (
          <p className="leading-[18px]">
            Um único feed XML distribui o imóvel para OLX, ZAP e Viva Real conforme o contrato da conta. O estado Disponível no XML confirma a geração pelo Vimob; a importação e a aceitação dependem do portal.
          </p>
        )}
        {isGrupoOLXChannel && publication.provider_feedback && (
          <div className={cn('rounded-[6px] px-2.5 py-2', publication.provider_feedback.severity === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-[var(--app-surface-soft)]')}>
            <p>Último retorno do portal · ListingID {publication.provider_feedback.listing_id}</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {publication.provider_feedback.messages.slice(0, 5).map((message, index) => (
                <li key={`${index}-${message}`}>{message}</li>
              ))}
            </ul>
            {publication.provider_feedback.messages.length > 5 && (
              <p className="mt-1">Mais {publication.provider_feedback.messages.length - 5} apontamento(s) no relatório.</p>
            )}
            <p className="mt-1 leading-[18px]">
              Este retorno é vinculado ao ListingID, não a uma versão específica. Ele não altera a prontidão nem confirma rejeição da versão {publication.published_version ?? publication.current_version}.
            </p>
          </div>
        )}
        {resolvedChecks.length > 0 && (
          <ul className="space-y-1">
            {resolvedChecks.map((check) => (
              <li key={check.code} className="flex items-start gap-1.5">
                <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                <span className="min-w-0">{check.label}{check.message ? `: ${check.message}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  )
}
