import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/AuthContext'
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
  'Cobertura',
  'Comercial',
  'Terreno',
  'Kitnet',
  'Flat',
  'Fazenda',
  'S\u00edtio',
  'Galp\u00e3o',
]

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

export function usePropertyTypes() {
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
  })
}

export function useCreatePropertyType() {
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (name: string) => {
      if (!user?.id) throw new Error('Usuario nao autenticado')
      if (!organizationId) throw new Error('Usuario nao possui organizacao')

      const { data } = await propertyCatalogAPI.createType(organizationId, name)
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['property-types'] })
      toast.success('Tipo de imóvel adicionado!')
    },
    onError: (error) => {
      toast.error('Erro ao adicionar tipo: ' + error.message)
    },
  })
}
