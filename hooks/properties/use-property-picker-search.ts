'use client'

import { useInfiniteQuery } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { useOptionalActiveOrganizationId } from '@/hooks/use-active-organization'
import { useOrganizationModules } from '@/hooks/use-organization-modules'
import { useUserPermissions } from '@/hooks/use-user-permissions'
import { useTenantQueryAccessSignature } from '@/hooks/shared/use-tenant-query-access-signature'
import { propertiesAPI } from '@/lib/api/properties'
import { nextPropertyPickerOffset, uniquePropertyPickerResults } from '@/lib/property-picker-search'

type PropertyPickerFilters = Omit<NonNullable<Parameters<typeof propertiesAPI.getProperties>[1]>, 'limit' | 'offset' | 'search'>

export function usePropertyPickerSearch({
  search = '',
  enabled = true,
  filters = {},
  pageSize = 24,
}: { search?: string; enabled?: boolean; filters?: PropertyPickerFilters; pageSize?: number } = {}) {
  const { user, activeOrganization } = useAuth()
  const organizationId = useOptionalActiveOrganizationId()
  const accessSignature = useTenantQueryAccessSignature()
  const { hasModule } = useOrganizationModules()
  const { hasPermission, isLoading: permissionsLoading } = useUserPermissions()
  const allowed = Boolean(user?.id && organizationId && activeOrganization.status === 'ready'
    && !permissionsLoading && hasModule('properties')
    && (hasPermission('property_view') || hasPermission('property_manage')))
  const normalizedSearch = search.trim().slice(0, 120) || undefined
  const limit = Math.max(1, Math.min(100, Math.floor(pageSize) || 24))
  const query = useInfiniteQuery({
    queryKey: ['properties-infinite', organizationId, 'picker', normalizedSearch, filters, limit, accessSignature],
    enabled: enabled && allowed,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      if (!organizationId || !allowed) return { properties: [], nextOffset: undefined, total: 0 }
      const result = await propertiesAPI.getProperties(organizationId, {
        ...filters, search: normalizedSearch, limit, offset: pageParam,
      })
      return {
        properties: result.data,
        total: result.count ?? 0,
        nextOffset: nextPropertyPickerOffset(pageParam, limit, result.data.length, result.count ?? 0),
      }
    },
    getNextPageParam: (lastPage) => lastPage.nextOffset,
    staleTime: 30_000,
  })
  return {
    ...query,
    data: allowed ? query.data : undefined,
    // Never re-filter server results: code/legacy references may match outside visible labels.
    properties: allowed ? uniquePropertyPickerResults(query.data?.pages.map((page) => page.properties) ?? []) : [],
  }
}
