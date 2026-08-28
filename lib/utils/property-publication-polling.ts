type PropertyPublicationPollingOverview = {
  data: {
    publications: ReadonlyArray<{
      available?: boolean
      channel?: string
      id?: string | null
      observed_state: string
      published_version?: number | null
      recent_jobs: ReadonlyArray<{ status: string }>
    }>
  }
}

const TRANSIENT_OBSERVED_STATES = new Set([
  'queued',
  'publishing',
  'pausing',
  'unpublishing',
])
const TRANSIENT_JOB_STATES = new Set(['pending', 'processing', 'retry'])

export function propertyPublicationNeedsPolling(
  overview?: PropertyPublicationPollingOverview | null,
) {
  return Boolean(overview?.data.publications.some((publication) => (
    TRANSIENT_OBSERVED_STATES.has(publication.observed_state)
    || publication.recent_jobs.some((job) => TRANSIENT_JOB_STATES.has(job.status))
  )))
}

export function propertyPublicationNeedsProviderFeedbackPolling(
  overview?: PropertyPublicationPollingOverview | null,
) {
  return Boolean(overview?.data.publications.some((publication) => (
    publication.channel === 'grupo_olx'
    && publication.available === true
    && Boolean(publication.id)
    && publication.published_version != null
  )))
}

export function propertyPublicationPollingSettled(
  previouslyPolling: boolean,
  currentlyPolling: boolean,
) {
  return previouslyPolling && !currentlyPolling
}
