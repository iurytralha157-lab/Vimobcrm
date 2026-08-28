'use client'

import { useEffect, useRef } from 'react'
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache'
import {
  createPropertyPublicationIdempotencyKey,
  propertyPublicationsAPI,
} from '@/lib/api/property-publications'
import { getPublicErrorMessage } from '@/lib/api/vimob-error'
import {
  propertyPublicationNeedsPolling,
  propertyPublicationNeedsProviderFeedbackPolling,
  propertyPublicationPollingSettled,
} from '@/lib/utils/property-publication-polling'
import type {
  MutatePropertyPublicationInput,
  PropertyPublicationCommandChannel,
  PropertyPublicationOverview,
  PublishPropertyInput,
} from '@/lib/validation'

import { propertyWorkspaceKeys } from './use-property-workspace'

const PUBLICATION_POLL_INTERVAL_MS = 4_000
const PROVIDER_FEEDBACK_POLL_INTERVAL_MS = 30_000

export const propertyPublicationKeys = {
  root: (organizationId?: string, accessSignature?: string) => [
    'property-publications',
    organizationId,
    accessSignature,
  ] as const,
  detail: (
    organizationId: string | undefined,
    accessSignature: string,
    propertyId?: string | null,
  ) => [
    ...propertyPublicationKeys.root(organizationId, accessSignature),
    propertyId,
  ] as const,
}

function usePropertyPublicationQueryScope() {
  const {
    user,
    profile,
    organization,
    organizationsLoaded,
    isInitializingOrg,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth()
  const organizationId = organization?.id
    ?? ((!organizationsLoaded || isInitializingOrg) ? undefined : profile?.organization_id || undefined)

  return {
    userId: user?.id,
    organizationId,
    accessSignature: createTenantQueryAccessSignature({
      userId: user?.id ?? profile?.id,
      organizationId,
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
    }),
  }
}

export { propertyPublicationNeedsPolling }

export function isPropertyPublicationConflict(error: unknown) {
  if (!error || typeof error !== 'object') return false
  return 'status' in error && error.status === 409
}

async function invalidatePropertyPublicationConsumers(
  queryClient: QueryClient,
  organizationId: string | undefined,
  accessSignature: string,
  propertyId: string | null,
) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: propertyWorkspaceKeys.detail(organizationId, accessSignature, propertyId),
    }),
    queryClient.invalidateQueries({ queryKey: ['property', organizationId, propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['property-history', organizationId, propertyId] }),
    queryClient.invalidateQueries({ queryKey: ['properties'] }),
    queryClient.invalidateQueries({ queryKey: ['properties-infinite'] }),
    queryClient.invalidateQueries({ queryKey: ['public-properties', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['public-property', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['public-featured-properties', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['public-exclusive-properties', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['public-home-data', organizationId] }),
    queryClient.invalidateQueries({ queryKey: ['grupo-olx-publications', organizationId] }),
  ])
}

function usePublicationCache(propertyId: string | null) {
  const queryClient = useQueryClient()
  const { organizationId, accessSignature } = usePropertyPublicationQueryScope()
  const publicationKey = propertyPublicationKeys.detail(
    organizationId,
    accessSignature,
    propertyId,
  )

  const invalidateConsumers = () => invalidatePropertyPublicationConsumers(
    queryClient,
    organizationId,
    accessSignature,
    propertyId,
  )

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: publicationKey }),
      invalidateConsumers(),
    ])
  }

  const applyResponse = async (response: PropertyPublicationOverview) => {
    queryClient.setQueryData(publicationKey, response)
    await invalidateConsumers()
  }

  return { organizationId, accessSignature, invalidate, applyResponse }
}

function publicationChannelLabel(channel: PropertyPublicationCommandChannel) {
  return channel === 'grupo_olx' ? 'Grupo OLX' : 'site'
}

function usePublicationCommandIdempotency(scope: string) {
  const pendingCommandRef = useRef<{ fingerprint: string; key: string } | null>(null)

  const keyFor = (input: unknown) => {
    const fingerprint = `${scope}:${JSON.stringify(input)}`
    if (pendingCommandRef.current?.fingerprint === fingerprint) {
      return pendingCommandRef.current.key
    }

    const key = createPropertyPublicationIdempotencyKey(scope)
    pendingCommandRef.current = { fingerprint, key }
    return key
  }

  const clear = () => {
    pendingCommandRef.current = null
  }

  return { clear, keyFor }
}

function handleMutationError(
  error: unknown,
  invalidate: () => Promise<void>,
  channel: PropertyPublicationCommandChannel,
) {
  const channelLabel = publicationChannelLabel(channel)
  // The command may already be committed even when its response is lost.
  // Reconcile the canonical state before the operator can issue another one.
  void invalidate()
  if (isPropertyPublicationConflict(error)) {
    toast.error(`A publicação no ${channelLabel} mudou em outra sessão. Atualizamos os dados para você tentar novamente.`)
    return
  }

  toast.error(getPublicErrorMessage(
    error,
    `Não foi possível atualizar a publicação no ${channelLabel}. Tente novamente em instantes.`,
  ))
}

export function usePropertyPublications(propertyId: string | null, enabled = true) {
  const { userId, organizationId, accessSignature } = usePropertyPublicationQueryScope()
  const queryClient = useQueryClient()
  const previousPollingRef = useRef<{ scope: string; active: boolean } | null>(null)

  const query = useQuery({
    queryKey: propertyPublicationKeys.detail(organizationId, accessSignature, propertyId),
    queryFn: async ({ signal }) => {
      if (!organizationId || !propertyId) return null
      return propertyPublicationsAPI.getPublications(organizationId, propertyId, signal)
    },
    enabled: Boolean(enabled && userId && organizationId && propertyId),
    gcTime: 0,
    staleTime: 15_000,
    refetchInterval: (query) => (
      propertyPublicationNeedsPolling(query.state.data)
        ? PUBLICATION_POLL_INTERVAL_MS
        : propertyPublicationNeedsProviderFeedbackPolling(query.state.data)
          ? PROVIDER_FEEDBACK_POLL_INTERVAL_MS
          : false
    ),
    refetchIntervalInBackground: false,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  })

  const pollingActive = propertyPublicationNeedsPolling(query.data)
  const hasPublicationData = Boolean(query.data)
  const pollingScope = organizationId && propertyId
    ? `${organizationId}:${accessSignature}:${propertyId}`
    : null

  useEffect(() => {
    if (!pollingScope || !organizationId || !propertyId || !hasPublicationData) {
      previousPollingRef.current = null
      return
    }

    const previous = previousPollingRef.current
    previousPollingRef.current = { scope: pollingScope, active: pollingActive }
    if (
      previous?.scope === pollingScope
      && propertyPublicationPollingSettled(previous.active, pollingActive)
    ) {
      void invalidatePropertyPublicationConsumers(
        queryClient,
        organizationId,
        accessSignature,
        propertyId,
      )
    }
  }, [accessSignature, hasPublicationData, organizationId, pollingActive, pollingScope, propertyId, queryClient])

  return query
}

export function usePublishPropertyOnChannel(
  propertyId: string | null,
  channel: PropertyPublicationCommandChannel,
) {
  const { organizationId, applyResponse, invalidate } = usePublicationCache(propertyId)
  const idempotency = usePublicationCommandIdempotency(
    `${channel}:publish:${organizationId ?? 'unknown'}:${propertyId ?? 'unknown'}`,
  )

  return useMutation({
    mutationKey: ['property-publications', channel, 'publish', organizationId, propertyId],
    mutationFn: async (input: PublishPropertyInput) => {
      if (!organizationId || !propertyId) {
        throw new Error('Organização ou imóvel não identificado')
      }
      return propertyPublicationsAPI.publishChannel(
        organizationId,
        propertyId,
        channel,
        input,
        idempotency.keyFor(input),
      )
    },
    onSuccess: async (response) => {
      idempotency.clear()
      await applyResponse(response)
      toast.success(channel === 'grupo_olx'
        ? 'Atualização do XML do Grupo OLX enviada para processamento'
        : 'Publicação enviada para processamento')
    },
    onError: (error) => handleMutationError(error, invalidate, channel),
  })
}

export function usePublishPropertyOnSite(propertyId: string | null) {
  return usePublishPropertyOnChannel(propertyId, 'site')
}

export function usePublishPropertyOnGrupoOLX(propertyId: string | null) {
  return usePublishPropertyOnChannel(propertyId, 'grupo_olx')
}

export function useUnpublishPropertyFromChannel(
  propertyId: string | null,
  channel: PropertyPublicationCommandChannel,
) {
  const { organizationId, applyResponse, invalidate } = usePublicationCache(propertyId)
  const idempotency = usePublicationCommandIdempotency(
    `${channel}:unpublish:${organizationId ?? 'unknown'}:${propertyId ?? 'unknown'}`,
  )

  return useMutation({
    mutationKey: ['property-publications', channel, 'unpublish', organizationId, propertyId],
    mutationFn: async (input: MutatePropertyPublicationInput) => {
      if (!organizationId || !propertyId) {
        throw new Error('Organização ou imóvel não identificado')
      }
      return propertyPublicationsAPI.unpublishChannel(
        organizationId,
        propertyId,
        channel,
        input,
        idempotency.keyFor(input),
      )
    },
    onSuccess: async (response) => {
      idempotency.clear()
      await applyResponse(response)
      toast.success(channel === 'grupo_olx'
        ? 'Retirada do XML do Grupo OLX enviada para processamento'
        : 'Remoção do site enviada para processamento')
    },
    onError: (error) => handleMutationError(error, invalidate, channel),
  })
}

export function useUnpublishPropertyFromSite(propertyId: string | null) {
  return useUnpublishPropertyFromChannel(propertyId, 'site')
}

export function useUnpublishPropertyFromGrupoOLX(propertyId: string | null) {
  return useUnpublishPropertyFromChannel(propertyId, 'grupo_olx')
}

export function useRetryPropertyPublication(
  propertyId: string | null,
  channel: PropertyPublicationCommandChannel = 'site',
) {
  const { organizationId, applyResponse, invalidate } = usePublicationCache(propertyId)
  const idempotency = usePublicationCommandIdempotency(
    `${channel}:retry:${organizationId ?? 'unknown'}:${propertyId ?? 'unknown'}`,
  )

  return useMutation({
    mutationKey: ['property-publications', channel, 'retry', organizationId, propertyId],
    mutationFn: async (input: MutatePropertyPublicationInput) => {
      if (!organizationId || !propertyId) {
        throw new Error('Organização ou imóvel não identificado')
      }
      return propertyPublicationsAPI.retryChannel(
        organizationId,
        propertyId,
        channel,
        input,
        idempotency.keyFor(input),
      )
    },
    onSuccess: async (response) => {
      idempotency.clear()
      await applyResponse(response)
      toast.success(channel === 'grupo_olx'
        ? 'Nova tentativa do XML do Grupo OLX enviada para processamento'
        : 'Nova tentativa enviada para processamento')
    },
    onError: (error) => handleMutationError(error, invalidate, channel),
  })
}

export function useRetryGrupoOLXPublication(propertyId: string | null) {
  return useRetryPropertyPublication(propertyId, 'grupo_olx')
}
