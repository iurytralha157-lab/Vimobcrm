'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { usePropertyAssetMutation } from '@/hooks/properties/use-property-asset-mutation'
import { usePropertyMutation, type PropertyMutationScope } from '@/hooks/properties/use-property-mutation'
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache'
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error'
import { createPropertyAssetWithRecovery } from '@/lib/properties/property-asset-create-recovery'
import {
  propertyWorkspaceAPI,
  type PropertyWorkspace,
} from '@/lib/api/property-workspace'
import type {
  PropertyAssetCreateInput,
  PropertyAssetDeleteInput,
  PropertyAssetOrderInput,
  PropertyAssetPrimaryInput,
  PropertyAssetUpdateInput,
  PropertyKeyCreateInput,
  PropertyKeyMovementInput,
  PropertyOfferType,
  PropertyOfferUpsertInput,
  PropertyOwnershipCreateInput,
  PropertyOwnershipEndInput,
  PropertyOwnershipUpdateInput,
} from '@/lib/validation'

export const propertyWorkspaceKeys = {
  root: (organizationId?: string, accessSignature?: string) => [
    'property-workspace',
    organizationId,
    accessSignature,
  ] as const,
  detail: (
    organizationId: string | undefined,
    accessSignature: string,
    propertyId?: string | null,
  ) => [
    ...propertyWorkspaceKeys.root(organizationId, accessSignature),
    propertyId,
  ] as const,
}

export function useWorkspaceQueryScope() {
  const {
    activeOrganization,
    user,
    profile,
    organization,
    tenantContext,
    isSuperAdmin,
    impersonating,
  } = useAuth()
  const organizationId = activeOrganization.organizationId || undefined

  return {
    organizationId,
    actorId: user?.id,
    tenantUserId: tenantContext?.userId,
    tenantOrganizationId: tenantContext?.organizationId,
    ready: activeOrganization.status === 'ready',
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

function useInvalidatePropertyWorkspace(propertyId: string | null) {
  const queryClient = useQueryClient()
  const { organizationId, accessSignature } = useWorkspaceQueryScope()

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: propertyWorkspaceKeys.detail(organizationId, accessSignature, propertyId),
      }),
      queryClient.invalidateQueries({ queryKey: ['property', organizationId, propertyId] }),
      queryClient.invalidateQueries({ queryKey: ['property-history', organizationId, propertyId] }),
      queryClient.invalidateQueries({ queryKey: ['properties'] }),
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] }),
    ])
  }
}

export function usePropertyWorkspace(propertyId: string | null) {
  const { user } = useAuth()
  const { organizationId, accessSignature } = useWorkspaceQueryScope()

  return useQuery({
    queryKey: propertyWorkspaceKeys.detail(organizationId, accessSignature, propertyId),
    queryFn: async () => {
      if (!organizationId || !propertyId) return null
      return propertyWorkspaceAPI.getWorkspace(organizationId, propertyId)
    },
    enabled: Boolean(user?.id && organizationId && propertyId),
    gcTime: 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    retry: false,
  })
}

export function useUpsertPropertyOffer(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    ({ offerType, input }: { offerType: PropertyOfferType; input: PropertyOfferUpsertInput }, scope) =>
      propertyWorkspaceAPI.upsertOffer(scope.organizationId, propertyId!, offerType, input, scope.requestIntent),
    'Oferta atualizada com sucesso')
}

export function useCreatePropertyKey(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    (input: PropertyKeyCreateInput, scope) => propertyWorkspaceAPI.createKey(scope.organizationId, propertyId!, input, scope.requestIntent),
    'Chave cadastrada com sucesso')
}

export function useMovePropertyKey(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    ({ keyId, input }: { keyId: string; input: PropertyKeyMovementInput }, scope) =>
      propertyWorkspaceAPI.moveKey(scope.organizationId, propertyId!, keyId, input, undefined, scope.requestIntent),
    'Movimentacao de chave registrada')
}

export function useCreatePropertyOwnership(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    (input: PropertyOwnershipCreateInput, scope) => propertyWorkspaceAPI.createOwnership(scope.organizationId, propertyId!, input, scope.requestIntent),
    'Proprietario vinculado com sucesso', true)
}

export function useUpdatePropertyOwnership(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    ({ ownershipId, input }: { ownershipId: string; input: PropertyOwnershipUpdateInput }, scope) =>
      propertyWorkspaceAPI.updateOwnership(scope.organizationId, propertyId!, ownershipId, input, scope.requestIntent),
    'Proprietario e participacao atualizados', true)
}

export function useEndPropertyOwnership(propertyId: string | null) {
  return useWorkspaceMutation(propertyId,
    ({ ownershipId, input }: { ownershipId: string; input: PropertyOwnershipEndInput }, scope) =>
      propertyWorkspaceAPI.endOwnership(scope.organizationId, propertyId!, ownershipId, input, scope.requestIntent),
    'Vinculo de propriedade encerrado')
}

function useWorkspaceMutation<TData, TVariables>(
  propertyId: string | null,
  mutationFn: (input: TVariables, scope: PropertyMutationScope) => Promise<TData>,
  successMessage: string,
  invalidateOwners = false,
) {
  const invalidate = useInvalidatePropertyWorkspace(propertyId)
  const queryClient = useQueryClient()
  return usePropertyMutation({
    resourceId: propertyId ?? '',
    mutationFn: (input: TVariables, scope) => {
      if (!propertyId) throw new Error('Imovel nao identificado')
      return mutationFn(input, scope)
    },
    onSuccess: async (_data, _input, scope) => {
      await invalidate()
      if (invalidateOwners) await queryClient.invalidateQueries({ queryKey: ['property-owners'] })
      if (scope.isCurrent()) toast.success(successMessage)
    },
    onError: (error, _input, scope) => { if (scope.isCurrent()) toast.error(getErrorMessage(error)) },
  })
}

export type PropertyAssetCreateCommand = {
  input: Omit<PropertyAssetCreateInput, 'storage_path'>
  file?: File | null
}

export function useCreatePropertyAsset(propertyId: string | null) {
  return usePropertyAssetMutation(
    { ...useWorkspaceQueryScope(), propertyId },
    ({ input, file }: PropertyAssetCreateCommand, organizationId, originalPropertyId, execution) =>
      createPropertyAssetWithRecovery({ client: propertyWorkspaceAPI, organizationId, propertyId: originalPropertyId, input, file, execution }),
    'Midia ou documento cadastrado',
  )
}

export function useUpdatePropertyAsset(propertyId: string | null) {
  return usePropertyAssetMutation({ ...useWorkspaceQueryScope(), propertyId },
    ({ assetId, input }: { assetId: string; input: PropertyAssetUpdateInput }, organizationId, originalPropertyId, execution) =>
      propertyWorkspaceAPI.updateAsset(organizationId, originalPropertyId, assetId, input, execution),
    'Ativo atualizado com sucesso')
}

export function useDeletePropertyAsset(propertyId: string | null) {
  return usePropertyAssetMutation({ ...useWorkspaceQueryScope(), propertyId },
    ({ assetId, input }: { assetId: string; input: PropertyAssetDeleteInput }, organizationId, originalPropertyId, execution) =>
      propertyWorkspaceAPI.deleteAsset(organizationId, originalPropertyId, assetId, input, execution),
    'Ativo removido')
}

export function useReorderPropertyAssets(propertyId: string | null) {
  return usePropertyAssetMutation({ ...useWorkspaceQueryScope(), propertyId },
    (input: PropertyAssetOrderInput, organizationId, originalPropertyId, execution) =>
      propertyWorkspaceAPI.reorderAssets(organizationId, originalPropertyId, input, execution),
    'Ordem dos ativos atualizada')
}

export function useSetPrimaryPropertyAsset(propertyId: string | null) {
  return usePropertyAssetMutation({ ...useWorkspaceQueryScope(), propertyId },
    ({ assetId, input }: { assetId: string; input: PropertyAssetPrimaryInput }, organizationId, originalPropertyId, execution) =>
      propertyWorkspaceAPI.setPrimaryAsset(organizationId, originalPropertyId, assetId, input, execution),
    'Foto principal atualizada')
}

export type { PropertyWorkspace }
