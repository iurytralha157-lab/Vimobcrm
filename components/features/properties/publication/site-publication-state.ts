import type { PropertyChannelPublication } from '@/lib/validation'

export type SitePublication = Pick<
  PropertyChannelPublication,
  'id' | 'desired_state' | 'observed_state' | 'published_version'
> & Partial<Pick<PropertyChannelPublication, 'last_error' | 'legacy_visible' | 'checks'>> & {
  last_error_code?: string | null
  public_visible?: boolean
}

export type SitePublicationState = {
  label: string
  canOpenPublicSite: boolean
  tone: 'success' | 'pending' | 'neutral' | 'error'
}

export function getSitePublicationState(
  publication: SitePublication | null | undefined,
  legacyPublished: boolean,
  overviewAvailable: boolean,
): SitePublicationState {
  if (!overviewAvailable) {
    return { label: 'Verifique a publicação na Central', canOpenPublicSite: false, tone: 'neutral' }
  }

  if (!publication?.id) {
    const liveBlock = liveSitePublicationBlock(publication)
    if (liveBlock) return liveBlock
    return legacyPublished || publication?.legacy_visible === true
      ? { label: 'Publicado pelo fluxo anterior', canOpenPublicSite: true, tone: 'success' }
      : { label: 'Fora do site', canOpenPublicSite: false, tone: 'neutral' }
  }

  const hasPublishedVersion = publication.published_version != null
  const hasVisibleVersion = hasPublishedVersion || legacyPublished || publication.legacy_visible === true
  const hasDeliveryError = Boolean(publication.last_error?.code || publication.last_error_code)

  if (publication.desired_state === 'unpublished') {
    if (hasPublishedVersion || ['queued', 'unpublishing', 'error'].includes(publication.observed_state)) {
      return publication.observed_state === 'error' || hasDeliveryError
        ? { label: 'Falha na retirada do site', canOpenPublicSite: false, tone: 'error' }
        : { label: 'Retirada do site em processamento', canOpenPublicSite: false, tone: 'pending' }
    }
    return { label: 'Fora do site', canOpenPublicSite: false, tone: 'neutral' }
  }

  if (publication.desired_state === 'paused') {
    if (publication.observed_state === 'error') {
      return { label: 'Falha ao pausar publicação', canOpenPublicSite: false, tone: 'error' }
    }
    return publication.observed_state === 'paused'
      || (!hasPublishedVersion && !['queued', 'pausing'].includes(publication.observed_state))
      ? { label: 'Publicação pausada', canOpenPublicSite: false, tone: 'neutral' }
      : { label: 'Pausa em processamento', canOpenPublicSite: false, tone: 'pending' }
  }

  const liveBlock = liveSitePublicationBlock(publication)
  if (liveBlock) return liveBlock
  if (publication.public_visible === false && hasPublishedVersion) {
    return { label: 'Publicidade bloqueada', canOpenPublicSite: false, tone: 'neutral' }
  }

  if (publication.observed_state === 'error' || hasDeliveryError) {
    return hasVisibleVersion
      ? { label: 'Publicado; atualização falhou', canOpenPublicSite: true, tone: 'error' }
      : { label: 'Falha na publicação', canOpenPublicSite: false, tone: 'error' }
  }

  if (publication.observed_state === 'published' && hasPublishedVersion) {
    return { label: 'Publicado no site', canOpenPublicSite: true, tone: 'success' }
  }

  if (hasVisibleVersion) {
    return { label: 'Publicado; atualização em processamento', canOpenPublicSite: true, tone: 'pending' }
  }

  return { label: 'Publicação em processamento', canOpenPublicSite: false, tone: 'pending' }
}

function liveSitePublicationBlock(publication: SitePublication | null | undefined): SitePublicationState | null {
  if (publication?.checks?.some((check) => check.code === 'status' && !check.resolved)) {
    return { label: 'Fora do site pelo status', canOpenPublicSite: false, tone: 'neutral' }
  }
  if (publication?.checks?.some((check) => check.code === 'commercialization' && !check.resolved)) {
    return { label: 'Comercialização não autorizada', canOpenPublicSite: false, tone: 'neutral' }
  }
  if (publication?.checks?.some((check) => check.code === 'site_active' && !check.resolved)) {
    return { label: 'Site inativo', canOpenPublicSite: false, tone: 'neutral' }
  }
  return null
}

export function getSitePublicationCardState(publication: SitePublication, legacyPublished: boolean): SitePublicationState {
  const state = getSitePublicationState(publication, legacyPublished, true)
  const labels: Record<string, string> = {
    'Publicado no site': 'Publicado',
    'Publicado pelo fluxo anterior': 'Publicado',
    'Publicado; atualização em processamento': 'Atualizando publicação',
    'Publicado; atualização falhou': 'Falha na atualização',
    'Publicação em processamento': 'Publicando',
    'Retirada do site em processamento': 'Retirando do site',
    'Fora do site': 'Privado',
  }
  return { ...state, label: labels[state.label] ?? state.label }
}
