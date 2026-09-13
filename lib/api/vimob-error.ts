export const DEFAULT_PUBLIC_ERROR_MESSAGE =
  'Não foi possível concluir esta ação agora. Tente novamente em instantes.'

type ErrorDetails = {
  code?: unknown
  message?: unknown
  status?: unknown
  technicalMessage?: unknown
}

const TECHNICAL_ERROR_CODES = new Set([
  'api_timeout',
  'api_unavailable',
  'bad_gateway',
  'gateway_timeout',
  'internal_error',
  'internal_server_error',
  'service_unavailable',
  'upstream_error',
])

function getErrorDetails(error: unknown): ErrorDetails {
  if (!error || typeof error !== 'object') return {}
  return error as ErrorDetails
}

function getString(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Preserves the legacy UI policy used when every thrown value must be rendered.
 * Unlike getTechnicalErrorMessage, this intentionally stringifies non-Error values
 * and does not trim the result.
 */
export function stringifyErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/** Preserves the legacy UI policy that only trusts native Error instances. */
export function getErrorMessageOrFallback(error: unknown, fallback = 'Erro desconhecido') {
  return error instanceof Error ? error.message : fallback
}

export function getNonEmptyErrorMessageOrFallback(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

/** Preserves the legacy policy that rejects whitespace-only Error messages. */
export function getNonBlankErrorMessageOrFallback(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback
}

/**
 * Preserves the legacy UI policy that trusts Error and string-valued `message`
 * fields, without treating a raw string as an error message.
 */
export function getErrorObjectMessage(error: unknown, fallback = 'Erro desconhecido') {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return fallback
}

export function getOptionalErrorObjectMessage(error: unknown) {
  return getErrorObjectMessage(error, '')
}

type StructuredErrorMessageOptions = {
  fields?: readonly string[]
  includeArrays?: boolean
}

/**
 * Preserves the detailed Supabase-style error policy used by operational forms.
 * Callers opt into extra fields (for example `code`) and array handling explicitly.
 */
export function getStructuredErrorMessage(
  error: unknown,
  options: StructuredErrorMessageOptions = {},
) {
  if (error instanceof Error) return error.message

  const isObject = typeof error === 'object' && error !== null
  if (isObject && (options.includeArrays || !Array.isArray(error))) {
    const payload = error as Record<string, unknown>
    const fields = options.fields ?? ['message', 'details', 'hint']
    const details = fields
      .map((field) => payload[field])
      .filter((value): value is string => typeof value === 'string' && value.length > 0)

    return details.join(' ') || JSON.stringify(error)
  }

  return String(error)
}

function normalizeForComparison(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

export function getTechnicalErrorMessage(error: unknown, fallback = '') {
  if (typeof error === 'string') return error.trim() || fallback

  const details = getErrorDetails(error)
  return getString(details.technicalMessage) || getString(details.message) || fallback
}

export function isTechnicalServiceError(error: unknown) {
  const details = getErrorDetails(error)
  const code = getString(details.code).toLowerCase()
  const status = typeof details.status === 'number' ? details.status : null
  const message = normalizeForComparison(getTechnicalErrorMessage(error))

  if (TECHNICAL_ERROR_CODES.has(code)) return true
  if (status === 0 || (status !== null && status >= 500)) return true
  if (!message) return false

  return [
    /\b(?:a |da |com a )?(?:vimob )?api\b.*\b(?:demor\w*|parou|indisponivel|inacessivel|nao (?:esta )?acessivel|nao respondeu|sem resposta|fora do ar)\b/,
    /\berro ao (?:falar|conectar).*api\b/,
    /\b(?:failed to fetch|fetch failed|network error|networkerror|load failed)\b/,
    /\b(?:service unavailable|bad gateway|gateway timeout|connection refused|econnrefused|err_connection_refused)\b/,
    /\b(?:request|connection|operation).*(?:timed out|timeout)\b/,
    /\b(?:upstream connect error|connection reset|socket hang up)\b/,
    /\b(?:apps\/api|next_public_vimob_api_url)\b/,
    /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0)(?::\d+)?\b/,
  ].some((pattern) => pattern.test(message))
}

export function getPublicErrorMessage(
  error: unknown,
  fallback = DEFAULT_PUBLIC_ERROR_MESSAGE,
) {
  if (isTechnicalServiceError(error)) return fallback
  return getTechnicalErrorMessage(error, fallback)
}

export class VimobAPIError extends Error {
  code: string
  status: number
  requestId?: string
  technicalMessage: string

  constructor(
    technicalMessage: string,
    options: { code: string; status: number; requestId?: string },
  ) {
    super(getPublicErrorMessage({
      code: options.code,
      message: technicalMessage,
      status: options.status,
    }))
    this.name = 'VimobAPIError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
    this.technicalMessage = technicalMessage
  }
}
