import {
  pageSpeedResponseSchema,
  pageSpeedStrategySchema,
} from '@/lib/validation'

export type SitePerformanceStrategy = 'desktop' | 'mobile'

export type SitePerformanceResult = {
  strategy: SitePerformanceStrategy
  score: number
  measuredAt: string
  metrics: {
    largestContentfulPaintMs: number | null
    cumulativeLayoutShift: number | null
    totalBlockingTimeMs: number | null
  }
}

const PAGESPEED_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed'

export const sitePerformanceAPI = {
  async run(url: string, strategy: SitePerformanceStrategy): Promise<SitePerformanceResult> {
    const parsedStrategy = pageSpeedStrategySchema.parse(strategy)
    const parsedURL = new URL(url)
    if (!['http:', 'https:'].includes(parsedURL.protocol)) {
      throw new Error('O teste exige um endereço público HTTP ou HTTPS.')
    }

    const requestURL = new URL(PAGESPEED_ENDPOINT)
    requestURL.searchParams.set('url', parsedURL.toString())
    requestURL.searchParams.set('strategy', parsedStrategy)
    requestURL.searchParams.set('category', 'performance')
    requestURL.searchParams.set('locale', 'pt-BR')

    const response = await fetch(requestURL, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    const payload: unknown = await response.json().catch(() => null)

    if (!response.ok) {
      const apiMessage =
        typeof payload === 'object' &&
        payload &&
        'error' in payload &&
        typeof payload.error === 'object' &&
        payload.error &&
        'message' in payload.error &&
        typeof payload.error.message === 'string'
          ? payload.error.message
          : ''
      throw new Error(apiMessage || 'Não foi possível executar o teste de velocidade agora.')
    }

    const data = pageSpeedResponseSchema.parse(payload)
    const score = data.lighthouseResult.categories.performance.score
    if (score === null) {
      throw new Error('O PageSpeed não conseguiu calcular uma nota para este endereço.')
    }

    const audits = data.lighthouseResult.audits || {}

    return {
      strategy: parsedStrategy,
      score: Math.round(score * 100),
      measuredAt: data.lighthouseResult.fetchTime,
      metrics: {
        largestContentfulPaintMs: audits['largest-contentful-paint']?.numericValue ?? null,
        cumulativeLayoutShift: audits['cumulative-layout-shift']?.numericValue ?? null,
        totalBlockingTimeMs: audits['total-blocking-time']?.numericValue ?? null,
      },
    }
  },
}
