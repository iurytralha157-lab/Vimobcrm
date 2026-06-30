import { supabase } from '@/integrations/supabase/client'

const DEFAULT_API_URL = 'http://localhost:8081'
const LOCAL_DEV_FALLBACK_API_URL = 'http://localhost:8081'
const DEFAULT_REQUEST_TIMEOUT_MS = 12000

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  query?: Record<string, string | number | boolean | null | undefined>
  body?: unknown
  organizationId?: string | null
  signal?: AbortSignal
  timeoutMs?: number
  skipTelemetry?: boolean
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

export async function vimobAPIRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession()

  if (sessionError || !sessionData.session?.access_token) {
    throw new VimobAPIError('Sessao expirada. Faca login novamente.', {
      code: 'missing_session',
      status: 401,
    })
  }

  const headers = new Headers({
    Authorization: `Bearer ${sessionData.session.access_token}`,
    Accept: 'application/json',
  })

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  if (options.organizationId) {
    headers.set('X-Organization-ID', options.organizationId)
  }

  const baseURL = getAPIBaseURL()
  let result = await makeRequestOrThrow(path, options, headers, baseURL)

  if (shouldRetryLocalDevAPI(result, baseURL)) {
    result = await makeRequestOrThrow(path, options, headers, LOCAL_DEV_FALLBACK_API_URL)
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

export async function vimobPublicAPIRequest<T>(path: string, options: Omit<RequestOptions, 'organizationId'> = {}): Promise<T> {
  const headers = new Headers({
    Accept: 'application/json',
  })

  if (options.body !== undefined && !isFormDataBody(options.body)) {
    headers.set('Content-Type', 'application/json')
  }

  const baseURL = getAPIBaseURL()
  let result = await makeRequestOrThrow(path, options, headers, baseURL)

  if (shouldRetryLocalDevAPI(result, baseURL)) {
    result = await makeRequestOrThrow(path, options, headers, LOCAL_DEV_FALLBACK_API_URL)
  }

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

    throw new VimobAPIError(`A Vimob API nao esta acessivel em ${baseURL}. Inicie apps/api ou ajuste NEXT_PUBLIC_VIMOB_API_URL.`, {
      code: 'api_unavailable',
      status: 0,
    })
  }
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
  return (process.env.NEXT_PUBLIC_VIMOB_API_URL || DEFAULT_API_URL).replace(/\/+$/, '')
}

function shouldRetryLocalDevAPI(
  result: Awaited<ReturnType<typeof makeRequest>>,
  baseURL: string,
) {
  if (result.response.ok || result.payload) return false
  if (!baseURL.includes('localhost:8080') && !baseURL.includes('127.0.0.1:8080')) return false

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
