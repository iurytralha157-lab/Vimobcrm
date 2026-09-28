import type { PropertyChannelPublication } from '@/lib/validation'

type SitePublication = Pick<
  PropertyChannelPublication,
  'id' | 'desired_state' | 'observed_state' | 'published_version'
>

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
    return legacyPublished
      ? { label: 'Publicado no site', canOpenPublicSite: true, tone: 'success' }
      : { label: 'Fora do site', canOpenPublicSite: false, tone: 'neutral' }
  }

  const hasPublishedVersion = publication.published_version != null

  if (publication.desired_state === 'unpublished') {
    if (hasPublishedVersion) {
      return publication.observed_state === 'error'
        ? { label: 'Falha na retirada do site', canOpenPublicSite: false, tone: 'error' }
        : { label: 'Retirada do site em processamento', canOpenPublicSite: false, tone: 'pending' }
    }
    return { label: 'Fora do site', canOpenPublicSite: false, tone: 'neutral' }
  }

  if (publication.desired_state === 'paused') {
    if (publication.observed_state === 'error') {
      return { label: 'Falha ao pausar publicação', canOpenPublicSite: false, tone: 'error' }
    }
    return publication.observed_state === 'paused' || !hasPublishedVersion
      ? { label: 'Publicação pausada', canOpenPublicSite: false, tone: 'neutral' }
      : { label: 'Pausa em processamento', canOpenPublicSite: false, tone: 'pending' }
  }

  if (publication.observed_state === 'published' && hasPublishedVersion) {
    return { label: 'Publicado no site', canOpenPublicSite: true, tone: 'success' }
  }

  if (publication.observed_state === 'error') {
    return hasPublishedVersion
      ? { label: 'Publicado; atualização falhou', canOpenPublicSite: true, tone: 'error' }
      : { label: 'Falha na publicação', canOpenPublicSite: false, tone: 'error' }
  }

  if (hasPublishedVersion) {
    return { label: 'Publicado; atualização em processamento', canOpenPublicSite: true, tone: 'pending' }
  }

  return { label: 'Publicação em processamento', canOpenPublicSite: false, tone: 'pending' }
}
