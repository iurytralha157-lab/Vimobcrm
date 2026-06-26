import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { propertyCatalogAPI, type PropertyCatalogItem } from '@/lib/api/property-catalog'

export interface PropertyFeature {
  id: string
  organization_id: string
  name: string
  icon: string | null
  created_at: string | null
}

const DEFAULT_FEATURES = [
  'Sala de jantar',
  'Cozinha',
  'Escrit\u00f3rio',
  'Lavanderia',
  'Despensa',
  'Lavabo',
  '\u00c1rea de churrasco',
  'Jardim',
  'Piscina',
  'Varanda',
  'Sacada',
  'Closet',
  'Home office',
  'Sala de estar',
  'Quintal',
  'Ed\u00edcula',
]

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

function toPropertyFeature(item: PropertyCatalogItem): PropertyFeature {
  return {
    id: item.id,
    organization_id: item.organization_id,
    name: item.name,
    icon: item.icon || null,
    created_at: item.created_at || null,
  }
}

export function usePropertyFeatures() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-features', organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyFeature[]

      const { data } = await propertyCatalogAPI.getFeatures(organizationId)
      return (data || []).map(toPropertyFeature)
    },
    enabled: !!organizationId,
  })
}

export function useCreatePropertyFeature() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      const { data } = await propertyCatalogAPI.createFeature(organizationId, name)
      return toPropertyFeature(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-features'] })
      toast.success('Característica adicionada!')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })
}

export function useSeedDefaultFeatures() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      await propertyCatalogAPI.seedFeatures(organizationId, DEFAULT_FEATURES)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-features'] })
    },
  })
}

export { DEFAULT_FEATURES }
