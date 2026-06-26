import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
import { propertyCatalogAPI, type PropertyCatalogItem } from '@/lib/api/property-catalog'

export interface PropertyProximity {
  id: string
  organization_id: string
  name: string
  icon: string | null
  created_at: string
}

const DEFAULT_PROXIMITIES = [
  'Escolas',
  'Universidades',
  'Hospitais',
  'Farm\u00e1cias',
  'Supermercados',
  'Shoppings',
  'Bancos',
  'Transporte p\u00fablico',
  'Metr\u00f4 / Trem',
  'Restaurantes',
  'Padarias',
  'Postos de gasolina',
  'Academia',
  'Parques',
]

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

function toPropertyProximity(item: PropertyCatalogItem): PropertyProximity {
  return {
    id: item.id,
    organization_id: item.organization_id,
    name: item.name,
    icon: item.icon || null,
    created_at: item.created_at || '',
  }
}

export function usePropertyProximities() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-proximities', organizationId],
    queryFn: async () => {
      if (!organizationId) return [] as PropertyProximity[]

      const { data } = await propertyCatalogAPI.getProximities(organizationId)
      return (data || []).map(toPropertyProximity)
    },
    enabled: !!organizationId,
  })
}

export function useCreatePropertyProximity() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      const { data } = await propertyCatalogAPI.createProximity(organizationId, name)
      return toPropertyProximity(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-proximities'] })
      toast.success('Proximidade adicionada!')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })
}

export function useSeedDefaultProximities() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async () => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      await propertyCatalogAPI.seedProximities(organizationId, DEFAULT_PROXIMITIES)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-proximities'] })
    },
  })
}

export { DEFAULT_PROXIMITIES }
