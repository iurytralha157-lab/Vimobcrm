'use client'

import { useQuery } from '@tanstack/react-query'

import { normalizeFilters, type PropertyFilters } from '@/hooks/use-properties'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import { useTenantQueryAccessSignature } from '@/hooks/shared/use-tenant-query-access-signature'
import { propertiesAPI } from '@/lib/api/properties'

/** Same filters as the list, so the KPI row and the card count always agree. */
export function usePropertyCatalogStats(
  search: string,
  filters: PropertyFilters,
  options: { enabled?: boolean } = {},
) {
  const organizationId = useOrganizationId()
  const accessSignature = useTenantQueryAccessSignature()
  const normalizedSearch = search.trim() || undefined
  const normalizedFilters = normalizeFilters(filters)

  return useQuery({
    queryKey: ['properties', organizationId, 'catalog-stats', normalizedSearch, normalizedFilters, accessSignature],
    queryFn: () => propertiesAPI.getPropertyStats(organizationId as string, {
      search: normalizedSearch,
      ...normalizedFilters,
    }),
    enabled: Boolean(organizationId) && options.enabled !== false,
    staleTime: 30_000,
  })
}
