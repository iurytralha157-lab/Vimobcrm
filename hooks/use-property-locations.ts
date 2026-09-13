import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import { stringifyErrorMessage as getErrorMessage } from '@/lib/api/vimob-error'
import { isPropertyWorkspaceConflict } from '@/lib/property-concurrency'
import {
  propertyLocationsAPI,
  type CreatePropertyCondominiumInput,
  type PropertyCity,
  type PropertyCondominium,
  type PropertyNeighborhood,
  type UpdatePropertyCityInput,
  type UpdatePropertyCondominiumInput,
  type UpdatePropertyNeighborhoodInput,
} from '@/lib/api/property-locations'

export type { PropertyCity, PropertyNeighborhood, PropertyCondominium }

const LOCATION_STALE_TIME = 5 * 60 * 1_000
const LOCATION_GC_TIME = 30 * 60 * 1_000

const locationQueryPolicy = {
  staleTime: LOCATION_STALE_TIME,
  gcTime: LOCATION_GC_TIME,
  refetchOnWindowFocus: false,
} as const

const LOCATION_CONFLICT_MESSAGE =
  'Este cadastro foi alterado por outra pessoa. Feche e reabra a edição para revisar a versão mais recente.'

async function handleLocationConflict(
  queryClient: QueryClient,
  error: unknown,
) {
  if (!isPropertyWorkspaceConflict(error)) return false
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['property-cities'] }),
    queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] }),
    queryClient.invalidateQueries({ queryKey: ['property-condominiums'] }),
    queryClient.invalidateQueries({ queryKey: ['properties'] }),
    queryClient.invalidateQueries({ queryKey: ['properties-infinite'] }),
  ])
  toast.error(LOCATION_CONFLICT_MESSAGE)
  return true
}

// Cities hooks
export function usePropertyCities(options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-cities', organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyCity[]

      const { data } = await propertyLocationsAPI.getCities(organizationId)
      return data
    },
    enabled: !!organizationId && options.enabled !== false,
    ...locationQueryPolicy,
  })
}

export function useCreateCity() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (city: { name: string; uf?: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyLocationsAPI.createCity(organizationId, city)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-cities'] })
      toast.success('Cidade cadastrada!')
    },
    onError: (error) => {
      toast.error('Erro ao cadastrar cidade: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateCity() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePropertyCityInput }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data: city } = await propertyLocationsAPI.updateCity(organizationId, id, data)
      return city
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-cities'] })
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Cidade atualizada!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao atualizar cidade: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteCity() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, expected_updated_at }: { id: string; expected_updated_at: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteCity(organizationId, id, expected_updated_at)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-cities'] })
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Cidade excluída!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao excluir cidade: ' + getErrorMessage(error))
    },
  })
}

// Neighborhoods hooks
export function usePropertyNeighborhoods(cityId?: string, options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-neighborhoods', organizationId, cityId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyNeighborhood[]

      const { data } = await propertyLocationsAPI.getNeighborhoods(organizationId, cityId)
      return data
    },
    enabled: !!organizationId && options.enabled !== false,
    ...locationQueryPolicy,
  })
}

export function useCreateNeighborhood() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (neighborhood: { name: string; city_id: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyLocationsAPI.createNeighborhood(organizationId, neighborhood)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      toast.success('Bairro cadastrado!')
    },
    onError: (error) => {
      toast.error('Erro ao cadastrar bairro: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateNeighborhood() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePropertyNeighborhoodInput }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data: neighborhood } = await propertyLocationsAPI.updateNeighborhood(organizationId, id, data)
      return neighborhood
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Bairro atualizado!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao atualizar bairro: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteNeighborhood() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, expected_updated_at }: { id: string; expected_updated_at: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteNeighborhood(organizationId, id, expected_updated_at)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Bairro excluído!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao excluir bairro: ' + getErrorMessage(error))
    },
  })
}

// Condominiums hooks
export function usePropertyCondominiums(neighborhoodId?: string, options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-condominiums', organizationId, neighborhoodId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyCondominium[]

      const { data } = await propertyLocationsAPI.getCondominiums(organizationId, neighborhoodId)
      return data
    },
    enabled: !!organizationId && options.enabled !== false,
    ...locationQueryPolicy,
  })
}

export function useCreateCondominium() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (condominium: CreatePropertyCondominiumInput) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyLocationsAPI.createCondominium(organizationId, condominium)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Condomínio cadastrado!')
    },
    onError: (error) => {
      toast.error('Erro ao cadastrar condomínio: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateCondominium() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdatePropertyCondominiumInput }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data: condominium } = await propertyLocationsAPI.updateCondominium(organizationId, id, data)
      return condominium
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      queryClient.invalidateQueries({ queryKey: ['properties'] })
      queryClient.invalidateQueries({ queryKey: ['properties-infinite'] })
      toast.success('Condomínio atualizado!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao atualizar condomínio: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteCondominium() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async ({ id, expected_updated_at }: { id: string; expected_updated_at: string }) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteCondominium(organizationId, id, expected_updated_at)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Condomínio excluído!')
    },
    onError: async (error) => {
      if (await handleLocationConflict(queryClient, error)) return
      toast.error('Erro ao excluir condomínio: ' + getErrorMessage(error))
    },
  })
}
