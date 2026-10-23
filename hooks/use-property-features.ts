import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePropertyMutation } from '@/hooks/properties/use-property-mutation'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
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

  return usePropertyMutation({
    mutationFn: async (name: string, scope) => {
      const organizationId = scope.organizationId
      if (!scope.actorId) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyCatalogAPI.createFeature(organizationId, name, scope.requestIntent)
      return toPropertyFeature(data)
    },
    onSuccess: (_data, _input, scope) => {
      queryClient.invalidateQueries({ queryKey: ['property-features'] })
      if (scope.isCurrent()) toast.success('Característica adicionada!')
    },
    onError: (error, _input, scope) => {
      if (scope.isCurrent()) toast.error(error.message)
    },
  })
}

export function useSeedDefaultFeatures() {
  const queryClient = useQueryClient()

  return usePropertyMutation({
    mutationFn: async (_input: void, scope) => {
      const organizationId = scope.organizationId
      if (!scope.actorId) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      await propertyCatalogAPI.seedFeatures(organizationId, DEFAULT_FEATURES, scope.requestIntent)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-features'] })
    },
  })
}

export { DEFAULT_FEATURES }
