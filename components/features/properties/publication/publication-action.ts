import type { PropertyChannelPublication } from '@/lib/validation'

const BUSY_STATES = new Set(['queued', 'publishing', 'pausing', 'unpublishing'])
const ACTIVE_JOB_STATES = new Set(['pending', 'processing', 'retry'])

export function publicationIsBusy(publication: PropertyChannelPublication): boolean {
  return BUSY_STATES.has(publication.observed_state)
    || publication.recent_jobs.some((job) => ACTIVE_JOB_STATES.has(job.status))
}

export function publicationUnavailableReason(publication: PropertyChannelPublication): string {
  const configurationCodes = publication.channel === 'site'
    ? new Set(['site_active', 'site_module'])
    : new Set(['grupo_olx_integration', 'grupo_olx_active', 'grupo_olx_module'])
  const failedConfiguration = publication.checks.find((check) =>
    configurationCodes.has(check.code) && !check.resolved,
  )
  if (failedConfiguration) {
    return failedConfiguration.message || `${failedConfiguration.label} precisa ser configurado.`
  }
  return publication.channel === 'site'
    ? 'O Site está indisponível no acesso desta organização. Confira a configuração e a habilitação do módulo Site.'
    : 'O canal está indisponível para esta organização. Confira a integração e a habilitação do módulo.'
}

export function publicationPublishBlockReason(publication: PropertyChannelPublication): string | null {
  if (publicationIsBusy(publication)) return 'Uma solicitação está em processamento. Acompanhe o estado e atualize a Central.'
  if (!publication.available) return publicationUnavailableReason(publication)
  if (publication.capabilities.can_publish) return null

  const blockingCount = publication.checks.filter((check) =>
    !check.resolved && (check.severity ?? 'error') === 'error',
  ).length
  if (blockingCount > 0 || publication.readiness_state !== 'ready') {
    return blockingCount > 0
      ? `Resolva ${blockingCount} pendência(s) obrigatória(s) acima para liberar a publicação.`
      : 'A prontidão ainda não foi confirmada. Atualize a Central antes de publicar.'
  }
  if (publication.observed_state === 'published' && !publication.is_outdated) {
    return 'A versão atual já está publicada.'
  }
  if (publication.capabilities.can_retry) {
    return 'Use Tentar novamente para retomar o processamento que falhou.'
  }
  return 'A publicação ainda não está liberada. Atualize a Central e confira o estado do canal.'
}
