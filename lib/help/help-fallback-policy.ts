export type HelpFallbackDisposition =
  | 'fallback'
  | 'probe-capability'
  | 'reject'

export type HelpFallbackFailure = {
  code?: string
  errorName?: string
  isVimobAPIError: boolean
  signalAborted?: boolean
  status?: number
}

export function getHelpFallbackDisposition(
  failure: HelpFallbackFailure,
  options: { detailRequest: boolean },
): HelpFallbackDisposition {
  if (failure.signalAborted || failure.errorName === 'AbortError') {
    return 'reject'
  }
  if (!failure.isVimobAPIError) return 'reject'
  if (failure.status === 401 || failure.status === 403) return 'reject'
  if (failure.code === 'help_article_not_found') return 'reject'

  if (failure.status === 404) {
    return options.detailRequest ? 'probe-capability' : 'fallback'
  }
  if (failure.code === 'api_timeout') return 'fallback'
  if (failure.code === 'api_unavailable' || failure.status === 0) {
    return options.detailRequest ? 'probe-capability' : 'fallback'
  }
  if (typeof failure.status === 'number' && failure.status >= 500) {
    return 'fallback'
  }

  return 'reject'
}
