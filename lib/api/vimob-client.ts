import { supabase } from '@/integrations/supabase/client'
import {
  VimobAPIError,
  getTechnicalErrorMessage,
} from '@/lib/api/vimob-error'
import { isPasswordRecoveryAccessToken } from '@/lib/auth/password-recovery'

export { VimobAPIError } from '@/lib/api/vimob-error'

const DEFAULT_API_URL = 'http://localhost:8081'
const LOCAL_DEV_FALLBACK_API_URL = 'http://localhost:8081'
const DEFAULT_REQUEST_TIMEOUT_MS = 12000
const API_ACCESS_TOKEN_CACHE_TTL_MS = 60_000
const READ_RETRY_DELAYS_MS = [500, 1500]
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504, 520, 522, 524])

type APIAccessTokenIdentity = {
  token: string
  userId: string
}

type APIAccessTokenCache = APIAccessTokenIdentity & {
  expiresAt: number
}

type APIAccessTokenResolution = {
  generation: number
  promise: Promise<string>
}

let activeAccessTokenIdentity: APIAccessTokenIdentity | null = null
let accessTokenCache: APIAccessTokenCache | null = null
let accessTokenPromise: APIAccessTokenResolution | null = null
let accessTokenGeneration = 0

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  organizationId?: string | null
  signal?: AbortSignal
  timeoutMs?: number
  retry?: boolean
  skipTelemetry?: boolean
  keepalive?: boolean
  headers?: HeadersInit
  cache?: RequestCache
}

type APIErrorEnvelope = {
  error?: string | {
    code?: string
    message?: string
    requestId?: string
  }
}

export function setVimobAPIAccessToken(
  accessToken?: string | null,
  userId?: string | null,
) {
  const token = accessToken?.trim() || ''
  const normalizedUserId = userId?.trim() || ''

  replaceAccessTokenSession(
    token && normalizedUserId ? { token, userId: normalizedUserId } : null,
  )
}

export async function vimobAPIRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  throwIfAborted(options.signal)

  const accessToken = await resolveWithAbortSignal(getAccessTokenForAPI(), options.signal)
  assertAccessTokenAllowedForRequest(path, options.method, accessToken)
  throwIfAborted(options.signal)

  let headers = createAuthenticatedHeaders(accessToken, options)
  let result = await makeRequestWithLocalFallback(path, options, headers)

  if (result.response.status === 401) {
    throwIfAborted(options.signal)
    clearAccessTokenCache()
    const refreshedAccessToken = await resolveWithAbortSignal(refreshAccessTokenForAPI(), options.signal)
    if (refreshedAccessToken) {
      assertAccessTokenAllowedForRequest(path, options.method, refreshedAccessToken)
      headers = createAuthenticatedHeaders(refreshedAccessToken, options)
      result = await makeRequestWithLocalFallback(path, options, headers)
    }
  }

  throwIfAborted(options.signal)

  if (!result.response.ok) {
    const envelope = result.payload as APIErrorEnvelope | null
    const apiError = typeof envelope?.error === 'string'
      ? { message: envelope.error }
      : envelope?.error
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

function assertAccessTokenAllowedForRequest(
  path: string,
  method: RequestOptions['method'],
  accessToken: string,
) {
  if (
    (path !== '/v1/settings/password' || method !== 'POST')
    && isPasswordRecoveryAccessToken(accessToken)
  ) {
    throw new VimobAPIError(
      'Esta sessão serve apenas para redefinir a senha. Entre novamente para acessar o CRM.',
      {
        code: 'recovery_session_restricted',
        status: 403,
      },
    )
  }
}

async function getAccessTokenForAPI() {
  const cachedToken = getCachedAccessToken()
  if (cachedToken) {
    return cachedToken
  }

  const generation = accessTokenGeneration
  if (accessTokenPromise?.generation === generation) {
    return accessTokenPromise.promise
  }

  const promise = resolveAccessTokenForAPI(generation).finally(() => {
    if (accessTokenPromise?.generation === generation) {
      accessTokenPromise = null
    }
  })
  accessTokenPromise = { generation, promise }

  return promise
}

async function resolveAccessTokenForAPI(generation: number): Promise<string> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (!isCurrentAccessTokenGeneration(generation)) {
    return getAccessTokenForAPI()
  }

  if (!sessionError && sessionData.session?.access_token) {
    cacheResolvedAccessToken(
      sessionData.session.access_token,
      sessionData.session.user.id,
      generation,
    )
    return sessionData.session.access_token
  }

  const refreshedAccessToken = await refreshAccessTokenForAPI(generation)
  if (refreshedAccessToken) return refreshedAccessToken

  throw new VimobAPIError('Sessao expirada. Faca login novamente.', {
    code: 'missing_session',
    status: 401,
  })
}

async function refreshAccessTokenForAPI(
  generation = accessTokenGeneration,
): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession()

    if (!isCurrentAccessTokenGeneration(generation)) {
      return getAccessTokenForAPI()
    }

    if (error || !data.session?.access_token) {
      replaceAccessTokenSession(null)
      return null
    }

    cacheResolvedAccessToken(
      data.session.access_token,
      data.session.user.id,
      generation,
    )
    return data.session.access_token
  } catch {
    if (!isCurrentAccessTokenGeneration(generation)) {
      return getAccessTokenForAPI()
    }

    replaceAccessTokenSession(null)
    return null
  }
}

function getCachedAccessToken() {
  if (!accessTokenCache || accessTokenCache.expiresAt <= Date.now()) {
    accessTokenCache = null
    return null
  }

  if (
    !activeAccessTokenIdentity
    || activeAccessTokenIdentity.userId !== accessTokenCache.userId
    || activeAccessTokenIdentity.token !== accessTokenCache.token
  ) {
    accessTokenCache = null
    return null
  }

  return accessTokenCache.token
}

function cacheResolvedAccessToken(token: string, userId: string, generation: number) {
  if (!isCurrentAccessTokenGeneration(generation)) return false

  const identity = { token, userId }
  activeAccessTokenIdentity = identity
  accessTokenCache = {
    ...identity,
    expiresAt: Date.now() + API_ACCESS_TOKEN_CACHE_TTL_MS,
  }
  return true
}

function replaceAccessTokenSession(identity: APIAccessTokenIdentity | null) {
  accessTokenGeneration += 1
  accessTokenPromise = null
  activeAccessTokenIdentity = identity
  accessTokenCache = identity
    ? {
        ...identity,
        expiresAt: Date.now() + API_ACCESS_TOKEN_CACHE_TTL_MS,
      }
    : null
}

function clearAccessTokenCache() {
  accessTokenGeneration += 1
  accessTokenPromise = null
  accessTokenCache = null
}

function isCurrentAccessTokenGeneration(generation: number) {
  return generation === accessTokenGeneration
}

function createAuthenticatedHeaders(accessToken: string, options: RequestOptions) {
  const headers = new Headers(options.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)
  headers.set('Accept', 'application/json')

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.organizationId) {
    headers.set('X-Organization-ID', options.organizationId)
  }

  return headers
}

export async function vimobPublicAPIRequest<T>(path: string, options: Omit<RequestOptions, 'organizationId'> = {}): Promise<T> {
  const headers = new Headers(options.headers)
  headers.set('Accept', 'application/json')

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  const result = await makeRequestWithLocalFallback(path, options, headers)

  if (!result.response.ok) {
    const envelope = result.payload as APIErrorEnvelope | null
    const apiError = typeof envelope?.error === 'string'
      ? { message: envelope.error }
      : envelope?.error
    throw new VimobAPIError(apiError?.message || getFallbackErrorMessage(result, result.baseURL), {
      code: apiError?.code || 'api_error',
      status: result.response.status,
      requestId: apiError?.requestId,
    })
  }

  return result.payload as T
}

async function makeRequest(path: string, options: RequestOptions, headers: Headers, baseURL: string) {
  const requestSignal = createRequestSignal(options.signal, options.timeoutMs)

  try {
    const response = await fetch(buildAPIURL(path, options.query, baseURL), {
      method: options.method || 'GET',
      headers,
      body: serializeRequestBody(options.body),
      signal: requestSignal.signal,
      keepalive: options.keepalive,
      cache: options.cache,
    })
    const text = await response.text()

    return {
      baseURL,
      response,
      text,
      payload: text ? safeJSONParse(text) : null,
    }
  } catch (error) {
    if (requestSignal.abortSource() === 'external') {
      throw getAbortReason(options.signal)
    }

    if (requestSignal.abortSource() === 'timeout') {
      throw createTimeoutError(baseURL)
    }

    throw error
  } finally {
    requestSignal.cleanup()
  }
}

async function makeRequestOrThrow(path: string, options: RequestOptions, headers: Headers, baseURL: string) {
  try {
    return await makeRequest(path, options, headers, baseURL)
  } catch (error) {
    if (options.signal?.aborted) {
      throw getAbortReason(options.signal)
    }

    if (error instanceof VimobAPIError) {
      throw error
    }

    if (isAbortError(error)) {
      throw createTimeoutError(baseURL)
    }

    throw new VimobAPIError(`A Vimob API não está acessível em ${baseURL}. Inicie apps/api ou ajuste NEXT_PUBLIC_VIMOB_API_URL.`, {
      code: 'api_unavailable',
      status: 0,
    })
  }
}

async function makeRequestWithLocalFallback(path: string, options: RequestOptions, headers: Headers) {
  throwIfAborted(options.signal)

  const candidates = getAPIBaseURLCandidates()
  let lastError: VimobAPIError | null = null

  for (const baseURL of candidates) {
    throwIfAborted(options.signal)

    const retryDelays = getRetryDelays(options)

    for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
      throwIfAborted(options.signal)

      try {
        const result = await makeRequestOrThrow(path, options, headers, baseURL)

        if (shouldRetryLocalDevAPI(result, baseURL)) {
          break
        }

        if (shouldRetryTransientHTTPResult(result, options) && attempt < retryDelays.length) {
          await wait(retryDelays[attempt], options.signal)
          continue
        }

        return result
      } catch (error) {
        if (options.signal?.aborted) {
          throw getAbortReason(options.signal)
        }

        if (isRetryableTransientAPIError(error, options) && attempt < retryDelays.length) {
          lastError = error as VimobAPIError
          await wait(retryDelays[attempt], options.signal)
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
  if (options.retry === false) return []
  if (options.signal?.aborted) return []
  return READ_RETRY_DELAYS_MS
}

function wait(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
  }

  throwIfAborted(signal)

  return new Promise<void>((resolve, reject) => {
    const abortWait = () => {
      clearTimeout(timeoutId)
      signal.removeEventListener('abort', abortWait)
      reject(getAbortReason(signal))
    }
    const timeoutId = setTimeout(() => {
      signal.removeEventListener('abort', abortWait)
      resolve()
    }, ms)

    signal.addEventListener('abort', abortWait, { once: true })
  })
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
  let source: 'external' | 'timeout' | null = null
  let timeoutId: ReturnType<typeof setTimeout> | null = null

  const abortRequest = (nextSource: 'external' | 'timeout') => {
    if (controller.signal.aborted) return

    source = nextSource
    controller.abort(nextSource === 'external' ? getAbortReason(externalSignal) : undefined)
  }
  const abortFromExternal = () => abortRequest('external')

  if (externalSignal?.aborted) {
    abortFromExternal()
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortFromExternal, { once: true })
  }

  if (timeoutMs > 0) {
    timeoutId = setTimeout(() => abortRequest('timeout'), timeoutMs)
  }

  return {
    signal: controller.signal,
    abortSource: () => source,
    cleanup: () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
      externalSignal?.removeEventListener('abort', abortFromExternal)
    },
  }
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
    || error instanceof Error && error.name === 'AbortError'
}

function createTimeoutError(baseURL: string) {
  return new VimobAPIError(`A Vimob API demorou para responder em ${baseURL}. Tente novamente em instantes.`, {
    code: 'api_timeout',
    status: 0,
  })
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw getAbortReason(signal)
  }
}

function getAbortReason(signal?: AbortSignal): Error {
  if (signal?.reason instanceof Error) {
    return signal.reason
  }

  return new DOMException('The operation was aborted.', 'AbortError')
}

function resolveWithAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise

  throwIfAborted(signal)

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const settle = (callback: () => void) => {
      if (settled) return

      settled = true
      signal.removeEventListener('abort', abortResolution)
      callback()
    }
    const abortResolution = () => settle(() => reject(getAbortReason(signal)))

    signal.addEventListener('abort', abortResolution, { once: true })
    promise.then(
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    )
  })
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

  return error.code === 'api_unavailable'
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
        message: getTechnicalErrorMessage(error),
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
