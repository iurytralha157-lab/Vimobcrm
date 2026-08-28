import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { propertyOwnersAPI, type PropertyOwner, type PropertyOwnerInput, type PropertyOwnerPage } from '@/lib/api/property-owners'

export type { PropertyOwner }

export const PROPERTY_OWNER_PAGE_SIZE = 50

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
}

export function usePropertyOwners() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-owners', organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyOwner[]

      const { data } = await propertyOwnersAPI.getOwners(organizationId)
      return data
    },
    enabled: !!organizationId,
  })
}

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
    mutationFn: async ({ id, ...owner }: PropertyOwnerInput & { id: string }) => {
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
    onError: (error) => {
      toast.error('Erro ao atualizar proprietario: ' + getErrorMessage(error))
    },
  })
}
