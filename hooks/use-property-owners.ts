import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import { propertyOwnersAPI, type PropertyOwner, type PropertyOwnerInput, type PropertyOwnerPage, type PropertyOwnerUpdateInput } from '@/lib/api/property-owners'
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error'
import { isPropertyWorkspaceConflict } from '@/lib/property-concurrency'

export type { PropertyOwner }

export const PROPERTY_OWNER_PAGE_SIZE = 50

export function usePropertyOwnersPage(
  search = '',
  options: { enabled?: boolean; limit?: number } = {},
) {
  const organizationId = useOrganizationId()
  const normalizedSearch = search.trim()
  const limit = options.limit ?? PROPERTY_OWNER_PAGE_SIZE

  return useInfiniteQuery({
    queryKey: ['property-owners', 'page', organizationId, normalizedSearch, limit],
    queryFn: ({ pageParam, signal }): Promise<PropertyOwnerPage> => {
      if (!organizationId) {
        return Promise.resolve({
          owners: [] as PropertyOwner[],
          nextCursor: null,
          totalCount: 0,
        })
      }
      return propertyOwnersAPI.getOwnersPage(organizationId, {
        search: normalizedSearch || undefined,
        limit,
        cursor: pageParam,
        signal,
      })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    enabled: !!organizationId && options.enabled !== false,
    staleTime: 30_000,
    gcTime: 10 * 60_000,
    refetchOnWindowFocus: false,
  })
}

export function useCreatePropertyOwner() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (owner: PropertyOwnerInput) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyOwnersAPI.createOwner(organizationId, owner)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-owners'] })
      toast.success('Proprietario cadastrado!')
    },
    onError: (error) => {
      toast.error('Erro ao cadastrar proprietario: ' + getErrorMessage(error))
    },
  })
}

export function useUpdatePropertyOwner() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, ...owner }: PropertyOwnerUpdateInput & { id: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyOwnersAPI.updateOwner(organizationId, id, owner)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-owners'] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Proprietario atualizado!')
    },
    onError: async (error) => {
      if (isPropertyWorkspaceConflict(error)) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['property-owners'] }),
          queryClient.invalidateQueries({ queryKey: ['properties'] }),
          queryClient.invalidateQueries({ queryKey: ['properties-infinite'] }),
        ])
        toast.error('Este proprietário foi alterado por outra pessoa. Feche e reabra a edição para revisar a versão mais recente.')
        return
      }
      toast.error('Erro ao atualizar proprietario: ' + getErrorMessage(error))
    },
  })
}

export function useDeactivatePropertyOwner() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, expected_updated_at }: { id: string; expected_updated_at: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyOwnersAPI.deactivateOwner(organizationId, id, expected_updated_at)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-owners'] })
      toast.success('Proprietario desativado!')
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: ['property-owners'] })
      if (isPropertyWorkspaceConflict(error)) {
        toast.error('Este proprietário foi alterado por outra pessoa. Atualize a lista antes de tentar novamente.')
        return
      }
      toast.error('Erro ao desativar proprietario: ' + getErrorMessage(error))
    },
  })
}
