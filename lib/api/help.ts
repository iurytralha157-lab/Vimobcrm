import {
  getHelpFallbackDisposition,
  type HelpFallbackDisposition,
} from '@/lib/help/help-fallback-policy'
import {
  getBundledPublicHelpArticle,
  listBundledPublicHelpArticles,
} from '@/lib/help/public-help-content'
import {
  apiHelpArticleListResponseSchema,
  apiHelpArticleResponseSchema,
  apiHelpSearchResponseSchema,
  helpArticleSlugSchema,
  helpSearchInputSchema,
  parseDomainInput,
  validateDomainResponse,
  type HelpArticle,
  type HelpArticleSummary,
} from '@/lib/validation'

import {
  VimobAPIError,
  vimobAPIRequest,
  vimobPublicAPIRequest,
} from './vimob-client'

type Envelope<T> = {
  data: T
}

type APIErrorEnvelope = {
  error?: {
    code?: string
    message?: string
    requestId?: string
  }
}

type AuthenticatedFallbackRequestOptions = {
  body?: unknown
  method?: 'GET' | 'POST'
  signal?: AbortSignal
}

function getFallbackDisposition(
  error: unknown,
  signal: AbortSignal | undefined,
  detailRequest: boolean,
): HelpFallbackDisposition {
  return getHelpFallbackDisposition({
    code: error instanceof VimobAPIError ? error.code : undefined,
    errorName: error instanceof Error ? error.name : undefined,
    isVimobAPIError: error instanceof VimobAPIError,
    signalAborted: signal?.aborted,
    status: error instanceof VimobAPIError ? error.status : undefined,
  }, { detailRequest })
}

function shouldUseRouteFallback(
  error: unknown,
  signal?: AbortSignal,
) {
  return getFallbackDisposition(error, signal, false) === 'fallback'
}

function parseJSON(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return null
  }
}

async function requestAuthenticatedHelpFallback<T>(
  path: string,
  options: AuthenticatedFallbackRequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: 'application/json' })
  if (options.body !== undefined) headers.set('Content-Type', 'application/json')

  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    cache: 'no-store',
    credentials: 'same-origin',
    signal: options.signal,
  })
  const text = await response.text()
  const payload = text ? parseJSON(text) : null

  if (!response.ok) {
    const apiError = (payload as APIErrorEnvelope | null)?.error
    throw new VimobAPIError(
      apiError?.message || 'Unable to load authenticated help fallback.',
      {
        code: apiError?.code || 'help_fallback_error',
        status: response.status,
        requestId: apiError?.requestId,
      },
    )
  }

  return payload as T
}

async function probeHelpCatalogCapability(
  scope: 'authenticated' | 'public',
  organizationId: string | null | undefined,
  signal?: AbortSignal,
) {
  try {
    const response = scope === 'authenticated'
      ? await vimobAPIRequest<Envelope<HelpArticleSummary[]>>(
          '/v1/help/articles',
          { organizationId, signal, retry: false },
        )
      : await vimobPublicAPIRequest<Envelope<HelpArticleSummary[]>>(
          '/v1/public/help/articles',
          { signal, retry: false },
        )

    validateDomainResponse(
      apiHelpArticleListResponseSchema,
      response,
      scope === 'authenticated'
        ? 'help.articles.capability'
        : 'help.public.articles.capability',
    )
    return false
  } catch (probeError) {
    if (shouldUseRouteFallback(probeError, signal)) return true
    throw probeError
  }
}

async function shouldUseDetailFallback(
  error: unknown,
  scope: 'authenticated' | 'public',
  organizationId: string | null | undefined,
  signal?: AbortSignal,
) {
  const disposition = getFallbackDisposition(error, signal, true)
  if (disposition === 'reject') return false
  if (disposition === 'fallback') return true
  return probeHelpCatalogCapability(scope, organizationId, signal)
}

export const helpAPI = {
  async listArticles(
    organizationId?: string | null,
    signal?: AbortSignal,
  ): Promise<HelpArticleSummary[]> {
    try {
      const response = await vimobAPIRequest<Envelope<HelpArticleSummary[]>>(
        '/v1/help/articles',
        { organizationId, signal },
      )
      validateDomainResponse(
        apiHelpArticleListResponseSchema,
        response,
        'help.articles.list',
      )
      return response.data
    } catch (error) {
      if (!shouldUseRouteFallback(error, signal)) throw error
      const response = await requestAuthenticatedHelpFallback<
        Envelope<HelpArticleSummary[]>
      >('/api/internal/help-fallback/articles', { signal })
      validateDomainResponse(
        apiHelpArticleListResponseSchema,
        response,
        'help.authenticated-fallback.articles.list',
      )
      return response.data
    }
  },

  async getArticle(
    slug: string,
    organizationId?: string | null,
    signal?: AbortSignal,
  ): Promise<HelpArticle> {
    const parsedSlug = parseDomainInput(
      helpArticleSlugSchema,
      slug,
      'help.articles.get.slug',
    )
    try {
      const response = await vimobAPIRequest<Envelope<HelpArticle>>(
        `/v1/help/articles/${parsedSlug}`,
        { organizationId, signal },
      )
      validateDomainResponse(
        apiHelpArticleResponseSchema,
        response,
        'help.articles.get',
      )
      return response.data
    } catch (error) {
      if (!await shouldUseDetailFallback(
        error,
        'authenticated',
        organizationId,
        signal,
      )) {
        throw error
      }

      const response = await requestAuthenticatedHelpFallback<
        Envelope<HelpArticle>
      >(`/api/internal/help-fallback/articles/${parsedSlug}`, { signal })
      validateDomainResponse(
        apiHelpArticleResponseSchema,
        response,
        'help.authenticated-fallback.articles.get',
      )
      return response.data
    }
  },

  async search(
    query: string,
    organizationId?: string | null,
    limit = 8,
  ): Promise<HelpArticleSummary[]> {
    const body = parseDomainInput(
      helpSearchInputSchema,
      { query, limit },
      'help.search',
    )
    try {
      const response = await vimobAPIRequest<Envelope<HelpArticleSummary[]>>(
        '/v1/help/search',
        {
          method: 'POST',
          organizationId,
          body,
        },
      )
      validateDomainResponse(apiHelpSearchResponseSchema, response, 'help.search')
      return response.data
    } catch (error) {
      if (!shouldUseRouteFallback(error)) throw error
      const response = await requestAuthenticatedHelpFallback<
        Envelope<HelpArticleSummary[]>
      >('/api/internal/help-fallback/search', {
        method: 'POST',
        body,
      })
      validateDomainResponse(
        apiHelpSearchResponseSchema,
        response,
        'help.authenticated-fallback.search',
      )
      return response.data
    }
  },

  async listPublicArticles(signal?: AbortSignal): Promise<HelpArticleSummary[]> {
    try {
      const response = await vimobPublicAPIRequest<Envelope<HelpArticleSummary[]>>(
        '/v1/public/help/articles',
        { signal },
      )
      validateDomainResponse(
        apiHelpArticleListResponseSchema,
        response,
        'help.public.articles.list',
      )
      return response.data
    } catch (error) {
      if (!shouldUseRouteFallback(error, signal)) throw error
      return listBundledPublicHelpArticles()
    }
  },

  async getPublicArticle(
    slug: string,
    signal?: AbortSignal,
  ): Promise<HelpArticle> {
    const parsedSlug = parseDomainInput(
      helpArticleSlugSchema,
      slug,
      'help.public.articles.get.slug',
    )
    try {
      const response = await vimobPublicAPIRequest<Envelope<HelpArticle>>(
        `/v1/public/help/articles/${parsedSlug}`,
        { signal },
      )
      validateDomainResponse(
        apiHelpArticleResponseSchema,
        response,
        'help.public.articles.get',
      )
      return response.data
    } catch (error) {
      if (!await shouldUseDetailFallback(
        error,
        'public',
        undefined,
        signal,
      )) {
        throw error
      }

      const article = getBundledPublicHelpArticle(parsedSlug)
      if (!article) throw error
      return article
    }
  },
}

export type { HelpArticle, HelpArticleSummary }
