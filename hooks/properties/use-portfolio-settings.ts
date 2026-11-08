'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import { useTenantQueryAccessSignature } from '@/hooks/shared/use-tenant-query-access-signature'
import { propertiesAPI } from '@/lib/api/properties'
import type { PortfolioSettingsEnvelope, PortfolioSettingsUpdateInput } from '@/lib/validation'

function portfolioSettingsKey(organizationId: string | undefined, accessSignature: string) {
  return ['property-portfolio-settings', organizationId, accessSignature] as const
}

export function usePortfolioSettings() {
  const organizationId = useOrganizationId()
  const accessSignature = useTenantQueryAccessSignature()
  return useQuery({
    queryKey: portfolioSettingsKey(organizationId ?? undefined, accessSignature),
    queryFn: () => propertiesAPI.getPortfolioSettings(organizationId as string),
    enabled: Boolean(organizationId),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useUpdatePortfolioSettings() {
  const organizationId = useOrganizationId()
  const accessSignature = useTenantQueryAccessSignature()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: PortfolioSettingsUpdateInput) => propertiesAPI.updatePortfolioSettings(organizationId as string, input),
    onSuccess: (data: PortfolioSettingsEnvelope) => {
      queryClient.setQueryData(portfolioSettingsKey(organizationId ?? undefined, accessSignature), data)
    },
  })
}
