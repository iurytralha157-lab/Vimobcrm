'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, ReactNode } from 'react'

const DEFAULT_QUERY_STALE_TIME_MS = 1000 * 60 * 10
const DEFAULT_QUERY_GC_TIME_MS = 1000 * 60 * 60

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            gcTime: DEFAULT_QUERY_GC_TIME_MS,
            staleTime: DEFAULT_QUERY_STALE_TIME_MS,
            retry: 1,
            refetchOnMount: false,
            refetchOnWindowFocus: false,
          },
          mutations: {
            retry: false,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  )
}
