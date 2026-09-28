import type {
  PropertyChannelPublication,
  PropertyPublicationOverview,
  PublishPropertyInput,
} from '@/lib/validation'

type PublicationAPI = {
  getPublications: (
    organizationId: string,
    propertyId: string,
    signal?: AbortSignal,
  ) => Promise<PropertyPublicationOverview>
  publishSite: (
    organizationId: string,
    propertyId: string,
    input: PublishPropertyInput,
    idempotencyKey?: string,
  ) => Promise<PropertyPublicationOverview>
}

export type AutomaticSitePublicationResult =
  | { kind: 'requested' | 'already-published' | 'processing'; reasons: [] }
  | { kind: 'blocked'; reasons: string[]; fixableInForm: boolean }

const pendingStates = new Set(['queued', 'publishing', 'pausing', 'unpublishing'])
const pendingJobs = new Set(['pending', 'processing', 'retry'])
const formCheckCodes = new Set([
  'title', 'type', 'location', 'postal_code', 'description', 'offer',
  'purpose', 'area', 'photo', 'status',
])

function isProcessing(publication: PropertyChannelPublication) {
  return pendingStates.has(publication.observed_state)
    || publication.recent_jobs.some((job) => pendingJobs.has(job.status))
}

function canSupersedeProcessingVersion(publication: PropertyChannelPublication) {
  return publication.observed_state === 'queued'
    || publication.observed_state === 'publishing'
    || (publication.observed_state === 'published'
      && publication.recent_jobs.some((job) => pendingJobs.has(job.status)))
}

export function planAutomaticSitePublication(
  overview: PropertyPublicationOverview,
): AutomaticSitePublicationResult | { kind: 'publish'; publicationUpdatedAt: string | null } {
  const site = overview.data.publications.find((item) => item.channel === 'site')
  if (!site) {
    return { kind: 'blocked', reasons: ['O canal Site não está configurado para este imóvel.'], fixableInForm: false }
  }
  if (!overview.meta.can_manage) {
    return { kind: 'blocked', reasons: ['Seu acesso não permite publicar imóveis neste site.'], fixableInForm: false }
  }

  const blockers = site.checks.filter((check) =>
    !check.resolved && (check.severity ?? 'error') === 'error',
  )
  if (!site.available) {
    const configuration = blockers.filter((check) => check.code === 'site_active' || check.code === 'site_module')
    return {
      kind: 'blocked',
      reasons: (configuration.length ? configuration : blockers).map((check) => check.message || check.label)
        .concat(configuration.length || blockers.length ? [] : ['O Site está indisponível para esta organização.']),
      fixableInForm: false,
    }
  }

  if (site.desired_state === 'published' && isProcessing(site)) {
    if (!canSupersedeProcessingVersion(site)) {
      return { kind: 'blocked', reasons: ['Uma remoção ou pausa está em processamento. Confira a Central antes de publicar novamente.'], fixableInForm: false }
    }
    if (!site.is_outdated) {
      return { kind: 'processing', reasons: [] }
    }
    // The worker supersedes older jobs when the next version is queued.
    // Check fresh readiness below, then request the newer snapshot even while busy.
  } else if (isProcessing(site)) {
    return { kind: 'blocked', reasons: ['Outra solicitação de publicação está em processamento.'], fixableInForm: false }
  }
  if (site.desired_state === 'published' && site.observed_state === 'published'
    && site.published_version !== null
    && site.published_version === site.current_version && !site.is_outdated) {
    return { kind: 'already-published', reasons: [] }
  }
  if (site.readiness_state !== 'ready' || blockers.length > 0) {
    return {
      kind: 'blocked',
      reasons: blockers.map((check) => check.message || check.label)
        .concat(blockers.length ? [] : ['A prontidão para publicação ainda não foi confirmada.']),
      fixableInForm: blockers.some((check) => formCheckCodes.has(check.code)),
    }
  }
  const updatingBusyVersion = site.desired_state === 'published'
    && site.is_outdated && canSupersedeProcessingVersion(site)
  if (!site.capabilities.can_publish && !updatingBusyVersion) {
    return {
      kind: 'blocked',
      reasons: [site.capabilities.can_retry
        ? 'A publicação falhou. Confira o erro na Central e use Tentar novamente.'
        : 'A publicação ainda não foi liberada. Confira a Central de Publicação.'],
      fixableInForm: false,
    }
  }
  if (site.id !== null && !site.updated_at) {
    return {
      kind: 'blocked',
      reasons: ['A revisão da publicação não está disponível. Atualize a Central e tente novamente.'],
      fixableInForm: false,
    }
  }
  return { kind: 'publish', publicationUpdatedAt: site.id === null ? null : site.updated_at ?? null }
}

export async function requestAutomaticSitePublication(
  organizationId: string,
  propertyId: string,
  api?: PublicationAPI,
  idempotencyKey?: string,
): Promise<AutomaticSitePublicationResult> {
  const publicationModule = !api || !idempotencyKey
    ? await import('./property-publications')
    : null
  const publicationApi = api ?? publicationModule!.propertyPublicationsAPI
  const commandKey = idempotencyKey
    ?? publicationModule!.createPropertyPublicationIdempotencyKey('site-auto-publish')
  let overview = await publicationApi.getPublications(organizationId, propertyId)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const plan = planAutomaticSitePublication(overview)
    if (plan.kind !== 'publish') return plan
    try {
      const response = await publicationApi.publishSite(
        organizationId,
        propertyId,
        {
          expected_property_updated_at: overview.data.property_updated_at,
          expected_publication_updated_at: plan.publicationUpdatedAt,
        },
        attempt === 0 ? commandKey : `${commandKey}-conflict-retry`,
      )
      const site = response.data.publications.find((item) => item.channel === 'site')
      if (site?.desired_state === 'published' && site.observed_state === 'published'
        && site.published_version !== null
        && site.published_version === site.current_version
        && !site.is_outdated && !isProcessing(site)) {
        return { kind: 'already-published', reasons: [] }
      }
      return { kind: 'requested', reasons: [] }
    } catch (error) {
      const conflict = typeof error === 'object' && error !== null
        && 'status' in error && error.status === 409
        && 'code' in error && error.code === 'publication_revision_conflict'
      if (!conflict || attempt > 0) throw error
      const refreshed = await publicationApi.getPublications(organizationId, propertyId)
      const refreshedPlan = planAutomaticSitePublication(refreshed)
      if (refreshedPlan.kind !== 'publish') return refreshedPlan
      if (refreshed.data.property_updated_at !== overview.data.property_updated_at) {
        return {
          kind: 'blocked',
          reasons: ['O imóvel foi alterado em outra sessão após seu salvamento. Revise a versão atual antes de publicar.'],
          fixableInForm: false,
        }
      }
      overview = refreshed
    }
  }
  throw new Error('publication_retry_exhausted')
}
