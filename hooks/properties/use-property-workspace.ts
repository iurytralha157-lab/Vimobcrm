'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useAuth } from '@/contexts/AuthContext'
import { createTenantQueryAccessSignature } from '@/lib/access/tenant-query-cache'
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
  ownerOptions: (organizationId: string | undefined, accessSignature: string) => [
    ...propertyWorkspaceKeys.root(organizationId, accessSignature),
    'owner-options',
  ] as const,
}

function useWorkspaceQueryScope() {
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

function useWorkspaceOrganizationId() {
  return useWorkspaceQueryScope().organizationId
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
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

export function usePropertyOwnerOptions(enabled = true) {
  const { user } = useAuth()
  const { organizationId, accessSignature } = useWorkspaceQueryScope()

  return useQuery({
    queryKey: propertyWorkspaceKeys.ownerOptions(organizationId, accessSignature),
    queryFn: async () => {
      if (!organizationId) return []
      return propertyWorkspaceAPI.listOwnerOptions(organizationId)
    },
    enabled: Boolean(enabled && user?.id && organizationId),
    gcTime: 0,
    staleTime: 30_000,
    retry: false,
  })
}

export function useUpsertPropertyOffer(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({
      offerType,
      input,
    }: {
      offerType: PropertyOfferType
      input: PropertyOfferUpsertInput
    }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.upsertOffer(organizationId, propertyId, offerType, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Oferta atualizada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyKey(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async (input: PropertyKeyCreateInput) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.createKey(organizationId, propertyId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Chave cadastrada com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useMovePropertyKey(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({ keyId, input }: { keyId: string; input: PropertyKeyMovementInput }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.moveKey(organizationId, propertyId, keyId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Movimentacao de chave registrada')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useCreatePropertyOwnership(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: PropertyOwnershipCreateInput) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.createOwnership(organizationId, propertyId, input)
    },
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: ['property-owners'] }),
      ])
      toast.success('Proprietario vinculado com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useUpdatePropertyOwnership(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      ownershipId,
      input,
    }: {
      ownershipId: string
      input: PropertyOwnershipUpdateInput
    }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.updateOwnership(organizationId, propertyId, ownershipId, input)
    },
    onSuccess: async () => {
      await Promise.all([
        invalidate(),
        queryClient.invalidateQueries({ queryKey: ['property-owners'] }),
      ])
      toast.success('Proprietario e participacao atualizados')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useEndPropertyOwnership(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({
      ownershipId,
      input,
    }: {
      ownershipId: string
      input: PropertyOwnershipEndInput
    }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.endOwnership(organizationId, propertyId, ownershipId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Vinculo de propriedade encerrado')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export type PropertyAssetCreateCommand = {
  input: Omit<PropertyAssetCreateInput, 'storage_path'>
  file?: File | null
}

export function useCreatePropertyAsset(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({ input, file }: PropertyAssetCreateCommand) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')

      let createInput: PropertyAssetCreateInput = { ...input, storage_path: null }
      if (file) {
        if (!['photo', 'floor_plan', 'document'].includes(input.asset_type)) {
          throw new Error('Videos e tours virtuais devem usar uma URL externa')
        }
        const uploaded = await propertyWorkspaceAPI.uploadAssetFile(
          organizationId,
          propertyId,
          input.asset_type as 'photo' | 'floor_plan' | 'document',
          file,
        )
        createInput = {
          ...createInput,
          storage_path: uploaded.storage_path,
          external_url: null,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size_bytes: file.size,
        }
      }

      return propertyWorkspaceAPI.createAsset(organizationId, propertyId, createInput)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Midia ou documento cadastrado')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useUpdatePropertyAsset(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({ assetId, input }: { assetId: string; input: PropertyAssetUpdateInput }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.updateAsset(organizationId, propertyId, assetId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Ativo atualizado com sucesso')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useDeletePropertyAsset(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({ assetId, input }: { assetId: string; input: PropertyAssetDeleteInput }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.deleteAsset(organizationId, propertyId, assetId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Ativo removido')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useReorderPropertyAssets(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async (input: PropertyAssetOrderInput) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.reorderAssets(organizationId, propertyId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Ordem dos ativos atualizada')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export function useSetPrimaryPropertyAsset(propertyId: string | null) {
  const organizationId = useWorkspaceOrganizationId()
  const invalidate = useInvalidatePropertyWorkspace(propertyId)

  return useMutation({
    mutationFn: async ({ assetId, input }: { assetId: string; input: PropertyAssetPrimaryInput }) => {
      if (!organizationId || !propertyId) throw new Error('Organizacao ou imovel nao identificado')
      return propertyWorkspaceAPI.setPrimaryAsset(organizationId, propertyId, assetId, input)
    },
    onSuccess: async () => {
      await invalidate()
      toast.success('Foto principal atualizada')
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  })
}

export type { PropertyWorkspace }
