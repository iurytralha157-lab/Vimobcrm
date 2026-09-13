export const PIPELINE_READ_TIMEOUT_MS = 12_000
export const PIPELINE_REALTIME_REFRESH_INTERVAL_MS = 5_000
export const PIPELINE_REALTIME_RECONCILE_MAX_WAIT_MS = 10_000
export const PIPELINE_QUERY_RETRY_LIMIT = 1
export const BACKEND_REALTIME_RESET_DEBOUNCE_MS = 750
export const BACKEND_REALTIME_RESET_MIN_INTERVAL_MS = 15_000

const RETRYABLE_PIPELINE_ERROR_CODES = new Set([
  'api_timeout',
  'api_unavailable',
  'bad_gateway',
  'gateway_timeout',
  'service_unavailable',
  'upstream_error',
])

const RETRYABLE_PIPELINE_HTTP_STATUSES = new Set([
  0,
  408,
  429,
  500,
  502,
  503,
  504,
  520,
  522,
  524,
])

type PipelineErrorDetails = {
  code?: unknown
  name?: unknown
  status?: unknown
}

function getPipelineErrorDetails(error: unknown): PipelineErrorDetails {
  if (!error || typeof error !== 'object') return {}
  return error as PipelineErrorDetails
}

export function shouldRetryPipelineQuery(failureCount: number, error: unknown) {
  if (failureCount >= PIPELINE_QUERY_RETRY_LIMIT) return false

  const details = getPipelineErrorDetails(error)
  if (details.name === 'AbortError') return false

  const code = typeof details.code === 'string'
    ? details.code.trim().toLowerCase()
    : ''
  if (RETRYABLE_PIPELINE_ERROR_CODES.has(code)) return true

  return typeof details.status === 'number'
    && RETRYABLE_PIPELINE_HTTP_STATUSES.has(details.status)
}

export function getPipelineRealtimeRefreshDelay(
  nowMs: number,
  lastRefreshAtMs: number | null,
  minimumDelayMs = 0,
  reconcileStartedAtMs: number | null = null,
) {
  const safeMinimumDelayMs = Math.max(0, minimumDelayMs)
  const throttleDelayMs = lastRefreshAtMs === null
    ? 0
    : Math.max(0, PIPELINE_REALTIME_REFRESH_INTERVAL_MS - (nowMs - lastRefreshAtMs))
  const requestedDelayMs = Math.max(safeMinimumDelayMs, throttleDelayMs)
  if (reconcileStartedAtMs === null) return requestedDelayMs

  const maximumRemainingMs = Math.max(
    0,
    reconcileStartedAtMs + PIPELINE_REALTIME_RECONCILE_MAX_WAIT_MS - nowMs,
  )
  return Math.min(requestedDelayMs, maximumRemainingMs)
}

export function getBackendRealtimeResetDelay(
  nowMs: number,
  lastResetAtMs: number | null,
) {
  const intervalRemainingMs = lastResetAtMs === null
    ? 0
    : Math.max(0, BACKEND_REALTIME_RESET_MIN_INTERVAL_MS - (nowMs - lastResetAtMs))

  return Math.max(BACKEND_REALTIME_RESET_DEBOUNCE_MS, intervalRemainingMs)
}
