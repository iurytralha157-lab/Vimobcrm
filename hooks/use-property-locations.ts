import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import {
  propertyLocationsAPI,
  type CreatePropertyCondominiumInput,
  type PropertyCity,
  type PropertyCondominium,
  type PropertyNeighborhood,
} from '@/lib/api/property-locations'

export type { PropertyCity, PropertyNeighborhood, PropertyCondominium }

const LOCATION_STALE_TIME = 5 * 60 * 1_000
const LOCATION_GC_TIME = 30 * 60 * 1_000

const locationQueryPolicy = {
  staleTime: LOCATION_STALE_TIME,
  gcTime: LOCATION_GC_TIME,
  refetchOnWindowFocus: false,
} as const

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return String(error)
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

export function useDeleteCity() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteCity(organizationId, id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-cities'] })
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Cidade excluída!')
    },
    onError: (error) => {
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

export function useDeleteNeighborhood() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteNeighborhood(organizationId, id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-neighborhoods'] })
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Bairro excluído!')
    },
    onError: (error) => {
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

export function useDeleteCondominium() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!user?.id) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyLocationsAPI.deleteCondominium(organizationId, id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-condominiums'] })
      toast.success('Condomínio excluído!')
    },
    onError: (error) => {
      toast.error('Erro ao excluir condomínio: ' + getErrorMessage(error))
    },
  })
}
