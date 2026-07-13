'use client'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, ReactNode } from 'react'

import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope'
import {
  isWhatsAppQueryKey,
  isWhatsAppQueryKeyForScope,
} from '@/lib/whatsapp-query-cache'

const DEFAULT_QUERY_STALE_TIME_MS = 1000 * 60 * 10
const DEFAULT_QUERY_GC_TIME_MS = 1000 * 60 * 60

function WhatsAppTenantCacheBoundary() {
  const queryClient = useQueryClient()
  const scope = useWhatsAppQueryScope()

  useEffect(() => {
    queryClient.removeQueries({
      predicate: (query) => isWhatsAppQueryKey(query.queryKey)
        && (!scope.organizationId
          || !scope.userId
          || !isWhatsAppQueryKeyForScope(query.queryKey, scope)),
    })
  }, [scope, queryClient])

  return null
}

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
      <WhatsAppTenantCacheBoundary />
      {children}
    </QueryClientProvider>
  )
}
