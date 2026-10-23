import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePropertyMutation } from '@/hooks/properties/use-property-mutation'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
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

  return usePropertyMutation({
    mutationFn: async (name: string, scope) => {
      const organizationId = scope.organizationId
      if (!scope.actorId) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyCatalogAPI.createProximity(organizationId, name, scope.requestIntent)
      return toPropertyProximity(data)
    },
    onSuccess: (_data, _input, scope) => {
      queryClient.invalidateQueries({ queryKey: ['property-proximities'] })
      if (scope.isCurrent()) toast.success('Proximidade adicionada!')
    },
    onError: (error, _input, scope) => {
      if (scope.isCurrent()) toast.error(error.message)
    },
  })
}

export function useSeedDefaultProximities() {
  const queryClient = useQueryClient()

  return usePropertyMutation({
    mutationFn: async (_input: void, scope) => {
      const organizationId = scope.organizationId
      if (!scope.actorId) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyCatalogAPI.seedProximities(organizationId, DEFAULT_PROXIMITIES, scope.requestIntent)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-proximities'] })
    },
  })
}

export { DEFAULT_PROXIMITIES }
