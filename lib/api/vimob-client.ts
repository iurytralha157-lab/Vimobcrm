import { supabase } from '@/integrations/supabase/client'

const DEFAULT_API_URL = 'http://localhost:8081'
const LOCAL_DEV_FALLBACK_API_URL = 'http://localhost:8081'
const DEFAULT_REQUEST_TIMEOUT_MS = 12000
const API_ACCESS_TOKEN_CACHE_TTL_MS = 60_000
const READ_RETRY_DELAYS_MS = [500, 1500]
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524])

let accessTokenCache: { token: string; expiresAt: number } | null = null
let accessTokenPromise: Promise<string> | null = null

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  organizationId?: string | null
  signal?: AbortSignal
  timeoutMs?: number
  skipTelemetry?: boolean
  keepalive?: boolean
}

type APIErrorEnvelope = {
  error?: {
    code?: string
    message?: string
    requestId?: string
  }
}

export class VimobAPIError extends Error {
  code: string
  status: number
  requestId?: string

  constructor(message: string, options: { code: string; status: number; requestId?: string }) {
    super(message)
    this.name = 'VimobAPIError'
    this.code = options.code
    this.status = options.status
    this.requestId = options.requestId
  }
}

export function setVimobAPIAccessToken(accessToken?: string | null) {
  if (accessToken) {
    cacheAccessToken(accessToken)
    return
  }

  clearAccessTokenCache()
}

export async function vimobAPIRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const accessToken = await getAccessTokenForAPI()
  let headers = createAuthenticatedHeaders(accessToken, options)
  let result = await makeRequestWithLocalFallback(path, options, headers)

  if (result.response.status === 401) {
    clearAccessTokenCache()
    const refreshedAccessToken = await refreshAccessTokenForAPI()
    if (refreshedAccessToken) {
      headers = createAuthenticatedHeaders(refreshedAccessToken, options)
      result = await makeRequestWithLocalFallback(path, options, headers)
    }
  }

  if (!result.response.ok) {
    const envelope = result.payload as APIErrorEnvelope | null
    const apiError = envelope?.error
    const fallbackMessage = getFallbackErrorMessage(result, result.baseURL)
    const error = new VimobAPIError(apiError?.message || fallbackMessage, {
      code: apiError?.code || 'api_error',
      status: result.response.status,
      requestId: apiError?.requestId,
    })

    if (!options.skipTelemetry) {
      void reportAPIError(path, options, headers, result, error)
    }

    throw error
  }

  return result.payload as T
}

async function getAccessTokenForAPI() {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now()) {
    return accessTokenCache.token
  }

  if (accessTokenPromise) {
    return accessTokenPromise
  }

  accessTokenPromise = resolveAccessTokenForAPI().finally(() => {
    accessTokenPromise = null
  })

  return accessTokenPromise
}

async function resolveAccessTokenForAPI() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (!sessionError && sessionData.session?.access_token) {
    cacheAccessToken(sessionData.session.access_token)
    return sessionData.session.access_token
  }

  const refreshedAccessToken = await refreshAccessTokenForAPI()
  if (refreshedAccessToken) return refreshedAccessToken

  throw new VimobAPIError('Sessao expirada. Faca login novamente.', {
    code: 'missing_session',
    status: 401,
  })
}

async function refreshAccessTokenForAPI() {
  try {
    const { data, error } = await supabase.auth.refreshSession()
    if (error || !data.session?.access_token) {
      clearAccessTokenCache()
      return null
    }
    cacheAccessToken(data.session.access_token)
    return data.session.access_token
  } catch {
    clearAccessTokenCache()
    return null
  }
}

function cacheAccessToken(token: string) {
  accessTokenCache = {
    token,
    expiresAt: Date.now() + API_ACCESS_TOKEN_CACHE_TTL_MS,
  }
}

function clearAccessTokenCache() {
  accessTokenCache = null
}

function createAuthenticatedHeaders(accessToken: string, options: RequestOptions) {
  const headers = new Headers({
    Authorization: `Bearer ${accessToken}`,
    Accept: 'application/json',
  })

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.organizationId) {
    headers.set('X-Organization-ID', options.organizationId)
  }

  return headers
}

export async function vimobPublicAPIRequest<T>(path: string, options: Omit<RequestOptions, 'organizationId'> = {}): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
  })

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  const result = await makeRequestWithLocalFallback(path, options, headers)

  if (!result.response.ok) {
    const envelope = result.payload as APIErrorEnvelope | null
    const apiError = envelope?.error
    throw new VimobAPIError(apiError?.message || getFallbackErrorMessage(result, result.baseURL), {
      code: apiError?.code || 'api_error',
      status: result.response.status,
      requestId: apiError?.requestId,
    })
  }

  return result.payload as T
}

async function makeRequest(path: string, options: RequestOptions, headers: Headers, baseURL: string) {
  const { signal, cleanup } = createRequestSignal(options.signal, options.timeoutMs)

  try {
    const response = await fetch(buildAPIURL(path, options.query, baseURL), {
      method: options.method || 'GET',
      headers,
      body: serializeRequestBody(options.body),
      signal,
      keepalive: options.keepalive,
    })
    const text = await response.text()

    return {
      baseURL,
      response,
      text,
      payload: text ? safeJSONParse(text) : null,
    }
  } finally {
    cleanup()
  }
}

async function makeRequestOrThrow(path: string, options: RequestOptions, headers: Headers, baseURL: string) {
  try {
    return await makeRequest(path, options, headers, baseURL)
  } catch (error) {
    if (isAbortError(error)) {
      throw new VimobAPIError(`A Vimob API demorou para responder em ${baseURL}. Tente novamente em instantes.`, {
        code: 'api_timeout',
        status: 0,
      })
    }

    throw new VimobAPIError(`A Vimob API não está acessível em ${baseURL}. Inicie apps/api ou ajuste NEXT_PUBLIC_VIMOB_API_URL.`, {
      code: 'api_unavailable',
      status: 0,
    })
  }
}

async function makeRequestWithLocalFallback(path: string, options: RequestOptions, headers: Headers) {
  const candidates = getAPIBaseURLCandidates()
  let lastError: VimobAPIError | null = null

  for (const baseURL of candidates) {
    const retryDelays = getRetryDelays(options)

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      try {
        const result = await makeRequestOrThrow(path, options, headers, baseURL)

        if (shouldRetryLocalDevAPI(result, baseURL)) {
          break
        }

        if (shouldRetryTransientHTTPResult(result, options) && attempt < retryDelays.length) {
          await wait(retryDelays[attempt])
          continue
        }

        return result
      } catch (error) {
        if (isRetryableTransientAPIError(error, options) && attempt < retryDelays.length) {
          lastError = error as VimobAPIError
          await wait(retryDelays[attempt])
          continue
        }

        if (isRetryableLocalAPIError(error, baseURL)) {
          lastError = error as VimobAPIError
          break
        }

        throw error
      }
    }
  }

  throw lastError || new VimobAPIError('A Vimob API não está acessível.', {
    code: 'api_unavailable',
    status: 0,
  })
}

function getRetryDelays(options: RequestOptions) {
  const method = options.method || 'GET'
  if (method !== 'GET') return []
  if (options.signal?.aborted) return []
  return READ_RETRY_DELAYS_MS
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shouldRetryTransientHTTPResult(
  result: Awaited<ReturnType<typeof makeRequest>>,
  options: RequestOptions,
) {
  if (getRetryDelays(options).length === 0) return false
  return RETRYABLE_HTTP_STATUSES.has(result.response.status)
}

function isRetryableTransientAPIError(error: unknown, options: RequestOptions) {
  if (getRetryDelays(options).length === 0) return false
  if (!(error instanceof VimobAPIError)) return false
  return error.code === 'api_unavailable' || error.code === 'api_timeout'
}

function createRequestSignal(externalSignal?: AbortSignal, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const abortRequest = () => controller.abort()

  if (externalSignal?.aborted) {
    controller.abort()
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortRequest, { once: true })
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(abortRequest, timeoutMs)
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      externalSignal?.removeEventListener('abort', abortRequest)
    },
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}

export function buildAPIURL(path: string, query?: RequestOptions['query'], baseURL = getAPIBaseURL()) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const url = new URL(`${baseURL}${normalizedPath}`)

  Object.entries(query || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  })

  return url.toString()
}

export function getAPIBaseURL() {
  const configuredBaseURL = (process.env.NEXT_PUBLIC_VIMOB_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
  return getBrowserLocalAPIBaseURL(configuredBaseURL) || configuredBaseURL
}

function getAPIBaseURLCandidates() {
  const primary = getAPIBaseURL()
  const candidates = [primary]

  if (isLocalDevelopmentAPI(primary)) {
    try {
      const parsed = new URL(primary)
      parsed.port = '8081'
      candidates.push(parsed.toString().replace(/\/+$/, ''))
    } catch {
      // Keep the primary URL if parsing fails.
    }

    candidates.push(LOCAL_DEV_FALLBACK_API_URL)
  }

  return Array.from(new Set(candidates))
}

function getBrowserLocalAPIBaseURL(configuredBaseURL: string) {
  if (process.env.NODE_ENV === 'production' || typeof window === 'undefined') return null

  const browserHostname = window.location.hostname
  if (!isLocalDevelopmentHostname(browserHostname) || !isLocalDevelopmentAPI(configuredBaseURL)) {
    return null
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  const configuredURL = new URL(configuredBaseURL)
  const port = configuredURL.port ? `:${configuredURL.port}` : ''
  return `${protocol}//${browserHostname}${port}`
}

function isLocalDevelopmentAPI(baseURL: string) {
  if (process.env.NODE_ENV === 'production') return false

  try {
    const { hostname } = new URL(baseURL)
    return isLocalDevelopmentHostname(hostname)
  } catch {
    return false
  }
}

function isLocalDevelopmentHostname(hostname: string) {
  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '0.0.0.0'
    || hostname.startsWith('192.168.')
    || hostname.startsWith('10.')
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname)
}

function isRetryableLocalAPIError(error: unknown, baseURL: string) {
  if (!isLocalDevelopmentAPI(baseURL)) return false
  if (!(error instanceof VimobAPIError)) return false

  return error.code === 'api_unavailable' || error.code === 'api_timeout'
}

function shouldRetryLocalDevAPI(
  result: Awaited<ReturnType<typeof makeRequest>>,
  baseURL: string,
) {
  if (result.response.ok || result.payload) return false
  if (!isLocalDevelopmentAPI(baseURL)) return false

  return result.response.status === 404 || result.response.headers.get('content-type')?.includes('text/html')
}

function getFallbackErrorMessage(result: Awaited<ReturnType<typeof makeRequest>>, baseURL: string) {
  const contentType = result.response.headers.get('content-type') || ''
  if (!result.payload && (contentType.includes('text/html') || result.response.status === 404)) {
    return `A Vimob API nao respondeu em ${baseURL}. Verifique se apps/api esta rodando e se NEXT_PUBLIC_VIMOB_API_URL aponta para a porta correta.`
  }

  return 'Erro ao falar com a API do Vimob.'
}

async function reportAPIError(
  path: string,
  options: RequestOptions,
  headers: Headers,
  result: Awaited<ReturnType<typeof makeRequest>>,
  error: VimobAPIError,
) {
  if (path === '/v1/telemetry/errors') return

  try {
    const telemetryHeaders = new Headers({
      Authorization: headers.get('Authorization') || '',
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    const organizationId = headers.get('X-Organization-ID')
    if (organizationId) {
      telemetryHeaders.set('X-Organization-ID', organizationId)
    }

    const telemetryURL = buildAPIURL('/v1/telemetry/errors', undefined, result.baseURL)
    const method = options.method || 'GET'

    await fetch(telemetryURL, {
      method: 'POST',
      headers: telemetryHeaders,
      body: JSON.stringify({
        requestId: error.requestId,
        source: 'api',
        severity: result.response.status >= 500 ? 'error' : 'warning',
        category: 'api_request',
        message: error.message,
        errorCode: error.code,
        httpStatus: result.response.status,
        method,
        path,
        route: path,
        url: buildAPIURL(path, options.query, result.baseURL),
        userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
        browserContext:
          typeof window === 'undefined'
            ? {}
            : {
                pathname: window.location.pathname,
                search: window.location.search,
                origin: window.location.origin,
              },
        metadata: {
          apiBaseURL: result.baseURL,
          responseContentType: result.response.headers.get('content-type'),
          bodyKeys: getBodyKeys(options.body),
        },
      }),
    })
  } catch {
    // Telemetry must never break the user flow or create a second visible error.
  }
}

function getBodyKeys(body: unknown) {
  if (isFormDataBody(body)) {
    const keys: string[] = []
    body.forEach((_value, key) => keys.push(key))
    return keys
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return []
  return Object.keys(body)
}

function serializeRequestBody(body: unknown) {
  if (body === undefined) return undefined
  if (isFormDataBody(body)) return body

  return JSON.stringify(body)
}

function isFormDataBody(body: unknown): body is FormData {
  return typeof FormData !== 'undefined' && body instanceof FormData
}

function safeJSONParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}
