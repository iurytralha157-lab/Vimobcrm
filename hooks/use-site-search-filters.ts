import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/contexts/AuthContext'
import { siteAPI, type SiteSearchFilter } from '@/lib/api/site'
import { toast } from 'sonner'

export type { SiteSearchFilter }

export const AVAILABLE_FILTERS = [
  { key: 'search', label: 'Busca por texto', defaultLabel: 'Buscar' },
  { key: 'tipo', label: 'Tipo de imóvel', defaultLabel: 'Tipo de Imóvel' },
  { key: 'finalidade', label: 'Finalidade (Venda/Aluguel)', defaultLabel: 'Finalidade' },
  { key: 'cidade', label: 'Cidade', defaultLabel: 'Cidade' },
  { key: 'bairro', label: 'Bairro', defaultLabel: 'Bairro' },
  { key: 'quartos', label: 'Quartos', defaultLabel: 'Quartos' },
  { key: 'suites', label: 'Suites', defaultLabel: 'Suites' },
  { key: 'banheiros', label: 'Banheiros', defaultLabel: 'Banheiros' },
  { key: 'vagas', label: 'Vagas de garagem', defaultLabel: 'Vagas' },
  { key: 'mobilia', label: 'Mobilia', defaultLabel: 'Mobilia' },
  { key: 'preco', label: 'Faixa de preco', defaultLabel: 'Faixa de Preco' },
] as const

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Erro desconhecido'
}

function useOrganizationId() {
  const { profile, organization } = useAuth()
  return organization?.id || profile?.organization_id || undefined
}

export function useSiteSearchFilters() {
  const organizationId = useOrganizationId()

  return useQuery({
    queryKey: ['site-search-filters', organizationId],
    queryFn: async () => {
      if (!organizationId) return []
      return siteAPI.listSearchFilters(organizationId)
    },
    enabled: !!organizationId,
  })
}

export function useCreateSearchFilter() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (item: Pick<SiteSearchFilter, 'filter_key' | 'label' | 'position' | 'is_active'>) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return siteAPI.createSearchFilter(item, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters', organizationId] })
      toast.success('Filtro adicionado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao adicionar filtro: ' + getErrorMessage(error))
    },
  })
}

export function useUpdateSearchFilter() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (item: Partial<SiteSearchFilter> & { id: string }) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      return siteAPI.updateSearchFilter(item, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters', organizationId] })
      toast.success('Filtro atualizado!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao atualizar filtro: ' + getErrorMessage(error))
    },
  })
}

export function useDeleteSearchFilter() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (id: string) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      await siteAPI.deleteSearchFilter(id, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters', organizationId] })
      toast.success('Filtro removido!')
    },
    onError: (error: unknown) => {
      toast.error('Erro ao remover filtro: ' + getErrorMessage(error))
    },
  })
}

export function useReorderSearchFilters() {
  const queryClient = useQueryClient()
  const organizationId = useOrganizationId()

  return useMutation({
    mutationFn: async (items: { id: string; position: number }[]) => {
      if (!organizationId) throw new Error('Organização não encontrada')
      await siteAPI.reorderSearchFilters(items, organizationId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['site-search-filters', organizationId] })
    },
    onError: (error: unknown) => {
      toast.error('Erro ao reordenar: ' + getErrorMessage(error))
    },
  })
}
