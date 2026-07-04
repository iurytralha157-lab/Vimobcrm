import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { propertyOwnersAPI, type PropertyOwner, type PropertyOwnerInput } from '@/lib/api/property-owners'

export type { PropertyOwner }

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

export function useCreatePropertyOwner() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (owner: PropertyOwnerInput) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

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
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

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
