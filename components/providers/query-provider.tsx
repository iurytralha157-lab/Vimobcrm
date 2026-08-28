'use client'

import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, ReactNode } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { useWhatsAppQueryScope } from '@/hooks/use-whatsapp-query-scope'
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache'
import {
  isWhatsAppQueryKey,
  isWhatsAppQueryKeyForScope,
} from '@/lib/whatsapp-query-cache'

const DEFAULT_QUERY_STALE_TIME_MS = 1000 * 60 * 10
const DEFAULT_QUERY_GC_TIME_MS = 1000 * 60 * 60

function createTenantQueryClient(accessSignature: string) {
  void accessSignature
  return new QueryClient({
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
}

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
  const { user, profile, organization, tenantContext, isSuperAdmin, impersonating } = useAuth()
  const accessSignature = createTenantQueryAccessSignature({
    userId: user?.id ?? profile?.id,
    organizationId: organization?.id ?? profile?.organization_id,
    memberRole: tenantContext?.memberRole,
    permissions: tenantContext?.permissions,
    enabledModules: tenantContext?.enabledModules,
    isTeamLeader: tenantContext?.isTeamLeader,
    ledTeamIds: tenantContext?.ledTeamIds,
    ledUserIds: tenantContext?.ledUserIds,
    ledPipelineIds: tenantContext?.ledPipelineIds,
    isSuperAdmin: tenantContext?.isSuperAdmin ?? isSuperAdmin,
    impersonatedOrganizationId: impersonating?.orgId,
    propertyEditPolicy: organization?.property_edit_policy,
    propertyOwnerContactVisibility: organization?.property_owner_contact_visibility,
  })
  const queryClient = useMemo(
    () => createTenantQueryClient(accessSignature),
    [accessSignature],
  )

  return (
    <QueryClientProvider client={queryClient}>
      <WhatsAppTenantCacheBoundary />
      {children}
    </QueryClientProvider>
  )
}
