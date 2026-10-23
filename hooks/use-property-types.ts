import { useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { usePropertyMutation } from '@/hooks/properties/use-property-mutation'
import { useOptionalActiveOrganizationId as useOrganizationId } from '@/hooks/use-active-organization'
import { propertyCatalogAPI } from '@/lib/api/property-catalog'

export interface PropertyType {
  id: string
  name: string
  organization_id: string
  created_at: string
}

const defaultTypes = [
  'Apartamento',
  'Casa',
  'Casa de condomínio',
  'Cobertura',
  'Comercial',
  'Terreno',
  'Lote',
  'Kitnet',
  'Flat',
  'Fazenda',
  'S\u00edtio',
  'Ch\u00e1cara',
  'Galp\u00e3o',
]

export function usePropertyTypes(options: { enabled?: boolean } = {}) {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['property-types', organizationId],
    queryFn: async () => {
      if (!organizationId) return defaultTypes

      const { data } = await propertyCatalogAPI.getTypes(organizationId)
      const customNames = (data || []).map((type) => type.name)

      return [...new Set([...defaultTypes, ...customNames])].sort()
    },
    initialData: defaultTypes,
    enabled: !!organizationId && options.enabled !== false,
  })
}

export function useCreatePropertyType() {
  const queryClient = useQueryClient()

  return usePropertyMutation({
    mutationFn: async (name: string, scope) => {
      const organizationId = scope.organizationId
      if (!scope.actorId) throw new Error('Usuário não autenticado')
      if (!organizationId) throw new Error('Usuário não possui organização')

      const { data } = await propertyCatalogAPI.createType(organizationId, name, scope.requestIntent)
      return data
    },
    onSuccess: (_data, _input, scope) => {
      queryClient.invalidateQueries({ queryKey: ['property-types'] })
      if (scope.isCurrent()) toast.success('Tipo de imóvel adicionado!')
    },
    onError: (error, _input, scope) => {
      if (scope.isCurrent()) toast.error('Erro ao adicionar tipo: ' + error.message)
    },
  })
}
