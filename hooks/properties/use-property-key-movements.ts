'use client'

import { useInfiniteQuery } from '@tanstack/react-query'

import { useAuth } from '@/contexts/AuthContext'
import { propertyWorkspaceAPI } from '@/lib/api/property-workspace'
import type { PropertyKeyMovementListQuery } from '@/lib/validation'

import { propertyWorkspaceKeys, useWorkspaceQueryScope } from './use-property-workspace'

const PAGE_SIZE = 20

/** Lives under the workspace key, so registering a movement refreshes the timeline. */
export function usePropertyKeyMovements(
  propertyId: string | null,
  type: PropertyKeyMovementListQuery['type'],
  enabled: boolean,
) {
  const { user } = useAuth()
  const { organizationId, accessSignature } = useWorkspaceQueryScope()

  return useInfiniteQuery({
    queryKey: [...propertyWorkspaceKeys.detail(organizationId, accessSignature, propertyId), 'key-movements', type ?? 'all'],
    queryFn: ({ pageParam }) => propertyWorkspaceAPI.listKeyMovements(organizationId as string, propertyId as string, {
      limit: PAGE_SIZE,
      type,
      cursor: pageParam,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.next_cursor ?? undefined,
    enabled: enabled && Boolean(user?.id && organizationId && propertyId),
    staleTime: 30_000,
  })
}
