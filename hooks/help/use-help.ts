'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { helpAPI } from '@/lib/api/help'

const HELP_CATALOG_STALE_TIME_MS = 5 * 60_000
const HELP_ARTICLE_STALE_TIME_MS = 10 * 60_000
const HELP_GC_TIME_MS = 30 * 60_000

export const helpQueryKeys = {
  catalog: (scope: 'authenticated' | 'public', organizationId?: string) => (
    ['help', 'catalog', scope, organizationId || 'none'] as const
  ),
  article: (
    scope: 'authenticated' | 'public',
    slug: string,
    organizationId?: string,
  ) => ['help', 'article', scope, organizationId || 'none', slug] as const,
}

function useOrganizationId() {
  const { organization, profile } = useAuth()
  return organization?.id ?? profile?.organization_id ?? undefined
}

export function useHelpCatalog() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: helpQueryKeys.catalog('authenticated', organizationId),
    enabled: Boolean(organizationId),
    queryFn: ({ signal }) => helpAPI.listArticles(organizationId, signal),
    staleTime: HELP_CATALOG_STALE_TIME_MS,
    gcTime: HELP_GC_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function useHelpArticle(slug: string) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: helpQueryKeys.article('authenticated', slug, organizationId),
    enabled: Boolean(organizationId && slug),
    queryFn: ({ signal }) => helpAPI.getArticle(slug, organizationId, signal),
    staleTime: HELP_ARTICLE_STALE_TIME_MS,
    gcTime: HELP_GC_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function useHelpSearch() {
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: ({ query, limit = 8 }: { query: string; limit?: number }) => {
      if (!organizationId) {
        throw new Error('Selecione uma organização para consultar a Central de Ajuda.')
      }
      return helpAPI.search(query, organizationId, limit)
    },
  })
}

export function usePublicHelpCatalog() {
  return useQuery({
    queryKey: helpQueryKeys.catalog('public'),
    queryFn: ({ signal }) => helpAPI.listPublicArticles(signal),
    staleTime: HELP_CATALOG_STALE_TIME_MS,
    gcTime: HELP_GC_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

export function usePublicHelpArticle(slug: string) {
  return useQuery({
    queryKey: helpQueryKeys.article('public', slug),
    enabled: Boolean(slug),
    queryFn: ({ signal }) => helpAPI.getPublicArticle(slug, signal),
    staleTime: HELP_ARTICLE_STALE_TIME_MS,
    gcTime: HELP_GC_TIME_MS,
    refetchOnWindowFocus: false,
  })
}

