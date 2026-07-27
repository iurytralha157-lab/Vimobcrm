'use client'

import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  sitePerformanceAPI,
  type SitePerformanceResult,
} from '@/lib/api/site-performance'

type SitePerformanceScan = {
  desktop: SitePerformanceResult
  mobile: SitePerformanceResult
}

export function useSitePerformance() {
  return useMutation({
    mutationFn: async (url: string): Promise<SitePerformanceScan> => {
      const [desktop, mobile] = await Promise.all([
        sitePerformanceAPI.run(url, 'desktop'),
        sitePerformanceAPI.run(url, 'mobile'),
      ])
      return { desktop, mobile }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : 'Não foi possível testar o site agora.'
      toast.error(message)
    },
  })
}
